'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const { BrowserCapture } = require('../src/capture/browser');
const { createExtractor } = require('../src');

const origin = 'https://news.example.test';
const editorialHeading = 'Researchers publish a new climate observation';
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/consent', `${name}.html`), 'utf8');
const response = html => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

function fixtureFetch(name, requests = []) {
  return async (url, options) => {
    const address = new URL(url);
    requests.push({ url: address.href, method: options?.method || 'GET' });
    if (address.hostname === 'consent.example.test') return response(fixture('sourcepoint-frame'));
    if (address.pathname === '/editorial') return response(fixture('editorial'));
    if (address.pathname === '/login') return response(fixture('access-login'));
    if (address.pathname === '/restricted') return response(fixture('access-denied'));
    return response(fixture(name));
  };
}

function captureOptions(name, options = {}) {
  return {
    url: `${origin}/${name}/`, timeout: 7000, waitAfterLoadMs: 350,
    maxResponseBytes: 2 * 1024 * 1024, allowPrivateNetwork: true,
    userAgent: 'fetchary/consent-test', fetch: fixtureFetch(name), ...options,
  };
}

function documentOf(result) { return parseHTML(result.renderedHtml).document; }

function assertHandled(result, provider, action = 'reject') {
  assert.equal(result.consent.detected, true);
  if (provider) assert.equal(result.consent.provider, provider);
  assert.equal(result.consent.action, action);
  assert.equal(result.consent.status, 'handled');
  const document = documentOf(result);
  assert.equal(document.body.dataset.action, action);
  assert.equal(document.body.dataset.trusted, 'true', 'the website must receive a genuine browser click');
  assert.equal(document.body.hasAttribute('data-unwanted'), false);
  assert.equal(document.querySelector('main').hasAttribute('hidden'), false);
}

// These tests deliberately launch the installed Chromium. Missing browser
// installations are actionable failures, rather than silently skipped coverage.
test('consent fixtures are processed by real Chromium before the snapshot', async t => {
  const capture = new BrowserCapture();
  t.after(() => capture.close());
  for (const [name, provider] of [
    ['onetrust', 'onetrust'], ['cookiebot', 'cookiebot'], ['usercentrics', 'usercentrics'],
    ['didomi', 'didomi'], ['consentmanager', 'consentmanager'],
    ['generic-en', 'generic'], ['generic-de', 'generic'],
    ['generic-fixed', 'generic'], ['generic-aria', 'generic'],
    ['shadow', 'generic'], ['delayed', 'generic'],
  ]) await t.test(name, async () => {
    const result = await capture.capture(captureOptions(name));
    assertHandled(result, provider);
  });

  await t.test('Sourcepoint in a genuine cross-origin iframe', async () => {
    const requests = [];
    const result = await capture.capture(captureOptions('sourcepoint-parent', {
      fetch: fixtureFetch('sourcepoint-parent', requests), waitAfterLoadMs: 600,
    }));
    assertHandled(result, 'sourcepoint');
    assert.equal(documentOf(result).body.dataset.crossOrigin, 'true');
    assert.ok(requests.some(request => new URL(request.url).origin === 'https://consent.example.test'));
  });

  await t.test('settings disable optional purposes and save with at most three interactions', async () => {
    const result = await capture.capture(captureOptions('settings', { waitAfterLoadMs: 1000 }));
    assertHandled(result, 'generic');
    const body = documentOf(result).body;
    assert.equal(body.dataset.steps, '3');
    assert.equal(body.dataset.optionalOff, 'true');
  });

  await t.test('Non-essential labels identify optional purposes rather than required cookies', async () => {
    const html = fixture('settings').replace('Statistics cookies', 'Non-essential cookies');
    const result = await capture.capture(captureOptions('settings', {
      waitAfterLoadMs: 1000, fetch: async () => response(html),
    }));
    assertHandled(result, 'generic');
    assert.equal(documentOf(result).body.dataset.steps, '3');
    assert.equal(documentOf(result).body.dataset.optionalOff, 'true');
  });

  await t.test('a generic dialog becoming a known CMP retains the cumulative three-step limit', async () => {
    const result = await capture.capture(captureOptions('provider-transition', { waitAfterLoadMs: 800 }));
    assert.equal(result.consent.detected, true);
    assert.equal(result.consent.provider, 'onetrust');
    assert.notEqual(result.consent.status, 'handled');
    assert.equal(documentOf(result).body.dataset.steps, '3');
    assert.ok(documentOf(result).getElementById('onetrust-banner-sdk'));
    assert.equal(result.cacheable, false);
  });

  await t.test('a consent decision can trigger navigation', async () => {
    const requests = [];
    const result = await capture.capture(captureOptions('navigation', {
      fetch: fixtureFetch('navigation', requests), waitAfterLoadMs: 600,
    }));
    assert.equal(result.consent.status, 'handled');
    assert.equal(result.consent.action, 'reject');
    assert.equal(new URL(result.browserFinalUrl).pathname, '/editorial');
    assert.equal(new URL(result.browserFinalUrl).searchParams.get('consent'), 'rejected');
    assert.match(result.renderedHtml, new RegExp(editorialHeading));
    assert.ok(requests.some(request => new URL(request.url).pathname === '/editorial'));
  });

  for (const [name, pathname] of [['redirect-login','/login'],['redirect-denied','/restricted']]) await t.test(`${name} is not successful editorial access`, async () => {
    const result = await capture.capture(captureOptions(name, { waitAfterLoadMs: 600 }));
    assert.equal(new URL(result.browserFinalUrl).pathname, pathname);
    assert.equal(result.consent.detected, true);
    assert.notEqual(result.consent.status, 'handled');
    assert.equal(result.cacheable, false);
  });

  await t.test('a Sourcepoint category heading beginning with Speichern is not a save action', async () => {
    const result = await capture.capture(captureOptions('sourcepoint-category'));
    assert.equal(result.consent.detected, true);
    assert.equal(result.consent.provider, 'sourcepoint');
    assert.notEqual(result.consent.status, 'handled');
    assert.equal(documentOf(result).body.hasAttribute('data-unwanted'), false);
    assert.ok(documentOf(result).getElementById('cookie-choices'));
  });

  await t.test('accept requires the explicit accept policy', async () => {
    const result = await capture.capture(captureOptions('onetrust', { consent: 'accept' }));
    assertHandled(result, 'onetrust', 'accept');
  });

  await t.test('off leaves the actual privacy controls untouched', async () => {
    const result = await capture.capture(captureOptions('onetrust', { consent: 'off' }));
    const document = documentOf(result);
    assert.ok(document.getElementById('onetrust-banner-sdk'));
    assert.equal(document.body.hasAttribute('data-action'), false);
    assert.equal(result.consent.action, 'off');
    assert.notEqual(result.consent.status, 'handled');
  });

  await t.test('reject never falls back to an accept-only button', async () => {
    const result = await capture.capture(captureOptions('accept-only'));
    assert.equal(result.consent.detected, true);
    assert.ok(['unsupported', 'blocked', 'failed'].includes(result.consent.status));
    assert.ok(documentOf(result).getElementById('cookie-consent'));
    assert.equal(documentOf(result).body.hasAttribute('data-action'), false);
    assert.equal(result.cacheable, false);
  });

  await t.test('an ineffective rejection is bounded and never reported as handled', async () => {
    const result = await capture.capture(captureOptions('unclosable'));
    const body = documentOf(result).body;
    assert.equal(result.consent.detected, true);
    assert.ok(['failed', 'unsupported', 'blocked'].includes(result.consent.status));
    assert.ok(Number(body.dataset.steps) >= 1);
    assert.ok(Number(body.dataset.steps) <= 3);
    assert.equal(body.dataset.trusted, 'true');
    assert.equal(body.hasAttribute('data-action'), false);
    assert.equal(result.cacheable, false);
  });

  await t.test('a disappearing dialog without released content is not a handled decision', async () => {
    const result = await capture.capture(captureOptions('no-content'));
    const document = documentOf(result);
    assert.equal(document.getElementById('cookie-consent'), null);
    assert.equal(document.body.dataset.action, 'reject');
    assert.equal(result.consent.detected, true);
    assert.equal(result.consent.status, 'failed');
    assert.equal(result.cacheable, false);
  });

  await t.test('opening settings cannot count as a completed decision when the dialog disappears', async () => {
    const result = await capture.capture(captureOptions('settings-disappear'));
    assert.equal(documentOf(result).getElementById('cookie-consent'), null);
    assert.equal(documentOf(result).body.dataset.action, 'settings');
    assert.equal(result.consent.detected, true);
    assert.notEqual(result.consent.status, 'handled');
    assert.equal(result.cacheable, false);
  });

  await t.test('disabled but selected optional purposes prevent saving an unsafe rejection', async () => {
    const result = await capture.capture(captureOptions('disabled-optional'));
    assert.equal(result.consent.detected, true);
    assert.notEqual(result.consent.status, 'handled');
    assert.equal(documentOf(result).body.hasAttribute('data-action'), false);
    assert.ok(documentOf(result).getElementById('cookie-consent'));
    assert.equal(result.cacheable, false);
  });

  await t.test('accept-or-subscribe walls are blocked without granting consent or starting a subscription', async () => {
    const result = await capture.capture(captureOptions('subscription-wall'));
    assert.equal(result.consent.detected, true);
    assert.equal(result.consent.status, 'blocked');
    assert.equal(documentOf(result).body.hasAttribute('data-unwanted'), false);
    assert.equal(result.cacheable, false);
  });

  await t.test('ordinary pages remain available without a consent action', async () => {
    const result = await capture.capture(captureOptions('editorial'));
    assert.equal(result.consent.detected, false);
    assert.equal(result.consent.status, 'not_detected');
    assert.match(result.renderedHtml, new RegExp(editorialHeading));
  });

  await t.test('editorial cookie reporting, footer controls and unrelated dialogs do not match', async () => {
    const result = await capture.capture(captureOptions('unrelated'));
    assert.equal(result.consent.detected, false);
    assert.equal(result.consent.status, 'not_detected');
    assert.equal(documentOf(result).body.hasAttribute('data-unwanted'), false);
    assert.ok(documentOf(result).querySelector('[aria-label="Newsletter signup"]'));
  });

  for (const name of ['login','challenge']) await t.test(`${name} controls with incidental cookie text remain untouched`, async () => {
    const result = await capture.capture(captureOptions(name));
    assert.equal(documentOf(result).body.hasAttribute('data-unwanted'), false);
    assert.notEqual(result.consent.status, 'handled');
  });

  await t.test('an exhausted post-load budget reports the wall without starting another interaction', async () => {
    const result = await capture.capture(captureOptions('onetrust', { waitAfterLoadMs: 0 }));
    assert.equal(result.consent.detected, true);
    assert.notEqual(result.consent.status, 'handled');
    assert.equal(documentOf(result).body.hasAttribute('data-action'), false);
  });

  await t.test('AbortSignal interrupts the bounded post-load consent wait', async () => {
    const controller = new AbortController();
    const reason = new Error('consent test cancelled');
    const timer = setTimeout(() => controller.abort(reason), 200);
    const started = Date.now();
    try {
      await assert.rejects(capture.capture(captureOptions('unclosable', {
        waitAfterLoadMs: 2000, signal: controller.signal,
      })), error => {
        assert.equal(controller.signal.aborted, true);
        assert.match(error.message, /post-load wait failed/);
        return true;
      });
      assert.ok(Date.now() - started < 2500);
    } finally { clearTimeout(timer); }
  });
});

test('long consent walls trigger automatic rendering while HTTP remains HTTP-only', async () => {
  let launches = 0;
  const requests = [];
  const client = createExtractor({
    allowPrivateNetwork: true, fetch: fixtureFetch('long-wall', requests),
    waitAfterLoad: 150, timeout: 7000,
    launchBrowser: async options => {
      launches++;
      return require('puppeteer').launch(options);
    },
  });
  const url = `${origin}/long-wall-fallback/`;
  const http = await client.extractText(url, { mode: 'http' });
  assert.equal(http.captureMode, 'http');
  assert.match(http.content, /We value your privacy/);
  assert.ok(http.content.length > 1000, 'fixture must reproduce a lengthy consent-wall extraction');
  assert.equal(launches, 0);
  const automatic = await client.extractText(url);
  assert.equal(automatic.captureMode, 'browser');
  assert.equal(automatic.consent.status, 'handled');
  assert.match(automatic.content, new RegExp(editorialHeading));
  assert.doesNotMatch(automatic.content, /We value your privacy/);
  assert.equal(launches, 1);
  const cached = await client.extractHtml(url);
  assert.equal(cached.cache.hit, true);
  assert.equal(cached.consent.status, 'handled');
  assert.equal(launches, 1, 'one handled browser capture must serve later extractors');
});

test('consent policies isolate browser cache entries and unresolved walls are never retained', async () => {
  let launches = 0;
  const client = createExtractor({
    allowPrivateNetwork: true, fetch: fixtureFetch('onetrust'), mode: 'browser',
    waitAfterLoad: 100, timeout: 7000,
    launchBrowser: async options => {
      launches++;
      return require('puppeteer').launch(options);
    },
  });
  const url = `${origin}/cache-policy/`;
  const rejected = await client.extractText(url, { consent: 'reject' });
  assert.equal(rejected.consent.action, 'reject');
  rejected.consent.action = 'accept';
  rejected.consent.status = 'failed';
  const rejectedAgain = await client.extractText(url, { consent: 'reject' });
  assert.equal(rejectedAgain.cache.hit, true);
  assert.equal(rejectedAgain.consent.action, 'reject');
  assert.equal(rejectedAgain.consent.status, 'handled');
  const accepted = await client.extractText(url, { consent: 'accept' });
  assert.equal(accepted.cache.hit, false);
  assert.equal(accepted.consent.action, 'accept');
  assert.equal(accepted.consent.status, 'handled');
  const off = await client.extractText(url, { consent: 'off' });
  assert.equal(off.cache.hit, false);
  assert.notEqual(off.consent.status, 'handled');
  assert.equal(launches, 3);

  const unresolvedFetch = fixtureFetch('unclosable');
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await client.extractText(`${origin}/cache-unresolved/`, { fetch: unresolvedFetch });
    assert.equal(result.cache.hit, false);
    assert.notEqual(result.consent.status, 'handled');
  }
  assert.equal(launches, 5);
});

test('consent policy validates before any network or browser work', async () => {
  let requests = 0;
  for (const consent of ['invalid', '', null, true, 0]) {
    assert.throws(() => createExtractor({ consent }), /consent/i);
    await assert.rejects(require('../src').extractText(`${origin}/`, {
      consent, allowPrivateNetwork: true,
      fetch: async () => { requests++; return response(fixture('editorial')); },
    }), /consent/i);
  }
  assert.equal(requests, 0);
});

test('existing vendor dismissal obeys consent policy and retains guest login-overlay handling', async t => {
  const capture = new BrowserCapture();
  t.after(() => capture.close());
  for (const consent of ['reject','accept','off']) await t.test(consent, async () => {
    const result = await capture.capture(captureOptions('twitch-vendor', {
      url: `https://www.twitch.tv/consent_${consent}`, consent,
    }));
    const document = documentOf(result);
    assert.equal(document.getElementById('login'), null);
    assert.ok(result.dismissedOverlays.includes('twitch-login-dialog'));
    if (consent === 'off') {
      assert.ok(document.getElementById('onetrust-banner-sdk'));
      assert.equal(document.body.hasAttribute('data-action'), false);
      assert.equal(result.dismissedOverlays.includes('twitch-cookie-consent'), false);
    } else {
      assert.equal(document.getElementById('onetrust-banner-sdk'), null);
      assert.equal(document.body.dataset.action, consent);
      assert.equal(document.body.dataset.trusted, 'true');
      assert.equal(result.consent.status, 'handled');
      assert.equal(result.consent.action, consent);
      assert.equal(result.dismissedOverlays.includes('twitch-cookie-consent'), consent === 'reject');
    }
  });
});
