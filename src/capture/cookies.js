'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { isIP } = require('node:net');
const { FetcharyValidationError, FetcharyFetchError } = require('../errors');

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_COOKIES = 3000;
const fail = message => { throw new FetcharyValidationError(message); };
const hostname = url => new URL(url).hostname.toLowerCase().replace(/\.$/, '');

function normalizeCookie(input, index, source) {
  const invalid = () => fail(`invalid ${source} entry ${index + 1}`);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const { name, value } = input;
  if (typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || name.length + value.length > 4096) return invalid();
  if (value === '"') return invalid();
  const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  if (!/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(unquoted)) return invalid();
  if (input.partitionKey != null || input.partitioned === true) fail(`partitioned cookies are not supported by ${source}`);
  for (const field of ['hostOnly','secure','httpOnly','session']) if (input[field] !== undefined && typeof input[field] !== 'boolean') return invalid();
  if (typeof input.domain !== 'string' || !input.domain || /[\s/@?#\\]/.test(input.domain)) return invalid();
  let domain; const rawDomain = input.domain.replace(/^\./, '').replace(/\.$/, '');
  try {
    const url = new URL(`http://${rawDomain}`);
    if (url.port || url.pathname !== '/') return invalid();
    domain = hostname(url);
  } catch { return invalid(); }
  const ip = isIP(domain.replace(/^\[|\]$/g, ''));
  if (!ip && !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return invalid();
  const hostOnly = ip ? true : input.hostOnly ?? !input.domain.startsWith('.');
  const path = input.path ?? '/';
  if (typeof path !== 'string' || !path.startsWith('/') || /[\x00-\x20\x7F]/.test(path)) return invalid();
  const secure = input.secure ?? false; const httpOnly = input.httpOnly ?? false;
  if (name.startsWith('__Secure-') && !secure || name.startsWith('__Host-') && (!secure || !hostOnly || path !== '/')) return invalid();
  const expiration = input.expirationDate ?? input.expires;
  let expires = null;
  if (!input.session && expiration !== undefined && expiration !== -1) {
    if (typeof expiration !== 'number' || !Number.isFinite(expiration) || expiration < 0 || expiration > 253402300799) return invalid();
    expires = Math.floor(expiration);
  }
  const sameSiteValues = { strict:'Strict', lax:'Lax', none:'None', no_restriction:'None', unspecified:undefined };
  const key = typeof input.sameSite === 'string' ? input.sameSite.toLowerCase() : undefined;
  if (input.sameSite !== undefined && (key === undefined || !Object.hasOwn(sameSiteValues, key))) return invalid();
  const sameSite = key === undefined ? undefined : sameSiteValues[key];
  if (sameSite === 'None' && !secure) return invalid();
  return { name, value, domain, hostOnly, path, secure, httpOnly, expires, ...(sameSite ? { sameSite } : {}) };
}

function parseCookieFile(text) {
  text = text.replace(/^\uFEFF/, '');
  let entries;
  if (/^[\s]*[\[{]/.test(text)) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { fail('cookieFile contains invalid JSON'); }
    entries = Array.isArray(parsed) ? parsed : parsed?.cookies;
    if (!Array.isArray(entries)) fail('cookieFile JSON must be an array or an object containing cookies');
  } else {
    entries = [];
    for (let line of text.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#') && !line.startsWith('#HttpOnly_')) continue;
      const httpOnly = line.startsWith('#HttpOnly_');
      if (httpOnly) line = line.slice(10);
      const fields = line.split('\t');
      if (fields.length !== 7 || !['TRUE','FALSE'].includes(fields[1]) || !['TRUE','FALSE'].includes(fields[3]) || !/^\d+$/.test(fields[4])) fail('cookieFile must use the Netscape tab-separated format or JSON');
      entries.push({ domain:fields[0], hostOnly:fields[1] === 'FALSE', path:fields[2], secure:fields[3] === 'TRUE',
        expires:Number(fields[4]), session:Number(fields[4]) === 0, name:fields[5], value:fields[6], httpOnly });
    }
  }
  return normalizeCookies(entries);
}

function normalizeCookies(entries, source = 'cookieFile') {
  if (entries.length > MAX_COOKIES) fail(`${source} exceeds ${MAX_COOKIES} cookies`);
  const unique = new Map();
  entries.forEach((entry, index) => {
    const cookie = normalizeCookie(entry, index, source);
    unique.set(JSON.stringify([cookie.domain,cookie.hostOnly,cookie.path,cookie.name]), cookie);
  });
  return [...unique.values()];
}

function createCookieJar(cookies, requestedUrl, source = 'cookieFile') {
  const root = hostname(requestedUrl);
  const allows = url => { const host = hostname(url); return host === root || host.endsWith(`.${root}`); };
  // Only load credentials belonging to the requested hostname's tree. Parent
  // domain cookies may match it; unrelated exported sessions stay out entirely.
  const relevant = cookies.filter(cookie => cookie.expires === null || cookie.expires > Date.now() / 1000).filter(cookie =>
    cookie.domain === root || cookie.domain.endsWith(`.${root}`) || !cookie.hostOnly && root.endsWith(`.${cookie.domain}`));
  if (!relevant.length) fail(`${source} contains no unexpired cookies for the requested host`);
  return {
    allows,
    header(url) {
      if (!allows(url)) return '';
      const target = new URL(url); const host = hostname(target);
      return relevant.filter(cookie => (cookie.expires === null || cookie.expires > Date.now() / 1000)
        && (!cookie.secure || target.protocol === 'https:')
        && (host === cookie.domain || !cookie.hostOnly && host.endsWith(`.${cookie.domain}`))
        && (target.pathname === cookie.path || target.pathname.startsWith(cookie.path) && (cookie.path.endsWith('/') || target.pathname[cookie.path.length] === '/')))
        .sort((a,b) => b.path.length - a.path.length).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    },
    browserCookies() {
      return relevant.filter(cookie => cookie.expires === null || cookie.expires > Date.now() / 1000).map(cookie => ({
        name:cookie.name, value:cookie.value, domain:cookie.hostOnly ? cookie.domain : `.${cookie.domain}`,
        path:cookie.path, secure:cookie.secure, httpOnly:cookie.httpOnly,
        ...(cookie.expires === null ? {} : { expires:cookie.expires }), ...(cookie.sameSite ? {sameSite:cookie.sameSite} : {}),
      }));
    },
  };
}

async function loadCookieJar(file, url, signal) {
  let handle;
  try {
    signal?.throwIfAborted();
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) fail('cookieFile must be a regular file');
    if (stat.size > MAX_FILE_BYTES) fail('cookieFile exceeds 1 MiB');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1); let length = 0;
    while (length < buffer.length) {
      signal?.throwIfAborted();
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    signal?.throwIfAborted();
    if (length > MAX_FILE_BYTES) fail('cookieFile exceeds 1 MiB');
    return createCookieJar(parseCookieFile(buffer.toString('utf8',0,length)), url);
  } catch (error) {
    if (signal?.aborted) throw new FetcharyFetchError('extraction aborted', {cause:signal.reason});
    if (error instanceof FetcharyValidationError) throw error;
    // Native errors and JSON parse errors can include paths or cookie values.
    throw new FetcharyValidationError('could not read cookieFile', {code:error.code});
  } finally { await handle?.close().catch(() => {}); }
}

module.exports = { parseCookieFile, normalizeCookies, createCookieJar, loadCookieJar };
