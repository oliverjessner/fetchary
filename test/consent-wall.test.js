'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectConsentWall, consentMetadata } = require('../src/capture/consent-wall');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/consent', `${name}.html`), 'utf8');

test('static consent evidence recognizes lengthy walls and localized choices', () => {
  for (const [name, provider] of [
    ['long-wall','onetrust'], ['onetrust','onetrust'], ['cookiebot','cookiebot'],
    ['usercentrics','usercentrics'], ['didomi','didomi'], ['consentmanager','consentmanager'],
    ['generic-en','generic'], ['generic-de','generic'],
  ]) assert.deepEqual(detectConsentWall(fixture(name), 'https://news.example.test/'), { detected:true, provider }, name);
});

test('visible known Sourcepoint frames are walls even when the copy exists only in the iframe', () => {
  assert.deepEqual(detectConsentWall(fixture('sourcepoint-parent')), { detected:true, provider:'sourcepoint' });
});

test('unknown fixed overlays and aria-only consent context provide strong static wall evidence', () => {
  for (const name of ['generic-fixed','generic-aria']) {
    assert.deepEqual(detectConsentWall(fixture(name), 'https://news.example.test/'), { detected:true, provider:'generic' }, name);
  }
});

test('static evidence ignores installed SDKs, hidden choices, reporting and unrelated controls', () => {
  for (const html of [
    fixture('editorial'), fixture('unrelated'),
    fixture('editorial').replace('</head>', '<script src="https://cdn.example.test/onetrust-cookies-consent.js"></script></head>'),
    fixture('onetrust').replace('id="onetrust-banner-sdk"', 'id="onetrust-banner-sdk" style="display:none"'),
    '<main>Cookie policy reporting: our article explains privacy choices.</main><iframe name="__tcfapiLocator" src="https://consent.example.test/locator"></iframe>',
  ]) assert.deepEqual(detectConsentWall(html, 'https://news.example.test/article'), { detected:false, provider:null });
});

test('a dedicated consent page is recognized without relying on text length', () => {
  assert.deepEqual(detectConsentWall('<html><body><h1>Cookie choices</h1><p>Manage your privacy settings.</p></body></html>', 'https://news.example.test/consent/'), { detected:true, provider:'generic' });
});

test('HTTP consent metadata reports limitations rather than a handled decision', () => {
  const evidence = { detected:true, provider:'sourcepoint' };
  for (const action of ['reject','accept','off']) {
    const metadata = consentMetadata(evidence, action);
    assert.equal(metadata.detected, true);
    assert.equal(metadata.provider, 'sourcepoint');
    assert.equal(metadata.action, action);
    assert.equal(metadata.status, 'unsupported');
    assert.ok(metadata.reason);
  }
  assert.deepEqual(consentMetadata({ detected:false, provider:null }), {
    detected:false, provider:null, action:'reject', status:'not_detected',
  });
});
