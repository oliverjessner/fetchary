'use strict';

// A deliberately small, non-evaluating lexer. Only literal configuration is
// resolved; comments, template strings and code inside quoted strings are inert.
function tokenize(code, budget) {
  const tokens = [];
  const pattern = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|<!--[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s]/gy;
  let match;
  while ((match = pattern.exec(code))) {
    const raw = match[0];
    if (/^(?:\s|\/\/|\/\*|<!--)/.test(raw)) continue;
    if (budget.remaining-- <= 0) break;
    if (raw === '/' && (!tokens.length || ['=', '(', ',', ':', '[', '!', 'return', ';', '{', '}', ')'].includes(tokens.at(-1).value))) {
      let cursor = pattern.lastIndex; let characterClass = false;
      while (cursor < code.length) {
        const char = code[cursor++];
        if (char === '\\') { cursor++; continue; }
        if (char === '[') characterClass = true;
        if (char === ']') characterClass = false;
        if (char === '/' && !characterClass || char === '\n') break;
      }
      pattern.lastIndex = cursor;
      tokens.push({ type: 'unknown', value: '' }); continue;
    }
    if (raw[0] === '`') { tokens.push({ type: 'unknown', value: '' }); continue; }
    if (/^["']/.test(raw)) {
      const value = raw.slice(1, -1).replace(/\\(?:x([\da-f]{2})|u([\da-f]{4})|([\s\S]))/gi, (_, hex, unicode, char) => hex || unicode ? String.fromCharCode(parseInt(hex || unicode, 16)) : ({ n:'\n', r:'\r', t:'\t' }[char] ?? char));
      tokens.push({ type: 'literal', value });
    } else tokens.push({ type: /^\d/.test(raw) ? 'literal' : /^[\w$]/.test(raw) ? 'name' : 'punctuation', value: raw });
  }
  return tokens;
}

function expression(tokens, start, variables) {
  let index = start; let value = '';
  do {
    const token = tokens[index++];
    if (!token || !['literal','name'].includes(token.type)) return null;
    const part = token.type === 'literal' ? token.value : variables.get(token.value);
    if (part === undefined || part === null) return null;
    value += part;
    if (value.length > 4096) return null;
  } while (tokens[index]?.value === '+' && ++index);
  if (![';', ',', ')', ']', '}', undefined].includes(tokens[index]?.value)) return null;
  return value;
}

function javascript(code, budget = { remaining: 200_000 }) {
  const tokens = tokenize(code, budget);
  const variables = new Map();
  const assignments = [];
  const closing = new Map(); const separators = new Map(); const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'punctuation') continue;
    const value = tokens[i].value;
    if (['(', '[', '{'].includes(value)) { stack.push(i); separators.set(i, []); }
    else if ([')', ']', '}'].includes(value) && stack.length) closing.set(stack.pop(), i);
    else if (value === ',' && stack.length) separators.get(stack.at(-1)).push(i);
  }
  // Sequential literal assignments suffice for common vendor bootstrap snippets.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'name' && tokens[i + 1]?.value === '=' && tokens[i + 2]?.value !== '=') {
      const value = expression(tokens, i + 2, variables);
      variables.set(tokens[i].value, variables.has(tokens[i].value) && variables.get(tokens[i].value) !== value ? null : value);
      assignments.push({ name: tokens[i].value, value, index: i });
    }
  }
  function calls(name) {
    const parts = name.split('.'); const results = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'name' || tokens[i].value !== parts[0]) continue;
      let cursor = i + 1;
      for (const part of parts.slice(1)) {
        if (tokens[cursor]?.value !== '.' || tokens[cursor + 1]?.value !== part) { cursor = -1; break; }
        cursor += 2;
      }
      if (cursor < 0 || tokens[cursor]?.value !== '(') continue;
      if (!closing.has(cursor)) continue;
      const positions = [cursor + 1, ...separators.get(cursor).map(index => index + 1)];
      results.push({ args: positions.map(start => expression(tokens, start, variables)), positions, index: i, end: closing.get(cursor) });
    }
    return results;
  }
  return { tokens, variables, assignments, calls, closing, expression: start => expression(tokens, start, variables) };
}
module.exports = { javascript };
