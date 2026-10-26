'use strict';
const { parseHTML } = require('linkedom');
const { normalizePrice } = require('./normalize');
const { collectSchema } = require('./schema');
const { identify, publicProduct, productKey } = require('./identity');
const { domPrices, metaPrices } = require('./dom');
const { resolvePrices } = require('./resolve');

function extractPrices(documents, options = {}) {
  const candidates = []; const issues = []; const issueKeys = new Set(); const merged = new Map(); let evidenceCount = 0;
  function issue(code,message,extra = {}) {
    const key = JSON.stringify([code,extra]);
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    if (issues.length < 126 || code === 'EXTRACTION_LIMIT' && issues.length < 127) issues.push({ code,message,...extra });
    else if (!issues.some(issue => issue.code === 'EXTRACTION_LIMIT')) issues.push({ code:'EXTRACTION_LIMIT',message:'Price issue limit reached' });
  }
  for (const document of documents) {
    const dom = parseHTML(document.html).document;
    const elements = [];
    // Traverse lazily rather than allocating an unbounded querySelectorAll list.
    let element = dom.firstElementChild; let depth = 0;
    while (element) {
      if (elements.length === 10000) { issue('EXTRACTION_LIMIT','DOM exceeds 10000 elements'); break; }
      elements.push(element);
      if (element.firstElementChild && depth < 128) { element = element.firstElementChild; depth++; }
      else {
        if (element.firstElementChild) issue('EXTRACTION_LIMIT','DOM nesting exceeds 128 levels');
        while (element && !element.nextElementSibling) { element = element.parentElement; depth--; }
        element = element?.nextElementSibling;
      }
    }
    const children = new Map();
    for (const node of elements) {
      if (!children.has(node.parentElement)) children.set(node.parentElement,[]);
      children.get(node.parentElement).push(node);
    }
    const context = { ...document, dom, elements, children:element => children.get(element) || [] };
    const schema = collectSchema(context,issue);
    const identity = identify(context,schema.products,options);
    const eligibleRecords = new Set([...identity.eligible].map(product => product.record));
    const prices = [...schema.prices,...domPrices(context,identity,options),...metaPrices(context,identity)];
    for (const price of prices) {
      if (price.product?.record && !eligibleRecords.has(price.product.record)) continue;
      if (price.product?.record && identity.primary && price.product.record !== identity.primary.record && productKey(price.product) !== productKey(identity.primary)) continue;
      if (price.product?.record && !price.product.url) price.product.url = identity.primary?.url || identity.inferred.url;
      const product = publicProduct(price.product || identity.product);
      const association = price.association || (identity.uncertain ? 'uncertain' : 'matched');
      const normalized = normalizePrice(price.parseRaw ?? price.raw,price.currency,price.machine);
      if (normalized.error) {
        issue(normalized.error,'Price value could not be normalized',{ document:context.document,locator:price.evidence.locator,raw:price.raw }); continue;
      }
      if (candidates.length >= 256 || evidenceCount >= 2048) { issue('EXTRACTION_LIMIT','Price candidate/evidence limit reached'); break; }
      const conditions = Object.fromEntries(Object.entries(price.conditions).sort(([left],[right]) => left.localeCompare(right)));
      const key = JSON.stringify([normalized.amount,normalized.currency,price.role,productKey(product),association,conditions]);
      let candidate = merged.get(key);
      if (!candidate) {
        candidate = { amount:normalized.amount,currency:normalized.currency,role:price.role,raw:price.raw,product,association,conditions,evidence:[] };
        candidates.push(candidate); merged.set(key,candidate);
      }
      const evidence = { ...price.evidence,document:context.document,url:context.url,raw:price.raw,
        capturedAt:context.capturedAt,captureMode:context.document === 'raw' ? 'http' : 'browser' };
      if (!candidate.evidence.some(entry => JSON.stringify(entry) === JSON.stringify(evidence))) { candidate.evidence.push(evidence); evidenceCount++; }
    }
  }
  return resolvePrices(candidates,issues);
}
module.exports = { extractPrices };
