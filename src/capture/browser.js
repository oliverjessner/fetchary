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

      try {
        await new Promise(resolve => setTimeout(resolve, options.waitAfterLoadMs));
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
