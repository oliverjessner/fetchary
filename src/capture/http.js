'use strict';

const { FetcharyFetchError } = require('../errors');

async function captureHttp(options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout);
  let response;
  try {
    response = await options.fetch(options.url, {
      headers: { 'user-agent': options.userAgent },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response || typeof response.arrayBuffer !== 'function') throw new TypeError('fetch returned an invalid response');
    if (!response.ok) {
      throw new FetcharyFetchError(`fetch failed with HTTP ${response.status}`, {
        sourceId: options.sourceId,
        url: options.url,
        status: response.status,
      });
    }
    const rawBody = Buffer.from(await response.arrayBuffer());
    return {
      requestedUrl: options.url,
      rawFinalUrl: response.url || options.url,
      status: Number(response.status),
      contentType: response.headers?.get?.('content-type') || null,
      rawBody,
      rawCapturedAt: new Date().toISOString(),
      etag: response.headers?.get?.('etag') || null,
      lastModified: response.headers?.get?.('last-modified') || null,
    };
  } catch (cause) {
    if (cause instanceof FetcharyFetchError) throw cause;
    throw new FetcharyFetchError(`fetch failed for ${options.url}`, {
      sourceId: options.sourceId,
      url: options.url,
      cause,
    });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { captureHttp };
