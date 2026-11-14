'use strict';
const { httpUrl, documentBase } = require('./images');
const { structuredData } = require('./structured-data');

const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || null : null;
const scalar = value => Array.isArray(value) ? value.map(scalar).find(Boolean) || null : clean(value) || (value && typeof value === 'object' ? clean(value['@value']) : null);
const field = (object, name) => object[name] ?? object[`https://schema.org/${name}`] ?? object[`http://schema.org/${name}`];
function identity(value, base) {
  if (Array.isArray(value)) return value.map(item => identity(item, base)).find(Boolean) || null;
  const url = httpUrl(typeof value === 'string' ? value : value?.['@id'] ?? value?.id ?? value?.url, base);
  if (!url) return null;
  const parsed = new URL(url); parsed.hash = ''; return parsed.href;
}

function pageMetadata(document, pageUrl, maxBytes) {
  const result = {
    title: null, description: null, canonical: null, language: null, publishedAt: null, modifiedAt: null,
    authors: [], publisher: null, openGraph: {}, twitter: {},
    scientific: { doi: null, authors: [], journal: null, pdfUrl: null },
    sources: { title: null, description: null, publishedAt: null, modifiedAt: null },
    alternatives: { title: [], description: [], publishedAt: [], modifiedAt: [] },
  };
  if (!document) return result;
  const base = documentBase(document, pageUrl);
  const meta = new Map();
  for (const element of document.querySelectorAll('meta[content]')) {
    if (element.closest('template, noscript')) continue;
    for (const attribute of ['name', 'property', 'http-equiv']) {
      const key = element.getAttribute(attribute)?.trim().toLowerCase();
      const raw = element.getAttribute('content');
      const value = clean(raw);
      if (!key) continue;
      if (key.startsWith('og:') || key.startsWith('twitter:')) {
        const target = key.startsWith('og:') ? result.openGraph : result.twitter;
        (target[key] ||= []).push(raw);
      }
      if (value) {
        if (!meta.has(key)) meta.set(key, []);
        meta.get(key).push({ value, raw, source: 'meta', field: key });
      }
    }
  }
  const first = keys => keys.flatMap(key => meta.get(key) || [])[0]?.value || null;
  const evidence = { title: [], description: [], publishedAt: [], modifiedAt: [] };
  function add(name, raw, source, location) {
    const value = scalar(raw);
    if (value) evidence[name].push({ value, raw: typeof raw === 'string' ? raw : value, source, field: location });
  }
  for (const title of document.querySelectorAll('title')) if (!title.closest('svg, template, noscript')) add('title', title.textContent, 'html', 'title');
  const fields = {
    title: ['og:title', 'twitter:title'], description: ['description', 'og:description', 'twitter:description'],
    publishedAt: ['article:published_time', 'datepublished', 'pubdate', 'publishdate', 'publish-date', 'publication_date', 'dcterms.issued', 'dc.date.issued', 'parsely-pub-date', 'date'],
    modifiedAt: ['article:modified_time', 'og:updated_time', 'datemodified', 'last-modified', 'lastmodified', 'dcterms.modified', 'dc.date.modified'],
  };
  for (const [name, keys] of Object.entries(fields)) for (const key of keys) evidence[name].push(...meta.get(key) || []);
  for (const link of document.querySelectorAll('link[rel][href]')) {
    if (link.closest('template, noscript') || !link.getAttribute('rel').toLowerCase().split(/\s+/).includes('canonical')) continue;
    result.canonical = httpUrl(link.getAttribute('href'), base);
    if (result.canonical) break;
  }
  const html = document.querySelector('html');
  result.language = clean(html?.getAttribute('lang')) || clean(html?.getAttribute('xml:lang')) || first(['content-language', 'og:locale']);
  const data = structuredData(document, pageUrl, maxBytes);
  const candidates = [];
  const pending = data.jsonLd.map((object, index) => ({ object, location: `jsonLd[${index}]` }));
  const ids = new Map();
  for (let index = 0; index < pending.length && index < 10000; index++) {
    const { object, location } = pending[index];
    if (!object || typeof object !== 'object' || Array.isArray(object)) continue;
    candidates.push({ object, source: 'json-ld', location });
    if (typeof object['@id'] === 'string') ids.set(httpUrl(object['@id'], base) || object['@id'], object);
    if (Array.isArray(object['@graph'])) object['@graph'].forEach((object, child) => pending.push({ object, location: `${location}.@graph[${child}]` }));
    if (object.mainEntity && typeof object.mainEntity === 'object') [object.mainEntity].flat().forEach((object, child) => pending.push({ object, location: `${location}.mainEntity[${child}]` }));
  }
  function microObject(item) {
    return { ...Object.fromEntries(Object.entries(item.properties).map(([name, values]) => {
      const converted = values.map(value => value && typeof value === 'object' && value.properties ? microObject(value) : value);
      return [name, converted.length === 1 ? converted[0] : converted];
    })), '@type': item.types, '@id': item.id };
  }
  data.microdata.forEach((item, index) => candidates.push({ object: microObject(item), source: 'microdata', location: `microdata[${index}]` }));
  const pages = new Set([identity(pageUrl, base), identity(result.canonical, base)].filter(Boolean));
  const matching = []; const anonymous = [];
  for (const candidate of candidates) {
    const { object } = candidate;
    const types = [object['@type']].flat().filter(value => typeof value === 'string').map(value => value.split(/[\/#:]/).at(-1));
    if (!types.some(type => /(?:Article|Page)$/.test(type) || ['BlogPosting', 'CreativeWork', 'Report'].includes(type))) continue;
    const declared = [field(object, 'mainEntityOfPage'), field(object, 'url'), object['@id']].map(value => identity(value, base)).find(Boolean);
    if (declared && !pages.has(declared)) continue;
    (declared ? matching : anonymous).push(candidate);
  }
  function author(value) {
    if (typeof value === 'string') return { name: /^https?:/i.test(value) ? null : clean(value), url: /^https?:/i.test(value) ? httpUrl(value, base) : null };
    if (!value || typeof value !== 'object') return null;
    const identifier = typeof value['@id'] === 'string' && (httpUrl(value['@id'], base) || value['@id']);
    const linked = identifier && ids.get(identifier);
    const resolved = identifier && data.resolved.entities[identifier];
    const object = linked || resolved ? { ...resolved?.properties, ...linked, ...value } : value;
    return { name: scalar(field(object, 'name')), url: httpUrl(scalar(field(object, 'url')), base) || httpUrl(object['@id'], base) };
  }
  function addAuthor(value) {
    const person = author(value);
    if (!person || !person.name && !person.url || result.authors.length >= 64) return;
    const existing = result.authors.find(item => person.url && item.url === person.url || person.name && item.name === person.name && (!person.url || !item.url));
    if (existing) { existing.name ||= person.name; existing.url ||= person.url; }
    else result.authors.push(person);
  }
  for (const key of ['author', 'article:author', 'citation_author', 'dc.creator', 'dcterms.creator']) for (const entry of meta.get(key) || []) addAuthor(entry.value);
  for (const element of document.querySelectorAll('a[rel][href], link[rel][href]')) {
    if (element.closest('template, noscript') || !element.getAttribute('rel').toLowerCase().split(/\s+/).includes('author')) continue;
    const url = httpUrl(element.getAttribute('href'), base);
    if (url) addAuthor({ name: clean(element.textContent) || clean(element.getAttribute('title')), url });
  }
  for (const { object, source, location } of [...matching, ...anonymous]) {
    const hasHeadline = scalar(field(object, 'headline'));
    const title = hasHeadline ? field(object, 'headline') : field(object, 'name');
    add('title', title, source, `${location}.${hasHeadline ? 'headline' : 'name'}`);
    add('description', field(object, 'description'), source, `${location}.description`);
    add('publishedAt', field(object, 'datePublished'), source, `${location}.datePublished`);
    add('modifiedAt', field(object, 'dateModified'), source, `${location}.dateModified`);
    result.language ||= scalar(field(object, 'inLanguage'));
    for (const value of [field(object, 'author')].flat()) addAuthor(value);
    const publisher = author([field(object, 'publisher')].flat()[0]);
    if (publisher && (publisher.name || publisher.url)) result.publisher ||= publisher;
  }
  for (const time of document.querySelectorAll('time[pubdate][datetime]')) if (!time.closest('template, noscript')) add('publishedAt', time.getAttribute('datetime'), 'html', 'time[pubdate][datetime]');
  for (const name of Object.keys(evidence)) {
    result.sources[name] = evidence[name][0] || null;
    result[name] = result.sources[name]?.value || null;
    result.alternatives[name] = evidence[name].filter(item => item.value !== result[name]);
  }
  const publisher = first(['publisher', 'citation_publisher', 'dc.publisher', 'dcterms.publisher']);
  if (!result.publisher && publisher) result.publisher = { name: publisher, url: null };
  result.scientific.doi = ['citation_doi', 'prism.doi', 'dc.identifier', 'dcterms.identifier'].flatMap(key => meta.get(key) || [])
    .map(entry => entry.value.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')).find(value => /^10\.\d{4,9}\/\S+$/i.test(value)) || null;
  result.scientific.authors = [...new Set(['citation_author', 'dc.creator', 'dcterms.creator'].flatMap(key => (meta.get(key) || []).map(entry => entry.value)))];
  result.scientific.journal = first(['citation_journal_title', 'prism.publicationname']);
  result.scientific.pdfUrl = httpUrl(first(['citation_pdf_url']), base);
  if (result.language) result.language = clean(result.language.split(',')[0].replace(/_/g, '-'));
  return result;
}

module.exports = { pageMetadata };
