'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { waitForPublishedTarball, releaseNotes } = require('../scripts/publish');

const tarball = Buffer.from('published package bytes');
const sha256 = contents => crypto.createHash('sha256').update(contents).digest('hex');
const commit = 'a'.repeat(40);

// The subprocess tests use an isolated checkout and PATH. These stand-ins never
// invoke real npm, git, or gh commands, including when a command is unexpected.
const fakeCommand = `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const scenario = JSON.parse(process.env.FETCHARY_PUBLISH_TEST_SCENARIO);
const entry = { command, args, cwd: process.cwd() };
if (command === 'gh' && args[0] === 'release') {
  entry.notes = fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
}
fs.appendFileSync(process.env.FETCHARY_PUBLISH_TEST_LOG, JSON.stringify(entry) + '\\n');
function succeed(output = '') { process.stdout.write(output); process.exit(0); }
function fail(message) { process.stderr.write(message); process.exit(1); }
if (command === 'git') {
  if (args[0] === 'rev-parse') succeed('${commit}\\n');
  if (args[0] === 'status') succeed(scenario.dirty || '');
  if (args[0] === 'ls-remote') {
    if (!scenario.tagCommit) succeed();
    const ref = args[3];
    if (scenario.annotatedTag) {
      succeed('b'.repeat(40) + '\\t' + ref + '\\n' + scenario.tagCommit + '\\t' + ref + '^{}\\n');
    }
    succeed(scenario.tagCommit + '\\t' + ref + '\\n');
  }
  if (args[0] === 'diff') succeed('Formula/fetchary.rb\\n');
  if (['pull', 'add', 'commit', 'push'].includes(args[0])) {
    if (args[0] === 'push' && !args.includes('--dry-run') && scenario.brewFailure) fail('tap push failed');
    succeed();
  }
}
if (command === 'npm') {
  if (args[0] === 'test') succeed();
  if (args[0] === 'pack') {
    const directory = args[args.indexOf('--pack-destination') + 1];
    fs.writeFileSync(path.join(directory, 'fetchary.tgz'), 'mock package bytes');
    succeed(JSON.stringify([{ filename: 'fetchary.tgz' }]));
  }
  if (args[0] === 'whoami') succeed('test-account\\n');
  if (args[0] === 'view') fail('npm error E404: version not found');
  if (args[0] === 'publish') {
    if (scenario.npmFailure) fail('npm publish failed');
    succeed();
  }
}
if (command === 'gh') {
  if (args[0] === 'auth') {
    if (scenario.authFailure) fail('not logged in');
    succeed();
  }
  if (args[0] === 'repo') succeed((scenario.permission || 'WRITE') + '\\n');
  if (args[0] === 'api' && args[1].includes('/commits/')) {
    if (scenario.unpushed) fail('gh: Not Found (HTTP 404)');
    succeed('${commit}\\n');
  }
  if (args[0] === 'api' && args[1].includes('/releases/tags/')) {
    if (scenario.lookupFailure) fail('gh: Forbidden (HTTP 403)');
    if (scenario.existing) succeed(JSON.stringify(scenario.existing));
    fail('gh: Not Found (HTTP 404)');
  }
  if (args[0] === 'release' && ['create', 'edit'].includes(args[1])) {
    if (scenario.releaseFailure) fail('gh: release failed');
    succeed('https://github.com/oliverjessner/fetchary/releases/tag/' + args[2] + '\\n');
  }
}
fail('Unexpected test command: ' + command + ' ' + args.join(' '));
`;

function runPublish(t, args = [], scenario = {}, version = '1.2.0') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-release-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  for (const command of ['git', 'npm', 'gh']) {
    if (command === 'gh' && scenario.missingGh) continue;
    fs.writeFileSync(path.join(bin, command), fakeCommand, { mode: 0o755 });
  }
  fs.mkdirSync(path.join(directory, 'scripts'));
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'publish.js'), path.join(directory, 'scripts', 'publish.js'));
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    name: 'fetchary', version, repository: { url: 'git+https://github.com/oliverjessner/fetchary.git' },
  }));
  fs.mkdirSync(path.join(directory, 'docs'));
  fs.writeFileSync(path.join(directory, 'docs', 'changelog.md'), `# ${version}\n\n- Changes for this release.\n\n# 1.1.0\n\n- Older changes.\n`);
  // Override fetch in the publish process so the complete Homebrew workflow
  // can verify its package hash without contacting the real registry.
  const preload = path.join(directory, 'registry.js');
  fs.writeFileSync(preload, `globalThis.fetch = async () => new Response('mock package bytes');\n`);
  const tapPath = path.join(directory, 'tap');
  fs.mkdirSync(path.join(tapPath, '.git'), { recursive: true });
  const logFile = path.join(directory, 'commands.jsonl');
  const result = spawnSync(process.execPath, ['--require', preload, path.join(directory, 'scripts', 'publish.js'), '--skip-tests',
    ...(scenario.brew ? ['--tap-path', tapPath] : ['--skip-brew']), ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env, PATH: bin,
      FETCHARY_PUBLISH_TEST_LOG: logFile,
      FETCHARY_PUBLISH_TEST_SCENARIO: JSON.stringify(scenario),
    },
  });
  assert.ifError(result.error);
  const commands = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { ...result, commands, tapPath };
}

test('release notes select the exact version and keep Markdown subsections', () => {
  assert.equal(releaseNotes('# 1.2.01\n\n- Wrong version.\n\n# 1.2.0\n\n## Added\n\n- New feature.\n\n# 1.1.0\n\n- Old feature.\n', '1.2.0'), '## Added\n\n- New feature.');
  assert.equal(releaseNotes('# Changelog\r\n\r\n## [v1.3.0-beta.1+build] - 2026-10-03\r\n\r\n### Fixed\r\n\r\n- A fix.\r\n\r\n## 1.2.0\r\n\r\n- Old.\r\n', '1.3.0-beta.1+build'), '### Fixed\n\n- A fix.');
  assert.throws(() => releaseNotes('# 1.1.0\n\n- Older changes.', '1.2.0'), /no section for 1\.2\.0/);
  assert.throws(() => releaseNotes('# 1.2.0\n\n# 1.1.0\n\n- Older changes.', '1.2.0'), /no release notes/);
});

test('publish creates a GitHub release after npm with the checked commit and version notes', t => {
  const result = runPublish(t);
  assert.equal(result.status, 0, result.stderr);
  const published = result.commands.findIndex(entry => entry.command === 'npm' && entry.args[0] === 'publish');
  const created = result.commands.findIndex(entry => entry.command === 'gh' && entry.args[0] === 'release');
  assert.ok(published > 0 && created > published);
  assert.ok(result.commands.findIndex(entry => entry.command === 'gh' && entry.args[0] === 'auth') < published);
  assert.deepEqual(result.commands[created].args.slice(0, 9), ['release', 'create', 'v1.2.0', '--repo', 'oliverjessner/fetchary', '--target', commit, '--title', 'Fetchary 1.2.0']);
  assert.equal(result.commands[created].notes, '- Changes for this release.\n');
  assert.ok(!result.commands[created].args.includes('--prerelease'));
  assert.ok(!result.commands[created].args.includes('--latest=false'));
  const notesFile = result.commands[created].args.at(-1);
  assert.equal(fs.existsSync(notesFile), false, 'temporary release notes are removed');
  assert.match(result.stdout, /npm, GitHub release/);
});

test('full publish creates the GitHub release after pushing the Homebrew formula', t => {
  const result = runPublish(t, [], { brew: true });
  assert.equal(result.status, 0, result.stderr);
  const npmPublish = result.commands.findIndex(entry => entry.command === 'npm' && entry.args[0] === 'publish');
  const tapPush = result.commands.findIndex(entry => entry.command === 'git' && entry.args[0] === 'push' && !entry.args.includes('--dry-run'));
  const release = result.commands.findIndex(entry => entry.command === 'gh' && entry.args[0] === 'release');
  assert.ok(npmPublish >= 0 && tapPush > npmPublish && release > tapPush);
  assert.equal(result.commands[tapPush].cwd, fs.realpathSync(result.tapPath));
  const formula = fs.readFileSync(path.join(result.tapPath, 'Formula', 'fetchary.rb'), 'utf8');
  assert.match(formula, /fetchary-1\.2\.0\.tgz/);
  assert.ok(formula.includes(sha256('mock package bytes')));
  assert.match(result.stdout, /npm, Homebrew tap, GitHub release/);
});

test('Homebrew push failures prevent GitHub release creation', t => {
  const result = runPublish(t, [], { brew: true, brewFailure: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tap push failed/);
  assert.ok(result.commands.some(entry => entry.command === 'npm' && entry.args[0] === 'publish'));
  assert.equal(result.commands.some(entry => entry.command === 'gh' && entry.args[0] === 'release'), false);
});

test('GitHub preflight failures stop before npm publication', async t => {
  const cases = [
    [{ dirty: ' M package.json\n' }, /uncommitted changes/],
    [{ missingGh: true }, /GitHub CLI is required/],
    [{ authFailure: true }, /gh auth login/],
    [{ permission: 'READ' }, /write access/],
    [{ unpushed: true }, /Push it to oliverjessner\/fetchary/],
    [{ tagCommit: 'c'.repeat(40) }, /Use a new package version/],
    [{ lookupFailure: true }, /Could not check GitHub release/],
  ];
  for (const [scenario, message] of cases) {
    await t.test(Object.keys(scenario)[0], t => {
      const result = runPublish(t, [], scenario);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
      assert.equal(result.commands.some(entry => entry.command === 'npm' && entry.args[0] === 'publish'), false);
      assert.equal(result.commands.some(entry => entry.command === 'gh' && entry.args[0] === 'release'), false);
    });
  }
});

test('publish reuses a matching annotated tag and skips an existing published release', t => {
  const result = runPublish(t, ['--skip-npm'], {
    tagCommit: commit, annotatedTag: true,
    existing: { draft: false, html_url: 'https://github.com/oliverjessner/fetchary/releases/tag/v1.2.0' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GitHub release v1\.2\.0 already exists/);
  assert.equal(result.commands.some(entry => entry.command === 'gh' && entry.args[0] === 'release'), false);
});

test('publish resumes a draft release without republishing npm', t => {
  const result = runPublish(t, ['--skip-npm'], { tagCommit: commit, existing: { draft: true } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.commands.some(entry => entry.command === 'npm' && entry.args[0] === 'publish'), false);
  const edited = result.commands.find(entry => entry.command === 'gh' && entry.args[0] === 'release');
  assert.deepEqual(edited.args.slice(0, 3), ['release', 'edit', 'v1.2.0']);
  assert.ok(edited.args.includes('--draft=false'));
  assert.ok(edited.args.includes('--prerelease=false'));
  assert.equal(edited.notes, '- Changes for this release.\n');
});

test('dry run previews GitHub release data without GitHub authentication or publication', t => {
  const result = runPublish(t, ['--dry-run'], { missingGh: true, dirty: ' M package.json\n' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GitHub release preview\nRepository: oliverjessner\/fetchary\nTag: v1\.2\.0/);
  assert.match(result.stdout, new RegExp(`Commit: ${commit}`));
  assert.match(result.stdout, /- Changes for this release\./);
  assert.equal(result.commands.some(entry => entry.command === 'gh'), false);
  assert.equal(result.commands.some(entry => entry.command === 'npm' && entry.args[0] === 'publish'), false);
  assert.equal(result.commands.some(entry => entry.command === 'git' && entry.args[0] !== 'rev-parse'), false);
});

test('skip-github publishes to npm without GitHub checks', t => {
  const result = runPublish(t, ['--skip-github'], { missingGh: true, dirty: ' M package.json\n' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.commands.some(entry => entry.command === 'npm' && entry.args[0] === 'publish'));
  assert.equal(result.commands.some(entry => entry.command === 'gh' || entry.command === 'git'), false);
  assert.match(result.stdout, /1\.2\.0: npm\./);
});

test('non-latest and prerelease publishes do not replace the latest GitHub release', t => {
  const tagged = runPublish(t, ['--tag', 'next']);
  assert.equal(tagged.status, 0, tagged.stderr);
  const taggedRelease = tagged.commands.find(entry => entry.command === 'gh' && entry.args[0] === 'release');
  assert.ok(taggedRelease.args.includes('--latest=false'));
  const prerelease = runPublish(t, [], {}, '1.3.0-beta.1');
  assert.equal(prerelease.status, 0, prerelease.stderr);
  const prereleaseCommand = prerelease.commands.find(entry => entry.command === 'gh' && entry.args[0] === 'release');
  assert.equal(prereleaseCommand.args[2], 'v1.3.0-beta.1');
  assert.ok(prereleaseCommand.args.includes('--prerelease'));
  assert.ok(prereleaseCommand.args.includes('--latest=false'));
});

test('npm publication failures prevent GitHub release creation', t => {
  const result = runPublish(t, [], { npmFailure: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm publish failed/);
  assert.equal(result.commands.some(entry => entry.command === 'gh' && entry.args[0] === 'release'), false);
});

test('GitHub release failures report a command for resuming after npm publication', t => {
  const result = runPublish(t, [], { releaseFailure: true });
  assert.equal(result.status, 1);
  assert.ok(result.commands.some(entry => entry.command === 'npm' && entry.args[0] === 'publish'));
  assert.match(result.stderr, /Retry the GitHub release with: npm run publish -- --skip-npm --skip-brew/);
  const created = result.commands.find(entry => entry.command === 'gh' && entry.args[0] === 'release');
  assert.equal(fs.existsSync(created.args.at(-1)), false);
});

test('publish polling bypasses cached 404s and uses a new cache key on every retry', async t => {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://registry.test');
    requests.push(url);
    // A cached bare URL never succeeds. The origin needs one more retry.
    if (!url.searchParams.has('fetchary-publish') || requests.length === 1) {
      response.writeHead(404, { 'cache-control': 'public, max-age=300' });
      response.end('Not found');
    } else {
      response.end(tarball);
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  await waitForPublishedTarball('1.1.0', sha256(tarball), {
    attempts: 2,
    delayMs: 0,
    fetch: (url, options) => {
      const target = new URL(url);
      return fetch(`${origin}${target.pathname}${target.search}`, options);
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].pathname, '/fetchary/-/fetchary-1.1.0.tgz');
  assert.notEqual(requests[0].search, requests[1].search);
});

test('publish polling retries transport failures and stops after the attempt limit', async () => {
  let requests = 0;
  await assert.rejects(waitForPublishedTarball('1.1.0', sha256(tarball), {
    attempts: 2,
    delayMs: 0,
    fetch: async () => {
      requests++;
      if (requests === 1) throw new Error('connection reset');
      return new Response('Not found', { status: 404 });
    },
  }), /after 2 attempts/);
  assert.equal(requests, 2);
});

test('publish polling rejects a different package immediately without retrying', async () => {
  let requests = 0;
  const otherTarball = Buffer.from('different published package');
  await assert.rejects(waitForPublishedTarball('1.1.0', sha256(tarball), {
    attempts: 2,
    delayMs: 0,
    fetch: async () => {
      requests++;
      return new Response(otherTarball);
    },
  }), error => error.message === `tarball SHA256 is ${sha256(otherTarball)}, expected ${sha256(tarball)}`);
  assert.equal(requests, 1);
});

test('publish polling times out a stalled download and retries it', async t => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests++;
    if (requests > 1) response.end(tarball);
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;

  await waitForPublishedTarball('1.1.0', sha256(tarball), {
    attempts: 2,
    delayMs: 0,
    timeoutMs: 250,
    fetch: (_, options) => fetch(url, options),
  });
  assert.equal(requests, 2);
});
