'use strict';

const { linkCount, profileName } = require('../metrics/followers');

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

async function prepare(page) {
  if (typeof page.setUserAgent !== 'function' || typeof page.browser !== 'function') return;
  const browser = page.browser();
  if (!browser || typeof browser.userAgent !== 'function') return;
  const browserUserAgent = await browser.userAgent();
  const userAgent = browserUserAgent.replace(/\bHeadlessChrome\//, 'Chrome/');
  if (userAgent !== browserUserAgent) await page.setUserAgent(userAgent);
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

module.exports = { name: 'x', matches, prepare, overlays, followerCount };
