'use strict';
const { detector, host } = require('../helpers');
module.exports = detector('plausible', 'analytics', (context, emit) => {
  for (const resource of context.resources) {
    if (resource.element.localName !== 'script') continue;
    const domain = resource.element.getAttribute('data-domain');
    const known = host(resource.url, 'plausible.io') && /^\/js\/[^/]+\.js$/.test(resource.url.pathname);
    const selfHosted = domain && /\/(?:script|plausible)(?:\.[a-z-]+)*\.js$/.test(resource.url.pathname);
    if (!known && !selfHosted) continue;
    const domains = (domain || '').split(',').map(value => value.trim()).filter(value => /^[A-Za-z0-9][A-Za-z0-9.:-]*(?:\/[\w./-]*)?$/.test(value));
    emit([], resource.evidence, domains.length ? { trackedDomains: domains } : undefined);
  }
});
