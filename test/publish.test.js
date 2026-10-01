'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const { waitForPublishedTarball } = require('../scripts/publish');

const tarball = Buffer.from('published package bytes');
const sha256 = contents => crypto.createHash('sha256').update(contents).digest('hex');

test('publish polling bypasses cached 404s and uses a new cache key on every retry', async t => {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://registry.test');
    requests.push(url);
    // A cached bare URL never succeeds. The origin needs one more retry.
    if (!url.searchParams.has('fetchary-publish') || requests.length === 1) {
      response.writeHead(404, { 'cache-control': 'public, max-age=300' });
      response.end('Not found');
    } else {
      response.end(tarball);
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  await waitForPublishedTarball('1.1.0', sha256(tarball), {
    attempts: 2,
    delayMs: 0,
    fetch: (url, options) => {
      const target = new URL(url);
      return fetch(`${origin}${target.pathname}${target.search}`, options);
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].pathname, '/fetchary/-/fetchary-1.1.0.tgz');
  assert.notEqual(requests[0].search, requests[1].search);
});

test('publish polling retries transport failures and stops after the attempt limit', async () => {
  let requests = 0;
  await assert.rejects(waitForPublishedTarball('1.1.0', sha256(tarball), {
    attempts: 2,
    delayMs: 0,
    fetch: async () => {
      requests++;
      if (requests === 1) throw new Error('connection reset');
      return new Response('Not found', { status: 404 });
    },
  }), /after 2 attempts/);
  assert.equal(requests, 2);
});

test('publish polling rejects a different package immediately without retrying', async () => {
  let requests = 0;
  const otherTarball = Buffer.from('different published package');
  await assert.rejects(waitForPublishedTarball('1.1.0', sha256(tarball), {
    attempts: 2,
    delayMs: 0,
    fetch: async () => {
      requests++;
      return new Response(otherTarball);
    },
  }), error => error.message === `tarball SHA256 is ${sha256(otherTarball)}, expected ${sha256(tarball)}`);
  assert.equal(requests, 1);
});

test('publish polling times out a stalled download and retries it', async t => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests++;
    if (requests > 1) response.end(tarball);
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;

  await waitForPublishedTarball('1.1.0', sha256(tarball), {
    attempts: 2,
    delayMs: 0,
    timeoutMs: 250,
    fetch: (_, options) => fetch(url, options),
  });
  assert.equal(requests, 2);
});
