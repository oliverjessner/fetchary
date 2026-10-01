'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const {
  createFetchary,
  FetcharyBrowserError,
  FetcharyValidationError,
} = require('../src');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function localSite(t) {
  let content = 'rendered-one';
  let ignored = 'clock-one';
  const raw = Buffer.from(`<!doctype html>
<html><body>
  <main id="content">initial</main>
  <relative-time>initial-clock</relative-time>
  <script src="/render.js"></script>
</body></html>\n`);
  const server = http.createServer((request, response) => {
    if (request.url === '/render.js') {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end(`window.addEventListener('load', () => setTimeout(() => {
        document.querySelector('#content').textContent = ${JSON.stringify(content)};
        document.querySelector('relative-time').textContent = ${JSON.stringify(ignored)};
      }, 40));`);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(raw);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/page`,
    raw,
    setContent(value) { content = value; },
    setIgnored(value) { ignored = value; },
  };
}

test('browser capture archives raw and rendered evidence and detects rendered-only changes', async t => {
  const dataDir = tempDir(t);
  const output = tempDir(t);
  const site = await localSite(t);
  const fetchary = await createFetchary({ dataDir, timeout: 5_000 });
  t.after(() => fetchary.close());

  const source = await fetchary.add(site.url, {
    waitAfterLoad: '100ms',
    ignoreSelectors: ['relative-time'],
  });
  assert.equal(source.captureMode, 'browser');
  assert.equal(source.waitAfterLoadMs, 100);
  assert.equal(source.rawChanged, true);
  assert.equal(source.renderedChanged, true);
  assert.equal(source.contentChanged, true);
  assert.equal(source.currentRawHash, source.currentHash);
  assert.equal(typeof source.currentRenderedHash, 'string');
  assert.equal(typeof source.currentComparisonHash, 'string');

  const first = await fetchary.version(source.id, 1);
  const rawBytes = fs.readFileSync(first.file);
  const renderedBytes = fs.readFileSync(first.renderedFile);
  assert.deepEqual(rawBytes, site.raw, 'rendering does not alter the raw HTTP evidence');
  assert.match(renderedBytes.toString('utf8'), /rendered-one/);
  assert.equal(first.rawHash, crypto.createHash('sha256').update(rawBytes).digest('hex'));
  assert.equal(first.renderedHash, crypto.createHash('sha256').update(renderedBytes).digest('hex'));
  assert.equal(first.captureMode, 'browser');
  assert.equal(await fetchary.read(source.id, 1), site.raw.toString('utf8'));
  assert.match(await fetchary.readRendered(source.id, 1), /rendered-one/);

  site.setContent('rendered-two');
  const renderedOnly = await fetchary.fetch(source.id);
  assert.equal(renderedOnly.rawChanged, false);
  assert.equal(renderedOnly.renderedChanged, true);
  assert.equal(renderedOnly.contentChanged, true);
  assert.equal(renderedOnly.changed, true);
  assert.equal(renderedOnly.version, 2);
  assert.deepEqual(fs.readFileSync((await fetchary.version(source.id, 2)).file), site.raw);

  const renderedDiff = await fetchary.diff(source.id);
  assert.equal(renderedDiff.changed, true);
  assert.equal(renderedDiff.diff.some(part => part.value.includes('rendered-one')), true);
  assert.equal(renderedDiff.diff.some(part => part.value.includes('rendered-two')), true);
  assert.equal((await fetchary.diff(source.id, { mode: 'raw' })).changed, false);

  const lastMeaningfulChange = (await fetchary.get(source.id)).lastChangedAt;
  site.setIgnored('clock-two');
  const ignoredOnly = await fetchary.fetch(source.id);
  assert.equal(ignoredOnly.rawChanged, false);
  assert.equal(ignoredOnly.renderedChanged, true);
  assert.equal(ignoredOnly.contentChanged, false);
  assert.equal(ignoredOnly.changed, false);
  assert.equal(ignoredOnly.version, 3);
  assert.equal((await fetchary.get(source.id)).lastChangedAt, lastMeaningfulChange);
  assert.match(fs.readFileSync((await fetchary.version(source.id, 3)).renderedFile, 'utf8'), /clock-two/);

  const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(first.file), 'metadata.json'), 'utf8'));
  assert.equal(metadata.capture.mode, 'browser');
  assert.equal(metadata.capture.waitUntil, 'load');
  assert.equal(metadata.capture.waitAfterLoadMs, 100);
  assert.equal(typeof metadata.rawCapturedAt, 'string');
  assert.equal(typeof metadata.renderedCapturedAt, 'string');
  assert.equal(metadata.rawSha256, first.rawHash);
  assert.equal(metadata.renderedSha256, first.renderedHash);
  assert.equal(metadata.comparisonSha256, first.comparisonHash);

  const exported = await fetchary.export(source.id, { output });
  const rawExport = path.join(exported.directory, 'versions', '001-response.html');
  const renderedExport = path.join(exported.directory, 'versions', '001-rendered.html');
  assert.deepEqual(fs.readFileSync(rawExport), rawBytes);
  assert.deepEqual(fs.readFileSync(renderedExport), renderedBytes);
  const hashes = fs.readFileSync(path.join(exported.directory, 'hashes.txt'), 'utf8');
  assert.match(hashes, new RegExp(`${first.rawHash}  versions/001-response\\.html`));
  assert.match(hashes, new RegExp(`${first.renderedHash}  versions/001-rendered\\.html`));
});

test('non-HTML browser sources use HTTP semantics without launching Chromium', async t => {
  const dataDir = tempDir(t);
  let launches = 0;
  const body = Buffer.from('{"ok":true}\n');
  const fetchary = await createFetchary({
    dataDir,
    fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    launchBrowser: async () => { launches++; throw new Error('must not launch'); },
  });
  t.after(() => fetchary.close());

  const source = await fetchary.add('https://example.test/api');
  const version = await fetchary.version(source.id);
  assert.equal(source.captureMode, 'browser', 'the configured mode remains inspectable');
  assert.equal(source.renderedChanged, false);
  assert.equal(version.captureMode, 'http');
  assert.equal(version.renderedFile, null);
  assert.equal(launches, 0);
});

test('Threads cookie consent is declined during the post-load wait', async t => {
  const dataDir = tempDir(t);
  let evaluations = 0;
  let clicked = false;
  const consentButton = {
    innerText: '  Decline   optional cookies  ',
    click() { clicked = true; },
  };
  const consentDialog = {
    querySelectorAll() { return [consentButton]; },
  };
  const fetchary = await createFetchary({
    dataDir,
    fetch: async () => new Response('<div id="app"></div>', { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async () => ({
      async newPage() {
        return {
          async goto() {},
          async evaluate(callback) {
            evaluations++;
            const dialogs = evaluations > 1 ? [consentDialog] : [];
            return vm.runInNewContext(`(${callback.toString()})()`, {
              document: { querySelectorAll() { return dialogs; } },
            });
          },
          async content() { return '<html><body><main>Threads profile</main></body></html>'; },
          url() { return 'https://www.threads.com/@example'; },
          async close() {},
        };
      },
      async close() {},
    }),
  });
  t.after(() => fetchary.close());

  const source = await fetchary.add('https://www.threads.com/@example', { waitAfterLoad: '120ms' });
  const version = await fetchary.version(source.id);
  const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(version.file), 'metadata.json'), 'utf8'));

  assert.equal(clicked, true);
  assert.equal(evaluations >= 2, true, 'the consent control may appear after load');
  assert.deepEqual(metadata.capture.dismissedOverlays, ['threads-cookie-consent']);
});

test('X cookie consent and login dialogs are dismissed by the X vendor', async t => {
  const dataDir = tempDir(t);
  let cookieClicked = false;
  let loginClosed = false;
  let browserUserAgent;
  const cookieButton = {
    innerText: 'Refuse non-essential cookies',
    click() { cookieClicked = true; },
  };
  const closeButton = {
    click() { loginClosed = true; },
  };
  const loginDialog = {
    innerText: 'Sign in to X\nSee what is happening in the world right now.',
    querySelector() { return closeButton; },
  };
  const document = {
    querySelectorAll(selector) {
      return selector.startsWith('button') ? [cookieButton] : [loginDialog];
    },
  };
  const fetchary = await createFetchary({
    dataDir,
    fetch: async () => new Response('<div id="react-root"></div>', { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async () => ({
      async newPage() {
        return {
          browser() {
            return { async userAgent() { return 'Mozilla/5.0 HeadlessChrome/140.0.0.0 Safari/537.36'; } };
          },
          async setUserAgent(value) { browserUserAgent = value; },
          async goto() {},
          async evaluate(callback) {
            return vm.runInNewContext(`(${callback.toString()})()`, { document, Set });
          },
          async content() { return '<html><body><main>X profile</main></body></html>'; },
          url() { return 'https://x.com/example'; },
          async close() {},
        };
      },
      async close() {},
    }),
  });
  t.after(() => fetchary.close());

  const source = await fetchary.add('https://x.com/example', { waitAfterLoad: 0 });
  const version = await fetchary.version(source.id);
  const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(version.file), 'metadata.json'), 'utf8'));

  assert.equal(cookieClicked, true);
  assert.equal(loginClosed, true);
  assert.equal(browserUserAgent, 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36');
  assert.deepEqual(metadata.capture.dismissedOverlays, ['x-cookie-consent', 'x-login-dialog']);
});

test('YouTube cookie rejection handles localized dialogs and consent redirects in Chromium', async t => {
  const dataDir = tempDir(t);
  const raw = '<!doctype html><html><body>Original YouTube response</body></html>\n';
  const submissions = [];
  const fixtures = {
    english: { label: '  Reject   all  ' },
    german: { label: 'Alle ablehnen' },
    accessible: { label: 'Reject all', ariaLabel: true },
    delayed: { label: 'Reject all', delay: 40 },
    unsupported: { label: 'Manage options' },
    redirect: { label: 'Alle ablehnen' },
    short: { label: 'Reject all', input: true },
  };

  function rejectControl(fixture) {
    if (fixture.input) return `<input id="reject" type="submit" value="${fixture.label}">`;
    if (fixture.ariaLabel) return `<button id="reject" aria-label="${fixture.label}">Cookie choice</button>`;
    return `<button id="reject">${fixture.label}</button>`;
  }

  function inlineConsent(fixture) {
    const dialog = `<ytd-consent-bump-v2-lightbox id="consent">
      <button id="hidden" style="display:none">Reject all</button>
      <button id="disabled" disabled>Reject all</button>
      <button id="aria-disabled" aria-disabled="true">Reject all</button>
      <button id="accept">Accept all</button>
      ${rejectControl(fixture)}
    </ytd-consent-bump-v2-lightbox>`;
    return `<!doctype html><html><body>
      <main>YouTube channel</main>
      <button id="unrelated">Reject all</button>
      <script>
        document.querySelector('#unrelated').onclick = () => { document.body.dataset.unwantedClick = 'unrelated'; };
        const showConsent = () => {
          document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(dialog)});
          for (const id of ['hidden', 'disabled', 'aria-disabled', 'accept']) {
            document.getElementById(id).onclick = () => { document.body.dataset.unwantedClick = id; };
          }
          document.querySelector('#reject').onclick = () => { document.querySelector('#consent').remove(); };
        };
        ${fixture.delay ? `setTimeout(showConsent, ${fixture.delay});` : 'showConsent();'}
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
            const url = new URL(request.url());
            const key = url.searchParams.get('case') || url.pathname.split('/').pop();
            if (url.hostname === 'youtu.be' || url.pathname.startsWith('/redirect/')) {
              await request.respond({ status: 302, headers: { location: `https://consent.youtube.com/m?case=${key}` } });
            } else if (url.hostname === 'consent.youtube.com' && url.pathname === '/m') {
              await request.respond({ contentType: 'text/html', body: `<!doctype html><html><body>
                <h1>Before you continue to YouTube</h1>
                <form method="post" action="https://consent.youtube.com/save?case=${key}">
                  ${rejectControl(fixtures[key])}
                  <button>Accept all</button>
                </form>
              </body></html>` });
            } else if (url.hostname === 'consent.youtube.com' && url.pathname === '/save') {
              submissions.push({ key, method: request.method() });
              await request.respond({ status: 302, headers: { location: `https://www.youtube.com/target/${key}` } });
            } else if (url.pathname.startsWith('/target/')) {
              await request.respond({ contentType: 'text/html', body: '<!doctype html><html><body><main>YouTube destination</main></body></html>' });
            } else if (url.pathname.startsWith('/inline/')) {
              await request.respond({ contentType: 'text/html', body: inlineConsent(fixtures[key]) });
            } else {
              await request.respond({ status: 404, body: '' });
            }
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
      const redirect = key === 'redirect' || key === 'short';
      const url = key === 'short' ? 'https://youtu.be/short'
        : `https://www.youtube.com/${redirect ? 'redirect' : 'inline'}/${key}`;
      const source = await fetchary.add(url, { waitAfterLoad: fixture.delay ? '150ms' : 0 });
      const version = await fetchary.version(source.id);
      const rendered = await fetchary.readRendered(source.id);
      const { document } = require('linkedom').parseHTML(rendered);
      const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(version.file), 'metadata.json'), 'utf8'));

      assert.equal(await fetchary.read(source.id), raw, 'cookie actions preserve the exact HTTP evidence');
      assert.equal(version.renderedHash, crypto.createHash('sha256').update(rendered).digest('hex'));
      assert.equal(document.body.hasAttribute('data-unwanted-click'), false);
      assert.deepEqual(metadata.capture.dismissedOverlays, key === 'unsupported' ? [] : ['youtube-cookie-consent']);
      if (redirect) {
        assert.equal(version.browserFinalUrl, `https://www.youtube.com/target/${key}`);
        assert.equal(document.querySelector('main').textContent, 'YouTube destination');
        assert.equal(submissions.some(submission => submission.key === key && submission.method === 'POST'), true);
      } else {
        assert.equal(Boolean(document.getElementById('consent')), key === 'unsupported');
        assert.equal(document.querySelector('main').textContent, 'YouTube channel');
      }
    });
  }
});

test('one lazy browser is shared, pages always close, and browser errors are typed', async t => {
  const dataDir = tempDir(t);
  let launches = 0;
  let browserCloses = 0;
  let pageCloses = 0;
  let failNavigation = false;
  let failSnapshot = false;
  const browser = {
    async newPage() {
      return {
        async goto() { if (failNavigation) throw new Error('navigation exploded'); },
        async content() {
          if (failSnapshot) throw new Error('snapshot exploded');
          return '<html><body><p>rendered</p></body></html>';
        },
        url() { return 'https://browser-final.test/'; },
        async close() { pageCloses++; },
      };
    },
    async close() { browserCloses++; },
  };
  const fetchary = await createFetchary({
    dataDir,
    fetch: async url => new Response(`<p>${url}</p>`, { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async options => {
      launches++;
      assert.deepEqual(options, { headless: true });
      return browser;
    },
  });

  const one = await fetchary.add('https://example.test/one', { mode: 'http' });
  const two = await fetchary.add('https://example.test/two', { mode: 'http' });
  await fetchary.edit(one.id, { captureMode: 'browser', waitAfterLoadMs: 0 });
  await fetchary.edit(two.id, { mode: 'browser', waitAfterLoad: '0ms' });
  const results = await fetchary.fetch([one.id, two.id]);
  assert.equal(results.every(result => result.captureMode === 'browser'), true);
  assert.equal(launches, 1, 'concurrent captures share one browser launch');
  assert.equal(pageCloses, 2);

  failNavigation = true;
  await assert.rejects(() => fetchary.fetch(one.id), error => {
    assert.equal(error instanceof FetcharyBrowserError, true);
    assert.equal(error.phase, 'navigation');
    assert.equal(error.sourceId, one.id);
    return true;
  });
  assert.equal(pageCloses, 3, 'failed captures close their page');

  failNavigation = false;
  failSnapshot = true;
  await assert.rejects(() => fetchary.fetch(one.id), error => {
    assert.equal(error instanceof FetcharyBrowserError, true);
    assert.equal(error.phase, 'snapshot');
    return true;
  });
  assert.equal(pageCloses, 4, 'snapshot failures close their page');

  await fetchary.close();
  assert.equal(browserCloses, 1);
});

test('capture settings validate before fetching and persist across restart', async t => {
  const dataDir = tempDir(t);
  let fetchCalls = 0;
  let fetchary = await createFetchary({
    dataDir,
    fetch: async () => { fetchCalls++; return new Response('ok'); },
  });
  await assert.rejects(() => fetchary.add('https://example.test/bad-mode', { mode: 'magic' }), FetcharyValidationError);
  await assert.rejects(() => fetchary.add('https://example.test/bad-wait', { waitAfterLoad: '-1s' }), FetcharyValidationError);
  await assert.rejects(() => fetchary.add('https://example.test/bad-unit', { waitAfterLoad: '5m' }), FetcharyValidationError);
  assert.equal(fetchCalls, 0);

  const source = await fetchary.add('https://example.test/persist', { mode: 'http', waitAfterLoad: '500ms' });
  await assert.rejects(() => fetchary.edit(source.id, { captureMode: 'magic' }), FetcharyValidationError);
  await assert.rejects(() => fetchary.edit(source.id, { waitAfterLoadMs: -1 }), FetcharyValidationError);
  await fetchary.edit(source.id, { captureMode: 'browser', waitAfterLoadMs: '8s' });
  await fetchary.close();

  fetchary = await createFetchary({ dataDir, fetch: async () => new Response('ok') });
  t.after(() => fetchary.close());
  const persisted = await fetchary.get(source.id);
  assert.equal(persisted.captureMode, 'browser');
  assert.equal(persisted.waitAfterLoadMs, 8_000);
});

test('rendered reads and normal diffs fall back to historical raw archives', async t => {
  const dataDir = tempDir(t);
  let raw = '<p>historical raw</p>';
  const fetchary = await createFetchary({
    dataDir,
    fetch: async () => new Response(raw, { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async () => ({
      async newPage() {
        return {
          async goto() {},
          async content() { return '<html><body><p>modern rendered</p></body></html>'; },
          url() { return 'https://example.test/history'; },
          async close() {},
        };
      },
      async close() {},
    }),
  });
  t.after(() => fetchary.close());

  const source = await fetchary.add('https://example.test/history', { mode: 'http' });
  const historical = await fetchary.version(source.id, 1);
  assert.equal(historical.renderedFile, null);
  assert.equal(await fetchary.readRendered(source.id, 1), raw);

  raw = '<p>new server response</p>';
  await fetchary.edit(source.id, { mode: 'browser', waitAfterLoad: 0 });
  await fetchary.fetch(source.id);
  const normal = await fetchary.diff(source.id);
  assert.equal(normal.diff.some(part => part.value.includes('historical raw')), true);
  assert.equal(normal.diff.some(part => part.value.includes('modern rendered')), true);
  const rawDiff = await fetchary.diff(source.id, { mode: 'raw' });
  assert.equal(rawDiff.diff.some(part => part.value.includes('new server response')), true);
});

test('browser launch failures use the browser error hierarchy', async t => {
  const dataDir = tempDir(t);
  const fetchary = await createFetchary({
    dataDir,
    fetch: async () => new Response('<p>html</p>', { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async () => { throw new Error('no chromium'); },
  });
  t.after(() => fetchary.close());
  await assert.rejects(() => fetchary.add('https://example.test/launch'), error => {
    assert.equal(error instanceof FetcharyBrowserError, true);
    assert.equal(error.phase, 'launch');
    assert.match(error.message, /launch Chromium/);
    return true;
  });
});

test('scheduler automatically uses the persisted browser capture mode', async t => {
  const dataDir = tempDir(t);
  let rendered = '<html><body><p>first</p></body></html>';
  let pages = 0;
  const fetchary = await createFetchary({
    dataDir,
    fetch: async () => new Response('<div id="app"></div>', { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async () => ({
      async newPage() {
        pages++;
        return {
          async goto() {},
          async content() { return rendered; },
          url() { return 'https://example.test/scheduled-browser'; },
          async close() {},
        };
      },
      async close() {},
    }),
  });
  t.after(() => fetchary.close());

  const source = await fetchary.add('https://example.test/scheduled-browser', { waitAfterLoad: 0 });
  await fetchary.schedule(source.id, '1m');
  const database = new DatabaseSync(path.join(dataDir, 'fetchary.sqlite'));
  database.prepare('UPDATE schedules SET next_fetch_at = ? WHERE url_id = ?').run('2000-01-01T00:00:00.000Z', source.id);
  database.close();
  rendered = '<html><body><p>second</p></body></html>';

  const changed = new Promise(resolve => fetchary.once('change', resolve));
  const runner = await fetchary.run({ pollInterval: 10 });
  const result = await Promise.race([
    changed,
    new Promise((_, reject) => setTimeout(() => reject(new Error('browser scheduler timed out')), 1_000)),
  ]);
  await runner.stop();

  assert.equal(result.captureMode, 'browser');
  assert.equal(result.rawChanged, false);
  assert.equal(result.renderedChanged, true);
  assert.equal(result.version, 2);
  assert.equal(pages, 2);
});
