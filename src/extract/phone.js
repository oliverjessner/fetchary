'use strict';

const { FetcharyValidationError } = require('../errors');

let phoneApi;
function loadPhoneApi() {
  // The package exposes native ESM entry points. Keep Fetchary's CommonJS API
  // and load worldwide metadata only when phone extraction needs it.
  return phoneApi ??= Promise.all([
    import('@oliverj/parse-phone-number/all'),
    import('@oliverj/parse-phone-number/extract'),
  ]).then(([{ phoneParser }, { iteratePhoneNumbers }]) => {
    const zeroTrunkCodes = new Map();
    for (const id of phoneParser.getMetadataInfo().supportedNumberingPlans) {
      const plan = phoneParser.getCountryMetadata(id);
      zeroTrunkCodes.set(plan.callingCode, (zeroTrunkCodes.get(plan.callingCode) ?? true) && plan.nationalPrefix === '0');
    }
    return { phoneParser, iteratePhoneNumbers, zeroTrunkCodes };
  })
    .catch(error => { phoneApi = undefined; throw error; });
}

async function validateDefaultCountry(value) {
  if (value === undefined) return;
  const invalid = () => new FetcharyValidationError('defaultCountry must be a supported uppercase two-letter country code such as AT');
  if (typeof value !== 'string' || !/^[A-Z]{2}$/.test(value)) throw invalid();
  const { phoneParser } = await loadPhoneApi();
  if (phoneParser.getCountryMetadata(value)?.country !== value) throw invalid();
}

function interpret({ phoneParser, zeroTrunkCodes }, input, defaultCountry) {
  const options = { defaultCountry, profile: 'strict' };
  let parsed = phoneParser.parse(input, options);
  let validation = phoneParser.validate(parsed.ok ? parsed.value : input, options);
  // Preserve an explicitly optional trunk prefix only for a plan that actually
  // uses it. Italian significant zeroes must remain part of the phone number.
  if (validation.status !== 'valid') {
    const prefix = /^(tel:)?\+([1-9]\d{0,2})[\s.-]*\(0\)/i.exec(input);
    if (prefix && zeroTrunkCodes.get(prefix[2])) {
      const normalized = `${prefix[1] || ''}+${prefix[2]}${input.slice(prefix[0].length)}`;
      const alternative = phoneParser.parse(normalized, options);
      const checked = phoneParser.validate(alternative.ok ? alternative.value : normalized, options);
      if (checked.status === 'valid') { parsed = alternative; validation = checked; }
    }
  }
  return { parsed, validation };
}

async function phoneMatches(input, defaultCountry, options = {}) {
  const original = String(input);
  const trimmed = original.trim();
  if (!trimmed) return [];
  options.signal?.throwIfAborted();
  const api = await loadPhoneApi();
  const { phoneParser, iteratePhoneNumbers } = api;
  const valueOf = parsed => phoneParser.format(parsed, { format: 'tel' }).slice(4);
  const complete = trimmed.replace(/^(tel:)?00(?=\d)/i, '$1+')
    // HTML contact links commonly percent-encode spaces in the subscriber.
    // Keep URI parameters intact so malformed contexts/extensions still fail.
    .replace(/^(tel:)([^;]*)/i, (_, scheme, subscriber) => scheme + subscriber.replace(/[ \t\u00a0\u202f]+/g, ''));
  const direct = interpret(api, complete, defaultCountry);
  const date = /^(?:[12]\d{3}([./-])\d{1,2}\1\d{1,2}|\d{1,2}([./-])\d{1,2}\2[12]\d{3})$/.test(trimmed);
  if (direct.parsed.ok && direct.validation.status === 'valid' && !date) {
    const raw = trimmed.replace(/^tel:/i, '');
    const start = original.indexOf(trimmed) + (trimmed.length - raw.length);
    return [{ value: valueOf(direct.parsed.value), raw, start, end: start + raw.length }];
  }
  // An invalid URI cannot be rescued as an extensionless base number, or as
  // the digits of an unsupported phone-context parameter.
  if (/^tel:/i.test(trimmed) || /^[+()\p{Nd}\s./-]+;[a-z][a-z-]*(?:=|$)/iu.test(trimmed)) return [];

  const matches = [];
  const masked = original.replace(/tel:[^\s<>"']+/gi, (uri, start) => {
    const result = interpret(api, uri, defaultCountry);
    if (result.parsed.ok && result.validation.status === 'valid') {
      matches.push({ value: valueOf(result.parsed.value), raw: uri.slice(4), start: start + 4, end: start + uri.length });
    }
    return ' '.repeat(uri.length);
  });
  // Resolve candidates through the same strict parser as complete contact
  // values, retaining offsets into the unchanged source for detailed labels.
  let lastInput; let lastResult;
  const resolve = value => {
    if (value !== lastInput) { lastInput = value; lastResult = interpret(api, value, defaultCountry); }
    return lastResult;
  };
  const parser = { parse: value => resolve(value).parsed, validate: value => resolve(value).validation };
  const parameterPattern = '(?:;(?:[a-z][a-z-]*=[^\\s;,<>"\x27]*|(?:ext|phone-context|isub)(?=[;\\s]|$)))+';
  const parameterSpans = [...original.matchAll(new RegExp(parameterPattern, 'gi'))].map(match => ({ start: match.index, end: match.index + match[0].length }));
  const trailingParameters = new RegExp(`^${parameterPattern}`, 'i');
  let parameterIndex = 0;
  for (const match of iteratePhoneNumbers(masked, {
    parser, defaultCountry, leniency: 'strict', signal: options.signal,
    // Fetchary already bounds captured responses. Do not introduce the new
    // dependency's smaller implicit text/candidate caps for accepted pages.
    maxTextLength: Math.max(1, masked.length), maxCandidates: Math.max(10_000, masked.length),
  })) {
    while (parameterSpans[parameterIndex]?.end <= match.start) parameterIndex++;
    if (parameterSpans[parameterIndex]?.start <= match.start) continue;
    const parameters = trailingParameters.exec(original.slice(match.end))?.[0] || '';
    const raw = original.slice(match.start, match.end) + parameters;
    const parsed = parameters ? interpret(api, raw, defaultCountry) : null;
    if (parameters && (!parsed.parsed.ok || parsed.validation.status !== 'valid')) continue;
    matches.push({ value: valueOf(parameters ? parsed.parsed.value : match.parsed), raw,
      start: match.start, end: match.end + parameters.length });
  }
  return matches.sort((left, right) => left.start - right.start);
}

module.exports = { phoneMatches, validateDefaultCountry };
