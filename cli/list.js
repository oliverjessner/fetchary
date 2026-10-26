'use strict';
const { parseHTML } = require('linkedom');
const { httpUrl, documentBase } = require('../src/extract/images');
const { shouldRender } = require('../src/capture');
const { selectHtml } = require('../src/utils/html');
const { validateSelectors } = require('../src/utils/options');

function listCaptureOptions(options) {
  if (options.type === 'selector') return { ...options, all: true };
  if (!['text', 'html'].includes(options.type)) return options;
  validateSelectors(options.includeSelectors ?? [], 'include');
  validateSelectors(options.ignoreSelectors ?? [], 'ignore');
  // Keep the document base and link attributes until the list is formatted.
  return { ...options, type: 'html', includeSelectors: [], ignoreSelectors: [] };
}

function pageUrls(result, options) {
  const urls = []; const seen = new Set();
  function add(value, base) {
    const url = httpUrl(value, base);
    if (url && !seen.has(url)) { seen.add(url); urls.push(url); }
  }
  if (shouldRender(result.contentType)) {
    const { document } = parseHTML(result.content);
    const base = documentBase(document, result.finalUrl);
    const selected = options.includeSelectors?.length || options.ignoreSelectors?.length
      ? parseHTML(selectHtml(result.content, options)).document : document;
    for (const element of selected.querySelectorAll('a[href], area[href]')) add(element.getAttribute('href'), base);
  } else {
    for (const match of result.content.matchAll(/https?:\/\/[^\s<>"']+/g)) add(match[0], result.finalUrl);
  }
  return urls;
}

function listItems(result, options = {}) {
  switch (result.type) {
    case 'analyse': return [...new Set(Object.values(result.results).flatMap(section => section ? listItems(section) : []))];
    case 'text': case 'html': return pageUrls(result, options);
    case 'images': case 'social-links': return result.data.map(item => item.url);
    case 'links': case 'documents': case 'videos': return [...new Set(result.data.map(item => item.url))];
    case 'emails': case 'telephone': return result.data;
    case 'metadata': return Object.values(result.data).filter(value => value !== null);
    case 'price': return result.data.candidates.map(candidate => [candidate.amount,candidate.currency || '-',candidate.role,
      JSON.stringify(candidate.evidence)].join('\t'));
    case 'tracker-intelligence': return result.data.trackers.flatMap(tracker => tracker.identifiers.length
      ? tracker.identifiers.map(id => id.kind === 'site-id' && tracker.provider === 'matomo'
        ? `matomo:${id.scope ? encodeURIComponent(id.scope) : 'unscoped'}:${id.value}` : `${tracker.provider}:${id.value}`)
      : [tracker.provider]);
    case 'structured-data': return [...result.data.jsonLd, ...result.data.microdata].map(value => JSON.stringify(value));
    case 'favicon': case 'avatar': return [result.image.url];
    case 'selector': return result.data.values.filter(value => value !== null).map(value => value.replace(/[\r\n]+/g, ' ').trim()).filter(Boolean);
    case 'social-insights': return [result.data.url];
  }
}

module.exports = { listItems, listCaptureOptions };
