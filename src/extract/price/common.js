'use strict';

const { httpUrl } = require('../images');
const term = value => typeof value === 'string' ? value.replace(/^https?:\/\/schema\.org\//, '') : '';
const types = object => [object?.['@type']].flat().map(term);
const key = (object, name) => [name, `https://schema.org/${name}`, `http://schema.org/${name}`].find(key => Object.hasOwn(object || {}, key));
const field = (object, name) => object?.[key(object, name)];
const scalar = value => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : value?.['@value'] ?? null;
const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 2048) || null : null;
const pathKey = (path, key) => /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
function pageIdentity(value, base) {
  const url = httpUrl(typeof value === 'object' ? value?.['@id'] : value, base);
  if (!url) return null;
  const parsed = new URL(url); parsed.hash = ''; return parsed.href;
}
function productInfo(object, base) {
  return { id:httpUrl(object?.['@id'], base), name:clean(scalar(field(object,'name'))),
    url:pageIdentity(field(object,'url'),base), sku:clean(scalar(field(object,'sku'))) };
}
function conditions(object = {}) {
  const result = {};
  for (const name of ['valueAddedTaxIncluded','eligibleCustomerType','eligibleRegion','eligibleQuantity','validForMemberTier','billingDuration','billingIncrement','unitCode','unitText','referenceQuantity','priceType','validFrom','validThrough','priceValidUntil','seller','availability','eligibleTransactionVolume','shippingDetails']) {
    const value = field(object,name);
    if (value !== undefined) result[name] = JSON.stringify(value).slice(0,2048);
  }
  return result;
}
function priceRole(object, fallback = 'current') {
  const label = JSON.stringify([field(object,'priceType'),field(object,'name')]).toLowerCase();
  if (/listprice|strikethrough|regular|original|rrp/.test(label)) return 'list';
  if (/installment|instalment/.test(label)) return 'installment';
  if (field(object,'billingDuration') != null || field(object,'billingIncrement') != null || /subscription|recurring/.test(label)) return 'subscription';
  if (field(object,'unitCode') != null || field(object,'unitText') != null || field(object,'referenceQuantity') != null || types(object).includes('UnitPriceSpecification')) return 'unit';
  return fallback;
}

// Deterministic selectors use only tag names and numeric sibling positions.
function locator(element) {
  const parts = [];
  for (let node = element; node?.localName; node = node.parentElement) {
    let index = 1;
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
    parts.push(`${/^[a-z][a-z0-9-]*$/.test(node.localName) ? node.localName : '*'}:nth-child(${index})`);
  }
  return parts.reverse().join(' > ');
}
module.exports = { term, types, key, field, scalar, clean, pathKey, pageIdentity, productInfo, conditions, priceRole, locator };
