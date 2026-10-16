'use strict';
const { detector, ids, identifier, emitResource } = require('../helpers');
function server(value, base) {
  try {
    const url = new URL(value, base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.search = ''; url.hash = ''; return url.href;
  } catch { return null; }
}
module.exports = detector('matomo', 'analytics', (context, emit) => {
  emitResource(context, emit, url => /\/(?:matomo|piwik)\.(?:js|php)$/.test(url.pathname), url => {
    if (!url.pathname.endsWith('.php')) return null;
    const scope = server(url.href, context.base);
    return identifier('site-id', url.searchParams.get('idsite'), ids.numeric, { scope });
  });
  for (const script of context.scripts) {
    let tracker = null; let site = null; let evidence;
    function flush() {
      if (site) emit([site], evidence);
      site = null;
    }
    for (const call of script.js.calls('_paq.push')) {
      const start = call.positions[0]; const tokens = script.js.tokens;
      if (tokens[start]?.value !== '[' || tokens[start + 1]?.type !== 'literal' || tokens[start + 2]?.value !== ',') continue;
      const command = tokens[start + 1].value;
      const value = script.js.expression(start + 3);
      if (command === 'setTrackerUrl') {
        tracker = value && server(value, context.base);
        if (site && site.scope === null) site.scope = tracker;
        flush(); emit([], script.evidence('_paq.setTrackerUrl', call.index));
      }
      if (command === 'setSiteId') {
        flush(); site = identifier('site-id', value, ids.numeric, { scope: tracker }); evidence = script.evidence('_paq.setSiteId', call.index);
        emit([], evidence);
      }
      if (command === 'addTracker') {
        let nextComma = -1;
        for (let i = start + 3; i < call.end; i++) if (tokens[i].type === 'punctuation' && tokens[i].value === ',') { nextComma = i; break; }
        const id = identifier('site-id', nextComma > 0 ? script.js.expression(nextComma + 1) : null, ids.numeric, { scope: value && server(value, context.base) });
        emit(id ? [id] : [], script.evidence('_paq.addTracker', call.index));
      }
    }
    flush();
  }
});
