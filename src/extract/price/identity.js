'use strict';
const { clean, pageIdentity } = require('./common');

function productKey(product) {
  if (!product) return null;
  return JSON.stringify([product.id,product.url || (product.id ? pageIdentity(product.id) : null), product.sku, product.name?.toLowerCase()]);
}
function publicProduct(product) {
  if (!product) return null;
  const { id = null, name = null, url = null, sku = null } = product;
  return { id, name, url, sku };
}
function identify(context, products, options) {
  const scope = options.productSelector ? context.dom.querySelector(options.productSelector) : null;
  const headings = context.elements.filter(element => element.localName === 'h1' && (!scope || scope === element || scope.contains(element)));
  const heading = clean(headings.find(element => element.localName === 'h1')?.textContent);
  const canonical = context.dom.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const page = pageIdentity(context.url);
  const aliases = new Set([page,pageIdentity(canonical,context.url)].filter(Boolean));
  const eligible = products.filter(product => {
    if (product.record.element?.closest('nav, aside, footer, [data-recommendations], .recommendations, .related-products')) return false;
    const declared = product.url || (product.id ? pageIdentity(product.id,context.url) : null);
    return !declared || aliases.has(declared);
  });
  // Align missing identity fields only when the other declarations provide a
  // single possible identity. A missing ID must never bridge two variants.
  for (const product of eligible) if (!product.url) product.url = pageIdentity(product.id,context.url) || page;
  const identityGroups = new Map();
  for (const product of eligible) {
    const key = JSON.stringify([product.url,product.name?.toLowerCase()]);
    if (!identityGroups.has(key)) identityGroups.set(key,[]);
    identityGroups.get(key).push(product);
  }
  for (const group of identityGroups.values()) for (const name of ['id','sku']) {
    const declared = new Set(group.map(product => product[name]).filter(Boolean));
    if (declared.size === 1) for (const product of group) product[name] ||= [...declared][0];
  }
  const unique = values => [...new Map(values.map(value => [productKey(value),value])).values()];
  const named = heading ? eligible.filter(product => product.name?.toLowerCase() === heading.toLowerCase()) : [];
  const scoped = scope ? eligible.filter(product => product.record.element && (scope === product.record.element || scope.contains(product.record.element))) : [];
  const mainEntities = eligible.filter(product => product.mainEntity);
  const candidates = unique(scoped.length ? scoped : mainEntities.length ? mainEntities : named.length ? named : eligible);
  let primary = candidates.length === 1 ? candidates[0] : null;
  if (primary && heading && primary.name && primary.name.toLowerCase() !== heading.toLowerCase() && !scoped.length) primary = null;
  const inferred = { id:null, url:page, name:heading, sku:null };
  const uncertain = !primary && products.length > 0 || !!options.productSelector && !scope;
  return { scope, primary, inferred, uncertain, aliases, eligible:new Set(eligible), product:primary || (!uncertain ? inferred : null) };
}
module.exports = { identify, productKey, publicProduct };
