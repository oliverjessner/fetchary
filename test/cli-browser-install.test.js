'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { main } = require('../cli');
const { FetcharyBrowserError } = require('../src/errors');

const installed = { browser: 'chrome', buildId: '157.0.8103.50', platform: 'test-platform', executablePath: '/test/package/.fetchary-browsers/chrome', skipped: false };

async function run(args, io = {}) {
  let stdout = ''; let stderr = ''; let installs = 0;
  const code = await main(args, {
    installBrowser: async () => { installs++; return installed; },
    ...io,
    stdout: { write: value => { stdout += value; } },
    stderr: { write: value => { stderr += value; } },
  });
  return { code, stdout, stderr, installs };
}

test('browser install dispatches without a URL and prints the installed browser version', async () => {
  const result = await run(['browser', 'install']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.installs, 1);
  assert.match(result.stdout, /Chrome|chrome/);
  assert.match(result.stdout, /157\.0\.8103\.50/);
  assert.equal(result.stderr, '');
});

test('browser install JSON is a single structured result and quiet suppresses successful output', async () => {
  const json = await run(['browser', 'install', '--json']);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), installed);
  assert.equal(json.stderr, '');
  const quiet = await run(['browser', 'install', '--json', '--quiet']);
  assert.equal(quiet.code, 0, quiet.stderr);
  assert.equal(quiet.installs, 1);
  assert.equal(quiet.stdout, '');
});

test('browser setup rejects unsupported subcommands, extra arguments and extraction options before installation', async () => {
  for (const args of [['browser'], ['browser', 'clear'], ['browser', 'install', 'chrome'], ['browser', 'install', '--mode', 'http'], ['browser', 'install', '--timeout', '1']]) {
    const result = await run(args);
    assert.equal(result.code, 2, args.join(' '));
    assert.equal(result.installs, 0);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
  }
});

test('browser help describes setup without invoking the installer', async () => {
  const result = await run(['browser', 'install', '--help']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.installs, 0);
  assert.match(result.stdout, /browser install/);
});

test('browser installation failures retain the browser exit code and JSON error format', async () => {
  const result = await run(['browser', 'install', '--json'], { installBrowser: async () => { throw new FetcharyBrowserError('could not install bundled Chrome'); } });
  assert.equal(result.code, 4);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { error: 'FetcharyBrowserError', message: 'could not install bundled Chrome' });
});

test('browser setup can save its JSON result while quiet keeps stdout empty', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-browser-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'browser.json');
  const result = await run(['browser', 'install', '--json', '--quiet', '--filepath', output]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), installed);
});
