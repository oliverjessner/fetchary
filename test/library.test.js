'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  createFetchary,
  parseInterval,
  FetcharyFetchError,
  FetcharyIntervalError,
  FetcharyNotFoundError,
  FetcharyRunnerError,
  FetcharyValidationError,
} = require('../src');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('archives exact response bytes, hashes them, and only creates changed versions', async t => {
  const dataDir = tempDir(t);
  const first = Buffer.from([0x3c, 0x68, 0x31, 0x3e, 0xc3, 0xa4, 0x3c, 0x2f, 0x68, 0x31, 0x3e, 0x0a]);
  const second = Buffer.from('<h1>changed</h1>\n');
  let body = first;
  const requests = [];
  const fetchary = await createFetchary({
    dataDir,
    timeout: 500,
    userAgent: 'fetchary-test/1',
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', etag: '"one"', 'last-modified': 'Mon, 31 Aug 2026 08:12:00 GMT' },
      });
    },
  });
  t.after(() => fetchary.close());

  const events = { fetch: 0, change: 0, version: 0 };
  for (const name of Object.keys(events)) fetchary.on(name, () => events[name]++);

  const source = await fetchary.add('https://example.com/page', { name: 'Page', tag: 'research' });
  assert.equal(source.version, 1);
  assert.equal(source.changed, true);
  assert.equal(source.versions, 1);
  const archived = await fetchary.version(source.id);
  assert.deepEqual(fs.readFileSync(archived.file), first);
  assert.equal(archived.hash, crypto.createHash('sha256').update(first).digest('hex'));
  assert.equal(archived.contentLength, first.length);
  assert.equal(archived.etag, '"one"');
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(archived.file), 'metadata.json'))).sha256, archived.hash);

  const unchanged = await fetchary.fetch(source.id);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.version, 1);
  assert.equal((await fetchary.history(source.id)).length, 1);

  body = second;
  const changed = await fetchary.fetch(source.id);
  assert.equal(changed.changed, true);
  assert.equal(changed.version, 2);
  assert.equal(changed.previousHash, archived.hash);
  assert.deepEqual(fs.readFileSync((await fetchary.version(source.id, 2)).file), second);
  assert.deepEqual(events, { fetch: 3, change: 2, version: 2 });
  assert.equal(requests[0].init.headers['user-agent'], 'fetchary-test/1');

  const diff = await fetchary.diff(source.id);
  assert.equal(diff.from, 1);
  assert.equal(diff.to, 2);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.diff.map(item => item.type), ['removed', 'added']);
});

test('source lifecycle, filtering, pagination, export, and removal use the public API', async t => {
  const dataDir = tempDir(t);
  const output = tempDir(t);
  const calls = [];
  const fetchary = await createFetchary({
    dataDir,
    fetch: async url => {
      calls.push(String(url));
      return new Response(`<p>${url}</p>`, { status: 200, headers: { 'content-type': 'text/html' } });
    },
  });
  t.after(() => fetchary.close());

  const one = await fetchary.add('https://example.com/one', { tag: 'a' });
  const two = await fetchary.add('https://example.com/two', { tag: 'b' });
  assert.deepEqual((await fetchary.list({ tag: 'a' })).map(item => item.id), [one.id]);
  assert.equal((await fetchary.edit(one.id, { name: 'One', tag: null })).name, 'One');
  await assert.rejects(() => fetchary.edit(one.id, {}), FetcharyValidationError);

  await fetchary.disable(two.id);
  const before = calls.length;
  const all = await fetchary.fetch();
  assert.deepEqual(all.map(item => item.id), [one.id]);
  assert.equal(calls.length, before + 1);
  await fetchary.fetch(two.id);
  assert.equal(calls.length, before + 2, 'an explicitly selected disabled source can still be fetched');
  assert.equal((await fetchary.enable(two.id)).enabled, true);

  const page = await fetchary.history(one.id, { limit: 1, offset: 0 });
  assert.equal(page.length, 1);
  assert.match(await fetchary.read(one.id), /example\.com\/one/);
  const exported = await fetchary.export(one.id, { output });
  assert.equal(exported.versions, 1);
  assert.equal(fs.existsSync(path.join(exported.directory, 'metadata.json')), true);
  assert.equal(fs.existsSync(path.join(exported.directory, 'hashes.txt')), true);
  assert.deepEqual(fs.readFileSync(path.join(exported.directory, 'versions', '001.html')), fs.readFileSync((await fetchary.version(one.id)).file));

  const archiveDir = path.join(dataDir, 'pages', String(one.id));
  await fetchary.remove(one.id);
  assert.equal(fs.existsSync(archiveDir), true);
  await assert.rejects(() => fetchary.get(one.id), FetcharyNotFoundError);
  assert.equal((await fetchary.history(one.id)).length, 1, 'kept archives remain readable');
  assert.match(await fetchary.read(one.id), /example\.com\/one/);
  assert.deepEqual((await fetchary.list()).map(item => item.id), [two.id]);
  await fetchary.remove(one.id, { purge: true });
  assert.equal(fs.existsSync(archiveDir), false);

  await fetchary.remove(two.id, { purge: true });
  assert.equal(fs.existsSync(path.join(dataDir, 'pages', String(two.id))), false);
  await assert.rejects(() => fetchary.get(two.id), FetcharyNotFoundError);
});

test('fetch failures are typed, emit events, and failed adds do not leave sources', async t => {
  const dataDir = tempDir(t);
  let errorEvent;
  let conventionalError;
  const fetchary = await createFetchary({
    dataDir,
    fetch: async () => new Response('unavailable', { status: 503 }),
    hooks: { beforeFetch: async () => { throw new Error('ignored hook failure'); }, onError: async () => { throw new Error('ignored hook failure'); } },
  });
  t.after(() => fetchary.close());
  fetchary.on('fetch:error', event => { errorEvent = event; });
  fetchary.on('error', error => { conventionalError = error; });

  await assert.rejects(() => fetchary.add('https://example.com/fail'), error => {
    assert.equal(error instanceof FetcharyFetchError, true);
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal(errorEvent.error.status, 503);
  assert.equal(conventionalError, errorEvent.error);
  assert.deepEqual(await fetchary.list(), []);
});

test('package exposes its documented named API to ES modules', async () => {
  const imported = await import('fetchary');
  for (const name of [
    'createFetchary',
    'Fetchary',
    'FetcharyError',
    'FetcharyFetchError',
    'FetcharyNotFoundError',
    'FetcharyIntervalError',
    'FetcharyStorageError',
    'FetcharyValidationError',
    'FetcharyRunnerError',
  ]) assert.equal(typeof imported[name], 'function', name);
});

test('interval parsing, persistent schedules, due execution, and runner lock', async t => {
  const dataDir = tempDir(t);
  assert.deepEqual(parseInterval('15m'), { every: '15m', intervalSeconds: 900 });
  assert.deepEqual(parseInterval('2h'), { every: '2h', intervalSeconds: 7200 });
  assert.deepEqual(parseInterval('3d'), { every: '3d', intervalSeconds: 259200 });
  assert.throws(() => parseInterval('30s'), FetcharyIntervalError);

  let body = 'first';
  const fetchary = await createFetchary({ dataDir, fetch: async () => new Response(body) });
  const other = await createFetchary({ dataDir, fetch: async () => new Response(body) });
  t.after(() => Promise.all([fetchary.close(), other.close()]));
  const source = await fetchary.add('https://example.com/scheduled');
  const schedule = await fetchary.schedule(source.id, '1m');
  assert.equal(schedule.intervalSeconds, 60);
  assert.equal((await fetchary.schedules())[0].every, '1m');

  const database = new DatabaseSync(path.join(dataDir, 'fetchary.sqlite'));
  database.prepare('UPDATE schedules SET next_fetch_at = ? WHERE url_id = ?').run('2000-01-01T00:00:00.000Z', source.id);
  database.close();
  body = 'second';
  const changed = new Promise(resolve => fetchary.once('change', resolve));
  const runner = await fetchary.run({ pollInterval: 10 });
  await assert.rejects(() => other.run({ pollInterval: 10 }), FetcharyRunnerError);
  const event = await Promise.race([
    changed,
    new Promise((_, reject) => setTimeout(() => reject(new Error('scheduler timed out')), 1_000)),
  ]);
  assert.equal(event.version, 2);
  await runner.stop();
  assert.equal((await fetchary.schedules())[0].lastRunAt != null, true);
  await fetchary.unschedule(source.id);
  assert.deepEqual(await fetchary.schedules(), []);
});
