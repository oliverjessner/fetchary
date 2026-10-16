'use strict';
const { jsonRoots, objects, insightBuilder, jsonLdMetrics, legacyFollower } = require('../metrics/insights');
const { classifyUrl } = require('../utils/social');
const { profilePictures } = require('../metrics/profile-pictures');

const { parseCount, elementCount, jsonObjects, profileName } = require('../metrics/followers');

function matches(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

const overlays = [
  {
    id: 'tiktok-cookie-consent',
    async dismiss(page) {
      return page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const declineLabels = new Set([
          'decline all', 'reject all', 'decline optional cookies', 'reject optional cookies',
          'alle ablehnen', 'optionale cookies ablehnen',
        ]);
        for (const banner of document.querySelectorAll('tiktok-cookie-banner, [data-e2e="cookie-banner"], [class*="DivCookieBanner"]')) {
          const roots = [banner];
          if (banner.shadowRoot) roots.push(banner.shadowRoot);
          // TikTok's consent component can put its controls in nested open
          // shadow roots. Only traverse roots inside the identified banner.
          for (const root of roots) {
            for (const element of root.querySelectorAll('*')) {
              if (element.shadowRoot) roots.push(element.shadowRoot);
            }
            const button = [...root.querySelectorAll('button, [role="button"]')].find(element => {
              if (element.disabled || element.getAttribute('aria-disabled') === 'true' ||
                  element.getClientRects().length === 0) return false;
              return [element.innerText || element.textContent, element.getAttribute('aria-label')]
                .some(label => declineLabels.has(normalize(label)));
            });
            if (!button) continue;
            button.click();
            return true;
          }
        }
        return false;
      });
    },
  },
  {
    id: 'tiktok-login-dialog',
    async dismiss(page) {
      return page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const loginTitles = new Set(['log in to tiktok', 'sign up for tiktok', 'bei tiktok anmelden', 'melde dich bei tiktok an', 'für tiktok registrieren']);
        const closeLabels = new Set(['close', 'close_button', 'close modal', 'schließen', 'schliessen']);
        const loginSelector = '[data-e2e="login-modal"], #loginContainer, [class*="DivLoginContainer"]';
        for (const dialog of document.querySelectorAll(`[role="dialog"], dialog, ${loginSelector}`)) {
          const isLogin = dialog.matches(loginSelector) || dialog.querySelector(loginSelector) ||
            [...dialog.querySelectorAll('h1, h2, h3, [role="heading"], [data-e2e="login-title"]')]
              .some(element => loginTitles.has(normalize(element.innerText || element.textContent)));
          if (!isLogin) continue;
          const scope = dialog.closest('[role="dialog"], dialog, [class*="DivModalContainer"]') || dialog;
          // Verification dialogs may be nested in an authentication dialog.
          // Their controls are not dismissible login overlays.
          const closeSelector = '[data-e2e="login-close"], [data-e2e="modal-close-inner-button"], [class*="DivCloseWrapper"]';
          const close = [...scope.querySelectorAll(`button, [role="button"], ${closeSelector}`)].find(element => {
            if (element.closest('.captcha-verify-container, [id^="captcha"], [data-e2e="captcha"]') ||
                element.disabled || element.getAttribute('aria-disabled') === 'true' ||
                element.getClientRects().length === 0) return false;
            return element.matches(closeSelector) ||
              [element.getAttribute('aria-label'), element.innerText || element.textContent]
                .some(label => closeLabels.has(normalize(label)));
          });
          if (!close) continue;
          close.click();
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
    if (String(object.user?.uniqueId || '').toLowerCase() !== username) continue;
    const count = parseCount(object.stats?.followerCount ?? object.statsV2?.followerCount);
    if (count !== null) return count;
  }
  return elementCount(document.querySelector('[data-e2e="followers-count"]'));
}

function profilePicture(document, url) {
  return profilePictures(document, url, {
    pattern: /^\/@([^/]+)\/?$/, selectors: '[data-e2e="user-avatar"] img', metadata: true,
    json: (object, username) => String(object.uniqueId || '').toLowerCase() === username
      ? [object.avatarLarger, object.avatarMedium, object.avatarThumb] : null,
  });
}

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const builder = insightBuilder(url, identity.kind === 'profile' ? ['followers','following','posts'] : identity.kind === 'video' ? ['likes','comments','views','shares','saves'] : []);
  for (const root of jsonRoots(document)) for (const object of objects(root)) {
    if (identity.kind === 'profile' && String(object.user?.uniqueId || '').toLowerCase() === identity.id) {
      const stats = object.statsV2 || object.stats || {};
      for (const [name, field] of Object.entries({ followers:'followerCount', following:'followingCount', posts:'videoCount' })) builder.set(name, stats[field], 'embedded-json', `userInfo.stats.${field}`);
    }
    if (identity.kind === 'video' && String(object.id || '') === identity.id) {
      const stats = object.statsV2 || object.stats || {};
      for (const [name, field] of Object.entries({ likes:'diggCount', comments:'commentCount', views:'playCount', shares:'shareCount', saves:'collectCount' })) builder.set(name, stats[field], 'embedded-json', `itemStruct.stats.${field}`);
    }
  }
  if (identity.kind === 'profile') legacyFollower(document, url, builder, followerCount);
  if (identity.kind === 'video') jsonLdMetrics(document, url, builder);
  return builder.finish();
}

module.exports = { name: 'tiktok', matches, classifyUrl, socialInsights, overlays, followerCount, profilePicture };
