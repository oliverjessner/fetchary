'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const api = require('../src');
const { main } = require('../cli');
const url = 'https://example.test/path/page';
function options(html, extra = {}) {
  return { mode: 'http', allowPrivateNetwork: true, fetch: async target => {
    assert.equal(target, url, 'only capture the supplied page');
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  }, ...extra };
}
async function cli(flags, settings) {
  let stdout = ''; let stderr = '';
  const code = await main(['extract', 'videos', url, ...flags], { options: settings,
    stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { code, stdout, stderr };
}

test('videos discover media elements, direct files, MIME/download/query hints and stream manifests', async () => {
  const html = '<base href="https://cdn.test/media/"><video src="main" poster="poster.jpg"><source src="clip.webm" type="video/webm"><source data-src="lazy.mp4"></video>'
    + '<a href="file.MP4?token=1&amp;x=2#t=3">File</a><area href="/map.mov"><link href="/stream.m3u8" rel="preload" as="video">'
    + '<a href="/download" download="movie.mkv">Download</a><a href="/query?filename=movie%2Emp4">Query</a><a href="/format?format=mpd">DASH</a>'
    + '<embed src="/mime" type="video/mp4; codecs=avc1"><object data="/film.ogv"></object><iframe data-src="/lazy.webm"></iframe>';
  const result = await api.extractVideos(url, options(html));
  assert.equal(result.data, result.videos); assert.equal(result.type, 'videos');
  assert.deepEqual(result.data.map(item => item.url), ['https://cdn.test/media/main', 'https://cdn.test/media/clip.webm', 'https://cdn.test/media/lazy.mp4',
    'https://cdn.test/media/file.MP4?token=1&x=2#t=3', 'https://cdn.test/map.mov', 'https://cdn.test/stream.m3u8',
    'https://cdn.test/download', 'https://cdn.test/query?filename=movie%2Emp4', 'https://cdn.test/format?format=mpd',
    'https://cdn.test/mime', 'https://cdn.test/film.ogv', 'https://cdn.test/lazy.webm']);
  assert.equal(result.data[0].extension, null); assert.equal(result.data[1].contentType, 'video/webm');
  assert.equal(result.data[2].originalAttribute, 'data-src'); assert.equal(result.data[3].rawUrl, 'file.MP4?token=1&x=2#t=3');
  assert.equal(result.data[5].contentType, 'application/vnd.apple.mpegurl'); assert.equal(result.data[6].extension, 'mkv');
  assert.equal(result.data[8].contentType, 'application/dash+xml'); assert.equal(result.data[9].contentType, 'video/mp4');
});

test('videos include individual social video links and embedded players, excluding profiles and ordinary frames', async () => {
  const targets = [
    ['https://www.youtube.com/watch?v=abc123', 'youtube'], ['https://youtu.be/abc123', 'youtube'],
    ['https://www.youtube.com/shorts/abc123', 'youtube'], ['https://www.youtube-nocookie.com/embed/abc123', 'youtube'],
    ['https://vimeo.com/123456', 'vimeo'], ['https://player.vimeo.com/video/123456?h=xyz', 'vimeo'],
    ['https://www.tiktok.com/@example/video/123456', 'tiktok'], ['https://www.tiktok.com/embed/v2/123456', 'tiktok'],
    ['https://www.instagram.com/reel/example/', 'instagram'], ['https://www.facebook.com/example/videos/123456/', 'facebook'],
    ['https://www.facebook.com/watch/?v=123456', 'facebook'], ['https://www.twitch.tv/videos/123456', 'twitch'],
    ['https://player.twitch.tv/?video=v123456&parent=example.test', 'twitch'], ['https://clips.twitch.tv/embed?clip=Example&parent=example.test', 'twitch'],
  ];
  const html = targets.map(([target], index) => index % 2 ? `<iframe src="${target.replaceAll('&', '&amp;')}"></iframe>` : `<a href="${target}">Video</a>`).join('')
    + '<a href="https://youtube.com/@example">Profile</a><a href="https://vimeo.com/example">Profile</a><iframe src="/ordinary-page"></iframe>'
    + '<a href="https://facebook.com/watch/">Directory</a><a href="https://facebook.com/example/videos/">Directory</a>'
    + '<a href="https://youtube.com.evil.test/watch?v=abc">Spoof</a><iframe src="https://player.vimeo.com.evil.test/video/123"></iframe>';
  const data = (await api.extractVideos(url, options(html))).data;
  assert.deepEqual(data.map(item => [item.url, item.platform]), targets);
});

test('videos discover Open Graph, Twitter and nested Schema.org VideoObject references', async () => {
  const html = '<meta property="og:video" content="/og.mp4"><meta property="og:video:secure_url" content="https://cdn.test/secure.mp4">'
    + '<meta name="twitter:player" content="/player"><meta name="twitter:player:stream" content="/stream">'
    + '<meta property="og:video:type" content="video/mp4"><meta property="og:image" content="/poster.jpg">'
    + '<script type="application/ld+json">{"@graph":[{"@type":"Article","url":"/article","video":{"@type":["CreativeWork","https://schema.org/VideoObject"],"contentUrl":["/json.mp4",{"@id":"/other.webm"}],"embedUrl":"https://player.vimeo.com/video/42","url":"/watch"}},{"@type":"ImageObject","contentUrl":"/image.jpg"}]}</script>'
    + '<script type="application/ld+json">invalid</script><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"javascript:alert(1)"}</script>'
    + '<div itemscope itemtype="https://schema.org/VideoObject"><meta itemprop="contentUrl" content="/micro.mp4"><a itemprop="embedUrl" href="/micro-player">Player</a></div>';
  const data = (await api.extractVideos(url, options(html))).data;
  assert.deepEqual(data.map(item => item.url), ['https://example.test/og.mp4', 'https://cdn.test/secure.mp4', 'https://example.test/player', 'https://example.test/stream',
    'https://example.test/json.mp4', 'https://example.test/other.webm', 'https://player.vimeo.com/video/42', 'https://example.test/watch',
    'https://example.test/micro.mp4', 'https://example.test/micro-player']);
  assert.equal(data[4].source, 'json-ld'); assert.equal(data[4].originalAttribute, 'contentUrl'); assert.equal(data[4].contentType, 'video/mp4');
  assert.equal(data[6].platform, 'vimeo'); assert.equal(data[8].source, 'meta');
});

test('videos reject unsafe URLs, inert content, audio, pictures and unrelated resources', async () => {
  const html = '<video src="blob:https://example.test/id" poster="/poster.mp4"><source src="data:video/mp4,abc"></video>'
    + '<a href="https://user:secret@example.test/private.mp4">Credentials</a><video src="javascript:alert(1)"></video>'
    + '<audio src="/audio.mp4"><source src="/audio.webm"></audio><picture><source src="/picture.mp4"></picture>'
    + '<a href="/sound.mp4" type="audio/mp4">Audio</a><img src="/photo.mp4"><a href="/photo.jpg">Photo</a><a href="/sound.mp3">Sound</a>'
    + '<template><video src="/template.mp4"></video></template><noscript><a href="/noscript.mp4">Inert</a></noscript>'
    + '<script>const html="<video src=\"/script.mp4\"></video>";</script><video src=""></video><iframe src="about:blank"></iframe>';
  assert.deepEqual((await api.extractVideos(url, options(html))).data, []);
  const plain = options('', { fetch: async () => new Response('<video src="/not-html.mp4"></video>', { headers: { 'content-type': 'text/plain' } }) });
  assert.deepEqual((await api.extractVideos(url, plain)).data, []);
});

test('video scopes retain the full document base and preserve repeated occurrences', async () => {
  const html = '<base href="https://cdn.test/files/"><nav><a href="outside.mp4">Outside</a></nav>'
    + '<main><video src="inside.mp4"></video><a href="inside.mp4">Again</a><aside><a href="ignore.mp4">Ignore</a></aside></main>'
    + '<main><a href="second.mp4">Second main</a></main>';
  const settings = options(html, { includeSelectors: ['main', 'main video'], ignoreSelectors: ['aside'] });
  assert.deepEqual((await api.extractVideos(url, settings)).data.map(item => item.url), ['https://cdn.test/files/inside.mp4', 'https://cdn.test/files/inside.mp4']);
  assert.deepEqual((await api.extractVideos(url, { ...settings, ignoreSelectors: ['main'] })).data, []);
  assert.deepEqual((await api.extractVideos(url, { ...settings, includeSelectors: ['missing'] })).data, []);
});

test('video API, dispatcher and isolated clients reuse captures and keep results independent', async () => {
  let requests = 0;
  const settings = options('<video src="/clip.mp4"></video>', { fetch: async () => {
    requests++; return new Response('<video src="/clip.mp4"></video>', { headers: { 'content-type': 'text/html' } });
  } });
  for (const extractor of [api, api.createExtractor(settings)]) {
    const first = await extractor.extract(url, { ...settings, type: 'videos' });
    first.data[0].url = 'changed'; first.videos.pop();
    const next = await extractor.extractVideos(url, settings);
    assert.equal(next.cache.hit, true); assert.equal(next.data[0].url, 'https://example.test/clip.mp4'); assert.equal(next.videos, next.data);
  }
  assert.equal(requests, 2);
});

test('video validation precedes requests; response limits and cancellation keep typed errors', async () => {
  let requests = 0;
  const settings = options('', { fetch: async () => { requests++; return new Response('<video src="/clip.mp4"></video>'); } });
  for (const extra of [{ includeSelectors: ['['] }, { ignoreSelectors: 'main' }, null]) {
    await assert.rejects(api.extractVideos(url, extra === null ? null : { ...settings, ...extra }), api.FetcharyValidationError);
  }
  await assert.rejects(api.extractVideos('file:///private', settings), api.FetcharyValidationError);
  assert.equal(requests, 0);
  await assert.rejects(api.extractVideos(url, { ...settings, maxResponseBytes: 4 }), api.FetcharyFetchError);
  await assert.rejects(api.extractVideos(url, { ...settings, signal: AbortSignal.abort() }), api.FetcharyFetchError);
});

test('video CLI defaults to JSON, lists unique URLs and supports scopes, aliases and output precedence', async () => {
  const settings = options('<main><video src="/clip.mp4"></video><a href="/clip.mp4">Again</a></main><footer><a href="/other.mp4">Other</a></footer>');
  const scope = ['--include-selector', 'main'];
  const full = await cli(scope, settings);
  assert.equal(full.code, 0, full.stderr); assert.equal(JSON.parse(full.stdout).data.length, 2);
  for (const flag of ['--list', '--urls-only']) {
    const result = await cli([...scope, flag, '--verbose'], settings);
    assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, 'https://example.test/clip.mp4\n'); assert.equal(result.stderr, 'Extracting videos (http)\n');
    assert.equal(JSON.parse((await cli([...scope, flag, '--json'], settings)).stdout).data.length, 2);
  }
  assert.equal((await cli(['--list', '--quiet'], settings)).stdout, '');
  const empty = await cli(['--list'], options('<p>No videos</p>'));
  assert.equal(empty.code, 0); assert.equal(empty.stdout, '');
  for (const flag of ['--binary', '--platform', '--source']) assert.equal((await cli([flag, ...(flag === '--binary' ? [] : ['youtube'])], settings)).code, 2);
});

test('auto video extraction renders missing scripted videos once and closes browser resources', async () => {
  let launches = 0; let closes = 0;
  const settings = options('<p>Loading videos</p><script></script>', { mode: 'auto', waitAfterLoad: 0, launchBrowser: async () => {
    launches++; return { newPage: async () => ({ goto: async () => {}, content: async () => '<video src="/dynamic.mp4"></video>', url: () => url,
      close: async () => { closes++; } }), close: async () => { closes++; } };
  } });
  const result = await api.extractVideos(url, settings);
  assert.equal(result.data[0].url, 'https://example.test/dynamic.mp4'); assert.equal(result.captureMode, 'browser');
  assert.equal(launches, 1); assert.equal(closes, 2);
});

test('real CLI and Chromium find JavaScript-inserted video URLs without downloading media', async t => {
  let mediaRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url.endsWith('.mp4')) { mediaRequests++; response.writeHead(500); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body><main></main><script>const video=document.createElement("video");video.preload="none";video.src="/rendered.mp4";document.querySelector("main").append(video);</script></body></html>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const target = `http://127.0.0.1:${server.address().port}/`;
  const child = spawn(process.execPath, [path.resolve(__dirname, '../cli/index.js'), 'extract', 'videos', target, '--mode', 'auto', '--wait-after-load', '0ms', '--allow-private-network', '--list']);
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0, stderr); assert.equal(stdout, `${target}rendered.mp4\n`); assert.equal(mediaRequests, 0);
});
