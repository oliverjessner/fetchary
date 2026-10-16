'use strict';
const { jsonRoots, objects, insightBuilder, jsonLdMetrics, legacyFollower } = require('../metrics/insights');
const { classifyUrl } = require('../utils/social');

const { linkCount, profileName } = require('../metrics/followers');
const { profilePictures } = require('../metrics/profile-pictures');

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

function profilePicture(document, url) {
  return profilePictures(document, url, {
    pattern: /^\/([\w-]+)\/?$/,
    reserved: ['login', 'signup', 'explore', 'settings', 'features', 'marketplace', 'pricing', 'orgs', 'organizations', 'topics', 'collections', 'trending', 'about'],
    selectors: '.h-card img.avatar-user, .js-profile-editable-area img.avatar-user, img.avatar-user[itemprop="image"]',
    json: (object, username) => String(object.login || '').toLowerCase() === username ? object.avatar_url : null,
  });
}

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const builder = insightBuilder(url, identity.kind === 'profile' ? ['followers'] : []);
  if (identity.kind === 'profile') legacyFollower(document, url, builder, followerCount);
  return builder.finish();
}

module.exports = { name: 'github', matches, classifyUrl, socialInsights, overlays: [], followerCount, profilePicture };
