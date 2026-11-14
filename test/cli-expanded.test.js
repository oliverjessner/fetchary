'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../src');
const { main } = require('../cli');
const { listItems } = require('../cli/list');
const { saveSession } = require('../src/auth/sessions');
const url = 'https://example.test/';

async function run(args, options = {}) {
  const chunks = []; let stderr = '';
  const code = await main(args, { options, recordHistory: false,
    stdout: { write: chunk => chunks.push(Buffer.from(chunk)) }, stderr: { write: value => { stderr += value; } },
  });
  return { code, body: Buffer.concat(chunks), stdout: Buffer.concat(chunks).toString('utf8'), stderr };
}
const settings = html => ({ mode: 'http', allowPrivateNetwork: true, cacheTtlMs: 0,
  fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
});
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-expanded-cli-'));
  fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('favicon --all prints ranked URLs, offers structured JSON and saves text rather than image output', async t => {
  const options = { ...settings(''), fetch: async target => {
    if (target === url) return new Response('<link rel="icon" href="/small.svg"><link rel="icon" href="/large.svg">', { headers: { 'content-type': 'text/html' } });
    if (target.endsWith('.svg')) return new Response(`<svg width="${target.includes('large') ? 128 : 32}" height="${target.includes('large') ? 128 : 32}"></svg>`, { headers: { 'content-type': 'image/svg+xml' } });
    return new Response('missing', { status: 404 });
  } };
  const expected = 'https://example.test/large.svg\nhttps://example.test/small.svg\n';
  for (const args of [['favicon', url, '--all'], ['extract', 'favicon', url, '--all', '--list']]) {
    const result = await run(args, options); assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, expected);
  }
  const json = await run(['favicon', url, '--all', '--json'], options);
  assert.equal(json.code, 0, json.stderr); assert.deepEqual(JSON.parse(json.stdout).data.map(image => image.width), [128, 32]);
  const output = directory(t);
  const saved = await run(['favicon', url, '--all', '--filepath', output], options);
  assert.equal(saved.code, 0, saved.stderr); assert.equal(saved.stdout, expected);
  const file = fs.readdirSync(output)[0]; assert.equal(path.extname(file), '.txt'); assert.equal(fs.readFileSync(path.join(output, file), 'utf8'), expected);
  const binary = await run(['favicon', url, '--binary'], options);
  assert.equal(binary.code, 0, binary.stderr); assert.equal(binary.body.toString(), '<svg width="128" height="128"></svg>');
});

test('contact details/deobfuscation are forwarded and --list prints normalized values', async () => {
  const html = '<p>Presse: <a href="mailto:press@example.test">press@example.test</a></p><p>office [at] example [dot] test</p>'
    + '<p>Fax: <a href="tel:+4312345678">+43 1 2345678</a></p>';
  const email = await run(['extract', 'emails', url, '--details', '--deobfuscate', '--json'], settings(html));
  assert.equal(email.code, 0, email.stderr);
  assert.deepEqual(JSON.parse(email.stdout).data.map(record => record.value), ['press@example.test', 'office@example.test']);
  const list = await run(['extract', 'emails', url, '--details', '--deobfuscate', '--list'], settings(html));
  assert.equal(list.code, 0, list.stderr); assert.equal(list.stdout, 'press@example.test\noffice@example.test\n');
  const phone = await run(['extract', 'telephone', url, '--details', '--list'], settings(html));
  assert.equal(phone.code, 0, phone.stderr); assert.equal(phone.stdout, '+4312345678\n');
  assert.ok(!list.stdout.includes('[object Object]'));
});

test('price context and browser resource flags reach the library without coercing strings', async t => {
  const calls = [];
  t.mock.method(api, 'extract', async (target, options) => {
    calls.push({ target, options });
    return { type: options.type, data: options.type === 'price' ? { candidates: [] } : [], images: [] };
  });
  const price = await run(['extract', 'price', url, '--country', 'AT', '--language', 'de-AT', '--block-resource-type', 'font', '--block-resource-type', 'media']);
  assert.equal(price.code, 0, price.stderr);
  assert.equal(calls[0].options.country, 'AT'); assert.equal(calls[0].options.language, 'de-AT');
  assert.deepEqual(calls[0].options.blockedResourceTypes, ['font', 'media']);
  const images = await run(['extract', 'images', url, '--no-stylesheets']);
  assert.equal(images.code, 0, images.stderr); assert.equal(calls[1].options.includeStylesheets, false);
});

test('metadata --list preserves the original six scalar fields and skips additive objects', async () => {
  const html = '<title>Example</title><meta name="description" content="Description"><link rel="canonical" href="https://example.test/article">'
    + '<meta property="og:site_name" content="Publisher"><meta name="author" content="Author">';
  const result = await run(['extract', 'metadata', url, '--list'], settings(html));
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, 'Example\nDescription\nhttps://example.test/article\n');
  assert.deepEqual(listItems({ type: 'metadata', data: { title: 'Title', description: null, canonical: null, language: 'de', publishedAt: 'today', modifiedAt: null,
    authors: [{ name: 'Author' }], publisher: { name: 'Publisher' }, sources: { title: 'title' }, scientific: { doi: '10.1/example' }, openGraph: {} } }), ['Title', 'de', 'today']);
});

test('type-specific flags and conflicting favicon/logout selections fail before a request or mutation', async t => {
  let requests = 0; let mutations = 0;
  t.mock.method(api, 'logout', async () => { mutations++; return {}; });
  const options = { ...settings(''), fetch: async () => { requests++; throw new Error('must not fetch'); } };
  for (const args of [
    ['favicon', url, '--all', '--binary'], ['extract', 'text', url, '--all'], ['extract', 'images', url, '--details'],
    ['extract', 'telephone', url, '--deobfuscate'], ['extract', 'text', url, '--country', 'AT'],
    ['extract', 'images', url, '--language', 'de'], ['extract', 'text', url, '--no-stylesheets'],
    ['extract', 'text', url, '--domain', 'example.test'], ['logout'], ['logout', 'one', '--domain', 'example.test'],
    ['sessions', '--domain', 'example.test'], ['extract', 'text', url, '--block-resource-type', 'unsupported'],
  ]) {
    const result = await run(args, options); assert.equal(result.code, 2, args.join(' ')); assert.equal(result.stdout, '');
  }
  assert.equal(requests, 0); assert.equal(mutations, 0);
});

async function session(name, origin, sessionDir) {
  await saveSession(name, { version: 1, origin, savedAt: '2026-11-15T00:00:00.000Z', cookies: [] }, { sessionDir });
}

test('logout accepts multiple explicit names, preserves single-name output and can select an exact domain', async t => {
  const sessionDir = directory(t);
  await session('one', 'https://example.test', sessionDir); await session('two', 'https://example.test', sessionDir);
  const removed = await run(['logout', 'one', 'two', '--session-dir', sessionDir, '--json']);
  assert.equal(removed.code, 0, removed.stderr);
  assert.deepEqual(JSON.parse(removed.stdout), { removed: 2, failed: 0, sessions: [{ session: 'one', removed: true }, { session: 'two', removed: true }] });
  await session('single', 'https://example.test', sessionDir);
  const single = await run(['logout', 'single', '--session-dir', sessionDir]);
  assert.equal(single.code, 0, single.stderr); assert.equal(single.stdout, 'Removed session "single".\n');
  await session('matching', 'https://example.test', sessionDir); await session('child', 'https://sub.example.test', sessionDir);
  const domain = await run(['logout', '--domain', 'example.test', '--session-dir', sessionDir, '--json']);
  assert.equal(domain.code, 0, domain.stderr); assert.equal(JSON.parse(domain.stdout).removed, 1);
  assert.deepEqual(fs.readdirSync(sessionDir), ['child.json']);
});

test('bulk logout reports partial failures and returns exit status one', async t => {
  const sessionDir = directory(t);
  await session('good', 'https://example.test', sessionDir);
  fs.mkdirSync(path.join(sessionDir, 'blocked.json'), { mode: 0o700 });
  const plain = await run(['logout', 'good', 'missing', 'blocked', '--session-dir', sessionDir]);
  assert.equal(plain.code, 1); assert.equal(plain.stdout, 'Removed 1 session(s); 1 not found; 1 failed.\n');
  assert.match(plain.stderr, /Could not remove session "blocked"/);
  assert.equal(fs.statSync(path.join(sessionDir, 'blocked.json')).isDirectory(), true);
  const json = await run(['logout', 'missing', 'blocked', '--session-dir', sessionDir, '--json']);
  assert.equal(json.code, 1); assert.equal(json.stderr, '');
  assert.equal(JSON.parse(json.stdout).failed, 1); assert.equal(JSON.parse(json.stdout).sessions[1].removed, false);
});
