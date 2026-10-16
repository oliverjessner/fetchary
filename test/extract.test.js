'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { extract, extractFavicon, extractProfilePicture, createFetchary, FetcharyValidationError, FetcharyNotFoundError, FetcharyFetchError } = require('../src');
const { main } = require('../cli/index');
const { imageDimensions } = require('../src/extract/images');

function png(width, height) {
  function chunk(type, data) {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, payload, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(height * (1 + width * 4)))), chunk('IEND', Buffer.alloc(0))]);
}

function fixtureFetch(entries, requests = []) {
  return async url => {
    requests.push(url);
    const entry = entries[url];
    if (!entry) return new Response('missing', { status: 404 });
    const [body, type = 'text/html', finalUrl = url] = Array.isArray(entry) ? entry : [entry];
    const response = new Response(body, { headers: { 'content-type': type } });
    Object.defineProperty(response, 'url', { value: finalUrl });
    return response;
  };
}

function ico(...images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt32LE(0x00010000); directory.writeUInt16LE(images.length, 4);
  let start = directory.length;
  images.forEach((body, index) => {
    const { width, height } = imageDimensions(body);
    const offset = 6 + index * 16;
    directory[offset] = width === 256 ? 0 : width;
    directory[offset + 1] = height === 256 ? 0 : height;
    directory.writeUInt32LE(body.length, offset + 8);
    directory.writeUInt32LE(start, offset + 12);
    start += body.length;
  });
  return Buffer.concat([directory, ...images]);
}

function fakeBrowser(html, finalUrl, state = {}) {
  return async () => ({
    newPage: async () => ({
      goto: async () => {}, url: () => finalUrl, content: async () => html,
      evaluate: async () => false, close: async () => { state.pageClosed = true; },
    }),
    close: async () => { state.browserClosed = true; },
  });
}

test('one-shot extraction selects content without storage, supports HTTP resources and closes Chromium', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-extract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'must-not-exist');
  const url = 'https://example.test/';
  const state = {};
  const fetch = fixtureFetch({ [url]: '<main>raw</main>' });
  const options = { fetch, launchBrowser: fakeBrowser('<main>rendered <time>clock</time></main><main>second</main>', url, state), waitAfterLoad: 0, dataDir };
  const result = await extract(url, { ...options, format: 'text', includeSelectors: ['main'], ignoreSelectors: ['time'] });
  assert.equal(result.content, 'rendered');
  assert.equal(result.captureMode, 'browser');
  assert.equal(result.finalUrl, url);
  assert.equal(state.pageClosed, true);
  assert.equal(state.browserClosed, true);
  assert.equal(fs.existsSync(dataDir), false);
  assert.equal((await extract(url, { fetch, mode: 'http' })).content, '<main>raw</main>');
  const json = await extract(url, { fetch: fixtureFetch({ [url]: ['{"value":"<b>text</b>"}', 'application/json'] }), format: 'text' });
  assert.equal(json.content, '{"value":"<b>text</b>"}');
  assert.equal(json.captureMode, 'http');
  await assert.rejects(extract(url, { mode: 'invalid' }), FetcharyValidationError);
  await assert.rejects(extract(url, { waitAfterLoad: '-1s' }), FetcharyValidationError);
  await assert.rejects(extract(url, { format: 'pdf' }), FetcharyValidationError);
  await assert.rejects(extract(url, { includeSelectors: ['['] }), FetcharyValidationError);
  await assert.rejects(extract('file:///tmp/page'), FetcharyValidationError);
  await assert.rejects(extract(url, { fetch: async () => new Response('', { status: 503 }), mode: 'http' }), FetcharyFetchError);
});

test('favicon checks real dimensions, base URLs, redirected manifests, duplicate and broken candidates', async () => {
  const url = 'https://example.test/start';
  const requests = [];
  const fetch = fixtureFetch({
    [url]: ['<base href="/assets/"><link rel="SHORTCUT ICON" href="small.png" sizes="2048x2048"><link rel="icon" href="small.png"><link rel="apple-touch-icon" href="touch.png"><link rel="icon" href="broken.png"><link rel="manifest" href="/manifest">', 'text/html', 'https://example.test/final'],
    'https://example.test/assets/small.png': [png(16, 16), 'image/png'],
    'https://example.test/assets/touch.png': [png(180, 180), 'image/png'],
    'https://example.test/assets/broken.png': ['<html>error</html>', 'image/png'],
    'https://example.test/manifest': [JSON.stringify({ icons: [{ src: 'large.png', sizes: '32x32' }] }), 'application/manifest+json', 'https://cdn.test/app/manifest.json'],
    'https://cdn.test/app/large.png': [png(512, 512), 'application/octet-stream'],
  }, requests);
  const result = await extractFavicon(url, { fetch });
  assert.equal(result.image.url, 'https://cdn.test/app/large.png');
  assert.equal(result.image.width, 512);
  assert.equal(result.image.height, 512);
  assert.equal(result.image.resolutionVerified, true);
  assert.equal(result.image.source, 'manifest');
  assert.equal(result.captureMode, 'http');
  assert.equal(requests.filter(target => target.endsWith('/small.png')).length, 1);
  assert.ok(requests.includes('https://example.test/favicon.ico'));
});

test('favicon prefers scalable SVG, reads ICO entries and supports root fallback and rendered icons', async () => {
  const url = 'https://example.test/';
  const iconFile = ico(png(16, 16), png(256, 256));
  assert.deepEqual(imageDimensions(iconFile), { width: 256, height: 256, type: 'image/x-icon', scalable: false });
  const fetch = fixtureFetch({
    [url]: '<link rel="icon" href="/raster.png"><link rel="icon" href="/vector.svg">',
    'https://example.test/raster.png': [png(512, 512), 'image/png'],
    'https://example.test/vector.svg': ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>', 'image/svg+xml'],
    'https://example.test/favicon.ico': [iconFile, 'image/x-icon'],
  });
  assert.equal((await extractFavicon(url, { fetch })).image.scalable, true);
  const fallback = await extractFavicon(url, { fetch: fixtureFetch({ [url]: '<html></html>', 'https://example.test/favicon.ico': [iconFile, 'image/x-icon'] }) });
  assert.equal(fallback.image.width, 256);
  assert.equal(fallback.image.source, 'fallback');
  const rendered = await extractFavicon(url, { fetch, mode: 'browser', waitAfterLoad: 0, launchBrowser: fakeBrowser('<link rel="icon" href="/vector.svg">', url) });
  assert.equal(rendered.captureMode, 'browser');
  await assert.rejects(extractFavicon(url, { fetch: fixtureFetch({ [url]: '<link rel="manifest" href="/bad.json">', 'https://example.test/bad.json': 'invalid' }) }), FetcharyNotFoundError);
  await assert.rejects(extractFavicon(url, { fetch: fixtureFetch({ [url]: '<link rel="icon" href="/invalid.png">', 'https://example.test/invalid.png': ['not an image', 'image/png'] }) }), FetcharyNotFoundError);
});

test('profile pictures use the target account on all eight vendors and exclude larger preview cards', async () => {
  const image = 'https://cdn.test/avatar.png';
  const thumb = 'https://cdn.test/small.png';
  const banner = 'https://cdn.test/banner.png';
  const json = data => `<script type="application/json">${JSON.stringify(data)}</script>`;
  const fixtures = [
    ['github', 'https://github.com/oli', '<div class="h-card"><img class="avatar-user" src="https://cdn.test/small.png" srcset="https://cdn.test/avatar.png 2x"></div>'],
    ['instagram', 'https://www.instagram.com/oli/', json([{ username: 'other', profile_pic_url_hd: banner }, { username: 'oli', profile_pic_url: thumb, profile_pic_url_hd: image }])],
    ['threads', 'https://www.threads.com/@oli', json({ username: 'oli', hd_profile_pic_url_info: { url: image } })],
    ['tiktok', 'https://www.tiktok.com/@oli', json({ userInfo: { user: { uniqueId: 'oli', avatarLarger: image, avatarThumb: thumb } } })],
    ['twitch', 'https://www.twitch.tv/oli', json({ login: 'oli', profileImageURL: image })],
    ['x', 'https://x.com/oli', `<div data-testid="UserAvatar-Container-oli"><a href="/oli/photo"><img src="${image}"></a></div><a href="/other/photo"><img src="${banner}"></a>`],
    ['youtube', 'https://www.youtube.com/@oli', `<link rel="canonical" href="https://www.youtube.com/channel/UC123"><script>var ytInitialData = ${JSON.stringify({ header: { c4TabbedHeaderRenderer: { avatar: { thumbnails: [{ url: thumb }, { url: image }] } } } })};</script>`],
    ['linkedin', 'https://de.linkedin.com/in/oli/', `<link rel="canonical" href="https://www.linkedin.com/in/oli/">${json({ '@type': 'Person', url: 'https://www.linkedin.com/in/oli/', image })}`],
  ];
  for (const [vendor, url, body] of fixtures) {
    const result = await extractProfilePicture(url, { mode: 'http', fetch: fixtureFetch({
      [url]: `${body}<meta property="og:image" content="${banner}">`,
      [image]: [png(256, 256), 'image/png'], [thumb]: [png(32, 32), 'image/png'], [banner]: [png(1200, 630), 'image/png'],
    }) });
    assert.equal(result.vendor, vendor);
    assert.equal(result.image.url, image, vendor);
    assert.equal(result.image.width, 256);
  }
});

test('profile extraction handles login-wall raw fallback and rejects unrelated pages and redirects', async () => {
  const url = 'https://www.instagram.com/oli/';
  const image = 'https://cdn.test/avatar.png';
  const fetch = fixtureFetch({ [url]: `<meta property="og:image" content="${image}">`, [image]: [png(256, 256), 'image/png'] });
  const result = await extractProfilePicture(url, { fetch, waitAfterLoad: 0, launchBrowser: fakeBrowser('<form>Login</form>', 'https://www.instagram.com/accounts/login/') });
  assert.equal(result.image.source, 'profile-metadata');
  await assert.rejects(extractProfilePicture('https://example.test/'), FetcharyValidationError);
  await assert.rejects(extractProfilePicture('https://www.instagram.com/p/post/', { fetch: fixtureFetch({ 'https://www.instagram.com/p/post/': `<meta property="og:image" content="${image}">` }), mode: 'http' }), FetcharyNotFoundError);
  await assert.rejects(extractProfilePicture(url, { fetch, waitAfterLoad: 0, launchBrowser: fakeBrowser('<html></html>', 'https://external.test/') }), FetcharyNotFoundError);
  await assert.rejects(extractProfilePicture(url, { fetch, waitAfterLoad: 0, launchBrowser: fakeBrowser('<html></html>', 'https://www.instagram.com/other/') }), FetcharyNotFoundError);
  await assert.rejects(extractProfilePicture(url, { fetch, waitAfterLoad: 0, launchBrowser: fakeBrowser('<html></html>', 'https://www.instagram.com/p/post/') }), FetcharyNotFoundError);
  await assert.rejects(extractProfilePicture(url, { mode: 'http', fetch: fixtureFetch({ [url]: `<link rel="canonical" href="/other/"><meta property="og:image" content="${image}">`, [image]: [png(256, 256), 'image/png'] }) }), FetcharyNotFoundError);
});

test('CLI extraction emits content or image URLs, handles JSON/errors and never touches storage', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-extract-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'no-storage');
  const url = 'https://example.test/';
  const profile = 'https://www.instagram.com/oli/';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixtureFetch({ [url]: '<main>Hello <span>clock</span></main><link rel="icon" href="/icon.png">',
    'https://example.test/icon.png': [png(256, 256), 'image/png'],
    [profile]: '<img alt="oli\'s profile picture" src="https://example.test/icon.png">',
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  async function run(args) {
    let stdout = ''; let stderr = '';
    const code = await main([...args, '--data-dir', dataDir], {
      stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } },
    });
    return { code, stdout, stderr };
  }
  const content = await run(['extract', url, '--mode', 'http', '--text', '--ignore-selector', 'span']);
  assert.deepEqual(content, { code: 0, stdout: 'Hello', stderr: '' });
  const extractedJson = JSON.parse((await run(['extract', url, '--mode', 'http', '--json'])).stdout);
  assert.equal(extractedJson.content.startsWith('<main>'), true);
  assert.equal(extractedJson.cache.hit, true);
  assert.equal(extractedJson.cache.ttlMs, 45_000);
  assert.equal((await run(['favicon', url])).stdout, 'https://example.test/icon.png\n');
  assert.equal(JSON.parse((await run(['favicon', url, '--json'])).stdout).image.width, 256);
  assert.equal((await run(['profile-picture', profile, '--mode', 'http'])).stdout, 'https://example.test/icon.png\n');
  assert.equal((await run(['favicon', url, '--quiet'])).stdout, '');
  assert.match((await run(['extract', url, '--mode', 'http', '--verbose'])).stderr, /without storage/);
  assert.equal((await run(['extract'])).code, 2);
  assert.equal((await run(['favicon', url, '--text'])).code, 2);
  assert.equal((await run(['extract', url, '--every', '1h'])).code, 2);
  assert.equal((await run(['favicon', url, '--mode', 'invalid'])).code, 2);
  assert.equal((await run(['extract', 'https://missing.test/', '--mode', 'http'])).code, 3);
  const missing = await run(['favicon', profile, '--json']);
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stderr).error, 'FetcharyNotFoundError');
  assert.equal(fs.existsSync(dataDir), false);

  const archive = await createFetchary({ dataDir, fetch: globalThis.fetch });
  await archive.add(url, { mode: 'http' });
  await archive.setVendorActive('instagram', false);
  await archive.close();
  const dbBefore = fs.readFileSync(path.join(dataDir, 'fetchary.sqlite'));
  const htmlBefore = fs.readFileSync(path.join(dataDir, 'pages/1/1/response.html'));
  await run(['profile-picture', profile, '--mode', 'http']);
  await run(['extract', url, '--mode', 'http']);
  await run(['favicon', url]);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'fetchary.sqlite')), dbBefore);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'pages/1/1/response.html')), htmlBefore);
});

test('real Chromium one-shot extraction captures JavaScript content and dynamic icons', async t => {
  const server = http.createServer((request, response) => {
    if (request.url === '/icon.png') {
      response.writeHead(200, { 'content-type': 'image/png' }); response.end(png(256, 256));
    } else if (request.url === '/favicon.ico') {
      response.writeHead(404); response.end();
    } else {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><head></head><body><main>initial</main><script>document.querySelector("main").textContent = "rendered"; const icon = document.createElement("link"); icon.rel = "icon"; icon.href = "/icon.png"; document.head.append(icon);</script></body></html>');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const result = await extract(url, { waitAfterLoad: 0, format: 'text', includeSelectors: ['main'], timeout: 5000 });
  assert.equal(result.content, 'rendered');
  const icon = await extractFavicon(url, { mode: 'browser', waitAfterLoad: 0, timeout: 5000 });
  assert.equal(icon.image.url, `${url}icon.png`);
  assert.equal(icon.image.width, 256);
});
