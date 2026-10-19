'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const youtube = require('../src/vendors/youtube');
const { discoverVendors, prepareVendorSnapshot } = require('../src/vendors');
const api = require('../src');
const { main } = require('../cli');
const target = 'https://www.youtube.com/watch?v=AbC123';
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/social/youtube-comments.html'), 'utf8');
const insights = (html, url = target) => youtube.socialInsights(parseHTML(html).document, url);

test('YouTube reads the rendered comment heading for the matching video, including German NBSP labels and zero', () => {
  const result = insights(fixture);
  assert.equal(result.metrics.comments, 14); assert.equal(result.sources.comments.field, 'ytd-comments-header-renderer.#count');
  for (const [text, expected, approximate] of [['0 Kommentare', 0, false], ['1 Kommentar', 1, false], ['1.234 Kommentare', 1234, false], ['1.2K Comments', 1200, true]]) {
    const document = parseHTML(fixture).document;
    document.querySelector('ytd-watch-flexy[video-id="AbC123"] #count').textContent = text;
    const parsed = youtube.socialInsights(document, target);
    assert.equal(parsed.metrics.comments, expected, text); assert.equal(parsed.sources.comments.approximate, approximate);
  }
});

test('YouTube ignores unrelated videos, channel pages, hidden headers and text without a reported total', () => {
  assert.equal(insights(fixture, 'https://www.youtube.com/watch?v=abc123').metrics.comments, null);
  assert.equal(insights(fixture, 'https://www.youtube.com/@example').metrics.comments, null);
  for (const attribute of ['hidden', 'aria-hidden="true"', 'inert']) {
    assert.equal(insights(fixture.replace('<ytd-watch-flexy video-id="AbC123">', `<ytd-watch-flexy video-id="AbC123" ${attribute}>`)).metrics.comments, null);
    assert.equal(insights(fixture.replace('<h2 id="count" class=', `<h2 id="count" ${attribute} class=`)).metrics.comments, null);
  }
  const document = parseHTML(fixture).document;
  document.querySelector('ytd-watch-flexy[video-id="AbC123"] #count').textContent = 'Kommentare sind deaktiviert';
  assert.equal(youtube.socialInsights(document, target).metrics.comments, null);
});

test('YouTube retains structured comment totals when the lazy placeholder has no number', () => {
  const html = '<script>var ytInitialData = ' + JSON.stringify({ currentVideoEndpoint: { watchEndpoint: { videoId: 'AbC123' } },
    contents: { twoColumnWatchNextResults: { results: { results: { contents: [{ commentsHeaderRenderer: {
      countText: { simpleText: 'Kommentare' }, commentsCount: { runs: [{ text: '14' }] },
    } }] } } } } }) + ';</script>';
  assert.equal(insights(html).metrics.comments, 14);
  assert.equal(insights(html).sources.comments.field, 'commentsHeaderRenderer.commentsCount');
  assert.equal(insights(html, 'https://www.youtube.com/watch?v=Other').metrics.comments, null);
});

test('generic snapshot preparation retries pending vendors, runs once after success and isolates optional failures', async () => {
  let pending = 0; let completed = 0; let failed = 0;
  const vendors = [
    { name: 'pending', matches: () => true, prepareSnapshot: async () => ++pending > 1 },
    { name: 'complete', matches: () => true, prepareSnapshot: async () => { completed++; } },
    { name: 'failed', matches: () => true, prepareSnapshot: async () => { failed++; throw new Error('optional'); } },
    { name: 'unrelated', matches: () => false, prepareSnapshot: async () => assert.fail('unrelated vendor') },
  ];
  const prepared = new Set();
  for (let index = 0; index < 3; index++) await prepareVendorSnapshot({}, target, prepared, vendors);
  assert.equal(pending, 2); assert.equal(completed, 1); assert.equal(failed, 3);
  assert.deepEqual([...prepared].sort(), ['complete', 'pending']);
});

test('vendor discovery validates optional snapshot preparation hooks', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-snapshot-vendor-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'invalid.js'), "module.exports = { name:'invalid', matches:()=>true, overlays:[], prepareSnapshot:true };");
  assert.throws(() => discoverVendors(directory), api.FetcharyValidationError);
});

test('YouTube preparation remains pending on consent pages and skips channel scrolling', async () => {
  let evaluations = 0;
  const page = { evaluate: async (callback, videoId) => { evaluations++; assert.equal(videoId, 'AbC123'); return true; } };
  const prepared = new Set();
  await prepareVendorSnapshot(page, 'https://consent.youtube.com/m', prepared, [youtube]);
  assert.equal(prepared.has('youtube'), false); assert.equal(evaluations, 0);
  assert.equal(await youtube.prepareSnapshot(page, 'https://www.youtube.com/@example'), true); assert.equal(evaluations, 0);
  await prepareVendorSnapshot(page, target, prepared, [youtube]);
  assert.equal(prepared.has('youtube'), true); assert.equal(evaluations, 1);
});

function lazyPage() {
  return '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<style>ytd-watch-flexy,ytd-comments,ytd-comments-header-renderer{display:block}#spacer{height:1800px}</style>' +
    '<aside><h2>999 Kommentare</h2></aside><ytd-watch-flexy video-id="AbC123"><div id="spacer"></div><div id="mount"></div></ytd-watch-flexy>' +
    `<script>
      setTimeout(() => {
        document.querySelector('#mount').innerHTML = '<ytd-comments id="comments"><ytd-comments-header-renderer><h2 id="count">Kommentare</h2></ytd-comments-header-renderer></ytd-comments>';
        const comments = document.querySelector('ytd-comments');
        let restored = false;
        const observer = new IntersectionObserver(entries => {
          if (!entries.some(entry => entry.isIntersecting)) return;
          if (!restored) { restored = true; scrollTo({top:0,behavior:'instant'}); return; }
          observer.disconnect();
          setTimeout(() => document.querySelector('ytd-comments #count').textContent = '14\\u00a0Kommentare', 50);
        });
        observer.observe(comments);
      }, 35);
    </script></body></html>`;
}

test('real Chromium and CLI load the lazy comment heading within the existing wait budget', async () => {
  const options = { mode: 'browser', timeout: 15000, waitAfterLoad: 600, cacheTtlMs: 0,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }], fetch: async () => new Response(lazyPage(), { headers: { 'content-type': 'text/html' } }) };
  const result = await api.extractSocialInsights(target, options);
  assert.equal(result.data.metrics.comments, 14); assert.equal(result.data.sources.comments.field, 'ytd-comments-header-renderer.#count');
  let stdout = ''; let stderr = '';
  const code = await main(['extract', 'social-insights', target, '--mode', 'browser', '--wait-after-load', '600ms', '--no-history'], {
    options, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } },
  });
  assert.equal(code, 0, stderr); assert.equal(JSON.parse(stdout).data.metrics.comments, 14); assert.equal(stderr, '');
});
