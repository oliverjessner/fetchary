'use strict';

const { parseCount, elementCount, labeledCount, jsonObjects } = require('../metrics/followers');

function matches(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

const overlays = [
  {
    id: 'linkedin-cookie-consent',
    async dismiss(page) {
      return page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const enabled = element => !element.disabled && element.getAttribute('aria-disabled') !== 'true' &&
          !element.closest('[inert]') && element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== 'hidden';
        // LinkedIn sometimes keeps aria-hidden on a visibly rendered consent
        // alert during its transition. Use visual state for this banner.
        // LinkedIn's consent action identifies rejection independently of locale.
        const stable = [...document.querySelectorAll('button[data-control-name], button[data-tracking-control-name]')]
          .find(element => enabled(element) && ['data-control-name', 'data-tracking-control-name']
            .some(attribute => /^ga-cookie\.consent\.(deny|reject)(?:\.|$)/.test(element.getAttribute(attribute) || '')));
        if (stable) {
          stable.click();
          return true;
        }
        const labels = new Set(['reject', 'reject all', 'decline optional cookies', 'ablehnen', 'alle ablehnen', 'optionale cookies ablehnen']);
        for (const banner of document.querySelectorAll('.artdeco-global-alert--COOKIE_CONSENT, [data-test-id="cookie-banner"], [data-test-id="cookie-policy-dialog"], #onetrust-banner-sdk')) {
          const button = [...banner.querySelectorAll('button, [role="button"]')].find(element => enabled(element) &&
            (element.id === 'onetrust-reject-all-handler' ||
             [element.textContent, element.getAttribute('aria-label')].some(label => labels.has(normalize(label)))));
          if (!button) continue;
          button.click();
          return true;
        }
        return false;
      });
    },
  },
  {
    id: 'linkedin-login-dialog',
    async dismiss(page) {
      return page.evaluate(() => {
        if (/^\/(?:authwall|checkpoint|login|signup|uas)(?:\/|$)/.test(location.pathname)) return false;
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const loginSelector = '.contextual-sign-in-modal, .sign-in-modal';
        const titles = new Set(['sign in to linkedin', 'join linkedin', 'bei linkedin anmelden', 'bei linkedin registrieren']);
        const closeLabels = new Set(['dismiss', 'close', 'schließen', 'schliessen']);
        for (const dialog of document.querySelectorAll(`${loginSelector}, [role="dialog"], dialog`)) {
          const isLogin = dialog.matches(loginSelector) || dialog.querySelector(loginSelector) ||
            dialog.querySelector('button[data-tracking-control-name*="sign-in-modal"][data-tracking-control-name$="_dismiss"]') ||
            [...dialog.querySelectorAll('h1, h2, h3, [role="heading"]')].some(element => titles.has(normalize(element.textContent)));
          if (!isLogin || dialog.closest('[aria-hidden="true"], [inert]') ||
              dialog.querySelector('[data-test-id="captcha"], [id^="captcha"], iframe[src*="captcha"], form[action*="/checkpoint"]')) continue;
          const close = [...dialog.querySelectorAll('button, [role="button"]')].find(element => {
            if (element.disabled || element.getAttribute('aria-disabled') === 'true' ||
                element.closest('[aria-hidden="true"], [inert]') || element.getClientRects().length === 0 ||
                getComputedStyle(element).visibility === 'hidden') return false;
            return element.matches('.modal__dismiss, .sign-in-modal__dismiss, .contextual-sign-in-modal__modal-dismiss') ||
              [element.getAttribute('aria-label'), element.textContent].some(label => closeLabels.has(normalize(label)));
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

function profileKey(value, base) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, base);
    if (!matches(url.href)) return null;
    const match = url.pathname.match(/^\/(in|company|school|showcase)\/([^/]+)(?:\/(?:about|life|people|posts|recent-activity))?\/?$/);
    return match ? `/${match[1]}/${decodeURIComponent(match[2]).toLowerCase()}` : null;
  } catch {
    return null;
  }
}

function countFromText(value) {
  // The company header includes its location before the count; descriptions
  // start with the company name. Restrict this search to profile metadata.
  const text = String(value || '').replace(/[\t\r\n]/g, ' ');
  const match = text.match(/(?:^|\s|[|•·])([\d][\d.,'’\u00a0\u202f]*(?:\s*(?:k|m|b|tsd\.?|mio\.?|mrd\.?|thousand|million|billion))?)\s*(?:followers?(?::innen|\*innen)?|abonnenten)(?:$|\s|[•·,])/i);
  return match ? parseCount(match[1]) : null;
}

function followerCount(document, url) {
  const profile = profileKey(url);
  if (!profile) return null;
  for (const object of jsonObjects(document)) {
    if (profileKey(object.url || object['@id'], url) !== profile) continue;
    const types = [object['@type']].flat();
    if (!types.some(type => ['Person', 'Organization', 'Corporation', 'EducationalOrganization', 'CollegeOrUniversity'].includes(type))) continue;
    for (const statistic of [object.interactionStatistic].flat()) {
      if (!statistic) continue;
      const action = typeof statistic.interactionType === 'object' ? statistic.interactionType?.['@type'] : statistic.interactionType;
      if (!/(?:^|[/#])FollowAction$/.test(action || '')) continue;
      const count = parseCount(statistic.userInteractionCount);
      if (count !== null) return count;
    }
  }
  const selector = '.top-card-layout__first-subline, .top-card-layout__second-subline, .top-card-layout .top-card__subline-item, .pv-top-card .pv-top-card--list-bullet li, .org-top-card-summary-info-list__info-item';
  for (const element of document.querySelectorAll(selector)) {
    const count = countFromText(element.textContent);
    if (count === null) continue;
    return elementCount(element) ?? count;
  }
  const dedicated = elementCount(document.querySelector('[data-test-id="follower-count"]'));
  if (dedicated !== null) return dedicated;
  for (const element of document.querySelectorAll('.pv-top-card [href*="/followers"], .pv-top-card [href*="/recent-activity"]')) {
    let target;
    try { target = new URL(element.getAttribute('href'), url); } catch { continue; }
    target.pathname = target.pathname.replace(/\/(followers|recent-activity)\/?$/, '/');
    if (profileKey(target.href) !== profile) continue;
    if (labeledCount(element.textContent) === null && labeledCount(element.getAttribute('aria-label')) === null) continue;
    const count = elementCount(element);
    if (count !== null) return count;
  }
  for (const element of document.querySelectorAll('meta[property="og:description"], meta[name="description"]')) {
    const count = countFromText(element.getAttribute('content'));
    if (count !== null) return count;
  }
  return null;
}

function followerCountFromRaw(document, rawUrl, renderedUrl) {
  if (!matches(renderedUrl)) return null;
  const profile = profileKey(rawUrl);
  if (!profile) return null;
  const gated = /^\/(?:authwall|checkpoint|login|signup|uas)(?:\/|$)/.test(new URL(renderedUrl).pathname);
  if (!gated && profileKey(renderedUrl) !== profile) return null;
  return followerCount(document, rawUrl);
}

module.exports = { name: 'linkedin', matches, overlays, followerCount, followerCountFromRaw };
