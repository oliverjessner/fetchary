'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const { createFetchary, FetcharyNotFoundError, FetcharyValidationError } = require('../src');
const { discoverVendors } = require('../src/vendors');
const { parseCount } = require('../src/metrics/followers');

function count(vendor, url, html) {
  return discoverVendors().find(module => module.name === vendor).followerCount(parseHTML(html).document, url);
}

test('follower numbers support grouping, compact counts and English/German units without inventing missing values', () => {
  for (const [input, expected] of [
    [0, 0], ['0', 0], ['1,473', 1473], ['1.473', 1473], ['1 473', 1473], ['1\u202f473', 1473], ["1'473", 1473],
    ['1.5K', 1500], ['1,5 Tsd.', 1500], ['1.93 thousand', 1930], ['2.5M', 2500000], ['2,5 Mio.', 2500000],
    ['1.2 billion', 1200000000], ['1,2 Mrd.', 1200000000], ['1,234,567', 1234567],
  ]) assert.equal(parseCount(input), expected, String(input));
  for (const input of [null, undefined, '', 'hidden', '—', '-1', -1, 1.5, '12,34', 'NaN', Infinity, '9007199254740992', '1e3', '10 likes']) {
    assert.equal(parseCount(input), null, String(input));
  }
});

test('GitHub counts belong to the requested profile, including relative links and exact tooltips', () => {
  const url = 'https://github.com/example';
  assert.equal(count('github', url, '<a href="/example?tab=following">21 following</a><a href="/other?tab=followers">900 followers</a><a href="https://evil.test/example?tab=followers">999 followers</a><a href="/example?tab=followers"><span title="1,473">1.5k</span> followers</a>'), 1473);
  assert.equal(count('github', url, '<a href="/example?tab=followers">0 followers</a>'), 0);
  assert.equal(count('github', url, '<a href="/example?tab=following">21 following</a>'), null);
  assert.equal(count('github', `${url}/repo`, '<a href="/example?tab=followers">63 followers</a>'), null);
});

test('X counts ignore following and other profiles and accept verified follower links', () => {
  assert.equal(count('x', 'https://x.com/example', '<a href="/other/followers">9M Followers</a><a href="/example/following">40 Following</a><a href="/example/verified_followers"><b>203</b><span>Followers</span></a>'), 203);
  assert.equal(count('x', 'https://twitter.com/example', '<a href="/example/followers"><span title="1.234">1,2K</span> Follower</a>'), 1234);
  assert.equal(count('x', 'https://x.com/example/status/12', '<a href="/example/followers">203 Followers</a>'), null);
});

test('Threads and Instagram prefer exact profile JSON over compact descriptions and recommended accounts', () => {
  const html = '<script type="application/json">{"users":[{"username":"other","follower_count":999999},{"username":"example","follower_count":1473,"edge_followed_by":{"count":1473}}]}</script><meta property="og:description" content="1.5K followers • 200 posts">';
  for (const [vendor, url] of [['threads', 'https://www.threads.com/@example'], ['instagram', 'https://www.instagram.com/example/']]) {
    assert.equal(count(vendor, url, html), 1473);
    assert.equal(count(vendor, url, '<meta property="og:description" content="1.234 Follower, 50 Beiträge">'), 1234);
    assert.equal(count(vendor, url, '<meta name="description" content="1,5 Mio. followers • 200 posts">'), 1500000);
    assert.equal(count(vendor, url, '<script>{"username":"other","follower_count":999999}</script><span title="999999">999999 followers</span>'), null);
    assert.equal(count(vendor, url, '<meta name="description" content="Log in to see photos">'), null);
  }
  assert.equal(count('instagram', 'https://instagram.com/example/', '<a href="/example/followers/"><span title="1,473">1.5K</span> followers</a>'), 1473);
  assert.equal(count('instagram', 'https://instagram.com/p/post-id/', html), null);
});

test('TikTok reads scoped profile statistics or the dedicated follower counter without using likes', () => {
  const url = 'https://www.tiktok.com/@example';
  const html = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"webapp.user-detail":{"userInfo":{"user":{"uniqueId":"example"},"stats":{"followerCount":23789,"heartCount":900000}}},"suggestions":[{"user":{"uniqueId":"other"},"stats":{"followerCount":999999}}]}</script><strong data-e2e="followers-count">23.8K</strong>';
  assert.equal(count('tiktok', url, html), 23789);
  assert.equal(count('tiktok', url, '<strong data-e2e="likes-count">9M</strong><strong data-e2e="followers-count">1,5M</strong>'), 1500000);
  assert.equal(count('tiktok', url, '<strong data-e2e="followers-count">—</strong>'), null);
  assert.equal(count('tiktok', `${url}/video/123`, html), null);
});

test('Twitch reads channel header counts and exact channel JSON without counting viewers or paid subscriptions', () => {
  const url = 'https://www.twitch.tv/example/about';
  assert.equal(count('twitch', url, '<aside>9M followers</aside><div class="home-header-sticky"><p>2.5M followers</p></div><p>123 viewers</p>'), 2500000);
  assert.equal(count('twitch', url, '<script type="application/json">{"user":{"login":"example","followers":{"totalCount":1245}},"suggestions":{"login":"other","followers":{"totalCount":99999}}}</script>'), 1245);
  assert.equal(count('twitch', url, '<div data-a-target="channel-header"><span>1,5 Tsd. Follower</span></div>'), 1500);
  assert.equal(count('twitch', url, '<p>123 subscribers</p><aside>99K followers</aside>'), null);
  assert.equal(count('twitch', 'https://www.twitch.tv/directory', '<span data-a-target="followers-count">9M</span>'), null);
});

test('YouTube counts channel subscribers from modern and historical headers instead of recommended channels', () => {
  const html = '<aside><span>99M subscribers</span></aside><yt-page-header-renderer><span aria-label="1.93 thousand subscribers">1.93k subscribers</span></yt-page-header-renderer>';
  assert.equal(count('youtube', 'https://www.youtube.com/@example', html), 1930);
  assert.equal(count('youtube', 'https://www.youtube.com/channel/UCexample', '<ytd-c4-tabbed-header-renderer><span id="subscriber-count">1,5 Mio. Abonnenten</span></ytd-c4-tabbed-header-renderer>'), 1500000);
  assert.equal(count('youtube', 'https://www.youtube.com/@example', '<yt-page-header-renderer><span>0 subscribers</span></yt-page-header-renderer>'), 0);
  assert.equal(count('youtube', 'https://www.youtube.com/@example', '<aside><span>99M subscribers</span></aside>'), null);
  assert.equal(count('youtube', 'https://www.youtube.com/watch?v=example', html), null);
});

test('library follower counts use the latest rendered archive and survive restart without fetching or changing evidence', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-followers-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let html = '<a href="/example?tab=followers">63 followers</a>';
  let browserUrl = 'https://github.com/example';
  let fetches = 0;
  let fetchary = await createFetchary({
    dataDir,
    fetch: async url => { fetches++; return new Response(`<a href="${new URL(url).pathname}?tab=followers">10 followers</a>`, { headers: { 'content-type': 'text/html' } }); },
    launchBrowser: async () => ({
      async newPage() { return { async goto() {}, async content() { return html; }, url() { return browserUrl; }, async close() {} }; },
      async close() {},
    }),
  });
  t.after(() => fetchary.close());
  const source = await fetchary.add(browserUrl, { waitAfterLoad: 0 });
  await fetchary.setVendorActive('github', false);
  assert.equal(await fetchary.followerCount(source.id), 63, 'activation affects capture actions, not archive reads');
  const first = await fetchary.version(source.id);
  html = '<a href="/example?tab=followers">64 followers</a>';
  await fetchary.fetch(source.id);
  assert.equal(await fetchary.followerCount(source.id), 64);
  assert.deepEqual((await fetchary.followers()).followers.map(row => [row.id, row.follower, row.name]), [[source.id, 64, 'github']]);
  assert.equal((await fetchary.followers()).sum, 64);
  assert.equal(await fetchary.read(source.id), '<a href="/example?tab=followers">10 followers</a>');
  assert.equal(fs.readFileSync(first.renderedFile, 'utf8'), '<a href="/example?tab=followers">63 followers</a>');
  assert.equal((await fetchary.history(source.id)).length, 2);
  assert.equal(fetches, 2);
  const raw = await fetchary.add('https://github.com/raw', { mode: 'http' });
  assert.equal(await fetchary.followerCount(raw.id), 10, 'HTTP-only captures fall back to raw HTML');
  assert.equal((await fetchary.followers()).sum, 74);
  const unsupported = await fetchary.add('https://example.test/', { mode: 'http' });
  await assert.rejects(() => fetchary.followerCount(unsupported.id), FetcharyValidationError);
  html = '<main>Login required</main>';
  await fetchary.fetch(source.id);
  await assert.rejects(() => fetchary.followerCount(source.id), FetcharyNotFoundError);
  browserUrl = 'https://example.test/';
  html = '<a href="https://github.com/example?tab=followers">100 followers</a>';
  await fetchary.fetch(source.id);
  await assert.rejects(() => fetchary.followerCount(source.id), FetcharyValidationError);
  await assert.rejects(() => fetchary.followerCount(99999), FetcharyNotFoundError);
  await fetchary.close();
  await assert.rejects(() => fetchary.followerCount(source.id), /instance is closed/);
  fetchary = await createFetchary({ dataDir, fetch: async () => { throw new Error('archive reads must not fetch'); } });
  assert.equal(await fetchary.followerCount(raw.id), 10);
  await assert.rejects(() => fetchary.followerCount(source.id), FetcharyValidationError);
  assert.equal((await fetchary.followers()).sum, 10);
  assert.deepEqual(await fetchary.followers({ tag: 'unknown' }), { followers: [], sum: 0 });
  await fetchary.close();
  await assert.rejects(() => fetchary.followers(), /instance is closed/);
});

test('follower lists report storage errors and avoid silently rounding an overflowing total', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-follower-sum-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const fetchary = await createFetchary({
    dataDir,
    fetch: async url => new Response(`<a href="${new URL(url).pathname}?tab=followers">${url.endsWith('/large') ? Number.MAX_SAFE_INTEGER : 1} followers</a>`, { headers: { 'content-type': 'text/html' } }),
  });
  t.after(() => fetchary.close());
  const large = await fetchary.add('https://github.com/large', { mode: 'http', tag: 'large' });
  await fetchary.add('https://github.com/small', { mode: 'http', tag: 'small' });
  await assert.rejects(() => fetchary.followers(), /follower sum exceeds the maximum safe integer/);
  assert.equal((await fetchary.followers({ tag: 'small' })).sum, 1);
  fs.rmSync((await fetchary.version(large.id)).file);
  await assert.rejects(() => fetchary.followers({ tag: 'large' }), /could not read rendered version/);
});
