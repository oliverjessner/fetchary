'use strict';
const { detector, host, ids, identifier, emitResource, emitCall } = require('../helpers');
module.exports = detector('pinterest-tag', 'advertising', (context, emit) => {
  emitResource(context, emit, url => host(url, 's.pinimg.com') && url.pathname === '/ct/core.js' || host(url, 'ct.pinterest.com') && /^\/v3\/?$/.test(url.pathname), url => identifier('tag-id', url.searchParams.get('tid'), ids.tag));
  emitCall(context, emit, 'pintrk', 'load', 'tag-id', ids.tag);
  context.attributes(emit, ['data-pinterest-tag-id'], 'tag-id', ids.tag);
});
