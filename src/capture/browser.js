'use strict';

const { validateRemoteUrl } = require('../utils/url');
const { readResource, abortable } = require('./http');
const { FetcharyBrowserError } = require('../errors');
const { discoverVendors, prepareVendorPage, dismissVendorOverlays } = require('../vendors');

function browserError(message, options, cause, phase) {
  if (cause instanceof FetcharyBrowserError) return cause;
  // Report bounded-resource failures without echoing subresource URLs, which
  // can contain signed query strings or other credentials.
  let failure = cause;
  for (let depth = 0; failure && depth < 8; depth++, failure = failure.cause) {
    if (/^(?:response|rendered HTML) exceeds maxResponseBytes/.test(failure.message || '')) {
      message += `: ${phase === 'resource' ? 'browser resource' : 'response or rendered HTML'} exceeds maxResponseBytes (${options.maxResponseBytes} bytes); increase --max-response-bytes (library: maxResponseBytes)`;
      break;
    }
    if (failure.message === 'browser resource budget exceeded') {
      message += `: browser resource budget exceeded (${options.maxResponseBytes * 4} bytes)`;
      break;
    }
  }
  return new FetcharyBrowserError(message, {
    url: options.url,
    phase,
    status: cause?.status,
    cause,
  });
}

async function waitAfterLoad(page, options, vendors) {
  const dismissedOverlays = [];
  const deadline = Date.now() + options.waitAfterLoadMs;
  do {
    options.signal?.throwIfAborted();
    const currentUrl = typeof page.url === 'function' ? page.url() : options.url;
    const dismissed = await dismissVendorOverlays(page, currentUrl, dismissedOverlays, vendors);
    dismissedOverlays.push(...dismissed);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining)));
  } while (true);
  return dismissedOverlays;
}

class BrowserCapture {
  constructor(options = {}) {
    this.getVendors = options.getVendors || discoverVendors;
    this.launch = options.launch || (async launchOptions => {
      const puppeteer = require('puppeteer');
      return puppeteer.launch(launchOptions);
    });
    this.browserPromise = null;
    this.browser = null;
  }

  async _getBrowser(options) {
    if (!this.browserPromise) {
      this.browserPromise = Promise.resolve()
        .then(() => this.launch({ headless: true, timeout: options.timeout, signal: options.signal, args: ['--disable-background-networking', '--disable-quic', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] }))
        .then(browser => { this.browser = browser; return browser; })
        .catch(cause => {
          this.browserPromise = null;
          throw browserError('could not launch Chromium', options, cause, 'launch');
        });
    }
    return this.browserPromise;
  }

  async capture(options) {
    const vendors = options.passiveTrackerCapture ? [] : this.getVendors();
    await validateRemoteUrl(options.url, options);
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new Error('browser capture timed out')), options.timeout + options.waitAfterLoadMs);
    const abort = () => { page?.close().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    let requestError;
    let transferred = 0;
    const activeRequests = new Set();
    let page;
    let cookieContext;
    let navigation;
    let suppliedDocument = false;
    const checkRequestErrors = () => {
      if (requestError) throw browserError(`browser resource request failed for ${options.url}`, options, requestError, 'resource');
    };
    try {
      signal.throwIfAborted();
      const browser = await abortable(this._getBrowser(options), signal).catch(cause => {
        throw browserError('could not launch Chromium', options, cause, 'launch');
      });
      try {
        if (options.cookieJar) {
          try {
            if (typeof browser.createBrowserContext !== 'function') throw new Error();
            cookieContext = await abortable(browser.createBrowserContext(), signal);
            if (typeof cookieContext.setCookie !== 'function') throw new Error();
            await abortable(cookieContext.setCookie(...options.cookieJar.browserCookies()), signal);
          } catch {
            // Protocol errors may serialize the credentials passed to Chromium.
            throw new FetcharyBrowserError(`could not import ${options.session ? 'saved session' : options.cookiesFromBrowser ? 'browser cookies' : 'cookieFile'} into the browser context`, {url:options.url, phase:'cookies'});
          }
        }
        page = await abortable((cookieContext || browser).newPage(), signal);
        if (options.userAgent && typeof page.setUserAgent === 'function') await page.setUserAgent(options.userAgent);
        if (typeof page.setRequestInterception === 'function') {
          await page.setRequestInterception(true);
          page.on('request', request => {
            const task = (async () => {
              try {
                if (options.passiveTrackerCapture) {
                  // Render only the captured document. No scripts, pixels,
                  // beacons, child navigations or other resources reach HTTP.
                  if (suppliedDocument || !request.isNavigationRequest() || request.url() !== options.url) return await request.abort();
                  suppliedDocument = true;
                  return await request.respond({ status: options.documentSnapshot.status, body: options.documentSnapshot.rawBody,
                    headers: { 'content-type': options.documentSnapshot.contentType || 'text/html',
                      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'" } });
                }
                if (!/^https?:/.test(request.url())) {
                  if (request.isNavigationRequest()) throw new Error('unsupported navigation scheme');
                  return await request.abort();
                }
                const headersForRequest = new Headers(request.headers());
                if (new URL(request.url()).origin === new URL(options.url).origin) {
                  for (const [name, value] of new Headers(options.headers)) headersForRequest.set(name, value);
                }
                const resource = await readResource(request.url(), { ...options, signal, followRedirects: false,
                  cookieHeaderFromBrowser: true, headers: Object.fromEntries(headersForRequest), method: request.method(), body: request.postData() }, options.maxResponseBytes);
                transferred += resource.body.length;
                if (transferred > options.maxResponseBytes * 4) {
                  const error = new Error('browser resource budget exceeded');
                  controller.abort(error);
                  throw error;
                }
                const headers = Object.fromEntries(resource.headers);
                delete headers['content-encoding']; delete headers['content-length']; delete headers['transfer-encoding'];
                await request.respond({ status: resource.status, headers, body: resource.body });
              } catch (error) {
                requestError ||= error;
                await request.abort().catch(() => {});
              }
            })();
            activeRequests.add(task);
            task.finally(() => activeRequests.delete(task)).catch(() => {});
          });
        } else if (options.passiveTrackerCapture || !options.allowPrivateNetwork) throw new Error('browser implementation must support guarded request interception');
        await prepareVendorPage(page, options.url, vendors);
        navigation = await abortable(page.goto(options.url, { waitUntil: 'load', timeout: options.timeout }), signal);
        if (navigation && navigation.status() >= 400) {
          const error = new Error(`HTTP ${navigation.status()}`);
          error.status = navigation.status();
          throw error;
        }
      } catch (cause) {
        throw browserError(`browser navigation failed for ${options.url}`, options, cause, 'navigation');
      }

      checkRequestErrors();
      let dismissedOverlays;
      try {
        dismissedOverlays = await abortable(waitAfterLoad(page, { ...options, signal }, vendors), signal);
      } catch (cause) {
        throw browserError(`post-load wait failed for ${options.url}`, options, cause, 'post-load-wait');
      }

      let renderedHtml;
      let browserFinalUrl;
      try {
        signal.throwIfAborted();
        checkRequestErrors();
        renderedHtml = await abortable(page.content(), signal);
        if (Buffer.byteLength(renderedHtml) > options.maxResponseBytes) throw new Error('rendered HTML exceeds maxResponseBytes');
        if (typeof renderedHtml !== 'string' || !renderedHtml.trim()) throw new Error('invalid rendered HTML snapshot');
        browserFinalUrl = typeof page.url === 'function' ? page.url() : options.url;
        await validateRemoteUrl(browserFinalUrl, options);
      } catch (cause) {
        throw browserError(`could not snapshot rendered DOM for ${options.url}`, options, cause, 'snapshot');
      }
      return {
        renderedHtml,
        browserFinalUrl,
        renderedCapturedAt: new Date().toISOString(),
        dismissedOverlays,
        cacheable: navigation?.status?.() !== 206 && !navigation?.headers?.()['set-cookie']
          && !/\b(?:private|no-store|no-cache)\b/i.test(navigation?.headers?.()['cache-control'] || ''),
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.abort();
      if (page) {
        try { await page.close(); } catch {}
      }
      if (cookieContext) {
        try { await cookieContext.close(); } catch {}
      }
      await Promise.allSettled([...activeRequests]);
    }
  }

  async close() {
    const promise = this.browserPromise;
    const browser = this.browser;
    this.browserPromise = null;
    this.browser = null;
    if (browser) {
      try { await browser.close(); } catch {}
    } else if (promise) {
      // A custom launcher may ignore cancellation. Close a late result without
      // making the already aborted extraction wait for an unresolved launcher.
      promise.then(late => late.close()).catch(() => {});
    }
  }
}

module.exports = { BrowserCapture };
