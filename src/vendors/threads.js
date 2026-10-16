'use strict';
const { insightBuilder, legacyFollower } = require('../metrics/insights');
const { classifyUrl } = require('../utils/social');

const { parseCount, descriptionCount, jsonObjects, profileName } = require('../metrics/followers');
const { profilePictures } = require('../metrics/profile-pictures');

const COOKIE_CONSENT = 'threads-cookie-consent';

function matches(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'threads.com' || hostname.endsWith('.threads.com');
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
        const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
        for (const dialog of dialogs) {
          const button = [...dialog.querySelectorAll('button, [role="button"]')]
            .find(element => normalize(element.innerText || element.textContent) === 'Decline optional cookies');
          if (!button) continue;
          button.click();
          return true;
        }
        return false;
      });
    },
  },
];

function followerCount(document, url) {
  const username = profileName(url, /^\/@([^/]+)\/?$/);
  if (!username) return null;
  for (const object of jsonObjects(document)) {
    if (String(object.username || '').toLowerCase() !== username) continue;
    const count = parseCount(object.follower_count);
    if (count !== null) return count;
  }
  return descriptionCount(document);
}

function profilePicture(document, url) {
  return profilePictures(document, url, {
    pattern: /^\/@([^/]+)\/?$/, alt: true, metadata: true,
    json: (object, username) => String(object.username || '').toLowerCase() === username
      ? [object.profile_pic_url_hd, object.hd_profile_pic_url_info, object.profile_pic_url] : null,
  });
}

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const builder = insightBuilder(url, identity.kind === 'profile' ? ['followers'] : []);
  if (identity.kind === 'profile') legacyFollower(document, url, builder, followerCount);
  return builder.finish();
}

module.exports = { name: 'threads', matches, classifyUrl, socialInsights, overlays, followerCount, profilePicture };
