#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultTapPath = path.resolve(repoRoot, '..', 'homebrew-tap');
const packageJson = require(path.join(repoRoot, 'package.json'));

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const tapPath = path.resolve(options.tapPath || process.env.HOMEBREW_TAP_PATH || defaultTapPath);
  const formulaPath = path.join(tapPath, 'Formula', 'fetchary.rb');
  const release = options.skipGithub ? null : prepareGitHubRelease();

  if (release && !options.dryRun) assertGitHubIsReady(release);

  if (!options.skipBrew && !options.dryRun) {
    assertTapIsReady(tapPath);
    runStep('Update Homebrew tap', 'git', ['pull', '--ff-only'], tapPath);
    assertTapIsReady(tapPath);
    if (!options.noPush) runStep('Check Homebrew push access', 'git', ['push', '--dry-run'], tapPath);
  }

  if (!options.skipTests) {
    runStep('Tests', 'npm', ['test']);
  }

  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'fetchary-publish-'));

  try {
    const tarball = npmPack(temporaryDirectory);
    const sha256 = await sha256File(path.join(temporaryDirectory, tarball.filename));
    const formula = renderFormula(packageJson.version, sha256);

    if (options.dryRun) {
      process.stdout.write(`\n==> Homebrew formula (${formulaPath})\n${formula}`);
      if (release) {
        process.stdout.write(`\n==> GitHub release preview\nRepository: ${release.repository}\nTag: ${release.tag}\nCommit: ${release.commit}\nTitle: ${release.title}\n\n${release.notes}\n`);
      }
      process.stdout.write('\nDry run complete. Nothing was published or changed.\n');
      return;
    }

    if (!options.skipNpm) {
      assertNpmAuthentication();
      assertVersionIsNotPublished();

      const publishArgs = ['publish', '--ignore-scripts', '--access', 'public', '--tag', options.tag];
      if (options.otp) publishArgs.push('--otp', options.otp);

      // package.json intentionally contains a script named "publish". Disabling
      // lifecycle scripts prevents `npm publish` from re-entering this script.
      runStep('Publish to npm', 'npm', publishArgs);
    }

    if (!options.skipBrew) {
      await waitForPublishedTarball(packageJson.version, sha256);
      await fsp.mkdir(path.dirname(formulaPath), { recursive: true });
      await fsp.writeFile(formulaPath, formula);
      process.stdout.write(`\nWrote ${formulaPath}\n`);

      runStep('Commit Homebrew formula', 'git', ['add', '--', 'Formula/fetchary.rb'], tapPath);
      const stagedChanges = capture('git', ['diff', '--cached', '--name-only', '--', 'Formula/fetchary.rb'], tapPath);
      if (stagedChanges) {
        run('git', ['commit', '-m', `fetchary ${packageJson.version}`], tapPath);
      } else {
        process.stdout.write('Homebrew formula is already up to date.\n');
      }

      if (!options.noPush) runStep('Push Homebrew tap', 'git', ['push'], tapPath);
    }

    if (release) {
      const notesFile = path.join(temporaryDirectory, 'release-notes.md');
      await fsp.writeFile(notesFile, `${release.notes}\n`);
      try {
        publishGitHubRelease(release, notesFile, options.tag);
      } catch (error) {
        throw new Error(`${error.message}\nRetry the GitHub release with: npm run publish -- --skip-npm --skip-brew`, { cause: error });
      }
    }

    const destinations = [];
    if (!options.skipNpm) destinations.push('npm');
    if (!options.skipBrew) destinations.push(options.noPush ? `local Homebrew commit in ${tapPath}` : 'Homebrew tap');
    if (release) destinations.push('GitHub release');
    process.stdout.write(`\nPublish complete for fetchary ${packageJson.version}: ${destinations.join(', ') || 'all destinations skipped'}.\n`);
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    help: false,
    noPush: false,
    otp: undefined,
    skipBrew: false,
    skipGithub: false,
    skipNpm: false,
    skipTests: false,
    tag: 'latest',
    tapPath: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--no-push') options.noPush = true;
    else if (argument === '--skip-brew') options.skipBrew = true;
    else if (argument === '--skip-github') options.skipGithub = true;
    else if (argument === '--skip-npm') options.skipNpm = true;
    else if (argument === '--skip-tests') options.skipTests = true;
    else if (argument === '--otp') options.otp = readValue(args, ++index, '--otp');
    else if (argument === '--tag') options.tag = readValue(args, ++index, '--tag');
    else if (argument === '--tap-path') options.tapPath = readValue(args, ++index, '--tap-path');
    else if (argument.startsWith('--otp=')) options.otp = argument.slice('--otp='.length);
    else if (argument.startsWith('--tag=')) options.tag = argument.slice('--tag='.length);
    else if (argument.startsWith('--tap-path=')) options.tapPath = argument.slice('--tap-path='.length);
    else throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

function readValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function assertTapIsReady(tapPath) {
  if (!fs.existsSync(path.join(tapPath, '.git'))) {
    throw new Error(`Homebrew tap is not a git checkout: ${tapPath}`);
  }

  const changes = capture('git', ['status', '--porcelain', '--untracked-files=all'], tapPath);
  if (changes) {
    throw new Error(`The Homebrew tap has uncommitted changes:\n${changes}\nCommit or discard them before publishing.`);
  }
}

function assertNpmAuthentication() {
  const result = spawnSync('npm', ['whoami'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error('npm authentication is required. Run `npm login`, then retry `npm run publish`.');
  }

  process.stdout.write(`\nAuthenticated with npm as ${result.stdout.trim()}\n`);
}

function releaseNotes(changelog, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^#{1,2}\\s+(?:\\[v?${escapedVersion}\\]|v?${escapedVersion})(?:\\s.*)?$`);
  const lines = changelog.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex(line => heading.test(line));
  if (start === -1) throw new Error(`docs/changelog.md has no section for ${version}.`);
  const level = lines[start].match(/^#+/)[0].length;
  const nextHeading = new RegExp(`^#{1,${level}}\\s+`);
  const remaining = lines.slice(start + 1);
  const end = remaining.findIndex(line => nextHeading.test(line));
  const notes = remaining.slice(0, end === -1 ? undefined : end).join('\n').trim();
  if (!notes) throw new Error(`docs/changelog.md has no release notes for ${version}.`);
  return notes;
}

function prepareGitHubRelease() {
  const repositoryUrl = new URL(packageJson.repository.url.replace(/^git\+/, ''));
  const repository = repositoryUrl.pathname.replace(/^\//, '').replace(/\.git$/, '');
  if (repositoryUrl.hostname !== 'github.com' || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error('package.json must point to a GitHub repository to publish a release.');
  }
  return {
    repository,
    tag: `v${packageJson.version}`,
    title: `Fetchary ${packageJson.version}`,
    commit: capture('git', ['rev-parse', 'HEAD'], repoRoot),
    notes: releaseNotes(fs.readFileSync(path.join(repoRoot, 'docs', 'changelog.md'), 'utf8'), packageJson.version),
    prerelease: packageJson.version.split('+')[0].includes('-'),
  };
}

function assertGitHubIsReady(release) {
  const changes = capture('git', ['status', '--porcelain', '--untracked-files=all'], repoRoot);
  if (changes) {
    throw new Error(`The Fetchary checkout has uncommitted changes:\n${changes}\nCommit and push the release changes before publishing so the GitHub tag matches the package.`);
  }
  const authenticated = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (authenticated.error?.code === 'ENOENT') {
    throw new Error('GitHub CLI is required to publish a release. Install `gh`, then run `gh auth login`.');
  }
  if (authenticated.error) throw authenticated.error;
  if (authenticated.status !== 0) {
    throw new Error('GitHub authentication is required. Run `gh auth login`, then retry `npm run publish`.');
  }
  const permission = capture('gh', ['repo', 'view', release.repository, '--json', 'viewerPermission', '--jq', '.viewerPermission'], repoRoot);
  if (!['ADMIN', 'MAINTAIN', 'WRITE'].includes(permission)) {
    throw new Error(`GitHub write access to ${release.repository} is required to publish a release.`);
  }
  const commit = spawnSync('gh', ['api', `repos/${release.repository}/commits/${release.commit}`, '--jq', '.sha'], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (commit.error) throw commit.error;
  if (commit.status !== 0 || commit.stdout.trim() !== release.commit) {
    throw new Error(`Could not verify commit ${release.commit} on GitHub. Push it to ${release.repository} before publishing.\n${commit.stderr.trim()}`);
  }
  const tagRef = `refs/tags/${release.tag}`;
  const remoteTags = capture('git', ['ls-remote', '--tags', `https://github.com/${release.repository}.git`, tagRef, `${tagRef}^{}`], repoRoot);
  const refs = new Map(remoteTags.split('\n').filter(Boolean).map(line => {
    const [sha, ref] = line.split(/\s+/);
    return [ref, sha];
  }));
  const taggedCommit = refs.get(`${tagRef}^{}`) || refs.get(tagRef);
  if (taggedCommit && taggedCommit !== release.commit) {
    throw new Error(`GitHub tag ${release.tag} points to ${taggedCommit}, not the release commit ${release.commit}. Use a new package version.`);
  }
  release.existing = findGitHubRelease(release);
}

function findGitHubRelease(release) {
  const result = spawnSync('gh', ['api', `repos/${release.repository}/releases/tags/${encodeURIComponent(release.tag)}`], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/HTTP 404\b/.test(result.stderr)) return null;
  throw new Error(`Could not check GitHub release ${release.tag}: ${result.stderr.trim()}`);
}

function publishGitHubRelease(release, notesFile, npmTag) {
  if (release.existing && !release.existing.draft) {
    process.stdout.write(`\nGitHub release ${release.tag} already exists: ${release.existing.html_url}\n`);
    return;
  }
  const args = ['release', release.existing ? 'edit' : 'create', release.tag,
    '--repo', release.repository, '--target', release.commit,
    '--title', release.title, '--notes-file', notesFile];
  if (release.existing) args.push('--draft=false', `--prerelease=${release.prerelease}`);
  else if (release.prerelease) args.push('--prerelease');
  if (release.prerelease || npmTag !== 'latest') args.push('--latest=false');
  runStep('Publish GitHub release', 'gh', args);
}

function assertVersionIsNotPublished() {
  const packageVersion = `${packageJson.name}@${packageJson.version}`;
  const result = spawnSync('npm', ['view', packageVersion, 'version', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0 && result.stdout.trim()) {
    throw new Error(`${packageVersion} is already published. Increase the version or resume with --skip-npm.`);
  }

  if (result.status !== 0 && !result.stderr.includes('E404')) {
    throw new Error(`Could not check ${packageVersion} on npm: ${result.stderr.trim()}`);
  }
}

function npmPack(destination) {
  process.stdout.write('\n==> Build npm tarball\n');
  const output = capture('npm', ['pack', '--json', '--pack-destination', destination], repoRoot);
  const result = JSON.parse(output);
  if (!Array.isArray(result) || !result[0]?.filename) {
    throw new Error('npm pack did not return tarball metadata.');
  }
  return result[0];
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function waitForPublishedTarball(version, expectedSha256, options = {}) {
  const attempts = options.attempts ?? 30;
  const delayMs = options.delayMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchTarball = options.fetch ?? fetch;
  const url = `https://registry.npmjs.org/fetchary/-/fetchary-${version}.tgz`;
  const requestId = crypto.randomUUID();

  process.stdout.write(`\n==> Wait for npm tarball\n${url}\n`);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // The registry CDN can cache a pre-publication 404 for several minutes,
    // even with cache: 'no-store'. Give every retry a fresh cache key.
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('fetchary-publish', `${requestId}-${attempt}`);
    let contents;
    try {
      const response = await fetchTarball(requestUrl.href, {
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        contents = Buffer.from(await response.arrayBuffer());
      } else {
        process.stdout.write(`Attempt ${attempt}/${attempts}: HTTP ${response.status}; retrying.\n`);
        await response.body?.cancel();
      }
    } catch (error) {
      process.stdout.write(`Attempt ${attempt}/${attempts}: ${error.message}; retrying.\n`);
    }
    if (contents !== undefined) {
      const actualSha256 = crypto.createHash('sha256').update(contents).digest('hex');
      if (actualSha256 !== expectedSha256) {
        throw new Error(`tarball SHA256 is ${actualSha256}, expected ${expectedSha256}`);
      }
      process.stdout.write(`npm tarball is available (attempt ${attempt}).\n`);
      return;
    }
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error(`npm tarball did not become available with the expected SHA256 after ${attempts} attempts.`);
}

function renderFormula(version, sha256) {
  return `class Fetchary < Formula
  desc "Archive exact web responses and rendered DOM changes"
  homepage "https://github.com/oliverjessner/fetchary"
  url "https://registry.npmjs.org/fetchary/-/fetchary-${version}.tgz"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/fetchary"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/fetchary --version")
  end
end
`;
}

function runStep(label, command, args, cwd = repoRoot) {
  process.stdout.write(`\n==> ${label}\n`);
  run(command, args, cwd);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${[command, ...args].join(' ')} exited with status ${result.status}.`);
  }
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${[command, ...args].join(' ')} exited with status ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function printHelp() {
  process.stdout.write(`Publish Fetchary to npm, Homebrew, and GitHub Releases.

Usage:
  npm run publish
  npm run publish -- --dry-run

Options:
  --dry-run          Run tests, build the package, and preview the formula and release.
  --tap-path <path>  Homebrew tap checkout (default: ../homebrew-tap).
  --tag <tag>        npm dist-tag (default: latest).
  --otp <code>       npm one-time password.
  --no-push          Commit the formula without pushing the tap.
  --skip-tests       Skip the test suite.
  --skip-npm         Skip npm publication (for resuming a partial publish).
  --skip-brew        Skip the Homebrew formula update.
  --skip-github      Skip the GitHub release.
  --help             Show this help.
`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`\nPublish failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { waitForPublishedTarball, releaseNotes };
