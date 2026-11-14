'use strict';
const { detector, host, configurationUrl } = require('../helpers');
module.exports = detector('goatcounter','analytics',(context,emit) => {
  for (const resource of context.resources) {
    if (resource.element.localName !== 'script') continue;
    const value = resource.element.getAttribute('data-goatcounter');
    if (!value && !(host(resource.url,'gc.zgo.at') && resource.url.pathname === '/count.js')) continue;
    const endpoint = configurationUrl(value,context.base);
    emit(endpoint ? [{kind:'site-endpoint',value:endpoint}] : [],resource.evidence);
  }
});
