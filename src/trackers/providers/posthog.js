'use strict';
const { detector, host, identifier, objectProperty, configurationUrl } = require('../helpers');
const token = /^(?:phc_[A-Za-z\d_-]{12,180}|[a-f\d]{32})$/i;
module.exports = detector('posthog','analytics',(context,emit) => {
  for (const resource of context.resources) if (resource.element.localName === 'script' && host(resource.url,'posthog.com') && /\/(?:static\/(?:array|recorder)|array)\.js$/.test(resource.url.pathname)) emit([],resource.evidence);
  for (const script of context.scripts) for (const call of script.js.calls('posthog.init')) {
    const scope = configurationUrl(objectProperty(script.js,call.positions[1],'api_host'),context.base);
    const id = identifier('project-token',call.args[0],token,{ scope });
    emit(id ? [id] : [],script.evidence('posthog.init',call.index));
  }
});
