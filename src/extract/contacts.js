'use strict';
const { parseHTML } = require('linkedom');
const { findPhoneNumbersInText, parsePhoneNumberFromString, isSupportedCountry } = require('libphonenumber-js/max');
const { htmlToText } = require('../utils/html');
const { objects } = require('../metrics/insights');
const { FetcharyValidationError } = require('../errors');

function validateDefaultCountry(value) {
  if (value !== undefined && (typeof value !== 'string' || !/^[A-Z]{2}$/.test(value) || !isSupportedCountry(value))) {
    throw new FetcharyValidationError('defaultCountry must be a supported uppercase two-letter country code such as AT');
  }
}

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
    inputs.push(decode(target));
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
      for (const value of [object[property]].flat()) if (typeof value === 'string') inputs.push(value.replace(/^(?:mailto|tel):/i, ''));
    }
  }
  for (const element of document.querySelectorAll('script')) element.remove();
  inputs.push(htmlToText(document.toString()));
  return inputs;
}

function emails(inputs) {
  const results = []; const seen = new Set();
  const pattern = /(?<![\p{L}\p{N}.!#$%&'*+/=?^_`{|}~@-])[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}-])/giu;
  for (const input of inputs) {
    for (const match of input.matchAll(pattern)) {
      const [local, domain] = match[0].split('@');
      if (!/^[\x00-\x7f]+$/.test(match[0]) || local.length > 64 || match[0].length > 254 || domain.split('.').some(label => label.length > 63)
        || !/[a-z]/i.test(domain.split('.').at(-1))) continue;
      const email = `${local}@${domain.toLowerCase()}`;
      const key = email.toLowerCase();
      if (!seen.has(key)) { seen.add(key); results.push(email); }
    }
  }
  return results;
}

function telephone(inputs, defaultCountry) {
  const results = []; const seen = new Set();
  function add(number) {
    if (!number?.isValid()) return;
    const value = number.getURI().slice(4);
    if (!seen.has(value)) { seen.add(value); results.push(value); }
  }
  for (const input of inputs) {
    const text = input.trim().replace(/^00(?=\d)/, '+');
    add(parsePhoneNumberFromString(text, { defaultCountry, extract: false }));
    for (const match of findPhoneNumbersInText(text, { defaultCountry })) add(match.number);
  }
  return results;
}

module.exports = { contactInputs, emails, telephone, validateDefaultCountry };
