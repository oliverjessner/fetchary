'use strict';
const { detector, host, ids, identifier, emitResource, objectProperty } = require('../helpers');
module.exports = detector('microsoft-advertising-uet', 'advertising', (context, emit) => {
  emitResource(context, emit, url => host(url, 'bat.bing.com') && /^\/(?:bat\.js|action\/\d+)/.test(url.pathname), url => identifier('tag-id', url.searchParams.get('ti') || url.pathname.match(/^\/action\/(\d+)/)?.[1], ids.tag));
  for (const script of context.scripts) {
    for (const call of script.js.calls('UET')) {
      const id = identifier('tag-id', objectProperty(script.js, call.positions[0], 'ti'), ids.tag);
      emit(id ? [id] : [], script.evidence('UET.ti', call.index));
    }
  }
  context.attributes(emit, ['data-uet-tag-id'], 'tag-id', ids.tag);
});
