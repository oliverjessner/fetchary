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
  const result = { title: null, description: null, canonical: null, language: null, publishedAt: null, modifiedAt: null };
  if (!document) return result;
  const base = documentBase(document, pageUrl);
  const meta = new Map();
  for (const element of document.querySelectorAll('meta[content]')) {
    if (element.closest('template, noscript')) continue;
    for (const attribute of ['name', 'property', 'http-equiv']) {
      const key = element.getAttribute(attribute)?.toLowerCase();
      const value = clean(element.getAttribute('content'));
      if (key && value && !meta.has(key)) meta.set(key, value);
    }
  }
  const first = keys => keys.map(key => meta.get(key)).find(Boolean) || null;
  result.title = clean([...document.querySelectorAll('title')].find(title => !title.closest('svg, template, noscript'))?.textContent) || first(['og:title','twitter:title']);
  result.description = first(['description','og:description','twitter:description']);
  for (const link of document.querySelectorAll('link[rel][href]')) {
    if (link.closest('template, noscript') || !link.getAttribute('rel').toLowerCase().split(/\s+/).includes('canonical')) continue;
    result.canonical = httpUrl(link.getAttribute('href'), base);
    if (result.canonical) break;
  }
  const html = document.querySelector('html');
  result.language = clean(html?.getAttribute('lang')) || clean(html?.getAttribute('xml:lang')) || first(['content-language','og:locale']);
  result.publishedAt = first(['article:published_time','datepublished','pubdate','publishdate','publish-date','publication_date','dcterms.issued','dc.date.issued','parsely-pub-date','date']);
  result.modifiedAt = first(['article:modified_time','og:updated_time','datemodified','last-modified','lastmodified','dcterms.modified','dc.date.modified']);

  const data = structuredData(document, pageUrl, maxBytes);
  const candidates = [];
  const pending = [...data.jsonLd];
  for (let index = 0; index < pending.length; index++) {
    const object = pending[index];
    if (!object || typeof object !== 'object' || Array.isArray(object)) continue;
    candidates.push(object);
    if (Array.isArray(object['@graph'])) pending.push(...object['@graph']);
    if (object.mainEntity && typeof object.mainEntity === 'object') pending.push(...[object.mainEntity].flat());
  }
  for (const item of data.microdata) candidates.push({ ...Object.fromEntries(Object.entries(item.properties).map(([name, values]) => [name, values[0]])), '@type': item.types, '@id': item.id });
  const pages = new Set([identity(pageUrl, base), identity(result.canonical, base)].filter(Boolean));
  const matching = []; const anonymous = [];
  for (const object of candidates) {
    const types = [object['@type']].flat().filter(value => typeof value === 'string').map(value => value.split(/[\/#:]/).at(-1));
    if (!types.some(type => /(?:Article|Page)$/.test(type) || ['BlogPosting','CreativeWork','Report'].includes(type))) continue;
    const declared = [field(object, 'mainEntityOfPage'), field(object, 'url'), object['@id']].map(value => identity(value, base)).find(Boolean);
    if (declared && !pages.has(declared)) continue;
    (declared ? matching : anonymous).push(object);
  }
  for (const object of [...matching, ...anonymous]) {
    result.title ||= scalar(field(object, 'headline')) || scalar(field(object, 'name'));
    result.description ||= scalar(field(object, 'description'));
    result.language ||= scalar(field(object, 'inLanguage'));
    result.publishedAt ||= scalar(field(object, 'datePublished'));
    result.modifiedAt ||= scalar(field(object, 'dateModified'));
  }
  result.publishedAt ||= clean([...document.querySelectorAll('time[pubdate][datetime]')].find(time => !time.closest('template, noscript'))?.getAttribute('datetime'));
  if (result.language) result.language = clean(result.language.split(',')[0].replace(/_/g, '-'));
  return result;
}

module.exports = { pageMetadata };
