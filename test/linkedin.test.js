'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const { createFetchary, FetcharyNotFoundError, FetcharyValidationError } = require('../src');
const linkedin = require('../src/vendors/linkedin');
const { dismissVendorOverlays } = require('../src/vendors');

function count(html, url = 'https://www.linkedin.com/company/example/') {
  return linkedin.followerCount(parseHTML(html).document, url);
}

test('LinkedIn matches only LinkedIn hosts, including localized profiles', () => {
  for (const url of ['https://linkedin.com/in/example/', 'https://www.linkedin.com/company/example/', 'https://de.linkedin.com/in/example/', 'https://uk.linkedin.com/school/example/', 'https://LINKEDIN.COM/showcase/example/']) {
    assert.equal(linkedin.matches(url), true, url);
  }
  for (const url of ['https://notlinkedin.com/', 'https://linkedin.com.example.com/', 'https://linkedin.com@example.com/', 'https://example.com/linkedin.com/', 'not a URL', '']) {
    assert.equal(linkedin.matches(url), false, url);
  }
});

test('LinkedIn overlay failures are isolated and completed actions are skipped', async () => {
  let evaluations = 0;
  const page = { async evaluate() { evaluations++; throw new Error('execution context destroyed'); } };
  const url = 'https://www.linkedin.com/company/example/';
  assert.deepEqual(await dismissVendorOverlays(page, url), []);
  assert.equal(evaluations, 2);
  assert.deepEqual(await dismissVendorOverlays(page, url, linkedin.overlays.map(overlay => overlay.id)), []);
  assert.deepEqual(await dismissVendorOverlays(page, 'https://example.com/'), []);
  assert.equal(evaluations, 2);
});

test('LinkedIn company counts use the profile header and metadata instead of employees and recommended companies', () => {
  const decoy = '<aside><span>999K followers</span></aside><p>1,000 employees</p>';
  assert.equal(count(`${decoy}<h3 class="top-card-layout__first-subline">Sunnyvale, CA 34,429,779 followers</h3>`), 34429779);
  assert.equal(count(`${decoy}<div class="org-top-card-summary-info-list__info-item">2,5 Mio. Follower</div>`), 2500000);
  assert.equal(count('<h3 class="top-card-layout__first-subline">London 1.5K followers <span title="1,473"></span></h3>'), 1473);
  assert.equal(count('<meta property="og:description" content="Example | 1.234 Follower auf LinkedIn. Company description">'), 1234);
  assert.equal(count('<meta name="description" content="Example | 1,234 followers on LinkedIn. 500 employees">'), 1234);
  assert.equal(count('<h3 class="top-card-layout__first-subline">Berlin 0 followers</h3>'), 0);
  assert.equal(count(decoy), null);
});

test('LinkedIn profile counts preserve connections as a different metric and support localized headers', () => {
  const url = 'https://de.linkedin.com/in/example/';
  assert.equal(count('<div class="top-card-layout"><div class="top-card__subline-item">500+ connections</div><div class="top-card__subline-item">1.473 Follower</div></div>', url), 1473);
  assert.equal(count('<h3 class="top-card-layout__first-subline">Salzburg und Umgebung 4267 Follower:innen 500+ Kontakte</h3>', url), 4267);
  assert.equal(count('<h3 class="top-card-layout__first-subline">Salzburg 4.267 Follower*innen</h3>', url), 4267);
  assert.equal(count('<div class="pv-top-card"><a href="/in/example/recent-activity/">2,345 followers</a></div>', url), 2345);
  assert.equal(count('<span data-test-id="follower-count">2345</span>', url), 2345);
  assert.equal(count('<div class="pv-top-card"><a href="/in/other/recent-activity/">99K followers</a><a href="https://evil.test/in/example/followers/">100K followers</a></div>', url), null);
  assert.equal(count('<div class="pv-top-card"><a href="https://[invalid]/in/example/followers/">99K followers</a><a href="/in/example/followers/">2345 followers</a></div>', url), 2345);
  assert.equal(count('<div class="pv-top-card"><ul class="pv-top-card--list-bullet"><li>2.3K followers</li><li>500+ connections</li></ul></div>', url), 2300);
  assert.equal(count('<div class="top-card-layout"><div class="top-card__subline-item">500+ Kontakte</div></div>', url), null);
});

test('LinkedIn JSON follower statistics belong to the captured entity and ignore post reactions', () => {
  const data = { '@graph': [
    { '@type': 'SocialMediaPosting', url: 'https://linkedin.com/company/example/', interactionStatistic: { interactionType: 'https://schema.org/LikeAction', userInteractionCount: 9000 } },
    { '@type': 'Organization', url: 'https://linkedin.com/company/other/', interactionStatistic: { interactionType: 'https://schema.org/FollowAction', userInteractionCount: 99999 } },
    { '@type': 'Organization', url: 'https://de.linkedin.com/company/example/', interactionStatistic: [{ interactionType: 'http://schema.org/LikeAction', userInteractionCount: 99 }, { interactionType: { '@type': 'FollowAction' }, userInteractionCount: 1473 }] },
  ] };
  assert.equal(count(`<h3 class="top-card-layout__first-subline">1.5K followers</h3><script type="application/ld+json">${JSON.stringify(data)}</script>`), 1473);
  assert.equal(count('<script type="application/ld+json">{"@type":"Person","url":"/in/example/","interactionStatistic":{"interactionType":"FollowAction","userInteractionCount":0}}</script>', 'https://www.linkedin.com/in/example/'), 0);
  assert.equal(count('<script>{"@type":"Organization","url":"https://evil.test/company/example/","interactionStatistic":{"interactionType":"FollowAction","userInteractionCount":90000}}</script>'), null);
});

test('LinkedIn login walls, challenges and post pages do not provide a profile count', () => {
  const html = '<h3 class="top-card-layout__first-subline">1,234 followers</h3>';
  for (const url of ['https://linkedin.com/authwall', 'https://linkedin.com/checkpoint/challenge/', 'https://linkedin.com/login', 'https://linkedin.com/posts/example/', 'https://linkedin.com/feed/', 'https://linkedin.com/company/example/jobs/']) {
    assert.equal(count(html, url), null, url);
  }
  for (const path of ['company', 'school', 'showcase']) assert.equal(count(html, `https://www.linkedin.com/${path}/example/`), 1234);
  assert.equal(count(html, 'https://www.linkedin.com/company/example/about/'), 1234);
});

test('LinkedIn follower counts use the same capture HTTP profile when Chromium redirects to a login wall', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-linkedin-raw-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const profileUrl = 'https://www.linkedin.com/in/example/';
  let rawUrl = 'https://at.linkedin.com/in/example';
  let raw = '<h3 class="top-card-layout__first-subline">Salzburg 4267 Follower:innen 500+ Kontakte</h3>';
  let renderedUrl = 'https://www.linkedin.com/authwall?sessionRedirect=profile';
  let rendered = '<main><h1>Sign Up | LinkedIn</h1><p>Sign in required</p></main>';
  let requests = 0;
  let fetchary = await createFetchary({
    dataDir,
    fetch: async () => {
      requests++;
      const response = new Response(raw, { headers: { 'content-type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: rawUrl });
      return response;
    },
    launchBrowser: async () => ({
      async newPage() { return { async goto() {}, async content() { return rendered; }, url() { return renderedUrl; }, async close() {} }; },
      async close() {},
    }),
  });
  t.after(() => fetchary.close());
  const source = await fetchary.add(profileUrl, { waitAfterLoad: 0, tag: 'personal' });
  const first = await fetchary.version(source.id);
  const originalRaw = raw;
  const originalRendered = rendered;
  const hashes = [first.rawHash, first.renderedHash];
  assert.equal(await fetchary.followerCount(source.id), 4267);
  assert.equal((await fetchary.followers({ tag: 'personal' })).sum, 4267);
  assert.equal(requests, 1, 'reading the fallback does not make a network request');
  assert.equal(await fetchary.readRendered(source.id), originalRendered, 'the rendered login wall is preserved');
  assert.equal(await fetchary.read(source.id), originalRaw);
  assert.deepEqual([(await fetchary.version(source.id)).rawHash, (await fetchary.version(source.id)).renderedHash], hashes);

  renderedUrl = profileUrl;
  rendered = '<h3 class="top-card-layout__first-subline">0 followers</h3>';
  await fetchary.fetch(source.id);
  assert.equal(await fetchary.followerCount(source.id), 0, 'a rendered zero count takes priority over raw HTTP');
  rendered = '<main>Profile without a count</main>';
  await fetchary.fetch(source.id);
  assert.equal(await fetchary.followerCount(source.id), 4267, 'a matching profile can also use the HTTP fallback');
  renderedUrl = 'https://www.linkedin.com/in/other/';
  rendered = '<main>Other profile without a count</main>';
  await fetchary.fetch(source.id);
  await assert.rejects(() => fetchary.followerCount(source.id), FetcharyNotFoundError);
  renderedUrl = 'https://example.test/login';
  rendered = '<main>Non-vendor login page</main>';
  await fetchary.fetch(source.id);
  await assert.rejects(() => fetchary.followerCount(source.id), FetcharyValidationError);

  renderedUrl = 'https://www.linkedin.com/authwall';
  rendered = '<main>Sign in required</main>';
  rawUrl = 'https://www.linkedin.com/authwall';
  raw = '<main>Sign in required</main>';
  await fetchary.fetch(source.id);
  await assert.rejects(() => fetchary.followerCount(source.id), FetcharyNotFoundError);
  assert.deepEqual(await fetchary.followers(), { followers: [], sum: 0 }, 'an older profile count is not reused');
  rawUrl = 'https://example.test/in/example/';
  raw = originalRaw;
  await fetchary.fetch(source.id);
  await assert.rejects(() => fetchary.followerCount(source.id), FetcharyNotFoundError);

  rawUrl = 'https://at.linkedin.com/in/example';
  raw = '<h3 class="top-card-layout__first-subline">Salzburg 4268 Follower:innen</h3>';
  await fetchary.fetch(source.id);
  assert.equal(await fetchary.followerCount(source.id), 4268);
  assert.equal(fs.readFileSync(first.file, 'utf8'), originalRaw);
  assert.equal(fs.readFileSync(first.renderedFile, 'utf8'), originalRendered);
  await fetchary.close();
  fetchary = await createFetchary({ dataDir, fetch: async () => { throw new Error('archive reads must not fetch'); } });
  assert.equal(await fetchary.followerCount(source.id), 4268);
});

function fixtureHtml(fixture) {
  const decline = fixture.german ? 'Ablehnen' : 'Reject';
  const cookie = `<div id="consent" class="artdeco-global-alert--COOKIE_CONSENT" ${fixture.cookieAria ? 'aria-hidden="true"' : ''}>
    <button data-decoy disabled>${decline}</button><button data-decoy style="display:none">${decline}</button>
    <button data-decoy style="visibility:hidden" data-control-name="ga-cookie.consent.deny.v4">${decline}</button>
    <button data-decoy aria-disabled="true">${decline}</button><button data-decoy>Accept</button>
    <button id="reject" ${fixture.stable ? 'data-tracking-control-name="ga-cookie.consent.deny.v4"' : ''} ${fixture.accessible ? `aria-label="${decline}"` : ''}>${fixture.unsupported ? 'Manage cookies' : fixture.stable ? 'Refuser' : fixture.accessible ? 'Cookie choice' : decline}</button>
  </div>`;
  const title = fixture.unrelated ? 'Video settings' : fixture.portal ? 'Sign in to see who you already know at Example' : fixture.german ? 'Bei LinkedIn anmelden' : 'Sign in to LinkedIn';
  const auth = `<div id="login" ${fixture.hidden ? 'aria-hidden="true"' : ''} ${fixture.visibility ? 'style="visibility:hidden"' : ''} ${fixture.unrelated || fixture.titleOnly || fixture.portal ? 'role="dialog"' : 'class="contextual-sign-in-modal"'}>
    <section role="dialog"><h2>${title}</h2><form><input name="session_key"><input type="password"><button data-decoy>Sign in</button></form>
    ${fixture.challenge ? '<div id="captcha"><button data-decoy aria-label="Dismiss">Close</button></div>' : ''}
    <button data-decoy style="display:none" class="modal__dismiss" aria-label="Dismiss"></button><button data-decoy disabled aria-label="Dismiss"></button>
    ${fixture.undismissible ? '' : `<button id="close" ${fixture.portal ? 'data-tracking-control-name="organization_guest_contextual-sign-in-modal_modal_dismiss"' : ''} ${fixture.stableClose ? 'class="modal__dismiss"' : `aria-label="${fixture.german ? 'Schließen' : 'Dismiss'}"`}></button>`}
    </section></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    ${fixture.authwall ? '<main>Sign in required</main>' : '<main><h1 class="top-card-layout__title">Example</h1><h3 class="top-card-layout__first-subline">Sunnyvale, CA 1,473 followers</h3></main>'}
    <aside>999,999 followers</aside><button data-decoy>${decline}</button><button data-decoy aria-label="Dismiss">Close</button>
    <script>
      const bind = () => {
        for (const element of document.querySelectorAll('[data-decoy]')) element.onclick = () => { document.body.dataset.unwantedClick = 'true'; };
        const reject = document.getElementById('reject');
        if (reject) reject.onclick = () => { document.getElementById('consent').remove(); };
        const close = document.getElementById('close');
        if (close) close.onclick = () => { document.getElementById('login').remove(); };
      };
      const show = () => { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(cookie + auth)}); bind(); };
      bind();
      ${fixture.delay ? 'setTimeout(show, 35);' : 'show();'}
    </script></body></html>`;
}

test('LinkedIn overlays and follower counts work in Chromium while raw evidence and activation are preserved', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-linkedin-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const raw = '<html><body>Original LinkedIn response</body></html>\n';
  const fixtures = {
    english: {}, german: { german: true }, stable: { stable: true, stableClose: true }, accessible: { accessible: true },
    title: { titleOnly: true }, portal: { portal: true }, 'cookie-aria': { cookieAria: true, stable: true },
    delayed: { delay: true }, unrelated: { unrelated: true }, hidden: { hidden: true },
    visibility: { visibility: true }, undismissible: { undismissible: true }, challenge: { challenge: true },
    unsupported: { unsupported: true }, authwall: { authwall: true }, disabled: { disabled: true },
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
            const parsed = new URL(request.url());
            const key = parsed.searchParams.get('fixture') || parsed.pathname.split('/').filter(Boolean).pop();
            if (key === 'authwall' && parsed.pathname !== '/authwall') {
              await request.respond({ status: 302, headers: { location: 'https://www.linkedin.com/authwall?fixture=authwall' } });
              return;
            }
            await request.respond(fixtures[key] ? { contentType: 'text/html', body: fixtureHtml(fixtures[key]) } : { status: 404, body: '' });
          });
          return page;
        },
        async close() { await browser.close(); },
      };
    },
  });
  t.after(() => fetchary.close());
  assert.deepEqual((await fetchary.vendors()).find(vendor => vendor.name === 'linkedin'), { name: 'linkedin', active: true });
  for (const [key, fixture] of Object.entries(fixtures)) {
    await t.test(key, async () => {
      await fetchary.setVendorActive('linkedin', !fixture.disabled);
      const source = await fetchary.add(`https://www.linkedin.com/company/${key}/`, { waitAfterLoad: fixture.delay ? '250ms' : 0, tag: 'linkedin' });
      const version = await fetchary.version(source.id);
      const rendered = await fetchary.readRendered(source.id);
      const { document } = parseHTML(rendered);
      const cookieDismissed = !fixture.disabled && !fixture.unsupported;
      const loginDismissed = !fixture.disabled && !fixture.unrelated && !fixture.hidden && !fixture.visibility && !fixture.undismissible && !fixture.challenge && !fixture.authwall;
      const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(version.file), 'metadata.json'), 'utf8'));
      assert.deepEqual([...metadata.capture.dismissedOverlays].sort(), [cookieDismissed ? 'linkedin-cookie-consent' : null, loginDismissed ? 'linkedin-login-dialog' : null].filter(Boolean).sort());
      assert.equal(Boolean(document.getElementById('consent')), !cookieDismissed);
      assert.equal(Boolean(document.getElementById('login')), !loginDismissed);
      assert.equal(document.body.hasAttribute('data-unwanted-click'), false);
      if (fixture.authwall) await assert.rejects(() => fetchary.followerCount(source.id), FetcharyNotFoundError);
      else assert.equal(await fetchary.followerCount(source.id), 1473);
      assert.equal(await fetchary.read(source.id), raw);
      assert.equal(version.rawHash, crypto.createHash('sha256').update(raw).digest('hex'));
      assert.equal(version.renderedHash, crypto.createHash('sha256').update(rendered).digest('hex'));
    });
  }
  const list = await fetchary.followers({ tag: 'linkedin' });
  assert.equal(list.followers.length, Object.keys(fixtures).length - 1);
  assert.equal(list.sum, list.followers.length * 1473);
});
