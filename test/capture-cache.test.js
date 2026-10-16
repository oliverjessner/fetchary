'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCaptureCache } = require('../src/capture/cache');
const { CaptureManager } = require('../src/capture');
const actualApi = require('../src');
const api = { ...actualApi };
for (const name of Object.keys(api)) if (name.startsWith('extract') || name === 'createExtractor') api[name] = (url, options, ...rest) => name === 'createExtractor' ? actualApi[name]({ allowPrivateNetwork: true, ...url }) : name === 'extractSelector' && typeof options === 'string' ? actualApi[name](url, options, { allowPrivateNetwork: true, ...rest[0] }) : actualApi[name](url, { allowPrivateNetwork: true, ...options });

const url = 'https://example.test/';
const html = '<main>Hello <span>world</span></main><img src="/photo.png" alt="Photo"><a href="https://github.com/oli">GitHub</a>';

function httpFixture(body = html, init = {}) {
  let requests = 0;
  const fetch = async () => { requests++; return new Response(body, { headers: { 'content-type': 'text/html' }, ...init }); };
  return { fetch, get requests() { return requests; } };
}

function browserFixture(content = '<main>Rendered</main>', failure) {
  const state = { launches: 0, pages: 0, pageCloses: 0, browserCloses: 0, headers: null, userAgent: null };
  state.launch = async () => {
    state.launches++;
    return {
      async newPage() {
        state.pages++;
        return {
          async setUserAgent(value) { state.userAgent = value; },
          async setExtraHTTPHeaders(value) { state.headers = value; },
          async goto() { if (failure === 'navigation') throw new Error('navigation failed'); },
          async content() { if (failure === 'snapshot') throw new Error('snapshot failed'); return content; },
          url: () => url,
          async close() { state.pageCloses++; },
        };
      },
      async close() { state.browserCloses++; },
    };
  };
  return state;
}

function snapshot(content = 'hello') {
  return { requestedUrl: url, rawFinalUrl: url, status: 200, contentType: 'text/html', rawBody: Buffer.from(content),
    renderedHtml: null, rawCapturedAt: '2026-10-16T00:00:00.000Z', dismissedOverlays: [], captureMode: 'http' };
}

function clockFixture(options = {}) {
  let time = 0;
  let captures = 0;
  const cache = createCaptureCache({ ...options, now: () => time });
  return {
    cache, advance: value => { time += value; }, get captures() { return captures; },
    capture: (key = 'page', ttl = 45_000, body) => cache.capture(key, ttl, async () => { captures++; return snapshot(body); }),
  };
}

test('default cache misses, shares captures across extractors, preserves timestamps and isolates DOMs', async () => {
  const fixture = httpFixture();
  const options = { fetch: fixture.fetch, mode: 'http' };
  const first = await api.extractText(url, { ...options, includeSelectors: ['main'], ignoreSelectors: ['span'] });
  assert.equal(first.content, 'Hello');
  assert.deepEqual(first.cache, { hit: false, ageMs: 0, ttlMs: 45_000 });
  const second = await api.extractText(url, options);
  assert.equal(second.content, 'Hello world\nGitHub');
  assert.equal(second.cache.hit, true);
  assert.equal(second.capturedAt, first.capturedAt);
  assert.equal((await api.extractHtml(url, options)).cache.hit, true);
  const images = await api.extractImages(url, options);
  assert.equal(images.images[0].url, `${url}photo.png`);
  const social = await api.extractSocialLinks(url, options);
  assert.equal(social.links[0].url, 'https://github.com/oli');
  assert.equal((await api.extractSelector(url, 'main', options)).cache.hit, true);
  assert.equal(fixture.requests, 1);
  second.dismissedOverlays.push('mutated');
  second.cache.ttlMs = 1;
  assert.deepEqual((await api.extractText(url, options)).dismissedOverlays, []);
});

test('default TTL expires at 45 seconds, with no sliding expiration', async () => {
  const fixture = clockFixture();
  await fixture.capture();
  fixture.advance(44_000);
  assert.deepEqual((await fixture.capture()).cache, { hit: true, ageMs: 44_000, ttlMs: 45_000 });
  fixture.advance(1000);
  assert.equal((await fixture.capture()).cache.hit, false);
  assert.equal(fixture.captures, 2);
});

test('the requesting operation owns its TTL, even after an earlier shorter TTL', async () => {
  const fixture = clockFixture();
  await fixture.capture('page', 1000);
  fixture.advance(2000);
  assert.deepEqual((await fixture.capture('page', 120_000)).cache, { hit: true, ageMs: 2000, ttlMs: 120_000 });
  assert.equal((await fixture.capture('page', 1000)).cache.hit, false);
  fixture.advance(120_000);
  assert.equal((await fixture.capture('page', 120_000)).cache.hit, false);
});

test('TTL starts at capture completion and concurrent callers apply their own metadata', async () => {
  const fixture = clockFixture();
  let resolve;
  const pending = fixture.cache.capture('page', 1000, () => new Promise(done => { resolve = done; }));
  const joined = fixture.cache.capture('page', 120_000, () => assert.fail('must join'));
  await Promise.resolve();
  fixture.advance(50_000);
  resolve(snapshot());
  assert.deepEqual((await pending).cache, { hit: false, ageMs: 0, ttlMs: 1000 });
  assert.equal((await joined).cache.ttlMs, 120_000);
  fixture.advance(500);
  assert.equal((await fixture.capture('page', 1000)).cache.ageMs, 500);
});

test('the shared capture layer defaults to 45 seconds and prunes expired entries lazily', async () => {
  let time = 0;
  const cache = createCaptureCache({ now: () => time, maxEntries: 2 });
  const fixture = httpFixture();
  const manager = new CaptureManager({ allowPrivateNetwork: true, maxResponseBytes: 10 * 1024 * 1024, fetch: fixture.fetch, timeout: 1000, userAgent: 'test', captureCache: cache });
  const source = { url, captureMode: 'http' };
  assert.equal((await manager.capture(source)).cache.ttlMs, 45_000);
  time = 44_999;
  assert.equal((await manager.capture(source)).cache.hit, true);
  time = 45_000;
  assert.equal((await manager.capture(source)).cache.hit, false);
  assert.equal(fixture.requests, 2);
  await manager.close();
});

test('zero TTL strictly bypasses cached and in-flight work', async () => {
  const fixture = httpFixture();
  const options = { mode: 'http', fetch: fixture.fetch };
  await api.extractText(url, options);
  const results = await Promise.all(Array.from({ length: 3 }, () => api.extractText(url, { ...options, cacheTtlMs: 0 })));
  assert.equal(fixture.requests, 4);
  assert.ok(results.every(result => result.cache.hit === false && result.cache.ttlMs === 0));
});

test('configuration rejects invalid TTLs and memory bounds before fetching', async () => {
  const fixture = httpFixture();
  for (const cacheTtlMs of [-1, Infinity, -Infinity, NaN, '45000', null, false, {}]) {
    await assert.rejects(api.extractText(url, { fetch: fixture.fetch, mode: 'http', cacheTtlMs }), api.FetcharyValidationError);
    assert.throws(() => api.createExtractor({ cacheTtlMs }), api.FetcharyValidationError);
  }
  for (const value of [-1, Infinity, '100', 1.5]) {
    assert.throws(() => api.createExtractor({ maxEntries: value }), api.FetcharyValidationError);
    assert.throws(() => api.createExtractor({ maxCacheBytes: value }), api.FetcharyValidationError);
  }
  assert.equal(fixture.requests, 0);
});

test('keys normalize URLs and headers, preserve queries and isolate request implementations and settings', async () => {
  const fixture = httpFixture();
  const client = api.createExtractor({ fetch: fixture.fetch, mode: 'http' });
  await client.extractText('https://EXAMPLE.test:443/?q=one');
  assert.equal((await client.extractImages('https://example.test/?q=one')).cache.hit, true);
  await client.extractText('https://example.test/?q=two');
  await client.extractText(url, { headers: { 'Accept-Language': 'en', accept: 'text/html' } });
  assert.equal((await client.extractText(url, { headers: { Accept: 'text/html', 'accept-language': 'en' } })).cache.hit, true);
  await client.extractText(url, { headers: { 'accept-language': 'de' } });
  await client.extractText(url, { userAgent: 'another-agent' });
  await client.extractText(url, { timeout: 100 });
  assert.equal(fixture.requests, 6);
  const other = httpFixture('<main>Other security context</main>');
  assert.equal((await client.extractText(url, { fetch: other.fetch })).content, 'Other security context');
});

test('HTTP and browser modes, render waits and browser implementations remain separate', async () => {
  const fixture = httpFixture('<main>Raw</main>');
  const browser = browserFixture();
  const client = api.createExtractor({ fetch: fixture.fetch, mode: 'browser', launchBrowser: browser.launch, waitAfterLoad: 0 });
  assert.equal((await client.extractText(url)).content, 'Rendered');
  assert.equal((await client.extractText(url)).cache.hit, true);
  assert.equal((await client.extractText(url, { mode: 'http' })).content, 'Raw');
  await client.extractText(url, { waitAfterLoad: 1 });
  const other = browserFixture('<main>Other browser</main>');
  assert.equal((await client.extractText(url, { launchBrowser: other.launch })).content, 'Other browser');
  assert.equal(fixture.requests, 4);
  assert.equal(browser.launches, 2);
  assert.equal(browser.pageCloses, 2);
  assert.equal(browser.browserCloses, 2);
});

test('compatible concurrent extractors share HTTP capture and browser lifetime', async () => {
  const fixture = httpFixture();
  const browser = browserFixture(html);
  const options = { fetch: fixture.fetch, mode: 'browser', launchBrowser: browser.launch, waitAfterLoad: 0 };
  const results = await Promise.all([api.extractText(url, options), api.extractImages(url, options), api.extractSocialLinks(url, options)]);
  assert.equal(fixture.requests, 1);
  assert.equal(browser.launches, 1);
  assert.equal(browser.pageCloses, 1);
  assert.equal(browser.browserCloses, 1);
  assert.ok(results.every(result => result.cache.hit === false));
  assert.equal((await api.extractText(url, options)).cache.hit, true);
});

test('favicon, social avatar and social insights reuse the primary capture while checking resources separately', async () => {
  const profile = 'https://github.com/oli';
  let pages = 0;
  let images = 0;
  const fetch = async target => {
    if (target === profile) {
      pages++;
      return new Response('<div class="h-card"><img class="avatar-user" src="/avatar.svg"></div><link rel="icon" href="/avatar.svg"><a href="/oli?tab=followers">42 followers</a>');
    }
    images++;
    return new Response('<svg width="128" height="128"></svg>', { headers: { 'content-type': 'image/svg+xml' } });
  };
  const client = api.createExtractor({ mode: 'http', fetch });
  await client.extractText(profile);
  assert.equal((await client.extractFavicon(profile)).cache.hit, true);
  const avatar = await client.extractSocialAvatar(profile);
  assert.equal(avatar.cache.hit, true);
  assert.equal(avatar.image.url, 'https://github.com/avatar.svg');
  const insights = await client.extractSocialInsights(profile);
  assert.equal(insights.cache.hit, true);
  assert.equal(insights.followers, 42);
  insights.followers = 999;
  assert.equal((await client.extractSocialInsights(profile)).followers, 42);
  assert.equal(pages, 1);
  assert.ok(images >= 2);
});

test('failed HTTP, aborted and incomplete captures are never cached and pending rejections are removed', async () => {
  let requests = 0;
  const client = api.createExtractor({ mode: 'http', fetch: async () => {
    requests++;
    if (requests === 1) return new Response('failure', { status: 503 });
    if (requests === 2) throw new DOMException('aborted', 'AbortError');
    if (requests === 3) return { ok: true, arrayBuffer: async () => { throw new Error('truncated response'); } };
    return new Response(html);
  } });
  const failed = await Promise.allSettled([client.extractText(url), client.extractImages(url)]);
  assert.ok(failed.every(result => result.status === 'rejected'));
  assert.equal(requests, 1);
  await assert.rejects(client.extractText(url), api.FetcharyFetchError);
  await assert.rejects(client.extractText(url), api.FetcharyFetchError);
  assert.equal((await client.extractText(url)).cache.hit, false);
  assert.equal((await client.extractText(url)).cache.hit, true);
  assert.equal(requests, 4);
});

test('expired content is discarded and a refresh error never returns stale data', async () => {
  const fixture = clockFixture();
  await fixture.capture();
  fixture.advance(45_000);
  await assert.rejects(fixture.cache.capture('page', 45_000, async () => { throw new Error('refresh failed'); }), /refresh failed/);
  assert.equal((await fixture.capture()).cache.hit, false);
});

test('browser failures, invalid snapshots and launch failures close resources and retry', async () => {
  for (const failure of ['navigation', 'snapshot', 'empty']) {
    const fixture = httpFixture();
    const browser = browserFixture(failure === 'empty' ? '' : html, failure);
    const options = { fetch: fixture.fetch, mode: 'browser', launchBrowser: browser.launch, waitAfterLoad: 0 };
    await assert.rejects(api.extractText(url, options), api.FetcharyBrowserError);
    await assert.rejects(api.extractText(url, options), api.FetcharyBrowserError);
    assert.equal(fixture.requests, 2);
    assert.equal(browser.pageCloses, 2);
    assert.equal(browser.browserCloses, 2);
  }
  let launches = 0;
  const fixture = httpFixture();
  const client = api.createExtractor({ fetch: fixture.fetch, mode: 'browser', waitAfterLoad: 0, launchBrowser: async () => { launches++; throw new Error('launch failed'); } });
  await assert.rejects(client.extractText(url), api.FetcharyBrowserError);
  await assert.rejects(client.extractText(url), api.FetcharyBrowserError);
  assert.equal(launches, 2);
});

test('browser HTTP failures close the browser; successful private responses remain uncacheable', async () => {
  for (const [status, headers] of [[503, {}], [200, { 'set-cookie': 'session=secret' }], [206, {}]]) {
    const fixture = httpFixture();
    const browser = browserFixture();
    const launchBrowser = async () => {
      const instance = await browser.launch();
      const newPage = instance.newPage;
      instance.newPage = async () => {
        const page = await newPage();
        page.goto = async () => ({ status: () => status, headers: () => headers });
        return page;
      };
      return instance;
    };
    const client = api.createExtractor({ fetch: fixture.fetch, mode: 'browser', launchBrowser, waitAfterLoad: 0 });
    if (status === 503) {
      await assert.rejects(client.extractText(url), api.FetcharyBrowserError);
      await assert.rejects(client.extractText(url), api.FetcharyBrowserError);
    } else {
      await client.extractText(url);
      assert.equal((await client.extractText(url)).cache.hit, false);
    }
    assert.equal(browser.pageCloses, 2);
    assert.equal(browser.browserCloses, 2);
  }
});

test('HTTP timeouts cannot cache a response returned after abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve;
  let requestSignal;
  const client = api.createExtractor({ mode: 'http', timeout: 10, fetch: async (target, options) => {
    requestSignal = options.signal;
    return new Promise(done => { resolve = done; });
  } });
  const pending = client.extractText(url);
  const rejection = assert.rejects(pending, api.FetcharyFetchError);
  for (let turn = 0; turn < 50 && !requestSignal; turn++) await Promise.resolve();
  t.mock.timers.tick(10);
  assert.equal(requestSignal.aborted, true);
  resolve(new Response(html));
  await rejection;
  assert.equal((await client.extractText(url, { fetch: httpFixture().fetch })).cache.hit, false);
});

test('shared and private cache clearing releases entries and preserves other clients', async () => {
  const fixture = httpFixture();
  const options = { mode: 'http', fetch: fixture.fetch };
  const one = api.createExtractor({ ...options, cacheTtlMs: 120_000 });
  const two = api.createExtractor({ ...options, cacheTtlMs: 2000 });
  await one.extractText(url);
  assert.equal((await two.extractText(url)).cache.hit, false);
  await api.extractText(url, options);
  one.clearCache();
  assert.equal((await one.extractText(url)).cache.hit, false);
  assert.equal((await two.extractText(url)).cache.hit, true);
  api.clearCache();
  assert.equal((await api.extractText(url, options)).cache.hit, false);
  assert.equal((await one.extractText(url)).cache.ttlMs, 120_000);
  assert.equal((await two.extractText(url)).cache.ttlMs, 2000);
  await one.extractText(url, { cacheTtlMs: 0 });
  assert.equal((await one.extractText(url)).cache.ttlMs, 120_000);
});

test('clearing active captures does not cancel them or let old work overwrite fresh entries', async () => {
  const fixture = clockFixture();
  let resolve;
  const old = fixture.cache.capture('page', 45_000, () => new Promise(done => { resolve = done; }));
  await Promise.resolve();
  fixture.cache.clear();
  const fresh = await fixture.capture('page', 45_000, 'fresh');
  resolve(snapshot('old'));
  assert.equal((await old).rawBody.toString(), 'old');
  assert.equal(fresh.rawBody.toString(), 'fresh');
  assert.equal((await fixture.capture()).rawBody.toString(), 'fresh');
});

test('LRU evicts the least recently read page', async () => {
  const fixture = clockFixture({ maxEntries: 2 });
  await fixture.capture('a'); await fixture.capture('b');
  assert.equal((await fixture.capture('a')).cache.hit, true);
  await fixture.capture('c');
  assert.equal((await fixture.capture('a')).cache.hit, true);
  assert.equal((await fixture.capture('b')).cache.hit, false);
});

test('byte budgets include response buffers and rendered strings; oversized captures are still returned', async () => {
  const fixture = clockFixture({ maxCacheBytes: 1800 });
  await fixture.capture('a', 45_000, 'a'.repeat(700));
  await fixture.capture('b', 45_000, 'b'.repeat(700));
  assert.equal((await fixture.capture('a', 45_000, 'a'.repeat(700))).cache.hit, false);
  await fixture.capture('huge', 45_000, 'z'.repeat(2000));
  assert.equal((await fixture.capture('huge', 45_000, 'z'.repeat(2000))).cache.hit, false);
  const page = { ...snapshot(), renderedHtml: 'z'.repeat(1000) };
  const load = () => Promise.resolve(page);
  await fixture.cache.capture('rendered', 45_000, load);
  assert.equal((await fixture.cache.capture('rendered', 45_000, load)).cache.hit, false);
  const defaults = clockFixture();
  await defaults.capture('huge', 45_000, 'x'.repeat(50 * 1024 * 1024 + 1));
  assert.equal((await defaults.capture('huge', 45_000, 'small')).cache.hit, false);
  for (let index = 0; index <= 100; index++) await defaults.capture(String(index));
  assert.equal((await defaults.capture('0')).cache.hit, false);
});

test('zero memory capacity keeps in-flight deduplication but retains no completed entries', async () => {
  for (const options of [{ maxEntries: 0 }, { maxCacheBytes: 0 }]) {
    const fixture = clockFixture(options);
    await Promise.all([fixture.capture(), fixture.capture()]);
    assert.equal(fixture.captures, 1);
    assert.equal((await fixture.capture()).cache.hit, false);
  }
});

test('cached buffers and mutable metadata cannot be changed by any caller or in-flight joiner', async () => {
  const fixture = clockFixture();
  const [one, two] = await Promise.all([fixture.capture(), fixture.capture()]);
  one.rawBody.fill(0); one.dismissedOverlays.push('changed');
  assert.equal(two.rawBody.toString(), 'hello');
  const hit = await fixture.capture();
  assert.equal(hit.rawBody.toString(), 'hello');
  assert.deepEqual(hit.dismissedOverlays, []);
});

test('global credential requests bypass caching; authenticated clients are isolated by all headers', async () => {
  const fixture = httpFixture();
  const options = { fetch: fixture.fetch, mode: 'http', headers: { authorization: 'Bearer one' } };
  await api.extractText(url, options); await api.extractText(url, options);
  assert.equal(fixture.requests, 2);
  const client = api.createExtractor(options);
  await client.extractText(url);
  assert.equal((await client.extractText(url)).cache.hit, true);
  assert.equal((await client.extractText(url, { headers: { authorization: 'Bearer two' } })).cache.hit, false);
});

test('sensitive, partial, challenged and invalid HTML responses are returned without caching', async () => {
  for (const [body, init] of [
    [html, { headers: { 'set-cookie': 'session=secret' } }],
    [html, { headers: { 'cache-control': 'private, max-age=600' } }],
    [html, { headers: { 'cache-control': 'no-store' } }],
    [html, { status: 206 }],
    ['not HTML', { headers: { 'content-type': 'text/html' } }],
    ['<title>CAPTCHA verification</title>', {}],
    ['<title>Just a moment...</title>', {}],
    ['<title>Sign in</title>', {}],
    ['<div class="g-recaptcha">Verify</div>', {}],
    ['<form><input type="password"></form>', {}],
  ]) {
    const fixture = httpFixture(body, init);
    const client = api.createExtractor({ fetch: fixture.fetch, mode: 'http' });
    await client.extractText(url);
    assert.equal((await client.extractText(url)).cache.hit, false, body);
    assert.equal(fixture.requests, 2);
  }
});

test('URL validation still runs on cache hits and rejects invalid redirect destinations', async () => {
  const cache = createCaptureCache();
  let checks = 0;
  const originalCapture = cache.capture;
  cache.capture = async (...args) => {
    checks++;
    const page = await originalCapture(...args);
    return checks === 2 ? { ...page, rawFinalUrl: 'file:///secret' } : page;
  };
  const fixture = httpFixture();
  const manager = new CaptureManager({ allowPrivateNetwork: true, maxResponseBytes: 10 * 1024 * 1024, fetch: fixture.fetch, timeout: 1000, userAgent: 'test', captureCache: cache });
  const source = { url, captureMode: 'http' };
  await manager.capture(source);
  await assert.rejects(manager.capture(source), api.FetcharyValidationError);
  await assert.rejects(manager.capture({ ...source, url: 'file:///secret' }), api.FetcharyValidationError);
  assert.equal(fixture.requests, 1);
});

test('extraction clients create no persistent files, including cache directories or databases', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cache-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dataDir = path.join(directory, 'must-not-exist');
  const fixture = httpFixture();
  const client = api.createExtractor({ mode: 'http', fetch: fixture.fetch, dataDir });
  await client.extractText(url); await client.extractImages(url); client.clearCache();
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('all extraction and cache exports are available as named ES module imports', async () => {
  const module = await import('../src/index.js');
  for (const name of ['extract', 'extractText', 'extractHtml', 'extractLinks', 'extractDocuments', 'extractEmails', 'extractTelephone', 'extractFavicon', 'extractImages', 'extractSelector',
    'extractSocialLinks', 'extractSocialAvatar', 'extractSocialInsights', 'extractProfilePicture', 'createExtractor', 'clearCache']) {
    assert.equal(module[name], actualApi[name], name);
  }
});
