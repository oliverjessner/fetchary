'use strict';
const { insightBuilder, legacyFollower } = require('../metrics/insights');
const { classifyUrl } = require('../utils/social');

const { linkCount, profileName } = require('../metrics/followers');
const { profilePictures } = require('../metrics/profile-pictures');

const COOKIE_CONSENT = 'x-cookie-consent';
const LOGIN_DIALOG = 'x-login-dialog';

function matches(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'x.com' || hostname.endsWith('.x.com') ||
      hostname === 'twitter.com' || hostname.endsWith('.twitter.com');
  } catch {
    return false;
  }
}

const overlays = [
  {
    id: COOKIE_CONSENT,
    async dismiss(page) {
      return page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
        const declineLabels = new Set([
          'Refuse non-essential cookies',
          'Reject non-essential cookies',
          'Decline optional cookies',
        ]);
        const button = [...document.querySelectorAll('button, [role="button"]')]
          .find(element => declineLabels.has(normalize(element.innerText || element.textContent)));
        if (!button) return false;
        button.click();
        return true;
      });
    },
  },
  {
    id: LOGIN_DIALOG,
    async dismiss(page) {
      return page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
        const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="dialog"]')];
        const dialog = dialogs.find(element => {
          const text = normalize(element.innerText || element.textContent);
          return text.includes('Sign in to X') || text.includes('Join X today');
        });
        if (!dialog) return false;
        const close = dialog.querySelector('[aria-label="Close"], [data-testid="app-bar-close"]');
        if (!close) return false;
        close.click();
        return true;
      });
    },
  },
];

function followerCount(document, url) {
  const username = profileName(url, /^\/([\w]+)\/?$/);
  if (!username) return null;
  return linkCount(document, url, target => [`/${username}/followers`, `/${username}/verified_followers`].includes(target.pathname.replace(/\/$/, '').toLowerCase()));
}

function profilePicture(document, url) {
  return profilePictures(document, url, {
    pattern: /^\/([\w]+)\/?$/,
    reserved: ['home', 'explore', 'search', 'notifications', 'messages', 'i', 'login', 'signup', 'settings', 'intent', 'tos', 'privacy'],
    selectors: '[data-testid^="UserAvatar-Container-"] img, a[href$="/photo"] img',
    acceptImage: (image, username, pageUrl) => {
      const href = image.closest('a[href]')?.getAttribute('href');
      if (!href) return false;
      try { return new URL(href, pageUrl).pathname.toLowerCase().replace(/\/$/, '') === `/${username}/photo`; } catch { return false; }
    },
    json: (object, username) => String(object.screen_name || '').toLowerCase() === username
      ? [object.profile_image_url_https, object.profile_image_url] : null,
  });
}

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const builder = insightBuilder(url, identity.kind === 'profile' ? ['followers'] : []);
  if (identity.kind === 'profile') legacyFollower(document, url, builder, followerCount);
  return builder.finish();
}

module.exports = { name: 'x', matches, classifyUrl, socialInsights, overlays, followerCount, profilePicture };
