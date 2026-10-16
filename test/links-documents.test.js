'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const api = require('../src');
const { main } = require('../cli');
const url = 'https://example.test/path/page';
function options(html, extra = {}) {
  return { mode: 'http', allowPrivateNetwork: true, fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), ...extra };
}
async function cli(type, flags, settings) {
  let stdout = ''; let stderr = '';
  const code = await main(['extract', type, url, ...flags], { options: settings, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { code, stdout, stderr };
}

test('links preserve every occurrence, text, rel, internal/external URLs, fragments and raw values', async () => {
  const html = '<html><head><base href="https://example.test/assets/"><link rel="canonical" href="/home"></head><body><nav><a href="/about" rel="NOFOLLOW external nofollow">About &amp; us</a></nav><main><a href="report.pdf?lang=en&amp;v=2#page=3"><span>Annual</span><br>report</a><a href="https://other.test/report.pdf">External</a><a href="#section">Jump</a><a href="">Current</a><a href="/about">Repeated</a><area href="/map" alt="Map region"></main><a href="javascript:alert(1)">JS</a><a href="data:text/html,x">Data</a><a href="https://user:secret@other.test/private">Credentials</a><a href="mailto:hello@example.test">Email</a><template><a href="/template">Inert</a></template></body></html>';
  const result = await api.extractLinks(url, options(html));
  assert.equal(result.data, result.links);
  assert.deepEqual(result.data.map(link => link.url), ['https://example.test/home', 'https://example.test/about', 'https://example.test/assets/report.pdf?lang=en&v=2#page=3', 'https://other.test/report.pdf', 'https://example.test/assets/#section', 'https://example.test/assets/', 'https://example.test/about', 'https://example.test/map']);
  assert.deepEqual(result.data[1].rel, ['nofollow', 'external']); assert.equal(result.data[1].text, 'About & us');
  assert.equal(result.data[2].rawUrl, 'report.pdf?lang=en&v=2#page=3'); assert.equal(result.data[2].text, 'Annual report');
  assert.equal(result.data[3].internal, false); assert.equal(result.data[1].internal, true); assert.equal(result.data.at(-1).text, 'Map region');
  const { document } = parseHTML(html);
  for (const link of result.data) {
    assert.equal(link.location.pageUrl, url);
    assert.equal(document.querySelectorAll(link.location.selector).length, 1);
    assert.equal(document.querySelector(link.location.selector).getAttribute(link.location.attribute), link.rawUrl);
  }
  assert.notEqual(result.data[1].location.selector, result.data[6].location.selector);
});

test('link locations remain in the full DOM when includes/ignores filter results and base changes origin', async () => {
  const html = '<html><head><base href="https://cdn.test/files/"></head><body><nav><a href="outside.pdf">Outside</a></nav><main><a href="inside.pdf"><img alt="Download report"></a><aside><a href="ignore.pdf">Ignore</a></aside></main></body></html>';
  const { document } = parseHTML(html);
  const settings = options(html, { includeSelectors: ['main', 'main a'], ignoreSelectors: ['aside'] });
  for (const method of [api.extractLinks, api.extractDocuments]) {
    const result = await method(url, settings);
    assert.equal(result.data.length, 1); assert.equal(result.data[0].url, 'https://cdn.test/files/inside.pdf');
    assert.equal(result.data[0].internal, false); assert.equal(result.data[0].text, 'Download report');
    assert.equal(document.querySelector(result.data[0].location.selector).parentElement.localName, 'main');
    assert.deepEqual((await method(url, { ...settings, ignoreSelectors: ['body'] })).data, []);
    assert.deepEqual((await method(url, { ...settings, includeSelectors: ['missing'] })).data, []);
  }
});

test('link locations work for root fragments, repeated siblings and namespace-like ancestor names', async () => {
  const html = '<a href="/one">One</a><x:panel><a href="/two">Two</a></x:panel><a href="/three">Three</a>';
  const { document } = parseHTML(html);
  const result = await api.extractLinks(url, options(html));
  assert.equal(result.data.length, 3);
  for (const link of result.data) assert.equal(document.querySelector(link.location.selector).getAttribute('href'), link.rawUrl);
});

test('documents discover PDF, CSV, DOCX, XLSX and other supported file extensions without fetching targets', async () => {
  const formats = ['PDF', 'csv', 'docx', 'xlsx', 'doc', 'xls', 'pptx', 'odt', 'ods', 'rtf', 'txt', 'md', 'epub', 'zip', 'json', 'xml', 'yaml', 'ics'];
  const html = formats.map(format => `<a href="/files/report.${format}?download=1#section">${format}</a>`).join('') + '<a href="/article.html">Page</a><a href="/photo.jpg">Photo</a>';
  let requests = 0;
  const settings = options(html, { fetch: async target => { assert.equal(target, url); requests++; return new Response(html, { headers: { 'content-type': 'text/html' } }); } });
  const result = await api.extractDocuments(url, settings);
  assert.equal(result.data, result.documents); assert.equal(requests, 1);
  assert.deepEqual(result.data.map(document => document.extension), formats.map(format => format.toLowerCase()));
  assert.equal(result.data[0].contentType, 'application/pdf'); assert.equal(result.data[0].detectedBy, 'url');
  assert.equal(result.data[0].filename, 'report.PDF'); assert.equal(result.data[0].location.attribute, 'href');
});

test('documents discover extensionless MIME/download/query hints and preserve detection evidence', async () => {
  const html = '<a href="/mime" type="application/pdf; charset=binary">MIME</a><a href="/export" download="Data.xlsx">Sheet</a><a href="/query?filename=Quarter%20one.CSV">Query</a><a href="/format?format=docx">Format</a><a href="/encoded/report%2Epdf">Encoded</a><a href="/unknown" download>Download</a><a href="/photo.jpg" download>Image</a><a href="/image" type="image/png" download>Image MIME</a><a href="/file" download="app.exe">Executable</a>';
  const data = (await api.extractDocuments(url, options(html + '<a href="/download?file=photo.png" download>Query image</a>'))).data;
  assert.deepEqual(data.map(item => item.extension), ['pdf', 'xlsx', 'csv', 'docx', 'pdf', null]);
  assert.deepEqual(data.map(item => item.detectedBy), ['type', 'download', 'query', 'query', 'url', 'download']);
  assert.equal(data[0].contentType, 'application/pdf'); assert.equal(data[1].filename, 'Data.xlsx'); assert.equal(data[2].filename, 'Quarter one.CSV');
  assert.equal(data[5].contentType, null);
});

test('documents discover embedded objects and frames with exact source attributes', async () => {
  const html = '<link rel="alternate" href="/download" type="text/csv"><iframe src="/report.pdf" title="Embedded report"></iframe><embed src="https://other.test/embedded" type="application/pdf"><object data="/sheet.xlsx">Sheet</object><iframe src="/ordinary-page"></iframe>';
  const result = await api.extractDocuments(url, options(html));
  assert.deepEqual(result.data.map(item => item.source), ['link', 'iframe', 'embed', 'object']);
  assert.deepEqual(result.data.map(item => item.location.attribute), ['href', 'src', 'src', 'data']);
  assert.equal(result.data[1].text, 'Embedded report'); assert.equal(result.data[2].internal, false);
  const { document } = parseHTML(html);
  for (const item of result.data) assert.equal(document.querySelector(item.location.selector).getAttribute(item.location.attribute), item.rawUrl);
});

test('link/document dispatcher and clients reuse captures while results and locations remain independent', async () => {
  const html = '<a href="/report.pdf" rel="nofollow">First</a><a href="/report.pdf">Second</a>';
  let requests = 0;
  const settings = options(html, { fetch: async () => { requests++; return new Response(html, { headers: { 'content-type': 'text/html' } }); } });
  for (const extractor of [api, api.createExtractor(settings)]) {
    const first = await extractor.extract(url, { ...settings, type: 'links' });
    first.data[0].rel.push('changed'); first.data[0].location.selector = 'changed'; first.data.pop();
    const next = await extractor.extractLinks(url, settings);
    assert.equal(next.data.length, 2); assert.deepEqual(next.data[0].rel, ['nofollow']); assert.notEqual(next.data[0].location.selector, 'changed');
    assert.equal(next.cache.hit, true);
    const documents = await extractor.extract(url, { ...settings, type: 'documents' });
    assert.equal(documents.cache.hit, true); assert.equal(documents.data.length, 2);
    assert.deepEqual((await extractor.extractDocuments(url, settings)).data, documents.data);
  }
  assert.equal(requests, 2);
});

test('link/document validation precedes requests and transport limits/cancellation remain typed', async () => {
  let requests = 0;
  const settings = options('', { fetch: async () => { requests++; return new Response('<p>Too much content</p>', { headers: { 'content-type': 'text/html' } }); } });
  for (const method of [api.extractLinks, api.extractDocuments]) {
    await assert.rejects(method(url, { ...settings, includeSelectors: ['['] }), api.FetcharyValidationError);
    await assert.rejects(method(url, { ...settings, ignoreSelectors: 'main' }), api.FetcharyValidationError);
    await assert.rejects(method('file:///private', settings), api.FetcharyValidationError);
    await assert.rejects(method(url, null), api.FetcharyValidationError);
  }
  assert.equal(requests, 0);
  for (const method of [api.extractLinks, api.extractDocuments]) {
    await assert.rejects(method(url, { ...settings, maxResponseBytes: 4 }), api.FetcharyFetchError);
    await assert.rejects(method(url, { ...settings, signal: AbortSignal.abort() }), api.FetcharyFetchError);
  }
});

test('auto capture renders missing scripted links/documents once and closes browser resources', async () => {
  for (const method of [api.extractLinks, api.extractDocuments]) {
    let launches = 0; let closes = 0;
    const settings = options('<p>Loading downloads</p><script></script>', { mode: 'auto', waitAfterLoad: 0, launchBrowser: async () => {
      launches++; return { newPage: async () => ({ goto: async () => {}, content: async () => '<a href="/dynamic.pdf">Rendered</a>', url: () => url, close: async () => { closes++; } }), close: async () => { closes++; } };
    } });
    const result = await method(url, settings);
    assert.equal(result.data[0].url, 'https://example.test/dynamic.pdf'); assert.equal(result.captureMode, 'browser');
    assert.equal(launches, 1); assert.equal(closes, 2);
  }
});

test('link/document CLI provides complete JSON, unique URL lists, scopes and empty success', async () => {
  const settings = options('<main><a href="/report.pdf">First</a><a href="/report.pdf">Second</a></main><footer><a href="/other.pdf">Footer</a></footer>');
  for (const type of ['links', 'documents']) {
    const flags = ['--include-selector', 'main'];
    const full = await cli(type, flags, settings);
    assert.equal(full.code, 0, full.stderr); assert.equal(JSON.parse(full.stdout).data.length, 2);
    for (const flag of ['--list', '--urls-only']) {
      const list = await cli(type, [...flags, flag, '--verbose'], settings);
      assert.equal(list.code, 0, list.stderr); assert.equal(list.stdout, 'https://example.test/report.pdf\n'); assert.equal(list.stderr, `Extracting ${type} (http)\n`);
      const json = await cli(type, [...flags, flag, '--json'], settings);
      assert.equal(JSON.parse(json.stdout).data.length, 2);
    }
    assert.equal((await cli(type, ['--list', '--quiet'], settings)).stdout, '');
    const empty = await cli(type, ['--list'], options('<p>No links</p>'));
    assert.equal(empty.code, 0); assert.equal(empty.stdout, '');
    assert.equal((await cli(type, ['--binary'], settings)).code, 2);
  }
});

test('real HTTP CLI and Chromium discover documents inserted by JavaScript without downloading them', async t => {
  let documentRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url.endsWith('.pdf')) { documentRequests++; response.writeHead(500); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body><main id="downloads"></main><script>const a=document.createElement("a");a.href="/rendered.pdf";a.rel="nofollow";a.textContent="Rendered report";document.querySelector("main").append(a);</script></body></html>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const target = `http://127.0.0.1:${server.address().port}/`;
  const settings = { mode: 'browser', waitAfterLoad: 0, allowPrivateNetwork: true, timeout: 5000 };
  const links = await api.extractLinks(target, settings);
  const documents = await api.extractDocuments(target, settings);
  assert.equal(documents.cache.hit, true); assert.deepEqual(documents.data[0].rel, ['nofollow']);
  assert.equal(documents.data[0].text, 'Rendered report'); assert.equal(documents.data[0].location.selector, links.data[0].location.selector);
  const child = spawn(process.execPath, [path.resolve(__dirname, '../cli/index.js'), 'extract', 'documents', target, '--mode', 'browser', '--wait-after-load', '0ms', '--allow-private-network', '--list']);
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0, stderr); assert.equal(stdout, `${target}rendered.pdf\n`); assert.equal(documentRequests, 0);
});
