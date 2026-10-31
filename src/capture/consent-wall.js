'use strict';

const { parseHTML } = require('linkedom');

// Static HTTP evidence only. Loading a CMP script is common even after a saved
// decision, so script names alone must never trigger a browser capture.
const providers = [
  ['sourcepoint', /sp_message|sp_choice|sourcepoint|golem_consent|cmp-cdn\.golem/i],
  ['onetrust', /onetrust|optanon/i],
  ['cookiebot', /cookiebot|CybotCookiebot/i],
  ['usercentrics', /usercentrics|uc-main-dialog|uc-banner|uc-center-container/i],
  ['didomi', /didomi/i],
  ['consentmanager', /consentmanager|cmpbox|cmpwelcomebtn/i],
];
const privacy = /\b(?:cookies?|consent|tracking|einwilligung|zustimmung|datenschutz|privacy|personenbezogene[nr]? daten|personal data)\b/i;
const choices = /(?:ablehnen|akzeptieren|zustimmen|notwendige|erforderliche|einstellungen|auswahl|reject|decline|disagree|refuse|agree|accept|allow|necessary|essential|preferences|settings|manage)/i;
const roots = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], #onetrust-banner-sdk, #onetrust-pc-sdk, #CybotCookiebotDialog, #didomi-host, #usercentrics-root, #uc-main-dialog, .cmpbox, [id*="cookie-banner"], [class*="cookie-banner"], [id*="consent-banner"], [class*="consent-banner"], [id*="privacy-overlay"], [class*="privacy-overlay"], [id*="privacy-dialog"], [class*="privacy-dialog"], [id^="sp_message_container"], [style*="fixed"], [style*="sticky"]';

function isHidden(element) {
  for (let node = element; node?.getAttribute; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true'
      || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.getAttribute('style') || '')) return true;
  }
  return false;
}

function detectConsentWall(html, url = '') {
  const absent = { detected: false, provider: null };
  if (typeof html !== 'string' || !privacy.test(html) && !/sp_message_iframe/i.test(html)) return absent;
  const document = parseHTML(html).document;
  for (const node of document.querySelectorAll('script,style,noscript,template')) node.remove();
  const content = document.documentElement?.tagName === 'HTML' ? document.body : document.documentElement;
  const text = (content?.textContent || '').replace(/\s+/g, ' ').trim();
  const provider = providers.find(([, pattern]) => pattern.test(html))?.[0] || 'generic';
  // Known message frames can contain all the consent copy cross-origin.
  for (const frame of document.querySelectorAll('iframe')) {
    if (!isHidden(frame) && /sp_message_iframe|consent-ui|consent\.youtube\.com/i.test(`${frame.id} ${frame.getAttribute('src') || ''}`)) {
      return { detected: true, provider };
    }
  }
  let pathname = '';
  try { pathname = new URL(url).pathname; } catch {}
  // Dedicated choice pages (including Golem's redirect) are walls regardless
  // of how much legal text they contain or whether the CMP has loaded yet.
  if (/(?:^|\/)(?:consent|zustimmung|cookie-consent|cookie-wall)(?:[/.\-_]|$)/i.test(pathname)
    && privacy.test(text) && choices.test(text)) return { detected: true, provider };
  const title = document.querySelector('title')?.textContent || '';
  if (/^(?:before you continue|bevor sie fortfahren|cookie (?:consent|preferences)|consent required|privacy (?:choices|preferences))/i.test(title.trim())
    && choices.test(text)) return { detected: true, provider };
  for (const root of document.querySelectorAll(roots)) {
    if (isHidden(root)) continue;
    const copy = `${root.textContent || ''} ${root.getAttribute('aria-label') || ''}`;
    const controls = [...root.querySelectorAll('button,[role="button"],input[type="submit"],a')]
      .filter(node => !isHidden(node)).map(node => `${node.textContent} ${node.getAttribute('aria-label') || ''} ${node.getAttribute('value') || ''}`).join(' ');
    if (privacy.test(copy) && choices.test(controls)) return { detected: true, provider };
  }
  return absent;
}

function consentMetadata(evidence, action = 'reject') {
  return { ...evidence, action, status: evidence.detected ? 'unsupported' : 'not_detected',
    ...(evidence.detected ? { reason: action === 'off' ? 'consent_disabled' : 'http_requires_browser' } : {}) };
}

module.exports = { detectConsentWall, consentMetadata };
