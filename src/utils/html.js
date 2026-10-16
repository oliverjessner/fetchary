'use strict';

const { parseHTML } = require('linkedom');
function decodeEntities(value) { return parseHTML(`<div>${value}</div>`).document.querySelector('div').textContent; }

function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

function validateSelector(selector) {
  parseHTML('<html><body></body></html>').document.querySelector(selector);
}

function selectHtml(html, options = {}) {
  const includeSelectors = options.includeSelectors || [];
  const ignoreSelectors = options.ignoreSelectors || [];
  if (!includeSelectors.length && !ignoreSelectors.length) return String(html);
  const { document } = parseHTML(String(html));
  const selected = new Set(includeSelectors.map(selector => document.querySelector(selector)).filter(Boolean));
  const roots = [];
  const pending = selected.size ? [document] : [];
  while (pending.length) {
    const node = pending.pop();
    if (selected.has(node)) {
      roots.push(node);
      continue;
    }
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
  }
  for (const selector of ignoreSelectors) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }
  if (includeSelectors.length) {
    return roots.filter(node => document.contains(node)).map(node => node.outerHTML).join('\n');
  }
  return document.toString();
}

function selectText(html, options = {}) {
  return htmlToText(selectHtml(html, options));
}

module.exports = { htmlToText, validateSelector, selectHtml, selectText };
