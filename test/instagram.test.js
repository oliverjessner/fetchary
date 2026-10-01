'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const { createFetchary } = require('../src');

test('Instagram overlays are handled before Chromium capture without changing raw evidence', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-instagram-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const raw = '<!doctype html><html><body>Original Instagram response</body></html>\n';
  const fixtures = {
    english: {},
    german: { german: true },
    accessible: { accessibleCookie: true, close: 'aria' },
    form: { login: 'form', close: 'aria' },
    'not-now': { close: 'text' },
    delayed: { delay: 35 },
    'cookies-only': { login: false },
    'login-only': { cookie: false },
    undismissible: { cookie: false, close: false },
    'login-page': { cookie: false, login: 'page' },
    unrelated: { cookie: false, login: 'unrelated' },
    'unsupported-cookie': { cookieLabel: 'Manage cookies', login: false },
  };

  function fixtureHtml(fixture) {
    const cookieLabel = fixture.cookieLabel || (fixture.german ? 'Optionale Cookies ablehnen' : '  Decline   optional cookies  ');
    const loginLabel = fixture.german ? 'Anmelden' : 'Log in';
    const closeLabel = fixture.german ? 'Schließen' : 'Close';
    let close = `<div role="button" id="close"><svg aria-label="${closeLabel}"><path d="M0 0"></path></svg></div>`;
    if (fixture.close === false) close = '';
    if (fixture.close === 'aria') close = `<button id="close" aria-label="${closeLabel}"></button>`;
    if (fixture.close === 'text') close = '<button id="close">Not now</button>';
    const inputs = '<input name="username"><input type="password" name="password">';
    const title = fixture.login === 'form' ? inputs
      : fixture.login === 'unrelated' ? '<h2>Instagram post</h2><p>Log in to Instagram to like this post.</p>'
        : `<span>${fixture.german ? 'Sieh dir Fotos, Videos und mehr von example an' : 'See photos, videos and more from example'}</span>`;
    const login = fixture.login === false ? ''
      : fixture.login === 'page' ? `<form id="login">${inputs}<button>${loginLabel}</button></form>`
        : `<div role="dialog" aria-modal="true" id="login">
          ${title}
          <button>${loginLabel}</button><button>${fixture.german ? 'Registrieren' : 'Sign up'}</button>
          <button style="display:none" data-decoy>Close</button>
          <button disabled data-decoy>Close</button>
          <div role="button" aria-disabled="true" data-decoy>Close</div>
          ${close}
        </div>`;
    const cookieControl = fixture.accessibleCookie
      ? `<div role="button" id="decline" aria-label="${cookieLabel}">Cookie choice</div>`
      : `<button id="decline">${cookieLabel}</button>`;
    const cookie = `<div role="dialog" aria-modal="true" id="consent">
      <h2>${fixture.german ? 'Cookies von Instagram' : 'Cookies from Instagram'}</h2>
      <button style="display:none" data-decoy>Decline optional cookies</button>
      <button disabled data-decoy>Decline optional cookies</button>
      <div role="button" aria-disabled="true" data-decoy>Decline optional cookies</div>
      <button data-decoy>Allow all cookies</button>${cookieControl}
    </div>`;

    return `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <main>Public Instagram profile</main>
      <button data-decoy>Decline optional cookies</button><button data-decoy aria-label="Close">Close</button>
      <script>
        const bindControls = () => {
          for (const element of document.querySelectorAll('[data-decoy]')) {
            element.onclick = () => { document.body.dataset.unwantedClick = 'true'; };
          }
          const close = document.querySelector('#close');
          if (close) close.onclick = () => { document.querySelector('#login').remove(); };
        };
        const showLogin = () => {
          document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(login)});
          bindControls();
        };
        const showConsent = () => {
          document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(cookie)});
          bindControls();
          document.querySelector('#decline').onclick = () => {
            document.querySelector('#consent').remove();
            ${fixture.delay ? `setTimeout(showLogin, ${fixture.delay});` : 'showLogin();'}
          };
        };
        ${fixture.cookie === false ? 'showLogin();' : fixture.delay ? `setTimeout(showConsent, ${fixture.delay});` : 'showConsent();'}
      </script>
    </body></html>`;
  }

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
            const key = new URL(request.url()).pathname.split('/').filter(Boolean).pop();
            await request.respond(fixtures[key]
              ? { contentType: 'text/html', body: fixtureHtml(fixtures[key]) }
              : { status: 404, body: '' });
          });
          return page;
        },
        async close() { await browser.close(); },
      };
    },
  });
  t.after(() => fetchary.close());

  for (const [key, fixture] of Object.entries(fixtures)) {
    await t.test(key, async () => {
      const source = await fetchary.add(`https://www.instagram.com/${key}/`, { waitAfterLoad: fixture.delay ? '250ms' : 0 });
      const version = await fetchary.version(source.id);
      const rendered = await fetchary.readRendered(source.id);
      const { document } = parseHTML(rendered);
      const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(version.file), 'metadata.json'), 'utf8'));
      const expected = [];
      if (fixture.cookie !== false && !fixture.cookieLabel) expected.push('instagram-cookie-consent');
      const preserveLogin = fixture.close === false || fixture.login === 'page' || fixture.login === 'unrelated';
      if (fixture.login !== false && !preserveLogin) expected.push('instagram-login-dialog');

      assert.deepEqual(metadata.capture.dismissedOverlays, expected);
      assert.equal(await fetchary.read(source.id), raw);
      assert.equal(version.rawHash, crypto.createHash('sha256').update(raw).digest('hex'));
      assert.equal(version.renderedHash, crypto.createHash('sha256').update(rendered).digest('hex'));
      assert.equal(document.body.hasAttribute('data-unwanted-click'), false, 'unrelated, hidden and disabled controls are left alone');
      assert.equal(document.querySelector('main').textContent, 'Public Instagram profile');
      assert.equal(Boolean(document.getElementById('consent')), Boolean(fixture.cookieLabel));
      assert.equal(Boolean(document.getElementById('login')), preserveLogin);
    });
  }
});
