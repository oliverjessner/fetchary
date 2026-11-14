'use strict';
const { detector, host, identifier } = require('../helpers');
module.exports = detector('adobe-experience-platform-tags','tag-manager',(context,emit) => {
  for (const resource of context.resources) {
    if (resource.element.localName !== 'script' || !host(resource.url,'assets.adobedtm.com') || !/\/launch-[\w-]+(?:\.min)?\.js$/.test(resource.url.pathname)) continue;
    const value = resource.url.pathname.match(/\/launch-([a-f\d]{8,64})(?:-(?:development|staging))?(?:\.min)?\.js$/i)?.[1];
    const id = identifier('library-id',value,/^[a-f\d]{8,64}$/i,{scope:resource.url.origin});
    emit(id ? [id] : [],resource.evidence);
  }
});
