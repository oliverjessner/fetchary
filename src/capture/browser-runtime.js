'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FetcharyBrowserError } = require('../errors');

function loadBrowserDependencies() {
  return {
    // Core accepts the explicit executable without reading the caller's config.
    puppeteer: require('puppeteer-core'),
    browsers: require('@puppeteer/browsers'),
    buildId: require('puppeteer-core/internal/revisions.js').PUPPETEER_REVISIONS.chrome,
  };
}

function enabled(value) {
  return value !== undefined && !['', '0', 'false', 'off'].includes(value.toLowerCase());
}

function executableExists(filename) {
  try {
    if (!fs.statSync(filename).isFile()) return false;
    fs.accessSync(filename, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch { return false; }
}

function createBrowserRuntime({ env = process.env, packageRoot = path.resolve(__dirname, '../..'), loadDependencies = loadBrowserDependencies } = {}) {
  let dependencies;
  let installing;
  const load = () => dependencies ??= loadDependencies();
  const externalPath = () => env.PUPPETEER_EXECUTABLE_PATH ? path.resolve(env.PUPPETEER_EXECUTABLE_PATH) : null;

  function browserDetails() {
    const { browsers, buildId } = load();
    const platform = browsers.detectBrowserPlatform();
    if (!platform) throw new FetcharyBrowserError('bundled Chrome is unavailable on this platform; set PUPPETEER_EXECUTABLE_PATH to a compatible Chrome executable', { phase: 'launch' });
    const cacheDir = env.PUPPETEER_CACHE_DIR ? path.resolve(env.PUPPETEER_CACHE_DIR) : path.join(packageRoot, '.fetchary-browsers');
    return { browser: browsers.Browser.CHROME, buildId, platform, cacheDir,
      executablePath: browsers.computeExecutablePath({ browser: browsers.Browser.CHROME, buildId, platform, cacheDir }) };
  }

  async function launchBrowser(settings) {
    const executablePath = externalPath();
    if (executablePath) return load().puppeteer.launch({ ...settings, browser: 'chrome', executablePath });
    const details = browserDetails();
    if (!executableExists(details.executablePath)) throw new Error(`Could not find Chrome (ver. ${details.buildId}).`);
    // Never depend on the caller's cwd, Puppeteer config or home cache.
    return load().puppeteer.launch({ ...settings, browser: 'chrome', executablePath: details.executablePath });
  }

  async function install(details) {
    const { browsers } = load();
    const result = { browser: details.browser, buildId: details.buildId, platform: details.platform,
      executablePath: details.executablePath, skipped: false };
    if (executableExists(details.executablePath)) return result;
    let staging;
    let publicationLock;
    try {
      await fs.promises.mkdir(details.cacheDir, { recursive: true });
      staging = await fs.promises.mkdtemp(path.join(details.cacheDir, '.install-'));
      // A failed/interrupted unpack must never look like a completed install.
      const downloaded = await browsers.install({ browser: details.browser, buildId: details.buildId,
        platform: details.platform, cacheDir: staging, unpack: true, installDeps: false,
        ...(env.PUPPETEER_CHROME_DOWNLOAD_BASE_URL ? { baseUrl: env.PUPPETEER_CHROME_DOWNLOAD_BASE_URL } : {}) });
      if (!executableExists(downloaded.executablePath)) throw new Error('downloaded Chrome executable is missing');
      const relative = path.relative(staging, downloaded.path);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('invalid Chrome installation directory');
      const destination = path.join(details.cacheDir, relative);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      // Another installer may have finished while this download was running.
      if (!executableExists(details.executablePath)) {
        const lock = `${destination}.lock`;
        try { await fs.promises.mkdir(lock); publicationLock = lock; }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          if (executableExists(details.executablePath)) return result;
          // Never reclaim another process's lock using a stale owner check.
          throw new FetcharyBrowserError(`another Fetchary browser installation is finishing; retry "fetchary browser install". If that installer was interrupted, remove "chrome/${path.basename(lock)}" from the browser cache before retrying`, { phase: 'install' });
        }
        await fs.promises.writeFile(path.join(publicationLock, 'pid'), String(process.pid));
        // The lock covers the check as well as replacement of incomplete data.
        if (executableExists(details.executablePath)) return result;
        await fs.promises.rm(destination, { recursive: true, force: true });
        try { await fs.promises.rename(downloaded.path, destination); }
        catch (error) { if (!executableExists(details.executablePath)) throw error; }
      }
      if (!executableExists(details.executablePath)) throw new Error('installed Chrome executable is missing');
      return result;
    } catch (cause) {
      if (cause instanceof FetcharyBrowserError) throw cause;
      throw new FetcharyBrowserError(`could not install bundled Chrome ${details.buildId}; check network access and write permissions, then run "fetchary browser install"`, { phase: 'install', cause });
    } finally {
      if (publicationLock) await fs.promises.rm(publicationLock, { recursive: true, force: true }).catch(() => {});
      if (staging) await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function installBrowser({ respectSkipDownload = false } = {}) {
    if (externalPath()) return { skipped: true, reason: 'PUPPETEER_EXECUTABLE_PATH' };
    if (respectSkipDownload) {
      const skip = ['PUPPETEER_SKIP_DOWNLOAD', 'PUPPETEER_CHROME_SKIP_DOWNLOAD', 'PUPPETEER_SKIP_CHROME_DOWNLOAD'].find(name => enabled(env[name]));
      if (skip) return { skipped: true, reason: skip };
    }
    if (!installing) installing = install(browserDetails()).finally(() => { installing = null; });
    return installing;
  }

  return { launchBrowser, installBrowser };
}

const runtime = createBrowserRuntime();
module.exports = { createBrowserRuntime, ...runtime };
