'use strict';

const crypto = require('node:crypto');
const { parseHTML } = require('linkedom');

const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    try { return String.fromCodePoint(point); } catch { return entity; }
  });
}

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
  parseHTML('<html><body></body></html>').document.querySelectorAll(selector);
}

function comparisonHtml(html, options = {}) {
  const includeSelectors = options.includeSelectors || [];
  const ignoreSelectors = options.ignoreSelectors || [];
  if (!includeSelectors.length && !ignoreSelectors.length) return String(html);
  const { document } = parseHTML(String(html));
  const selected = new Set(includeSelectors.length ? document.querySelectorAll(includeSelectors.join(', ')) : []);
  const roots = [...selected].filter(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (selected.has(parent)) return false;
    }
    return true;
  });
  for (const selector of ignoreSelectors) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }
  if (includeSelectors.length) {
    return roots.filter(node => document.contains(node)).map(node => node.outerHTML).join('\n');
  }
  return document.toString();
}

function comparisonText(html, options = {}) {
  return htmlToText(comparisonHtml(html, options));
}

function comparisonElementRecords(html, options = {}) {
  const mode = options.mode ?? 'content';
  const { document } = parseHTML(mode === 'content' ? comparisonHtml(html, options) : String(html));

  const elements = [];
  const collect = element => {
    if (mode === 'content' && ['SCRIPT', 'STYLE'].includes(element.tagName)) return;
    const hasDirectText = [...element.childNodes].some(node => node.nodeType === 3 && /\S/.test(node.textContent));
    const value = element.outerHTML.replace(/\r\n?/g, '\n').replace(/\s*\n\s*/g, ' ');

    if (mode === 'raw') {
      if (element.children.length && !hasDirectText) {
        const openingTag = value.match(/^<[^>]+>/)?.[0] || `<${element.localName}>`;
        elements.push({ key: `${openingTag}</${element.localName}>`, value });
        for (const child of element.children) collect(child);
      } else {
        elements.push({ key: value, value });
      }
      return;
    }

    const start = elements.length;
    if (!hasDirectText) {
      for (const child of element.children) collect(child);
    }
    if (hasDirectText || (elements.length === start && comparisonText(element.outerHTML))) {
      elements.push({ key: comparisonText(element.outerHTML), value });
    }
  };

  const roots = document.documentElement?.tagName === 'HTML' ? document.body.children : document.children;
  for (const element of roots) {
    if (element.tagName === 'HTML') {
      for (const child of element.querySelectorAll('body > *')) collect(child);
    } else {
      collect(element);
    }
  }
  if (elements.length) return elements;
  const value = mode === 'raw' ? String(html) : comparisonText(document.toString());
  return value ? [{ key: value, value }] : [];
}

function comparisonHash(html, options = {}) {
  return crypto.createHash('sha256').update(comparisonText(html, options)).digest('hex');
}

function textHash(html) {
  return comparisonHash(html);
}

function lines(value) {
  if (!value) return [];
  return String(value).replace(/\r\n?/g, '\n').split('\n');
}

// LCS diff. For exceptionally large inputs a prefix/suffix fallback keeps
// memory bounded while preserving a useful, deterministic result.
function sequenceDiff(left, right, key = value => value) {
  const leftKeys = left.map(key);
  const rightKeys = right.map(key);
  if (left.length * right.length > 4_000_000) {
    let start = 0;
    while (start < left.length && start < right.length && leftKeys[start] === rightKeys[start]) start++;
    let leftEnd = left.length - 1;
    let rightEnd = right.length - 1;
    while (leftEnd >= start && rightEnd >= start && leftKeys[leftEnd] === rightKeys[rightEnd]) {
      leftEnd--;
      rightEnd--;
    }
    return [
      ...left.slice(start, leftEnd + 1).map(value => ({ type: 'removed', value })),
      ...right.slice(start, rightEnd + 1).map(value => ({ type: 'added', value })),
    ];
  }

  const width = right.length + 1;
  const table = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const offset = i * width + j;
      table[offset] = leftKeys[i] === rightKeys[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[offset + 1]);
    }
  }

  const result = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && leftKeys[i] === rightKeys[j]) {
      i++;
      j++;
    } else if (j >= right.length || (i < left.length && table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      result.push({ type: 'removed', value: left[i++] });
    } else {
      result.push({ type: 'added', value: right[j++] });
    }
  }
  return result;
}

function lineDiff(before, after) {
  return sequenceDiff(lines(before), lines(after));
}

function elementDiff(before, after, options = {}) {
  const left = comparisonElementRecords(before, options);
  const right = comparisonElementRecords(after, options);
  return sequenceDiff(left, right, element => element.key)
    .map(part => ({ type: part.type, value: part.value.value }));
}

module.exports = {
  htmlToText,
  textHash,
  validateSelector,
  comparisonHtml,
  comparisonText,
  comparisonHash,
  lineDiff,
  elementDiff,
};
