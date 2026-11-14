'use strict';
const { documentBase } = require('./images');

const tokens = value => [...new Set((value || '').trim().split(/\s+/).filter(Boolean))];
function resolveUrl(value, base) {
  try { return new URL(value, base).href; } catch { return ''; }
}
function checkDepth(root) {
  const pending = [[root, 0]];
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (depth > 128) throw new Error('JSON-LD nesting exceeds 128 levels');
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push([child, depth + 1]);
  }
}

// A local, serializable entity table, not remote JSON-LD context expansion.
// References remain @id handles so cyclic graphs never create cyclic JSON.
function resolvedEntities(jsonLd, pageUrl, errors) {
  const entities = {}; const roots = [];
  const processed = new WeakSet(); const anonymous = new WeakMap(); const reserved = new Set();
  let next = 0; let remaining = 10000;
  const id = value => typeof value === 'string' && value.trim() ? value.startsWith('_:') ? value : resolveUrl(value, pageUrl) || value : null;
  const pending = [...jsonLd];
  for (let index = 0; index < pending.length && index < 10000; index++) {
    const value = pending[index];
    if (!value || typeof value !== 'object') continue;
    const declared = id(value['@id']);
    if (declared) reserved.add(declared);
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  function tick(depth) {
    if (--remaining < 0) throw new Error('resolved JSON-LD exceeds 10000 values');
    if (depth > 64) throw new Error('resolved JSON-LD nesting exceeds 64 levels');
  }
  function define(object, key, value) {
    Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
  }
  function merge(previous, incoming) {
    const values = [...(Array.isArray(previous) ? previous : [previous]), ...(Array.isArray(incoming) ? incoming : [incoming])];
    const seen = new Set();
    const unique = values.filter(value => { const key = JSON.stringify(value); if (seen.has(key)) return false; seen.add(key); return true; });
    return unique.length === 1 && !Array.isArray(previous) && !Array.isArray(incoming) ? unique[0] : unique;
  }
  function entity(object, depth) {
    tick(depth);
    let identifier = id(object['@id']) || anonymous.get(object);
    if (!identifier) {
      do { identifier = `_:fetchary-anonymous-${++next}`; } while (reserved.has(identifier));
      reserved.add(identifier); anonymous.set(object, identifier);
    }
    if (!Object.hasOwn(entities, identifier)) define(entities, identifier, { id: identifier, types: [], properties: {} });
    if (processed.has(object)) return identifier;
    processed.add(object);
    const result = entities[identifier];
    for (const type of [object['@type']].flat()) if (typeof type === 'string' && !result.types.includes(type)) result.types.push(type);
    for (const [key, raw] of Object.entries(object)) {
      if (['@context', '@id', '@type'].includes(key)) continue;
      const resolved = value(raw, depth + 1);
      define(result.properties, key, Object.hasOwn(result.properties, key) ? merge(result.properties[key], resolved) : resolved);
    }
    return identifier;
  }
  function value(raw, depth) {
    tick(depth);
    if (Array.isArray(raw)) return raw.map(item => value(item, depth + 1));
    if (!raw || typeof raw !== 'object') return raw;
    if (typeof raw['@id'] === 'string' || raw['@type'] !== undefined) return { '@id': entity(raw, depth + 1) };
    const result = {};
    for (const [key, item] of Object.entries(raw)) if (key !== '@context') define(result, key, value(item, depth + 1));
    return result;
  }
  try {
    for (const object of jsonLd) {
      const graphOnly = Array.isArray(object['@graph']) && Object.keys(object).every(key => ['@context', '@graph'].includes(key));
      for (const root of graphOnly ? object['@graph'] : [object]) {
        if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
        const identifier = entity(root, 0);
        if (!roots.includes(identifier)) roots.push(identifier);
      }
    }
  } catch (error) { errors.push({ source: 'json-ld', index: 0, message: error.message }); }
  return { roots, entities };
}

function structuredData(document, pageUrl, maxBytes = 10 * 1024 * 1024, rawJson) {
  const jsonLd = []; const microdata = []; const errors = [];
  const blocks = rawJson !== undefined ? [rawJson] : [...(document?.querySelectorAll('script[type]') || [])]
    .filter(script => script.getAttribute('type').split(';')[0].trim().toLowerCase() === 'application/ld+json' && !script.closest('template, noscript'))
    .map(script => script.textContent);
  for (const [index, text] of blocks.entries()) {
    try {
      const root = JSON.parse(text.replace(/^\uFEFF/, '').trim());
      checkDepth(root);
      for (const value of Array.isArray(root) ? root : [root]) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push({ source: 'json-ld', index, message: 'JSON-LD entries must be objects' });
        else jsonLd.push(value);
      }
    } catch (error) { errors.push({ source: 'json-ld', index, message: error.message }); }
  }
  const base = document ? documentBase(document, pageUrl) : pageUrl;
  const resolved = resolvedEntities(jsonLd, base, errors);
  if (!document) return { jsonLd, microdata, errors, resolved };

  const order = new Map([...document.querySelectorAll('*')].map((element, index) => [element, index]));
  const scopes = [...document.querySelectorAll('[itemscope]')].filter(element => !element.closest('template, noscript'));
  const indices = new Map(scopes.map((element, index) => [element, index]));
  const active = new Set(); const issues = new Set();
  let remaining = 10000; let characters = maxBytes;
  function issue(root, message) {
    const index = indices.get(root);
    const key = `${index}:${message}`;
    if (!issues.has(key)) { issues.add(key); errors.push({ source: 'microdata', index, message }); }
  }
  function properties(root) {
    const seen = new Set([root]); const found = [];
    const pending = [...root.children];
    for (const id of tokens(root.getAttribute('itemref'))) {
      const referenced = document.getElementById(id);
      if (referenced) pending.push(referenced);
      else issue(root, `missing itemref target: ${id}`);
    }
    for (let index = 0; index < pending.length; index++) {
      const element = pending[index];
      if (seen.has(element)) { issue(root, 'repeated or cyclic itemref traversal'); continue; }
      seen.add(element);
      if (element.closest('template, noscript')) continue;
      if (!element.hasAttribute('itemscope')) for (const child of element.children) pending.push(child);
      if (tokens(element.getAttribute('itemprop')).length) found.push(element);
    }
    return found.sort((a, b) => order.get(a) - order.get(b));
  }
  function value(element, depth) {
    if (element.hasAttribute('itemscope')) return item(element, depth + 1);
    const tag = element.localName;
    if (tag === 'meta') return element.getAttribute('content') || '';
    const attribute = ['a','area','link'].includes(tag) ? 'href' : ['audio','embed','iframe','img','source','track','video'].includes(tag) ? 'src' : tag === 'object' ? 'data' : null;
    if (attribute) return element.hasAttribute(attribute) ? resolveUrl(element.getAttribute(attribute), base) : '';
    if (tag === 'data' || tag === 'meter') return element.getAttribute('value') || '';
    if (tag === 'time') return element.getAttribute('datetime') ?? element.textContent.trim();
    return element.textContent || '';
  }
  function item(root, depth) {
    if (active.has(root)) { issue(root, 'cyclic nested item reference'); return null; }
    if (depth > 64) { issue(root, 'microdata nesting exceeds 64 levels'); return null; }
    active.add(root);
    try {
      const result = { types: tokens(root.getAttribute('itemtype')), id: root.hasAttribute('itemid') ? resolveUrl(root.getAttribute('itemid'), base) || null : null, properties: {} };
      for (const element of properties(root)) {
        for (const name of tokens(element.getAttribute('itemprop'))) {
          if (--remaining < 0) throw new Error('microdata exceeds 10000 property values');
          // Build each named value independently, keeping expansion bounded.
          const property = value(element, depth);
          characters -= name.length + (typeof property === 'string' ? property.length : 0);
          if (characters < 0) throw new Error('microdata property text exceeds maxResponseBytes');
          if (!Object.hasOwn(result.properties, name)) Object.defineProperty(result.properties, name, { value: [], enumerable: true, writable: true, configurable: true });
          result.properties[name].push(property);
        }
      }
      return result;
    } finally { active.delete(root); }
  }
  for (const scope of scopes.filter(element => !element.hasAttribute('itemprop'))) {
    try { microdata.push(item(scope, 0)); } catch (error) { issue(scope, error.message); }
  }
  return { jsonLd, microdata, errors, resolved };
}

module.exports = { structuredData };
