'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { BrowserCapture } = require('../src/capture/browser');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/consent', `${name}.html`), 'utf8');

async function serve(t, handle) {
  const server = http.createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

for (const complete of [true, false]) test(complete
  ? 'accept preserves multiple response cookies and completes a cross-origin CMP redirect'
  : 'an acceptance message without all required cookies is failed and never cacheable', async t => {
  const requests = [];
  const decisions = [];
  const cmpOrigin = await serve(t, (request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fixture('accept-cookie-frame'));
  });
  const origin = await serve(t, async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    requests.push({ pathname, cookie: request.headers.cookie });
    if (pathname === '/consent/decision') {
      let body = '';
      for await (const chunk of request) body += chunk;
      decisions.push(JSON.parse(body));
      const expires = new Date(Date.now() + 86400000).toUTCString();
      response.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': [
        `consent_date=recorded; Path=/; SameSite=Lax; Expires=${expires}`,
        ...(complete ? [`consent=accepted; Path=/; SameSite=Lax; Expires=${expires}`] : []),
      ] });
      return response.end('saved');
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (pathname === '/editorial' && /(?:^|; )consent=accepted(?:;|$)/.test(request.headers.cookie || '')
      && /(?:^|; )consent_date=recorded(?:;|$)/.test(request.headers.cookie || '')) return response.end(fixture('editorial'));
    response.end(fixture('accept-cookie-redirect').replaceAll('__CMP_ORIGIN__', cmpOrigin));
  });
  const capture = new BrowserCapture();
  t.after(() => capture.close());
  const result = await capture.capture({
    url: `${origin}/consent/`, consent: 'accept', timeout: 7000, waitAfterLoadMs: 1000,
    maxResponseBytes: 2 * 1024 * 1024, allowPrivateNetwork: true, userAgent: 'fetchary/consent-test',
  });
  assert.deepEqual(decisions, [{ trusted: true, crossOrigin: 'true', steps: 1 }]);
  assert.equal(result.consent.detected, true);
  assert.equal(result.consent.provider, 'sourcepoint');
  assert.equal(result.consent.action, 'accept');
  if (!complete) {
    assert.equal(result.consent.status, 'failed');
    assert.equal(result.cacheable, false);
    assert.equal(new URL(result.browserFinalUrl).pathname, '/consent/');
    assert.match(result.renderedHtml, /Zustimmung erteilt/);
    assert.equal(requests.some(request => request.pathname === '/editorial'), false);
    return;
  }
  assert.equal(result.consent.status, 'handled');
  assert.equal(new URL(result.browserFinalUrl).pathname, '/editorial');
  assert.match(result.renderedHtml, /Researchers publish a new climate observation/);
  assert.doesNotMatch(result.renderedHtml, /Zustimmung erteilt/);
  const destination = requests.find(request => request.pathname === '/editorial');
  assert.ok(destination, 'the website must finish its own redirect after its consent cookies are available');
  assert.match(destination.cookie, /(?:^|; )consent=accepted(?:;|$)/);
  assert.match(destination.cookie, /(?:^|; )consent_date=recorded(?:;|$)/);
});
