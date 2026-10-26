'use strict';
const { clean, locator, term, pageIdentity } = require('./common');
const { normalizePrice } = require('./normalize');

const excluded = 'script, style, template, noscript, nav, aside, footer, header, [role="navigation"], [data-recommendations], .recommendations, .related-products, .recommended-products, .pagination, .advertisement, [data-ad]';
function unrelated(element) {
  for (let node = element; node?.localName; node = node.parentElement) {
    const label = `${node.id || ''} ${node.getAttribute('class') || ''}`;
    if (/(?:^|[\s_-])(?:recommendations?|recommended|related|upsell|cross-sell|advertisement|pagination|shipping|delivery|savings|coupon|mini-cart)(?:[\s_-]|$)/i.test(label)) return true;
  }
  return false;
}
function hidden(element) {
  for (let node = element; node?.localName; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))/i.test(node.getAttribute('style') || '')) return true;
  }
  return false;
}
function roleFor(element, raw) {
  let labels = raw;
  for (let node = element, depth = 0; node?.localName && depth < 3; node = node.parentElement, depth++) {
    labels += ` ${node.getAttribute('class') || ''} ${node.id || ''} ${node.getAttribute('data-price-type') || ''}`;
    if (['s','del','strike'].includes(node.localName) || /line-through/.test(node.getAttribute('style') || '')) return 'list';
  }
  if (/installment|instalment|\brates?\b|\bx\s*\d|\d\s*x\b/i.test(labels)) return 'installment';
  if (/subscription|per\s+month|\/\s*(?:month|mo\b|year|monat)|monatlich/i.test(labels)) return 'subscription';
  if (/unit[-_ ]?price|price[-_ ]?per|\/\s*(?:kg|g\b|l\b|100|unit)|per\s+(?:kg|litre|unit)/i.test(labels)) return 'unit';
  if (/(?:^|[\s_-])(?:old|original|regular|list|rrp|was)(?:[\s_-]|price|$)/i.test(labels)) return 'list';
  return 'current';
}

function domPrices(context, identity, options) {
  const prices = [];
  const selected = options.priceSelector ? new Set(context.elements.filter(element => element.matches(options.priceSelector))) : null;
  const possible = context.elements.filter(element => {
    if (identity.scope && element !== identity.scope && !identity.scope.contains(element)) return false;
    if (selected) return selected.has(element);
    return /price|amount|kosten|preis/i.test(`${element.id} ${element.getAttribute('class') || ''}`)
      || element.hasAttribute('data-price') || element.hasAttribute('data-product-price') || element.hasAttribute('data-sale-price') || element.hasAttribute('data-regular-price')
      || element.children.length === 0 && /\d/.test(element.textContent) && /(?:€|£|\b(?:EUR|USD|CHF|GBP|CAD|AUD|JPY)\b|\$)/.test(element.textContent);
  });
  const possibleSet = new Set(possible);
  const containers = new Set();
  for (const element of possible) for (let parent = element.parentElement; parent; parent = parent.parentElement) if (possibleSet.has(parent)) containers.add(parent);
  for (const element of possible) {
    if (element.closest(excluded) || unrelated(element) || hidden(element) || ['meta','link','input','option','select'].includes(element.localName)) continue;
    if (element.hasAttribute('itemprop') && element.getAttribute('itemprop').split(/\s+/).map(term).includes('price')) {
      // Text is still independent evidence from Microdata's content attribute.
      if (!element.textContent.trim()) continue;
    }
    const nested = containers.has(element);
    let currency = element.getAttribute('data-currency') || element.closest('[data-currency]')?.getAttribute('data-currency');
    if (!currency) {
      for (let parent = element.parentElement, depth = 0; parent && depth < 2; parent = parent.parentElement, depth++) {
        if (!/price|amount|preis/.test(`${parent.id} ${parent.getAttribute('class') || ''}`)) continue;
        const value = normalizePrice(parent.textContent.trim());
        if (!value.error && value.currency) { currency = value.currency; break; }
      }
    }
    const attributes = ['data-price','data-product-price','data-sale-price','data-regular-price'].filter(name => element.hasAttribute(name));
    if (!nested && element.textContent.trim()) attributes.unshift('textContent');
    const card = element.closest('[data-product-id], [data-sku], [data-variant-id], [data-variant], .variant, .product-card, [itemtype$="/Product"]');
    const microProduct = [...identity.eligible].find(product => product.record.element === card);
    let product = microProduct || identity.product;
    let association = identity.uncertain && !microProduct ? 'uncertain' : 'matched';
    if (card && !microProduct) {
      const sku = card.getAttribute('data-sku') || card.getAttribute('data-product-id') || card.getAttribute('data-variant-id') || card.getAttribute('data-variant');
      if (sku && identity.primary?.sku === sku || identity.scope && (identity.scope === card || identity.scope.contains(card))) {
        product = { ...(identity.product || identity.inferred), sku:sku || null };
      } else { product = { id:null,url:null,name:clean(card.querySelector('h1,h2,h3')?.textContent),sku:sku || null }; association = 'uncertain'; }
    }
    if (microProduct && identity.primary && microProduct !== identity.primary) continue;
    for (const attribute of attributes) {
      const original = attribute === 'textContent' ? element.textContent : element.getAttribute(attribute);
      if (!original?.trim() || original.length > 2048) continue;
      let raw = original.trim(); let role = roleFor(element,original);
      const terms = {};
      const installments = raw.match(/^(\d+)\s*[x×]\s*(.+)$/i);
      if (installments) { role = 'installment'; terms.installments = installments[1]; raw = installments[2]; }
      // Keep semantic suffixes as conditions rather than feeding them to the
      // numeric parser; the evidence always retains the exact original text.
      const suffix = raw.match(/\s*(\/\s*(?:kg|g|l|100\s*g|month|mo|year|monat)|per\s+(?:kg|unit|month)|monthly|monatlich)\s*$/i);
      if (suffix) { terms.unit = suffix[0].trim(); raw = raw.slice(0,suffix.index).trim(); }
      if (/^(?:from|ab)\s+/i.test(raw)) { role = 'range-min'; raw = raw.replace(/^(?:from|ab)\s+/i,''); }
      raw = raw.replace(/^(?:price|sale|now|was|regular|list|preis)\s*:?\s*/i,'');
      for (const node of [element,element.parentElement].filter(Boolean)) {
        for (const name of ['data-tax','data-price-condition','data-eligibility','data-member-price','data-price-type']) if (node.hasAttribute(name)) terms[name] = node.getAttribute(name);
        const text = node.textContent;
        if (/\b(?:members? only|with coupon|excl\.?\s*(?:tax|vat)|inkl\.?\s*mwst|incl\.?\s*(?:tax|vat))\b/i.test(text)) terms.display = clean(text);
      }
      if (attribute === 'data-regular-price') role = 'list';
      const candidate = { raw:original, parseRaw:raw, currency, role, conditions:terms, product, association,
        evidence:{ source:'visible-dom', locator:locator(element), attribute,
          visibility:context.document === 'raw' ? 'static-not-hidden' : 'rendered-not-hidden' }, context };
      const range = raw.match(/^(.+?)\s*(?:[–—]|\s-\s|\sto\s)\s*(.+)$/);
      if (range) {
        const sharedCurrency = currency || normalizePrice(range[1]).currency || normalizePrice(range[2]).currency;
        prices.push({ ...candidate,parseRaw:range[1],currency:sharedCurrency,role:'range-min' },{ ...candidate,parseRaw:range[2],currency:sharedCurrency,role:'range-max' });
      } else prices.push(candidate);
    }
  }
  return prices;
}

function metaPrices(context, identity) {
  const prices = [];
  const metas = context.elements.filter(element => element.localName === 'meta' && !element.closest('template, noscript') && element.hasAttribute('content'));
  const name = element => (element.getAttribute('property') || element.getAttribute('name') || '').toLowerCase();
  const declared = metas.find(element => name(element) === 'og:url')?.getAttribute('content');
  if (declared && !identity.aliases.has(pageIdentity(declared,context.url))) return prices;
  for (const element of metas) {
    const property = name(element);
    if (!['product:price:amount','og:price:amount','price','product:sale_price:amount','product:original_price:amount'].includes(property)) continue;
    const currencyProperty = property.endsWith(':amount') ? property.replace(/:amount$/,':currency') : 'pricecurrency';
    const currencies = [...new Set(metas.filter(meta => name(meta) === currencyProperty).map(meta => meta.getAttribute('content')))];
    prices.push({ raw:element.getAttribute('content'), currency:currencies.length === 1 ? currencies[0] : null, machine:true,
      role:property.includes('original_price') ? 'list' : 'current', conditions:{}, product:identity.product,
      association:identity.uncertain ? 'uncertain' : 'matched', evidence:{ source:'meta',locator:locator(element),attribute:'content' },context });
  }
  return prices;
}
module.exports = { domPrices, metaPrices, hidden };
