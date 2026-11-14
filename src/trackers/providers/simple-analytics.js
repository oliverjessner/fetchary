'use strict';
const { detector, host, objectProperty } = require('../helpers');
const domain = value => typeof value === 'string' && /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i.test(value) ? value : null;
module.exports = detector('simple-analytics','analytics',(context,emit) => {
  const configured = [];
  for (const script of context.scripts) for (const assignment of script.js.assignments) {
    if (assignment.name !== 'sa_settings' || script.js.tokens[assignment.index+2]?.value !== '{') continue;
    const hostname = domain(objectProperty(script.js,assignment.index+2,'hostname'));
    configured.push({hostname,evidence:script.evidence('sa_settings.hostname',assignment.index)});
  }
  for (const resource of context.resources) {
    const script = resource.element.localName === 'script';
    const knownHost = host(resource.url,'simpleanalyticscdn.com') || host(resource.url,'simpleanalytics.com');
    const hostname = domain(resource.element.getAttribute('data-hostname')) || domain(resource.url.searchParams.get('hostname'));
    const knownScript = script && /\/(?:latest|light|auto-events)\.js$/.test(resource.url.pathname);
    const pixel = resource.element.localName === 'img' && /\/noscript\.gif$/.test(resource.url.pathname);
    if (!(knownHost && (knownScript || pixel)) && !(knownScript && (hostname || configured.length))) continue;
    const trackedDomains = [...new Set([hostname,...configured.map(item => item.hostname)].filter(Boolean))];
    emit([],resource.evidence,trackedDomains.length ? {trackedDomains} : undefined);
    for (const item of configured) emit([],item.evidence,item.hostname ? {trackedDomains:[item.hostname]} : undefined);
  }
});
