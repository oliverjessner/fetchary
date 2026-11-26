'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBrowserRuntime } = require('../src/capture/browser-runtime');

const buildId = '157.0.8103.50';
const platform = 'test-platform';

function fixture(t, env = {}, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-browser-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'package');
  const installs = []; const launches = []; let loads = 0;
  const installedPath = options => path.join(options.cacheDir, 'chrome', `${options.platform}-${options.buildId}`);
  const executablePath = options => path.join(installedPath(options), 'chrome-test', 'chrome');
  const browsers = {
    Browser: { CHROME: 'chrome' },
    detectBrowserPlatform: () => platform,
    computeExecutablePath: executablePath,
    install: async options => {
      installs.push(options);
      const target = executablePath(options);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'test browser executable', { mode: 0o755 });
      fs.writeFileSync(path.join(path.dirname(target), 'resources.pak'), 'browser resources');
      if (process.platform !== 'win32') fs.symlinkSync('resources.pak', path.join(path.dirname(target), 'resource-link'));
      await overrides.afterInstall?.(options);
      return { path: installedPath(options), executablePath: target };
    },
    ...overrides.browsers,
  };
  const puppeteer = { launch: async options => { launches.push(options); return { browser: 'fake' }; } };
  const loadDependencies = () => { loads++; return { browsers, puppeteer, buildId }; };
  const runtime = createBrowserRuntime({ env, packageRoot, loadDependencies });
  const cacheDir = env.PUPPETEER_CACHE_DIR ? path.resolve(env.PUPPETEER_CACHE_DIR) : path.join(packageRoot, '.fetchary-browsers');
  const target = executablePath({ cacheDir, buildId, platform });
  return { root, runtime, browsers, puppeteer, packageRoot, loadDependencies, cacheDir, target, installs, launches,
    get loads() { return loads; } };
}

test('runtime construction is lazy and missing browsers never trigger a download', async t => {
  const f = fixture(t);
  assert.equal(f.loads, 0);
  assert.equal(fs.existsSync(f.packageRoot), false);
  await assert.rejects(f.runtime.launchBrowser({ headless: true }), /Could not find Chrome \(ver\. 157\.0\.8103\.50\)/);
  assert.equal(f.installs.length, 0);
  assert.equal(f.launches.length, 0);
  assert.equal(fs.existsSync(f.packageRoot), false);
});

test('installation stages the exact revision and keeps the entire portable browser tree', async t => {
  const f = fixture(t);
  const result = await f.runtime.installBrowser();
  assert.deepEqual(result, { browser: 'chrome', buildId, platform, executablePath: f.target, skipped: false });
  assert.equal(f.installs.length, 1);
  const downloaded = f.installs[0];
  assert.equal(downloaded.browser, 'chrome');
  assert.equal(downloaded.buildId, buildId);
  assert.equal(downloaded.platform, platform);
  assert.notEqual(downloaded.cacheDir, f.cacheDir);
  assert.equal(path.dirname(downloaded.cacheDir), f.cacheDir);
  assert.equal(fs.existsSync(downloaded.cacheDir), false, 'staging directory is removed');
  assert.equal(fs.readFileSync(path.join(path.dirname(f.target), 'resources.pak'), 'utf8'), 'browser resources');
  if (process.platform !== 'win32') {
    assert.equal(fs.readlinkSync(path.join(path.dirname(f.target), 'resource-link')), 'resources.pak');
    assert.notEqual(fs.statSync(f.target).mode & 0o111, 0);
  }
  assert.deepEqual(await f.runtime.installBrowser(), result);
  assert.equal(f.installs.length, 1, 'the matching installed build is reused');
});

test('headless extraction and visible login launch the same explicitly selected bundled browser', async t => {
  const f = fixture(t);
  await f.runtime.installBrowser();
  const signal = new AbortController().signal;
  const extraction = { headless: true, args: ['--disable-quic'], signal, timeout: 1234, acceptInsecureCerts: true };
  const login = { headless: false, defaultViewport: null, args: [], timeout: 4321 };
  await f.runtime.launchBrowser(extraction);
  await f.runtime.launchBrowser(login);
  assert.deepEqual(f.launches, [
    { ...extraction, browser: 'chrome', executablePath: f.target },
    { ...login, browser: 'chrome', executablePath: f.target },
  ]);
  assert.equal(Object.hasOwn(extraction, 'executablePath'), false);
  assert.equal(f.installs.length, 1, 'launching does not install or update browsers');
});

test('an installed package can move without depending on the original cache path', async t => {
  const f = fixture(t);
  await f.runtime.installBrowser();
  const relocatedRoot = path.join(f.root, 'relocated-package');
  fs.renameSync(f.packageRoot, relocatedRoot);
  const relocated = createBrowserRuntime({ env: {}, packageRoot: relocatedRoot, loadDependencies: f.loadDependencies });
  await relocated.launchBrowser({ headless: true });
  const movedTarget = path.join(relocatedRoot, '.fetchary-browsers', path.relative(f.cacheDir, f.target));
  assert.equal(f.launches[0].executablePath, movedTarget);
  assert.equal(fs.readFileSync(path.join(path.dirname(movedTarget), process.platform === 'win32' ? 'resources.pak' : 'resource-link'), 'utf8'), 'browser resources');
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(f.installs.length, 1);
});

test('a cache override is shared by installation and runtime without changing environment settings', async t => {
  const env = { PUPPETEER_CACHE_DIR: path.join(os.tmpdir(), `fetchary-custom-${process.pid}-${Date.now()}`) };
  t.after(() => fs.rmSync(env.PUPPETEER_CACHE_DIR, { recursive: true, force: true }));
  const before = { ...env }; const f = fixture(t, env);
  await f.runtime.installBrowser();
  await f.runtime.launchBrowser({ headless: true });
  assert.equal(f.launches[0].executablePath, f.target);
  assert.equal(fs.existsSync(path.join(f.packageRoot, '.fetchary-browsers')), false);
  assert.deepEqual(env, before);
});

test('an external executable bypasses downloads and takes precedence over the bundled cache', async t => {
  const f = fixture(t);
  const external = path.join(f.root, 'external-chrome');
  fs.writeFileSync(external, 'external browser', { mode: 0o755 });
  const runtime = createBrowserRuntime({ env: { PUPPETEER_EXECUTABLE_PATH: external }, packageRoot: f.packageRoot, loadDependencies: f.loadDependencies });
  assert.equal((await runtime.installBrowser()).skipped, true);
  assert.equal(f.loads, 0, 'an external executable needs no downloader setup');
  await runtime.launchBrowser({ headless: false });
  assert.equal(f.launches[0].executablePath, external);
  assert.equal(f.launches[0].browser, 'chrome');
  assert.equal(f.installs.length, 0);
});

test('postinstall respects skip flags while explicit repair installs the required browser', async t => {
  for (const key of ['PUPPETEER_SKIP_DOWNLOAD', 'PUPPETEER_CHROME_SKIP_DOWNLOAD', 'PUPPETEER_SKIP_CHROME_DOWNLOAD']) {
    const f = fixture(t, { [key]: 'true' });
    assert.equal((await f.runtime.installBrowser({ respectSkipDownload: true })).skipped, true, key);
    assert.equal(f.installs.length, 0);
    assert.equal(f.loads, 0);
    assert.equal(fs.existsSync(f.packageRoot), false);
    assert.equal((await f.runtime.installBrowser()).skipped, false, key);
    assert.equal(f.installs.length, 1);
  }
});

test('false-valued download flags do not skip postinstall', async t => {
  for (const value of ['', '0', 'false', 'FALSE', 'off', 'OFF']) {
    const f = fixture(t, { PUPPETEER_SKIP_DOWNLOAD: value });
    assert.equal((await f.runtime.installBrowser({ respectSkipDownload: true })).skipped, false, value);
    assert.equal(f.installs.length, 1);
  }
});

test('failed staging leaves no runnable partial build and a later repair can succeed', async t => {
  let fail = true;
  const f = fixture(t, {}, { afterInstall: async () => { if (fail) throw new Error('download interrupted PRIVATE_PROXY_TOKEN'); } });
  await assert.rejects(f.runtime.installBrowser(), error => {
    assert.equal(error.name, 'FetcharyBrowserError');
    assert.equal(error.message.includes('PRIVATE_PROXY_TOKEN'), false);
    return true;
  });
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.existsSync(f.installs[0].cacheDir), false);
  assert.equal(f.launches.length, 0);
  fail = false;
  assert.equal((await f.runtime.installBrowser()).skipped, false);
  assert.equal(f.installs.length, 2);
});

test('concurrent setup calls share one completed installation', async t => {
  const f = fixture(t);
  const [first, second] = await Promise.all([f.runtime.installBrowser(), f.runtime.installBrowser()]);
  assert.deepEqual(first, second);
  assert.equal(f.installs.length, 1);
  assert.equal(fs.existsSync(f.target), true);
});

test('an active commit lock keeps another installer from replacing its browser tree', async t => {
  let lock;
  const f = fixture(t, {}, { afterInstall: async () => {
    lock = path.join(f.cacheDir, 'chrome', `${platform}-${buildId}.lock`);
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
  } });
  await assert.rejects(f.runtime.installBrowser(), /another Fetchary browser installation/);
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.readFileSync(path.join(lock, 'pid'), 'utf8'), String(process.pid));
  assert.equal(fs.existsSync(f.installs[0].cacheDir), false, 'the losing installer cleans only its staging directory');
});

test('a previous Chrome revision is never launched in place of the required build', async t => {
  const f = fixture(t);
  const other = f.browsers.computeExecutablePath({ cacheDir: f.cacheDir, buildId: '156.0.0.1', platform });
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, 'old executable', { mode: 0o755 });
  await assert.rejects(f.runtime.launchBrowser({ headless: true }), /157\.0\.8103\.50/);
  assert.equal(f.launches.length, 0);
  assert.equal(f.installs.length, 0);
  await f.runtime.installBrowser();
  await f.runtime.launchBrowser({ headless: true });
  assert.equal(f.launches[0].executablePath, f.target);
  assert.equal(fs.readFileSync(other, 'utf8'), 'old executable');
});

test('repair replaces an incomplete exact build without deleting other browser versions', async t => {
  const f = fixture(t);
  const partial = path.dirname(f.target);
  fs.mkdirSync(partial, { recursive: true });
  fs.writeFileSync(path.join(partial, 'unfinished'), 'interrupted install');
  const otherBuild = path.join(f.cacheDir, 'chrome', `${platform}-156.0.0.1`, 'keep');
  fs.mkdirSync(path.dirname(otherBuild), { recursive: true });
  fs.writeFileSync(otherBuild, 'previous version');
  await f.runtime.installBrowser();
  assert.equal(fs.existsSync(f.target), true);
  assert.equal(fs.existsSync(path.join(partial, 'unfinished')), false);
  assert.equal(fs.readFileSync(otherBuild, 'utf8'), 'previous version');
});

test('a non-executable cached file is repaired before launch', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.target), { recursive: true });
  fs.writeFileSync(f.target, 'broken permissions', { mode: 0o644 });
  await assert.rejects(f.runtime.launchBrowser({ headless: true }), /Could not find Chrome/);
  await f.runtime.installBrowser();
  await f.runtime.launchBrowser({ headless: true });
  assert.equal(f.installs.length, 1);
  assert.equal(f.launches.length, 1);
  assert.notEqual(fs.statSync(f.target).mode & 0o111, 0);
});

test('unsupported platforms do not start an installation', async t => {
  const f = fixture(t, {}, { browsers: { detectBrowserPlatform: () => undefined } });
  await assert.rejects(f.runtime.installBrowser(), /platform|supported/i);
  assert.equal(f.installs.length, 0);
});
