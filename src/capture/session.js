'use strict';

const { CaptureManager } = require('./index');

// Share work for one analysis even when cache reuse is disabled by cacheTtlMs:
// 0, credentials, or an AbortSignal. Independent analyses own their cancellation.
function createCaptureSession(url, settings) {
  const manager = new CaptureManager({ ...settings, passiveTrackerCapture: true });
  let http; let browser; let page;
  const source = { url, waitAfterLoadMs: settings.waitAfterLoadMs };
  return {
    get page() { return page; },
    capture(request) {
      http ||= manager.capture({ ...source, captureMode: 'http' }).then(snapshot => { page = snapshot; return snapshot; });
      if (request.captureMode !== 'browser') return http;
      browser ||= http.then(httpCapture => manager.capture({ ...source, captureMode: 'browser', httpCapture }))
        .then(snapshot => { page = snapshot; return snapshot; });
      return browser;
    },
    close: () => manager.close(),
  };
}

module.exports = { createCaptureSession };
