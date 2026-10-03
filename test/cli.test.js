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
  assert.equal(invalidDiff.stderr, 'Error: invalid number of arguments\n\nUsage:   fetchary diff <id> [from to] [--include-selector <css> ...] [--element-content|--element-raw|--raw] [--html]\nExample: fetchary diff 4 1 2\n');

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

test('follower <id> prints only the latest archived vendor count, including JSON and unavailable errors', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-followers-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let html;
  const fetchary = await createFetchary({ dataDir, fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) });
  t.after(() => fetchary.close());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('follower commands must not fetch'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = ['--data-dir', dataDir];
  const fixtures = [
    ['https://github.com/example', '<a href="/example?tab=followers">63 followers</a>', 63],
    ['https://www.threads.com/@example', '<meta name="description" content="1.5K followers • 200 threads">', 1500],
    ['https://x.com/example', '<a href="/example/verified_followers">203Followers</a>', 203],
    ['https://youtube.com/@example', '<yt-page-header-renderer><span>1.93K subscribers</span></yt-page-header-renderer>', 1930],
    ['https://instagram.com/example/', '<meta property="og:description" content="1.234 Follower, 50 Beiträge">', 1234],
    ['https://tiktok.com/@example', '<strong data-e2e="followers-count">0</strong>', 0],
    ['https://twitch.tv/example', '<div class="home-header-sticky"><p>2.5M followers</p></div>', 2500000],
    ['https://linkedin.com/company/example/', '<h3 class="top-card-layout__first-subline">Berlin 2,345 followers</h3>', 2345],
  ];
  for (const [url, body, expected] of fixtures) {
    html = body;
    const source = await fetchary.add(url, { mode: 'http', ignoreSelectors: ['a', 'strong', 'meta', 'span', 'p'] });
    const shown = await runCli(['follower', String(source.id), ...base], { color: true, hyperlinks: true, isTTY: true });
    assert.equal(shown.code, 0, shown.stderr);
    assert.equal(shown.stdout, `${expected}\n`);
    assert.equal(shown.stderr, '');
    const json = await runCli(['follower', String(source.id), '--json', ...base]);
    assert.equal(json.code, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout), expected);
    assert.equal((await runCli(['follower', String(source.id), '--quiet', ...base])).stdout, '');
  }
  html = '<a href="/example?tab=followers">64 followers</a>';
  await fetchary.fetch(1);
  assert.equal((await runCli(['follower', '1', ...base])).stdout, '64\n');
  assert.match((await runCli(['show', '1', ...base])).stdout, /^ID:\s+1$/m);
  html = '<main>Login required</main>';
  await fetchary.fetch(1);
  const unavailable = await runCli(['follower', '1', '--json', ...base]);
  assert.equal(unavailable.code, 1);
  assert.equal(unavailable.stdout, '');
  assert.equal(JSON.parse(unavailable.stderr).error, 'FetcharyNotFoundError');
  assert.match(JSON.parse(unavailable.stderr).message, /follower count is unavailable/);
  const missing = await runCli(['follower', '9999', ...base]);
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  const unsupported = await fetchary.add('https://example.test/', { mode: 'http' });
  const invalid = await runCli(['follower', String(unsupported.id), ...base]);
  assert.equal(invalid.code, 2);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /does not support vendor follower counts/);
  const taggedId = await runCli(['follower', '1', '--tag', 'personal', ...base]);
  assert.equal(taggedId.code, 2);
  assert.match(taggedId.stderr, /--tag is only supported when listing followers without an id/);
  const oldFlag = await runCli(['show', '1', '--follower', ...base]);
  assert.equal(oldFlag.code, 2);
  assert.match(oldFlag.stderr, /unknown option --follower/);
  const help = (await runCli(['--help'])).stdout;
  assert.match(help, /follower \[id\]\s+Show a follower count or list all counts with a sum/);
  assert.equal(help.includes('--follower'), false);
  const examples = (await runCli(['--example'])).stdout;
  assert.match(examples, /fetchary follower 3/);
  assert.match(examples, /fetchary follower --tag personal/);
});

test('follower lists counts with a sum and tag filtering, without fetching or including unavailable sources', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-follower-list-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let html;
  const fetchary = await createFetchary({ dataDir, fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) });
  t.after(() => fetchary.close());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('follower commands must not fetch'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = ['--data-dir', dataDir];
  const fixtures = [
    ['https://github.com/example', '<a href="/example?tab=followers">65 followers</a>', 'personal', undefined],
    ['https://x.com/example', '<a href="/example/verified_followers">200 Followers</a>', 'business', 'Work account'],
    ['https://threads.com/@example', '<meta name="description" content="1,473 followers • 200 threads">', 'personal', undefined],
    ['https://youtube.com/@example', '<yt-page-header-renderer><span>1,511 subscribers</span></yt-page-header-renderer>', 'personal', undefined],
    ['https://tiktok.com/@example', '<strong data-e2e="followers-count">0</strong>', 'personal', undefined],
    ['https://linkedin.com/company/example/', '<h3 class="top-card-layout__first-subline">Berlin 0 followers</h3>', 'business', undefined],
    ['https://instagram.com/example/', '<main>Login required</main>', 'personal', undefined],
    ['https://example.test/', '<meta name="description" content="900 followers">', 'personal', undefined],
  ];
  for (const [url, body, tag, name] of fixtures) {
    html = body;
    await fetchary.add(url, { mode: 'http', tag, name });
  }
  html = '<a href="/removed?tab=followers">100 followers</a>';
  const removed = await fetchary.add('https://github.com/removed', { mode: 'http', tag: 'personal' });
  await fetchary.remove(removed.id);
  await fetchary.disable(1);
  await fetchary.setVendorActive('github', false);

  const shown = await runCli(['follower', ...base]);
  assert.equal(shown.code, 0, shown.stderr);
  assert.equal(shown.stderr, '');
  assert.match(shown.stdout, /^ID\s+FOLLOWER\s+NAME\s+URL\s+LAST CHECK\s+LAST CHANGE\n/);
  assert.match(shown.stdout, /^1\s+65\s+github\s+https:\/\/github.com\/example\s+\d+s ago\s+\d+s ago$/m);
  assert.match(shown.stdout, /^2\s+200\s+Work account\s+https:\/\/x.com\/example/m);
  assert.match(shown.stdout, /^5\s+0\s+tiktok\s+/m);
  assert.equal(shown.stdout.includes('instagram'), false);
  assert.equal(shown.stdout.includes('example.test'), false);
  assert.equal(shown.stdout.includes('/removed'), false);
  assert.match(shown.stdout, /\n------\nsum: 3\.249\n$/);

  const json = await runCli(['follower', '--json', ...base]);
  assert.equal(json.code, 0, json.stderr);
  const result = JSON.parse(json.stdout);
  assert.equal(result.sum, 3249);
  assert.deepEqual(result.followers.map(row => row.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.followers[0], {
    id: 1, follower: 65, name: 'github', url: 'https://github.com/example',
    lastCheckedAt: (await fetchary.get(1)).lastCheckedAt,
    lastChangedAt: (await fetchary.get(1)).lastChangedAt,
  });

  const tagged = await runCli(['follower', '--tag', 'personal', '--json', ...base]);
  assert.equal(tagged.code, 0, tagged.stderr);
  assert.deepEqual(JSON.parse(tagged.stdout).followers.map(row => row.id), [1, 3, 4, 5]);
  assert.equal(JSON.parse(tagged.stdout).sum, 3049);
  const taggedTable = await runCli(['follower', '--tag', 'personal', ...base]);
  assert.equal(taggedTable.code, 0, taggedTable.stderr);
  assert.equal(taggedTable.stdout.includes('Work account'), false);
  assert.match(taggedTable.stdout, /\n------\nsum: 3\.049\n$/);
  const empty = await runCli(['follower', '--tag', 'unknown', ...base]);
  assert.equal(empty.code, 0, empty.stderr);
  assert.equal(empty.stdout, 'No follower counts available.\n------\nsum: 0\n');
  assert.deepEqual(JSON.parse((await runCli(['follower', '--tag', 'unknown', '--json', ...base])).stdout), { followers: [], sum: 0 });
  assert.equal((await runCli(['follower', '--quiet', ...base])).stdout, '');
  const linked = await runCli(['follower', ...base], { hyperlinks: true, isTTY: true });
  assert.match(linked.stdout, /\x1b\]8;;https:\/\/github.com\/example\x1b\\https:\/\/github.com\/example\x1b\]8;;\x1b\\/);
  assert.equal((await runCli(['follower', '--no-color', ...base], { hyperlinks: true, isTTY: true })).stdout.includes('\x1b'), false);

  html = '<a href="/example?tab=followers">66 followers</a>';
  await fetchary.fetch(1);
  assert.equal(JSON.parse((await runCli(['follower', '--json', ...base])).stdout).sum, 3250);
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
    { args: ['add'], usage: 'fetchary add <url> [--name <name>] [--tag <tag>] [--every <interval>] [--mode <browser|http>] [--wait-after-load <duration>] [--include-selector <css> ...] [--ignore-selector <css> ...]', example: 'fetchary add https://github.com/owner/repo --mode browser --ignore-selector "relative-time"' },
    { args: ['list', 'extra'], usage: 'fetchary list [--tag <tag>] [--json]', example: 'fetchary list --tag research' },
    { args: ['vendors', 'extra'], usage: 'fetchary vendors [--json]', example: 'fetchary vendors' },
    { args: ['vendor', 'instagram'], usage: 'fetchary vendor <name> <enable|disable> [--json]', example: 'fetchary vendor instagram disable' },
    { args: ['status', 'extra'], usage: 'fetchary status', example: 'fetchary status' },
    { args: ['follower', '1', '2'], usage: 'fetchary follower [id] [--tag <tag>] [--json]', example: 'fetchary follower 3' },
    { args: ['show'], usage: 'fetchary show <id> [--json]', example: 'fetchary show 1' },
    { args: ['history'], usage: 'fetchary history <id>', example: 'fetchary history 1' },
    { args: ['diff'], usage: 'fetchary diff <id> [from to] [--include-selector <css> ...] [--element-content|--element-raw|--raw] [--html]', example: 'fetchary diff 4 1 2' },
    { args: ['open'], usage: 'fetchary open <id> [version] [--show-include-selector] [--html] [--raw]', example: 'fetchary open 1 2 --raw' },
    { args: ['edit'], usage: 'fetchary edit <id> [--url <url>] [--name <name>] [--tag <tag>] [--mode <browser|http>] [--wait-after-load <duration>] [--include-selector <css> ... | --clear-include-selectors] [--ignore-selector <css> ... | --clear-ignore-selectors]', example: 'fetchary edit 1 --mode http' },
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

test('CLI lists persisted vendors and enables or disables them', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-vendors-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const base = ['--data-dir', dataDir];
  const listed = await runCli(['vendors', '--json', ...base]);
  assert.equal(listed.code, 0, listed.stderr);
  const vendors = JSON.parse(listed.stdout);
  assert.equal(vendors.find(vendor => vendor.name === 'instagram').active, true);
  assert.equal(vendors.every(vendor => typeof vendor.active === 'boolean'), true);

  const disabled = await runCli(['vendor', 'instagram', 'disable', '--json', ...base]);
  assert.equal(disabled.code, 0, disabled.stderr);
  assert.deepEqual(JSON.parse(disabled.stdout), { name: 'instagram', active: false });
  const humanList = await runCli(['vendors', '--no-color', ...base]);
  assert.match(humanList.stdout, /^VENDOR\s+ACTIVE/m);
  assert.match(humanList.stdout, /^instagram\s+no$/m);
  const reloaded = JSON.parse((await runCli(['vendors', '--json', ...base])).stdout);
  assert.equal(reloaded.find(vendor => vendor.name === 'instagram').active, false);

  const badAction = await runCli(['vendor', 'instagram', 'maybe', ...base]);
  assert.equal(badAction.code, 2);
  assert.match(badAction.stderr, /vendor action must be "enable" or "disable"/);
  assert.match(badAction.stderr, /Usage:\s+fetchary vendor/);
  const unknown = await runCli(['vendor', 'unknown', 'disable', ...base]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /vendor "unknown" does not exist/);

  const enabled = await runCli(['vendor', 'instagram', 'enable', '--json', ...base]);
  assert.equal(enabled.code, 0, enabled.stderr);
  assert.deepEqual(JSON.parse(enabled.stdout), { name: 'instagram', active: true });
  const quiet = await runCli(['vendor', 'instagram', 'disable', '--quiet', ...base]);
  assert.equal(quiet.code, 0, quiet.stderr);
  assert.equal(quiet.stdout, '');
  assert.equal(JSON.parse((await runCli(['vendors', '--json', ...base])).stdout).find(vendor => vendor.name === 'instagram').active, false);
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
  const source = await fetchary.add('https://example.test/rendered', { waitAfterLoad: 0, includeSelectors: ['main'] });
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

  const consoleOnly = {
    openFile: async () => { throw new Error('selected content must be printed to the console'); },
    openEditor: async () => { throw new Error('selected HTML must be printed to the console'); },
  };
  const selected = await runCli(['open', String(source.id), '--show-include-selector', '--data-dir', dataDir], consoleOnly);
  assert.equal(selected.code, 0, selected.stderr);
  assert.equal(selected.stdout, 'rendered DOM\n');
  const selectedRaw = await runCli(['open', String(source.id), '--show-include-selector', '--raw', '--data-dir', dataDir], consoleOnly);
  assert.equal(selectedRaw.stdout, 'server response\n');
  const selectedHtml = await runCli(['open', String(source.id), '--show-include-selector', '--html', '--data-dir', dataDir], consoleOnly);
  assert.equal(selectedHtml.stdout, '<main>rendered DOM</main>\n');
  fs.unlinkSync(archived.renderedFile);
  const historical = await runCli(['open', String(source.id), '--show-include-selector', '--data-dir', dataDir], consoleOnly);
  assert.equal(historical.stdout, 'server response\n');
});

test('open prints only stored include-selector content with version selection and no source mutations', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-show-include-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const firstBody = '<header>Outside</header><main><p>First</p><p class="clock">Clock one</p></main><aside>Also included</aside><footer>Outside</footer>';
  let body = firstBody;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls++; return new Response(body, { headers: { 'content-type': 'text/html' } }); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = ['--data-dir', dataDir];
  const consoleOnly = {
    openFile: async () => { throw new Error('selected content must not launch an app'); },
    openEditor: async () => { throw new Error('selected content must not launch an editor'); },
  };
  const added = await runCli([
    'add', 'https://example.test/show-include', '--mode', 'http',
    '--include-selector', 'aside', '--include-selector', 'main', '--include-selector', 'main p',
    '--ignore-selector', '.clock', ...base,
  ]);
  assert.equal(added.code, 0, added.stderr);
  body = body.replace('First', 'Second').replace('Clock one', 'Clock two');
  assert.equal((await runCli(['fetch', '1', ...base])).code, 10);
  const storedSource = (await runCli(['show', '1', '--json', ...base])).stdout;
  const requestsBeforeViewing = fetchCalls;

  const selected = await runCli(['open', '1', '--show-include-selector', ...base], consoleOnly);
  assert.equal(selected.code, 0, selected.stderr);
  assert.equal(selected.stdout, 'Second\nClock two\n\nAlso included\n');
  const historical = await runCli(['open', '1', '1', '--show-include-selector', ...base], consoleOnly);
  assert.equal(historical.stdout, 'First\nClock one\n\nAlso included\n');
  const html = await runCli(['open', '1', '1', '--show-include-selector', '--html', ...base], consoleOnly);
  assert.equal(html.stdout, '<main><p>First</p><p class="clock">Clock one</p></main>\n<aside>Also included</aside>\n');
  const json = await runCli(['open', '1', '1', '--show-include-selector', '--json', ...base], consoleOnly);
  assert.deepEqual(JSON.parse(json.stdout), {
    sourceId: 1, version: 1, includeSelectors: ['aside', 'main', 'main p'], content: 'First\nClock one\n\nAlso included',
  });
  assert.equal((await runCli(['open', '1', '--show-include-selector', '--quiet', ...base], consoleOnly)).stdout, '');
  assert.equal(fetchCalls, requestsBeforeViewing);
  assert.equal((await runCli(['show', '1', '--json', ...base])).stdout, storedSource);
  assert.equal(fs.readFileSync(path.join(dataDir, 'pages', '1', '1', 'response.html'), 'utf8'), firstBody);

  await runCli(['edit', '1', '--include-selector', '.missing', ...base]);
  const missing = await runCli(['open', '1', '--show-include-selector', ...base], consoleOnly);
  assert.equal(missing.code, 0, missing.stderr);
  assert.equal(missing.stdout, '\n');
  await runCli(['edit', '1', '--clear-include-selectors', ...base]);
  const unconfigured = await runCli(['open', '1', '--show-include-selector', ...base], consoleOnly);
  assert.equal(unconfigured.code, 2);
  assert.equal(unconfigured.stdout, '');
  assert.match(unconfigured.stderr, /source 1 has no include selectors/);
  assert.match(unconfigured.stderr, /fetchary edit 1 --include-selector <css>/);
  const wrongCommand = await runCli(['diff', '1', '--show-include-selector', ...base]);
  assert.equal(wrongCommand.code, 2);
  assert.match(wrongCommand.stderr, /--show-include-selector can only be used with open/);
  assert.match((await runCli(['--help'])).stdout, /--show-include-selector\s+Print stored include-selector content/);
  assert.match((await runCli(['--example'])).stdout, /fetchary open 1 --show-include-selector/);
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

test('CLI configures, replaces, and clears include selectors across fetch, history, and diff', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-include-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let body = '<main id="main"><p>Same</p><span class="clock">One</span></main><aside>Also same</aside><footer>Old</footer>';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'text/html' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = ['--data-dir', dataDir];

  const added = await runCli([
    'add', 'https://example.test/include', '--mode', 'http',
    '--include-selector', ' #main ', '--include-selector=aside', '--include-selector', '#main',
    '--ignore-selector', '.clock', '--json', ...base,
  ]);
  assert.equal(added.code, 0, added.stderr);
  assert.deepEqual(JSON.parse(added.stdout).includeSelectors, ['#main', 'aside']);
  assert.deepEqual(JSON.parse(added.stdout).ignoreSelectors, ['.clock']);
  assert.match((await runCli(['show', '1', ...base])).stdout, /^Include selectors: #main, aside$/m);

  body = body.replace('>One<', '>Two<').replace('>Old<', '>New<');
  const outsideOnly = await runCli(['fetch', '1', '--json', ...base]);
  assert.equal(outsideOnly.code, 0, outsideOnly.stderr);
  assert.equal(JSON.parse(outsideOnly.stdout).rawChanged, true);
  assert.equal(JSON.parse(outsideOnly.stdout).contentChanged, false);
  assert.equal(JSON.parse((await runCli(['history', '1', '--json', ...base])).stdout)[0].change, 'raw only');
  assert.equal((await runCli(['diff', '1', ...base])).stdout, 'No differences.\n');
  assert.equal((await runCli(['diff', '1', '--element-content', ...base])).stdout, 'No differences.\n');
  assert.match((await runCli(['diff', '1', '--raw', ...base])).stdout, /<footer>Old<\/footer>/);
  assert.match((await runCli(['diff', '1', '--element-raw', ...base])).stdout, /<footer>New<\/footer>/);

  body = body.replace('>Same<', '>Changed<');
  const includedChange = await runCli(['fetch', '1', '--json', ...base]);
  assert.equal(includedChange.code, 10, includedChange.stderr);
  assert.equal(JSON.parse((await runCli(['history', '1', '--json', ...base])).stdout)[0].change, 'content');
  assert.equal((await runCli(['diff', '1', ...base])).stdout, '- Same\n+ Changed\n');

  const replaced = await runCli(['edit', '1', '--include-selector', 'footer', '--json', ...base]);
  assert.equal(replaced.code, 0, replaced.stderr);
  assert.deepEqual(JSON.parse(replaced.stdout).includeSelectors, ['footer']);
  const history = JSON.parse((await runCli(['history', '1', '--json', ...base])).stdout);
  assert.equal(history[0].change, 'raw only');
  assert.equal(history[1].change, 'content', 'historical versions use current include selectors');
  assert.equal((await runCli(['diff', '1', ...base])).stdout, 'No differences.\n');
  body = body.replace('>Changed<', '>Another outside change<');
  assert.equal((await runCli(['fetch', '1', ...base])).code, 0, 'selector edits recompute the baseline');

  const cleared = await runCli(['edit', '1', '--clear-include-selectors', '--clear-ignore-selectors', '--json', ...base]);
  assert.equal(cleared.code, 0, cleared.stderr);
  assert.deepEqual(JSON.parse(cleared.stdout).includeSelectors, []);
  assert.deepEqual(JSON.parse(cleared.stdout).ignoreSelectors, []);
  body = body.replace('>New<', '>Newest<');
  assert.equal((await runCli(['fetch', '1', ...base])).code, 10);

  const conflicting = await runCli(['edit', '1', '--include-selector', 'main', '--clear-include-selectors', ...base]);
  assert.equal(conflicting.code, 2);
  assert.match(conflicting.stderr, /--include-selector and --clear-include-selectors cannot be used together/);
  const invalid = await runCli(['add', 'https://example.test/invalid', '--include-selector', ':foo(', ...base]);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /invalid include selector/);
  const invalidClear = await runCli(['add', 'https://example.test/invalid', '--clear-include-selectors', ...base]);
  assert.equal(invalidClear.code, 2);
  assert.match(invalidClear.stderr, /--clear-include-selectors can only be used with edit/);
  const missingValue = await runCli(['edit', '1', '--include-selector', ...base]);
  assert.equal(missingValue.code, 2);
  assert.match(missingValue.stderr, /--include-selector requires a value/);
  const help = await runCli(['--help']);
  assert.match(help.stdout, /--include-selector <css>/);
  assert.match(help.stdout, /--clear-include-selectors/);
  assert.match((await runCli(['--example'])).stdout, /--include-selector "#main"/);
});

test('CLI diff selects elements for one invocation without changing stored selectors', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-cli-diff-include-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let body = '<main><p class="old">Before</p><span class="clock">One</span></main><aside>Outside one</aside>';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'text/html' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = ['--data-dir', dataDir];
  const added = await runCli(['add', 'https://example.test/diff-selection', '--mode', 'http', '--include-selector', 'aside', '--ignore-selector', '.clock', '--json', ...base]);
  assert.equal(added.code, 0, added.stderr);
  body = '<main><p class="new">After</p><span class="clock">Two</span></main><aside>Outside two</aside>';
  assert.equal((await runCli(['fetch', '1', ...base])).code, 10);

  const text = await runCli(['diff', '1', '--include-selector', ' main ', ...base]);
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stdout, '- Before\n+ After\n');
  const elements = await runCli(['diff', '1', '1', '2', '--include-selector=main', '--element-content', ...base]);
  assert.equal(elements.stdout, '- <p class="old">Before</p>\n+ <p class="new">After</p>\n');
  const rawElements = await runCli(['diff', '1', '--include-selector', 'main p', '--element-raw', ...base]);
  assert.equal(rawElements.stdout, elements.stdout);
  const ignoredRawElements = await runCli(['diff', '1', '--include-selector', '.clock', '--element-raw', ...base]);
  assert.equal(ignoredRawElements.stdout, '- <span class="clock">One</span>\n+ <span class="clock">Two</span>\n');
  const multiple = await runCli(['diff', '1', '--include-selector', 'main p', '--include-selector=aside', '--include-selector', 'main p', '--json', ...base]);
  assert.deepEqual(JSON.parse(multiple.stdout).diff.map(part => part.value), ['Before', 'After', 'Outside one', 'Outside two']);
  const missing = await runCli(['diff', '1', '--include-selector', '.missing', ...base]);
  assert.equal(missing.stdout, 'No differences.\n');
  const html = await runCli(['diff', '1', '--include-selector', 'main p', '--element-content', '--html', ...base]);
  assert.match(html.stdout, /&lt;p class=&quot;old&quot;&gt;Before/);
  assert.equal(html.stdout.includes('Outside'), false);

  const source = JSON.parse((await runCli(['show', '1', '--json', ...base])).stdout);
  assert.deepEqual(source.includeSelectors, ['aside']);
  assert.deepEqual(source.ignoreSelectors, ['.clock']);
  assert.equal((await runCli(['diff', '1', ...base])).stdout, '- Outside one\n+ Outside two\n');

  const invalid = await runCli(['diff', '1', '--include-selector', '[', ...base]);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /invalid include selector/);
  const raw = await runCli(['diff', '1', '--include-selector', 'main', '--raw', ...base]);
  assert.equal(raw.code, 2);
  assert.match(raw.stderr, /use --element-raw to compare selected elements/);
  const help = await runCli(['--help']);
  assert.match(help.stdout, /Diff and open options:\n\s+--include-selector <css>/);
});
