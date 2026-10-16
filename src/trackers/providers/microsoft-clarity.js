'use strict';
const { detector, host, ids, identifier, emitResource } = require('../helpers');
module.exports = detector('microsoft-clarity', 'analytics', (context, emit) => {
  emitResource(context, emit, url => host(url, 'clarity.ms') && /^\/tag(?:\/|$)/.test(url.pathname), url => identifier('project-id', url.pathname.split('/')[2], ids.clarity));
  for (const script of context.scripts) {
    const tokens = script.js.tokens;
    if (!tokens.some(token => token.type === 'literal' && /^https?:\/\/www\.clarity\.ms\/tag\/$/.test(token.value))) continue;
    // The official bootstrap passes its project ID after "clarity".
    for (let i = 0; i < tokens.length - 2; i++) if (tokens[i].type === 'literal' && tokens[i].value === 'clarity' && tokens[i + 1].value === ',') {
      const value = tokens[i + 2].value === 'script' && tokens[i + 3]?.value === ',' ? tokens[i + 4]?.value : tokens[i + 2].value;
      const id = identifier('project-id', value, ids.clarity);
      if (id) emit([id], script.evidence('clarity.bootstrap', i));
    }
  }
  context.attributes(emit, ['data-clarity-id'], 'project-id', ids.clarity);
});
