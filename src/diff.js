'use strict';

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

function lines(value) {
  if (!value) return [];
  return String(value).replace(/\r\n?/g, '\n').split('\n');
}

// Line-based LCS. For exceptionally large inputs a prefix/suffix fallback keeps
// memory bounded while preserving a useful, deterministic result.
function lineDiff(before, after) {
  const left = lines(before);
  const right = lines(after);
  if (left.length * right.length > 4_000_000) {
    let start = 0;
    while (start < left.length && start < right.length && left[start] === right[start]) start++;
    let leftEnd = left.length - 1;
    let rightEnd = right.length - 1;
    while (leftEnd >= start && rightEnd >= start && left[leftEnd] === right[rightEnd]) {
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
      table[offset] = left[i] === right[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[offset + 1]);
    }
  }

  const result = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
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

module.exports = { htmlToText, lineDiff };
