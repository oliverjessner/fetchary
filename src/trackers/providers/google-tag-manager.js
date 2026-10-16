'use strict';
const { detector, host, ids, identifier, emitResource } = require('../helpers');
module.exports = detector('google-tag-manager', 'tag-manager', (context, emit) => {
  emitResource(context, emit, url => host(url, 'googletagmanager.com') && /^\/(?:gtm\.js|ns\.html)$/.test(url.pathname), url => identifier('container-id', url.searchParams.get('id'), ids.gtm));
  for (const script of context.scripts) {
    const tokens = script.js.tokens;
    const bootstrapResource = context.resources.some(resource => resource.evidence.index === script.evidence('').index && host(resource.url, 'googletagmanager.com') && resource.url.pathname === '/gtm.js');
    if (!bootstrapResource || !tokens.some((token, i) => token.type === 'literal' && token.value === 'gtm.start' && tokens[i + 1]?.value === ':')) continue;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'literal' || tokens[i - 1]?.value !== ',' || tokens[i + 1]?.value !== ')') continue;
      const id = identifier('container-id', tokens[i].value, ids.gtm);
      if (id) emit([id], script.evidence('gtm.bootstrap', i));
    }
  }
  context.attributes(emit, ['data-gtm-id', 'data-gtm-container-id'], 'container-id', ids.gtm);
});
