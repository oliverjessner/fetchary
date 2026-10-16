'use strict';
const { detector, host, ids, identifier, emitResource, objectProperty } = require('../helpers');
module.exports = detector('yandex-metrica', 'analytics', (context, emit) => {
  emitResource(context, emit, url => (host(url, 'mc.yandex.ru') || host(url, 'mc.yandex.com')) && /^\/(?:metrika\/(?:tag|watch)\.js|watch(?:\/|$))/.test(url.pathname), url => identifier('counter-id', url.pathname.match(/^\/watch\/(\d+)$/)?.[1], ids.numeric));
  for (const script of context.scripts) for (const call of script.js.calls('ym')) if (call.args[1] === 'init') {
    const id = identifier('counter-id', call.args[0], ids.numeric); emit(id ? [id] : [], script.evidence('ym.init', call.index));
  }
  for (const script of context.scripts) for (const call of [...script.js.calls('Ya.Metrika'), ...script.js.calls('Ya.Metrika2')]) {
    const id = identifier('counter-id', objectProperty(script.js, call.positions[0], 'id'), ids.numeric);
    emit(id ? [id] : [], script.evidence('Ya.Metrika.id', call.index));
  }
  context.attributes(emit, ['data-yandex-metrica-id'], 'counter-id', ids.numeric);
});
