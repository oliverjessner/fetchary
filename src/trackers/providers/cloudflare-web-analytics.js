'use strict';
const { detector, host, identifier, objectProperty } = require('../helpers');
const valid = /^[a-f\d]{32}$/i;
module.exports = detector('cloudflare-web-analytics','analytics',(context,emit) => {
  for (const resource of context.resources) {
    if (resource.element.localName !== 'script' || !host(resource.url,'static.cloudflareinsights.com') || resource.url.pathname !== '/beacon.min.js') continue;
    let value = resource.url.searchParams.get('token');
    const attribute = resource.element.getAttribute('data-cf-beacon');
    if (attribute && attribute.length <= 4096) { try { value = JSON.parse(attribute)?.token ?? value; } catch {} }
    const id = identifier('site-token',value,valid);
    emit(id ? [id] : [],resource.evidence);
  }
  for (const script of context.scripts) for (const assignment of script.js.assignments) {
    if (assignment.name !== '__cfBeacon' || script.js.tokens[assignment.index+2]?.value !== '{') continue;
    const id = identifier('site-token',objectProperty(script.js,assignment.index+2,'token'),valid);
    emit(id ? [id] : [],script.evidence('__cfBeacon.token',assignment.index));
  }
});
