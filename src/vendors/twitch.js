'use strict';

const { parseCount, elementCount, labeledCount, jsonObjects, profileName } = require('../metrics/followers');

function matches(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'twitch.tv' || hostname.endsWith('.twitch.tv');
  } catch {
    return false;
  }
}

const overlays = [
  {
    id: 'twitch-cookie-consent',
    async dismiss(page) {
      return page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const declineLabels = new Set(['reject', 'reject all', 'decline all', 'ablehnen', 'alle ablehnen']);
        for (const banner of document.querySelectorAll('[data-a-target="consent-banner"], #onetrust-banner-sdk, #onetrust-pc-sdk')) {
          const button = [...banner.querySelectorAll('button, [role="button"]')].find(element => {
            if (element.disabled || element.getAttribute('aria-disabled') === 'true' ||
                element.getClientRects().length === 0) return false;
            return element.id === 'onetrust-reject-all-handler' || element.id === 'reject-all-handler' ||
              [element.innerText || element.textContent, element.getAttribute('aria-label')]
                .some(label => declineLabels.has(normalize(label)));
          });
          if (!button) continue;
          button.click();
          return true;
        }
        return false;
      });
    },
  },
  {
    id: 'twitch-login-dialog',
    async dismiss(page) {
      return page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const closeLabels = new Set(['close', 'close modal', 'schließen', 'schliessen', 'anzeige schließen']);
        for (const dialog of document.querySelectorAll('[role="dialog"], dialog, [data-a-target="passport-modal"]')) {
          const isLogin = dialog.matches('[data-a-target="passport-modal"]') ||
            dialog.querySelector('[data-a-target="passport-modal"], form[name="login-submit-form"]') ||
            (dialog.querySelector('#login-username') && dialog.querySelector('input[type="password"]'));
          if (!isLogin) continue;
          const close = [...dialog.querySelectorAll('button, [role="button"]')].find(element => {
            if (element.disabled || element.getAttribute('aria-disabled') === 'true' ||
                element.getClientRects().length === 0) return false;
            return element.getAttribute('data-a-target') === 'modalClose' ||
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
  const username = profileName(url, /^\/([\w]+)(?:\/about)?\/?$/);
  if (!username || ['directory', 'downloads', 'settings', 'login', 'signup'].includes(username)) return null;
  for (const object of jsonObjects(document)) {
    if (String(object.login || '').toLowerCase() !== username) continue;
    const count = parseCount(object.followers?.totalCount);
    if (count !== null) return count;
  }
  const count = elementCount(document.querySelector('[data-a-target="followers-count"], [data-a-target="followers-count-value"]'));
  if (count !== null) return count;
  for (const element of document.querySelectorAll('[data-a-target="channel-header"] span, [data-a-target="channel-about-panel"] span, .home-header-sticky p')) {
    if (labeledCount(element.textContent) === null) continue;
    return elementCount(element);
  }
  return null;
}

module.exports = { name: 'twitch', matches, overlays, followerCount };
