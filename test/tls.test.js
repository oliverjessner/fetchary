'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const api = require('../src');
const { main } = require('../cli');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/tls', name), 'utf8');
const key = fixture('leaf-key.pem');
const chain = fixture('leaf.pem') + fixture('intermediate.pem');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>';
const options = { allowPrivateNetwork: true, mode: 'http', timeout: 15000 };

async function site(t, cert = fixture('selfsigned.pem'), handler = (_, response) => response.end('<p>TLS page</p>')) {
  const server = https.createServer({ key, cert }, handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `https://127.0.0.1:${server.address().port}`;
}

function trustFixtureRoot(t) {
  const certificates = tls.getCACertificates('default');
  tls.setDefaultCACertificates([...certificates, fixture('root.pem'), fixture('hostname.pem')]);
  t.after(() => tls.setDefaultCACertificates(certificates));
}

async function cli(args, settings = options) {
  let stdout = ''; let stderr = '';
  const code = await main(args, { options: settings, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { code, stdout, stderr };
}

test('default extraction accepts invalid certificates while explicit verification still fails', async t => {
  trustFixtureRoot(t);
  const environment = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  for (const [name, cert, code] of [
    ['self-signed', fixture('selfsigned.pem'), 'DEPTH_ZERO_SELF_SIGNED_CERT'],
    ['expired', fixture('expired.pem') + fixture('intermediate.pem'), 'CERT_HAS_EXPIRED'],
    ['missing intermediate', fixture('leaf.pem'), 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'],
    ['hostname mismatch', fixture('hostname.pem'), 'ERR_TLS_CERT_ALTNAME_INVALID'],
  ]) await t.test(name, async t => {
    const target = await site(t, cert);
    const settings = options;
    const rejectsCertificate = error => error instanceof api.FetcharyFetchError && error.cause.code === code;
    await assert.rejects(api.extractText(target, { ...settings, insecure: false }), rejectsCertificate);
    assert.equal((await api.extractText(target, settings)).data, 'TLS page');
    assert.equal((await api.extractText(target, { ...settings, insecure: true })).cache.hit, true);
    // Neither an insecure cached document nor its keep-alive socket may satisfy
    // a later strict call to exactly the same URL.
    await assert.rejects(api.extractText(target, { ...settings, insecure: false }), rejectsCertificate);
    const [strict, insecure] = await Promise.allSettled([
      api.extractText(target, { ...settings, insecure: false, cacheTtlMs: 0 }),
      api.extractText(target, { ...settings, cacheTtlMs: 0 }),
    ]);
    assert.equal(strict.status, 'rejected'); assert.ok(rejectsCertificate(strict.reason));
    assert.equal(insecure.status, 'fulfilled'); assert.equal(insecure.value.data, 'TLS page');
  });
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, environment);
});

test('verified and insecure captures remain separate in both the shared cache and isolated clients', async t => {
  trustFixtureRoot(t);
  let requests = 0;
  const target = await site(t, chain, (_, response) => { requests++; response.end('<p>Verified page</p>'); });
  for (const extractor of [api, api.createExtractor(options)]) {
    const settings = extractor === api ? options : {};
    extractor.clearCache();
    const before = requests;
    assert.equal((await extractor.extractText(target, { ...settings, insecure: false })).cache.hit, false);
    assert.equal((await extractor.extractText(target, settings)).cache.hit, false);
    assert.equal((await extractor.extractText(target, { ...settings, insecure: false })).cache.hit, true);
    assert.equal((await extractor.extractText(target, { ...settings, insecure: true })).cache.hit, true);
    assert.equal(requests, before + 2);
  }
  const client = api.createExtractor(options);
  const untrusted = await site(t);
  assert.equal((await client.extractText(untrusted)).data, 'TLS page');
  await assert.rejects(client.extractText(untrusted, { insecure: false }), api.FetcharyFetchError);
});

test('default extraction follows unverified HTTPS redirects and manifest/icon downloads through direct, dispatcher and analysis APIs', async t => {
  const seen = [];
  const assets = await site(t, fixture('selfsigned.pem'), (request, response) => {
    seen.push(request.url);
    if (request.url === '/manifest.json') { response.setHeader('content-type', 'application/manifest+json'); response.end('{"icons":[{"src":"/icon.svg"}]}'); }
    else if (request.url === '/icon.svg') { response.setHeader('content-type', 'image/svg+xml'); response.end(svg); }
    else { response.writeHead(404); response.end(); }
  });
  const origin = await site(t, fixture('selfsigned.pem'), (request, response) => {
    if (request.url === '/start') { response.writeHead(302, { location: '/page' }); response.end(); }
    else if (request.url === '/page') { response.setHeader('content-type', 'text/html'); response.end(`<title>TLS</title><link rel="manifest" href="${assets}/manifest.json"><p>Page</p>`); }
    else { response.writeHead(404); response.end(); }
  });
  const settings = options;
  const result = await api.extractFavicon(`${origin}/start`, { ...settings, binary: true });
  assert.equal(result.finalUrl, `${origin}/page`);
  assert.equal(result.image.url, `${assets}/icon.svg`); assert.deepEqual(result.data, Buffer.from(svg));
  const dispatched = await api.extract(`${origin}/start`, { ...settings, type: 'favicon' });
  assert.equal(dispatched.image.url, result.image.url);
  const report = await api.analyse(`${origin}/start`, settings);
  assert.equal(report.results.favicon.image.url, result.image.url); assert.equal(report.errors.favicon, undefined);
  assert.ok(seen.includes('/manifest.json')); assert.ok(seen.includes('/icon.svg'));
});

test('default browser extraction and auto fallback reach unverified HTTPS resources with real Chromium', async t => {
  const assets = await site(t, fixture('selfsigned.pem'), (request, response) => {
    response.setHeader('content-type', 'application/javascript');
    response.end('document.querySelector("#app").textContent="Rendered TLS page";');
  });
  const target = await site(t, fixture('selfsigned.pem'), (_, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<html><body><div id="app"></div><script src="${assets}/render.js"></script></body></html>`);
  });
  for (const mode of ['browser', 'auto']) {
    let launch;
    const result = await api.extractText(target, { ...options, mode, waitAfterLoad: 0,
      launchBrowser: async settings => { launch = settings; return require('puppeteer').launch(settings); } });
    assert.equal(result.data, 'Rendered TLS page'); assert.equal(result.captureMode, 'browser');
    assert.equal(launch.acceptInsecureCerts, true);
  }
});

test('insecure preserves private-network checks, redirects, byte limits, timeouts and cancellation', async t => {
  let requests = 0;
  const target = await site(t, fixture('selfsigned.pem'), (request, response) => {
    requests++;
    if (request.url === '/slow') return;
    response.end(`<p>${'x'.repeat(2048)}</p>`);
  });
  await assert.rejects(api.extractText(target), api.FetcharyValidationError);
  assert.equal(requests, 0);
  await assert.rejects(api.extractText('https://public.example.test/', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetch: async () => new Response(null, { status: 302, headers: { location: target } }),
  }), api.FetcharyValidationError);
  const settings = options;
  await assert.rejects(api.extractText(target, { ...settings, maxResponseBytes: 128 }), /response exceeds maxResponseBytes/);
  await assert.rejects(api.extractText(`${target}/slow`, { ...settings, timeout: 100 }), api.FetcharyFetchError);
  await assert.rejects(api.extractText(target, { ...settings, signal: AbortSignal.abort() }), api.FetcharyFetchError);
});

test('CLI defaults to insecure extraction, analysis, aliases and lists, with explicit --secure and --insecure overrides', async t => {
  for (const insecure of [null, 'true', 1, {}, []]) {
    await assert.rejects(api.extractText('https://example.test/', { insecure }), { name: 'FetcharyValidationError', message: 'insecure must be a boolean' });
    assert.throws(() => api.createExtractor({ insecure }), api.FetcharyValidationError);
  }
  const target = await site(t, fixture('selfsigned.pem'), (_, response) => {
    response.setHeader('content-type', 'text/html'); response.end('<title>CLI TLS</title><p>Page</p><a href="/one">One</a>');
  });
  assert.equal((await cli(['extract', 'text', target, '--secure'])).code, 3);
  assert.equal((await cli(['extract', 'text', target, '--secure'], { ...options, insecure: true })).code, 3);
  assert.equal((await cli(['extract', 'text', target, '--insecure'], { ...options, insecure: false })).code, 0);
  for (const args of [
    ['extract', 'text', target],
    ['--insecure', 'extract', 'text', target],
    ['extract', target, '--text'],
    ['extract', 'links', target, '--list'],
    ['analyse', target],
  ]) {
    const result = await cli(args); assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes(args.includes('links') ? `${target}/one` : args.includes('analyse') ? 'CLI TLS' : 'Page'));
  }
  const invalid = await cli(['extract', 'text', target, '--insecure=false']);
  assert.equal(invalid.code, 2); assert.match(invalid.stderr, /does not take a value/);
  const conflict = await cli(['extract', 'text', target, '--secure', '--insecure']);
  assert.equal(conflict.code, 2); assert.match(conflict.stderr, /--secure conflicts with --insecure/);
  assert.match((await cli(['--help'])).stdout, /--insecure/);
  assert.match((await cli(['--help'])).stdout, /--secure/);
});

test('a spawned favicon CLI handles untrusted HTTPS image bytes without TLS flags', async t => {
  const target = await site(t, fixture('selfsigned.pem'), (request, response) => {
    response.setHeader('content-type', request.url === '/icon.svg' ? 'image/svg+xml' : 'text/html');
    response.end(request.url === '/icon.svg' ? svg : '<link rel="icon" href="/icon.svg">');
  });
  for (const args of [['extract', 'favicon'], ['favicon']]) {
    const child = spawn(process.execPath, [path.join(__dirname, '../cli/index.js'), ...args, target, '--allow-private-network', '--binary', '--no-history']);
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const chunks = []; let stderr = '';
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, stderr); assert.equal(stderr, ''); assert.deepEqual(Buffer.concat(chunks), Buffer.from(svg));
  }
});

test('default login accepts an untrusted certificate in real Chromium and its saved session works for default extraction', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-tls-login-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = await site(t, fixture('selfsigned.pem'), (request, response) => {
    if (request.url === '/account' && !request.headers.cookie?.includes('session=tls-test-session')) {
      response.writeHead(401); response.end('Sign in'); return;
    }
    if (request.url !== '/account') response.setHeader('set-cookie', 'session=tls-test-session; HttpOnly; Secure; Path=/');
    response.setHeader('content-type', 'text/html'); response.end('<html><head><title>TLS account</title></head><body><p>Account</p></body></html>');
  });
  // Keep the integration headless while exercising the actual login launch
  // settings, native HTTPS navigation, cookies and CLI flag forwarding.
  const launchBrowser = async settings => {
    assert.equal(settings.acceptInsecureCerts, true);
    return require('puppeteer').launch({ ...settings, headless: true });
  };
  let stderr = '';
  const result = await main(['login', target, '--session', 'tls', '--session-dir', directory, '--allow-private-network', '--json'], {
    options: { launchBrowser, timeout: 15000 }, confirmLogin: async () => {},
    stdout: { write() {} }, stderr: { write(value) { stderr += value; } },
  });
  assert.equal(result, 0, stderr);
  const page = await api.extractText(`${target}/account`, { ...options, session: 'tls', sessionDir: directory, includeSelectors: ['p'] });
  assert.equal(page.data, 'Account');
  let strictStderr = '';
  const strict = await main(['login', target, '--secure', '--session', 'tls', '--session-dir', directory, '--allow-private-network'], {
    options: { timeout: 15000, launchBrowser: async settings => {
      assert.equal(settings.acceptInsecureCerts, false);
      return require('puppeteer').launch({ ...settings, headless: true });
    } }, confirmLogin: async () => assert.fail('unverified login must not reach confirmation'),
    stdout: { write() {} }, stderr: { write(value) { strictStderr += value; } },
  });
  assert.equal(strict, 4, strictStderr);
  assert.equal((await api.extractText(`${target}/account`, { ...options, session: 'tls', sessionDir: directory, includeSelectors: ['p'] })).data, 'Account');
  await assert.rejects(api.login(target, { insecure: 'yes', confirm: async () => {} }), api.FetcharyValidationError);
});
