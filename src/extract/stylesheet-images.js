'use strict';
const { parseHTML } = require('linkedom');
const { readResource, decodeBody } = require('../capture/http');
const { httpUrl, documentBase } = require('./images');

const unescapeCss = value => value.replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex, escaped) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : escaped);
function urls(value) {
  return [...value.matchAll(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s)]*))\s*\)/gi)].map(match => unescapeCss(match[1] ?? match[2] ?? match[3]));
}

// A bounded best-effort traversal, using the same guarded transport as images.
// Resource URL discovery never downloads the background images themselves.
async function stylesheetImages(html, pageUrl, options) {
  if (options.includeStylesheets === false || options.sources && !options.sources.includes('stylesheet')) return [];
  const { document } = parseHTML(html);
  const base = documentBase(document, pageUrl);
  const pending = []; const visited = new Set(); const seen = new Set(); const result = [];
  const enqueue = (value, origin, depth) => {
    const url = httpUrl(value, origin);
    if (url && depth <= 2 && !visited.has(url) && !pending.some(entry => entry.url === url)) pending.push({ url, depth });
  };
  function inspect(css, origin, depth) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/@import\s+(url\([^;]+?\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi)) {
      const value = /^url\(/i.test(match[1]) ? urls(match[1])[0] : unescapeCss(match[1].slice(1, -1));
      if (value) enqueue(value, origin, depth + 1);
    }
    for (const match of css.matchAll(/(?:^|[;{])\s*background(?:-image)?\s*:\s*([^;}]+)/gi)) {
      for (const value of urls(match[1])) {
        const url = httpUrl(value, origin);
        if (!url || options.unique !== false && seen.has(url)) continue;
        seen.add(url);
        result.push({ url, alt: '', width: null, height: null, source: 'stylesheet', originalAttribute: 'background-image', stylesheetUrl: origin, resolutionVerified: false });
      }
    }
  }
  for (const element of document.querySelectorAll('link[rel][href]')) {
    if (element.getAttribute('rel').toLowerCase().split(/\s+/).includes('stylesheet')) enqueue(element.getAttribute('href'), base, 0);
  }
  for (const element of document.querySelectorAll('style')) if (!element.closest('template, noscript')) inspect(element.textContent, base, -1);
  let bytes = 0;
  const resourceOptions = { ...options, observeResource: event => {
    if (event.phase === 'response') bytes += event.bytes;
    options.observeResource?.(event);
  } };
  while (pending.length && visited.size < 8 && bytes < 4 * 1024 * 1024) {
    options.signal?.throwIfAborted();
    const { url, depth } = pending.shift(); visited.add(url);
    try {
      const response = await readResource(url, resourceOptions, Math.min(512 * 1024, 4 * 1024 * 1024 - bytes));
      if (response.contentType && !/^(?:text\/css|text\/plain)(?:;|$)/i.test(response.contentType)) continue;
      const css = decodeBody(response.body, response.contentType);
      if (!/^\s*<(?:!doctype|html)/i.test(css)) inspect(css, response.url, depth);
    } catch (error) { if (options.signal?.aborted) throw error; }
  }
  return result;
}

module.exports = { stylesheetImages };
