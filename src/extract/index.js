'use strict';

const { parseHTML } = require('linkedom');
const { CaptureManager, shouldRender, sharedCaptureCache } = require('../capture');
const { createCaptureCache, validateCacheTtl } = require('../capture/cache');
const { validateUrl } = require('../utils/url');
const { parseWaitAfterLoad, validateSelectors } = require('../utils/options');
const { selectHtml, selectText, htmlToText } = require('../utils/html');
const { classifyUrl, sameEntity, domains } = require('../utils/social');
const { discoverVendors } = require('../vendors');
const { FetcharyValidationError, FetcharyNotFoundError, FetcharyFetchError, FetcharyBrowserError } = require('../errors');
const { httpUrl, documentBase, readResource, selectImage } = require('./images');
const { imageLinks } = require('./image-links');
const { socialLinks } = require('./social-links');
const { insightBuilder } = require('../metrics/insights');

const clientCache = Symbol('captureCache');
const types = ['text','html','favicon','images','avatar','selector','social-links','social-insights'];

function extractionOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new FetcharyValidationError('options must be an object');
  for (const name of ['method','body','followRedirects','getVendors']) if (Object.hasOwn(options, name)) throw new FetcharyValidationError(`${name} is not an extraction option`);
  const settings = {
    fetch: options.fetch, launchBrowser: options.launchBrowser, headers: options.headers, signal: options.signal,
    lookup: options.lookup, allowPrivateNetwork: options.allowPrivateNetwork,
    timeout: options.timeout ?? 30_000, userAgent: options.userAgent ?? 'fetchary/2.0',
    browserUserAgent: options.userAgent ?? 'fetchary/2.0', mode: options.mode ?? 'auto',
    waitAfterLoadMs: parseWaitAfterLoad(options.waitAfterLoad), maxResponseBytes: options.maxResponseBytes ?? 10 * 1024 * 1024,
    cacheTtlMs: validateCacheTtl(options.cacheTtlMs), captureCache: options[clientCache],
  };
  if (!['auto','http','browser'].includes(settings.mode)) throw new FetcharyValidationError('mode must be auto, http or browser');
  for (const name of ['fetch','launchBrowser','lookup']) if (settings[name] !== undefined && typeof settings[name] !== 'function') throw new FetcharyValidationError(`${name} must be a function`);
  if (!Number.isFinite(settings.timeout) || settings.timeout <= 0) throw new FetcharyValidationError('timeout must be greater than zero');
  if (!Number.isSafeInteger(settings.maxResponseBytes) || settings.maxResponseBytes < 1) throw new FetcharyValidationError('maxResponseBytes must be a positive safe integer');
  if (typeof settings.userAgent !== 'string' || !settings.userAgent.trim()) throw new FetcharyValidationError('userAgent must be a non-empty string');
  for (const name of ['allowPrivateNetwork','unique','includeMetadata','all','binary']) if (options[name] !== undefined && typeof options[name] !== 'boolean') throw new FetcharyValidationError(`${name} must be a boolean`);
  if (settings.signal !== undefined && !(settings.signal instanceof AbortSignal)) throw new FetcharyValidationError('signal must be an AbortSignal');
  try { if (settings.headers !== undefined) settings.headers = Object.fromEntries(new Headers(settings.headers)); } catch (cause) { throw new FetcharyValidationError('invalid request headers', { cause }); }
  return settings;
}

function pageMetadata(page) {
  return { requestedUrl: page.requestedUrl, finalUrl: page.browserFinalUrl || page.rawFinalUrl, rawFinalUrl: page.rawFinalUrl,
    capturedAt: page.renderedCapturedAt || page.rawCapturedAt, extractedAt: new Date().toISOString(), status: page.status,
    contentType: page.contentType, captureMode: page.captureMode, dismissedOverlays: [...page.dismissedOverlays], cache: { ...page.cache } };
}
function pageHtml(page) { return page.renderedHtml ?? page.rawHtml ?? page.rawBody.toString('utf8'); }
function pageDocument(page) { return parseHTML(pageHtml(page)).document; }

function accessStatus(page) {
  const document = pageDocument(page);
  const title = document.querySelector('title')?.textContent || '';
  if (/captcha|just a moment|access denied|verify.*human|attention required/i.test(title)
    || document.querySelector('[id^="cf-chl-"], #challenge-form, .g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="captcha"]')) return 'blocked';
  const pathname = new URL(pageMetadata(page).finalUrl).pathname;
  if (/\/(?:login|signin|authwall|checkpoint|accounts\/login)(?:\/|$)/i.test(pathname)
    || /^(?:sign in|log in|login required|sign up)/i.test(title) || document.querySelector('input[type="password"]')) return 'login_required';
  return null;
}

function fallbackNeeded(page, result, type) {
  if (!shouldRender(page.contentType) || accessStatus(page)) return false;
  const html = pageHtml(page);
  const scripts = /<script\b/i.test(html);
  if (type === 'social-insights') return ['unavailable','partial'].includes(result.data.status) && scripts;
  if (type === 'selector') return !result.data.matched && scripts;
  if (type === 'images' || type === 'social-links') return result.data.length === 0 && scripts;
  const document = pageDocument(page);
  const text = htmlToText((document.body || document).toString());
  return scripts && (!text || /id=["'](?:root|app|__next)["']/i.test(html) && text.length < 40);
}

async function withCapture(url, options, type, operation) {
  const requestedUrl = validateUrl(url);
  const settings = extractionOptions(options);
  settings.headerOrigin = new URL(requestedUrl).origin;
  settings.scopedHeaderNames = Object.keys(settings.headers || {}).filter(name => name !== 'user-agent');
  const capture = new CaptureManager(settings);
  let page;
  try {
    const source = { url: requestedUrl, captureMode: settings.mode === 'browser' ? 'browser' : 'http', waitAfterLoadMs: settings.waitAfterLoadMs };
    page = await capture.capture(source);
    let result;
    try { result = await operation(page, settings); } catch (error) {
      if (!(error instanceof FetcharyNotFoundError) || settings.mode !== 'auto' || !shouldRender(page.contentType) || accessStatus(page)) throw error;
    }
    if (settings.mode === 'auto' && (!result || fallbackNeeded(page, result, type))) {
      page = await capture.capture({ ...source, captureMode: 'browser', httpCapture: page });
      result = await operation(page, settings);
    }
    settings.signal?.throwIfAborted();
    return { ...pageMetadata(page), type, ...result };
  } catch (error) {
    if (settings.signal?.aborted) throw new FetcharyFetchError('extraction aborted', { url: requestedUrl, cause: settings.signal.reason });
    throw error;
  } finally { await capture.close(); }
}

function textOrHtml(url, options, type) {
  extractionOptions(options);
  const includeSelectors = validateSelectors(options.includeSelectors ?? [], 'include');
  const ignoreSelectors = validateSelectors(options.ignoreSelectors ?? [], 'ignore');
  return withCapture(url, options, type, page => {
    const html = pageHtml(page);
    const content = shouldRender(page.contentType) ? (type === 'text' ? selectText : selectHtml)(html, { includeSelectors, ignoreSelectors }) : html;
    return { data: content, content, format: type };
  });
}
async function extractText(url, options = {}) { return textOrHtml(url, options, 'text'); }
async function extractHtml(url, options = {}) { return textOrHtml(url, options, 'html'); }
async function extractFavicon(url, options = {}) {
  return withCapture(url, options, 'favicon', async (page, settings) => {
    const candidates = [];
    const manifests = new Set();
    const documents = [{ html: page.rawHtml ?? page.rawBody.toString('utf8'), url: page.rawFinalUrl }];
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
    const selected = await selectImage(candidates, settings, options.binary === true);
    if (!selected) throw new FetcharyNotFoundError('no accessible favicon found', { url: page.requestedUrl });
    const { body, ...image } = selected;
    return { data: options.binary ? body : image, image };
  });
}

async function extractProfilePicture(url, options = {}) {
  const requestedUrl = validateUrl(url);
  const vendors = discoverVendors().filter(vendor => typeof vendor.profilePicture === 'function');
  if (!vendors.some(vendor => vendor.matches(requestedUrl))) {
    throw new FetcharyValidationError('profile pictures require a supported social profile URL', { url: requestedUrl });
  }
  return withCapture(requestedUrl, options, 'avatar', async (page, settings) => {
    const vendor = vendors.find(vendor => vendor.matches(requestedUrl));
    if (!vendor.matches(page.rawFinalUrl)) throw new FetcharyNotFoundError('the page redirected outside the supported social platform');
    const raw = vendor.profilePicture(parseHTML(page.rawHtml ?? page.rawBody.toString('utf8')).document, page.rawFinalUrl);
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
    const profile = rendered?.profile || raw?.profile;
    return { data: { platform: vendor.name, profile, image }, vendor: vendor.name, platform: vendor.name, profile, image };
  });
}


async function extractSelector(url, options = {}, legacyOptions = {}) {
  if (typeof options !== 'string') extractionOptions(options);
  if (typeof options === 'string') options = { ...legacyOptions, selector: options };
  const [selector] = validateSelectors([options.selector], 'include');
  const format = options.format ?? 'text';
  if (!['text','html'].includes(format)) throw new FetcharyValidationError('format must be text or html');
  if (options.attribute !== undefined && (typeof options.attribute !== 'string' || !options.attribute.trim())) throw new FetcharyValidationError('attribute must be a non-empty string');
  return withCapture(url, options, 'selector', page => {
    const document = pageDocument(page);
    const matches = options.all ? [...document.querySelectorAll(selector)] : [document.querySelector(selector)].filter(Boolean);
    const values = matches.map(element => options.attribute ? element.getAttribute(options.attribute) : format === 'html' ? element.outerHTML : htmlToText(element.outerHTML));
    return { data: { matched: matches.length > 0, values }, content: values.filter(value => value !== null).join('\n'), format };
  });
}
async function extractImages(url, options = {}) {
  return withCapture(url, options, 'images', page => { const data = imageLinks(pageDocument(page), pageMetadata(page).finalUrl, options); return { data, images: data }; });
}
async function extractSocialLinks(url, options = {}) {
  extractionOptions(options);
  if (options.platform !== undefined && !Object.hasOwn(domains, options.platform === 'twitter' ? 'x' : options.platform)) throw new FetcharyValidationError('unsupported social platform');
  return withCapture(url, options, 'social-links', page => { const data = socialLinks(pageDocument(page), pageMetadata(page).finalUrl, options); return { data, links: data }; });
}
async function extractSocialInsights(url, options = {}) {
  return withCapture(url, options, 'social-insights', page => {
    const finalUrl = pageMetadata(page).finalUrl;
    const insightUrl = classifyUrl(page.requestedUrl).kind === 'unknown' ? finalUrl : page.requestedUrl;
    const requested = classifyUrl(insightUrl);
    const document = pageDocument(page);
    let data;
    const blocked = accessStatus(page);
    let mismatch = requested.id !== null && !sameEntity(insightUrl, finalUrl);
    const canonical = httpUrl(document.querySelector('link[rel="canonical"]')?.getAttribute('href') || document.querySelector('meta[property="og:url"]')?.getAttribute('content'), finalUrl);
    if (canonical && !sameEntity(canonical, insightUrl)) {
      // YouTube /@handle and /channel/id aliases are accepted only when both
      // captured URLs are channels; raw requests and redirects still agree.
      const alias = requested.platform === 'youtube' && requested.kind === 'channel'
        && new URL(insightUrl).pathname.startsWith('/@') && /^\/channel\//.test(new URL(canonical).pathname)
        && classifyUrl(canonical).platform === 'youtube';
      if (!alias) mismatch = true;
    }
    const vendor = discoverVendors().find(vendor => vendor.name === requested.platform);
    if (blocked || mismatch || !vendor?.socialInsights) {
      data = insightBuilder(insightUrl).finish(blocked || (mismatch ? 'unavailable' : 'unsupported'));
      if (mismatch && !blocked) data.unavailable = Object.fromEntries(Object.keys(data.metrics).map(name => [name, 'identity_mismatch']));
    } else {
      try { data = vendor.socialInsights(document, insightUrl, { finalUrl }); } catch {
        data = insightBuilder(insightUrl).finish('extraction_error');
      }
    }
    if (blocked === 'login_required' && vendor?.followerCountFromRaw && sameEntity(page.rawFinalUrl, insightUrl)) {
      const count = vendor.followerCountFromRaw(parseHTML(page.rawHtml ?? page.rawBody.toString('utf8')).document, page.rawFinalUrl, finalUrl);
      if (count !== null) {
        const builder = insightBuilder(insightUrl, ['followers']);
        builder.set('followers', count, 'vendor', 'followerCountFromRaw', null);
        data = builder.finish('login_required');
      }
    } else if (page.renderedHtml != null && !blocked && !mismatch && vendor?.socialInsights && !['extraction_error','unsupported'].includes(data.status) && sameEntity(page.rawFinalUrl, insightUrl)) {
      const rawDocument = parseHTML(page.rawHtml ?? page.rawBody.toString('utf8')).document;
      const rawCanonical = httpUrl(rawDocument.querySelector('link[rel="canonical"]')?.getAttribute('href'), page.rawFinalUrl);
      if (!rawCanonical || sameEntity(rawCanonical, insightUrl)) {
        const raw = vendor.socialInsights(rawDocument, insightUrl);
        for (const [metric, value] of Object.entries(raw.metrics)) if (value !== null && data.metrics[metric] === null) {
          data.metrics[metric] = value;
          data.sources[metric] = { ...raw.sources[metric], field: `rawHTTP:${raw.sources[metric].field}` };
          delete data.unavailable[metric];
        }
        if (Object.values(data.metrics).some(value => value !== null)) data.status = Object.values(data.unavailable).every(reason => reason === 'unsupported') ? 'available' : 'partial';
      }
    }
    return { data, vendor: data.platform, followers: data.metrics.followers ?? data.metrics.subscribers };
  }).catch(error => {
    if (!(error instanceof FetcharyFetchError || error instanceof FetcharyBrowserError) || ![401,403,429].includes(error.status)) throw error;
    const requestedUrl = validateUrl(url);
    const data = insightBuilder(requestedUrl).finish(error.status === 401 ? 'login_required' : 'blocked');
    return { requestedUrl, finalUrl: requestedUrl, rawFinalUrl: requestedUrl, extractedAt: new Date().toISOString(), capturedAt: null,
      captureMode: error instanceof FetcharyBrowserError ? 'browser' : 'http', status: error.status, contentType: null, dismissedOverlays: [], cache: { hit: false, ageMs: 0, ttlMs: validateCacheTtl(options.cacheTtlMs) },
      type: 'social-insights', data, vendor: data.platform, followers: null };
  });
}
const extractSocialAvatar = extractProfilePicture;

async function extract(url, options = {}) {
  extractionOptions(options);
  const type = options.type ?? (options.format === 'text' ? 'text' : 'html');
  if (options.format !== undefined && !['text','html'].includes(options.format)) throw new FetcharyValidationError('format must be text or html');
  const methods = { text: extractText, html: extractHtml, favicon: extractFavicon, images: extractImages, avatar: extractSocialAvatar,
    selector: extractSelector, 'social-links': extractSocialLinks, 'social-insights': extractSocialInsights };
  if (!types.includes(type)) throw new FetcharyValidationError(`unknown extraction type: ${type}`);
  return methods[type](url, options);
}
function clearCache() { sharedCaptureCache.clear(); }
function createExtractor(options = {}) {
  const settings = extractionOptions(options);
  const cache = createCaptureCache({ maxEntries: options.maxEntries, maxCacheBytes: options.maxCacheBytes });
  const defaults = { ...options, headers: settings.headers };
  const client = { clearCache: () => cache.clear() };
  for (const [name, method] of Object.entries({ extract, extractText, extractHtml, extractFavicon, extractImages, extractSocialLinks, extractSocialAvatar, extractProfilePicture, extractSocialInsights })) client[name] = (url, overrides = {}) => method(url, { ...defaults, ...overrides, [clientCache]: cache });
  client.extractSelector = (url, selectorOrOptions = {}, overrides = {}) => typeof selectorOrOptions === 'string'
    ? extractSelector(url, { ...defaults, ...overrides, selector: selectorOrOptions, [clientCache]: cache })
    : extractSelector(url, { ...defaults, ...selectorOrOptions, [clientCache]: cache });
  return client;
}
module.exports = { extract, extractText, extractHtml, extractFavicon, extractImages, extractSelector, extractSocialLinks,
  extractSocialAvatar, extractProfilePicture, extractSocialInsights, createExtractor, clearCache };
