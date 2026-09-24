'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const pkg = require('../package.json');
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
  const humanList = await runCli(['list', ...base]);
  assert.match(humanList.stdout, /^ID\s+NAME\s+TAG\s+URL\s+VERSION\s+LAST CHECK\s+LAST CHANGE/m);
  assert.match(humanList.stdout, /^1\s+Test page\s+test\s+https:\/\/example\.test\/page\s+1\s+/m);
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
  const invalidHistory = await runCli(['history', ...base]);
  assert.equal(invalidHistory.code, 2);
  assert.equal(invalidHistory.stderr, 'Error: invalid number of arguments\n\nUsage:   fetchary history <id>\nExample: fetchary history 1\n');
  const humanHistory = await runCli(['history', '1', ...base]);
  assert.match(humanHistory.stdout, /^VERSION\s+CHANGE\s+FETCHED\s+STATUS\s+SIZE/m);
  assert.match(humanHistory.stdout, /^2\s+content\s+/m);
  assert.match(humanHistory.stdout, /^1\s+initial\s+/m);
  const coloredHistory = await runCli(['history', '1', ...base], { color: true, isTTY: true });
  assert.match(coloredHistory.stdout, /\x1b\[32m200\x1b\[0m/);
  const diff = await runCli(['diff', '1', '--json', ...base]);
  assert.equal(diff.code, 0, diff.stderr);
  assert.equal(JSON.parse(diff.stdout).changed, true);

  const invalidDiff = await runCli(['diff', ...base]);
  assert.equal(invalidDiff.code, 2);
  assert.equal(invalidDiff.stderr, 'Error: invalid number of arguments\n\nUsage:   fetchary diff <id> or fetchary diff <id> <version1> <version2>\nExample: fetchary diff 4 1 2\n');

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
  assert.equal(help.stdout.split('\n')[0], `Fetchary 👁️ — ${pkg.version}`);
  assert.match(help.stdout, /Usage: fetchary/);
  assert.match(help.stdout, /--example\s+Show common examples/);

  const defaultHelp = await runCli([]);
  assert.equal(defaultHelp.code, 0);
  assert.equal(defaultHelp.stdout, help.stdout);
  assert.equal(defaultHelp.stderr, '');

  const examples = await runCli(['--example']);
  assert.equal(examples.code, 0);
  assert.match(examples.stdout, /^Fetchary examples\n/);
  assert.match(examples.stdout, /fetchary add https:\/\/example\.com\/news/);
  assert.match(examples.stdout, /fetchary diff 1/);
  assert.match(examples.stdout, /fetchary run/);
});

test('invalid argument counts include command usage and an example', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-usage-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const cases = [
    { args: ['add'], usage: 'fetchary add <url> [--name <name>] [--tag <tag>] [--every <interval>]', example: 'fetchary add https://example.com --name "Example"' },
    { args: ['list', 'extra'], usage: 'fetchary list [--tag <tag>] [--json]', example: 'fetchary list --tag research' },
    { args: ['status', 'extra'], usage: 'fetchary status', example: 'fetchary status' },
    { args: ['show'], usage: 'fetchary show <id>', example: 'fetchary show 1' },
    { args: ['history'], usage: 'fetchary history <id>', example: 'fetchary history 1' },
    { args: ['diff'], usage: 'fetchary diff <id> or fetchary diff <id> <version1> <version2>', example: 'fetchary diff 4 1 2' },
    { args: ['open'], usage: 'fetchary open <id> [version]', example: 'fetchary open 1 2' },
    { args: ['edit'], usage: 'fetchary edit <id> [--url <url>] [--name <name>] [--tag <tag>]', example: 'fetchary edit 1 --name "Example News"' },
    { args: ['enable'], usage: 'fetchary enable <id>', example: 'fetchary enable 1' },
    { args: ['disable'], usage: 'fetchary disable <id>', example: 'fetchary disable 1' },
    { args: ['remove'], usage: 'fetchary remove <id> [--purge]', example: 'fetchary remove 1' },
    { args: ['export'], usage: 'fetchary export <id> [--output <directory>]', example: 'fetchary export 1 --output ./research' },
    { args: ['schedule'], usage: 'fetchary schedule <id> <interval> [--now]', example: 'fetchary schedule 1 15m' },
    { args: ['unschedule'], usage: 'fetchary unschedule <id>', example: 'fetchary unschedule 1' },
    { args: ['schedules', 'extra'], usage: 'fetchary schedules [--json]', example: 'fetchary schedules' },
    { args: ['run', 'extra'], usage: 'fetchary run [--poll-interval <milliseconds>]', example: 'fetchary run --poll-interval 2000' },
  ];

  for (const item of cases) {
    const result = await runCli([...item.args, '--data-dir', dataDir]);
    assert.equal(result.code, 2, item.args[0]);
    assert.match(result.stderr, /^Error: invalid number of arguments\n/);
    assert.equal(result.stderr.includes(`Usage:   ${item.usage}\n`), true, item.args[0]);
    assert.equal(result.stderr.includes(`Example: ${item.example}\n`), true, item.args[0]);
  }
});

test('CLI distinguishes raw-only changes from visible content changes', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-changes-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let body = '<h1>same</h1><script nonce="one">ignored</script>\n';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'text/html' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = ['--data-dir', dataDir];

  await runCli(['add', 'https://example.test/dynamic', ...base]);
  body = '<h1>same</h1><script nonce="two">ignored</script>\n';
  const rawOnly = await runCli(['fetch', '1', ...base]);
  assert.equal(rawOnly.code, 0, rawOnly.stderr);
  assert.match(rawOnly.stdout, /raw changed, content unchanged → version 2/);
  assert.match(rawOnly.stdout, /0 content changed, 1 raw only, 0 unchanged/);

  let history = JSON.parse((await runCli(['history', '1', '--json', ...base])).stdout);
  assert.equal(history[0].change, 'raw only');
  assert.equal(history[0].contentChanged, false);

  body = '<h1>different</h1><script nonce="three">ignored</script>\n';
  const content = await runCli(['fetch', '1', ...base]);
  assert.equal(content.code, 10, content.stderr);
  assert.match(content.stdout, /content changed → version 3/);

  history = JSON.parse((await runCli(['history', '1', '--json', ...base])).stdout);
  assert.equal(history[0].change, 'content');
  assert.equal(history[0].contentChanged, true);
});
