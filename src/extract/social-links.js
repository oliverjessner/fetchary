'use strict';
const { httpUrl, documentBase } = require('./images');
const { domains, classifyUrl } = require('../utils/social');
const { objects } = require('../metrics/insights');
const { FetcharyValidationError } = require('../errors');

function socialLinks(document, pageUrl, options = {}) {
  const filter = options.platform === 'twitter' ? 'x' : options.platform;
  if (filter !== undefined && !Object.hasOwn(domains, filter)) throw new FetcharyValidationError('unsupported social platform');
  const base = documentBase(document, pageUrl);
  const results = []; const seen = new Set();
  function add(value, source) {
    const url = httpUrl(value, base);
    if (!url || new URL(url).username || new URL(url).password) return;
    const { platform, kind } = classifyUrl(url);
    if (!platform || filter && platform !== filter || seen.has(url)) return;
    seen.add(url); results.push({ platform, url, kind, source });
  }
  for (const element of document.querySelectorAll('a[href], area[href], link[rel~="me"][href], meta[property="og:url"], meta[property="og:see_also"], meta[name="twitter:url"]')) {
    add(element.getAttribute('href') || element.getAttribute('content'), element.localName === 'meta' ? 'metadata' : element.localName === 'link' ? 'rel-me' : 'link');
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let root;
    try { root = JSON.parse(script.textContent); } catch { continue; }
    for (const object of objects(root)) for (const value of [object.sameAs].flat()) if (typeof value === 'string') add(value, 'json-ld');
  }
  return results;
}
module.exports = { socialLinks };
