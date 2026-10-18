'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { main } = require('../cli');
const { recordHistory, readHistory } = require('../cli/history');
const url = 'https://example.test/';
const svg = '<svg width="64" height="64"></svg>';
function root(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-output-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }
function settings() { return { mode: 'http', allowPrivateNetwork: true, fetch: async target => new Response(target.endsWith('.svg') ? svg : '<html><head><title>Test</title><link rel="icon" href="/icon.svg"></head><body><h1>Page</h1><a href="/one">One</a><video src="/clip.mp4"></video></body></html>', { headers: { 'content-type': target.endsWith('.svg') ? 'image/svg+xml' : 'text/html' } }) }; }
async function run(args, io = {}) {
  let stdout = ''; let stderr = '';
  const code = await main(args, { options: settings(), ...io, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { code, stdout, stderr };
}

test('--filepath saves the same successful output with the right extension across extraction, analysis, help and version', async t => {
  const directory = root(t);
  const cases = [
    [['extract','text',url], 'txt'], [['extract','html',url], 'html'], [['extract','links',url], 'json'],
    [['extract','links',url,'--list'], 'txt'], [['extract','html',url,'--json'], 'json'], [['extract','links',url,'--list','--json'], 'json'],
    [['extract','selector',url,'--selector','h1','--format','html'], 'html'], [['extract','selector',url,'--selector','h1','--format','html','--list'], 'txt'],
    [['favicon',url], 'txt'], [['favicon',url,'--binary'], 'svg'], [['analyse',url], 'json'], [['--help'], 'txt'], [['--version'], 'txt'], [[], 'txt'],
  ];
  for (const [args, extension] of cases) {
    const before = new Set(fs.readdirSync(directory)); const result = await run(['--filepath', directory, ...args]);
    assert.equal(result.code, 0, result.stderr);
    const added = fs.readdirSync(directory).filter(file => !before.has(file)); assert.equal(added.length, 1, args.join(' '));
    assert.equal(path.extname(added[0]), '.' + extension); assert.equal(fs.readFileSync(path.join(directory, added[0]), 'utf8'), result.stdout);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, added[0])).mode & 0o777, 0o600);
  }
});

test('--filepath works for login, sessions, logout and history without saving prompts or cookie values', async t => {
  const directory = root(t); const output = path.join(directory, 'output'); const sessionDir = path.join(directory, 'sessions');
  const launchBrowser = async () => ({ createBrowserContext: async () => ({ newPage: async () => ({ goto: async () => ({ status: () => 200 }) }), cookies: async () => [{ name: 'session', value: 'PRIVATE_COOKIE', domain: 'example.test', path: '/', secure: true, expires: -1 }], close: async () => {} }), close: async () => {} });
  const io = { options: { allowPrivateNetwork: true, launchBrowser }, confirmLogin: async () => {}, historyFile: path.join(directory, 'history.json') };
  for (const args of [['login',url,'--session','example','--session-dir',sessionDir,'--json'], ['sessions','--session-dir',sessionDir,'--json'], ['sessions','--session-dir',sessionDir], ['logout','example','--session-dir',sessionDir], ['history','--json']]) {
    const before = fs.existsSync(output) ? new Set(fs.readdirSync(output)) : new Set();
    const result = await run([...args, '--filepath', output], io); assert.equal(result.code, 0, result.stderr);
    const file = fs.readdirSync(output).find(file => !before.has(file)); const body = fs.readFileSync(path.join(output, file), 'utf8');
    assert.equal(body, result.stdout); assert.ok(!body.includes('PRIVATE_COOKIE')); assert.ok(!body.includes('Opening a browser'));
    assert.equal(path.extname(file), args.includes('--json') ? '.json' : '.txt');
  }
});

test('--filepath handles explicit files, quiet, empty lists and safe repeated directory exports', async t => {
  const directory = root(t); const target = path.join(directory, 'nested', 'result.json');
  const quiet = await run(['extract','links',url,'--json','--quiet','--filepath',target]);
  assert.equal(quiet.code, 0, quiet.stderr); assert.equal(quiet.stdout, ''); assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).type, 'links');
  const empty = path.join(directory, 'empty.txt');
  const result = await run(['extract','videos',url,'--include-selector','missing','--list','--filepath',empty]);
  assert.equal(result.code, 0); assert.equal(fs.readFileSync(empty, 'utf8'), '');
  for (let i = 0; i < 2; i++) assert.equal((await run(['extract','text',url,'--filepath',directory])).code, 0);
  assert.equal(fs.readdirSync(directory).filter(file => file.startsWith('fetchary-extract-text-')).length, 2);
});

test('output exports do not overwrite files and do not save failed command output', async t => {
  const directory = root(t); const target = path.join(directory, 'existing.txt'); fs.writeFileSync(target, 'keep'); let requests = 0;
  const options = { ...settings(), fetch: async () => { requests++; return new Response('failed', { status: 503 }); } };
  assert.equal((await run(['extract','text',url,'--filepath',target], { options })).code, 2); assert.equal(requests, 0); assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  const missing = path.join(directory, 'not-created');
  assert.equal((await run(['extract','text',url,'--filepath',missing], { options })).code, 3); assert.equal(fs.existsSync(missing), false);
  const race = path.join(directory, 'race.txt');
  const result = await run(['extract','text',url,'--filepath',race], { options: { ...settings(), fetch: async () => { fs.writeFileSync(race, 'other writer'); return new Response('success'); } } });
  assert.equal(result.code, 1); assert.equal(fs.readFileSync(race, 'utf8'), 'other writer');
});

test('history records recent successful and failed commands, displays newest first and excludes history/help/version/opt-out calls', async t => {
  const directory = root(t); const historyFile = path.join(directory, 'history.json'); const io = { historyFile, recordHistory: true };
  await run(['extract','text',url], io); await run(['unknown-command'], io); await run(['extract','text',url,'--mode','invalid'], io);
  for (const args of [['--help'], ['--version'], ['extract','text',url,'--no-history']]) await run(args, io);
  const listed = await run(['history','--json'], io); assert.equal(listed.code, 0, listed.stderr);
  const entries = JSON.parse(listed.stdout); assert.equal(entries.length, 3); assert.deepEqual(entries.map(item => item.exitCode), [2,2,0]); assert.match(entries[0].command, /--mode invalid/);
  assert.ok(entries.every(entry => Number.isFinite(Date.parse(entry.timestamp))));
  const plain = await run(['history'], io); assert.match(plain.stdout, /^TIME \(UTC\)\tEXIT\tCOMMAND/);
  const list = await run(['history','--list'], io); assert.equal(list.stdout.split('\n').filter(Boolean).length, 3);
  assert.equal((await readHistory(historyFile)).length, 3);
  if (process.platform !== 'win32') assert.equal(fs.statSync(historyFile).mode & 0o777, 0o600);
});

test('history works in an existing owner-controlled 755 directory and keeps its file private without changing directory permissions', { skip: process.platform === 'win32' }, async t => {
  const directory = root(t); fs.chmodSync(directory, 0o755);
  const historyFile = path.join(directory, 'history.json');
  const result = await run(['extract','text',url], { historyFile, recordHistory: true });
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  assert.equal((await readHistory(historyFile)).length, 1);
  assert.equal(fs.statSync(historyFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o755);
  await recordHistory(historyFile, ['extract','links',url], 0);
  assert.equal((await readHistory(historyFile)).length, 2);
  assert.equal(fs.statSync(historyFile).mode & 0o777, 0o600);
});

test('history refuses shared writable directories, symlinks and nonprivate files without changing existing contents or permissions', { skip: process.platform === 'win32' }, async t => {
  const directory = root(t); const file = path.join(directory, 'history.json');
  fs.writeFileSync(file, '[]\n', { mode: 0o600 });
  for (const mode of [0o775, 0o777]) {
    fs.chmodSync(directory, mode);
    await assert.rejects(recordHistory(file, ['sessions'], 0), /history directory must not be writable by group or other users/);
    assert.equal(fs.statSync(directory).mode & 0o777, mode); assert.equal(fs.readFileSync(file, 'utf8'), '[]\n');
  }
  fs.chmodSync(directory, 0o755); fs.chmodSync(file, 0o644);
  await assert.rejects(recordHistory(file, ['sessions'], 0), /could not read command history/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o644); assert.equal(fs.readFileSync(file, 'utf8'), '[]\n');
  const linkedDirectory = path.join(directory, 'linked'); fs.symlinkSync(directory, linkedDirectory);
  await assert.rejects(recordHistory(path.join(linkedDirectory, 'history.json'), ['sessions'], 0), /not a symlink/);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['history.json','linked']);
});

test('history retains exactly the latest 100 commands and serializes concurrent updates without losing entries', async t => {
  const directory = root(t); const file = path.join(directory, 'history.json');
  for (let index = 0; index < 105; index++) await recordHistory(file, ['extract','text',`https://example.test/${index}`], 0);
  let entries = await readHistory(file); assert.equal(entries.length, 100); assert.equal(entries[0].args.at(-1), 'https://example.test/5'); assert.equal(entries.at(-1).args.at(-1), 'https://example.test/104');
  const concurrent = path.join(directory, 'concurrent.json');
  await Promise.all(Array.from({ length: 12 }, (_, index) => recordHistory(concurrent, ['extract','text',`https://example.test/${index}`], index % 2)));
  entries = await readHistory(concurrent); assert.equal(entries.length, 12); assert.equal(new Set(entries.map(entry => entry.args.at(-1))).size, 12);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['concurrent.json','history.json']);
});

test('history redacts URL credentials, sensitive query values, fragments and credential flags without storing outputs', async t => {
  const directory = root(t); const historyFile = path.join(directory, 'history.json'); const io = { historyFile, recordHistory: true };
  await run(['extract','text','https://user:PRIVATE_PASSWORD@example.test/page?v=video-id&access_token=PRIVATE_TOKEN#PRIVATE_FRAGMENT'], io);
  await run(['extract','text',url,'--password=PRIVATE_FLAG'], io);
  const bytes = fs.readFileSync(historyFile, 'utf8');
  for (const value of ['PRIVATE_PASSWORD','PRIVATE_TOKEN','PRIVATE_FRAGMENT','PRIVATE_FLAG','<h1>Page</h1>']) assert.ok(!bytes.includes(value), value);
  assert.match(bytes, /video-id/); assert.match(bytes, /redacted/);
});

test('history read failures are explicit and failed recording preserves the command outcome and corrupt file', async t => {
  const directory = root(t); const historyFile = path.join(directory, 'history.json'); fs.writeFileSync(historyFile, 'corrupt', { mode: 0o600 });
  const io = { historyFile, recordHistory: true }; const view = await run(['history','--json'], io);
  assert.equal(view.code, 2); assert.equal(JSON.parse(view.stderr).error, 'FetcharyValidationError');
  const result = await run(['extract','text',url], io); assert.equal(result.code, 0); assert.match(result.stderr, /Warning: could not save command history/);
  assert.equal(fs.readFileSync(historyFile, 'utf8'), 'corrupt'); assert.deepEqual(fs.readdirSync(directory), ['history.json']);
  const missing = path.join(directory, 'missing', 'history.json'); assert.deepEqual(await readHistory(missing), []); assert.equal(fs.existsSync(path.dirname(missing)), false);
});

test('long and numerous invalid arguments remain bounded and do not corrupt subsequent history reads', async t => {
  const directory = root(t); const file = path.join(directory, 'history.json');
  await recordHistory(file, ['--token-' + 'x'.repeat(5000) + '=PRIVATE_VALUE'], 2);
  await recordHistory(file, Array.from({ length: 1100 }, () => 'argument'), 2);
  const entries = await readHistory(file); assert.equal(entries.length, 2); assert.equal(entries[1].args.length, 1100);
  assert.ok(entries[0].args[0].length < 4120); assert.ok(!fs.readFileSync(file, 'utf8').includes('PRIVATE_VALUE'));
});

test('real CLI processes share a bounded history file safely and history itself remains read-only', async t => {
  const directory = root(t); const historyFile = path.join(directory, 'commands', 'history.json');
  const server = http.createServer((request, response) => { response.writeHead(200, { 'content-type':'text/html' }); response.end('<h1>Native</h1>'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); t.after(() => new Promise(resolve => server.close(resolve)));
  const target = `http://127.0.0.1:${server.address().port}/`;
  async function spawnCli(args) {
    const child = spawn(process.execPath, [path.join(__dirname, '../cli/index.js'), ...args], { env: { ...process.env, FETCHARY_HISTORY_FILE: historyFile } });
    let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert.equal(code, 0, stderr); return stdout;
  }
  await Promise.all(Array.from({ length: 8 }, (_, index) => spawnCli(['extract','text',target,'--mode','http','--user-agent',`fixture-${index}`,'--allow-private-network'])));
  const entries = JSON.parse(await spawnCli(['history','--json'])); assert.equal(entries.length, 8); assert.equal(new Set(entries.map(entry => entry.args[entry.args.indexOf('--user-agent') + 1])).size, 8);
  assert.equal((await readHistory(historyFile)).length, 8);
});
