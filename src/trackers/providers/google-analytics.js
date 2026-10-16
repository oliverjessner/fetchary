'use strict';
const { detector, host, ids, identifier, emitResource, emitCall } = require('../helpers');
function analyticsId(value) { return identifier('measurement-id', value, ids.ga4) || identifier('tracking-id', value, ids.ua); }
module.exports = detector('google-analytics', 'analytics', (context, emit) => {
  emitResource(context, emit, url => host(url, 'google-analytics.com') && /^\/(?:analytics|ga)\.js$/.test(url.pathname)
    || host(url, 'googletagmanager.com') && url.pathname === '/gtag/js' && !/^AW-/.test(url.searchParams.get('id') || ''), url => analyticsId(url.searchParams.get('id')));
  for (const script of context.scripts) for (const call of script.js.calls('gtag')) if (call.args[0] === 'config') {
    const id = analyticsId(call.args[1]);
    if (id || /^(?:G-|UA-)/.test(call.args[1] || '')) emit(id ? [id] : [], script.evidence('gtag.config', call.index));
  }
  emitCall(context, emit, 'ga', 'create', 'tracking-id', ids.ua);
  context.attributes(emit, ['data-ga-id', 'data-ga-measurement-id', 'data-google-analytics-id'], null, null, analyticsId);
});
