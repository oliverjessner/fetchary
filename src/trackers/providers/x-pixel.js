'use strict';
const { detector, host, emitCall } = require('../helpers');
module.exports = detector('x-pixel','advertising',(context,emit) => {
  for (const resource of context.resources) if (resource.element.localName === 'script'
    && (host(resource.url,'static.ads-twitter.com') || host(resource.url,'platform.twitter.com')) && /^\/(?:uwt|oct)\.js$/.test(resource.url.pathname)) emit([],resource.evidence);
  for (const command of ['config','init']) emitCall(context,emit,'twq',command,'pixel-id',/^[a-z\d]{4,12}$/i);
});
