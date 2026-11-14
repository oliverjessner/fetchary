'use strict';
const { detector, host, identifier, objectProperty, configurationUrl } = require('../helpers');
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
module.exports = detector('umami', 'analytics', (context, emit) => {
  for (const resource of context.resources) {
    if (resource.element.localName !== 'script') continue;
    const value = resource.element.getAttribute('data-website-id');
    if (!value && !(host(resource.url,'umami.is') && /\/(?:script|umami)\.js$/.test(resource.url.pathname))) continue;
    const scope = configurationUrl(resource.element.getAttribute('data-host-url') || new URL('.',resource.url).href,context.base);
    const id = identifier('website-id',value,uuid,{ scope });
    emit(id ? [id] : [],resource.evidence);
  }
  for (const script of context.scripts) for (const assignment of script.js.assignments) {
    if (assignment.name !== 'umamiConfig' || script.js.tokens[assignment.index+2]?.value !== '{') continue;
    const scope = configurationUrl(objectProperty(script.js,assignment.index+2,'hostUrl'),context.base);
    const id = identifier('website-id',objectProperty(script.js,assignment.index+2,'websiteId'),uuid,{ scope });
    emit(id ? [id] : [],script.evidence('umamiConfig.websiteId',assignment.index));
  }
});
