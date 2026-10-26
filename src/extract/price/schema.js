'use strict';

const { term, types, key, field, scalar, pathKey, pageIdentity, productInfo, conditions, priceRole, locator } = require('./common');

function jsonRecords(context, issue) {
  const records = []; const byObject = new Map(); const byId = new Map();
  const scripts = context.elements.filter(element => element.localName === 'script' && element.getAttribute('type')?.split(';')[0].trim().toLowerCase() === 'application/ld+json' && !element.closest('template, noscript'));
  if (scripts.length > 128) issue('EXTRACTION_LIMIT', 'More than 128 JSON-LD scripts');
  let visited = 0;
  for (const [scriptIndex, script] of scripts.slice(0,128).entries()) {
    let root;
    try {
      // Node 26 supplies the original numeric token, avoiding JSON number rounding.
      root = JSON.parse(script.textContent.replace(/^\uFEFF/, '').trim(), (_key,value,source) => typeof value === 'number' ? source.source : value);
    } catch { issue('INVALID_JSON_LD', 'Malformed JSON-LD', { document:context.document, scriptIndex }); continue; }
    const pending = [{ object:root, path:'$', depth:0, parent:null }];
    while (pending.length) {
      const item = pending.pop();
      if (++visited > 10000 || item.depth > 64) { issue('EXTRACTION_LIMIT', 'JSON-LD traversal limit reached'); break; }
      if (!item.object || typeof item.object !== 'object') continue;
      if (Array.isArray(item.object)) {
        for (let index = Math.min(item.object.length,10000)-1; index >= 0; index--) pending.push({ ...item, object:item.object[index], path:`${item.path}[${index}]`, depth:item.depth+1 });
        if (item.object.length > 10000) issue('EXTRACTION_LIMIT','JSON-LD array limit reached');
        continue;
      }
      const record = { ...item, source:'json-ld', scriptIndex, context,
        evidence(name) { return { source:this.source, locator:pathKey(this.path,key(this.object,name)), scriptIndex }; } };
      records.push(record); byObject.set(item.object,record);
      if (typeof item.object['@id'] === 'string' && Object.keys(item.object).length > 1) {
        try { byId.set(new URL(item.object['@id'],context.url).href,record); } catch { /* Invalid IDs do not associate objects. */ }
      }
      const entries = Object.entries(item.object);
      for (let index = Math.min(entries.length,10000)-1; index >= 0; index--) {
        const [name, object] = entries[index];
        if (name !== '@context' && object && typeof object === 'object') pending.push({ object, path:pathKey(item.path,name), depth:item.depth+1, parent:record });
      }
    }
    if (visited > 10000) break;
  }
  return { records, resolve(value) {
    if (value && typeof value === 'object') {
      if (Object.keys(value).length === 1 && value['@id']) { try { return byId.get(new URL(value['@id'],context.url).href); } catch { return undefined; } }
      return byObject.get(value);
    }
    if (typeof value === 'string') { try { return byId.get(new URL(value,context.url).href); } catch { return undefined; } }
  } };
}

function microRecords(context, issue) {
  const records = []; const byElement = new Map(); const values = new Map();
  const scopes = context.elements.filter(element => element.hasAttribute('itemscope') && !element.closest('template, noscript'));
  for (const element of scopes) {
    const object = { '@type':(element.getAttribute('itemtype') || '').split(/\s+/), '@id':element.getAttribute('itemid') || undefined };
    const locations = new Map();
    const record = { object, context, source:'microdata', element, parent:null, evidence(name,index = 0) {
      const location = locations.get(name)?.[index];
      return { source:'microdata', locator:locator(location?.element || element), attribute:location?.attribute || 'textContent' };
    } };
    records.push(record); byElement.set(element,record); values.set(object,record); record.locations = locations;
  }
  let work = 0;
  for (const record of records) {
    const owner = record.element.parentElement?.closest('[itemscope]'); record.parent = byElement.get(owner) || null;
    const pending = [...context.children(record.element)]; const seen = new Set();
    for (const id of (record.element.getAttribute('itemref') || '').split(/\s+/).filter(Boolean)) {
      const element = context.dom.getElementById(id); if (element) pending.push(element);
    }
    while (pending.length) {
      if (++work > 10000) { issue('EXTRACTION_LIMIT','Microdata traversal limit reached'); break; }
      const element = pending.pop();
      if (seen.has(element) || element.closest('template, noscript')) continue;
      seen.add(element);
      if (!element.hasAttribute('itemscope')) pending.push(...context.children(element));
      for (const name of (element.getAttribute('itemprop') || '').split(/\s+/).filter(Boolean).map(term)) {
        const attribute = element.hasAttribute('content') ? 'content' : element.hasAttribute('value') ? 'value' : ['link','a'].includes(element.localName) ? 'href' : 'textContent';
        const value = byElement.get(element)?.object ?? (attribute === 'textContent' ? element.textContent : element.getAttribute(attribute));
        if (!Object.hasOwn(record.object,name)) Object.defineProperty(record.object,name,{ value:[], enumerable:true, writable:true });
        record.object[name].push(value);
        if (!record.locations.has(name)) record.locations.set(name,[]);
        record.locations.get(name).push({ element, attribute });
      }
    }
    if (work > 10000) break;
  }
  // Schema properties with a single value behave like JSON-LD scalars.
  for (const record of records) for (const name of record.locations.keys()) if (record.object[name].length === 1) record.object[name] = record.object[name][0];
  return { records, resolve:value => values.get(value) };
}

function collectSchema(context, issue) {
  const datasets = [jsonRecords(context,issue),microRecords(context,issue)];
  const products = []; const prices = [];
  for (const dataset of datasets) {
    const productRecords = dataset.records.filter(record => types(record.object).includes('Product'));
    const mainEntities = new Set(dataset.records.filter(page => types(page.object).some(type => /Page$/.test(type))
      && (!(field(page.object,'url') || page.object['@id']) || pageIdentity(field(page.object,'url') || page.object['@id'],context.url) === pageIdentity(context.url)))
      .flatMap(page => [field(page.object,'mainEntity')].flat().map(value => dataset.resolve(value))));
    for (const record of productRecords) products.push({ ...productInfo(record.object,context.url), record, mainEntity:mainEntities.has(record) });
    let work = 0;
    const used = new Set();
    function collect(record, product, inherited = {}, active = new Set(), depth = 0) {
      if (!record || active.has(record) || depth > 32 || ++work > 10000) {
        if (depth > 32 || work > 10000) issue('EXTRACTION_LIMIT','Offer traversal limit reached');
        return;
      }
      active.add(record); used.add(record);
      const object = record.object;
      const item = dataset.resolve(field(object,'itemOffered'));
      if (item && types(item.object).includes('Product')) product = products.find(product => product.record === item) || product;
      const sku = scalar(field(object,'sku'));
      if (sku && product && sku !== product.sku) product = { ...product, sku };
      const currency = scalar(field(object,'priceCurrency')) ?? inherited.currency;
      const terms = { ...inherited.conditions, ...conditions(object) };
      const role = priceRole(object,inherited.role || 'current');
      for (const name of ['price','lowPrice','highPrice']) {
        const values = [field(object,name)].flat();
        values.forEach((value,index) => {
          if (prices.length >= 2048) { issue('EXTRACTION_LIMIT','Schema price limit reached'); return; }
          if (value === undefined || value === null) return;
          let evidence = record.evidence(name,index);
          if (Array.isArray(field(object,name)) && record.source === 'json-ld') evidence = { ...evidence, locator:`${evidence.locator}[${index}]` };
          if (value && typeof value === 'object') {
            const valueKey = key(value,'value') || '@value';
            if (record.source === 'json-ld') evidence.locator = pathKey(evidence.locator,valueKey);
            value = value[valueKey];
          }
          prices.push({ raw:scalar(value), currency, machine:true, role:name === 'price' ? role : name === 'lowPrice' ? 'range-min' : 'range-max', conditions:terms, product, evidence, context });
        });
      }
      for (const name of ['offers','priceSpecification']) for (const value of [field(object,name)].flat()) {
        collect(dataset.resolve(value),product,{ currency, conditions:terms, role },active,depth+1);
      }
      active.delete(record);
    }
    for (const product of products.filter(product => product.record.source === dataset.records[0]?.source)) {
      for (const value of [field(product.record.object,'offers')].flat()) collect(dataset.resolve(value),product);
    }
    for (const record of dataset.records) {
      if (used.has(record) || !types(record.object).some(type => ['Offer','AggregateOffer'].includes(type))) continue;
      let parent = record.parent; let owned = false;
      while (parent) { if (types(parent.object).includes('Product')) { owned = true; break; } parent = parent.parent; }
      if (!owned) collect(record,null);
    }
  }
  if (prices.filter(price => !price.product && price.role === 'current').length > 1) {
    for (const price of prices) if (!price.product) price.association = 'uncertain';
  }
  return { products, prices };
}
module.exports = { collectSchema };
