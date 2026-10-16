'use strict';

const numeric = /^[1-9]\d{0,24}$/;
const ids = {
  gtm: /^GTM-[A-Z0-9]{4,12}$/, ga4: /^G-[A-Z0-9]{10}$/, ua: /^UA-[1-9]\d{3,11}-[1-9]\d{0,3}$/,
  ads: /^AW-[1-9]\d{5,14}$/, pixel: /^[1-9]\d{4,24}$/, tiktok: /^[A-Za-z0-9]{20}$/,
  partner: /^[1-9]\d{3,14}$/, tag: /^[1-9]\d{4,24}$/, clarity: /^[a-zA-Z0-9]{6,20}$/, numeric,
};
function identifier(kind, value, valid = numeric, extra = {}) {
  return typeof value === 'string' && valid.test(value) ? { kind, value, ...extra } : null;
}
function host(url, domain) { return url.hostname === domain || url.hostname.endsWith(`.${domain}`); }
function emitResource(context, emit, match, id) {
  for (const resource of context.resources) if (match(resource.url, resource)) {
    const found = id?.(resource.url, resource);
    emit(found ? [found] : [], resource.evidence);
  }
}
function emitCall(context, emit, name, command, kind, valid, argument = 1) {
  for (const script of context.scripts) for (const call of script.js.calls(name)) {
    if (command !== null && call.args[0] !== command) continue;
    const id = identifier(kind, call.args[argument], valid);
    emit(id ? [id] : [], script.evidence(`${name}${command === null ? '' : `.${command}`}`, call.index));
  }
}
function emitAssignment(context, emit, name, kind, valid) {
  for (const script of context.scripts) for (const assignment of script.js.assignments) if (assignment.name === name) {
    const id = identifier(kind, assignment.value, valid);
    emit(id ? [id] : [], script.evidence(name, assignment.index));
  }
}
function objectProperty(js, start, name) {
  if (js.tokens[start]?.type === 'name') {
    const assignments = js.assignments.filter(assignment => assignment.name === js.tokens[start].value);
    if (assignments.length !== 1) return null;
    start = assignments[0].index + 2;
  }
  if (js.tokens[start]?.value !== '{' || !js.closing.has(start)) return null;
  const end = js.closing.get(start);
  for (let i = start + 1; i < end; i++) {
    if (js.tokens[i].value === name && js.tokens[i + 1]?.value === ':') return js.expression(i + 2);
    if (js.closing.has(i)) i = js.closing.get(i);
  }
  return null;
}
function detector(provider, category, detect) { return { provider, category, detect }; }
module.exports = { ids, identifier, host, emitResource, emitCall, emitAssignment, objectProperty, detector };
