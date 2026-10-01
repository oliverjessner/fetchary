'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const { createFetchary } = require('../src');

function fixtureHtml(vendor, fixture) {
  const tiktok = vendor === 'tiktok';
  const cookieLabel = fixture.unsupported ? 'Manage cookies'
    : fixture.german ? (tiktok ? 'Optionale Cookies ablehnen' : 'Ablehnen')
      : (tiktok ? '  Decline   optional cookies  ' : '  Reject  ');
  const cookieAttributes = tiktok ? 'data-e2e="cookie-banner"' : fixture.onetrust ? 'id="onetrust-banner-sdk"' : 'data-a-target="consent-banner"';
  const rejectAttributes = fixture.onetrust ? 'id="onetrust-reject-all-handler"' : 'id="reject"';
  const controls = `
    <button data-decoy style="display:none">${cookieLabel}</button>
    <button data-decoy disabled>${cookieLabel}</button>
    <div role="button" data-decoy aria-disabled="true">${cookieLabel}</div>
    <button data-decoy>Accept all</button>
    <button ${rejectAttributes} ${fixture.accessible ? `aria-label="${cookieLabel}"` : ''}>${fixture.accessible ? 'Cookie choice' : fixture.onetrust ? 'Refuser' : cookieLabel}</button>`;
  const cookie = `<div id="consent"><div ${cookieAttributes}><h2>Cookies</h2>${controls}</div></div>`;
  const closeLabel = fixture.german ? 'Schließen' : tiktok ? 'Close_button' : 'Close';
  const title = fixture.unrelated ? '<h2>Video settings</h2><p>Log in to see more videos.</p>'
    : fixture.german ? `<h2>Bei ${tiktok ? 'TikTok' : 'Twitch'} anmelden</h2>`
      : `<h2>Log in to ${tiktok ? 'TikTok' : 'Twitch'}</h2>`;
  let authAttributes = fixture.unrelated ? '' : tiktok ? 'data-e2e="login-modal"' : 'data-a-target="passport-modal"';
  if (fixture.titleOnly) authAttributes = '';
  const closeAttributes = fixture.markerClose ? (tiktok ? 'data-e2e="modal-close-inner-button"' : 'data-a-target="modalClose"') : `aria-label="${closeLabel}"`;
  const close = fixture.undismissible ? '' : `<button id="close" ${closeAttributes}></button>`;
  const authBody = `<div ${authAttributes}>${title}
    <form ${!tiktok && fixture.titleOnly ? 'name="login-submit-form"' : ''}><input name="username"><input type="password"><button data-decoy>Log in</button></form>
    <button data-decoy style="display:none" aria-label="${closeLabel}"></button>
    <button data-decoy disabled aria-label="${closeLabel}"></button>
    <div role="button" data-decoy aria-disabled="true" aria-label="${closeLabel}"></div>
    ${close}
  </div>`;
  const login = fixture.loginPage ? `<main id="login">${authBody}</main>`
    : `<div role="dialog" aria-modal="true" id="login" ${fixture.captcha ? 'class="captcha-verify-container"' : ''}>${authBody}</div>`;
  const verification = tiktok
    ? '<div role="dialog" id="verification" class="captcha-verify-container"><h2>Drag the slider to fit the puzzle</h2><button data-decoy id="captcha_close_button" aria-label="Close">Close</button></div>'
    : '<div role="dialog" id="verification" data-a-target="content-classification-gate-overlay"><h2>Mature content</h2><button data-decoy aria-label="Close">Close</button></div>';
  const shadow = Boolean(tiktok && fixture.shadow);

  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main id="profile">Public ${vendor} profile</main>
    <button data-decoy>${cookieLabel}</button><button data-decoy aria-label="${closeLabel}">Close</button>
    ${verification}
    <script>
      const bindDecoys = root => {
        for (const element of root.querySelectorAll('[data-decoy]')) {
          element.onclick = () => { document.body.dataset.unwantedClick = 'true'; };
        }
      };
      const showLogin = () => {
        document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(login)});
        bindDecoys(document);
        const close = document.querySelector('#close');
        if (close) close.onclick = () => { document.querySelector('#login').remove(); };
      };
      const showConsent = () => {
        let root;
        if (${shadow}) {
          const host = document.createElement('tiktok-cookie-banner');
          host.id = 'consent';
          document.body.append(host);
          root = host.attachShadow({ mode: 'open' });
          if (${Boolean(fixture.nestedShadow)}) {
            const child = document.createElement('cookie-controls');
            root.append(child);
            root = child.attachShadow({ mode: 'open' });
          }
          root.innerHTML = ${JSON.stringify(controls)};
        } else {
          document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(cookie)});
          root = document.querySelector('#consent');
        }
        bindDecoys(root);
        root.querySelector('button#reject, #onetrust-reject-all-handler').onclick = () => {
          document.querySelector('#consent').remove();
          ${fixture.delay ? `setTimeout(showLogin, ${fixture.delay});` : 'showLogin();'}
        };
      };
      bindDecoys(document);
      ${fixture.cookies === false ? 'showLogin();' : fixture.delay ? `setTimeout(showConsent, ${fixture.delay});` : 'showConsent();'}
    </script>
  </body></html>`;
}

for (const vendor of ['tiktok', 'twitch']) {
  test(`${vendor} captures reject cookies, close authentication dialogs, and respect persisted activation`, async t => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `fetchary-${vendor}-`));
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const raw = `<!doctype html><html><body>Original ${vendor} response</body></html>\n`;
    const fixtures = {
      english: {},
      german: { german: true },
      accessible: { accessible: true },
      'marker-close': { markerClose: true },
      'title-only': { titleOnly: true },
      delayed: { delay: 35, shadow: vendor === 'tiktok' },
      unrelated: { cookies: false, unrelated: true },
      undismissible: { cookies: false, undismissible: true },
      'login-page': { cookies: false, loginPage: true, undismissible: true },
      'unsupported-cookie': { unsupported: true },
      disabled: { disabled: true, shadow: vendor === 'tiktok' },
      ...(vendor === 'tiktok' ? { shadow: { shadow: true }, 'nested-shadow': { shadow: true, nestedShadow: true }, captcha: { cookies: false, captcha: true } } : { onetrust: { onetrust: true } }),
    };
    const fetchary = await createFetchary({
      dataDir,
      fetch: async () => new Response(raw, { headers: { 'content-type': 'text/html' } }),
      launchBrowser: async options => {
        const browser = await require('puppeteer').launch(options);
        return {
          async newPage() {
            const page = await browser.newPage();
            await page.setRequestInterception(true);
            page.on('request', async request => {
              const key = new URL(request.url()).pathname.split('/').pop().replace(/^@/, '');
              await request.respond(fixtures[key] ? { contentType: 'text/html', body: fixtureHtml(vendor, fixtures[key]) } : { status: 404, body: '' });
            });
            return page;
          },
          async close() { await browser.close(); },
        };
      },
    });
    t.after(() => fetchary.close());
    assert.equal((await fetchary.vendors()).find(record => record.name === vendor).active, true, 'the module is automatically registered');

    for (const [key, fixture] of Object.entries(fixtures)) {
      await t.test(key, async () => {
        await fetchary.setVendorActive(vendor, !fixture.disabled);
        const url = vendor === 'tiktok' ? `https://www.tiktok.com/@${key}` : `https://www.twitch.tv/${key}`;
        const source = await fetchary.add(url, { waitAfterLoad: fixture.delay ? '250ms' : 0 });
        const version = await fetchary.version(source.id);
        const rendered = await fetchary.readRendered(source.id);
        const { document } = parseHTML(rendered);
        const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(version.file), 'metadata.json'), 'utf8'));
        const preserveConsent = Boolean(fixture.disabled || fixture.unsupported);
        const preserveLogin = Boolean(fixture.unrelated || fixture.undismissible || fixture.loginPage || fixture.captcha);
        const expected = [];
        if (fixture.cookies !== false && !preserveConsent) expected.push(`${vendor}-cookie-consent`);
        if (!preserveConsent && !preserveLogin) expected.push(`${vendor}-login-dialog`);
        assert.deepEqual(metadata.capture.dismissedOverlays, expected);
        assert.equal(Boolean(document.getElementById('consent')), preserveConsent);
        assert.equal(Boolean(document.getElementById('login')), preserveLogin);
        assert.equal(document.body.hasAttribute('data-unwanted-click'), false, 'other controls and verification dialogs are preserved');
        assert.ok(document.getElementById('verification'));
        assert.equal(document.getElementById('profile').textContent, `Public ${vendor} profile`);
        assert.equal(await fetchary.read(source.id), raw);
        assert.equal(version.rawHash, crypto.createHash('sha256').update(raw).digest('hex'));
        assert.equal(version.renderedHash, crypto.createHash('sha256').update(rendered).digest('hex'));
      });
    }
  });
}
