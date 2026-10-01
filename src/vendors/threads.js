'use strict';

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

module.exports = { name: 'threads', matches, overlays };
