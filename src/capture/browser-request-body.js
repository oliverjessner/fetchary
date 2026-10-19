'use strict';
const { abortable } = require('./http');
const { FetcharyBrowserError } = require('../errors');

async function browserRequestBodies(page, signal) {
  signal.throwIfAborted();
  const bodies = new Map();
  const waiting = new Map();
  const session = typeof page.createCDPSession === 'function' ? await abortable(page.createCDPSession(), signal) : null;
  const received = event => {
    if (!event.request.hasPostData) return;
    bodies.set(event.requestId, event.request);
    waiting.get(event.requestId)?.(event.request);
  };
  if (session) {
    session.on('Network.requestWillBeSent', received);
    try { await abortable(session.send('Network.enable'), signal); } catch (error) {
      session.off('Network.requestWillBeSent', received);
      await session.detach().catch(() => {});
      throw error;
    }
  }
  const unavailable = () => { throw new FetcharyBrowserError('could not read complete browser request body', { phase: 'resource' }); };
  return {
    async read(request) {
      signal.throwIfAborted();
      if (request.hasPostData?.() === false) return undefined;
      let data = bodies.get(request.id);
      if (session && request.id !== undefined && !data && request.hasPostData?.()) {
        // Observer events can follow Puppeteer's paused-request event. Wait for
        // that metadata briefly; asking CDP for a paused upload can stall it.
        data = await new Promise(resolve => {
          const finish = value => {
            clearTimeout(timer);
            signal.removeEventListener('abort', aborted);
            waiting.delete(request.id);
            resolve(value);
          };
          const aborted = () => finish(undefined);
          const timer = setTimeout(() => finish(undefined), 250);
          waiting.set(request.id, finish);
          signal.addEventListener('abort', aborted, { once: true });
        });
        signal.throwIfAborted();
      }
      bodies.delete(request.id);
      if (data?.postDataEntries?.length) {
        if (data.postDataEntries.some(entry => typeof entry.bytes !== 'string')) return unavailable();
        return Buffer.concat(data.postDataEntries.map(entry => Buffer.from(entry.bytes, 'base64')));
      }
      // Puppeteer's postData() decodes as UTF-8 and corrupts compressed/binary
      // payloads. Never forward such a lossy string when exact bytes are absent.
      const headers = request.headers();
      if (headers['content-encoding'] && headers['content-encoding'] !== 'identity' ||
          /^(?:multipart\/|application\/octet-stream\b)/i.test(headers['content-type'] || '')) return unavailable();
      let text = data?.postData ?? request.postData?.();
      // Chromium marks an empty HTML form submission as hasPostData without
      // emitting payload entries. Querying that paused upload never completes.
      if (text === undefined && data && request.isNavigationRequest?.() && request.method() === 'POST' &&
          /^application\/x-www-form-urlencoded(?:;|$)/i.test(headers['content-type'] || '')) return Buffer.alloc(0);
      if (text === undefined && request.hasPostData?.() && typeof request.fetchPostData === 'function') {
        try { text = await abortable(request.fetchPostData(), signal); } catch {}
        signal.throwIfAborted();
      }
      if (request.hasPostData?.() && text === undefined) return unavailable();
      return text;
    },
    async close() {
      for (const finish of [...waiting.values()]) finish(undefined);
      bodies.clear();
      if (session) {
        session.off('Network.requestWillBeSent', received);
        await session.detach().catch(() => {});
      }
    },
  };
}

module.exports = { browserRequestBodies };
