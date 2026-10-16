'use strict';
const { detector, host, ids, identifier, emitResource, objectProperty } = require('../helpers');
module.exports = detector('hotjar', 'analytics', (context, emit) => {
  emitResource(context, emit, url => host(url, 'hotjar.com') && /\/(?:c\/hotjar-[^/]*\.js|modules[^/]*)/.test(url.pathname), url => identifier('site-id', url.pathname.match(/\/hotjar-(\d+)\.js$/)?.[1], ids.numeric));
  for (const script of context.scripts) {
    const tokens = script.js.tokens;
    for (let i = 0; i < tokens.length - 4; i++) if (tokens[i].value === '_hjSettings' && tokens[i + 1].value === '=' && tokens[i + 2].value === '{') {
      const id = identifier('site-id', objectProperty(script.js, i + 2, 'hjid'), ids.numeric);
      emit(id ? [id] : [], script.evidence('_hjSettings.hjid', i));
    }
  }
  context.attributes(emit, ['data-hotjar-id'], 'site-id', ids.numeric);
});
