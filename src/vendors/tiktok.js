'use strict';

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

module.exports = { name: 'tiktok', matches, overlays };
