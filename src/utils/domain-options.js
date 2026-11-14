'use strict';
const { FetcharyValidationError } = require('../errors');
const { validateUrl } = require('./url');

function domainRules(value, defaults, validate) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FetcharyValidationError('domainOptions must be an object keyed by hostname');
  const rules = {};
  for (const [pattern, settings] of Object.entries(value)) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new FetcharyValidationError('domainOptions entries must be option objects');
    const wildcard = pattern.startsWith('*.');
    const host = wildcard ? pattern.slice(2) : pattern;
    let url;
    try { url = new URL(`https://${host}`); } catch {}
    if (!url || !host || host !== host.trim() || /[\s/:@?#*\\]/.test(host) || url.port || url.pathname !== '/') throw new FetcharyValidationError('domainOptions keys must be hostnames or *.hostname patterns');
    for (const key of ['domainOptions', 'maxEntries', 'maxCacheBytes']) if (Object.hasOwn(settings, key)) throw new FetcharyValidationError(`${key} is not a domain override`);
    const normalized = validate({ ...defaults, ...settings });
    const key = `${wildcard ? '*.' : ''}${url.hostname}`;
    if (Object.hasOwn(rules, key)) throw new FetcharyValidationError('duplicate normalized domainOptions hostname');
    Object.defineProperty(rules, key, { value: { ...settings,
      ...(settings.blockedResourceTypes === undefined ? {} : { blockedResourceTypes: normalized.blockedResourceTypes }),
      ...(settings.headers === undefined ? {} : { headers: normalized.headers }) }, enumerable: true });
  }
  return rules;
}

function optionsForDomain(url, defaults, overrides) {
  const hostname = new URL(validateUrl(url)).hostname;
  const matches = Object.entries(defaults.domainOptions || {}).filter(([pattern]) => pattern.startsWith('*.')
    ? hostname !== pattern.slice(2) && hostname.endsWith(pattern.slice(1)) : hostname === pattern);
  matches.sort(([a], [b]) => Number(!a.startsWith('*.')) - Number(!b.startsWith('*.')) || a.length - b.length);
  return Object.assign({}, defaults, ...matches.map(([, settings]) => settings), overrides);
}

module.exports = { domainRules, optionsForDomain };
