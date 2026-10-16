'use strict';
const { detector, host, ids, identifier, emitResource, emitCall } = require('../helpers');
module.exports = detector('tiktok-pixel', 'advertising', (context, emit) => {
  emitResource(context, emit, url => host(url, 'analytics.tiktok.com') && /^\/i18n\/pixel\//.test(url.pathname), url => identifier('pixel-id', url.searchParams.get('sdkid'), ids.tiktok));
  emitCall(context, emit, 'ttq.load', null, 'pixel-id', ids.tiktok, 0);
  context.attributes(emit, ['data-tiktok-pixel-id'], 'pixel-id', ids.tiktok);
});
