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

    const brewResult = options.skipBrew
      ? 'npm only'
      : options.noPush
        ? `npm and local Homebrew commit in ${tapPath}`
        : 'npm and Homebrew tap';
    process.stdout.write(`\nPublished fetchary ${packageJson.version} to ${brewResult}.\n`);
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

function renderFormula(version, sha256) {
  return `class Fetchary < Formula
  desc "Watch web pages for changes and archive exact response versions"
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
  process.stdout.write(`Publish Fetchary to npm and Homebrew.

Usage:
  npm run publish
  npm run publish -- --dry-run

Options:
  --dry-run          Run tests, build the package, and print the formula only.
  --tap-path <path>  Homebrew tap checkout (default: ../homebrew-tap).
  --tag <tag>        npm dist-tag (default: latest).
  --otp <code>       npm one-time password.
  --no-push          Commit the formula without pushing the tap.
  --skip-tests       Skip the test suite.
  --skip-npm         Only update the Homebrew formula.
  --skip-brew        Only publish to npm.
  --help             Show this help.
`);
}

main().catch((error) => {
  process.stderr.write(`\nPublish failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
