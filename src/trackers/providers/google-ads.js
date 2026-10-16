'use strict';
const { detector, host, ids, identifier, emitResource } = require('../helpers');
module.exports = detector('google-ads', 'advertising', (context, emit) => {
  emitResource(context, emit, url => host(url, 'googletagmanager.com') && url.pathname === '/gtag/js' && /^AW-/.test(url.searchParams.get('id') || '')
    || (host(url, 'googleadservices.com') || host(url, 'google.com')) && /^\/pagead\/(?:conversion|1p-conversion|viewthroughconversion)(?:\/|\.js|$)/.test(url.pathname), url => {
    const value = url.searchParams.get('id') || (url.pathname.match(/\/(?:conversion|1p-conversion|viewthroughconversion)\/(\d+)/)?.[1] ? `AW-${url.pathname.match(/\/(?:conversion|1p-conversion|viewthroughconversion)\/(\d+)/)[1]}` : null);
    return identifier('conversion-id', value, ids.ads);
  });
  for (const script of context.scripts) for (const call of script.js.calls('gtag')) if (call.args[0] === 'config' && /^AW-/.test(call.args[1] || '')) {
    const id = identifier('conversion-id', call.args[1], ids.ads); emit(id ? [id] : [], script.evidence('gtag.config', call.index));
  }
  context.attributes(emit, ['data-google-ads-id'], 'conversion-id', ids.ads);
});
