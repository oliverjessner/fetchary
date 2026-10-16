'use strict';
const { detector, host, ids, identifier, emitResource, emitCall } = require('../helpers');
module.exports = detector('meta-pixel', 'advertising', (context, emit) => {
  emitResource(context, emit, url => host(url, 'connect.facebook.net') && /\/fbevents\.js$/.test(url.pathname) || host(url, 'facebook.com') && /^\/tr\/?$/.test(url.pathname), url => identifier('pixel-id', url.searchParams.get('id'), ids.pixel));
  emitCall(context, emit, 'fbq', 'init', 'pixel-id', ids.pixel);
  context.attributes(emit, ['data-facebook-pixel-id', 'data-meta-pixel-id'], 'pixel-id', ids.pixel);
});
