'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { main } = require('../cli/index');

async function runCli(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, {
    color: options.color,
    stdout: { isTTY: options.isTTY, write: chunk => { stdout += chunk; } },
    stderr: { write: chunk => { stderr += chunk; } },
  });
  return { code, stdout, stderr };
}

test('CLI wraps add/list/fetch/show/history/diff and uses documented exit codes', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let body = '<h1>first</h1>\n';
  let status = 200;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status, headers: { 'content-type': 'text/html', etag: '"cli"' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const url = 'https://example.test/page';
  const base = ['--data-dir', dataDir];

  const added = await runCli(['add', url, '--name', 'Test page', '--tag', 'test', '--json', ...base]);
  assert.equal(added.code, 0, added.stderr);
  assert.equal(JSON.parse(added.stdout).version, 1);

  const listed = await runCli(['list', '--json', ...base]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].name, 'Test page');
  const shown = await runCli(['show', '1', '--json', ...base]);
  assert.equal(JSON.parse(shown.stdout).tag, 'test');
  const edited = await runCli(['edit', '1', '--name', 'Edited page', '--json', ...base]);
  assert.equal(JSON.parse(edited.stdout).name, 'Edited page');

  const unchanged = await runCli(['fetch', '1', '--json', ...base]);
  assert.equal(unchanged.code, 0, unchanged.stderr);
  assert.equal(JSON.parse(unchanged.stdout).changed, false);

  body = '<h1>second</h1>\n';
  const changed = await runCli(['fetch', '1', '--json', ...base]);
  assert.equal(changed.code, 10, changed.stderr);
  assert.equal(JSON.parse(changed.stdout).version, 2);

  const history = await runCli(['history', '1', '--json', ...base]);
  assert.equal(JSON.parse(history.stdout).length, 2);
  const diff = await runCli(['diff', '1', '--json', ...base]);
  assert.equal(diff.code, 0, diff.stderr);
  assert.equal(JSON.parse(diff.stdout).changed, true);

  const coloredDiff = await runCli(['diff', '1', ...base], { color: true, isTTY: true });
  assert.match(coloredDiff.stdout, /\x1b\[31m- first\x1b\[0m/);
  assert.match(coloredDiff.stdout, /\x1b\[34m\+ second\x1b\[0m/);
  const plainDiff = await runCli(['diff', '1', '--no-color', ...base], { color: true, isTTY: true });
  assert.equal(plainDiff.stdout, '- first\n+ second\n');

  const disabled = await runCli(['disable', '1', '--json', ...base]);
  assert.equal(JSON.parse(disabled.stdout).enabled, false);
  const skipped = await runCli(['fetch', '--json', ...base]);
  assert.equal(skipped.code, 0);
  assert.deepEqual(JSON.parse(skipped.stdout), []);
  const enabled = await runCli(['enable', '1', ...base], { color: true });
  assert.equal(enabled.code, 0);
  assert.match(enabled.stdout, /\x1b\[32m✓ Enabled\x1b\[0m \x1b\[34m#1\x1b\[0m/);
  const unchangedHuman = await runCli(['fetch', '1', ...base], { color: true });
  assert.equal(unchangedHuman.code, 0);
  assert.match(unchangedHuman.stdout, /\x1b\[90munchanged\x1b\[0m/);

  const scheduled = await runCli(['schedule', '1', '15m', '--json', ...base]);
  assert.equal(JSON.parse(scheduled.stdout).intervalSeconds, 900);
  assert.equal(JSON.parse((await runCli(['schedules', '--json', ...base])).stdout).length, 1);
  const unscheduled = await runCli(['unschedule', '1', ...base], { color: true });
  assert.equal(unscheduled.code, 0);
  assert.match(unscheduled.stdout, /\x1b\[33m✓ Unscheduled\x1b\[0m/);
  assert.deepEqual(JSON.parse((await runCli(['schedules', '--json', ...base])).stdout), []);
  assert.equal(JSON.parse((await runCli(['status', '--json', ...base])).stdout).versions, 2);
  const exported = await runCli(['export', '1', '--output', dataDir, '--json', ...base]);
  assert.equal(JSON.parse(exported.stdout).versions, 2);

  status = 503;
  const failed = await runCli(['fetch', '1', ...base], { color: true });
  assert.equal(failed.code, 3);
  assert.match(failed.stderr, /\x1b\[31mError: fetch failed with HTTP 503\x1b\[0m/);

  const invalid = await runCli(['show', ...base]);
  assert.equal(invalid.code, 2);
  assert.equal((await runCli(['remove', '1', ...base])).code, 0);
  assert.equal(JSON.parse((await runCli(['history', '1', '--json', ...base])).stdout).length, 2);
  assert.equal((await runCli(['remove', '1', '--purge', ...base])).code, 0);
  assert.equal((await runCli(['show', '1', ...base])).code, 1);
  const help = await runCli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: fetchary/);
});
