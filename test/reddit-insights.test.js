'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const reddit = require('../src/vendors/reddit');
const { countDetails } = require('../src/metrics/insights');
const { parseCount } = require('../src/metrics/followers');
const api = require('../src');
const { main } = require('../cli');
const target = 'https://www.reddit.com/r/ANBERNIC/comments/1xbdac6/i_did_the_impossible/';
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/social/reddit-post.html'), 'utf8');
const insights = (html, url = target) => reddit.socialInsights(parseHTML(html).document, url);
const settings = (html = fixture, extra = {}) => ({ mode: 'http', allowPrivateNetwork: true, cacheTtlMs: 0,
  fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), ...extra });
const json = object => '<script type="application/json">' + JSON.stringify(object) + '</script>';

test('Reddit reads the matching post score and comment total with provenance', () => {
  const result = insights(fixture);
  assert.equal(result.status, 'available'); assert.equal(result.metrics.score, 105); assert.equal(result.metrics.comments, 37);
  assert.deepEqual(result.sources.score, { type: 'vendor', field: 'shreddit-post.score', approximate: false });
  assert.equal(result.sources.comments.field, 'shreddit-post.comment-count');
  for (const name of ['likes', 'views', 'shares', 'saves', 'followers', 'following', 'posts', 'subscribers']) {
    assert.equal(result.metrics[name], null); assert.equal(result.unavailable[name], 'unsupported');
  }
});

test('Reddit scores retain zero, signed values, compact precision and grouped integers', () => {
  for (const [value, expected, approximate] of [['0', 0, false], ['-12', -12, false], ['−12', -12, false], ['1,234', 1234, false], ['1.234', 1234, false], ['1.2K', 1200, true], ['-1.2K', -1200, true]]) {
    const result = insights(fixture.replace('score="105"', `score="${value}"`).replace('comment-count="37"', 'comment-count="0"'));
    assert.equal(result.metrics.score, expected, value); assert.equal(result.sources.score.approximate, approximate);
    assert.equal(result.metrics.comments, 0);
  }
  for (const value of ['hidden', '1.25', '9007199254740992', '-9007199254740992']) {
    const result = insights(fixture.replace('score="105"', `score="${value}"`));
    assert.equal(result.metrics.score, null, value); assert.equal(result.status, 'partial'); assert.equal(result.unavailable.score, 'not_exposed');
  }
  assert.equal(insights(fixture.replace('comment-count="37"', 'comment-count="-1"')).metrics.comments, null);
  assert.equal(parseCount(-1), null); assert.equal(countDetails(-1), null);
});

test('Reddit ignores unrelated posts, conflicting permalinks and hidden cards', () => {
  assert.equal(insights(fixture, target.replace('1xbdac6', 'different')).metrics.score, null);
  assert.equal(insights(fixture.replace('permalink="/r/ANBERNIC/comments/1xbdac6/i_did_the_impossible/"', 'permalink="/r/ANBERNIC/comments/different/other/"')).metrics.score, null);
  for (const attribute of ['hidden', 'aria-hidden="true"', 'inert']) {
    const result = insights(fixture.replace('<shreddit-post id="t3_1xbdac6"', `<shreddit-post ${attribute} id="t3_1xbdac6"`));
    assert.equal(result.metrics.score, null); assert.equal(result.metrics.comments, null);
  }
  const hiddenScore = insights(fixture.replace('score="105"', 'score="105" score-hidden'));
  assert.equal(hiddenScore.metrics.score, null); assert.equal(hiddenScore.metrics.comments, 37);
  assert.equal(insights(fixture.replace('score="105"', 'score="105" score-hidden="false"')).metrics.score, 105);
});

test('Reddit reads only matching t3 embedded post data and respects hidden scores', () => {
  const data = { name: 't3_1xbdac6', id: '1xbdac6', permalink: '/r/ANBERNIC/comments/1xbdac6/i_did_the_impossible/', score: -2, num_comments: 0 };
  const listing = json({ kind: 'Listing', data: { children: [
    { kind: 't3', data },
    { kind: 't3', data: { name: 't3_other', score: 9999, num_comments: 999 } },
    { kind: 't1', data: { name: 't1_1xbdac6', id: '1xbdac6', score: 888, num_comments: 888 } },
  ] } });
  const result = insights(listing);
  assert.equal(result.metrics.score, -2); assert.equal(result.metrics.comments, 0); assert.equal(result.sources.score.type, 'embedded-json');
  assert.equal(insights(json({ kind: 't3', data: { ...data, name: undefined } })).metrics.score, -2);
  assert.equal(insights(json({ ...data, score_hidden: true })).metrics.score, null);
  assert.equal(insights(json({ ...data, permalink: '/r/ANBERNIC/comments/other/' })).metrics.score, null);
  assert.equal(insights(json({ id: '1xbdac6', score: 9999, num_comments: 999 })).metrics.score, null);
  assert.equal(insights(json({ kind: 't1', data: { id: '1xbdac6', score: 9999, num_comments: 999 } })).metrics.score, null);
  const rendered = insights(fixture + json({ ...data, score: 100 }));
  assert.equal(rendered.metrics.score, 105); assert.equal(rendered.sources.score.type, 'vendor');
  assert.equal(insights(fixture.replace('score="105"', 'score="105" score-hidden') + json(data)).metrics.score, null);
});

test('Reddit post metrics have explicit missing values while profiles and communities remain unsupported', () => {
  const empty = insights('<title>Reddit</title>');
  assert.equal(empty.status, 'unavailable'); assert.equal(empty.unavailable.score, 'not_exposed'); assert.equal(empty.unavailable.comments, 'not_exposed');
  for (const url of ['https://www.reddit.com/user/example/', 'https://www.reddit.com/r/ANBERNIC/']) {
    const result = insights(fixture, url);
    assert.equal(result.status, 'unsupported'); assert.ok(Object.values(result.metrics).every(value => value === null));
  }
});

test('Reddit library and aliases retain post identity and avoid Chromium for complete HTTP counters', async () => {
  for (const url of [target, 'https://old.reddit.com/r/ANBERNIC/comments/1xbdac6/i_did_the_impossible/', 'https://redd.it/1xbdac6']) {
    const result = await api.extractSocialInsights(url, settings(fixture, { mode: 'auto', launchBrowser: async () => assert.fail('complete HTTP counters do not need Chromium') }));
    assert.equal(result.data.metrics.score, 105); assert.equal(result.data.metrics.comments, 37); assert.equal(result.captureMode, 'http');
  }
  const mismatch = await api.extractSocialInsights(target, settings(fixture.replaceAll('1xbdac6', 'different')));
  assert.equal(mismatch.data.unavailable.score, 'identity_mismatch'); assert.equal(mismatch.data.metrics.score, null);
});

test('Reddit auto mode uses ordinary rendering for a JavaScript-only HTTP response', async () => {
  let launches = 0;
  const result = await api.extractSocialInsights(target, settings('<title>Reddit</title><script>window.loading = true</script>', {
    mode: 'auto', waitAfterLoad: 0, launchBrowser: async () => {
      launches++;
      return { newPage: async () => ({ goto: async () => {}, content: async () => fixture, url: () => target, close: async () => {} }), close: async () => {} };
    },
  }));
  assert.equal(launches, 1); assert.equal(result.captureMode, 'browser'); assert.equal(result.data.metrics.score, 105); assert.equal(result.data.metrics.comments, 37);
});

test('real Chromium and CLI expose Reddit score and comment totals without account metrics', async () => {
  const options = settings(fixture, { mode: 'browser', timeout: 15000, waitAfterLoad: 0,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  const result = await api.extractSocialInsights(target, options);
  assert.equal(result.data.metrics.score, 105); assert.equal(result.data.metrics.comments, 37); assert.equal(result.captureMode, 'browser');
  let stdout = ''; let stderr = '';
  const code = await main(['extract', 'social-insights', target, '--no-history'], { options,
    stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } },
  });
  assert.equal(code, 0, stderr); assert.equal(stderr, '');
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.data.metrics.score, 105); assert.equal(parsed.data.metrics.comments, 37); assert.equal(parsed.data.metrics.likes, null);
  assert.equal(parsed.data.status, 'available');
});
