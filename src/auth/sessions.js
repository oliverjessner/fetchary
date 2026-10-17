'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { parseCookieFile, createCookieJar } = require('../capture/cookies');
const { validateUrl } = require('../utils/url');
const { FetcharyValidationError, FetcharyFetchError } = require('../errors');

const MAX_BYTES = 1024 * 1024;
const fail = message => { throw new FetcharyValidationError(message); };
function validateSessionName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) fail('session must be 1–64 lowercase letters, digits, dots, underscores or hyphens, starting with a letter or digit');
  return name;
}
function sessionDirectory(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('options must be an object');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('signal must be an AbortSignal');
  if (options.sessionDir !== undefined && (typeof options.sessionDir !== 'string' || !options.sessionDir.trim() || options.sessionDir.length > 4096 || options.sessionDir.includes('\0'))) fail('sessionDir must be a non-empty directory path');
  return path.resolve(options.sessionDir ?? path.join(os.homedir(), '.fetchary', 'sessions'));
}
function sessionFile(name, options) { return path.join(sessionDirectory(options), `${validateSessionName(name)}.json`); }
function checkPermissions(stat, directory = false) {
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('saved session must use a regular file in a private directory');
  if (process.platform !== 'win32' && (stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail('saved session files and their directory must be accessible only to the current user (directory: chmod 700; file: chmod 600)');
}
async function checkedDirectory(options) {
  const directory = sessionDirectory(options);
  checkPermissions(await fs.lstat(directory), true);
  return directory;
}
function rethrow(error, message, signal) {
  if (signal?.aborted) throw new FetcharyFetchError('session operation aborted');
  if (error instanceof FetcharyValidationError) throw error;
  fail(message);
}
async function readSession(name, options = {}) {
  const file = sessionFile(name, options);
  let handle;
  try {
    options.signal?.throwIfAborted();
    await checkedDirectory(options);
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat(); checkPermissions(stat);
    if (stat.size > MAX_BYTES) fail('saved session exceeds 1 MiB');
    const buffer = Buffer.alloc(MAX_BYTES + 1); let length = 0;
    while (length < buffer.length) {
      options.signal?.throwIfAborted();
      const part = await handle.read(buffer, length, buffer.length - length, length);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > MAX_BYTES) fail('saved session exceeds 1 MiB');
    let data;
    try { data = JSON.parse(buffer.toString('utf8', 0, length)); } catch { fail('invalid saved session'); }
    if (!data || data.version !== 1 || typeof data.origin !== 'string' || typeof data.savedAt !== 'string' || !Number.isFinite(Date.parse(data.savedAt))) fail('invalid saved session');
    const origin = new URL(validateUrl(data.origin));
    if (origin.href !== `${origin.origin}/`) fail('invalid saved session origin');
    const cookies = parseCookieFile(JSON.stringify({ cookies: data.cookies }));
    return { ...data, cookies };
  } catch (error) { rethrow(error, 'could not read saved session; run fetchary login again or check --session-dir', options.signal); }
  finally { await handle?.close().catch(() => {}); }
}
async function saveSession(name, data, options = {}) {
  const file = sessionFile(name, options);
  const body = JSON.stringify(data, null, 2) + '\n';
  if (Buffer.byteLength(body) > MAX_BYTES) fail('saved session exceeds 1 MiB');
  let temporary; let handle;
  try {
    options.signal?.throwIfAborted();
    await fs.mkdir(sessionDirectory(options), { recursive: true, mode: 0o700 });
    const directory = await checkedDirectory(options);
    try { checkPermissions(await fs.lstat(file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    temporary = path.join(directory, `.${randomUUID()}.tmp`);
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    await handle.writeFile(body); await handle.sync(); await handle.close(); handle = null;
    options.signal?.throwIfAborted();
    await fs.rename(temporary, file); temporary = null;
  } catch (error) { rethrow(error, 'could not save session; check --session-dir permissions', options.signal); }
  finally {
    await handle?.close().catch(() => {});
    if (temporary) await fs.unlink(temporary).catch(() => {});
  }
}
async function loadSessionJar(name, url, options = {}) {
  const data = await readSession(name, options);
  const host = new URL(url).hostname; const root = new URL(data.origin).hostname;
  if (host !== root && !host.endsWith(`.${root}`)) fail('saved session belongs to a different hostname; choose a matching session or log in to this host');
  return createCookieJar(data.cookies, url, 'saved session');
}
async function listSessions(options = {}) {
  const directory = sessionDirectory(options);
  try {
    options.signal?.throwIfAborted();
    try { await checkedDirectory(options); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const results = [];
    for (const file of (await fs.readdir(directory)).sort()) {
      if (!file.endsWith('.json')) continue;
      const session = validateSessionName(file.slice(0, -5));
      const data = await readSession(session, options);
      results.push({ session, origin: data.origin, savedAt: data.savedAt, cookieCount: data.cookies.length,
        activeCookieCount: data.cookies.filter(cookie => cookie.expires === null || cookie.expires > Date.now() / 1000).length });
    }
    return results;
  } catch (error) { rethrow(error, 'could not list saved sessions', options.signal); }
}
async function logout(name, options = {}) {
  const file = sessionFile(name, options);
  try {
    options.signal?.throwIfAborted();
    try { await checkedDirectory(options); } catch (error) { if (error.code === 'ENOENT') return { session: name, removed: false }; throw error; }
    try { await fs.unlink(file); return { session: name, removed: true }; }
    catch (error) { if (error.code === 'ENOENT') return { session: name, removed: false }; throw error; }
  } catch (error) { rethrow(error, 'could not remove saved session', options.signal); }
}

module.exports = { validateSessionName, sessionDirectory, readSession, saveSession, loadSessionJar, listSessions, logout };
