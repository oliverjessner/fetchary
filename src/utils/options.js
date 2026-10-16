'use strict';
const { FetcharyValidationError } = require('../errors');
const { validateSelector } = require('./html');
const DEFAULT_WAIT_AFTER_LOAD_MS = 5000;

function parseWaitAfterLoad(value) {
  if (value == null) return DEFAULT_WAIT_AFTER_LOAD_MS;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new FetcharyValidationError('wait after load must be a non-negative duration such as "500ms" or "5s"', { waitAfterLoad: value });
    return value;
  }
  if (typeof value !== 'string') throw new FetcharyValidationError('wait after load must be a non-negative duration such as "500ms" or "5s"', { waitAfterLoad: value });
  const match = value.trim().match(/^(\d+)(ms|s)$/);
  if (!match) throw new FetcharyValidationError('wait after load must be a non-negative duration such as "500ms" or "5s"', { waitAfterLoad: value });
  const amount = Number(match[1]);
  const milliseconds = amount * (match[2] === 's' ? 1_000 : 1);
  if (!Number.isSafeInteger(milliseconds)) throw new FetcharyValidationError('wait after load duration is too large', { waitAfterLoad: value });
  return milliseconds;
}

function validateSelectors(value, kind) {
  if (!Array.isArray(value)) throw new FetcharyValidationError(`${kind}Selectors must be an array of CSS selectors`);
  const selectors = [];
  const seen = new Set();
  for (const rawSelector of value) {
    const selector = typeof rawSelector === 'string' ? rawSelector.trim() : '';
    if (!selector) {
      throw new FetcharyValidationError(`invalid ${kind} selector ${JSON.stringify(typeof rawSelector === 'string' ? rawSelector : String(rawSelector))}`, { selector: rawSelector });
    }
    try { validateSelector(selector); } catch (cause) {
      throw new FetcharyValidationError(`invalid ${kind} selector ${JSON.stringify(selector)}`, { cause, selector });
    }
    if (!seen.has(selector)) {
      seen.add(selector);
      selectors.push(selector);
    }
  }
  return selectors;
}

module.exports = { parseWaitAfterLoad, validateSelectors };
