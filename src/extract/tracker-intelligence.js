'use strict';
const { parseHTML } = require('linkedom');
const { httpUrl, documentBase } = require('./images');
const { discoverDetectors } = require('../trackers');
const { javascript } = require('../trackers/javascript');
const { identifier } = require('../trackers/helpers');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const key = value => JSON.stringify(value);

function trackerContext(html, url, documentName, externalHosts) {
  const document = parseHTML(html).document;
  const base = documentBase(document, url);
  const resources = []; const scripts = []; const attributes = [];
  const tokenBudget = { remaining: 200_000 };
  let index = 0;
  function visit(root, noscript = false) {
    for (const element of root.querySelectorAll('*')) {
      if (element.closest('template')) continue;
      const position = index++;
      const evidence = (source, field, tokenIndex) => ({ source: noscript || element.closest('noscript') ? 'noscript' : source, document: documentName, field, index: position, ...(tokenIndex === undefined ? {} : { tokenIndex }) });
      attributes.push({ element, evidence });
      const tag = element.localName;
      const attribute = tag === 'object' ? 'data' : tag === 'link' ? 'href' : 'src';
      const isResource = ['script','img','iframe','source','video','audio','embed','object'].includes(tag)
        || tag === 'link' && /\b(?:stylesheet|preload|modulepreload|prefetch|icon)\b/i.test(element.getAttribute('rel') || '');
      if (isResource) {
        const target = httpUrl(element.getAttribute(attribute), base);
        if (target) {
          const resourceUrl = new URL(target);
          resources.push({ url: resourceUrl, element, evidence: evidence(`${tag}-src`, attribute) });
          if (resourceUrl.hostname !== new URL(url).hostname) externalHosts.add(resourceUrl.hostname);
        }
      }
      if (tag === 'script' && !element.getAttribute('src') && /^(?:|module|(?:text|application)\/(?:java|ecma)script)$/.test((element.getAttribute('type') || '').trim().toLowerCase())) {
        const js = javascript(element.textContent || '', tokenBudget);
        scripts.push({ js, evidence: (field, tokenIndex) => evidence('inline-script', field, tokenIndex) });
        // Bootstrap snippets often construct script.src from a literal URL.
        // Inspect the literal, never fetch it or execute it for static analysis.
        for (let i = 0; i < js.tokens.length; i++) {
          const token = js.tokens[i];
          const assignedSource = ['=', ':'].includes(js.tokens[i - 1]?.value) && js.tokens[i - 2]?.value === 'src';
          const callArgument = ['(', ','].includes(js.tokens[i - 1]?.value);
          if (token.type !== 'literal' || !/^(?:https?:)?\/\//.test(token.value) || !assignedSource && !callArgument) continue;
          const target = httpUrl(token.value, base);
          if (target) resources.push({ url: new URL(target), element, evidence: evidence('inline-script', 'resource-url', i) });
        }
      }
      if (tag === 'noscript' && !element.querySelector('*') && element.textContent.includes('<')) visit(parseHTML(element.textContent).document, true);
    }
  }
  visit(document);
  return { base, resources, scripts, attributes(emit, names, kind, valid, convert) {
    for (const { element, evidence } of attributes) for (const name of names) {
      const metadata = element.localName === 'meta' && (element.getAttribute('name') || '').toLowerCase() === name.slice(5);
      const value = metadata ? element.getAttribute('content') : element.getAttribute(name);
      const id = convert ? convert(value) : identifier(kind, value, valid);
      if (id) emit([id], evidence(metadata ? 'metadata' : 'data-attribute', metadata ? name.slice(5) : name));
    }
  } };
}

function trackerIntelligence(documents, detectors = discoverDetectors()) {
  const found = new Map(); const externalHosts = new Set();
  for (const captured of documents) {
    const context = trackerContext(captured.html, captured.url, captured.document, externalHosts);
    for (const detector of detectors) detector.detect(context, (identifiers, evidence, configuration) => {
      let tracker = found.get(detector.provider);
      if (!tracker) {
        tracker = { provider: detector.provider, category: detector.category, identifiers: new Map(), evidence: new Map(), domains: new Set() };
        found.set(detector.provider, tracker);
      }
      for (const id of identifiers) tracker.identifiers.set(key(id), id);
      tracker.evidence.set(key(evidence), evidence);
      for (const domain of configuration?.trackedDomains || []) tracker.domains.add(domain);
    });
  }
  const trackers = [...found.values()].sort((a, b) => compare(a.provider, b.provider)).map(tracker => {
    const identifiers = [...tracker.identifiers.values()].sort((a, b) => compare(key(a), key(b)));
    return { provider: tracker.provider, category: tracker.category, identifiers,
      detection: identifiers.length || tracker.domains.size ? 'confirmed_configuration' : 'provider_reference',
      evidence: [...tracker.evidence.values()].sort((a, b) => compare(key(a), key(b))),
      ...(tracker.domains.size ? { configuration: { trackedDomains: [...tracker.domains].sort(compare) } } : {}) };
  });
  return { trackers, externalHosts: [...externalHosts].sort(compare), summary: { providers: trackers.length, uniqueIdentifiers: trackers.reduce((count, tracker) => count + tracker.identifiers.length, 0) } };
}
module.exports = { trackerIntelligence, trackerContext };
