'use strict';

const { parseHTML } = require('linkedom');
const { CaptureManager, shouldRender, sharedCaptureCache } = require('../capture');
const { createCaptureCache, validateCacheTtl } = require('../capture/cache');
const { validateUrl, validateCaptureMode, parseWaitAfterLoad, validateSelectors } = require('../fetchary');
const { comparisonHtml, comparisonText } = require('../diff');
const { discoverVendors } = require('../vendors');
const { FetcharyValidationError, FetcharyNotFoundError } = require('../errors');
const { httpUrl, documentBase, readResource, selectImage } = require('./images');

const clientCache = Symbol('captureCache');

function extractionOptions(options, defaultMode = 'browser') {
  const settings = {
    fetch: options.fetch || globalThis.fetch,
    timeout: options.timeout ?? 30_000,
    userAgent: options.userAgent || 'fetchary/0.1',
    browserUserAgent: options.userAgent || 'fetchary/0.1',
    captureMode: validateCaptureMode(options.mode ?? defaultMode),
    waitAfterLoadMs: parseWaitAfterLoad(options.waitAfterLoad),
    launchBrowser: options.launchBrowser,
    headers: options.headers,
    cacheTtlMs: validateCacheTtl(options.cacheTtlMs),
    captureCache: options[clientCache],
  };
  if (typeof settings.fetch !== 'function') throw new FetcharyValidationError('a Fetch-compatible implementation is required');
  if (!Number.isFinite(settings.timeout) || settings.timeout <= 0) throw new FetcharyValidationError('timeout must be greater than zero');
  if (settings.launchBrowser !== undefined && typeof settings.launchBrowser !== 'function') throw new FetcharyValidationError('launchBrowser must be a function');
  try { if (settings.headers !== undefined) settings.headers = Object.fromEntries(new Headers(settings.headers)); } catch (cause) {
    throw new FetcharyValidationError('headers must be valid request headers', { cause });
  }
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
    cache: { ...page.cache },
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

function extractText(url, options = {}) { return extract(url, { ...options, format: 'text' }); }
function extractHtml(url, options = {}) { return extract(url, { ...options, format: 'html' }); }

async function extractSelector(url, selector, options = {}) {
  const [validated] = validateSelectors([selector], 'include');
  return extract(url, { ...options, includeSelectors: [validated] });
}

function pageDocument(page) {
  return parseHTML(page.renderedHtml ?? page.rawBody.toString('utf8')).document;
}

async function extractImages(url, options = {}) {
  return withCapture(url, options, 'browser', page => {
    const document = pageDocument(page);
    const base = documentBase(document, pageMetadata(page).finalUrl);
    const images = [];
    const seen = new Set();
    for (const image of document.querySelectorAll('img[src], img[data-src]')) {
      const target = httpUrl(image.getAttribute('src') || image.getAttribute('data-src'), base);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      images.push({ url: target, alt: image.getAttribute('alt') || '' });
    }
    return { ...pageMetadata(page), images };
  });
}

const socialDomains = {
  facebook: ['facebook.com'], x: ['x.com', 'twitter.com'], youtube: ['youtube.com', 'youtu.be'],
  instagram: ['instagram.com'], vimeo: ['vimeo.com'], tiktok: ['tiktok.com'], reddit: ['reddit.com'],
  linkedin: ['linkedin.com'], threads: ['threads.com', 'threads.net'], twitch: ['twitch.tv'], github: ['github.com'],
};

async function extractSocialLinks(url, options = {}) {
  return withCapture(url, options, 'browser', page => {
    const document = pageDocument(page);
    const base = documentBase(document, pageMetadata(page).finalUrl);
    const links = [];
    const seen = new Set();
    for (const link of document.querySelectorAll('a[href], area[href]')) {
      const target = httpUrl(link.getAttribute('href'), base);
      if (!target || seen.has(target)) continue;
      const host = new URL(target).hostname;
      const platform = Object.keys(socialDomains).find(name => socialDomains[name].some(domain => host === domain || host.endsWith(`.${domain}`)));
      if (!platform) continue;
      seen.add(target);
      links.push({ platform, url: target });
    }
    return { ...pageMetadata(page), links };
  });
}

async function extractSocialInsights(url, options = {}) {
  return withCapture(url, options, 'browser', async page => {
    const finalUrl = pageMetadata(page).finalUrl;
    const vendor = discoverVendors().find(vendor => vendor.matches(finalUrl) && typeof vendor.followerCount === 'function');
    if (!vendor) throw new FetcharyValidationError('social insights require a supported social profile URL', { url: finalUrl });
    let followers = await vendor.followerCount(pageDocument(page), finalUrl);
    if (followers == null && page.renderedHtml != null && vendor.matches(page.rawFinalUrl) && typeof vendor.followerCountFromRaw === 'function') {
      followers = await vendor.followerCountFromRaw(parseHTML(page.rawBody.toString('utf8')).document, page.rawFinalUrl, finalUrl);
    }
    return { ...pageMetadata(page), vendor: vendor.name, followers: Number.isSafeInteger(followers) && followers >= 0 ? followers : null };
  });
}

const extractSocialAvatar = extractProfilePicture;

function clearCache() { sharedCaptureCache.clear(); }

function createExtractor(options = {}) {
  const settings = extractionOptions(options);
  const cache = createCaptureCache({ maxEntries: options.maxEntries, maxCacheBytes: options.maxCacheBytes });
  // Copy mutable configuration. Per-call settings never change these defaults.
  const defaults = { ...options, headers: settings.headers, [clientCache]: cache };
  const client = { clearCache: () => cache.clear() };
  for (const [name, method] of Object.entries({ extract, extractText, extractHtml, extractFavicon, extractImages, extractSocialLinks, extractSocialAvatar, extractProfilePicture, extractSocialInsights })) {
    client[name] = (url, overrides = {}) => method(url, { ...defaults, ...overrides, [clientCache]: cache });
  }
  client.extractSelector = (url, selector, overrides = {}) => extractSelector(url, selector, { ...defaults, ...overrides, [clientCache]: cache });
  return client;
}

module.exports = { extract, extractText, extractHtml, extractFavicon, extractImages, extractSelector, extractSocialLinks,
  extractSocialAvatar, extractProfilePicture, extractSocialInsights, createExtractor, clearCache };
