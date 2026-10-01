'use strict';

const { linkCount, profileName } = require('../metrics/followers');

function matches(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'github.com' || hostname === 'www.github.com';
  } catch {
    return false;
  }
}

function followerCount(document, url) {
  const username = profileName(url, /^\/([\w-]+)\/?$/);
  if (!username) return null;
  return linkCount(document, url, target => target.pathname.replace(/\/$/, '').toLowerCase() === `/${username}` && target.searchParams.get('tab') === 'followers');
}

module.exports = { name: 'github', matches, overlays: [], followerCount };
