'use strict';
const { validateRemoteUrl, validateUrl } = require('../utils/url');
const { normalizeCookies, createCookieJar } = require('../capture/cookies');
const { abortable } = require('../capture/http');
const { validateSessionName, sessionDirectory, saveSession } = require('./sessions');
const { FetcharyValidationError, FetcharyBrowserError, FetcharyFetchError } = require('../errors');

async function login(url, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new FetcharyValidationError('options must be an object');
  const requestedUrl = validateUrl(url);
  const target = new URL(requestedUrl);
  const session = validateSessionName(options.session ?? target.hostname.replace(/[^a-z0-9.-]/g, '').slice(0, 64));
  sessionDirectory(options);
  const timeout = options.timeout ?? 300_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new FetcharyValidationError('timeout must be greater than zero');
  if (typeof options.confirm !== 'function') throw new FetcharyValidationError('login requires a confirm callback; resolve it after the user has signed in');
  if (options.launchBrowser !== undefined && typeof options.launchBrowser !== 'function') throw new FetcharyValidationError('launchBrowser must be a function');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new FetcharyValidationError('signal must be an AbortSignal');
  if (options.allowPrivateNetwork !== undefined && typeof options.allowPrivateNetwork !== 'boolean') throw new FetcharyValidationError('allowPrivateNetwork must be a boolean');
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  const launch = options.launchBrowser || (settings => require('puppeteer').launch(settings));
  let browser; let pending; let context; let page; let disconnected = false;
  const closed = () => { disconnected = true; controller.abort(); };
  try {
    signal.throwIfAborted();
    await validateRemoteUrl(requestedUrl, { ...options, signal, timeout: Math.min(timeout, 30_000) });
    pending = Promise.resolve().then(() => launch({ headless: false, defaultViewport: null, timeout: Math.min(timeout, 30_000),
      signal, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, args: ['--disable-background-networking'] }));
    browser = await abortable(pending, signal);
    browser.on?.('disconnected', closed);
    context = await abortable(browser.createBrowserContext(), signal);
    page = await abortable(context.newPage(), signal);
    page.on?.('close', closed);
    const response = await abortable(page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 30_000) }), signal);
    if (response?.status() >= 400) throw new FetcharyBrowserError('login page could not be opened', { phase: 'login', status: response.status() });
    await abortable(Promise.resolve().then(() => options.confirm({ session, origin: target.origin, signal })), signal);
    // Only retain this website's cookies; third-party/SSO-provider sessions stay in the temporary browser.
    const cookies = await abortable(context.cookies(), signal);
    const root = target.hostname.toLowerCase();
    const relevant = cookies.filter(cookie => {
      const domain = cookie.domain?.replace(/^\./, '').toLowerCase();
      return cookie.partitionKey == null && cookie.partitioned !== true && domain && (domain === root || domain.endsWith(`.${root}`) || cookie.domain.startsWith('.') && root.endsWith(`.${domain}`))
        && (cookie.expires === -1 || cookie.expires > Date.now() / 1000);
    });
    const normalized = normalizeCookies(relevant, 'login session');
    createCookieJar(normalized, requestedUrl, 'login session');
    const savedAt = new Date().toISOString();
    const data = { version: 1, origin: target.origin, savedAt, cookies: normalized.map(cookie => ({ ...cookie, expires: cookie.expires ?? -1 })) };
    await saveSession(session, data, { ...options, signal });
    return { session, origin: target.origin, savedAt, cookieCount: normalized.length };
  } catch (error) {
    if (options.signal?.aborted) throw new FetcharyFetchError('login aborted; previous session kept');
    if (disconnected) throw new FetcharyBrowserError('login browser closed before the session was saved; previous session kept', { phase: 'login' });
    if (signal.aborted) throw new FetcharyBrowserError('login timed out; previous session kept', { phase: 'login' });
    if (error instanceof FetcharyValidationError || error instanceof FetcharyBrowserError || error instanceof FetcharyFetchError) throw error;
    // Browser/protocol errors can serialize cookies or form submissions.
    throw new FetcharyBrowserError('could not complete browser login; previous session kept', { phase: 'login' });
  } finally {
    clearTimeout(timer);
    browser?.off?.('disconnected', closed);
    page?.off?.('close', closed);
    await context?.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    else pending?.then(late => late.close()).catch(() => {});
    controller.abort();
  }
}

module.exports = { login };
