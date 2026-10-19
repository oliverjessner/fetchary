'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const zlib = require('node:zlib');
const { browserRequestBodies } = require('../src/capture/browser-request-body');
const api = require('../src');

test('browser request bodies retain exact binary bytes and synchronize late CDP metadata', async () => {
  const signal = new AbortController().signal;
  const session = new EventEmitter(); let detached = false;
  const bytes = zlib.gzipSync(Buffer.from(JSON.stringify({ continuation: 'Grüße 👋' })));
  const event = { requestId: 'request', request: { hasPostData: true, postDataEntries: [{ bytes: bytes.toString('base64') }] } };
  session.send = async method => assert.equal(method, 'Network.enable');
  session.detach = async () => { detached = true; };
  const bodies = await browserRequestBodies({ createCDPSession: async () => session }, signal);
  const request = { id: 'request', hasPostData: () => true, headers: () => ({ 'content-encoding': 'gzip' }), postData: () => bytes.toString('utf8') };
  const pending = bodies.read(request);
  setImmediate(() => session.emit('Network.requestWillBeSent', event));
  assert.deepEqual(await pending, bytes);
  await bodies.close(); assert.equal(detached, true); assert.equal(session.listenerCount('Network.requestWillBeSent'), 0);
});

test('aborted body reads stop waiting and never create late protocol commands', async () => {
  const controller = new AbortController(); const session = new EventEmitter(); let commands = 0;
  session.send = async method => { assert.equal(method, 'Network.enable'); commands++; };
  session.detach = async () => {};
  const bodies = await browserRequestBodies({ createCDPSession: async () => session }, controller.signal);
  const request = { id: 'pending', hasPostData: () => true, headers: () => ({}) };
  const pending = bodies.read(request);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(bodies.read(request), { name: 'AbortError' });
  assert.equal(commands, 1); await bodies.close();
});

test('empty HTML form navigation keeps its empty payload without querying a paused upload', async () => {
  const session = new EventEmitter(); session.send = async () => {}; session.detach = async () => {};
  const bodies = await browserRequestBodies({ createCDPSession: async () => session }, new AbortController().signal);
  session.emit('Network.requestWillBeSent', { requestId: 'empty', request: { hasPostData: true } });
  const result = await bodies.read({ id: 'empty', hasPostData: () => true, isNavigationRequest: () => true, method: () => 'POST',
    headers: () => ({ 'content-type': 'application/x-www-form-urlencoded' }), fetchPostData: () => assert.fail('empty form has no upload to retrieve') });
  assert.deepEqual(result, Buffer.alloc(0)); await bodies.close();
});

test('text requests work with custom browser implementations while missing binary data fails without leaking payloads', async () => {
  const bodies = await browserRequestBodies({}, new AbortController().signal);
  assert.equal(await bodies.read({ hasPostData: () => false }), undefined);
  assert.equal(await bodies.read({ headers: () => ({}), postData: () => 'name=example' }), 'name=example');
  assert.equal(await bodies.read({ headers: () => ({}), hasPostData: () => true, fetchPostData: async () => '{"value":1}' }), '{"value":1}');
  for (const headers of [{ 'content-encoding': 'gzip' }, { 'content-type': 'multipart/form-data; boundary=fixture' }]) {
    await assert.rejects(bodies.read({ headers: () => headers, hasPostData: () => true, postData: () => 'PRIVATE_PAYLOAD' }), error =>
      error instanceof api.FetcharyBrowserError && error.phase === 'resource' && !error.message.includes('PRIVATE_PAYLOAD') && !error.cause);
  }
  await bodies.close();
});

test('real Chromium forwards gzip POST bytes through guarded native HTTP without corrupting JSON', async t => {
  let received;
  const payload = JSON.stringify({ continuation: 'fixture', text: 'Grüße 👋' });
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><h2 id="count">Loading</h2><script>
    (async () => {
      const body = await new Response(new Blob([${JSON.stringify(payload)}]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      const response = await fetch('/next', {method:'POST', headers:{'content-type':'application/json','content-encoding':'gzip'}, body});
      document.querySelector('#count').textContent = (await response.json()).comments + ' Kommentare';
    })();
  </script></body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === '/next') {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        received = Buffer.concat(chunks);
        let valid = false;
        try { valid = request.headers['content-encoding'] === 'gzip' && zlib.gunzipSync(received).toString('utf8') === payload; } catch {}
        response.writeHead(valid ? 200 : 400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ comments: valid ? 14 : null }));
      }); return;
    }
    response.writeHead(200, { 'content-type': 'text/html' }); response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await api.extractHtml(`http://127.0.0.1:${server.address().port}/`, { mode: 'browser', allowPrivateNetwork: true, waitAfterLoad: 600, timeout: 15000 });
  assert.ok(Buffer.isBuffer(received)); assert.equal(zlib.gunzipSync(received).toString('utf8'), payload);
  assert.match(result.data, />14 Kommentare<\/h2>/);
});
