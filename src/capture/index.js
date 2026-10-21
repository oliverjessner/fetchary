'use strict';

const { captureHttp } = require('./http');
const { BrowserCapture } = require('./browser');
const { createCaptureCache, validateCacheTtl } = require('./cache');
const { validateRemoteUrl } = require('../utils/url');

const sharedCaptureCache = createCaptureCache();
const identities = new WeakMap();
let nextIdentity = 0;
function identity(value) {
  if (value == null) return null;
  if (!identities.has(value)) identities.set(value, ++nextIdentity);
  return identities.get(value);
}

function cacheableCapture(page) {
  if (page.cacheable === false || !Number.isInteger(page.status) || page.status < 200 || page.status >= 300 || page.status === 206) return false;
  for (const [html, url] of [[page.rawBody.toString('utf8'), page.rawFinalUrl], [page.renderedHtml, page.browserFinalUrl]]) {
    if (url && /\/(?:login|signin|authwall|checkpoint)(?:\/|$)/i.test(new URL(url).pathname)) return false;
    if (html == null) continue;
    if (shouldRender(page.contentType) && !/<[a-z!][\s\S]*>/i.test(html)) return false;
    // Recognizable interstitials are returned normally, but never retained.
    if (/<title[^>]*>\s*(?:just a moment|[^<]*(?:captcha|sign in|log in|access denied|verify you are human))\b/i.test(html)
      || /(?:\b(?:g-recaptcha|h-captcha|cf-turnstile|cf-chl-|captcha-container)\b|id=["']challenge-form|\/cdn-cgi\/challenge-platform\/|<input\b[^>]*type\s*=\s*["']?password\b|<input\b[^>]*name\s*=\s*["']?js_challenge\b)/i.test(html)) return false;
  }
  return true;
}

function shouldRender(contentType) {
  if (!contentType) return true;
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'text/html' || mediaType === 'application/xhtml+xml';
}

class CaptureManager {
  constructor(options) {
    this.options = options;
    this.httpFetch = options.fetch;
    this.timeout = options.timeout;
    this.userAgent = options.userAgent;
    this.browserUserAgent = options.browserUserAgent;
    this.headers = options.headers;
    this.cache = options.captureCache || sharedCaptureCache;
    this.cacheTtlMs = validateCacheTtl(options.cacheTtlMs);
    this.browserIdentity = options.launchBrowser;
    this.vendorIdentity = options.getVendors;
    this.browser = new BrowserCapture({ launch: options.launchBrowser, getVendors: options.getVendors });
  }

  async capture(source) {
    this.options.signal?.throwIfAborted();
    const { url } = await validateRemoteUrl(source.url, this.options);
    const headers = new Headers(this.headers);
    headers.set('user-agent', this.userAgent);
    // Explicit credentials bypass the global cache. Private clients can retain
    // header-authenticated snapshots, keyed by their complete request headers.
    const sensitive = url.username || url.password || [...headers.keys()].some(name => ['authorization', 'cookie', 'proxy-authorization'].includes(name));
    const ttlMs = this.options.signal || this.options.cookieJar ? 0 : sensitive && this.cache === sharedCaptureCache ? 0 : this.cacheTtlMs;
    const key = JSON.stringify([
      url.href, source.captureMode, [...headers.entries()].sort(), this.timeout,
      identity(this.httpFetch), identity(this.browserIdentity), identity(this.vendorIdentity),
      this.options.maxResponseBytes, Boolean(this.options.allowPrivateNetwork), this.options.insecure !== false, identity(this.options.lookup),
      source.captureMode === 'browser' ? [source.waitAfterLoadMs, this.browserUserAgent, Boolean(this.options.passiveTrackerCapture)] : null,
    ]);
    const page = await this.cache.capture(key, ttlMs, async () => {
      const snapshot = await this._capture({ ...source, url: url.href });
      await validateRemoteUrl(snapshot.rawFinalUrl, this.options);
      if (snapshot.browserFinalUrl) await validateRemoteUrl(snapshot.browserFinalUrl, this.options);
      return { ...snapshot, cacheable: ttlMs > 0 && cacheableCapture(snapshot) };
    });
    // Validation is intentionally repeated on hits as well as network captures.
    await validateRemoteUrl(page.rawFinalUrl, this.options);
    if (page.browserFinalUrl) await validateRemoteUrl(page.browserFinalUrl, this.options);
    return page;
  }

  async _capture(source) {
    const http = source.httpCapture || await captureHttp({
      ...this.options,
      url: source.url,
      fetch: this.httpFetch,
      timeout: this.timeout,
      userAgent: this.userAgent,
      headers: this.headers,
    });
    if (source.captureMode !== 'browser' || !shouldRender(http.contentType)) {
      return {
        ...http,
        renderedHtml: null,
        browserFinalUrl: null,
        renderedCapturedAt: null,
        dismissedOverlays: [],
        captureMode: 'http',
      };
    }
    const rendered = await this.browser.capture({
      ...this.options,
      url: this.options.passiveTrackerCapture ? http.rawFinalUrl.split('#')[0] : source.url,
      documentSnapshot: this.options.passiveTrackerCapture ? http : undefined,
      timeout: this.timeout,
      waitAfterLoadMs: source.waitAfterLoadMs,
      userAgent: this.browserUserAgent,
      headers: this.headers,
    });
    return { ...http, ...rendered, cacheable: http.cacheable && rendered.cacheable, captureMode: 'browser' };
  }

  async close() {
    await this.browser.close();
  }
}

module.exports = { CaptureManager, shouldRender, sharedCaptureCache };
