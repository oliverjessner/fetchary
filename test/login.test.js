'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const api = require('../src');
const { main } = require('../cli');
const { saveSession } = require('../src/auth/sessions');
const url = 'https://www.example.test/login';
const secret = 'PRIVATE_LOGIN_SESSION';
const cookie = extra => ({ name: 'session', value: secret, domain: '.example.test', path: '/', secure: true, httpOnly: true, expires: -1, sameSite: 'Lax', ...extra });
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-login-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return path.join(root, 'sessions');
}
function fake(cookies = [cookie()]) {
  const browser = new EventEmitter(); const page = new EventEmitter();
  let closed = 0; let contextClosed = 0; let settings;
  page.goto = async target => { assert.equal(target, url); return { status: () => 200 }; };
  const context = { newPage: async () => page, cookies: async () => cookies, close: async () => { contextClosed++; } };
  browser.createBrowserContext = async () => context;
  browser.close = async () => { closed++; };
  return { browser, page, context, launchBrowser: async options => { settings = options; return browser; },
    get settings() { return settings; }, get closed() { return closed; }, get contextClosed() { return contextClosed; } };
}
async function run(args, io = {}) {
  let stdout = ''; let stderr = '';
  const code = await main(args, { ...io, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { code, stdout, stderr };
}
async function saved(t, extra = {}) {
  const sessionDir = directory(t); const browser = fake();
  const result = await api.login(url, { sessionDir, allowPrivateNetwork: true, launchBrowser: browser.launchBrowser, confirm: async () => {}, ...extra });
  return { sessionDir, browser, result };
}

test('interactive login launches visible isolated Chromium, waits for confirmation and saves only scoped cookies with private permissions', async t => {
  const sessionDir = directory(t);
  const browser = fake([cookie(), cookie({ name: 'host', domain: 'www.example.test' }), cookie({ domain: '.other.test', value: 'UNRELATED' }),
    cookie({ name: 'expired', expires: 1 }), cookie({ name: 'partitioned', partitionKey: 'https://example.test' })]);
  let confirmed = false;
  const result = await api.login(url, { session: 'example', sessionDir, allowPrivateNetwork: true, launchBrowser: browser.launchBrowser,
    confirm: async info => { assert.equal(info.session, 'example'); assert.equal(info.origin, 'https://www.example.test'); assert.ok(info.signal instanceof AbortSignal); assert.equal(fs.existsSync(sessionDir), false); confirmed = true; } });
  assert.equal(confirmed, true); assert.equal(browser.settings.headless, false); assert.equal(browser.settings.defaultViewport, null);
  assert.equal(Object.hasOwn(browser.settings, 'userDataDir'), false); assert.equal(browser.closed, 1); assert.equal(browser.contextClosed, 1);
  assert.equal(result.cookieCount, 2); assert.equal(result.session, 'example'); assert.ok(!JSON.stringify(result).includes(secret));
  const file = path.join(sessionDir, 'example.json'); const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(data.cookies.map(item => item.name), ['session', 'host']); assert.ok(!JSON.stringify(data).includes('UNRELATED'));
  assert.equal(data.cookies[0].expires, -1); assert.equal(data.cookies[0].httpOnly, true); assert.equal(data.cookies[0].sameSite, 'Lax');
  if (process.platform !== 'win32') { assert.equal(fs.statSync(sessionDir).mode & 0o777, 0o700); assert.equal(fs.statSync(file).mode & 0o777, 0o600); }
  assert.deepEqual(fs.readdirSync(sessionDir), ['example.json']);
});

test('saved sessions authenticate HTTP, dispatcher, clients, analysis and CLI without rewriting files or retaining authenticated captures', async t => {
  const { sessionDir } = await saved(t);
  const file = path.join(sessionDir, 'www.example.test.json'); const before = fs.readFileSync(file);
  let requests = 0;
  const settings = { session: 'www.example.test', sessionDir, mode: 'http', allowPrivateNetwork: true,
    fetch: async (target, options) => { requests++; assert.equal(options.headers.cookie, `session=${secret}`);
      return new Response('<title>Account</title><video src="/private.mp4"></video>', { headers: { 'content-type': 'text/html' } }); } };
  const client = api.createExtractor(settings);
  for (const call of [() => api.extract(url, { ...settings, type: 'metadata' }), () => client.extractMetadata(url), () => client.extractVideos(url), () => api.analyse(url, settings)]) {
    const result = await call(); assert.equal(result.cache.hit, false); assert.equal(result.cache.ttlMs, 0); assert.ok(!JSON.stringify(result).includes(secret));
  }
  const output = await run(['extract', 'videos', url, '--session', settings.session, '--session-dir', sessionDir, '--list'], { options: { ...settings, session: undefined, sessionDir: undefined } });
  assert.equal(output.code, 0, output.stderr); assert.equal(output.stdout, 'https://www.example.test/private.mp4\n'); assert.ok(requests >= 5);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('session names, conflicts, options and private targets fail before launching or requesting', async t => {
  const sessionDir = directory(t); let launches = 0; let requests = 0;
  const options = { sessionDir, confirm: async () => {}, launchBrowser: async () => { launches++; throw new Error(); } };
  for (const session of ['../outside', '/absolute', 'UPPER', '', 'x/y', 'a'.repeat(65)]) await assert.rejects(api.login(url, { ...options, session }), api.FetcharyValidationError);
  for (const extra of [{ timeout: 0 }, { confirm: null }, { sessionDir: true }, { signal: {} }, { allowPrivateNetwork: 'yes' }]) await assert.rejects(api.login(url, { ...options, ...extra }), api.FetcharyValidationError);
  await assert.rejects(api.login('http://127.0.0.1/', options), api.FetcharyValidationError);
  for (const extra of [{ cookieFile: '/unused' }, { cookiesFromBrowser: 'chrome' }, { headers: { cookie: secret } }, { session: '../outside' }, { session: undefined }]) {
    await assert.rejects(api.extractText(url, { session: 'example', sessionDir, fetch: async () => { requests++; }, ...extra }), api.FetcharyValidationError);
  }
  assert.equal(launches, 0); assert.equal(requests, 0); assert.equal(fs.existsSync(sessionDir), false);
  await assert.rejects(api.listSessions(null), api.FetcharyValidationError);
});

test('missing, unrelated, expired, corrupt, oversized and broadly readable sessions never send credentials', async t => {
  const { sessionDir } = await saved(t); const file = path.join(sessionDir, 'www.example.test.json');
  const original = fs.readFileSync(file); let requests = 0;
  const settings = { session: 'www.example.test', sessionDir, allowPrivateNetwork: true, fetch: async () => { requests++; } };
  await assert.rejects(api.extractText('https://other.test/', settings), api.FetcharyValidationError);
  await assert.rejects(api.extractText(url, { ...settings, session: 'missing' }), api.FetcharyValidationError);
  for (const body of ['{PRIVATE_INVALID_JSON', 'x'.repeat(1024 * 1024 + 1), JSON.stringify({ ...JSON.parse(original), cookies: [cookie({ expires: 1 })] })]) {
    fs.writeFileSync(file, body); await assert.rejects(api.extractText(url, settings), error => error instanceof api.FetcharyValidationError && !error.message.includes(secret));
  }
  fs.writeFileSync(file, original);
  if (process.platform !== 'win32') { fs.chmodSync(file, 0o644); await assert.rejects(api.extractText(url, settings), api.FetcharyValidationError); fs.chmodSync(file, 0o600); }
  const link = path.join(sessionDir, 'link.json'); fs.symlinkSync(file, link);
  await assert.rejects(api.extractText(url, { ...settings, session: 'link' }), api.FetcharyValidationError);
  assert.equal(requests, 0);
});

test('cancelled, closed, timed-out and failed logins preserve the previous session and sanitize browser errors', async t => {
  const { sessionDir } = await saved(t); const file = path.join(sessionDir, 'www.example.test.json'); const before = fs.readFileSync(file);
  for (const kind of ['abort', 'closed', 'timeout', 'browser', 'empty']) {
    const browser = fake(kind === 'empty' ? [] : [cookie({ value: 'replacement' })]); const controller = new AbortController();
    const options = { sessionDir, signal: controller.signal, timeout: kind === 'timeout' ? 20 : 5000, allowPrivateNetwork: true, launchBrowser: browser.launchBrowser,
      confirm: async () => { if (kind === 'abort') controller.abort(); else if (kind === 'closed') browser.page.emit('close'); else if (kind === 'timeout') await new Promise(() => {}); else if (kind === 'browser') throw new Error(secret); } };
    await assert.rejects(api.login(url, options), error => error instanceof api.FetcharyError && !error.message.includes(secret) && !error.cause);
    assert.equal(browser.closed, 1); assert.equal(browser.contextClosed, 1); assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(fs.readdirSync(sessionDir), ['www.example.test.json']);
  }
});

test('aborted launches return promptly and close browsers delivered after cancellation', async t => {
  const sessionDir = directory(t); let deliver; let closed = 0;
  const controller = new AbortController();
  const promise = api.login(url, { sessionDir, allowPrivateNetwork: true, signal: controller.signal, confirm: async () => {},
    launchBrowser: () => new Promise(resolve => { deliver = resolve; controller.abort(); }) });
  await assert.rejects(promise, api.FetcharyFetchError);
  deliver({ close: async () => { closed++; } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1); assert.equal(fs.existsSync(sessionDir), false);
});

test('missing Chromium gives a version-matched repair command through the API and CLI without replacing the session or leaking launcher details', async t => {
  const { sessionDir } = await saved(t);
  const file = path.join(sessionDir, 'www.example.test.json'); const before = fs.readFileSync(file);
  const options = { sessionDir, allowPrivateNetwork: true, confirm: async () => assert.fail('browser did not launch'),
    launchBrowser: async () => { throw new Error(`Could not find Chrome (ver. 155.0.8059.79). ${secret}`, { cause: new Error(secret) }); } };
  const command = `npx puppeteer@${require('puppeteer/package.json').version} browsers install chrome`;
  await assert.rejects(api.login(url, options), error => {
    assert.ok(error instanceof api.FetcharyBrowserError); assert.equal(error.phase, 'launch');
    assert.match(error.message, /required Chrome 155\.0\.8059\.79 is not installed/);
    assert.ok(error.message.includes(command)); assert.ok(error.message.includes('previous session kept'));
    assert.ok(!error.message.includes(secret)); assert.equal(error.cause, undefined); return true;
  });
  const output = await run(['login', url, '--session-dir', sessionDir, '--no-history'], { options, confirmLogin: options.confirm });
  assert.equal(output.code, 4); assert.equal(output.stdout, ''); assert.ok(output.stderr.includes(command)); assert.ok(!output.stderr.includes(secret));
  assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(fs.readdirSync(sessionDir), ['www.example.test.json']);
});

test('unknown launch errors stay sanitized and later protocol errors cannot become browser installation hints', async t => {
  const sessionDir = directory(t);
  await assert.rejects(api.login(url, { sessionDir, allowPrivateNetwork: true, confirm: async () => {},
    launchBrowser: async () => { throw new Error(secret); } }), error => {
    assert.equal(error.phase, 'launch'); assert.equal(error.message, 'could not launch login browser; previous session kept');
    assert.equal(error.cause, undefined); return true;
  });
  const browser = fake();
  await assert.rejects(api.login(url, { sessionDir, allowPrivateNetwork: true, launchBrowser: browser.launchBrowser,
    confirm: async () => { throw new Error(`Could not find Chrome (ver. 155.0.8059.79). ${secret}`); } }), error => {
    assert.equal(error.phase, 'login'); assert.equal(error.message, 'could not complete browser login; previous session kept');
    assert.equal(error.cause, undefined); return true;
  });
  assert.equal(browser.closed, 1); assert.equal(fs.existsSync(sessionDir), false);
});

test('login, sessions and logout CLI keep machine output free of prompts and credentials, and logout only removes the named local session', async t => {
  const sessionDir = directory(t); const browser = fake();
  const login = await run(['login', url, '--session', 'example', '--session-dir', sessionDir, '--json'], { options: { allowPrivateNetwork: true, launchBrowser: browser.launchBrowser }, confirmLogin: async () => {} });
  assert.equal(login.code, 0, login.stderr); assert.equal(JSON.parse(login.stdout).session, 'example'); assert.match(login.stderr, /Opening a browser/); assert.ok(!login.stdout.includes(secret));
  const sessions = await run(['sessions', '--session-dir', sessionDir, '--json']);
  assert.equal(JSON.parse(sessions.stdout)[0].activeCookieCount, 1); assert.ok(!sessions.stdout.includes(secret));
  assert.match((await run(['sessions', '--session-dir', sessionDir])).stdout, /^example\thttps:\/\/www.example.test\t1 active cookies/);
  const logout = await run(['logout', 'example', '--session-dir', sessionDir, '--json']); assert.equal(JSON.parse(logout.stdout).removed, true);
  assert.equal((await api.logout('example', { sessionDir })).removed, false); assert.deepEqual(await api.listSessions({ sessionDir }), []);
  assert.equal((await run(['sessions', '--session-dir', sessionDir, '--quiet'])).stdout, '');
  assert.equal(fs.existsSync(path.dirname(sessionDir)), true);
});

test('CLI rejects noninteractive login and invalid login/session flags before opening a browser', async t => {
  const sessionDir = directory(t); let launches = 0;
  const io = { stdin: { isTTY: false }, options: { launchBrowser: async () => { launches++; } } };
  const result = await run(['login', url, '--session-dir', sessionDir], io); assert.equal(result.code, 2); assert.match(result.stderr, /interactive terminal/);
  for (const args of [['login', url, '--list'], ['login', url, '--cookies', 'unused'], ['sessions', url], ['sessions', '--session', 'example'], ['logout'], ['logout', '../outside']]) {
    assert.equal((await run(args, io)).code, 2, args.join(' '));
  }
  assert.equal(launches, 0); assert.equal(fs.existsSync(sessionDir), false);
});

test('CLI terminal confirmation saves on Enter and cancels on EOF or Ctrl+C, cleaning up signal handlers', async t => {
  for (const action of ['\n', 'eof', '\u0003']) {
    const sessionDir = directory(t); const browser = fake(); const input = new PassThrough(); input.isTTY = true;
    const output = new PassThrough(); let stderr = ''; let stdout = ''; let sent = false;
    const listeners = process.listenerCount('SIGINT');
    output.on('data', chunk => {
      stderr += chunk;
      if (!sent && stderr.includes('Ctrl+C cancels')) { sent = true; setImmediate(() => { if (action === 'eof') input.end(); else input.write(action); }); }
    });
    const code = await main(['login', url, '--session', 'example', '--session-dir', sessionDir], {
      stdin: input, stderr: output, stdout: { write: value => { stdout += value; } },
      options: { allowPrivateNetwork: true, launchBrowser: browser.launchBrowser, timeout: 1000 },
    });
    assert.equal(code, action === '\n' ? 0 : 3, stderr);
    assert.equal(fs.existsSync(path.join(sessionDir, 'example.json')), action === '\n');
    assert.equal(process.listenerCount('SIGINT'), listeners); assert.equal(browser.closed, 1);
    assert.ok(!stdout.includes(secret)); input.destroy(); output.destroy();
  }
});

test('saved-session writes are atomic and refuse symlink destinations or unprivate directories', async t => {
  const sessionDir = directory(t); fs.mkdirSync(sessionDir, { mode: 0o700 });
  const outside = path.join(path.dirname(sessionDir), 'untouched'); fs.writeFileSync(outside, 'original', { mode: 0o600 });
  fs.symlinkSync(outside, path.join(sessionDir, 'example.json'));
  const data = { version: 1, origin: 'https://www.example.test', savedAt: new Date().toISOString(), cookies: [cookie()] };
  await assert.rejects(saveSession('example', data, { sessionDir }), api.FetcharyValidationError); assert.equal(fs.readFileSync(outside, 'utf8'), 'original');
  if (process.platform !== 'win32') { fs.chmodSync(sessionDir, 0o755); await assert.rejects(saveSession('new', data, { sessionDir }), api.FetcharyValidationError); fs.chmodSync(sessionDir, 0o700); }
  assert.deepEqual(fs.readdirSync(sessionDir), ['example.json']);
});

test('real visible Chromium login submits a form, saves an HttpOnly session, then authenticates HTTP, browser and spawned CLI extractions', async t => {
  const sessionDir = directory(t);
  const server = http.createServer((request, response) => {
    if (request.url === '/sign-in' && request.method === 'POST') { request.resume(); response.writeHead(302, { 'set-cookie': 'session=fixture-auth; HttpOnly; Path=/; SameSite=Lax', location: '/account' }); response.end(); return; }
    if (request.url === '/account') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(request.headers.cookie?.includes('session=fixture-auth') ? '<html><head><title>Signed in</title></head><body><h1>Account</h1></body></html>' : '<html><head><title>Anonymous</title></head><body>Anonymous</body></html>'); return; }
    response.writeHead(200, { 'content-type': 'text/html' }); response.end('<html><head><title>Fetchary login test</title></head><body><h1>Sign in to the local test site</h1><form action="/sign-in" method="post"><label>Test username <input name="username" autocomplete="username"></label><label>Test password <input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form></body></html>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const target = `http://127.0.0.1:${server.address().port}`; let realBrowser;
  const result = await api.login(target, { session: 'fixture', sessionDir, allowPrivateNetwork: true, timeout: 20_000,
    launchBrowser: async options => { realBrowser = await require('puppeteer').launch(options); return realBrowser; },
    confirm: async () => {
      const contexts = realBrowser.browserContexts(); const page = (await contexts.at(-1).pages())[0];
      assert.equal(await page.title(), 'Fetchary login test');
      await page.type('[name=username]', 'fixture-user'); await page.type('[name=password]', 'fixture-password');
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('button')]); assert.equal(await page.title(), 'Signed in');
    } });
  assert.equal(result.cookieCount, 1); assert.equal(realBrowser.connected, false);
  const bytes = fs.readFileSync(path.join(sessionDir, 'fixture.json'), 'utf8'); assert.ok(!bytes.includes('fixture-password')); assert.ok(!bytes.includes('fixture-user'));
  const options = { session: 'fixture', sessionDir, allowPrivateNetwork: true, waitAfterLoad: 0, timeout: 5000 };
  assert.equal((await api.extractMetadata(`${target}/account`, { ...options, mode: 'http' })).data.title, 'Signed in');
  assert.equal((await api.extractMetadata(`${target}/account`, { ...options, mode: 'browser' })).data.title, 'Signed in');
  const child = spawn(process.execPath, [path.join(__dirname, '../cli/index.js'), 'extract', 'text', `${target}/account`, '--session', 'fixture', '--session-dir', sessionDir, '--mode', 'http', '--include-selector', 'h1', '--allow-private-network']);
  let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert.equal(code, 0, stderr); assert.equal(stdout, 'Account');
});
