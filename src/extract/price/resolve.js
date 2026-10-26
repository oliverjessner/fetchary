'use strict';
const { productKey } = require('./identity');

function resolvePrices(candidates, issues) {
  const current = candidates.filter(candidate => candidate.role === 'current');
  const result = { status:'unavailable', selected:null, product:null, candidates, issues };
  const add = (code,message) => { if (!issues.some(issue => issue.code === code)) issues.push({ code,message }); };
  if (!current.length) {
    if (issues.some(issue => ['AMBIGUOUS_NUMBER','EXTRACTION_LIMIT'].includes(issue.code))) result.status = 'ambiguous';
    return result;
  }
  const identities = new Set(current.map(candidate => productKey(candidate.product)));
  const certain = identities.size === 1 && !identities.has(null) && current.every(candidate => candidate.association === 'matched');
  if (certain) result.product = current[0].product;
  // Comparable groups include currency and all declared conditions. Unknown
  // currencies and uncertain product associations never establish a conflict.
  const groups = new Map();
  for (const candidate of current) {
    if (candidate.association !== 'matched' || !candidate.product || !candidate.currency) continue;
    const key = JSON.stringify([productKey(candidate.product), candidate.currency, candidate.conditions]);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(candidate);
  }
  if ([...groups.values()].some(group => new Set(group.map(candidate => candidate.amount)).size > 1)) {
    result.status = 'conflict'; add('PRICE_MISMATCH','Comparable current-price sources disagree'); return result;
  }
  if (!certain || current.some(candidate => !candidate.currency) || groups.size !== 1
    || issues.some(issue => ['EXTRACTION_LIMIT','AMBIGUOUS_NUMBER','AMBIGUOUS_CURRENCY'].includes(issue.code))) {
    result.status = 'ambiguous'; add('PRICE_AMBIGUOUS','Current prices cannot be safely reconciled or associated'); return result;
  }
  result.selected = current[0];
  const sources = new Set(current.flatMap(candidate => candidate.evidence.map(evidence => evidence.source)));
  result.status = sources.size > 1 ? 'consistent' : 'single_source';
  return result;
}
module.exports = { resolvePrices };
