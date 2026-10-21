'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const instagram = require('../src/vendors/instagram');
const { classifyUrl, sameEntity } = require('../src/utils/social');
const api = require('../src');
const { main } = require('../cli');
const target = 'https://www.instagram.com/reel/DeCHfZaMmPc/';
const ownerUrl = 'https://www.instagram.com/oliverjessner/reel/DeCHfZaMmPc/';
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/social/instagram-reel-metadata.html'), 'utf8');
const insights = (html, url = target) => instagram.socialInsights(parseHTML(html).document, url);
const settings = (html = fixture, extra = {}) => ({ mode: 'http', allowPrivateNetwork: true, cacheTtlMs: 0,
  fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), ...extra });
function metadata(description, identity = `<meta property="og:url" content="${ownerUrl}">`, attribute = 'property="og:description"') {
  return `<html><head>${identity}<meta ${attribute} content="${description}"></head><body></body></html>`;
}
const browser = (html, url = target) => async () => ({
  newPage: async () => ({ goto: async () => {}, content: async () => html, url: () => url, close: async () => {} }),
  close: async () => {},
});

test('Instagram reads the live reel description counts without inventing a view total', () => {
  const result = insights(fixture);
  assert.equal(result.metrics.likes, 9); assert.equal(result.metrics.comments, 2); assert.equal(result.metrics.views, null);
  assert.equal(result.status, 'partial'); assert.equal(result.unavailable.views, 'not_exposed');
  assert.deepEqual(result.sources.likes, { type: 'vendor', field: 'meta[property="og:description"]', approximate: false });
});

test('Instagram metadata counts preserve zero, grouping, compact counts and localized labels', () => {
  for (const [description, likes, comments, approximate] of [
    ['0 likes, 0 comments - author: caption', 0, 0, false],
    ['1 like, 1 comment - author: caption', 1, 1, false],
    ['1,234 likes, 23 comments - author: caption', 1234, 23, false],
    ['1.234 Gefällt mir-Angaben, 23 Kommentare - author: caption', 1234, 23, false],
    ['1,2 Mio. „Gefällt mir“-Angaben, 0 Kommentare - author: caption', 1200000, 0, true],
    ['1.2K likes, 2 comments - author: caption', 1200, 2, true],
  ]) {
    const result = insights(metadata(description));
    assert.equal(result.metrics.likes, likes, description); assert.equal(result.metrics.comments, comments, description);
    assert.equal(result.sources.likes.approximate, approximate);
  }
  const single = insights(metadata('2 comments - author: hidden likes'));
  assert.equal(single.metrics.likes, null); assert.equal(single.metrics.comments, 2);
  for (const attribute of ['name="description"', 'name="twitter:description"']) {
    assert.equal(insights(metadata('9 likes, 2 comments', undefined, attribute)).metrics.likes, 9);
  }
});

test('Instagram descriptions require matching page identities, including case-sensitive shortcodes', () => {
  for (const identity of ['',
    '<link rel="canonical" href="/reel/Other/">',
    '<meta property="og:url" content="/reel/dechfzammpc/">',
    '<meta property="og:url" content="https://instagram.com.evil.test/reel/DeCHfZaMmPc/">',
    `<link rel="canonical" href="${target}"><meta property="og:url" content="/reel/Other/">`,
  ]) assert.equal(insights(metadata('999 likes, 99 comments', identity)).metrics.likes, null, identity);
  assert.equal(insights(metadata('9 likes, 2 comments', '<link rel="canonical" href="/reel/DeCHfZaMmPc/">')).metrics.likes, 9);
  assert.equal(insights(fixture, 'https://www.instagram.com/reel/Different/').metrics.likes, null);
  assert.equal(insights(fixture, 'https://www.instagram.com/oliverjessner/').metrics.likes, null);
});

test('Instagram ignores caption numbers, hidden counts, unsupported labels and invalid totals', () => {
  for (const description of [
    'author: 999 likes, 99 comments', '9 likes and 2 comments in this caption',
    '9 views, 2 comments - author', '-1 likes, 2 comments - author',
    '1.25 likes, 2 comments - author', 'Likes are hidden - 999 likes, 99 comments',
    '9 likes, 9 likes - author',
  ]) {
    const result = insights(metadata(description));
    assert.equal(result.metrics.likes, null, description); assert.equal(result.metrics.comments, null, description);
  }
});

test('matching Instagram media JSON and JSON-LD take precedence over description counts', () => {
  const state = '<script type="application/json">' + JSON.stringify({ shortcode: 'DeCHfZaMmPc', like_count: 0, comment_count: 4, video_view_count: 123 }) + '</script>';
  const result = insights(fixture + state);
  assert.equal(result.metrics.likes, 0); assert.equal(result.metrics.comments, 4); assert.equal(result.metrics.views, 123);
  assert.equal(result.sources.likes.type, 'embedded-json'); assert.equal(result.status, 'available');
  const jsonLd = '<script type="application/ld+json">' + JSON.stringify({ '@type': 'VideoObject', url: ownerUrl, commentCount: 3,
    interactionStatistic: { interactionType: 'LikeAction', userInteractionCount: 12 } }) + '</script>';
  const linked = insights(fixture + jsonLd);
  assert.equal(linked.metrics.likes, 12); assert.equal(linked.metrics.comments, 3); assert.equal(linked.sources.likes.type, 'json-ld');
});

test('Instagram owner-prefixed post URLs preserve shortcode identity for extraction and social links', async () => {
  for (const type of ['p', 'reel', 'reels', 'tv']) {
    const url = `https://www.instagram.com/oliverjessner/${type}/DeCHfZaMmPc/`;
    const short = `https://www.instagram.com/${type}/DeCHfZaMmPc/`;
    assert.equal(classifyUrl(url).kind, type === 'p' ? 'post' : 'video');
    assert.equal(sameEntity(url, short), true); assert.equal(sameEntity(url, short.replace('DeCHfZaMmPc', 'dechfzammpc')), false);
  }
  const result = await api.extractSocialInsights(ownerUrl, settings());
  assert.equal(result.data.metrics.likes, 9); assert.equal(result.data.metrics.comments, 2);
  const wrong = await api.extractSocialInsights(target, settings(fixture.replaceAll('DeCHfZaMmPc', 'Other')));
  assert.equal(wrong.data.unavailable.likes, 'identity_mismatch');
  const links = await api.extractSocialLinks('https://page.example.test/', settings(`<a href="${ownerUrl}">Reel</a>`));
  assert.equal(links.data[0].kind, 'video');
});

test('rendered Instagram insights retain matching HTTP metadata when the DOM omits it', async () => {
  const result = await api.extractSocialInsights(target, settings(fixture, { mode: 'browser', waitAfterLoad: 0, launchBrowser: browser('<p>Reel shell</p>') }));
  assert.equal(result.data.metrics.likes, 9); assert.equal(result.data.metrics.comments, 2);
  assert.match(result.data.sources.likes.field, /^rawHTTP:/); assert.equal(result.data.status, 'partial');
});

test('auto insights keep usable HTTP metrics when optional rendering fails; explicit browser errors still fail', async () => {
  const fail = async () => { throw new Error('fixture launch failure'); };
  const result = await api.extractSocialInsights(target, settings(fixture, { mode: 'auto', launchBrowser: fail }));
  assert.equal(result.captureMode, 'http'); assert.equal(result.data.metrics.likes, 9); assert.equal(result.data.metrics.comments, 2);
  assert.equal(result.data.status, 'partial');
  const resourceFailure = async () => ({ newPage: async () => ({
    goto: async () => { throw new api.FetcharyBrowserError('could not read complete browser request body', { phase: 'resource' }); },
    close: async () => {},
  }), close: async () => {} });
  assert.equal((await api.extractSocialInsights(target, settings(fixture, { mode: 'auto', launchBrowser: resourceFailure }))).data.metrics.likes, 9);
  await assert.rejects(api.extractSocialInsights(target, settings(fixture, { mode: 'browser', launchBrowser: fail })), api.FetcharyBrowserError);
  await assert.rejects(api.extractSocialInsights(target, settings('<script>window.app = true</script>', { mode: 'auto', launchBrowser: fail })), api.FetcharyBrowserError);
  const controller = new AbortController();
  await assert.rejects(api.extractSocialInsights(target, settings(fixture, { mode: 'auto', signal: controller.signal,
    launchBrowser: async () => { controller.abort(); throw new Error('aborted'); },
  })), error => error instanceof api.FetcharyFetchError && /aborted/.test(error.message));
});

test('HTTP insight fallback never masks browser access denials or login walls', async () => {
  for (const status of [401, 403, 429]) {
    const launchBrowser = async () => ({ newPage: async () => ({ goto: async () => ({ status: () => status }), close: async () => {} }), close: async () => {} });
    const result = await api.extractSocialInsights(target, settings(fixture, { mode: 'auto', waitAfterLoad: 0, launchBrowser }));
    assert.equal(result.data.status, status === 401 ? 'login_required' : 'blocked'); assert.equal(result.data.metrics.likes, null);
  }
  const wall = await api.extractSocialInsights(target, settings(fixture, { mode: 'auto', waitAfterLoad: 0,
    launchBrowser: browser('<title>Log in</title><input type="password">'),
  }));
  assert.equal(wall.data.status, 'login_required'); assert.equal(wall.data.metrics.likes, null);
});

test('real Chromium and CLI expose Instagram metadata counts with partial availability', async () => {
  const options = settings(fixture, { mode: 'browser', timeout: 15000, waitAfterLoad: 0,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  const result = await api.extractSocialInsights(target, options);
  assert.equal(result.captureMode, 'browser'); assert.equal(result.data.metrics.likes, 9); assert.equal(result.data.metrics.comments, 2);
  let stdout = ''; let stderr = '';
  const code = await main(['extract', 'social-insights', target, '--no-history'], {
    options: { ...options, mode: 'auto' }, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } },
  });
  assert.equal(code, 0, stderr); assert.equal(stderr, '');
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.data.metrics.likes, 9); assert.equal(parsed.data.metrics.comments, 2); assert.equal(parsed.data.metrics.views, null);
  assert.equal(parsed.data.status, 'partial');
});
