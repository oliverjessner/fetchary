'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const api = require('../src');

const url = 'https://phone-migration.example.test/';
function settings(body, extra = {}, contentType = 'text/html') {
  return { mode: 'http', allowPrivateNetwork: true, cacheTtlMs: 0,
    fetch: async () => new Response(body, { headers: { 'content-type': contentType } }), ...extra };
}

test('a standalone tel extension stays one canonical contact in plain and detailed results', async () => {
  const html = '<a href="tel:+49-30-123456;ext=42">Berlin office</a>';
  assert.deepEqual((await api.extractTelephone(url, settings(html))).data, ['+4930123456;ext=42']);
  const detailed = await api.extractTelephone(url, settings(html, { details: true }));
  assert.deepEqual(detailed.data.map(item => item.value), ['+4930123456;ext=42']);
  assert.equal(detailed.data[0].raw, '+49-30-123456;ext=42');
});

test('detailed phone links retain the visible spelling and its department and fax label', async () => {
  const html = '<section><p>Presse Fax: <a href="tel:+4930123456;ext=42">+49 30 123456 ext. 42</a></p></section>';
  const result = await api.extractTelephone(url, settings(html, { details: true }));
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].value, '+4930123456;ext=42');
  assert.equal(result.data[0].raw, '+49 30 123456 ext. 42');
  assert.equal(result.data[0].department, 'Presse');
  assert.equal(result.data[0].kind, 'fax');
  assert.match(result.data[0].location, /a:nth-child/);
});

test('optional international trunk notation does not remove significant Italian zeroes', async () => {
  // The Italian fixed-line example comes from the dependency's pinned metadata.
  const html = '<p>Austria: +43 (0)1 2345678.</p><p>Italy: +39 02 12345678.</p><p>UK: +44 (0)20 7946 0018.</p>';
  assert.deepEqual((await api.extractTelephone(url, settings(html))).data, ['+4312345678', '+390212345678', '+442079460018']);
});

test('controlled Unicode digits and nongeographic plans preserve phone values and original details', async () => {
  // Both numbers are examples from the dependency's Austrian and 001-800 plans.
  const html = '<p>😀 Mobil: +٤٣ ٦٦٤ ١٢٣٤٥٦.</p><p>Freephone: +800 12345678.</p>';
  const result = await api.extractTelephone(url, settings(html, { details: true }));
  assert.deepEqual(result.data.map(item => item.value), ['+43664123456', '+80012345678']);
  assert.equal(result.data[0].raw, '+٤٣ ٦٦٤ ١٢٣٤٥٦');
  assert.equal(result.data[0].kind, 'mobile');
  assert.equal(result.data[1].kind, null);
});

test('strict validation excludes parsed short numbers while national contacts still require an explicit country', async () => {
  const text = 'Invalid: +43 123. Date: 2026-11-26. National: 0664 123456.';
  assert.deepEqual((await api.extractTelephone(url, settings(text, {}, 'text/plain'))).data, []);
  assert.deepEqual((await api.extractTelephone(url, settings(text, { defaultCountry: 'AT' }, 'text/plain'))).data, ['+43664123456']);
});

test('unsupported phone contexts and malformed extensions are not salvaged as different contacts', async () => {
  for (const target of ['0664123456;phone-context=example.test', '+43664123456;ext=broken']) {
    const html = `<a href="tel:${target}">Contact</a>`;
    assert.deepEqual((await api.extractTelephone(url, settings(html, { defaultCountry: 'AT' }))).data, [], target);
  }
  for (const prefix of ['+4930123456', '+43123']) {
    const text = `Contact ${prefix};phone-context=+43664123456. Other +442079460018.`;
    assert.deepEqual((await api.extractTelephone(url, settings(text, {}, 'text/plain'))).data, ['+442079460018']);
  }
  const multiline = '<a href="tel:+43%0A664123456">Contact</a>';
  assert.deepEqual((await api.extractTelephone(url, settings(multiline))).data, []);
});

test('phone extraction accepts page text above the dependency default text limit within Fetchary response limits', async () => {
  const text = 'ordinary words '.repeat(75_000) + ' Call +43 664 123456.';
  assert.ok(text.length > 1_000_000);
  const result = await api.extractTelephone(url, settings(text, {}, 'text/plain'));
  assert.deepEqual(result.data, ['+43664123456']);
});

test('many rejected date candidates do not hide a later valid phone within the response limit', async () => {
  const text = '2026-11-26; '.repeat(10_005) + ' Call +43 664 123456.';
  const result = await api.extractTelephone(url, settings(text, { defaultCountry: 'AT' }, 'text/plain'));
  assert.deepEqual(result.data, ['+43664123456']);
});

test('Fetchary country declarations cover exactly the pinned parser metadata without the old library type import', async () => {
  const declaration = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.d.ts'), 'utf8');
  assert.equal(declaration.includes("from 'libphonenumber-js'"), false);
  const union = /\btype CountryCode\s*=\s*([\s\S]*?);/.exec(declaration);
  assert.ok(union, 'CountryCode remains a closed Fetchary-owned union');
  const declared = [...union[1].matchAll(/'([A-Z]{2})'/g)].map(match => match[1]).sort();
  const { phoneParser } = await import('@oliverj/parse-phone-number/all');
  assert.deepEqual(declared, [...phoneParser.getMetadataInfo().supportedCountries].sort());
});
