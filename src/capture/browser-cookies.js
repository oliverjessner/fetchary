'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { createDecipheriv, createHash, pbkdf2, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { normalizeCookies, createCookieJar } = require('./cookies');
const { FetcharyValidationError, FetcharyFetchError } = require('../errors');

const deriveKey = promisify(pbkdf2);
const CHROME_EPOCH = 11644473600n;
const fail = message => { throw new FetcharyValidationError(message); };

function profileDirectory(profile, home) {
  if (profile && path.isAbsolute(profile)) return profile;
  return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', profile || 'Default');
}

async function cookieDatabase(profile) {
  // Chrome versions use either location. Do not create a missing database.
  for (const parts of [['Network', 'Cookies'], ['Cookies']]) {
    const file = path.join(profile, ...parts);
    let handle;
    try {
      // SQLite collapses access-denied errors into CANTOPEN. Check a read-only
      // descriptor first so macOS privacy denials have an actionable message.
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 256 * 1024 * 1024) fail('Chrome cookie database must be a regular file no larger than 256 MiB');
      return file;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (['EACCES', 'EPERM'].includes(error.code)) fail('macOS denied access to Chrome cookies; check Privacy & Security permissions for the terminal/app running Fetchary, or use --cookies');
      throw error;
    } finally { await handle?.close().catch(() => {}); }
  }
  fail('Chrome cookie database not found; select its profile directory with browserProfile/--browser-profile');
}

function readCookies(file, requestedUrl, timeout) {
  const { DatabaseSync } = require('node:sqlite');
  let db;
  try {
    db = new DatabaseSync(file, { readOnly:true, timeout:Math.min(timeout ?? 30000, 1000), allowExtension:false });
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; PRAGMA temp_store = MEMORY; BEGIN');
    const version = Number(db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value);
    if (!Number.isInteger(version) || version < 15 || version > 24) fail('unsupported Chrome cookie database version; use an exported --cookies file');
    const host = new URL(requestedUrl).hostname.toLowerCase().replace(/\.$/, '');
    const domains = [host];
    const labels = host.split('.');
    for (let index = 0; index < labels.length; index++) domains.push(`.${labels.slice(index).join('.')}`);
    const suffix = `.${host}`;
    const now = (BigInt(Date.now()) * 1000n) + CHROME_EPOCH * 1000000n;
    // Filter before selecting/decrypting values. A profile can contain thousands
    // of unrelated sessions; partitioned cookies must never become unpartitioned.
    const selection = `FROM cookies
      WHERE (host_key IN (${domains.map(() => '?').join(',')}) OR substr(host_key, -?) = ?)
        AND top_frame_site_key = '' AND (has_expires = 0 OR expires_utc > ?)`;
    const parameters = [...domains, suffix.length, suffix, now];
    const size = db.prepare(`SELECT count(*) AS count,
      sum(coalesce(length(CAST(host_key AS BLOB)), 0) + coalesce(length(CAST(path AS BLOB)), 0)
        + coalesce(length(CAST(name AS BLOB)), 0) + coalesce(length(CAST(value AS BLOB)), 0)
        + coalesce(length(encrypted_value), 0)) AS bytes
      FROM (SELECT host_key, path, name, value, encrypted_value ${selection} LIMIT 3001)`).get(...parameters);
    if (size.count > 3000) fail('browser cookies exceed 3000 matching entries');
    if (size.bytes > 1024 * 1024) fail('matching browser cookies exceed 1 MiB');
    const statement = db.prepare(`SELECT host_key, name, value, encrypted_value, path, expires_utc,
      is_secure, is_httponly, samesite, has_expires ${selection} ORDER BY creation_utc, rowid LIMIT 3001`);
    statement.setReadBigInts(true);
    const rows = statement.all(...parameters);
    return {version, rows};
  } finally { db?.close(); }
}

function keychainPassword(signal, timeout) {
  return new Promise((resolve, reject) => {
    childProcess.execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'],
      {encoding:'buffer', maxBuffer:16 * 1024, timeout, signal}, (error, stdout) => {
        // Native errors include stderr and sometimes command output. Never attach
        // them as a cause or print them, including when access is denied.
        if (error || !stdout?.length) {
          stdout?.fill(0);
          return reject(new FetcharyValidationError('could not read Chrome Safe Storage from the macOS Keychain; allow access or use --cookies'));
        }
        const password = Buffer.from(stdout.subarray(0, stdout.at(-1) === 10 ? -1 : undefined));
        stdout.fill(0);
        if (!password.length) return reject(new FetcharyValidationError('Chrome Safe Storage returned an empty key'));
        resolve(password);
      });
  });
}

function decryptValue(row, version, key) {
  const encrypted = Buffer.from(row.encrypted_value);
  if (!encrypted.length) return row.value;
  if (row.value || encrypted.subarray(0, 3).toString('ascii') !== 'v10'
    || encrypted.length < 19 || (encrypted.length - 3) % 16) fail('unsupported or invalid encrypted Chrome cookie; use --cookies');
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
    plaintext = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    if (version >= 24) {
      const digest = createHash('sha256').update(row.host_key).digest();
      if (plaintext.length < 32 || !timingSafeEqual(digest, plaintext.subarray(0, 32))) fail('Chrome cookie domain verification failed');
    }
    return new TextDecoder('utf-8', {fatal:true}).decode(plaintext.subarray(version >= 24 ? 32 : 0));
  } catch (error) {
    if (error instanceof FetcharyValidationError) throw error;
    fail('could not decrypt Chrome cookies; check Keychain access or use --cookies');
  } finally { plaintext?.fill(0); encrypted.fill(0); }
}

async function loadBrowserCookieJar(settings, requestedUrl, dependencies = {}) {
  const {signal} = settings;
  let key; let password; let rows;
  try {
    signal?.throwIfAborted();
    if ((dependencies.platform ?? process.platform) !== 'darwin') fail('cookiesFromBrowser currently supports Chrome on macOS only; use --cookies on this platform');
    const directory = profileDirectory(settings.browserProfile, dependencies.home ?? os.homedir());
    const file = await cookieDatabase(directory);
    signal?.throwIfAborted();
    const loaded = readCookies(file, requestedUrl, settings.timeout); rows = loaded.rows;
    signal?.throwIfAborted();
    if (rows.some(row => row.encrypted_value.length)) {
      // Fail before prompting for unsupported encryption formats.
      if (rows.some(row => row.encrypted_value.length && Buffer.from(row.encrypted_value).subarray(0, 3).toString('ascii') !== 'v10')) fail('unsupported Chrome cookie encryption; use --cookies');
      password = await (dependencies.readPassword || keychainPassword)(signal, Math.min(settings.timeout ?? 30000, 30000));
      signal?.throwIfAborted();
      key = await deriveKey(password, 'saltysalt', 1003, 16, 'sha1');
    }
    const entries = rows.map(row => ({
      name:row.name, value:decryptValue(row, loaded.version, key), domain:row.host_key, path:row.path,
      hostOnly:!row.host_key.startsWith('.'), secure:row.is_secure === 1n, httpOnly:row.is_httponly === 1n,
      session:row.has_expires === 0n,
      expires:row.has_expires === 0n ? -1 : Number(row.expires_utc / 1000000n - CHROME_EPOCH),
      sameSite:({0:'None', 1:'Lax', 2:'Strict'})[String(row.samesite)],
    }));
    signal?.throwIfAborted();
    return createCookieJar(normalizeCookies(entries, 'browser cookies'), requestedUrl, 'Chrome profile');
  } catch (error) {
    if (signal?.aborted) throw new FetcharyFetchError('extraction aborted', {cause:signal.reason});
    if (error instanceof FetcharyValidationError) throw error;
    fail('could not read Chrome cookies; check the profile and permissions, or close Chrome and retry');
  } finally {
    key?.fill(0); password?.fill(0);
    for (const row of rows || []) row.encrypted_value?.fill(0);
  }
}

module.exports = { loadBrowserCookieJar, profileDirectory };
