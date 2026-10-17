'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DOMParser } = require('linkedom');
const api = require('../src');
const { main } = require('../cli');
const url = 'https://example.test/maps/sitemap.xml';
const ns = 'http://www.sitemaps.org/schemas/sitemap/0.9';
function options(xml, contentType = 'application/xml') {
  return { mode: 'auto', allowPrivateNetwork: true, fetch: async target => { assert.equal(target, url); return new Response(xml, { headers: { 'content-type': contentType } }); },
    launchBrowser: async () => { throw new Error('XML must not render'); } };
}

test('sitemap links preserve loc occurrences, decoded entities, CDATA, metadata and XML locations', async () => {
  const xml = `<?xml version="1.0"?><urlset xmlns="${ns}" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://example.test/one?a=1&amp;b=2</loc><image:image><image:loc>https://example.test/image.jpg</image:loc></image:image></url><url><loc><![CDATA[https://external.test/two?x=1&y=2]]></loc></url><url><loc>https://example.test/one?a=1&amp;b=2</loc></url><url><loc> relative </loc></url></urlset>`;
  const result = await api.extractLinks(url, options(xml));
  assert.equal(result.data, result.links); assert.equal(result.captureMode, 'http');
  assert.deepEqual(result.links.map(item => item.url), ['https://example.test/one?a=1&b=2', 'https://external.test/two?x=1&y=2', 'https://example.test/one?a=1&b=2', 'https://example.test/maps/relative']);
  assert.equal(result.links[0].internal, true); assert.equal(result.links[1].internal, false);
  assert.equal(result.links[0].source, 'loc'); assert.equal(result.links[0].text, ''); assert.deepEqual(result.links[0].rel, []);
  assert.equal(result.links[3].rawUrl, ' relative ');
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  for (const item of result.links) {
    assert.equal(item.location.pageUrl, url); assert.equal(item.location.attribute, 'textContent');
    assert.equal(document.querySelector(item.location.selector).textContent, item.rawUrl);
  }
});

test('sitemap indexes and prefixed namespaces expose only direct sitemap loc entries, without crawling', async () => {
  for (const prefix of ['', 'sm:']) {
    const xml = `<${prefix}sitemapindex ${prefix ? 'xmlns:sm' : 'xmlns'}="${ns}" xmlns:other="https://other.test/schema"><${prefix}sitemap><${prefix}loc>https://example.test/a.xml</${prefix}loc><other:loc>https://example.test/foreign.xml</other:loc></${prefix}sitemap><${prefix}sitemap><${prefix}loc>https://example.test/b.xml.gz</${prefix}loc></${prefix}sitemap></${prefix}sitemapindex>`;
    const result = await api.extract(url, { ...options(xml, 'text/xml'), type: 'links' });
    assert.deepEqual(result.links.map(item => item.url), ['https://example.test/a.xml', 'https://example.test/b.xml.gz']);
    const document = new DOMParser().parseFromString(xml, 'text/xml');
    for (const item of result.links) assert.equal(document.querySelector(item.location.selector).textContent, item.rawUrl);
  }
});

test('sitemap discovery honors include/ignore scopes and excludes credentials, non-HTTP URLs and custom entities', async () => {
  const xml = '<urlset><url><loc>https://example.test/one</loc></url><url><loc>https://example.test/two</loc></url><url><loc>javascript:alert(1)</loc></url><url><loc>https://user:secret@example.test/private</loc></url><url><loc>data:text/html,body</loc></url></urlset>';
  const settings = options(xml);
  assert.deepEqual((await api.extractLinks(url, { ...settings, includeSelectors: ['url:nth-child(2)'] })).links.map(item => item.url), ['https://example.test/two']);
  assert.deepEqual((await api.extractLinks(url, { ...settings, includeSelectors: ['urlset'], ignoreSelectors: ['url:first-child'] })).links.map(item => item.url), ['https://example.test/two']);
  assert.deepEqual((await api.extractLinks(url, { ...settings, includeSelectors: ['missing'] })).links, []);
  for (const source of ['<!DOCTYPE urlset [<!ENTITY x SYSTEM "https://secret.test/">]><urlset><url><loc>&x;</loc></url></urlset>', '<other><loc>https://example.test/not-a-sitemap</loc></other>', '<urlset><url><loc><nested>https://example.test/nested</nested></loc></url></urlset>']) {
    assert.deepEqual((await api.extractLinks(url, options(source))).links, []);
  }
});

test('sitemap CLI lists unique URLs and client/dispatcher share captures even with mislabelled content types', async () => {
  const xml = `<urlset xmlns="${ns}"><url><loc>https://example.test/one</loc></url><url><loc>https://example.test/one</loc></url></urlset>`;
  for (const contentType of ['application/xml', 'text/xml', 'application/octet-stream', 'text/html']) {
    const settings = options(xml, contentType); const client = api.createExtractor(settings);
    assert.equal((await client.extractLinks(url)).links.length, 2);
    assert.equal((await client.extract(url, { type: 'links' })).cache.hit, true);
    for (const flags of [['--list'], ['--urls-only'], ['--list', '--json']]) {
      let stdout = ''; let stderr = '';
      const code = await main(['extract', 'links', url, ...flags], { options: settings, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
      assert.equal(code, 0, stderr);
      if (flags.includes('--json')) assert.equal(JSON.parse(stdout).data.length, 2); else assert.equal(stdout, 'https://example.test/one\n');
    }
  }
});

test('real HTTP CLI follows sitemap redirects, resolves relative loc URLs and never fetches listed pages', async t => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/sitemap.xml') { response.writeHead(302, { location: '/maps/final.xml' }); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/xml' }); response.end('<urlset><url><loc>relative</loc></url></urlset>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const target = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../cli/index.js'), 'extract', 'links', `${target}/sitemap.xml`, '--list', '--allow-private-network']);
  let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0, stderr); assert.equal(stdout, `${target}/maps/relative\n`); assert.deepEqual(requests, ['/sitemap.xml', '/maps/final.xml']);
});
