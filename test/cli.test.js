'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const pkg = require('../package.json');
const { main } = require('../cli/index');
const { createFetchary } = require('../src');

async function runCli(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, {
    color: options.color,
    hyperlinks: options.hyperlinks,
    openFile: options.openFile,
    openEditor: options.openEditor,
    waitForShutdown: options.waitForShutdown,
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

  const added = await runCli(['add', url, '--name', 'Test page', '--tag', 'test', '--mode', 'http', '--json', ...base]);
  assert.equal(added.code, 0, added.stderr);
  assert.equal(JSON.parse(added.stdout).version, 1);
  assert.equal(JSON.parse(added.stdout).captureMode, 'http');
  assert.equal(JSON.parse(added.stdout).waitAfterLoadMs, 5_000);

  const browserConfigured = await runCli(['edit', '1', '--mode', 'browser', '--wait-after-load', '500ms', '--json', ...base]);
  assert.equal(JSON.parse(browserConfigured.stdout).captureMode, 'browser');
  assert.equal(JSON.parse(browserConfigured.stdout).waitAfterLoadMs, 500);
  const captureShown = await runCli(['show', '1', ...base]);
  assert.match(captureShown.stdout, /^Capture mode:\s+browser$/m);
  assert.match(captureShown.stdout, /^Wait after load:\s+500ms$/m);
  await runCli(['edit', '1', '--mode', 'http', ...base]);

  const listed = await runCli(['list', '--json', ...base]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].name, 'Test page');
  assert.equal(JSON.parse(listed.stdout)[0].captureMode, 'http');
  assert.equal(JSON.parse(listed.stdout)[0].waitAfterLoadMs, 500);
  const humanList = await runCli(['list', ...base]);
  assert.match(humanList.stdout, /^ID\s+NAME\s+TAG\s+URL\s+VERSION\s+LAST CHECK\s+LAST CHANGE/m);
  assert.match(humanList.stdout, /^1\s+Test page\s+test\s+https:\/\/example\.test\/page\s+1\s+/m);
  const linkedList = await runCli(['list', ...base], { hyperlinks: true, isTTY: true });
  assert.match(linkedList.stdout, /\x1b\]8;;https:\/\/example\.test\/page\x1b\\https:\/\/example\.test\/page\x1b\]8;;\x1b\\/);
  assert.match(linkedList.stdout, /^1\s+Test page\s+test\s+\x1b\]8;;/m);
  const plainList = await runCli(['list', '--no-color', ...base], { hyperlinks: true, isTTY: true });
  assert.equal(plainList.stdout.includes('\x1b'), false);
  const shown = await runCli(['show', '1', '--json', ...base]);
  assert.equal(JSON.parse(shown.stdout).tag, 'test');
  const linkedShow = await runCli(['show', '1', ...base], { color: false, hyperlinks: true, isTTY: true });
  assert.match(linkedShow.stdout, /^URL:\s+\x1b\]8;;https:\/\/example\.test\/page\x1b\\https:\/\/example\.test\/page\x1b\]8;;\x1b\\$/m);
  const plainShow = await runCli(['show', '1', '--no-color', ...base], { hyperlinks: true, isTTY: true });
  assert.equal(plainShow.stdout.includes('\x1b'), false);
  let openedFile;
  let openedInEditor = false;
  const opened = await runCli(['open', '1', '1', '--html', ...base], {
    openFile: async () => { throw new Error('default opener should not be used with --html'); },
    openEditor: async file => { openedFile = file; openedInEditor = true; },
  });
  assert.equal(opened.code, 0, opened.stderr);
  assert.equal(openedInEditor, true);
  assert.equal(openedFile, path.join(dataDir, 'pages', '1', '1', 'response.html'));
  assert.match(opened.stdout, /response\.html/);
  let openedInBrowser;
  const openedNormally = await runCli(['open', '1', '1', ...base], {
    openFile: async file => { openedInBrowser = file; },
    openEditor: async () => { throw new Error('editor should only be used with --html'); },
  });
  assert.equal(openedNormally.code, 0, openedNormally.stderr);
  assert.equal(openedInBrowser, path.join(dataDir, 'pages', '1', '1', 'response.html'));
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
  const elementContentDiff = await runCli(['diff', '1', '--element-content', ...base]);
  assert.equal(elementContentDiff.stdout, '- <h1>first</h1>\n+ <h1>second</h1>\n');
  assert.equal(JSON.parse((await runCli(['diff', '1', '--element-content', '--json', ...base])).stdout).mode, 'element-content');
  const elementRawDiff = await runCli(['diff', '1', '--element-raw', ...base]);
  assert.equal(elementRawDiff.stdout, '- <h1>first</h1>\n+ <h1>second</h1>\n');
  assert.equal(JSON.parse((await runCli(['diff', '1', '--element-raw', '--json', ...base])).stdout).mode, 'element-raw');

  const conflictingDiff = await runCli(['diff', '1', '--element-content', '--element-raw', ...base]);
  assert.equal(conflictingDiff.code, 2);
  assert.match(conflictingDiff.stderr, /--element-content and --element-raw cannot be used together/);

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
  assert.match(unchangedHuman.stdout, /\x1b\[36mFetching now\x1b\[0m/);
  assert.match(unchangedHuman.stdout, /\x1b\[36m◉\x1b\[0m \x1b\[34m#1\x1b\[0m Edited page/);
  assert.match(unchangedHuman.stdout, /https:\/\/example\.test\/page.*\[http\]/);
  assert.equal(unchangedHuman.stdout.indexOf('Fetching now') < unchangedHuman.stdout.indexOf('Results'), true);
  assert.match(unchangedHuman.stdout, /\x1b\[90munchanged\x1b\[0m/);

  const interactiveFetch = await runCli(['fetch', '1', ...base], { color: true, isTTY: true });
  assert.equal(interactiveFetch.code, 0, interactiveFetch.stderr);
  assert.match(interactiveFetch.stdout, /\r\x1b\[2K/);
  assert.match(interactiveFetch.stdout, /0\/1/);
  assert.match(interactiveFetch.stdout, /1\/1/);
  assert.match(interactiveFetch.stdout, /Edited page/);

  const scheduled = await runCli(['schedule', '1', '15m', '--json', ...base]);
  assert.equal(JSON.parse(scheduled.stdout).intervalSeconds, 900);
  assert.equal(JSON.parse((await runCli(['schedules', '--json', ...base])).stdout).length, 1);
  const running = await runCli(['run', ...base], {
    waitForShutdown: async runner => { await runner.stop(); },
  });
  assert.equal(running.code, 0, running.stderr);
  assert.equal(running.stdout, [
    'Fetchary scheduler running. Press Ctrl+C to stop.',
    'Scheduled pages:',
    '  #1 Edited page — https://example.test/page — every 15m',
    '',
  ].join('\n'));
  const unscheduled = await runCli(['unschedule', '1', ...base], { color: true });
  assert.equal(unscheduled.code, 0);
  assert.match(unscheduled.stdout, /\x1b\[33m✓ Unscheduled\x1b\[0m/);
  assert.deepEqual(JSON.parse((await runCli(['schedules', '--json', ...base])).stdout), []);
  const jsonStatus = JSON.parse((await runCli(['status', '--json', ...base])).stdout);
  assert.equal(jsonStatus.versions, 2);
  assert.equal(jsonStatus.fetchBytes, 31);
  const humanStatus = await runCli(['status', ...base]);
  assert.match(humanStatus.stdout, /^Fetch storage:\s+31 B$/m);
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
  assert.equal(JSON.parse((await runCli(['status', '--json', ...base])).stdout).fetchBytes, 31);
  assert.equal((await runCli(['remove', '1', '--purge', ...base])).code, 0);
  assert.equal(JSON.parse((await runCli(['status', '--json', ...base])).stdout).fetchBytes, 0);
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

test('run reports when no pages are scheduled', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-run-empty-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const running = await runCli(['run', '--data-dir', dataDir], {
    waitForShutdown: async runner => { await runner.stop(); },
  });

  assert.equal(running.code, 0, running.stderr);
  assert.equal(running.stdout, 'Fetchary scheduler running. Press Ctrl+C to stop.\nNo pages scheduled.\n');
});

test('invalid argument counts include command usage and an example', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-usage-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const cases = [
    { args: ['add'], usage: 'fetchary add <url> [--name <name>] [--tag <tag>] [--every <interval>] [--mode <browser|http>] [--wait-after-load <duration>] [--ignore-selector <css> ...]', example: 'fetchary add https://github.com/owner/repo --mode browser --ignore-selector "relative-time"' },
    { args: ['list', 'extra'], usage: 'fetchary list [--tag <tag>] [--json]', example: 'fetchary list --tag research' },
    { args: ['status', 'extra'], usage: 'fetchary status', example: 'fetchary status' },
    { args: ['show'], usage: 'fetchary show <id>', example: 'fetchary show 1' },
    { args: ['history'], usage: 'fetchary history <id>', example: 'fetchary history 1' },
    { args: ['diff'], usage: 'fetchary diff <id> or fetchary diff <id> <version1> <version2>', example: 'fetchary diff 4 1 2' },
    { args: ['open'], usage: 'fetchary open <id> [version] [--html] [--raw]', example: 'fetchary open 1 2 --raw' },
    { args: ['edit'], usage: 'fetchary edit <id> [--url <url>] [--name <name>] [--tag <tag>] [--mode <browser|http>] [--wait-after-load <duration>] [--ignore-selector <css> ... | --clear-ignore-selectors]', example: 'fetchary edit 1 --mode http' },
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

test('CLI rejects invalid browser capture settings', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-capture-invalid-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const invalidMode = await runCli(['add', 'https://example.test/mode', '--mode', 'other', '--data-dir', dataDir]);
  assert.equal(invalidMode.code, 2);
  assert.match(invalidMode.stderr, /capture mode must be "browser" or "http"/);
  const invalidWait = await runCli(['add', 'https://example.test/wait', '--wait-after-load', '-1s', '--data-dir', dataDir]);
  assert.equal(invalidWait.code, 2);
  assert.match(invalidWait.stderr, /wait after load must be a non-negative duration/);
});

test('open prefers rendered browser captures and supports explicit raw evidence', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-open-rendered-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const fetchary = await createFetchary({
    dataDir,
    fetch: async () => new Response('<main>server response</main>', { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async () => ({
      async newPage() {
        return {
          async goto() {},
          async content() { return '<html><body><main>rendered DOM</main></body></html>'; },
          url() { return 'https://example.test/rendered'; },
          async close() {},
        };
      },
      async close() {},
    }),
  });
  t.after(() => fetchary.close());
  const source = await fetchary.add('https://example.test/rendered', { waitAfterLoad: 0 });
  const archived = await fetchary.version(source.id);
  await fetchary.close();

  let openedFile;
  const rendered = await runCli(['open', String(source.id), '--data-dir', dataDir], {
    openFile: async file => { openedFile = file; },
  });
  assert.equal(rendered.code, 0, rendered.stderr);
  assert.equal(openedFile, archived.renderedFile);
  assert.equal(JSON.parse((await runCli(['open', String(source.id), '--json', '--data-dir', dataDir], {
    openFile: async () => {},
  })).stdout).openedFile, archived.renderedFile);

  const raw = await runCli(['open', String(source.id), '--raw', '--data-dir', dataDir], {
    openFile: async file => { openedFile = file; },
  });
  assert.equal(raw.code, 0, raw.stderr);
  assert.equal(openedFile, archived.file);
});

test('CLI distinguishes raw-only changes from visible content changes', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-changes-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let body = '<h1>same</h1><script nonce="one">ignored</script>\n';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'text/html' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = ['--data-dir', dataDir];

  await runCli(['add', 'https://example.test/dynamic', '--mode', 'http', ...base]);
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

test('CLI configures repeatable ignore selectors and applies current rules everywhere', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-selectors-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let body = '<main>same</main><relative-time>09:41</relative-time><span class="timestamp">old</span>\n';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'text/html' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = ['--data-dir', dataDir];

  const added = await runCli([
    'add', 'https://example.test/selectors',
    '--ignore-selector', ' relative-time ',
    '--ignore-selector=.timestamp',
    '--ignore-selector', 'relative-time',
    '--mode', 'http',
    '--json', ...base,
  ]);
  assert.equal(added.code, 0, added.stderr);
  assert.deepEqual(JSON.parse(added.stdout).ignoreSelectors, ['relative-time', '.timestamp']);

  const shown = await runCli(['show', '1', ...base]);
  assert.match(shown.stdout, /^Ignore selectors: relative-time, \.timestamp$/m);

  body = '<main>same</main><relative-time>09:43</relative-time><span class="timestamp">new</span>\n';
  const fetched = await runCli(['fetch', '1', '--json', ...base]);
  assert.equal(fetched.code, 0, fetched.stderr);
  assert.equal(JSON.parse(fetched.stdout).rawChanged, true);
  assert.equal(JSON.parse(fetched.stdout).contentChanged, false);

  const history = await runCli(['history', '1', '--json', ...base]);
  assert.equal(JSON.parse(history.stdout)[0].change, 'raw only');
  assert.equal((await runCli(['diff', '1', ...base])).stdout, 'No differences.\n');
  assert.equal((await runCli(['diff', '1', '--element-content', ...base])).stdout, 'No differences.\n');
  const rawElementDiff = await runCli(['diff', '1', '--element-raw', ...base]);
  assert.match(rawElementDiff.stdout, /<relative-time>09:41<\/relative-time>/);
  assert.match(rawElementDiff.stdout, /<relative-time>09:43<\/relative-time>/);
  const rawDiff = await runCli(['diff', '1', '--raw', ...base]);
  assert.match(rawDiff.stdout, /09:41/);
  assert.match(rawDiff.stdout, /09:43/);

  const replaced = await runCli(['edit', '1', '--ignore-selector', '[data-updated]', '--json', ...base]);
  assert.deepEqual(JSON.parse(replaced.stdout).ignoreSelectors, ['[data-updated]']);
  assert.equal(JSON.parse((await runCli(['history', '1', '--json', ...base])).stdout)[0].change, 'content');
  assert.match((await runCli(['diff', '1', ...base])).stdout, /09:41/);

  const restored = await runCli(['edit', '1', '--ignore-selector', 'relative-time', '--ignore-selector', '.timestamp', '--json', ...base]);
  assert.deepEqual(JSON.parse(restored.stdout).ignoreSelectors, ['relative-time', '.timestamp']);
  assert.equal(JSON.parse((await runCli(['history', '1', '--json', ...base])).stdout)[0].change, 'raw only');

  const cleared = await runCli(['edit', '1', '--clear-ignore-selectors', '--json', ...base]);
  assert.deepEqual(JSON.parse(cleared.stdout).ignoreSelectors, []);

  const conflicting = await runCli(['edit', '1', '--ignore-selector', '.one', '--clear-ignore-selectors', ...base]);
  assert.equal(conflicting.code, 2);
  assert.match(conflicting.stderr, /cannot be used together/);
  const invalid = await runCli(['add', 'https:\/\/example.test\/invalid', '--ignore-selector', ':foo(', ...base]);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /invalid ignore selector/);
});
