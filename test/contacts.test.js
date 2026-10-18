'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const api = require('../src');
const { main } = require('../cli');
const url = 'https://contacts.example.test/';
function options(body, extra = {}) {
  return { mode: 'http', allowPrivateNetwork: true, fetch: async () => new Response(body, { headers: { 'content-type': 'text/html' } }), ...extra };
}
async function cli(args, settings) {
  let stdout = ''; let stderr = '';
  const code = await main(args, { options: settings, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { code, stdout, stderr };
}

test('emails extract decoded recipients, cc/bcc, microdata, JSON-LD and text with stable deduplication', async () => {
  const html = `<a href="MAILTO:Team%2Bsales@Example.COM,second@example.test?cc=cc+tag@example.test&amp;bcc=hidden%40example.test&amp;subject=ignore@example.test">Contact</a>
    <a href="mailto:%ZZ">Broken</a><meta itemprop="email" content="meta@example.test">
    <script type="application/ld+json">{"@graph":[{"email":["mailto:schema@example.test","second@example.test"]}]}</script>
    <script type="application/ld+json">broken</script><script>const email="script@example.test";</script>
    <style>/* style@example.test */</style><!-- comment@example.test --><template><a href="mailto:template@example.test">Template</a></template>
    <p>TEAM+sales@example.com; plain@example.test. entity&#64;example.test</p>`;
  const result = await api.extractEmails(url, options(html));
  assert.equal(result.type, 'emails'); assert.equal(result.data, result.emails);
  assert.deepEqual(result.data, ['Team+sales@example.com', 'second@example.test', 'cc+tag@example.test', 'hidden@example.test', 'meta@example.test', 'schema@example.test', 'plain@example.test', 'entity@example.test']);
});

test('emails reject malformed common address forms and do not invent obfuscated addresses', async () => {
  const html = `<p>good.name+tag@sub.example.test bad..name@example.test .leading@example.test trailing.@example.test
    bad@example_domain.test bad@example.123 ${'a'.repeat(65)}@example.test user@${'b'.repeat(64)}.test
    name [at] example [dot] test büro@example.test user@example.österreich</p>`;
  assert.deepEqual((await api.extractEmails(url, options(html))).data, ['good.name+tag@sub.example.test']);
});

test('telephone normalizes validated international contacts, national numbers and extensions', async () => {
  const html = `<a href="tel:%2B43%201%202345678">Call</a><a href="tel:+49-30-123456;ext=42">Berlin</a>
    <meta itemprop="telephone" content="+1 213 373 4253">
    <script type="application/ld+json">{"contactPoint":[{"telephone":"+43 (0)1 2345678"}]}</script>
    <script>const phone="+44 20 7946 0018";</script><p>National: 01 2345678. Other: 0044 20 7946 0018.</p>`;
  const result = await api.extractTelephone(url, options(html, { defaultCountry: 'AT' }));
  assert.equal(result.type, 'telephone'); assert.equal(result.data, result.numbers);
  assert.deepEqual(result.data, ['+4312345678', '+4930123456;ext=42', '+12133734253', '+442079460018']);
});

test('national phone parsing requires explicit country context and invalid numbers/dates are skipped', async () => {
  const settings = options('<p>Contact: 01 2345678. Date: 2026-10-16. Price: 99.95. Invalid: +43 123.</p>');
  assert.deepEqual((await api.extractTelephone(url, settings)).data, []);
  assert.deepEqual((await api.extractTelephone(url, { ...settings, defaultCountry: 'AT' })).data, ['+4312345678']);
});

test('contact extraction supports plain text and include/ignore selectors', async () => {
  const plain = options('', { fetch: async () => new Response('Contact plain@example.test or +1 213 373 4253.', { headers: { 'content-type': 'text/plain' } }) });
  assert.deepEqual((await api.extractEmails(url, plain)).data, ['plain@example.test']);
  assert.deepEqual((await api.extractTelephone(url, plain)).data, ['+12133734253']);
  const html = '<nav>outside@example.test +49 30 123456</nav><main><p>inside@example.test +43 1 2345678</p><aside>ignore@example.test +1 213 373 4253</aside></main>';
  const settings = options(html, { includeSelectors: ['main'], ignoreSelectors: ['aside'] });
  assert.deepEqual((await api.extractEmails(url, settings)).data, ['inside@example.test']);
  assert.deepEqual((await api.extractTelephone(url, settings)).data, ['+4312345678']);
});

test('dispatcher and clients share captures and isolate mutable contact results', async () => {
  let requests = 0;
  const settings = options('', { fetch: async () => { requests++; return new Response('<p>hello@example.test +43 1 2345678</p>', { headers: { 'content-type': 'text/html' } }); } });
  for (const extractor of [api, api.createExtractor(settings)]) {
    const first = await extractor.extract(url, { ...settings, type: 'emails' });
    assert.deepEqual(first.data, ['hello@example.test']); first.data.push('changed@example.test');
    const next = await extractor.extractEmails(url, settings);
    assert.deepEqual(next.data, ['hello@example.test']); assert.equal(next.cache.hit, true);
    const phone = await extractor.extract(url, { ...settings, type: 'telephone' });
    assert.deepEqual(phone.data, ['+4312345678']); assert.equal(phone.cache.hit, true);
  }
  assert.equal(requests, 2);
});

test('contact options are validated before network access and retain typed transport errors', async () => {
  let requests = 0;
  const settings = options('', { fetch: async () => { requests++; throw new Error('network failed'); } });
  for (const defaultCountry of ['at', 'ZZ', '', null, 43, {}]) await assert.rejects(api.extractTelephone(url, { ...settings, defaultCountry }), api.FetcharyValidationError);
  for (const method of [api.extractEmails, api.extractTelephone]) {
    await assert.rejects(method(url, { ...settings, includeSelectors: ['['] }), api.FetcharyValidationError);
    await assert.rejects(method(url, { ...settings, ignoreSelectors: 'main' }), api.FetcharyValidationError);
    await assert.rejects(method(url, null), api.FetcharyValidationError);
    await assert.rejects(method('file:///private', settings), api.FetcharyValidationError);
  }
  assert.equal(requests, 0);
  for (const method of [api.extractEmails, api.extractTelephone]) {
    await assert.rejects(method(url, settings), api.FetcharyFetchError);
    await assert.rejects(method(url, { ...settings, signal: AbortSignal.abort() }), api.FetcharyFetchError);
  }
});

test('auto mode renders missing scripted contacts once and retains HTTP for usable contacts', async () => {
  for (const [method, expected] of [[api.extractEmails, ['rendered@example.test']], [api.extractTelephone, ['+4312345678']]]) {
    let launches = 0; let closes = 0;
    const settings = options('<p>Contact details loading</p><script></script>', { mode: 'auto', waitAfterLoad: 0,
      launchBrowser: async () => { launches++; return { newPage: async () => ({ goto: async () => {}, url: () => url, content: async () => '<p>rendered@example.test +43 1 2345678</p>', close: async () => { closes++; } }), close: async () => { closes++; } }; } });
    const result = await method(url, settings);
    assert.deepEqual(result.data, expected); assert.equal(result.captureMode, 'browser');
    assert.equal(launches, 1); assert.equal(closes, 2);
    const usable = await method(url, options('<p>rendered@example.test +43 1 2345678</p><script></script>', { mode: 'auto', launchBrowser: async () => assert.fail('unnecessary browser') }));
    assert.deepEqual(usable.data, expected); assert.equal(usable.captureMode, 'http');
  }
});

test('contact CLI offers structured JSON, list aliases, scopes, country selection and empty success', async () => {
  const settings = options('<main>hello@example.test +43 1 2345678</main><footer>footer@example.test +49 30 123456</footer>');
  for (const [type, expected] of [['emails', ['hello@example.test']], ['telephone', ['+4312345678']]]) {
    const args = ['extract', type, url, '--include-selector', 'main'];
    for (const flag of ['--list', '--urls-only']) {
      const result = await cli([...args, flag], settings);
      assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, `${expected[0]}\n`); assert.equal(result.stderr, '');
    }
    const json = await cli(args, settings);
    assert.equal(json.code, 0, json.stderr); assert.deepEqual(JSON.parse(json.stdout).data, expected);
    const explicitJson = await cli([...args, '--list', '--json'], settings);
    assert.deepEqual(JSON.parse(explicitJson.stdout).data, expected);
    assert.equal((await cli([...args, '--list', '--quiet'], settings)).stdout, '');
    const empty = await cli(['extract', type, url, '--list'], options('<p>No contacts</p>'));
    assert.equal(empty.code, 0); assert.equal(empty.stdout, '');
  }
  const national = await cli(['extract', 'telephone', url, '--default-country', 'AT', '--list'], options('<p>01 2345678</p>'));
  assert.equal(national.code, 0, national.stderr); assert.equal(national.stdout, '+4312345678\n');
  for (const args of [['extract', 'telephone', url, '--default-country', 'ZZ'], ['extract', 'emails', url, '--default-country', 'AT'], ['extract', 'emails', url, '--binary']]) {
    assert.equal((await cli(args, settings)).code, 2);
  }
});

test('real HTTP CLI and Chromium extract static and rendered contacts using the same API', async t => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body><p>raw@example.test +43 1 2345678</p><script>const p=document.createElement("p");p.textContent="rendered@example.test +49 30 123456";document.body.append(p);</script></body></html>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const target = `http://127.0.0.1:${server.address().port}/`;
  const settings = { mode: 'browser', waitAfterLoad: 0, allowPrivateNetwork: true, timeout: 15_000 };
  assert.deepEqual((await api.extractEmails(target, settings)).data, ['raw@example.test', 'rendered@example.test']);
  assert.deepEqual((await api.extractTelephone(target, settings)).data, ['+4312345678', '+4930123456']);
  for (const [type, expected] of [['emails', 'raw@example.test\n'], ['telephone', '+4312345678\n']]) {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../cli/index.js'), 'extract', type, target, '--mode', 'http', '--allow-private-network', '--list']);
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, stderr); assert.equal(stdout, expected); assert.equal(stderr, '');
  }
});
