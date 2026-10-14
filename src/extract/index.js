'use strict';

const { parseHTML } = require('linkedom');
const { CaptureManager, shouldRender } = require('../capture');
const { validateUrl, validateCaptureMode, parseWaitAfterLoad, validateSelectors } = require('../fetchary');
const { comparisonHtml, comparisonText } = require('../diff');
const { discoverVendors } = require('../vendors');
const { FetcharyValidationError, FetcharyNotFoundError } = require('../errors');
const { httpUrl, documentBase, readResource, selectImage } = require('./images');

function extractionOptions(options, defaultMode = 'browser') {
  const settings = {
    fetch: options.fetch || globalThis.fetch,
    timeout: options.timeout ?? 30_000,
    userAgent: options.userAgent || 'fetchary/0.1',
    captureMode: validateCaptureMode(options.mode ?? defaultMode),
    waitAfterLoadMs: parseWaitAfterLoad(options.waitAfterLoad),
    launchBrowser: options.launchBrowser,
  };
  if (typeof settings.fetch !== 'function') throw new FetcharyValidationError('a Fetch-compatible implementation is required');
  if (!Number.isFinite(settings.timeout) || settings.timeout <= 0) throw new FetcharyValidationError('timeout must be greater than zero');
  return settings;
}

async function withCapture(url, options, defaultMode, operation) {
  const requestedUrl = validateUrl(url);
  const settings = extractionOptions(options, defaultMode);
  const capture = new CaptureManager(settings);
  try {
    const page = await capture.capture({ url: requestedUrl, captureMode: settings.captureMode, waitAfterLoadMs: settings.waitAfterLoadMs });
    return await operation(page, settings);
  } finally { await capture.close(); }
}

function pageMetadata(page) {
  return {
    requestedUrl: page.requestedUrl,
    finalUrl: page.browserFinalUrl || page.rawFinalUrl,
    rawFinalUrl: page.rawFinalUrl,
    capturedAt: page.renderedCapturedAt || page.rawCapturedAt,
    status: page.status, contentType: page.contentType,
    captureMode: page.captureMode, dismissedOverlays: page.dismissedOverlays,
  };
}

async function extract(url, options = {}) {
  const format = options.format ?? 'html';
  if (!['html', 'text'].includes(format)) throw new FetcharyValidationError('format must be "html" or "text"');
  const includeSelectors = validateSelectors(options.includeSelectors ?? [], 'include');
  const ignoreSelectors = validateSelectors(options.ignoreSelectors ?? [], 'ignore');
  return withCapture(url, options, 'browser', page => {
    const html = page.renderedHtml ?? page.rawBody.toString('utf8');
    const content = shouldRender(page.contentType)
      ? (format === 'text' ? comparisonText : comparisonHtml)(html, { includeSelectors, ignoreSelectors })
      : html;
    return { ...pageMetadata(page), format, content };
  });
}

async function extractFavicon(url, options = {}) {
  return withCapture(url, options, 'http', async (page, settings) => {
    const candidates = [];
    const manifests = new Set();
    const documents = [{ html: page.rawBody.toString('utf8'), url: page.rawFinalUrl }];
    if (page.renderedHtml != null) documents.unshift({ html: page.renderedHtml, url: page.browserFinalUrl });
    for (const captured of documents) {
      const { document } = parseHTML(captured.html);
      const base = documentBase(document, captured.url);
      for (const link of document.querySelectorAll('link[rel][href]')) {
        const rel = link.getAttribute('rel').toLowerCase().split(/\s+/);
        const target = httpUrl(link.getAttribute('href'), base);
        if (!target) continue;
        if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
          candidates.push({ url: target, sizes: link.getAttribute('sizes'), source: rel.includes('icon') ? 'icon' : 'apple-touch-icon' });
        }
        if (rel.includes('manifest')) manifests.add(target);
      }
    }
    for (const manifestUrl of [...manifests].slice(0, 8)) {
      try {
        const resource = await readResource(manifestUrl, settings, 1024 * 1024);
        const manifest = JSON.parse(resource.body.toString('utf8'));
        if (!Array.isArray(manifest.icons)) continue;
        for (const icon of manifest.icons) {
          const target = httpUrl(icon?.src, resource.url);
          if (target) candidates.push({ url: target, sizes: icon.sizes, source: 'manifest' });
        }
      } catch {}
    }
    candidates.push({ url: new URL('/favicon.ico', pageMetadata(page).finalUrl).href, source: 'fallback' });
    const image = await selectImage(candidates, settings);
    if (!image) throw new FetcharyNotFoundError('no accessible favicon found', { url: page.requestedUrl });
    return { ...pageMetadata(page), image };
  });
}

async function extractProfilePicture(url, options = {}) {
  const requestedUrl = validateUrl(url);
  const vendors = discoverVendors().filter(vendor => typeof vendor.profilePicture === 'function');
  if (!vendors.some(vendor => vendor.matches(requestedUrl))) {
    throw new FetcharyValidationError('profile pictures require a supported social profile URL', { url: requestedUrl });
  }
  return withCapture(requestedUrl, options, 'browser', async (page, settings) => {
    const vendor = vendors.find(vendor => vendor.matches(requestedUrl));
    if (!vendor.matches(page.rawFinalUrl)) throw new FetcharyNotFoundError('the page redirected outside the supported social platform');
    const raw = vendor.profilePicture(parseHTML(page.rawBody.toString('utf8')).document, page.rawFinalUrl);
    let rendered = null;
    if (page.renderedHtml != null && vendor.matches(page.browserFinalUrl)) {
      rendered = vendor.profilePicture(parseHTML(page.renderedHtml).document, page.browserFinalUrl);
    }
    const candidates = [...(rendered?.candidates || [])];
    // A raw fallback belongs to this capture's profile, including when the
    // rendered page is a login wall. Never mix different profiles or hosts.
    let rawFallbackAllowed = !page.browserFinalUrl;
    if (page.browserFinalUrl && vendor.matches(page.browserFinalUrl)) {
      const identity = vendor.profilePicture(parseHTML('<html></html>').document, page.browserFinalUrl)?.profile;
      const browserUrl = new URL(page.browserFinalUrl);
      const gated = /^(?:\/accounts)?\/(?:login|signin|signup|authwall|checkpoint|uas|i\/flow\/login)(?:\/|$)/.test(browserUrl.pathname)
        || browserUrl.hostname === 'consent.youtube.com';
      rawFallbackAllowed = identity === raw?.profile || (!identity && gated);
    }
    if (raw && rawFallbackAllowed && (!rendered || rendered.profile === raw.profile)) {
      candidates.push(...raw.candidates);
    }
    const image = await selectImage(candidates, settings);
    if (!image) throw new FetcharyNotFoundError('no accessible profile picture found on this public profile', { url: requestedUrl });
    return { ...pageMetadata(page), vendor: vendor.name, image };
  });
}

module.exports = { extract, extractFavicon, extractProfilePicture };
