'use strict';
const { detector, host, ids, identifier, emitResource, emitAssignment } = require('../helpers');
module.exports = detector('linkedin-insight', 'advertising', (context, emit) => {
  emitResource(context, emit, url => host(url, 'snap.licdn.com') && /\/insight(?:\.min)?\.js$/.test(url.pathname) || host(url, 'px.ads.linkedin.com') && /^\/collect\/?$/.test(url.pathname), url => identifier('partner-id', url.searchParams.get('pid'), ids.partner));
  emitAssignment(context, emit, '_linkedin_partner_id', 'partner-id', ids.partner);
  context.attributes(emit, ['data-linkedin-partner-id'], 'partner-id', ids.partner);
});
