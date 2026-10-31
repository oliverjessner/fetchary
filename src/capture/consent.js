'use strict';

// This function runs in each frame, including cross-origin frames. Keep all
// helpers inside it so Puppeteer can serialize it without Node-side closures.
function inspectConsentDocument(request) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const cookieText = /\b(?:cookies?|consent|tracking|privacy|datenschutz|einwilligung|zustimmung)\b/i;
  const consentContext = value => /\b(?:cookies?|consent|tracking|einwilligung|zustimmung|datenschutzeinstellungen)\b/i.test(value)
    || (/\b(?:privacy|datenschutz)\b/i.test(value) && /(?:preferences|choices|purposes|vendors|partners|processing|personalized|legitimate interest|einstellungen|zwecke|partner|verarbeitung)/i.test(value));
  const elements = [];
  const scopes = [document];
  for (let i = 0; i < scopes.length && i < 200; i++) {
    for (const element of scopes[i].querySelectorAll('*')) {
      elements.push(element);
      if (element.shadowRoot) scopes.push(element.shadowRoot);
      if (elements.length >= 30000) break;
    }
    if (elements.length >= 30000) break;
  }
  const visible = element => {
    if (!element?.isConnected) return false;
    for (let current = element; current; current = current.parentElement || current.getRootNode()?.host) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    const rectangle = element.getBoundingClientRect();
    return rectangle.width > 0 && rectangle.height > 0;
  };
  const within = (parent, element) => {
    for (let current = element; current; current = current.parentElement || current.getRootNode()?.host) {
      if (current === parent) return true;
    }
    return false;
  };
  const enabled = element => !element.disabled && element.getAttribute('aria-disabled') !== 'true' && !element.closest('[inert]');
  // An empty innerText is meaningful: its textContent can still contain hidden
  // editorial content and script source, neither of which proves availability.
  const text = element => normalize(typeof element?.innerText === 'string' ? element.innerText : element?.textContent);
  const label = element => normalize(element.getAttribute('aria-label') || element.innerText || element.textContent
    || element.getAttribute('title') || element.value);
  const described = element => {
    const scope = element.getRootNode();
    const ids = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return normalize([
      element.getAttribute('aria-label'),
      ...ids.map(id => scope.getElementById?.(id)?.textContent || ''),
      ...Array.from(element.labels || [], item => item.textContent),
      element.closest('label')?.textContent,
      element.getAttribute('name'), element.id,
    ].filter(Boolean).join(' '));
  };
  const providerSelectors = [
    ['sourcepoint', '[id^="sp_message_container"], [id^="sp_message_iframe"], .sp_message_container, [data-cmp="sourcepoint"]'],
    ['onetrust', '#onetrust-banner-sdk, #onetrust-pc-sdk, #onetrust-consent-sdk'],
    ['cookiebot', '#CybotCookiebotDialog, #CybotCookiebotDialogDetail'],
    ['usercentrics', '#usercentrics-root, #uc-main-dialog, [data-testid="uc-default-wall"], [data-testid="uc-customize-body"]'],
    ['didomi', '#didomi-host, #didomi-notice, #didomi-popup'],
    ['consentmanager', '#cmpbox, #cmpbox2, .cmpbox, .cmpboxinner, [data-cmp="consentmanager"]'],
  ];
  const providerHint = /(?:privacy-mgmt\.com|cmp-cdn\.golem\.de|sourcepoint|sp_message)/i.test(request.frameHint) ? 'sourcepoint'
    : /(?:consent\.cookiebot\.com|cookiebot)/i.test(request.frameHint) ? 'cookiebot'
      : /(?:usercentrics|privacy-proxy\.usercentrics)/i.test(request.frameHint) ? 'usercentrics'
        : /(?:didomi)/i.test(request.frameHint) ? 'didomi'
          : /(?:consentmanager|delivery\.consentmanager)/i.test(request.frameHint) ? 'consentmanager' : null;
  const genericSelector = '[role="dialog"], [aria-modal="true"], dialog, [id*="cookie-banner" i], [class*="cookie-banner" i], [id*="consent-banner" i], [class*="consent-banner" i], [id*="cookie-consent" i], [class*="cookie-consent" i], [id*="privacy-overlay" i], [class*="privacy-overlay" i], [id*="privacy-dialog" i], [class*="privacy-dialog" i], [id*="consent-dialog" i], [class*="consent-dialog" i], [id*="cookie-modal" i], [class*="cookie-modal" i], #cookie-notice, #cookie-law-info-bar';
  const interactiveSelector = 'button, input[type="button"], input[type="submit"], a[href], [role="button"]';
  const controls = elements.filter(element => element.matches(interactiveSelector) && visible(element) && enabled(element));
  const roots = [];
  for (const element of elements) {
    let provider = providerSelectors.find(([, selector]) => element.matches(selector))?.[0];
    const generic = element.matches(genericSelector);
    const positioned = !provider && !generic && /^(?:DIV|SECTION|ASIDE|FORM)$/.test(element.tagName)
      && /^(?:fixed|sticky)$/.test(getComputedStyle(element).position);
    if (!provider && !generic && !positioned) continue;
    const childControls = controls.filter(control => within(element, control));
    const hasFrame = elements.some(item => item.tagName === 'IFRAME' && within(element, item) && visible(item));
    if (!visible(element) && !childControls.length && !hasFrame) continue;
    const rootText = normalize(`${element.getAttribute('aria-label') || ''} ${text(element)}`);
    // A provider script, preference link, or cookie mention in an article is
    // not itself a dialog. Known CMP roots still need visible content/frames.
    if ((!provider && (!consentContext(rootText) || !childControls.length)) || (provider && !rootText && !hasFrame && !childControls.length)) continue;
    if (positioned && (rootText.length > 12000 || !childControls.some(control => /^(?:reject|decline|deny|accept|allow|alle|alles|nur|ablehnen|akzeptieren|zustimmen|manage|cookie settings)\b/i.test(label(control))))) continue;
    roots.push({ element, provider: provider || providerHint || 'generic', controls: childControls });
  }
  const bodyText = text(document.body);
  const gateUrl = /\/(?:[^/?#]*consent[^/?#]*|zustimmung|cookie(?:s)?)(?:\/|[?#]|$)/i.test(location.pathname)
    || /\/(?:privacy|datenschutz)[^?#]*(?:wall|choice|auswahl)/i.test(location.pathname);
  const gateHeading = normalize(document.querySelector('h1')?.textContent || document.title);
  const gateTitle = /^(?:cookie(?:s)?(?: settings| preferences| einstellungen)?|privacy (?:choices|preferences|settings)|consent (?:required|preferences)|ihre (?:privatsphäre|datenschutzeinstellungen)|datenschutzeinstellungen)$/i.test(gateHeading);
  if (document.body && ((providerHint && controls.length) || (cookieText.test(bodyText) && (gateUrl || gateTitle))) && !roots.some(root => root.element === document.body)) {
    roots.push({ element: document.body, provider: providerHint || 'generic', controls });
  }
  for (const root of roots) {
    if (root.provider !== 'generic') continue;
    const ancestor = roots.find(other => other !== root && other.provider !== 'generic' && within(other.element, root.element));
    if (ancestor) root.provider = ancestor.provider;
  }
  // Prefer the most specific dialog. It also avoids counting CMP wrapper and
  // its settings pane as two independent dialogs with separate click budgets.
  const candidates = roots.filter(root => !roots.some(other => other !== root && within(root.element, other.element)
    && (other.controls.length || !root.controls.length)));
  const rejectLabel = /(?:\b(?:reject|decline|deny)(?:\s+all)?\b|\b(?:alle(?:s)?\s+)?ablehnen\b|\b(?:alle(?:s)?\s+)?verweigern\b|\b(?:only\s+(?:necessary|essential)|(?:necessary|essential)\s+only)\b|\bnur\s+(?:(?:die|technisch)\s+)*(?:notwendige[nr]?|erforderliche[nr]?|essenzielle[nr]?)\b|\b(?:continue|proceed)\s+without\s+(?:accepting|consent|agreeing)\b|\b(?:weiter|fortfahren)\s+ohne\s+(?:zustimmung|einwilligung|akzeptieren)\b|\bi\s+do\s+not\s+agree\b)/i;
  const acceptLabel = /(?:\b(?:accept|allow|agree to)\s+all\b|\b(?:alle(?:s)?\s+)?akzeptieren\b|\b(?:allen|allem)\s+zustimmen\b|\bzustimmen(?:\s+und\s+weiter)?\b|\b(?:accept|agree|i agree)\b)/i;
  const settingsLabel = /(?:\b(?:cookie|privacy|consent)\s+(?:settings|preferences|center|centre)\b|\b(?:manage|edit)\s+(?:my\s+)?(?:preferences|choices|options|consent|cookies)\b|\b(?:einstellungen|anpassen|customi[sz]e|personali[sz]e)\b|\b(?:optionen|auswahl)\s+(?:verwalten|anpassen)\b)/i;
  const saveLabel = /^(?:(?:meine\s+)?(?:auswahl|einstellungen)\s+(?:speichern|bestätigen|erlauben)|(?:save|confirm)\s+(?:(?:my|the)\s+)?(?:preferences|settings|choices|selection)|speichern|bestätigen|save|confirm)(?:\s*(?:[&+]|und|and)\s*(?:weiter|fortfahren|schließen|continue|close|exit))?[\s.!]*$/i;
  const necessary = /\b(?:necessary|essential|erforderlich(?:e[nrms]?)?|notwendig(?:e[nrms]?)?|immer aktiv|always active)\b/i;
  const optional = /(?:analytics|analyse|analytisch|statisti|marketing|advert|werbung|werbe|tracking|personali[sz]|performance|preferences|präferenzen|funktional|functional|social|medien|media|comfort|komfort|optional|non.?essential|not\s+(?:strictly\s+)?necessary|nicht\s+(?:erforderlich|notwendig))/i;
  const required = value => necessary.test(value) && !/(?:non[\s-]?essential|not\s+(?:strictly\s+)?necessary|optional|nicht\s+(?:erforderlich|notwendig))/i.test(value);
  const choose = root => {
    const restricted = elements.some(element => within(root.element, element) && visible(element)
      && element.matches('input[type="password"], [data-sitekey], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'))
      || (root.provider === 'generic' && /^(?:sign in|log in|login|anmelden|passwort|subscription|paywall|captcha|verify you are human)\b/i.test(normalize(root.element.getAttribute('aria-label') || root.element.querySelector('h1, h2, h3')?.textContent)));
    if (restricted) return { kind: null, elements: [], restricted: true };
    const find = predicate => root.controls.find(element => !/\/(?:login|signin|sign-in|subscribe|subscription|paywall|captcha)(?:[/?#]|$)/i.test(element.getAttribute('href') || '') && predicate(element));
    const identifiers = element => normalize(`${element.id} ${element.className || ''} ${element.getAttribute('data-testid') || ''}`);
    const reject = find(element => rejectLabel.test(label(element)) || /(?:onetrust-reject-all-handler|cybotcookiebotdialogbodybuttondecline|didomi-notice-disagree-button|didomi-continue-without-agreeing|uc-(?:deny|reject)-all-button|cmpboxbtnno)/i.test(identifiers(element)));
    const accept = find(element => !rejectLabel.test(label(element)) && (acceptLabel.test(label(element)) || /(?:onetrust-accept-btn-handler|cybotcookiebotdialogbody(?:levelbuttonleveloptinallowall|buttonaccept)|didomi-notice-agree-button|uc-accept-all-button)/i.test(identifiers(element))));
    if (request.mode === 'accept') return accept ? { kind: 'accept', elements: [accept] } : { kind: null, elements: [] };
    if (reject) return { kind: 'reject', elements: [reject] };
    const toggles = elements.filter(element => within(root.element, element)
      && element.matches('input[type="checkbox"], [role="switch"], [role="checkbox"], button[aria-pressed]'));
    const active = toggles.filter(element => element.checked === true || element.getAttribute('aria-checked') === 'true'
      || element.getAttribute('aria-checked') === 'mixed' || element.getAttribute('aria-pressed') === 'true');
    const optionalActive = active.filter(element => !required(described(element)) && optional.test(described(element)));
    const unknownActive = active.some(element => !required(described(element)) && !optional.test(described(element)));
    const clickableToggles = optionalActive.filter(enabled).map(element => visible(element) ? element
      : Array.from(element.labels || []).find(visible)).filter(Boolean);
    const save = find(element => saveLabel.test(label(element)) && !acceptLabel.test(label(element)));
    if (clickableToggles.length) return { kind: 'toggles', elements: clickableToggles.slice(0, 32), unsafe: unknownActive || optionalActive.length !== clickableToggles.length || clickableToggles.length > 32 };
    // A save action is safe only when every active optional purpose is known
    // to be off (or disabled/required), never on an unknown selected setting.
    if (save && toggles.length && !unknownActive && !optionalActive.length) return { kind: 'save', elements: [save] };
    const settings = find(element => settingsLabel.test(label(element)) && !acceptLabel.test(label(element)));
    return settings ? { kind: 'settings', elements: [settings] } : { kind: null, elements: [], unsafe: unknownActive || optionalActive.length > 0 };
  };
  const descriptors = candidates.map((root, index) => {
    const choice = choose(root);
    const rootText = text(root.element);
    const key = `${root.provider}:${root.element.id || root.element.tagName}:${index}`;
    const blocked = choice.restricted || (/(?:\b(?:subscribe|subscription|paywall|paid|abonnement|abo|bestellen|bezahlen)\b|golem\s+pur)/i.test(rootText)
      && (!choice.kind || choice.kind === 'settings'));
    return { root, choice, key, provider: root.provider, kind: choice.kind, count: choice.elements.length, unsafe: Boolean(choice.unsafe), blocked };
  });
  if (request.operation === 'element') {
    return descriptors.find(item => item.key === request.key)?.choice.elements[request.index || 0] || null;
  }
  if (request.operation === 'content') {
    const heading = normalize(document.querySelector('main h1, article h1, h1, h2')?.textContent || document.title);
    const accessUrl = /\/(?:login|signin|sign-in|auth|authenticate|authentication|captcha|challenge|paywall|subscribe|subscription)(?:[/?#]|$)/i.test(location.pathname);
    const accessHeading = /^(?:access denied|permission denied|forbidden|unauthori[sz]ed|authentication required|sign in|log in|login|anmelden|jetzt anmelden|verify (?:that )?you are human|please verify|checking your browser|security check|captcha|zugriff verweigert|zugang gesperrt|sicherheitsüberprüfung|bitte anmelden|subscription required|subscribe to (?:continue|read)|abonnieren sie|jetzt abonnieren|nur für abonnenten)(?:\s|[.!:]|$)/i.test(heading);
    const accessControl = elements.some(element => visible(element) && (element.matches('#cf-challenge-running, #challenge-running, #px-captcha, #paywall, [data-testid="paywall"]')
      || (element.matches('input[type="password"]') && (accessUrl || accessHeading || element.closest('[role="dialog"], [aria-modal="true"], dialog')))));
    if (accessUrl || accessHeading || accessControl) return false;
    const main = elements.filter(element => element.matches('article, main, [role="main"]') && visible(element));
    if (main.some(element => text(element).length >= 32 && !candidates.some(candidate => within(element, candidate.element)))) return true;
    return candidates.length === 0 && bodyText.length >= 80 && !gateUrl && !gateTitle;
  }
  return descriptors.map(({ key, provider, kind, count, unsafe, blocked }) => ({ key, provider, kind, count, unsafe, blocked }));
}

function createConsentHandler(options = {}) {
  const mode = options.consent || 'reject';
  const state = { detected: false, provider: null, action: mode, status: 'not_detected' };
  const attempts = new Map();
  const settingsOpened = new Set();
  let interacted = false;
  let decisionMade = false;
  let totalSteps = 0;
  let observed = [];
  const check = () => options.signal?.throwIfAborted();
  const withinDeadline = () => !options.deadline || Date.now() < options.deadline;
  const result = () => ({ ...state });
  const frameHint = frame => {
    try { return `${frame.url?.() || ''} ${frame.name?.() || ''}`; } catch { return ''; }
  };
  const scan = async (page, scanOptions = {}) => {
    check();
    if (mode === 'off') return result();
    if (scanOptions.externalAction === mode && observed.length) {
      interacted = true;
      decisionMade = true;
      totalSteps++;
      for (const key of new Set(observed.map(item => item.budgetKey))) attempts.set(key, (attempts.get(key) || 0) + 1);
    }
    let frames;
    try { frames = typeof page.frames === 'function' ? page.frames() : [page]; } catch { frames = [page]; }
    const mainFrame = typeof page.mainFrame === 'function' ? page.mainFrame() : frames[0];
    const found = [];
    let readable = false;
    let unresolvedFrame = false;
    const previousFrames = new Set(observed.map(item => item.frame));
    for (const frame of frames.slice(0, 128)) {
      check();
      if (typeof frame.evaluate !== 'function') continue;
      try {
        let frameVisible = true;
        for (let ancestor = frame, depth = 0; depth < 16 && typeof ancestor.parentFrame === 'function' && ancestor.parentFrame() && typeof ancestor.frameElement === 'function'; ancestor = ancestor.parentFrame(), depth++) {
          const owner = await ancestor.frameElement();
          try {
            if (owner && !await owner.evaluate(element => {
              for (let current = element; current; current = current.parentElement || current.getRootNode()?.host) {
                const style = getComputedStyle(current);
                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
              }
              const rectangle = element.getBoundingClientRect();
              return rectangle.width > 0 && rectangle.height > 0;
            })) frameVisible = false;
          } finally { await owner?.dispose?.(); }
          if (!frameVisible) break;
        }
        if (!frameVisible) continue;
        const request = { mode, frameHint: frameHint(frame) };
        const candidates = await frame.evaluate(inspectConsentDocument, request);
        if (!Array.isArray(candidates)) continue; // Compatibility with lightweight browser test doubles.
        for (const candidate of candidates) found.push({ ...candidate, frame, request, budgetKey: candidate.provider });
        if (frame === mainFrame && !candidates.length && await frame.evaluate(inspectConsentDocument, { ...request, operation: 'content' })) readable = true;
      } catch (error) {
        check();
        if (previousFrames.has(frame) && !frame.detached && !(typeof frame.isDetached === 'function' && frame.isDetached())) unresolvedFrame = true;
        // A CMP may replace its frame or navigate the page after a real click.
        // The next post-load pass inspects the replacement document.
      }
    }
    const primaryProvider = found.find(item => item.provider !== 'generic')?.provider;
    // A settings link in the parent document and the CMP frame it opens form
    // one consent flow. Replacing that iframe cannot reset its step budget.
    for (const item of found) if (item.provider === 'generic' && primaryProvider) item.budgetKey = primaryProvider;
    observed = found;
    if (!found.length) {
      if (state.detected) {
        state.status = decisionMade && readable && !unresolvedFrame ? 'handled' : interacted ? 'failed' : 'unsupported';
        if (state.status === 'handled') delete state.reason;
        else state.reason = unresolvedFrame ? 'A previously detected consent frame could not be inspected to verify completion.'
          : decisionMade ? 'The consent dialog disappeared, but readable page content could not be verified.' : 'The consent dialog disappeared without a verified consent decision.';
      }
      return result();
    }
    state.detected = true;
    const known = found.find(item => item.provider !== 'generic');
    if (known || !state.provider) state.provider = known?.provider || found[0].provider;
    state.status = found.some(item => item.blocked) ? 'blocked' : interacted ? 'failed' : 'unsupported';
    state.reason = state.status === 'blocked' ? 'The consent wall requires acceptance, an account, or a subscription; the selected policy cannot release its content.'
      : interacted ? 'The consent dialog remains visible after interaction.' : 'No supported consent decision has completed.';
    if (scanOptions.interact === false) return result();
    const rank = { reject: 0, accept: 0, toggles: 1, save: 2, settings: 3 };
    // A cumulative cap also covers generic settings panes becoming a known CMP
    // or moving between replacement frames. Those transitions cannot reset it.
    const candidate = totalSteps < 3 && found.filter(item => item.kind && (attempts.get(item.budgetKey) || 0) < 3
      && !(item.kind === 'settings' && settingsOpened.has(item.budgetKey)) && typeof item.frame.evaluateHandle === 'function')
      .sort((left, right) => rank[left.kind] - rank[right.kind])[0];
    if (!candidate || !withinDeadline()) {
      if (totalSteps >= 3 || found.some(item => (attempts.get(item.budgetKey) || 0) >= 3)) {
        state.status = 'failed';
        state.reason = 'The consent dialog remains visible after three interaction steps.';
      }
      return result();
    }
    attempts.set(candidate.budgetKey, (attempts.get(candidate.budgetKey) || 0) + 1);
    totalSteps++;
    if (candidate.kind === 'settings') settingsOpened.add(candidate.budgetKey);
    // Turning off the optional categories is a single settings step, with a
    // bounded number of native clicks. No DOM mutation or synthetic .click().
    for (let index = 0; index < candidate.count; index++) {
      check();
      if (!withinDeadline()) break;
      let handle;
      try {
        // Re-inspect for every click: preceding clicks can rerender controls.
        // Toggle index stays zero because each unchecked control drops out.
        handle = await candidate.frame.evaluateHandle(inspectConsentDocument, { ...candidate.request, operation: 'element', key: candidate.key, index: candidate.kind === 'toggles' ? 0 : index });
        const element = handle.asElement?.();
        if (!element || typeof element.click !== 'function') break;
        await element.click();
        interacted = true;
        if (candidate.kind === 'reject' || candidate.kind === 'accept' || candidate.kind === 'save') decisionMade = true;
        state.status = 'failed';
        state.reason = 'The consent decision is awaiting verification.';
      } catch (error) {
        check();
        state.status = 'failed';
        state.reason = 'A consent control could not be clicked or its frame changed during interaction.';
        break;
      } finally { try { await handle?.dispose?.(); } catch {} }
    }
    return result();
  };
  return { scan, result };
}

module.exports = { createConsentHandler };
