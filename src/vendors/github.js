'use strict';
const { insightBuilder, legacyFollower, countDetails, isVisible } = require('../metrics/insights');
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
  const builder = insightBuilder(url, identity.kind === 'profile' ? ['followers'] : identity.kind === 'repository' ? ['stars', 'forks'] : []);
  if (identity.kind === 'profile') legacyFollower(document, url, builder, followerCount);
  else if (identity.kind === 'repository') {
    for (const link of document.querySelectorAll('a[href]')) {
      if (!isVisible(link)) continue;
      let target;
      try { target = new URL(link.getAttribute('href'), url); } catch { continue; }
      if (!matches(target.href)) continue;
      const path = target.pathname.replace(/\/$/, '').toLowerCase();
      const metric = path === `/${identity.id}/stargazers` ? 'stars' : [`/${identity.id}/forks`, `/${identity.id}/network/members`].includes(path) ? 'forks' : null;
      if (!metric) continue;
      const values = [link, ...link.querySelectorAll('[title]')].filter(isVisible).map(element => element.getAttribute('title'));
      const counters = [...link.querySelectorAll('.Counter, .social-count, [id$="-count"], [id$="-counter-star"], [id$="-counter-fork"]')].filter(isVisible);
      values.push(...counters.map(element => element.textContent.trim()), link.getAttribute('aria-label'), link.textContent.trim().replace(/^(?:Stars?|Forks?)\s*/i, ''));
      for (const value of values) {
        const parsed = countDetails(value);
        if (parsed) { builder.set(metric, parsed.value, 'vendor', `repository.${metric}`, parsed.approximate); break; }
      }
    }
  }
  return builder.finish();
}

module.exports = { name: 'github', matches, classifyUrl, socialInsights, overlays: [], followerCount, profilePicture };
