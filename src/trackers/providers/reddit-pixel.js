'use strict';
const { detector, host, identifier, emitCall } = require('../helpers');
const valid = /^(?:t2_|a2_)[a-z\d]{3,32}$/i;
module.exports = detector('reddit-pixel','advertising',(context,emit) => {
  for (const resource of context.resources) {
    const known = resource.element.localName === 'script' && host(resource.url,'redditstatic.com') && resource.url.pathname === '/ads/pixel.js';
    const pixel = resource.element.localName === 'img' && host(resource.url,'reddit.com') && resource.url.pathname === '/ads/pixel';
    if (!known && !pixel) continue;
    const id = identifier('pixel-id',resource.url.searchParams.get('pixel_id') || resource.url.searchParams.get('id'),valid);
    emit(id ? [id] : [],resource.evidence);
  }
  emitCall(context,emit,'rdt','init','pixel-id',valid);
});
