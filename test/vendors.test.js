'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const youtube = require('../src/vendors/youtube');
const instagram = require('../src/vendors/instagram');
const tiktok = require('../src/vendors/tiktok');
const twitch = require('../src/vendors/twitch');
const { dismissVendorOverlays } = require('../src/vendors');

test('YouTube URL matching includes consent and short links without matching unrelated hosts', () => {
  for (const url of [
    'https://youtube.com/watch?v=example',
    'https://www.youtube.com/@example',
    'https://m.youtube.com/watch?v=example',
    'https://consent.youtube.com/m?continue=https%3A%2F%2Fwww.youtube.com',
    'https://YOUTUBE.COM/@example',
    'https://youtu.be/example',
  ]) {
    assert.equal(youtube.matches(url), true, url);
  }
  for (const url of [
    'https://example.com/youtube.com',
    'https://notyoutube.com/',
    'https://youtube.com.example.com/',
    'https://youtu.be.example.com/',
    'https://youtube.com@example.com/',
    'not a URL',
    '',
  ]) {
    assert.equal(youtube.matches(url), false, url);
  }
});

test('YouTube overlay failures are best-effort and completed actions are not repeated', async () => {
  let evaluations = 0;
  const page = {
    url() { return 'https://www.youtube.com/@example'; },
    async evaluate() {
      evaluations++;
      throw new Error('execution context was destroyed');
    },
  };
  assert.deepEqual(await dismissVendorOverlays(page, page.url()), []);
  assert.equal(evaluations, 1);
  assert.deepEqual(await dismissVendorOverlays(page, page.url(), ['youtube-cookie-consent']), []);
  assert.deepEqual(await dismissVendorOverlays(page, 'https://example.com/'), []);
  assert.equal(evaluations, 1);
});

test('YouTube consent navigation waits are cancelled when no action is taken', async () => {
  let signal;
  const page = {
    url() { return 'https://consent.youtube.com/m'; },
    waitForNavigation(options) {
      assert.equal(options.waitUntil, 'load');
      signal = options.signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
    async evaluate() { return false; },
  };
  assert.deepEqual(await dismissVendorOverlays(page, page.url()), []);
  assert.equal(signal.aborted, true);
});

test('YouTube consent navigation failures do not discard a completed rejection', async () => {
  const page = {
    url() { return 'https://consent.youtube.com/m'; },
    async waitForNavigation() { throw new Error('navigation timeout'); },
    async evaluate() { return true; },
  };
  assert.deepEqual(await dismissVendorOverlays(page, page.url()), ['youtube-cookie-consent']);
});

test('Instagram URL matching accepts only Instagram hosts', () => {
  for (const url of [
    'https://instagram.com/example/',
    'https://www.instagram.com/p/example/',
    'https://m.instagram.com/reel/example/',
    'https://INSTAGRAM.COM/example/',
  ]) {
    assert.equal(instagram.matches(url), true, url);
  }
  for (const url of [
    'https://example.com/instagram.com',
    'https://notinstagram.com/',
    'https://instagram.com.example.com/',
    'https://instagram.com@example.com/',
    'not a URL',
    '',
  ]) {
    assert.equal(instagram.matches(url), false, url);
  }
});

test('Instagram overlay failures are isolated and completed actions are skipped', async () => {
  let evaluations = 0;
  const page = {
    async evaluate() {
      evaluations++;
      throw new Error('execution context was destroyed');
    },
  };
  const url = 'https://www.instagram.com/example/';
  assert.deepEqual(await dismissVendorOverlays(page, url), []);
  assert.equal(evaluations, 2, 'a failed cookie action does not prevent checking the login dialog');
  assert.deepEqual(await dismissVendorOverlays(page, url, ['instagram-cookie-consent', 'instagram-login-dialog']), []);
  assert.deepEqual(await dismissVendorOverlays(page, 'https://example.com/'), []);
  assert.equal(evaluations, 2);
});

for (const vendor of [tiktok, twitch]) {
  test(`${vendor.name} matches its public hosts without matching unrelated domains`, () => {
    const domain = vendor.name === 'tiktok' ? 'tiktok.com' : 'twitch.tv';
    for (const url of [`https://${domain}/example`, `https://www.${domain}/example`, `https://m.${domain}/example`, `https://${domain.toUpperCase()}/example`]) {
      assert.equal(vendor.matches(url), true, url);
    }
    for (const url of [`https://not${domain}/`, `https://${domain}.example.com/`, `https://${domain}@example.com/`, `https://example.com/${domain}`, 'not a URL', '']) {
      assert.equal(vendor.matches(url), false, url);
    }
    const specialHost = vendor.name === 'tiktok' ? 'https://vm.tiktok.com/example/' : 'https://clips.twitch.tv/example';
    assert.equal(vendor.matches(specialHost), true);
  });

  test(`${vendor.name} overlay failures are best-effort and completed actions are not repeated`, async () => {
    let evaluations = 0;
    const page = { async evaluate() { evaluations++; throw new Error('execution context destroyed'); } };
    const url = vendor.name === 'tiktok' ? 'https://www.tiktok.com/@example' : 'https://www.twitch.tv/example';
    assert.deepEqual(await dismissVendorOverlays(page, url), []);
    assert.equal(evaluations, 2);
    assert.deepEqual(await dismissVendorOverlays(page, url, vendor.overlays.map(overlay => overlay.id)), []);
    assert.deepEqual(await dismissVendorOverlays(page, 'https://example.com/'), []);
    assert.equal(evaluations, 2);
  });
}
