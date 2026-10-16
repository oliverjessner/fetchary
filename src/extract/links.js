'use strict';
const { httpUrl, documentBase } = require('./images');
const { htmlToText } = require('../utils/html');

function locationSelectors() {
  const selectors = new WeakMap(); const positions = new WeakMap();
  return element => {
    const pending = [];
    let node = element;
    while (node && !selectors.has(node)) { pending.push(node); node = node.parentElement; }
    let prefix = node ? selectors.get(node) : '';
    for (const current of pending.reverse()) {
      if (!positions.has(current)) {
        let index = 0;
        for (const sibling of current.parentNode.children) positions.set(sibling, ++index);
      }
      const tag = /^[a-z][a-z0-9-]*$/.test(current.localName) ? current.localName : '*';
      const part = `${tag}:nth-child(${positions.get(current)})`;
      prefix = prefix ? `${prefix} > ${part}` : part;
      selectors.set(current, prefix);
    }
    return prefix;
  };
}

function* linkOccurrences(document, pageUrl, options = {}, includeEmbeds = false) {
  const base = documentBase(document, pageUrl);
  const origin = new URL(pageUrl).origin;
  const included = (options.includeSelectors || []).map(selector => document.querySelector(selector)).filter(Boolean);
  const ignored = (options.ignoreSelectors || []).flatMap(selector => [...document.querySelectorAll(selector)]);
  const selector = locationSelectors();
  const query = 'a[href], area[href], link[href]' + (includeEmbeds ? ', iframe[src], embed[src], object[data]' : '');
  for (const element of document.querySelectorAll(query)) {
    if (element.closest('template, noscript, script, style')) continue;
    if (options.includeSelectors?.length && !included.some(root => root.contains(element))) continue;
    if (ignored.some(root => root.contains(element))) continue;
    const attribute = element.localName === 'object' ? 'data' : ['iframe', 'embed'].includes(element.localName) ? 'src' : 'href';
    const rawUrl = element.getAttribute(attribute);
    const url = httpUrl(rawUrl.trim() ? rawUrl : new URL('', base).href, base);
    if (!url) continue;
    const text = htmlToText(element.outerHTML) || element.getAttribute('aria-label') || element.getAttribute('alt')
      || [...element.querySelectorAll('img[alt]')].map(image => image.getAttribute('alt')).join(' ').trim() || element.getAttribute('title') || '';
    yield { element, link: {
      url, rawUrl, text: text.replace(/\s+/g, ' ').trim(),
      rel: [...new Set((element.getAttribute('rel') || '').toLowerCase().split(/\s+/).filter(Boolean))],
      internal: new URL(url).origin === origin, source: element.localName,
      location: { pageUrl, selector: selector(element), attribute },
    } };
  }
}

function pageLinks(document, pageUrl, options) {
  return [...linkOccurrences(document, pageUrl, options)].map(occurrence => occurrence.link);
}

module.exports = { pageLinks, linkOccurrences };
