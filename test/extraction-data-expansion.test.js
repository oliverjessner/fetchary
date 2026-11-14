'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const api = require('../src');
const { pageMetadata } = require('../src/extract/metadata');
const { structuredData } = require('../src/extract/structured-data');
const contacts = require('../src/extract/contacts');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('metadata preserves raw repeated cards, original precedence, alternatives and scientific fields', () => {
  const result = pageMetadata(parseHTML(fixture('metadata-expanded.html')).document, 'https://journal.example.test/papers/paper', 1024 * 1024);
  assert.equal(result.title, 'Original paper title');
  assert.equal(result.description, 'Selected description');
  assert.equal(result.publishedAt, '2026-10-01');
  assert.deepEqual(result.openGraph['og:image'], [' /cover-one.png ', '/cover-two.png']);
  assert.deepEqual(result.twitter['twitter:card'], ['summary_large_image']);
  assert.deepEqual(result.sources.title, { value: 'Original paper title', raw: ' Original   paper title ', source: 'html', field: 'title' });
  assert.deepEqual(result.alternatives.title.map(item => item.value), ['Social paper title', 'Other card title', 'Schema title']);
  assert.equal(result.alternatives.publishedAt[0].value, '2026-09-30');
  assert.deepEqual(result.scientific, { doi: '10.1234/example.paper', authors: ['Ada Example', 'Grace Example'], journal: 'Example Journal', pdfUrl: 'https://journal.example.test/papers/paper.pdf' });
  assert.deepEqual(result.authors, [
    { name: 'Ada Example', url: 'https://journal.example.test/authors/ada' },
    { name: 'Grace Example', url: 'https://journal.example.test/authors/grace' },
  ]);
  assert.deepEqual(result.publisher, { name: 'Example Press', url: 'https://publisher.example.test/' });
});

test('metadata resolves Microdata authors and does not infer authors from unrelated JSON-LD', () => {
  const html = '<article itemscope itemtype="https://schema.org/Article" itemid="https://example.test/story"><span itemprop="headline">Story</span><span itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Author</span><a itemprop="url" href="/author">Profile</a></span></article>';
  const result = pageMetadata(parseHTML(html).document, 'https://example.test/story', 1024 * 1024);
  assert.equal(result.title, 'Story');
  assert.deepEqual(result.authors, [{ name: 'Author', url: 'https://example.test/author' }]);
  assert.equal(result.sources.title.source, 'microdata');
  assert.deepEqual(pageMetadata(parseHTML('<p>Empty</p>').document, 'https://example.test/', 1024).scientific, { doi: null, authors: [], journal: null, pdfUrl: null });
});

test('local JSON-LD entity table merges definitions and resolves cyclic references without mutating raw blocks', () => {
  const raw = { '@context': 'https://must-not-be-requested.example.test/context', '@graph': [
    { '@id': '#story', '@type': 'Article', headline: 'Story', author: { '@id': '#person' } },
    { '@id': '#person', '@type': 'Person', name: 'Ada', knows: { '@id': '#person' } },
    { '@id': '#person', url: '/authors/ada', knows: { '@id': '#other' } },
  ] };
  const result = structuredData(null, 'https://example.test/article', 1024 * 1024, JSON.stringify(raw));
  assert.deepEqual(result.jsonLd, [raw]);
  const table = result.resolved.entities;
  assert.deepEqual(result.resolved.roots, ['https://example.test/article#story', 'https://example.test/article#person']);
  assert.deepEqual(table['https://example.test/article#story'].properties.author, { '@id': 'https://example.test/article#person' });
  assert.deepEqual(table['https://example.test/article#person'].types, ['Person']);
  assert.equal(table['https://example.test/article#person'].properties.name, 'Ada');
  assert.deepEqual(table['https://example.test/article#person'].properties.knows, [{ '@id': 'https://example.test/article#person' }, { '@id': 'https://example.test/article#other' }]);
  assert.doesNotThrow(() => JSON.stringify(result));
  table['https://example.test/article#person'].properties.name = 'Changed';
  assert.equal(result.jsonLd[0]['@graph'][1].name, 'Ada');
  const unsafe = structuredData(null, 'https://example.test/', 1024, '{"@id":"#entity","__proto__":{"polluted":true}}');
  assert.equal({}.polluted, undefined);
  assert.deepEqual(unsafe.resolved.entities['https://example.test/#entity'].properties.__proto__, { polluted: true });
  const based = structuredData(parseHTML('<base href="https://cdn.example.test/assets/"><script type="application/ld+json">{"@id":"#item","@type":"Thing","name":"Local"}</script>').document, 'https://example.test/article', 1024);
  assert.deepEqual(based.resolved.roots, ['https://cdn.example.test/assets/#item']);
});

test('contact details preserve original values, labelled departments and only explicitly labelled phone kinds', () => {
  const html = fixture('contacts-expanded.html');
  assert.deepEqual(contacts.emails(contacts.contactInputs(html, 'emails', true)), ['Press@example.test']);
  assert.deepEqual(contacts.emails(contacts.contactInputs(html, 'emails', true), { deobfuscate: true }), ['Press@example.test', 'sales@example.test']);
  const emails = contacts.extractContactDetails(html, 'emails', { html: true, deobfuscate: true });
  assert.equal(emails[0].raw, 'Press@EXAMPLE.test');
  assert.equal(emails[0].department, 'Presse');
  assert.match(emails[0].location, /a:nth-child/);
  assert.equal(emails[1].raw, 'sales [at] example [dot] test');
  assert.equal(emails[1].department, 'Vertrieb');
  const phones = contacts.extractContactDetails(html, 'telephone', { html: true });
  assert.deepEqual(phones.map(item => item.kind), ['mobile', 'fax', 'landline', null]);
  assert.equal(phones[1].value, '+442079460018');
  assert.equal(phones[1].label, 'Fax');
  const labelled = contacts.extractContactDetails('<a href="tel:+442079460018" aria-label="Presse Fax">+44 20 7946 0018</a>', 'telephone', { html: true });
  assert.equal(labelled[0].department, 'Presse');
  assert.equal(labelled[0].kind, 'fax');
});

test('contact enrichment keeps plain defaults and deobfuscation opt-in through the public API', async () => {
  const html = fixture('contacts-expanded.html');
  const settings = { mode: 'http', allowPrivateNetwork: true, fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) };
  assert.deepEqual((await api.extractEmails('https://example.test/', settings)).data, ['Press@example.test']);
  const details = await api.extractEmails('https://example.test/', { ...settings, details: true, deobfuscate: true });
  assert.equal(details.data[1].value, 'sales@example.test');
  assert.equal(details.data[1].department, 'Vertrieb');
  const plain = contacts.extractContactDetails('Write plain@example.test.', 'emails', { html: false });
  assert.deepEqual(plain, [{ value: 'plain@example.test', raw: 'plain@example.test', label: 'Write', department: null, location: null }]);
});

test('scoped contact details retain original DOM positions after ignored content is removed', async () => {
  const html = '<html><body><style>.ignored{color:red}</style><aside>outside@example.test</aside><section><p>Presse: <a href="mailto:press@example.test">press@example.test</a></p><div class="ignore">skip@example.test</div></section></body></html>';
  const result = await api.extractEmails('https://example.test/', { mode: 'http', allowPrivateNetwork: true,
    fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), details: true,
    includeSelectors: ['section'], ignoreSelectors: ['.ignore'] });
  assert.deepEqual(result.data.map(record => record.value), ['press@example.test']);
  const original = parseHTML(html).document;
  assert.equal(original.querySelector(result.data[0].location).getAttribute('href'), 'mailto:press@example.test');
  assert.match(result.data[0].location, /section:nth-child\(3\)/);
});
