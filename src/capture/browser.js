'use strict';

const { FetcharyBrowserError } = require('../errors');
const { discoverVendors, prepareVendorPage, dismissVendorOverlays } = require('../vendors');

function browserError(message, options, cause, phase) {
  if (cause instanceof FetcharyBrowserError) return cause;
  return new FetcharyBrowserError(message, {
    sourceId: options.sourceId,
    url: options.url,
    phase,
    cause,
  });
}

async function waitAfterLoad(page, options, vendors) {
  const dismissedOverlays = [];
  const deadline = Date.now() + options.waitAfterLoadMs;
  do {
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
  }

  async _getBrowser(options) {
    if (!this.browserPromise) {
      this.browserPromise = Promise.resolve()
        .then(() => this.launch({ headless: true }))
        .catch(cause => {
          this.browserPromise = null;
          throw browserError('could not launch Chromium', options, cause, 'launch');
        });
    }
    return this.browserPromise;
  }

  async capture(options) {
    const vendors = this.getVendors();
    const browser = await this._getBrowser(options);
    let page;
    let navigation;
    try {
      try {
        page = await browser.newPage();
        if (options.userAgent && typeof page.setUserAgent === 'function') await page.setUserAgent(options.userAgent);
        if (options.headers && typeof page.setExtraHTTPHeaders === 'function') {
          const headers = new Headers(options.headers);
          headers.delete('user-agent'); // setUserAgent (and vendor preparation) owns this header.
          await page.setExtraHTTPHeaders(Object.fromEntries(headers));
        }
        await prepareVendorPage(page, options.url, vendors);
        navigation = await page.goto(options.url, { waitUntil: 'load', timeout: options.timeout });
        if (navigation && navigation.status() >= 400) throw new Error(`HTTP ${navigation.status()}`);
      } catch (cause) {
        throw browserError(`browser navigation failed for ${options.url}`, options, cause, 'navigation');
      }

      let dismissedOverlays;
      try {
        dismissedOverlays = await waitAfterLoad(page, options, vendors);
      } catch (cause) {
        throw browserError(`post-load wait failed for ${options.url}`, options, cause, 'post-load-wait');
      }

      let renderedHtml;
      let browserFinalUrl;
      try {
        renderedHtml = await page.content();
        if (typeof renderedHtml !== 'string' || !renderedHtml.trim()) throw new Error('invalid rendered HTML snapshot');
        browserFinalUrl = typeof page.url === 'function' ? page.url() : options.url;
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
      if (page) {
        try { await page.close(); } catch {}
      }
    }
  }

  async close() {
    const promise = this.browserPromise;
    this.browserPromise = null;
    if (!promise) return;
    try {
      const browser = await promise;
      await browser.close();
    } catch {}
  }
}

module.exports = { BrowserCapture };
