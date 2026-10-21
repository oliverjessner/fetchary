'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const youtube = require('../src/vendors/youtube');
const api = require('../src');
const target = 'https://www.youtube.com/channel/UCrM7B7SL_g1edFOnmj-SDKg';
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/social/youtube-channel-header.html'), 'utf8');
const insights = (html, url = target) => youtube.socialInsights(parseHTML(html).document, url);
function embeddedHeader(parts, extra = {}) {
  return '<script>var ytInitialData = ' + JSON.stringify({
    metadata: { channelMetadataRenderer: { externalId: 'UCrM7B7SL_g1edFOnmj-SDKg' } },
    header: { pageHeaderRenderer: { content: { pageHeaderViewModel: {
      metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: parts }] } },
      description: { descriptionPreviewViewModel: { description: { content: '999.999 Videos' } } },
    } } } },
    contents: { channelRenderer: { videoCountText: { simpleText: '888.888 Videos' } } },
    ...extra,
  }) + ';</script>';
}

test('YouTube maps the supplied modern channel header video total to posts', () => {
  for (const url of [target, target + '/videos', 'https://www.youtube.com/@BloombergTech', 'https://www.youtube.com/c/BloombergTech', 'https://www.youtube.com/user/BloombergTech']) {
    const result = insights(fixture, url);
    assert.equal(result.metrics.posts, 14361, url);
    assert.deepEqual(result.sources.posts, { type: 'vendor', field: 'channelHeader.videoCount', approximate: false });
    assert.equal(result.unavailable.posts, undefined);
  }
});

test('rendered YouTube video totals preserve zero, localized grouping, abbreviations and accessibility labels', () => {
  for (const [value, expected, approximate] of [['0 Videos', 0, false], ['1 video', 1, false], ['14,361 videos', 14361, false], ['14\u202f361 Videos', 14361, false], ['14.3K videos', 14300, true], ['1,2 Mio. Videos', 1200000, true]]) {
    const result = insights(fixture.replace('14.361 Videos', value));
    assert.equal(result.metrics.posts, expected, value); assert.equal(result.sources.posts.approximate, approximate);
  }
  const exact = insights(fixture.replace('<span class="" dir="auto" style="">14.361 Videos</span>', '<span aria-label="14.361 Videos">14.3K videos</span>'));
  assert.equal(exact.metrics.posts, 14361); assert.equal(exact.sources.posts.approximate, false);
});

test('YouTube ignores video totals outside channel metadata, hidden headers and watch pages', () => {
  for (const value of ['Videos', 'Videos are hidden', '742.000 Abonnenten']) {
    const result = insights(fixture.replace('14.361 Videos', value));
    assert.equal(result.metrics.posts, null); assert.equal(result.unavailable.posts, 'not_exposed');
  }
  for (const attribute of ['hidden', 'aria-hidden="true"', 'inert']) {
    assert.equal(insights(fixture.replace('<div class="ytPageHeaderViewModelHeadline">', `<div ${attribute} class="ytPageHeaderViewModelHeadline">`)).metrics.posts, null);
  }
  const video = insights(fixture, 'https://www.youtube.com/watch?v=AbC123');
  assert.equal(video.metrics.posts, null); assert.equal(video.unavailable.posts, 'unsupported');
});

test('modern YouTube embedded channel metadata exposes posts and subscribers without rendering', async () => {
  const html = '<script type="application/json">null</script><script>var ytInitialData = {broken};</script>' +
    embeddedHeader([{ text: { content: '@BloombergTech' } }, { text: { content: '742.000 Abonnenten' } }, { text: { content: '14.361 Videos' } }]);
  const result = await api.extractSocialInsights(target, {
    mode: 'auto', allowPrivateNetwork: true, cacheTtlMs: 0,
    fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async () => assert.fail('complete embedded metrics do not need Chromium'),
  });
  assert.equal(result.captureMode, 'http'); assert.equal(result.data.status, 'available');
  assert.equal(result.data.metrics.posts, 14361); assert.equal(result.data.metrics.subscribers, 742000);
  assert.equal(result.data.sources.posts.type, 'embedded-json'); assert.equal(result.data.sources.posts.approximate, false);
});

test('modern YouTube metadata retains zero, approximation and exact accessibility counts', () => {
  for (const [part, expected, approximate] of [
    [{ text: { content: '0 videos' } }, 0, false],
    [{ text: { content: '14.3K videos' } }, 14300, true],
    [{ text: { content: '14.3K videos' }, accessibilityLabel: '14,361 videos' }, 14361, false],
  ]) {
    const result = insights(embeddedHeader([part]));
    assert.equal(result.metrics.posts, expected); assert.equal(result.sources.posts.approximate, approximate);
    assert.equal(result.status, 'partial'); assert.equal(result.unavailable.subscribers, 'not_exposed');
  }
});

test('YouTube never substitutes recommendation counts, descriptions or another channel header', () => {
  assert.equal(insights(embeddedHeader([{ text: { content: '742K subscribers' } }])).metrics.posts, null);
  const wrong = embeddedHeader([{ text: { content: '14.361 Videos' } }], { metadata: { channelMetadataRenderer: { externalId: 'UCother' } } });
  assert.equal(insights(wrong).metrics.posts, null);
  const nested = embeddedHeader([], { contents: { header: { c4TabbedHeaderRenderer: { videosCountText: { simpleText: '888.888 Videos' } } } } });
  assert.equal(insights(nested).metrics.posts, null);
});

test('legacy YouTube headers expose channel video totals and keep missing totals unknown', () => {
  for (const field of ['videosCountText', 'videoCountText']) {
    const html = '<script>var ytInitialData = ' + JSON.stringify({ header: { c4TabbedHeaderRenderer: {
      channelId: 'UCrM7B7SL_g1edFOnmj-SDKg', subscriberCountText: { simpleText: '742K subscribers' },
      [field]: { runs: [{ text: '14,361' }, { text: ' videos' }] },
    } } }) + ';</script>';
    assert.equal(insights(html).metrics.posts, 14361);
    assert.equal(insights(html.replace('UCrM7B7SL_g1edFOnmj-SDKg', 'UCother')).metrics.posts, null);
  }
  assert.equal(insights('<ytd-c4-tabbed-header-renderer><span id="videos-count">0 videos</span></ytd-c4-tabbed-header-renderer>').metrics.posts, 0);
  const missing = insights('<ytd-c4-tabbed-header-renderer><span id="subscriber-count">742K subscribers</span></ytd-c4-tabbed-header-renderer>');
  assert.equal(missing.metrics.posts, null); assert.equal(missing.unavailable.posts, 'not_exposed'); assert.equal(missing.status, 'partial');
});
