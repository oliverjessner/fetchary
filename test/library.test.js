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

test('archives exact response bytes and distinguishes raw from visible content changes', async t => {
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

  const events = { 'fetch:start': 0, fetch: 0, change: 0, version: 0 };
  for (const name of Object.keys(events)) fetchary.on(name, () => events[name]++);

  const source = await fetchary.add('https://example.com/page', { name: 'Page', tag: 'research', mode: 'http' });
  assert.equal(source.version, 1);
  assert.equal(source.changed, true);
  assert.equal(source.rawChanged, true);
  assert.equal(source.contentChanged, true);
  assert.equal(source.versions, 1);
  const archived = await fetchary.version(source.id);
  assert.deepEqual(fs.readFileSync(archived.file), first);
  assert.equal(archived.hash, crypto.createHash('sha256').update(first).digest('hex'));
  assert.equal(archived.contentLength, first.length);
  assert.equal(archived.etag, '"one"');
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(archived.file), 'metadata.json'))).sha256, archived.hash);

  const unchanged = await fetchary.fetch(source.id);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.rawChanged, false);
  assert.equal(unchanged.contentChanged, false);
  assert.equal(unchanged.version, 1);
  assert.equal((await fetchary.history(source.id)).length, 1);

  body = second;
  const changed = await fetchary.fetch(source.id);
  assert.equal(changed.changed, true);
  assert.equal(changed.rawChanged, true);
  assert.equal(changed.contentChanged, true);
  assert.equal(changed.version, 2);
  assert.equal(changed.previousHash, archived.hash);
  assert.deepEqual(fs.readFileSync((await fetchary.version(source.id, 2)).file), second);
  assert.deepEqual(events, { 'fetch:start': 3, fetch: 3, change: 2, version: 2 });
  assert.equal(requests[0].init.headers['user-agent'], 'fetchary-test/1');

  const diff = await fetchary.diff(source.id);
  assert.equal(diff.from, 1);
  assert.equal(diff.to, 2);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.diff.map(item => item.type), ['removed', 'added']);
  const elementContentDiff = await fetchary.diff(source.id, { mode: 'element-content' });
  assert.deepEqual(elementContentDiff.diff.map(item => item.value), ['<h1>ä</h1>', '<h1>changed</h1>']);
  const elementRawDiff = await fetchary.diff(source.id, { mode: 'element-raw' });
  assert.deepEqual(elementRawDiff.diff.map(item => item.value), ['<h1>ä</h1>', '<h1>changed</h1>']);
  const lastContentChange = (await fetchary.get(source.id)).lastChangedAt;

  body = Buffer.from('<h1>changed</h1><script nonce="dynamic">ignored</script>\n');
  const rawOnly = await fetchary.fetch(source.id);
  assert.equal(rawOnly.changed, false);
  assert.equal(rawOnly.rawChanged, true);
  assert.equal(rawOnly.contentChanged, false);
  assert.equal(rawOnly.version, 3);
  assert.equal((await fetchary.history(source.id)).length, 3);
  assert.equal((await fetchary.get(source.id)).lastChangedAt, lastContentChange);
  assert.equal((await fetchary.diff(source.id)).changed, false);
  assert.deepEqual(events, { 'fetch:start': 4, fetch: 4, change: 2, version: 3 });
});

test('ignore selectors filter comparisons without altering raw archived evidence', async t => {
  const dataDir = tempDir(t);
  const configuredSelectors = [' relative-time ', '.timestamp', '[data-updated]', '.does-not-exist', 'relative-time'];
  const originalSelectors = [...configuredSelectors];
  let body = Buffer.from('<p>Hello</p><relative-time>09:41</relative-time><div class="timestamp"><span>old</span></div><div data-updated>first</div>\n');
  const fetchary = await createFetchary({ dataDir, fetch: async () => new Response(body, { headers: { 'content-type': 'text/html' } }) });
  t.after(() => fetchary.close());
  const events = { change: 0, version: 0 };
  for (const name of Object.keys(events)) fetchary.on(name, () => events[name]++);

  const source = await fetchary.add('https://example.com/dynamic', { ignoreSelectors: configuredSelectors, mode: 'http' });
  assert.deepEqual(configuredSelectors, originalSelectors, 'caller array is not mutated');
  assert.deepEqual(source.ignoreSelectors, ['relative-time', '.timestamp', '[data-updated]', '.does-not-exist']);
  const first = await fetchary.version(source.id, 1);
  assert.deepEqual(fs.readFileSync(first.file), body);

  const secondBody = Buffer.from('<p>Hello</p><relative-time>09:43</relative-time><div class="timestamp"><span>new</span></div><div data-updated>second</div>\n');
  body = secondBody;
  const ignoredOnly = await fetchary.fetch(source.id);
  assert.equal(ignoredOnly.rawChanged, true);
  assert.equal(ignoredOnly.contentChanged, false);
  assert.equal(ignoredOnly.changed, false);
  assert.equal(ignoredOnly.version, 2);
  assert.notEqual(ignoredOnly.hash, first.hash);
  assert.equal((await fetchary.history(source.id)).length, 2);
  assert.deepEqual(fs.readFileSync((await fetchary.version(source.id, 2)).file), secondBody);
  assert.deepEqual(events, { change: 1, version: 2 });

  const textDiff = await fetchary.diff(source.id, { from: 1, to: 2 });
  assert.equal(textDiff.changed, false);
  assert.deepEqual(textDiff.diff, []);
  const rawDiff = await fetchary.diff(source.id, { from: 1, to: 2, mode: 'raw' });
  assert.equal(rawDiff.changed, true);
  assert.equal(rawDiff.diff.some(part => part.value.includes('<relative-time>09:41</relative-time>')), true);
  assert.equal(rawDiff.diff.some(part => part.value.includes('<relative-time>09:43</relative-time>')), true);

  body = Buffer.from('<p>Goodbye</p><relative-time>09:45</relative-time><div class="timestamp"><span>later</span></div><div data-updated>third</div>\n');
  const meaningful = await fetchary.fetch(source.id);
  assert.equal(meaningful.rawChanged, true);
  assert.equal(meaningful.contentChanged, true);
  assert.equal(meaningful.changed, true);
  const meaningfulDiff = await fetchary.diff(source.id, { from: 2, to: 3 });
  assert.equal(meaningfulDiff.changed, true);
  assert.deepEqual(meaningfulDiff.diff.map(part => part.value), ['Hello', 'Goodbye']);

  const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname((await fetchary.version(source.id, 3)).file), 'metadata.json')));
  assert.equal(metadata.sha256, meaningful.hash);
  assert.equal(metadata.comparisonSha256, meaningful.contentHash);
  assert.deepEqual(metadata.comparison.ignoreSelectors, source.ignoreSelectors);
});

test('ignore selector validation, replacement, clearing, and persistence use the public API', async t => {
  const dataDir = tempDir(t);
  let fetchCalls = 0;
  let body = '<p>Hello</p><relative-time>old</relative-time>';
  let fetchary = await createFetchary({
    dataDir,
    fetch: async () => {
      fetchCalls++;
      return new Response(body);
    },
  });
  t.after(async () => { await fetchary.close(); });

  await assert.rejects(
    () => fetchary.add('https://example.com/invalid', { ignoreSelectors: [':foo('] }),
    error => error instanceof FetcharyValidationError && error.message === 'invalid ignore selector ":foo("',
  );
  await assert.rejects(
    () => fetchary.add('https://example.com/empty', { ignoreSelectors: ['   '] }),
    error => error instanceof FetcharyValidationError && error.message === 'invalid ignore selector "   "',
  );
  assert.equal(fetchCalls, 0, 'selectors are validated before fetching');

  const source = await fetchary.add('https://example.com/selectors', { ignoreSelectors: ['.one', '.one', ' [data-value] '] });
  assert.deepEqual(source.ignoreSelectors, ['.one', '[data-value]']);
  const editedSelectors = [' relative-time ', '.timestamp', 'relative-time'];
  const originalEditedSelectors = [...editedSelectors];
  const replaced = await fetchary.edit(source.id, { ignoreSelectors: editedSelectors });
  assert.deepEqual(editedSelectors, originalEditedSelectors, 'edit does not mutate the caller array');
  assert.deepEqual(replaced.ignoreSelectors, ['relative-time', '.timestamp']);
  await assert.rejects(
    () => fetchary.edit(source.id, { ignoreSelectors: ['['] }),
    error => error instanceof FetcharyValidationError && error.message === 'invalid ignore selector "["',
  );
  assert.deepEqual((await fetchary.get(source.id)).ignoreSelectors, ['relative-time', '.timestamp']);

  body = '<p>Hello</p><relative-time>new</relative-time>';
  const reclassified = await fetchary.fetch(source.id);
  assert.equal(reclassified.rawChanged, true);
  assert.equal(reclassified.contentChanged, false, 'the previous raw version is recomputed with the current selector configuration');

  await fetchary.close();
  fetchary = await createFetchary({ dataDir, fetch: async () => new Response('<p>Hello</p>') });
  assert.deepEqual((await fetchary.get(source.id)).ignoreSelectors, ['relative-time', '.timestamp']);
  assert.deepEqual((await fetchary.edit(source.id, { ignoreSelectors: [] })).ignoreSelectors, []);
});

test('include selectors limit content changes and diffs while preserving complete evidence', async t => {
  const dataDir = tempDir(t);
  const output = tempDir(t);
  let body = '<header>Outside one</header><main id="main"><p>Same</p><span class="clock">One</span></main><aside>Also same</aside>';
  const fetchary = await createFetchary({ dataDir, fetch: async () => new Response(body) });
  t.after(() => fetchary.close());
  const events = { change: 0, version: 0 };
  for (const name of Object.keys(events)) fetchary.on(name, () => events[name]++);
  const selectors = [' #main ', 'main p', 'aside', '#main'];
  const source = await fetchary.add('https://example.com/include', {
    mode: 'http', includeSelectors: selectors, ignoreSelectors: ['.clock'],
  });
  assert.deepEqual(selectors, [' #main ', 'main p', 'aside', '#main']);
  assert.deepEqual(source.includeSelectors, ['#main', 'main p', 'aside']);
  const first = await fetchary.version(source.id, 1);
  assert.equal(await fetchary.read(source.id, 1), body);
  const lastChangedAt = source.lastChangedAt;

  body = body.replace('Outside one', 'Outside two').replace('>One<', '>Two<');
  const outsideOnly = await fetchary.fetch(source.id);
  assert.equal(outsideOnly.rawChanged, true);
  assert.equal(outsideOnly.changed, false);
  assert.equal(outsideOnly.contentChanged, false);
  assert.equal(outsideOnly.version, 2);
  assert.equal((await fetchary.get(source.id)).lastChangedAt, lastChangedAt);
  assert.equal((await fetchary.diff(source.id)).changed, false);
  assert.equal((await fetchary.diff(source.id, { mode: 'element-content' })).changed, false);
  assert.equal((await fetchary.diff(source.id, { mode: 'raw' })).changed, true);
  assert.equal((await fetchary.diff(source.id, { mode: 'element-raw' })).changed, true);
  assert.equal(await fetchary.read(source.id, 2), body);

  body = body.replace('>Same<', '>Changed<');
  const includedChange = await fetchary.fetch(source.id);
  assert.equal(includedChange.changed, true);
  assert.deepEqual((await fetchary.diff(source.id)).diff.map(part => part.value), ['Same', 'Changed']);
  assert.deepEqual((await fetchary.diff(source.id, { mode: 'element-content' })).diff.map(part => part.value), ['<p>Same</p>', '<p>Changed</p>']);
  assert.deepEqual(events, { change: 2, version: 3 });

  const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(first.file), 'metadata.json')));
  assert.deepEqual(metadata.comparison.includeSelectors, source.includeSelectors);
  assert.deepEqual(metadata.comparison.ignoreSelectors, source.ignoreSelectors);
  const exported = await fetchary.export(source.id, { output });
  assert.equal(fs.readFileSync(path.join(exported.directory, 'versions', '002-response.html'), 'utf8'), await fetchary.read(source.id, 2));
});

test('include selectors compare only their first match and recompute hashes saved with previous selection semantics', async t => {
  let body = '<p class="price">10</p><p class="price">20</p>';
  const fetchary = await createFetchary({ dataDir: tempDir(t), fetch: async () => new Response(body) });
  t.after(() => fetchary.close());
  const source = await fetchary.add('https://example.com/first-match', { mode: 'http', includeSelectors: ['.price'] });
  const legacyHash = crypto.createHash('sha256').update('10\n\n20').digest('hex');
  assert.notEqual(source.currentComparisonHash, legacyHash);
  fetchary.db.prepare('UPDATE urls SET current_comparison_hash = ? WHERE id = ?').run(legacyHash, source.id);

  body = '<p class="price">10</p><p class="price">21</p>';
  const laterMatchChanged = await fetchary.fetch(source.id);
  assert.equal(laterMatchChanged.rawChanged, true);
  assert.equal(laterMatchChanged.contentChanged, false);
  assert.equal((await fetchary.get(source.id)).currentComparisonHash, source.currentComparisonHash);
  assert.equal((await fetchary.get(source.id)).lastChangedAt, source.lastChangedAt);
  assert.equal((await fetchary.diff(source.id)).changed, false);
  assert.equal((await fetchary.diff(source.id, { mode: 'element-content' })).changed, false);
  assert.equal((await fetchary.diff(source.id, { mode: 'element-raw', includeSelectors: ['.price'] })).changed, false);

  body = '<p class="price">11</p><p class="price">21</p>';
  assert.equal((await fetchary.fetch(source.id)).changed, true);
  assert.deepEqual((await fetchary.diff(source.id)).diff.map(part => part.value), ['10', '11']);
  assert.deepEqual((await fetchary.diff(source.id, { mode: 'element-raw', includeSelectors: ['.price'] })).diff.map(part => part.value), ['<p class="price">10</p>', '<p class="price">11</p>']);
});

test('include selector validation, edits, persistence, and clearing recompute the comparison baseline', async t => {
  const dataDir = tempDir(t);
  let body = '<main>Same</main><aside>Old</aside>';
  let fetchCalls = 0;
  let fetchary = await createFetchary({ dataDir, fetch: async () => { fetchCalls++; return new Response(body); } });
  t.after(() => fetchary.close());
  for (const value of [[':foo('], ['   '], [null], 'main']) {
    await assert.rejects(() => fetchary.add('https://example.com/invalid', { includeSelectors: value, mode: 'http' }), FetcharyValidationError);
  }
  assert.equal(fetchCalls, 0);
  const source = await fetchary.add('https://example.com/include-edit', { mode: 'http' });
  assert.deepEqual(source.includeSelectors, []);

  const selectors = [' main ', 'main'];
  const edited = await fetchary.edit(source.id, { includeSelectors: selectors });
  assert.deepEqual(selectors, [' main ', 'main']);
  assert.deepEqual(edited.includeSelectors, ['main']);
  await assert.rejects(() => fetchary.edit(source.id, { includeSelectors: ['['] }), FetcharyValidationError);
  assert.deepEqual((await fetchary.get(source.id)).includeSelectors, ['main']);
  body = '<main>Same</main><aside>New</aside>';
  assert.equal((await fetchary.fetch(source.id)).contentChanged, false, 'the previous archive uses the new include selectors');

  await fetchary.close();
  fetchary = await createFetchary({ dataDir, fetch: async () => new Response(body) });
  assert.deepEqual((await fetchary.get(source.id)).includeSelectors, ['main']);
  assert.deepEqual((await fetchary.list())[0].includeSelectors, ['main']);
  assert.deepEqual((await fetchary.edit(source.id, { includeSelectors: ['aside'] })).includeSelectors, ['aside']);
  body = '<main>Outside change</main><aside>New</aside>';
  assert.equal((await fetchary.fetch(source.id)).changed, false, 'replacement selectors reset the baseline');

  assert.deepEqual((await fetchary.edit(source.id, { includeSelectors: [] })).includeSelectors, []);
  body = '<main>Outside change</main><aside>Newest</aside>';
  assert.equal((await fetchary.fetch(source.id)).changed, true, 'clearing restores full-page comparisons');

  await fetchary.edit(source.id, { includeSelectors: ['.missing'] });
  body = '<main>Another outside change</main>';
  assert.equal((await fetchary.fetch(source.id)).changed, false, 'missing matches compare as empty');
  body += '<div class="missing">Appeared</div>';
  assert.equal((await fetchary.fetch(source.id)).changed, true);
  body = '<main>Another outside change</main>';
  assert.equal((await fetchary.fetch(source.id)).changed, true);
});

test('diff include selectors override selection for one call and support raw element output', async t => {
  let body = '<main><p class="old">Same</p><span class="clock">One</span></main><aside>Old</aside>';
  const fetchary = await createFetchary({ dataDir: tempDir(t), fetch: async () => new Response(body) });
  t.after(() => fetchary.close());
  const source = await fetchary.add('https://example.com/diff-selection', {
    mode: 'http', includeSelectors: ['aside'], ignoreSelectors: ['.clock'],
  });
  body = '<main><p class="new">Same</p><span class="clock">Two</span></main><aside>New</aside>';
  await fetchary.fetch(source.id);
  const stored = await fetchary.get(source.id);
  const selectors = [' main ', 'main p', 'main'];
  assert.equal((await fetchary.diff(source.id, { includeSelectors: selectors })).changed, false);
  assert.deepEqual(selectors, [' main ', 'main p', 'main']);
  assert.equal((await fetchary.diff(source.id, { includeSelectors: selectors, mode: 'element-content' })).changed, false);
  assert.deepEqual((await fetchary.diff(source.id, { includeSelectors: ['main p'], mode: 'element-raw' })).diff, [
    { type: 'removed', value: '<p class="old">Same</p>' },
    { type: 'added', value: '<p class="new">Same</p>' },
  ]);
  assert.equal((await fetchary.diff(source.id, { includeSelectors: ['.clock'] })).changed, false, 'content diffs keep stored ignore selectors');
  assert.equal((await fetchary.diff(source.id, { includeSelectors: ['.clock'], mode: 'element-raw' })).changed, true, 'raw element diffs do not apply stored ignore selectors');
  assert.equal((await fetchary.diff(source.id, { includeSelectors: ['.missing'], mode: 'element-raw' })).changed, false);
  assert.equal((await fetchary.diff(source.id, { includeSelectors: [], mode: 'element-raw' })).changed, true);
  assert.deepEqual((await fetchary.diff(source.id)).diff.map(part => part.value), ['Old', 'New']);
  assert.deepEqual(await fetchary.get(source.id), stored, 'diff overrides never update source state');
  for (const includeSelectors of [['['], [' '], [null], 'main']) {
    await assert.rejects(() => fetchary.diff(source.id, { includeSelectors }), FetcharyValidationError);
  }
  await assert.rejects(() => fetchary.diff(source.id, { includeSelectors: ['main'], mode: 'raw' }), FetcharyValidationError);
  assert.equal((await fetchary.diff(source.id, { mode: 'raw' })).changed, true);
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

  const one = await fetchary.add('https://example.com/one', { tag: 'a', mode: 'http' });
  const two = await fetchary.add('https://example.com/two', { tag: 'b', mode: 'http' });
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
  assert.deepEqual(fs.readFileSync(path.join(exported.directory, 'versions', '001-response.html')), fs.readFileSync((await fetchary.version(one.id)).file));

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
    'FetcharyBrowserError',
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

test('storage migrates required version metadata while keeping content type nullable', async t => {
  const dataDir = tempDir(t);
  const databasePath = path.join(dataDir, 'fetchary.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE urls (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      name TEXT,
      tag TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_checked_at TEXT,
      last_changed_at TEXT,
      current_hash TEXT,
      current_version_id INTEGER,
      removed_at TEXT
    );
    CREATE TABLE versions (
      id INTEGER PRIMARY KEY,
      url_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      requested_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      status_code INTEGER,
      final_url TEXT,
      content_type TEXT,
      content_length INTEGER,
      hash TEXT NOT NULL,
      file TEXT NOT NULL,
      etag TEXT,
      last_modified TEXT,
      UNIQUE (url_id, version_number),
      FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
    );
    INSERT INTO urls (id, url, created_at, current_hash, current_version_id)
    VALUES (1, 'https://example.com/', '2026-09-24T00:00:00.000Z', 'hash', 1);
    INSERT INTO versions (
      id, url_id, version_number, requested_url, fetched_at, status_code,
      final_url, content_type, content_length, hash, file
    ) VALUES (
      1, 1, 1, 'https://example.com/', '2026-09-24T00:00:00.000Z', 200,
      'https://example.com/', NULL, 4, 'hash', '/tmp/response.html'
    );
  `);
  legacy.close();

  const fetchary = await createFetchary({ dataDir, fetch: async () => new Response('test') });
  assert.deepEqual((await fetchary.get(1)).ignoreSelectors, []);
  assert.deepEqual((await fetchary.get(1)).includeSelectors, []);
  await fetchary.close();

  const migrated = new DatabaseSync(databasePath, { readOnly: true });
  const vendors = migrated.prepare('SELECT name, active FROM vendors ORDER BY name').all();
  assert.deepEqual(vendors.map(vendor => vendor.name), require('../src/vendors').discoverVendors().map(vendor => vendor.name).sort());
  assert.equal(vendors.every(vendor => vendor.active === 1), true, 'legacy databases receive active vendors automatically');
  const urlColumns = new Map(migrated.prepare('PRAGMA table_info(urls)').all().map(column => [column.name, column]));
  assert.equal(Number(urlColumns.get('ignore_selectors').notnull), 1);
  assert.equal(urlColumns.get('ignore_selectors').dflt_value, "'[]'");
  assert.equal(migrated.prepare('SELECT ignore_selectors FROM urls WHERE id = 1').get().ignore_selectors, '[]');
  assert.equal(Number(urlColumns.get('include_selectors').notnull), 1);
  assert.equal(urlColumns.get('include_selectors').dflt_value, "'[]'");
  assert.equal(migrated.prepare('SELECT include_selectors FROM urls WHERE id = 1').get().include_selectors, '[]');
  assert.equal(urlColumns.get('capture_mode').dflt_value, "'browser'");
  assert.equal(urlColumns.get('wait_after_load_ms').dflt_value, '5000');
  assert.equal(migrated.prepare('SELECT capture_mode FROM urls WHERE id = 1').get().capture_mode, 'browser');
  assert.equal(migrated.prepare('SELECT current_raw_hash FROM urls WHERE id = 1').get().current_raw_hash, 'hash');
  const columns = new Map(migrated.prepare('PRAGMA table_info(versions)').all().map(column => [column.name, column]));
  assert.equal(Number(columns.get('status_code').notnull), 1);
  assert.equal(Number(columns.get('final_url').notnull), 1);
  assert.equal(Number(columns.get('content_length').notnull), 1);
  assert.equal(Number(columns.get('content_type').notnull), 0);
  assert.equal(Number(columns.get('rendered_hash').notnull), 0);
  assert.equal(columns.get('capture_mode').dflt_value, "'http'");
  assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM versions').get().count, 1);
  assert.equal(migrated.prepare('SELECT content_type FROM versions WHERE id = 1').get().content_type, null);
  const migratedVersion = migrated.prepare('SELECT raw_hash, rendered_hash, capture_mode FROM versions WHERE id = 1').get();
  assert.equal(migratedVersion.raw_hash, 'hash');
  assert.equal(migratedVersion.rendered_hash, null);
  assert.equal(migratedVersion.capture_mode, 'http');
  migrated.close();
});
