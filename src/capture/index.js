'use strict';

const { captureHttp } = require('./http');
const { BrowserCapture } = require('./browser');

function shouldRender(contentType) {
  if (!contentType) return true;
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'text/html' || mediaType === 'application/xhtml+xml';
}

class CaptureManager {
  constructor(options) {
    this.httpFetch = options.fetch;
    this.timeout = options.timeout;
    this.userAgent = options.userAgent;
    this.browser = new BrowserCapture({ launch: options.launchBrowser });
  }

  async capture(source) {
    const http = await captureHttp({
      url: source.url,
      sourceId: source.id,
      fetch: this.httpFetch,
      timeout: this.timeout,
      userAgent: this.userAgent,
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
      url: source.url,
      sourceId: source.id,
      timeout: this.timeout,
      waitAfterLoadMs: source.waitAfterLoadMs,
    });
    return { ...http, ...rendered, captureMode: 'browser' };
  }

  async close() {
    await this.browser.close();
  }
}

module.exports = { CaptureManager, shouldRender };
