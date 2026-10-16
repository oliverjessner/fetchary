'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const api = require('../src');
const { main } = require('../cli');
const url = 'https://example.test/article';
const emptyMetadata = { title: null, description: null, canonical: null, language: null, publishedAt: null, modifiedAt: null };
const ld = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
function options(html, extra = {}) { return { mode: 'http', allowPrivateNetwork: true, fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), ...extra }; }
async function cli(type, flags, settings) {
  let stdout = ''; let stderr = '';
  const code = await main(['extract', type, url, ...flags], { options: settings, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { code, stdout, stderr };
}

test('metadata extracts all six fields with HTML/meta precedence and declared date values', async () => {
  const html = '<html lang="de-AT"><head><base href="https://example.test/news/"><title> Title &amp;\n more </title><meta name="Description" content=""><meta name="description" content="A &amp; B"><meta property="og:title" content="OG title"><meta property="og:description" content="OG description"><meta property="og:locale" content="en_US"><link rel="canonical" href="javascript:invalid"><link rel="alternate CANONICAL" href="../article?x=1&amp;y=2"><meta property="article:published_time" content="2026-10-16T12:30:00+02:00"><meta property="article:modified_time" content="2026-10-17"></head><body></body></html>';
  const result = await api.extractMetadata(url, options(html));
  assert.equal(result.data, result.metadata);
  assert.deepEqual(result.data, { title: 'Title & more', description: 'A & B', canonical: 'https://example.test/article?x=1&y=2', language: 'de-AT', publishedAt: '2026-10-16T12:30:00+02:00', modifiedAt: '2026-10-17' });
});

test('metadata uses social, language and explicit time fallbacks while absent fields stay null', async () => {
  const html = '<meta property="og:title" content="Social title"><meta name="twitter:title" content="Later"><meta name="twitter:description" content="Social description"><meta property="og:locale" content="en_US"><meta http-equiv="last-modified" content="Fri, 16 Oct 2026 10:00:00 GMT"><time pubdate datetime="2026-10-15">Yesterday</time>';
  assert.deepEqual((await api.extractMetadata(url, options(html))).data, { title: 'Social title', description: 'Social description', canonical: null, language: 'en-US', publishedAt: '2026-10-15', modifiedAt: 'Fri, 16 Oct 2026 10:00:00 GMT' });
  assert.equal((await api.extractMetadata(url, options('<html xml:lang="de"><head><meta http-equiv="Content-Language" content="fr, en"></head></html>'))).data.language, 'de');
  assert.equal((await api.extractMetadata(url, options('<meta http-equiv="Content-Language" content="fr, en">'))).data.language, 'fr');
  assert.deepEqual((await api.extractMetadata(url, options('<p>No page metadata</p><time datetime="2099-01-01">Event</time><svg><title>Icon title</title></svg><template><title>Hidden title</title><time pubdate datetime="2099-01-01"></time></template>'))).data, emptyMetadata);
});

test('metadata selects matching page Schema.org graph nodes and excludes unrelated entities', async () => {
  const graph = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'Article', url: 'https://other.test/article', headline: 'Wrong', datePublished: '1900-01-01' },
    { '@type': 'WebSite', name: 'Website name' },
    { '@type': 'Article', headline: 'Anonymous fallback', datePublished: '1800-01-01' },
    { '@type': 'NewsArticle', '@id': `${url}#article`, headline: 'Article title', description: 'Summary', inLanguage: ['de_AT', 'en'], datePublished: { '@value': '2026-10-16' }, dateModified: '2026-10-17', author: { '@type': 'Person', name: 'Author', datePublished: '1800-01-01' } },
  ] };
  assert.deepEqual((await api.extractMetadata(url, options(ld(graph)))).data, { title: 'Article title', description: 'Summary', canonical: null, language: 'de-AT', publishedAt: '2026-10-16', modifiedAt: '2026-10-17' });
  const fullTerms = { '@type': 'https://schema.org/BlogPosting', 'https://schema.org/headline': 'Full terms', 'https://schema.org/datePublished': '2026-10' };
  assert.equal((await api.extractMetadata(url, options(ld(fullTerms)))).data.publishedAt, '2026-10');
});

test('metadata reads Schema.org Microdata without mixing nested author or unrelated article fields', async () => {
  const html = '<article itemscope itemtype="https://schema.org/Article" itemid="/other"><span itemprop="headline">Wrong</span></article><article itemscope itemtype="https://schema.org/Article" itemid="#article"><span itemprop="headline">Right &amp; title</span><meta itemprop="description" content="Microdata summary"><meta itemprop="inLanguage" content="en"><time itemprop="datePublished" datetime="2026-10-16"></time><meta itemprop="dateModified" content="2026-10-17"><div itemscope itemprop="author" itemtype="https://schema.org/Person"><span itemprop="name">Wrong author title</span></div></article>';
  assert.deepEqual((await api.extractMetadata(url, options(html))).data, { title: 'Right & title', description: 'Microdata summary', canonical: null, language: 'en', publishedAt: '2026-10-16', modifiedAt: '2026-10-17' });
});

test('JSON-LD preserves graphs/contexts/arrays and reports bad blocks without evaluating scripts or requesting contexts', async () => {
  const graph = { '@context': 'https://contexts.other.test/schema', '@graph': [{ '@type': 'Article', name: 'A &amp; B' }] };
  const html = ld(graph) + ld([{ '@type': 'Person', name: 'Person' }, 42, null]) + '<script type="APPLICATION/LD+JSON; charset=utf-8">{"@type":"Organization"}</script><script type="application/ld+json">{broken</script><script>throw new Error("must not execute");</script><template>' + ld({ '@type': 'Hidden' }) + '</template>';
  let requests = 0;
  const result = await api.extractStructuredData(url, options(html, { fetch: async target => { requests++; assert.equal(target, url); return new Response(html, { headers: { 'content-type': 'text/html' } }); } }));
  assert.equal(result.data, result.structuredData); assert.equal(requests, 1);
  assert.deepEqual(result.data.jsonLd, [graph, { '@type': 'Person', name: 'Person' }, { '@type': 'Organization' }]);
  assert.equal(result.data.errors.length, 3); assert.equal(result.data.errors[0].source, 'json-ld'); assert.equal(result.data.errors[0].index, 1);
});

test('standalone JSON-LD responses are parsed while metadata/non-HTML responses remain empty', async () => {
  const object = { '@context': 'https://schema.org', '@type': 'Article', headline: 'Data' };
  const settings = options('', { fetch: async () => new Response(JSON.stringify(object), { headers: { 'content-type': 'application/ld+json; charset=utf-8' } }) });
  assert.deepEqual((await api.extractStructuredData(url, settings)).data, { jsonLd: [object], microdata: [], errors: [] });
  assert.deepEqual((await api.extractMetadata(url, settings)).data, emptyMetadata);
  const plain = options('', { fetch: async () => new Response('<title>False title</title>', { headers: { 'content-type': 'text/plain' } }) });
  assert.deepEqual((await api.extractMetadata(url, plain)).data, emptyMetadata);
  assert.deepEqual((await api.extractStructuredData(url, plain)).data, { jsonLd: [], microdata: [], errors: [] });
});

test('Microdata supports nested scopes, repeated/multi-name properties, itemref order and typed element values', async () => {
  const html = '<html><head><base href="https://cdn.test/assets/"></head><body><span id="before" itemprop="name">Before</span><article itemscope itemtype="https://schema.org/Article https://schema.org/Article" itemid="story" itemref="after before"><span itemprop="name alternateName">One</span><span itemprop="name">Two</span><meta itemprop="description" content="A &amp; B"><data itemprop="price" value="0">Zero</data><meter itemprop="rating" value="4"></meter><time itemprop="datePublished" datetime="2026-10-16">Date</time><a itemprop="url" href="story#section">Story</a><img itemprop="image" src="cover.png"><object itemprop="attachment" data="file.pdf"></object><div itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Oliver</span></div></article><span id="after" itemprop="name">After</span></body></html>';
  const result = (await api.extractStructuredData(url, options(html))).data;
  assert.deepEqual(result.errors, []); assert.equal(result.microdata.length, 1);
  const item = result.microdata[0];
  assert.deepEqual(item.types, ['https://schema.org/Article']); assert.equal(item.id, 'https://cdn.test/assets/story');
  assert.deepEqual(item.properties.name, ['Before', 'One', 'Two', 'After']); assert.deepEqual(item.properties.alternateName, ['One']);
  assert.deepEqual(item.properties.description, ['A & B']); assert.deepEqual(item.properties.price, ['0']); assert.deepEqual(item.properties.rating, ['4']);
  assert.deepEqual(item.properties.datePublished, ['2026-10-16']); assert.deepEqual(item.properties.url, ['https://cdn.test/assets/story#section']);
  assert.deepEqual(item.properties.image, ['https://cdn.test/assets/cover.png']); assert.deepEqual(item.properties.attachment, ['https://cdn.test/assets/file.pdf']);
  assert.deepEqual(item.properties.author[0].properties.name, ['Oliver']);
});

test('Microdata cycles/missing references are inspectable and special property names do not change prototypes', async () => {
  const html = '<div id="a" itemscope itemref="b missing"><meta itemprop="__proto__ constructor" content="safe"></div><div id="b" itemprop="child" itemscope itemref="c"><meta itemprop="name" content="Child"></div><div id="c" itemprop="child" itemscope itemref="b"><meta itemprop="name" content="Cycle"></div>';
  const data = (await api.extractStructuredData(url, options(html))).data;
  assert.deepEqual(data.microdata[0].properties.__proto__, ['safe']); assert.deepEqual(data.microdata[0].properties.constructor, ['safe']);
  assert.equal(Object.getPrototypeOf(data.microdata[0].properties), Object.prototype); assert.equal({}.polluted, undefined);
  assert.equal(data.microdata[0].properties.child[0].properties.name[0], 'Child');
  assert.ok(data.errors.some(error => error.source === 'microdata' && /missing/.test(error.message)));
  assert.ok(data.errors.some(error => /cyclic/.test(error.message))); assert.doesNotThrow(() => JSON.stringify(data));
});

test('structured-data depth/expansion guards preserve other valid records and provide diagnostics', async () => {
  let deep = { name: 'deep' }; for (let index = 0; index < 130; index++) deep = { child: deep };
  const html = ld(deep) + ld({ '@type': 'Valid' }) + '<div itemscope>' + '<div itemprop="child" itemscope>'.repeat(66) + '<span itemprop="name">Leaf</span>' + '</div>'.repeat(67);
  const result = (await api.extractStructuredData(url, options(html))).data;
  assert.deepEqual(result.jsonLd, [{ '@type': 'Valid' }]);
  assert.ok(result.errors.some(error => /128/.test(error.message))); assert.ok(result.errors.some(error => /64/.test(error.message)));
  const many = '<div itemscope>' + '<meta itemprop="name" content="x">'.repeat(10001) + '</div>';
  const capped = (await api.extractStructuredData(url, options(many))).data;
  assert.equal(capped.microdata.length, 0); assert.ok(capped.errors.some(error => /10000/.test(error.message)));
});

test('metadata/structured-data methods and dispatcher clients reuse captures and isolate nested results', async () => {
  const html = '<title>Original</title>' + ld({ '@type': 'Article', datePublished: '2026-10-16' }) + '<div itemscope><meta itemprop="name" content="Original"></div>';
  let requests = 0;
  const settings = options(html, { fetch: async () => { requests++; return new Response(html, { headers: { 'content-type': 'text/html' } }); } });
  for (const extractor of [api, api.createExtractor(settings)]) {
    const metadata = await extractor.extract(url, { ...settings, type: 'metadata' });
    metadata.data.title = 'Changed';
    const first = await extractor.extractStructuredData(url, settings);
    first.data.jsonLd[0]['@type'] = 'Changed'; first.data.microdata[0].properties.name.push('Changed'); first.data.errors.push({ source: 'json-ld', index: 1, message: 'Changed' });
    const next = await extractor.extract(url, { ...settings, type: 'structured-data' });
    assert.equal(next.cache.hit, true); assert.equal(next.data.jsonLd[0]['@type'], 'Article'); assert.deepEqual(next.data.microdata[0].properties.name, ['Original']); assert.deepEqual(next.data.errors, []);
    assert.equal((await extractor.extractMetadata(url, settings)).data.title, 'Original');
  }
  assert.equal(requests, 2);
});

test('metadata/structured-data preserve option validation, request limits and cancellation', async () => {
  let requests = 0;
  const settings = options('', { fetch: async () => { requests++; return new Response('<title>Data</title>', { headers: { 'content-type': 'text/html' } }); } });
  for (const method of [api.extractMetadata, api.extractStructuredData]) {
    await assert.rejects(method('file:///private', settings), api.FetcharyValidationError);
    await assert.rejects(method(url, null), api.FetcharyValidationError);
    await assert.rejects(method(url, { ...settings, timeout: -1 }), api.FetcharyValidationError);
  }
  assert.equal(requests, 0);
  for (const method of [api.extractMetadata, api.extractStructuredData]) {
    await assert.rejects(method(url, { ...settings, maxResponseBytes: 4 }), api.FetcharyFetchError);
    await assert.rejects(method(url, { ...settings, signal: AbortSignal.abort() }), api.FetcharyFetchError);
  }
});

test('auto mode renders empty scripted metadata/data once and skips rendering static or malformed data-only scripts', async () => {
  for (const method of [api.extractMetadata, api.extractStructuredData]) {
    let launches = 0; let closes = 0;
    const settings = options('<p>Loading</p><script></script>', { mode: 'auto', waitAfterLoad: 0, launchBrowser: async () => {
      launches++; return { newPage: async () => ({ goto: async () => {}, content: async () => '<title>Rendered</title>' + ld({ '@type': 'Article' }), url: () => url, close: async () => { closes++; } }), close: async () => { closes++; } };
    } });
    const result = await method(url, settings); assert.equal(result.captureMode, 'browser'); assert.equal(launches, 1); assert.equal(closes, 2);
    const staticData = await method(url, options('<script type="application/ld+json">{broken</script>', { mode: 'auto', launchBrowser: async () => assert.fail('data script is not executable') }));
    assert.equal(staticData.captureMode, 'http');
  }
  assert.equal((await api.extractMetadata(url, options('<title>Usable</title><script></script>', { mode: 'auto', launchBrowser: async () => assert.fail('usable metadata') }))).captureMode, 'http');
});

test('metadata/structured-data CLI supports full JSON and list aliases without extra stdout diagnostics', async () => {
  const settings = options('<html lang="en"><head><title>Title</title><meta name="description" content="Description"><link rel="canonical" href="/article"></head><body>' + ld({ '@type': 'Article', datePublished: '2026-10-16' }) + '<div itemscope itemtype="https://schema.org/Person"><span itemprop="name">Oliver</span></div></body></html>');
  for (const type of ['metadata', 'structured-data']) {
    const full = await cli(type, [], settings); assert.equal(full.code, 0, full.stderr); assert.equal(JSON.parse(full.stdout).type, type);
    for (const flag of ['--list', '--urls-only']) {
      const list = await cli(type, [flag, '--verbose'], settings); assert.equal(list.code, 0, list.stderr); assert.equal(list.stderr, `Extracting ${type} (http)\n`);
      if (type === 'metadata') assert.equal(list.stdout, 'Title\nDescription\nhttps://example.test/article\nen\n2026-10-16\n');
      else { const lines = list.stdout.trim().split('\n').map(line => JSON.parse(line)); assert.equal(lines.length, 2); assert.equal(lines[0]['@type'], 'Article'); assert.deepEqual(lines[1].properties.name, ['Oliver']); }
      const json = await cli(type, [flag, '--json'], settings); assert.deepEqual(JSON.parse(json.stdout).data, JSON.parse(full.stdout).data);
    }
    const quiet = await cli(type, ['--quiet', '--verbose'], settings); assert.equal(quiet.stdout, ''); assert.equal(quiet.stderr, '');
    assert.equal((await cli(type, ['--list'], options('<p>Empty</p>'))).stdout, '');
    assert.equal((await cli(type, ['--binary'], settings)).code, 2);
  }
});

test('real Chromium and HTTP CLI capture rendered metadata and structured objects without fetching JSON-LD contexts', async t => {
  let unexpected = 0;
  const server = http.createServer((request, response) => {
    if (request.url !== '/' && request.url !== '/favicon.ico') unexpected++;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><head><title>Raw title</title>' + ld({ '@type': 'WebSite' }) + '</head><body><script>document.title="Rendered title";document.documentElement.lang="de";const s=document.createElement("script");s.type="application/ld+json";s.textContent=JSON.stringify({"@context":"/context","@type":"Article",datePublished:"2026-10-16"});document.head.append(s);const d=document.createElement("div");d.setAttribute("itemscope","");d.innerHTML=\'<span itemprop="name">Rendered person</span>\';document.body.append(d);</script></body></html>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const target = `http://127.0.0.1:${server.address().port}/`;
  const settings = { mode: 'browser', waitAfterLoad: 0, allowPrivateNetwork: true, timeout: 5000 };
  const metadata = await api.extractMetadata(target, settings); assert.equal(metadata.data.title, 'Rendered title'); assert.equal(metadata.data.publishedAt, '2026-10-16'); assert.equal(metadata.data.language, 'de');
  const structured = await api.extractStructuredData(target, settings); assert.equal(structured.cache.hit, true); assert.equal(structured.data.jsonLd.length, 2); assert.deepEqual(structured.data.microdata[0].properties.name, ['Rendered person']);
  for (const type of ['metadata', 'structured-data']) {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../cli/index.js'), 'extract', type, target, '--mode', 'http', '--allow-private-network', '--list']);
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, stderr); assert.equal(stdout, type === 'metadata' ? 'Raw title\n' : '{"@type":"WebSite"}\n');
  }
  assert.equal(unexpected, 0);
});
