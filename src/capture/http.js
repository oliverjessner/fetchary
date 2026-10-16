'use strict';

const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { validateRemoteUrl } = require('../utils/url');
const { FetcharyFetchError, FetcharyValidationError } = require('../errors');
// Only sockets established by this transport enter these pools. Keep trusted
// local development separate from the default public-network policy.
const agents = new Map([false, true].map(trusted => [trusted, {
  http: new http.Agent({ keepAlive: true, maxSockets: 16 }),
  https: new https.Agent({ keepAlive: true, maxSockets: 16 }),
}]));

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readBody(response, maxBytes, signal) {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('response exceeds maxResponseBytes');
  const chunks = [];
  let length = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await abortable(reader.read(), signal);
        if (part.done) break;
        length += part.value.length;
        if (length > maxBytes) throw new Error('response exceeds maxResponseBytes');
        chunks.push(Buffer.from(part.value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else if (response.body) {
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      length += chunk.length;
      if (length > maxBytes) throw new Error('response exceeds maxResponseBytes');
      chunks.push(Buffer.from(chunk));
    }
  } else {
    const body = Buffer.from(await abortable(response.arrayBuffer(), signal));
    if (body.length > maxBytes) throw new Error('response exceeds maxResponseBytes');
    chunks.push(body); length = body.length;
  }
  return Buffer.concat(chunks, length);
}

function nativeResponse(target, options, signal, addresses) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const lookup = addresses && ((hostname, settings, callback) => settings.all
      ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family));
    const request = transport.request(target, { method: options.method || 'GET', headers: options.headers, signal,
      ...(lookup ? { lookup } : {}), agent: agents.get(Boolean(options.allowPrivateNetwork))[target.protocol === 'https:' ? 'https' : 'http'] }, response => {
      const headers = new Headers();
      for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i], response.rawHeaders[i+1]);
      let body = response;
      const encoding = headers.get('content-encoding');
      if (/^(gzip|deflate|br)$/i.test(encoding || '')) {
        const decoder = encoding.toLowerCase() === 'br' ? zlib.createBrotliDecompress() : encoding.toLowerCase() === 'gzip' ? zlib.createGunzip() : zlib.createInflate();
        response.on('error', error => decoder.destroy(error));
        body = response.pipe(decoder);
      }
      resolve({ status: response.statusCode, headers, body, url: target.href,
        close: () => { body.destroy(); response.destroy(); } });
    });
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function readResource(url, options, maxBytes = options.maxResponseBytes) {
  maxBytes = Math.min(maxBytes, options.maxResponseBytes);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request timed out')), options.timeout);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let response;
  try {
    let headers = new Headers(options.headers);
    if (options.headerOrigin && new URL(url).origin !== options.headerOrigin) {
      for (const name of options.scopedHeaderNames || []) headers.delete(name);
    }
    headers.set('user-agent', options.userAgent);
    headers.set('accept-encoding', 'identity');
    let target = url;
    let method = options.method || 'GET';
    let body = options.body;
    for (let redirects = 0; redirects <= 10; redirects++) {
      signal.throwIfAborted();
      const checked = await abortable(validateRemoteUrl(target, options), signal);
      response = await abortable(options.fetch
        ? options.fetch(checked.url.href, { headers: Object.fromEntries(headers), redirect: 'manual', signal, method, ...(body ? { body } : {}) })
        : nativeResponse(checked.url, { headers: Object.fromEntries(headers), method, body, allowPrivateNetwork: options.allowPrivateNetwork }, signal, checked.addresses), signal);
      if (!response || !Number.isInteger(response.status)) throw new Error('fetch returned an invalid response');
      if (response.url && response.url !== checked.url.href) await abortable(validateRemoteUrl(response.url, options), signal);
      const location = response.headers?.get?.('location');
      if (options.followRedirects !== false && [301,302,303,307,308].includes(response.status) && location) {
        const next = new URL(location, checked.url);
        if (next.origin !== checked.url.origin) {
          for (const name of new Set(['authorization','cookie','proxy-authorization', ...(options.scopedHeaderNames || [])])) headers.delete(name);
        }
        if (response.status === 303 || ([301,302].includes(response.status) && method === 'POST')) { method = 'GET'; body = undefined; }
        response.close?.(); await response.body?.cancel?.().catch(() => {});
        target = next.href;
        continue;
      }
      if (options.followRedirects !== false && (response.status < 200 || response.status >= 300)) throw new FetcharyFetchError(`fetch failed with HTTP ${response.status}`, { url, status: response.status });
      const responseHeaders = response.headers instanceof Headers ? response.headers : new Headers();
      const payload = await abortable(readBody({ body: response.body, arrayBuffer: () => response.arrayBuffer(), headers: responseHeaders }, maxBytes, signal), signal);
      signal.throwIfAborted();
      return { body: payload, url: response.url || checked.url.href, status: response.status, headers: responseHeaders,
        contentType: responseHeaders.get('content-type') || null };
    }
    throw new Error('too many redirects');
  } catch (cause) {
    if (cause instanceof FetcharyFetchError || cause instanceof FetcharyValidationError) throw cause;
    throw new FetcharyFetchError(`could not fetch ${url}: ${cause.message}`, { url, cause });
  } finally {
    clearTimeout(timer);
    response?.close?.();
    await response?.body?.cancel?.().catch(() => {});
  }
}

function decodeBody(body, contentType) {
  const charset = contentType?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]
    || body.toString('ascii', 0, 2048).match(/<meta\b[^>]*charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(body); } catch { return body.toString('utf8'); }
}

async function captureHttp(options) {
  const response = await readResource(options.url, options, options.maxResponseBytes);
  return {
    requestedUrl: options.url, rawFinalUrl: response.url, status: response.status, contentType: response.contentType,
    rawBody: response.body, rawHtml: decodeBody(response.body, response.contentType), rawCapturedAt: new Date().toISOString(),
    etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'),
    cacheable: response.status !== 206 && !response.headers.get('content-range') && !response.headers.get('set-cookie')
      && !/\b(?:private|no-store|no-cache)\b/i.test(response.headers.get('cache-control') || ''),
  };
}

module.exports = { captureHttp, readResource, decodeBody, abortable };
