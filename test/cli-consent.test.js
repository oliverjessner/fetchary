'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { main, parseArgs } = require('../cli');
const { clearCache } = require('../src');

const target = 'https://consent-cli.example.test/';

async function run(args, options) {
  let stdout = ''; let stderr = '';
  const code = await main(args, {
    options,
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } },
  });
  return { code, stdout, stderr };
}

test('CLI parses consent modes with separated and equals values and documents the default', async () => {
  for (const consent of ['reject', 'accept', 'off']) {
    assert.equal(parseArgs(['extract', 'text', target, '--consent', consent]).options.consent, consent);
    assert.equal(parseArgs(['extract', 'html', target, `--consent=${consent}`]).options.consent, consent);
  }
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--consent reject\|accept\|off\s+Cookie consent policy \(default: reject\)/);
});

test('invalid or missing CLI consent modes fail before transport and retain JSON errors', async () => {
  let requests = 0;
  const options = { allowPrivateNetwork: true, mode: 'http', fetch: async () => { requests++; throw new Error('must not fetch'); } };
  for (const extra of [['--consent'], ['--consent='], ['--consent', 'yes'], ['--consent=Reject'], ['--consent=false']]) {
    const result = await run(['extract', 'text', target, '--json', ...extra], options);
    assert.equal(result.code, 2, extra.join(' '));
    assert.equal(result.stdout, '');
    const error = JSON.parse(result.stderr);
    assert.equal(error.error, 'FetcharyValidationError');
    assert.match(error.message, /consent/);
  }
  assert.equal(requests, 0);
});

test('CLI passes each consent policy to HTTP extraction without starting a browser', async () => {
  clearCache();
  let requests = 0; let launches = 0;
  const options = {
    allowPrivateNetwork: true,
    fetch: async () => {
      requests++;
      return new Response('<h1>Editorial headline</h1><p>Ordinary article content.</p>', { headers: { 'content-type': 'text/html' } });
    },
    launchBrowser: async () => { launches++; throw new Error('HTTP mode must not render'); },
  };
  const cases = [['reject', []], ['reject', ['--consent', 'reject']], ['accept', ['--consent=accept']], ['off', ['--consent', 'off']]];
  for (const [consent, extra] of cases) {
    const result = await run(['extract', 'text', target, '--mode', 'http', '--json', ...extra], options);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    const json = JSON.parse(result.stdout);
    assert.equal(json.captureMode, 'http');
    assert.equal(json.data, 'Editorial headline\nOrdinary article content.');
    assert.deepEqual(json.consent, { detected: false, provider: null, action: consent, status: 'not_detected' });
  }
  assert.equal(launches, 0);
  assert.equal(requests, 3, 'default and explicit rejection share a capture; distinct policies do not');
  clearCache();
});

test('CLI accepts shared consent on analysis and rejects it on session/history commands', async () => {
  const options = { allowPrivateNetwork: true, mode: 'http', fetch: async () => new Response('<title>Example</title><p>Normal content.</p>', { headers: { 'content-type': 'text/html' } }) };
  const analysis = await run(['analyse', target, '--consent', 'off'], options);
  assert.equal(analysis.code, 0, analysis.stderr);
  assert.equal(JSON.parse(analysis.stdout).consent.action, 'off');
  for (const args of [['sessions'], ['history'], ['login', target], ['logout', 'example']]) {
    const result = await run([...args, '--consent', 'off'], options);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--consent is not supported/);
  }
});

test('CLI returns captured HTTP/off wall output with warnings and unsuccessful exit status', async () => {
  const html = '<div role="dialog" id="onetrust-banner-sdk"><h1>Cookie privacy choices</h1><p>We use cookies and personal data for tracking and advertising.</p><button>Accept all cookies</button></div>';
  const options = {
    allowPrivateNetwork: true,
    mode: 'http',
    fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async () => { throw new Error('must stay HTTP-only'); },
  };
  for (const policy of [[], ['--consent', 'off']]) {
    const result = await run(['extract', 'html', target, '--json', ...policy], options);
    assert.equal(result.code, 1);
    const json = JSON.parse(result.stdout);
    assert.equal(json.data, html);
    assert.equal(json.consent.detected, true);
    assert.equal(json.consent.status, 'unsupported');
    const warning = JSON.parse(result.stderr);
    assert.equal(warning.warning, 'Consent not resolved');
    assert.deepEqual(warning.consent, json.consent);
    const plain = await run(['extract', 'text', target, ...policy], options);
    assert.equal(plain.code, 1);
    assert.match(plain.stdout, /Cookie privacy choices/);
    assert.match(plain.stderr, /^Warning: consent not resolved \(unsupported, onetrust\)/);
    const quiet = await run(['extract', 'text', target, '--quiet', ...policy], options);
    assert.equal(quiet.code, 1);
    assert.equal(quiet.stdout, '');
    assert.match(quiet.stderr, /consent not resolved/);
  }
});
