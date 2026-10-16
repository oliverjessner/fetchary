'use strict';
const { httpUrl, documentBase } = require('./images');
const { FetcharyValidationError } = require('../errors');
const sources = ['img','srcset','lazy','metadata','link','background'];

function srcsetUrls(value) {
  // Data URLs can contain commas; consume each whole candidate before filtering.
  const urls = []; let remaining = String(value || '').trim();
  while (remaining) {
    const match = remaining.match(/^(\S+)/);
    if (!match) break;
    const token = match[1]; remaining = remaining.slice(token.length).trimStart();
    if (!token.startsWith('data:')) urls.push(token.replace(/,+$/, ''));
    if (!token.endsWith(',')) remaining = remaining.replace(/^[^,]*(?:,|$)/, '').trimStart();
  }
  return urls;
}

function imageLinks(document, pageUrl, options = {}) {
  const filters = options.sources;
  if (filters !== undefined && (!Array.isArray(filters) || filters.some(source => !sources.includes(source)))) throw new FetcharyValidationError('sources must be an array of image source names');
  const base = documentBase(document, pageUrl);
  const results = []; const seen = new Set();
  const dimension = value => /^\d+$/.test(value || '') && Number(value) > 0 ? Number(value) : null;
  function add(value, element, source, originalAttribute) {
    if (filters && !filters.includes(source) || options.includeMetadata === false && source === 'metadata') return;
    const url = httpUrl(value, base);
    if (!url || options.unique !== false && seen.has(url)) return;
    seen.add(url);
    results.push({ url, alt: element.getAttribute('alt') || '', width: dimension(element.getAttribute('width')),
      height: dimension(element.getAttribute('height')), source, originalAttribute, resolutionVerified: false });
  }
  for (const element of document.querySelectorAll('img, picture source, meta, a[href], [style]')) {
    if (element.localName === 'img' || element.localName === 'source') {
      if (element.localName === 'img') add(element.getAttribute('src'), element, 'img', 'src');
      for (const name of ['srcset','data-srcset']) for (const value of srcsetUrls(element.getAttribute(name))) add(value, element, name === 'srcset' ? 'srcset' : 'lazy', name);
      for (const name of ['data-src','data-original','data-lazy-src','data-lazy','data-url']) add(element.getAttribute(name), element, 'lazy', name);
    }
    if (element.localName === 'meta' && /^(?:og:image(?::url|:secure_url)?|twitter:image(?::src)?)$/i.test(element.getAttribute('property') || element.getAttribute('name') || '')) add(element.getAttribute('content'), element, 'metadata', 'content');
    if (element.localName === 'a' && /\.(?:avif|gif|ico|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(element.getAttribute('href'))) add(element.getAttribute('href'), element, 'link', 'href');
    const style = element.getAttribute('style') || '';
    for (const declaration of style.split(';')) {
      if (!/^\s*background(?:-image)?\s*:/i.test(declaration)) continue;
      for (const match of declaration.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)) add(match[1] || match[2] || match[3], element, 'background', 'style');
    }
  }
  return results;
}
module.exports = { imageLinks, srcsetUrls };
