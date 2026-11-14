'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const api = require('../src');

const MiB = 1024 * 1024;
const url = 'https://example.test/configuration';
const iconUrl = 'https://example.test/icon.svg';
const icon = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M0 0h32v32H0z"/></svg>');

function faviconFixture() {
  const html = '<link rel="icon" href="/icon.svg"><!--' + 'x'.repeat(2 * MiB) + '--><p>Large homepage</p>';
  let pages = 0;
  let icons = 0;
  return {
    get pages() { return pages; },
    get icons() { return icons; },
    fetch: async target => {
      if (target === url) {
        pages++;
        return new Response(html, { headers: { 'content-type': 'text/html' } });
      }
      if (target === iconUrl) {
        icons++;
        return new Response(icon, { headers: { 'content-type': 'image/svg+xml' } });
      }
      return new Response('missing', { status: 404 });
    },
  };
}

test('client configuration permits a large favicon homepage and keeps overrides, caches and clients isolated', async () => {
  const fixture = faviconFixture();
  const options = { mode: 'http', allowPrivateNetwork: true, fetch: fixture.fetch };
  const client = api.createExtractor({ ...options, maxResponseBytes: 2 * MiB });
  const other = api.createExtractor({ ...options, maxResponseBytes: 2 * MiB });

  await assert.rejects(client.extractFavicon(url), api.FetcharyFetchError);
  assert.equal(fixture.icons, 0);

  // A one-off larger allowance must not silently change subsequent defaults.
  const overridden = await client.extractFavicon(url, { maxResponseBytes: 4 * MiB, binary: true });
  assert.deepEqual(overridden.data, icon);
  await assert.rejects(client.extractFavicon(url), api.FetcharyFetchError);

  assert.equal(client.configure({ maxResponseBytes: 4 * MiB }), client);
  const selected = await client.extractFavicon(url, { binary: true });
  assert.equal(selected.image.url, iconUrl);
  assert.deepEqual(selected.data, icon);
  const pageRequests = fixture.pages;
  assert.equal((await client.extractFavicon(url)).cache.hit, true);
  assert.equal(fixture.pages, pageRequests);

  // Lowering the limit must not reuse an otherwise valid oversized snapshot.
  client.configure({ maxResponseBytes: 2 * MiB });
  await assert.rejects(client.extractFavicon(url), api.FetcharyFetchError);
  await assert.rejects(other.extractFavicon(url), api.FetcharyFetchError);
  assert.equal((await api.extractFavicon(url, options)).image.url, iconUrl);

  // Explicit undefined restores the built-in 45 MiB allowance.
  client.configure({ maxResponseBytes: undefined });
  assert.deepEqual((await client.extractFavicon(url, { binary: true })).data, icon);
});

test('invalid client configuration fails synchronously without partially replacing valid defaults', async () => {
  const observedHeaders = [];
  const content = '<p>' + 'x'.repeat(80) + '</p>';
  const client = api.createExtractor({
    mode: 'http', allowPrivateNetwork: true, maxResponseBytes: 128,
    headers: { 'x-config': 'original' },
    fetch: async (_target, options) => {
      observedHeaders.push(new Headers(options.headers).get('x-config'));
      return new Response(content, { headers: { 'content-type': 'text/html' } });
    },
  });

  for (const options of [undefined, null, [], 4, 'options',
    { maxResponseBytes: 0 }, { maxResponseBytes: -1 }, { maxResponseBytes: 1.5 },
    { maxResponseBytes: Infinity }, { maxResponseBytes: Number.MAX_SAFE_INTEGER + 1 },
    { maxEntries: 10 }, { maxCacheBytes: MiB },
    { headers: { 'x-config': 'changed' }, maxResponseBytes: '128' },
    { maxResponseBytes: 16, headers: { 'invalid\nname': 'value' } }]) {
    assert.throws(() => client.configure(options), api.FetcharyValidationError);
  }
  assert.equal(observedHeaders.length, 0);
  assert.equal((await client.extractText(url)).content, 'x'.repeat(80));
  assert.deepEqual(observedHeaders, ['original']);

  const cookieClient = api.createExtractor({ cookieFile: '/unused/cookies.txt' });
  assert.throws(() => cookieClient.configure({ session: 'saved' }), api.FetcharyValidationError);
  assert.equal(cookieClient.configure({ cookieFile: undefined, session: 'saved' }), cookieClient);
});

test('configuration snapshots headers and preserves defaults for a capture already in flight', async () => {
  let release;
  let started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  const firstResponse = new Promise(resolve => { release = resolve; });
  const headers = [];
  const content = '<p>' + 'x'.repeat(100) + '</p>';
  const client = api.createExtractor({
    mode: 'http', allowPrivateNetwork: true, maxResponseBytes: 256,
    headers: { 'x-config': 'old' },
    fetch: async (_target, options) => {
      headers.push(new Headers(options.headers).get('x-config'));
      if (headers.length === 1) {
        started();
        await firstResponse;
      }
      return new Response(content, { headers: { 'content-type': 'text/html' } });
    },
  });

  const pending = client.extractText(url);
  await requestStarted;
  const configuredHeaders = new Headers({ 'x-config': 'new' });
  client.configure({ headers: configuredHeaders, maxResponseBytes: 64 });
  configuredHeaders.set('x-config', 'mutated by caller');
  release();

  assert.equal((await pending).content, 'x'.repeat(100));
  await assert.rejects(client.extractText(url), api.FetcharyFetchError);
  assert.equal((await client.extractText(url, { maxResponseBytes: 256 })).content, 'x'.repeat(100));
  assert.deepEqual(headers, ['old', 'new', 'new']);
});
