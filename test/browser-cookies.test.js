'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const childProcess = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createCipheriv, createHash, pbkdf2Sync } = require('node:crypto');
const api = require('../src');
const { main } = require('../cli');
const { loadBrowserCookieJar, profileDirectory } = require('../src/capture/browser-cookies');

const root = 'https://www.linkedin.test/in/example';
const lookup = async () => [{address:'93.184.216.34', family:4}];
const password = 'fixture-safe-storage-password';
const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
const future = (BigInt(Date.now()) * 1000n) + 11644473600000000n + 3600000000n;
const macOnly = {skip:process.platform !== 'darwin'};
function encrypted(value, host = '.linkedin.test', version = 24) {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
  const clear = Buffer.concat([version >= 24 ? createHash('sha256').update(host).digest() : Buffer.alloc(0), Buffer.from(value)]);
  return Buffer.concat([Buffer.from('v10'), cipher.update(clear), cipher.final()]);
}
function fixture(t, {version = 24, rows = [{}], network = true, wal = false} = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-chrome-test-'));
  const directory = profileDirectory('Default', home);
  fs.mkdirSync(network ? path.join(directory, 'Network') : directory, {recursive:true});
  const file = path.join(directory, ...(network ? ['Network', 'Cookies'] : ['Cookies']));
  const db = new DatabaseSync(file);
  if (wal) db.exec('PRAGMA journal_mode=WAL');
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY, value INTEGER);
    CREATE TABLE cookies(creation_utc INTEGER, host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
      path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, has_expires INTEGER, top_frame_site_key TEXT);`);
  db.prepare("INSERT INTO meta VALUES ('version', ?)").run(version);
  const insert = db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  rows.forEach((extra, index) => {
    const row = {creation:BigInt(index), host:'.linkedin.test', name:'li_at', value:'fixture-session', encrypted:Buffer.alloc(0),
      path:'/', expires:future, secure:1, httpOnly:1, sameSite:-1, hasExpires:1, partition:'', ...extra};
    insert.run(row.creation, row.host, row.name, row.value, row.encrypted, row.path, row.expires, row.secure, row.httpOnly, row.sameSite, row.hasExpires, row.partition);
  });
  if (!wal) db.close();
  t.after(() => {if (wal) db.close(); fs.rmSync(home, {recursive:true, force:true});});
  return {home, directory, file, db:wal ? db : null};
}
function load(profile, url = root, extra = {}, dependencies = {}) {
  return loadBrowserCookieJar({cookiesFromBrowser:'chrome', browserProfile:profile.directory, ...extra}, url,
    {platform:'darwin', readPassword:async () => Buffer.from(password), ...dependencies});
}
async function cli(args, options) {
  let stdout = ''; let stderr = '';
  const code = await main(args, {options, stdout:{write:value => stdout += value}, stderr:{write:value => stderr += value}});
  return {code, stdout, stderr};
}
function mockKeychain(t, error) {
  let calls = 0;
  t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    calls++;
    assert.equal(file, '/usr/bin/security');
    assert.deepEqual(args, ['find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome']);
    assert.equal(options.encoding, 'buffer');
    assert.ok(options.timeout > 0 && options.timeout <= 30000);
    setImmediate(() => callback(error, Buffer.from(`${password}\n`)));
  });
  return () => calls;
}

test('Chrome profiles resolve Default, a named profile, and explicit absolute directories', async t => {
  const profile = fixture(t);
  assert.equal(profileDirectory(undefined, profile.home), profile.directory);
  assert.equal(profileDirectory('Profile 1', profile.home), path.join(path.dirname(profile.directory), 'Profile 1'));
  assert.equal(profileDirectory(profile.directory, '/unused'), profile.directory);
  const jar = await loadBrowserCookieJar({cookiesFromBrowser:'chrome'}, root, {platform:'darwin', home:profile.home});
  assert.equal(jar.header(root), 'li_at=fixture-session');
});

test('Chrome v24 domain hashes and legacy v23 CBC cookies decrypt with one scoped keychain read', async t => {
  for (const version of [23, 24]) {
    const profile = fixture(t, {version, rows:[
      {value:'', encrypted:encrypted('fixture-login', '.linkedin.test', version)},
      {name:'JSESSIONID', value:'', encrypted:encrypted('"ajax:fixture"', '.linkedin.test', version), httpOnly:0, sameSite:1, hasExpires:0, expires:0n},
      {name:'hostOnly', host:'www.linkedin.test', path:'/in', sameSite:2},
      {host:'unrelated.test', value:'', encrypted:Buffer.from('v20-invalid')},
      {name:'expired', value:'', encrypted:Buffer.from('v20-invalid'), expires:1n},
      {name:'partitioned', value:'', encrypted:Buffer.from('v20-invalid'), partition:'https://other.test'},
    ]});
    let reads = 0; const secret = Buffer.from(password);
    const jar = await load(profile, root, {}, {readPassword:async () => {reads++; return secret;}});
    assert.equal(reads, 1); assert.ok(secret.every(byte => byte === 0));
    assert.equal(jar.header(root), 'hostOnly=fixture-session; li_at=fixture-login; JSESSIONID="ajax:fixture"');
    assert.equal(jar.header('https://other.test/'), ''); assert.equal(jar.header('https://linkedin.test/'), '');
    assert.equal(jar.header('http://www.linkedin.test/'), '');
    const cookies = jar.browserCookies(); assert.equal(cookies.length, 3);
    assert.equal(cookies[0].httpOnly, true); assert.ok(cookies[0].expires > Date.now() / 1000);
    assert.equal(cookies[1].expires, undefined); assert.equal(cookies[1].sameSite, 'Lax');
    assert.equal(cookies[2].domain, 'www.linkedin.test'); assert.equal(cookies[2].sameSite, 'Strict');
  }
});

test('Chrome imports plaintext cookies without touching Keychain and supports the legacy Cookies location', async t => {
  const profile = fixture(t, {network:false, rows:[{sameSite:0}, {name:'child', host:'static.www.linkedin.test'}]});
  const before = fs.readFileSync(profile.file);
  const jar = await load(profile, root, {}, {readPassword:async () => {throw new Error('must not access Keychain');}});
  assert.equal(jar.header(root), 'li_at=fixture-session');
  assert.equal(jar.header('https://static.www.linkedin.test/'), 'li_at=fixture-session; child=fixture-session');
  assert.equal(jar.browserCookies()[0].sameSite, 'None');
  assert.deepEqual(fs.readFileSync(profile.file), before);
  assert.deepEqual(fs.readdirSync(profile.directory), ['Cookies']);
});

test('Chrome reads committed WAL rows while the writer stays open, with no cookie database changes', async t => {
  const profile = fixture(t, {wal:true}); const before = fs.readFileSync(profile.file);
  profile.db.exec('BEGIN'); profile.db.prepare("UPDATE cookies SET value='uncommitted'").run();
  const jar = await load(profile); assert.equal(jar.header(root), 'li_at=fixture-session');
  assert.deepEqual(fs.readFileSync(profile.file), before); profile.db.exec('ROLLBACK');
  assert.equal(profile.db.prepare('SELECT count(*) AS count FROM cookies').get().count, 1);
});

test('Chrome rejects wrong domain hashes, corrupt ciphertext, unknown encryption and invalid cookie values without exposing credentials', async t => {
  const bad = [encrypted('PRIVATE_SESSION', 'wrong.test'), Buffer.from('v20-PRIVATE_SESSION'), Buffer.from('v10invalid'),
    Buffer.concat([Buffer.from('v10'), Buffer.alloc(16)]), encrypted('PRIVATE_SESSION; invalid')];
  for (const value of bad) {
    const profile = fixture(t, {rows:[{value:'', encrypted:value}]});
    await assert.rejects(load(profile), error => error instanceof api.FetcharyValidationError
      && !error.message.includes('PRIVATE_SESSION') && !error.message.includes(password) && error.cause === undefined);
  }
});

test('Chrome fails before Keychain access for missing, expired, unrelated, future-schema and oversized records', async t => {
  const fixtures = [fixture(t, {rows:[]}), fixture(t, {rows:[{expires:1n}]}), fixture(t, {rows:[{host:'.unrelated.test'}]}),
    fixture(t, {version:25}), fixture(t, {version:14}), fixture(t, {rows:[{value:'x'.repeat(1024 * 1024 + 1)}]}),
    fixture(t, {rows:Array.from({length:3001}, (_, i) => ({name:`cookie${i}`}))})];
  let reads = 0;
  for (const profile of fixtures) await assert.rejects(load(profile, root, {}, {readPassword:async () => {reads++; return Buffer.from(password);}}), api.FetcharyValidationError);
  assert.equal(reads, 0);
  await assert.rejects(load({directory:path.join(fixtures[0].home, 'missing')}), /database not found/);
  fs.writeFileSync(fixtures[0].file, 'PRIVATE_BAD_DATABASE');
  await assert.rejects(load(fixtures[0]), error => error instanceof api.FetcharyValidationError && !error.message.includes('PRIVATE_BAD_DATABASE') && !error.cause);
});

test('browser-cookie options reject conflicts and unsupported values before accessing a profile', async () => {
  const options = [{cookiesFromBrowser:'firefox'}, {cookiesFromBrowser:true}, {cookiesFromBrowser:'chrome', cookieFile:'unused'},
    {browserProfile:'Default'}, {cookiesFromBrowser:'chrome', headers:{Cookie:'PRIVATE'}},
    ...['', '../Default', '.', '..', 'Profile/1', 'bad\0path', 42].map(browserProfile => ({cookiesFromBrowser:'chrome', browserProfile}))];
  for (const option of options) await assert.rejects(api.extractText(root, option), api.FetcharyValidationError);
  assert.throws(() => api.createExtractor({cookiesFromBrowser:'chrome', cookieFile:'unused'}), api.FetcharyValidationError);
  assert.doesNotThrow(() => api.createExtractor({cookiesFromBrowser:'chrome', browserProfile:'Profile 1'}));
});

test('macOS profile privacy denials are actionable and never trigger Keychain access', async t => {
  const profile = fixture(t); let reads = 0;
  t.mock.method(fsPromises, 'open', async () => {throw Object.assign(new Error('PRIVATE_FILE_ERROR'), {code:'EPERM'});});
  await assert.rejects(load(profile, root, {}, {readPassword:async () => {reads++;}}), error =>
    error instanceof api.FetcharyValidationError && /Privacy & Security/.test(error.message)
    && !error.message.includes('PRIVATE_FILE_ERROR') && error.cause === undefined);
  assert.equal(reads, 0);
});

test('browser-cookie loading handles unsupported platforms and cancellation without Keychain access', async t => {
  const profile = fixture(t); let reads = 0;
  await assert.rejects(load(profile, root, {}, {platform:'win32', readPassword:async () => {reads++;}}), /macOS only/);
  await assert.rejects(load(profile, root, {signal:AbortSignal.abort()}), api.FetcharyFetchError);
  const encryptedProfile = fixture(t, {rows:[{value:'', encrypted:encrypted('fixture-login')}]});
  const controller = new AbortController(); const secret = Buffer.from(password);
  await assert.rejects(load(encryptedProfile, root, {signal:controller.signal}, {readPassword:async () => {controller.abort(); return secret;}}), api.FetcharyFetchError);
  assert.ok(secret.every(byte => byte === 0)); assert.equal(reads, 0);
});

test('public browser-cookie captures re-read the profile, bypass caches and preserve anonymous cache entries', macOnly, async t => {
  const profile = fixture(t); let requests = 0;
  const client = api.createExtractor({mode:'http', lookup, fetch:async (url, options) => {
    requests++; return new Response(`<p>${options.headers.cookie ? 'Signed in' : 'Anonymous'}</p>`, {headers:{'content-type':'text/html'}});
  }});
  assert.equal((await client.extractText(root)).data, 'Anonymous');
  const options = {cookiesFromBrowser:'chrome', browserProfile:profile.directory};
  await Promise.all([client.extractText(root, options), client.extractText(root, options)]); assert.equal(requests, 3);
  assert.equal((await client.extractText(root, options)).cache.ttlMs, 0); assert.equal(requests, 4);
  const writer = new DatabaseSync(profile.file); writer.exec('DELETE FROM cookies'); writer.close();
  await assert.rejects(client.extractText(root, options), /no unexpired cookies/); assert.equal(requests, 4);
  assert.equal((await client.extractText(root)).data, 'Anonymous'); assert.equal(requests, 4);
});

test('public Chrome Keychain invocation is bounded, redacts failures and never passes credentials as arguments', macOnly, async t => {
  const profile = fixture(t, {rows:[{value:'', encrypted:encrypted('fixture-login')}]});
  const calls = mockKeychain(t, new Error(`denied: ${password}`));
  await assert.rejects(api.extractText(root, {cookiesFromBrowser:'chrome', browserProfile:profile.directory}), error =>
    error instanceof api.FetcharyValidationError && /Keychain/.test(error.message) && !error.message.includes(password) && error.cause === undefined);
  assert.equal(calls(), 1);
});

test('real Chromium receives decrypted Chrome cookies in an isolated context and hides HttpOnly values from scripts', macOnly, async t => {
  const profile = fixture(t, {rows:[{value:'', encrypted:encrypted('fixture-login')},
    {name:'JSESSIONID', value:'', encrypted:encrypted('"ajax:fixture"'), httpOnly:0}]});
  const calls = mockKeychain(t); const seen = []; const before = fs.readFileSync(profile.file);
  const result = await api.extractHtml(root, {cookiesFromBrowser:'chrome', browserProfile:profile.directory, mode:'browser', waitAfterLoad:100, lookup,
    fetch:async (url, options) => {
      seen.push({url, cookie:options.headers.cookie});
      return new Response(url === root ? '<html><body><script>document.body.dataset.csrf=document.cookie.includes("JSESSIONID");document.body.dataset.hidden=!document.cookie.includes("li_at");document.cookie="runtime=updated; path=/; secure";fetch("/account");</script><img src="https://other.test/icon.svg"></body></html>' : '<svg width="1" height="1"></svg>', {headers:{'content-type':url === root ? 'text/html' : 'image/svg+xml'}});
    }});
  assert.match(result.data, /data-csrf="true"/); assert.match(result.data, /data-hidden="true"/);
  assert.match(seen.find(request => request.url.endsWith('/account')).cookie, /li_at=fixture-login/);
  assert.match(seen.find(request => request.url.endsWith('/account')).cookie, /runtime=updated/);
  assert.equal(seen.find(request => request.url === 'https://other.test/icon.svg').cookie, undefined);
  assert.equal(calls(), 1); assert.equal(result.cache.ttlMs, 0);
  assert.ok(!JSON.stringify(result).includes('fixture-login')); assert.deepEqual(fs.readFileSync(profile.file), before);
});

test('analyse imports Chrome once and authenticates the shared document and favicon requests', macOnly, async t => {
  const profile = fixture(t, {rows:[{value:'', encrypted:encrypted('fixture-login')}]});
  const calls = mockKeychain(t); const seen = [];
  const result = await api.analyse(root, {cookiesFromBrowser:'chrome', browserProfile:profile.directory, mode:'http', lookup,
    fetch:async (url, options) => {
      seen.push({url, cookie:options.headers.cookie});
      return new Response(url === root ? '<html><head><title>Profile</title><link rel="icon" href="/icon.svg"></head><body>Profile</body></html>' : '<svg width="32" height="32"></svg>', {headers:{'content-type':url === root ? 'text/html' : 'image/svg+xml'}});
    }});
  assert.equal(calls(), 1); assert.equal(seen.filter(request => request.url === root).length, 1);
  assert.equal(result.summary.succeeded, 11); assert.ok(seen.every(request => request.cookie === 'li_at=fixture-login'));
  assert.equal(result.cache.ttlMs, 0); assert.ok(!JSON.stringify(result).includes('fixture-login'));
});

test('CLI browser flags reach social-insights and preserve follower and list output', macOnly, async t => {
  const profile = fixture(t, {rows:[{host:'.linkedin.com'}]});
  const options = {mode:'http', lookup, fetch:async (url, options) => new Response(options.headers.cookie === 'li_at=fixture-session'
    ? '<h3 class="top-card-layout__first-subline">1234 followers</h3>' : '<title>Sign in</title>', {headers:{'content-type':'text/html'}})};
  for (const suffix of [[], ['--list']]) {
    const result = await cli(['extract', 'social-insights', 'https://www.linkedin.com/in/example', '--follower', '--cookies-from-browser', 'chrome', '--browser-profile', profile.directory, ...suffix], options);
    assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, '1234\n'); assert.equal(result.stderr, '');
  }
  for (const flags of [['--cookies-from-browser'], ['--cookies-from-browser', 'firefox'], ['--browser-profile', 'Default'],
    ['--cookies-from-browser', 'chrome', '--cookies', 'unused']]) {
    const result = await cli(['extract', 'text', root, ...flags], options); assert.equal(result.code, 2);
  }
});

test('spawned CLI authenticates a native HTTP fixture directly from a Chrome profile', macOnly, async t => {
  const profile = fixture(t, {rows:[{host:'127.0.0.1', secure:0}]});
  const server = http.createServer((request, response) => {
    response.writeHead(200, {'content-type':'text/html'});
    response.end(request.headers.cookie === 'li_at=fixture-session' ? '<title>Signed in</title>' : '<title>Anonymous</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const target = `http://127.0.0.1:${server.address().port}/`;
  const child = childProcess.spawn(process.execPath, [path.join(__dirname, '../cli/index.js'), 'extract', 'metadata', target, '--mode', 'http', '--allow-private-network', '--cookies-from-browser', 'chrome', '--browser-profile', profile.directory]);
  let stdout = ''; let stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 0, stderr);
  assert.equal(JSON.parse(stdout).data.title, 'Signed in'); assert.ok(!stdout.includes('fixture-session'));
});
