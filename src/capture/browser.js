'use strict';

const { FetcharyBrowserError } = require('../errors');

function browserError(message, options, cause, phase) {
  if (cause instanceof FetcharyBrowserError) return cause;
  return new FetcharyBrowserError(message, {
    sourceId: options.sourceId,
    url: options.url,
    phase,
    cause,
  });
}

function isThreadsUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'threads.com' || hostname.endsWith('.threads.com');
  } catch {
    return false;
  }
}

async function dismissThreadsCookieDialog(page, url) {
  if (!isThreadsUrl(url)) return null;
  try {
    return await page.evaluate(() => {
      const button = [...document.querySelectorAll('button, [role="button"]')].find(element => {
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        return text === 'Decline optional cookies';
      });
      if (!button) return null;
      button.click();
      return 'threads-cookie-consent';
    });
  } catch {
    return null;
  }
}

async function waitAfterLoad(page, options) {
  const dismissedOverlays = [];
  const deadline = Date.now() + options.waitAfterLoadMs;
  do {
    if (!dismissedOverlays.includes('threads-cookie-consent')) {
      const dismissed = await dismissThreadsCookieDialog(page, options.url);
      if (dismissed) dismissedOverlays.push(dismissed);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining)));
  } while (true);
  return dismissedOverlays;
}

class BrowserCapture {
  constructor(options = {}) {
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
    const browser = await this._getBrowser(options);
    let page;
    try {
      try {
        page = await browser.newPage();
        await page.goto(options.url, { waitUntil: 'load', timeout: options.timeout });
      } catch (cause) {
        throw browserError(`browser navigation failed for ${options.url}`, options, cause, 'navigation');
      }

      let dismissedOverlays;
      try {
        dismissedOverlays = await waitAfterLoad(page, options);
      } catch (cause) {
        throw browserError(`post-load wait failed for ${options.url}`, options, cause, 'post-load-wait');
      }

      let renderedHtml;
      let browserFinalUrl;
      try {
        renderedHtml = await page.content();
        browserFinalUrl = typeof page.url === 'function' ? page.url() : options.url;
      } catch (cause) {
        throw browserError(`could not snapshot rendered DOM for ${options.url}`, options, cause, 'snapshot');
      }
      return {
        renderedHtml,
        browserFinalUrl,
        renderedCapturedAt: new Date().toISOString(),
        dismissedOverlays,
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

module.exports = { BrowserCapture, dismissThreadsCookieDialog };
