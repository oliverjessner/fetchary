'use strict';
const { parseHTML } = require('linkedom');
const { phoneMatches, validateDefaultCountry } = require('./phone');
const { htmlToText } = require('../utils/html');
const { objects } = require('../metrics/insights');

function decode(value) {
  try { return decodeURIComponent(value); } catch { return ''; }
}

function contactInputs(content, type, html) {
  if (!html) return [content];
  const { document } = parseHTML(content);
  for (const element of document.querySelectorAll('style, noscript, template')) element.remove();
  const inputs = [];
  const scheme = type === 'emails' ? 'mailto' : 'tel';
  for (const link of document.querySelectorAll('a[href], area[href]')) {
    const href = link.getAttribute('href').trim();
    if (!href.toLowerCase().startsWith(`${scheme}:`)) continue;
    const [target, query = ''] = href.slice(scheme.length + 1).split('?');
    inputs.push(type === 'telephone' ? `tel:${decode(target)}` : decode(target));
    if (type === 'emails') {
      for (const header of query.split('&')) {
        const equal = header.indexOf('=');
        if (['cc', 'bcc'].includes(decode(header.slice(0, equal)).toLowerCase())) inputs.push(decode(header.slice(equal + 1)));
      }
    }
  }
  const property = type === 'emails' ? 'email' : 'telephone';
  for (const element of document.querySelectorAll('[itemprop]')) {
    if (element.getAttribute('itemprop').split(/\s+/).includes(property)) inputs.push(element.getAttribute('content') ?? element.textContent);
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let root;
    try { root = JSON.parse(script.textContent); } catch { continue; }
    for (const object of objects(root)) {
      for (const value of [object[property]].flat()) if (typeof value === 'string') inputs.push(type === 'telephone' ? value : value.replace(/^mailto:/i, ''));
    }
  }
  for (const element of document.querySelectorAll('script')) element.remove();
  inputs.push(htmlToText(document.toString()));
  return inputs;
}

function emailMatches(input, deobfuscate = false) {
  const results = [];
  const pattern = /(?<![\p{L}\p{N}.!#$%&'*+/=?^_`{|}~@-])[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}-])/giu;
  for (const match of input.matchAll(pattern)) {
    const [local, domain] = match[0].split('@');
    if (!/^[\x00-\x7f]+$/.test(match[0]) || local.length > 64 || match[0].length > 254 || domain.split('.').some(label => label.length > 63)
      || !/[a-z]/i.test(domain.split('.').at(-1))) continue;
    results.push({ value: `${local}@${domain.toLowerCase()}`, raw: match[0], index: match.index });
  }
  if (deobfuscate) {
    const obscured = /([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+)\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\})\s*([A-Z0-9-]+(?:\s*(?:\[\s*(?:dot|punkt)\s*\]|\(\s*(?:dot|punkt)\s*\)|\{\s*(?:dot|punkt)\s*\}|\.)\s*[A-Z0-9-]+)+)/gi;
    for (const match of input.matchAll(obscured)) {
      const domain = match[2].replace(/\s*(?:\[\s*(?:dot|punkt)\s*\]|\(\s*(?:dot|punkt)\s*\)|\{\s*(?:dot|punkt)\s*\}|\.)\s*/gi, '.');
      for (const found of emailMatches(`${match[1]}@${domain}`)) results.push({ ...found, raw: match[0], index: match.index });
    }
  }
  return results.sort((a, b) => a.index - b.index);
}

function emails(inputs, options = {}) {
  const results = []; const seen = new Set();
  for (const input of inputs) for (const { value } of emailMatches(input, options.deobfuscate === true)) {
    const key = value.toLowerCase();
    if (!seen.has(key)) { seen.add(key); results.push(value); }
  }
  return results;
}

async function telephone(inputs, defaultCountry, options = {}) {
  const results = []; const seen = new Set();
  for (const input of inputs) {
    for (const { value } of await phoneMatches(input, defaultCountry, options)) {
      if (!seen.has(value)) { seen.add(value); results.push(value); }
    }
  }
  return results;
}

function location(element, positions) {
  const parts = [];
  for (let node = element; node?.localName; node = node.parentElement) {
    let index = positions?.get(node);
    if (index === undefined) { index = 1; for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++; }
    parts.push(`${/^[a-z][a-z0-9-]*$/.test(node.localName) ? node.localName : '*'}:nth-child(${index})`);
  }
  return parts.reverse().join(' > ');
}
const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
const departmentPattern = /\b(?:presse(?:stelle|kontakt|team)?|press(?:\s+office)?|redaktion|editorial|vertrieb|sales|support|kundenservice|customer\s+service|marketing|buchhaltung|accounting|personal(?:abteilung)?|human\s+resources)\b/gi;
function withoutEmailAddresses(text) {
  for (const match of emailMatches(text, true)) text = text.slice(0, match.index) + ' '.repeat(match.raw.length) + text.slice(match.index + match.raw.length);
  return text;
}
const contextText = element => compact(htmlToText(element.outerHTML));
function nearbyContext(element, raw) {
  let selected = contextText(element);
  const boundary = element.closest('section, article, address');
  if (boundary === element) return element.querySelector('section, article, address') ? compact(raw) : selected;
  for (let node = element.parentElement, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
    if (['body', 'html'].includes(node.localName)) break;
    const text = contextText(node);
    if (!text || text.length > 400) break;
    if ([...node.querySelectorAll('section, article, address')].some(group => !group.contains(element))) break;
    selected = text;
    const index = text.toLowerCase().indexOf(compact(raw).toLowerCase());
    const labels = withoutEmailAddresses(index >= 0 ? text.slice(0, index) : text);
    if (node === boundary || /\b(?:fax|mobil|mobile|handy|telefon|telephone|festnetz)\b/i.test(labels) || [...labels.matchAll(departmentPattern)].length) break;
  }
  return selected;
}
function detailedInputs(content, type, html, options = {}) {
  if (!html) return [{ raw: content, context: content, location: null, explicitLabel: null }];
  const { document } = parseHTML(content);
  // Snapshot positions before removing ignored/inert content. Returned locators
  // still identify the original capture, including scoped contact extraction.
  const positions = new WeakMap();
  for (const parent of [document, ...document.querySelectorAll('*')]) [...parent.children].forEach((child, index) => positions.set(child, index + 1));
  const locate = element => location(element, positions);
  const includes = options.includeSelectors || [];
  const roots = includes.map(selector => document.querySelector(selector)).filter(Boolean);
  for (const selector of options.ignoreSelectors || []) for (const element of document.querySelectorAll(selector)) element.remove();
  const selected = roots.filter(root => document.contains(root));
  const inside = element => !includes.length || selected.some(root => root === element || root.contains(element));
  if (includes.length) {
    for (const element of document.querySelectorAll('*')) if (!selected.some(root => root === element || root.contains(element) || element.contains(root))) element.remove();
    const pending = [document];
    while (pending.length) {
      const node = pending.pop();
      if (node.nodeType === 3) { if (!inside(node.parentElement)) node.remove(); }
      else for (const child of [...node.childNodes]) pending.push(child);
    }
  }
  for (const element of document.querySelectorAll('style, noscript, template')) element.remove();
  const records = [];
  function add(raw, element, explicitLabel) {
    if (typeof raw !== 'string' || !raw.trim() || !inside(element)) return;
    records.push({ raw, context: nearbyContext(element, raw), location: locate(element), explicitLabel: explicitLabel || element.getAttribute('aria-label') || element.getAttribute('title') });
  }
  const scheme = type === 'emails' ? 'mailto' : 'tel';
  for (const element of document.querySelectorAll('a[href], area[href]')) {
    const href = element.getAttribute('href').trim();
    if (!href.toLowerCase().startsWith(`${scheme}:`)) continue;
    const [target, query = ''] = href.slice(scheme.length + 1).split('?');
    add(type === 'telephone' ? `tel:${decode(target)}` : decode(target), element);
    if (type === 'emails') for (const header of query.split('&')) {
      const equal = header.indexOf('=');
      if (['cc', 'bcc'].includes(decode(header.slice(0, equal)).toLowerCase())) add(decode(header.slice(equal + 1)), element);
    }
  }
  const property = type === 'emails' ? 'email' : 'telephone';
  for (const element of document.querySelectorAll('[itemprop]')) if (element.getAttribute('itemprop').split(/\s+/).includes(property)) add(element.getAttribute('content') ?? element.textContent, element);
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (!inside(script)) continue;
    let root;
    try { root = JSON.parse(script.textContent); } catch { continue; }
    for (const object of objects(root)) for (const value of [object[property]].flat()) if (typeof value === 'string') {
      const label = typeof object.contactType === 'string' ? object.contactType : typeof object.name === 'string' ? object.name : null;
      records.push({ raw: type === 'telephone' ? value : value.replace(/^mailto:/i, ''), context: label || '', location: `${locate(script)}.${property}`, explicitLabel: label });
    }
  }
  for (const script of document.querySelectorAll('script')) script.remove();
  const pending = [document];
  while (pending.length) {
    const node = pending.pop();
    if (node.nodeType === 3 && node.parentElement) add(node.nodeValue, node.parentElement);
    else for (const child of [...node.childNodes].reverse()) pending.push(child);
  }
  // Preserve extraction across inline elements, with unknown location/context.
  records.push({ raw: htmlToText(document.toString()), context: '', location: null, explicitLabel: null });
  return records;
}

async function extractContactDetails(content, type, options = {}) {
  const byValue = new Map();
  for (const input of detailedInputs(content, type, options.html !== false, options)) {
    let matches;
    if (type === 'emails') matches = emailMatches(input.raw, options.deobfuscate === true);
    else {
      matches = await phoneMatches(input.raw, options.defaultCountry, options);
    }
    for (const match of matches) {
      const context = compact(input.context);
      let raw = match.raw;
      let index = type === 'emails' ? context.toLowerCase().indexOf(compact(raw).toLowerCase()) : context.indexOf(compact(raw));
      if (type === 'telephone' && index < 0) {
        const visible = (await phoneMatches(context, options.defaultCountry, options)).find(item => item.value === match.value);
        if (visible) { index = visible.start; raw = visible.raw; }
      }
      const prefix = index >= 0 ? context.slice(Math.max(0, index - 100), index) : context;
      const labelledContext = `${withoutEmailAddresses(prefix)} ${withoutEmailAddresses(compact(input.explicitLabel))}`;
      const departments = [...labelledContext.matchAll(departmentPattern)];
      const department = departments.at(-1)?.[0] || null;
      const label = compact(input.explicitLabel) || compact(prefix).replace(/[:;,\s-]+$/, '') || null;
      const item = { value: match.value, raw, label: label?.slice(-160) || null, department, location: input.location };
      if (type === 'telephone') {
        const labels = [...labelledContext.matchAll(/\b(?:fax|mobil|mobile|handy|cell(?:phone)?|festnetz|landline|telefon|telephone|phone)\b/gi)];
        const marker = labels.at(-1)?.[0].toLowerCase();
        item.kind = marker === 'fax' ? 'fax' : /^(?:mobil|mobile|handy|cell)/.test(marker || '') ? 'mobile' : /^(?:festnetz|landline)$/.test(marker || '') ? 'landline' : null;
      }
      const key = type === 'emails' ? item.value.toLowerCase() : item.value;
      const previous = byValue.get(key);
      if (!previous) byValue.set(key, item);
      else for (const field of ['label', 'department', 'location', 'kind']) if (previous[field] == null && item[field] != null) previous[field] = item[field];
    }
  }
  return [...byValue.values()];
}

module.exports = { contactInputs, emails, telephone, validateDefaultCountry, extractContactDetails };
