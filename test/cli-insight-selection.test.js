'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { main } = require('../cli');
const api = require('../src');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/social', name), 'utf8');
const tiktok = 'https://www.tiktok.com/@example';
function settings(body, status = 200) {
  return { mode: 'http', allowPrivateNetwork: true, fetch: async () => new Response(body, { status, headers: { 'content-type': 'text/html' } }) };
}
async function run(url, flags, options = settings(fixture('tiktok-profile.html'))) {
  let stdout = ''; let stderr = '';
  const code = await main(['extract', 'social-insights', url, ...flags], { options, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { code, stdout, stderr };
}

test('social insight selectors output only the requested count in plain, JSON and list modes', async () => {
  for (const [flag, expected] of [['--follower', 12345], ['--posts', 42]]) {
    for (const format of [[], ['--json'], ['--list'], ['--urls-only'], ['--list', '--json']]) {
      const result = await run(tiktok, [flag, ...format]);
      assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, '');
      assert.equal(result.stdout, `${expected}\n`, `${flag} ${format.join(' ')}`);
    }
  }
});

test('both insight selectors output named fields or ordered list values, with JSON precedence', async () => {
  for (const flags of [['--follower', '--posts'], ['--posts', '--follower']]) {
    for (const format of [[], ['--json'], ['--list', '--json']]) {
      const result = await run(tiktok, [...flags, ...format]);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { followers: 12345, posts: 42 });
      assert.deepEqual(Object.keys(JSON.parse(result.stdout)), ['followers', 'posts']);
    }
    assert.equal((await run(tiktok, [...flags, '--list'])).stdout, '12345\n42\n');
    assert.equal((await run(tiktok, [...flags, '--urls-only'])).stdout, '12345\n42\n');
  }
});

test('follower selection retains GitHub followers, YouTube subscriber fallback and Instagram post counts', async () => {
  const github = await run('https://github.com/example', ['--follower'], settings('<a href="/example?tab=followers">17 followers</a>'));
  assert.equal(github.code, 0, github.stderr); assert.equal(github.stdout, '17\n');
  const youtube = await run('https://www.youtube.com/@example', ['--follower'], settings(fixture('youtube-channel.html')));
  assert.equal(youtube.code, 0, youtube.stderr); assert.equal(youtube.stdout, '12500\n');
  const instagram = await run('https://www.instagram.com/example/', ['--posts'], settings(fixture('instagram-profile.html')));
  assert.equal(instagram.code, 0, instagram.stderr); assert.equal(instagram.stdout, '42\n');
});

test('YouTube channel videos appear as posts in full results and selected CLI output', async () => {
  const target = 'https://www.youtube.com/channel/UCrM7B7SL_g1edFOnmj-SDKg';
  const html = fixture('youtube-channel-header.html');
  const full = await run(target, [], settings(html));
  assert.equal(full.code, 0, full.stderr); assert.equal(JSON.parse(full.stdout).data.metrics.posts, 14361);
  for (const format of [[], ['--json'], ['--list']]) {
    const selected = await run(target, ['--posts', ...format], settings(html));
    assert.equal(selected.code, 0, selected.stderr); assert.equal(selected.stdout, '14361\n');
  }
  const combined = await run('https://www.youtube.com/@example', ['--follower', '--posts'], settings(fixture('youtube-channel.html')));
  assert.equal(combined.code, 0, combined.stderr); assert.deepEqual(JSON.parse(combined.stdout), { followers: 12500, posts: 14361 });
  assert.equal((await run(target, ['--posts'], settings(html.replace('14.361 Videos', '0 Videos')))).stdout, '0\n');
  assert.equal((await run(target, ['--posts'], settings(html.replace('14.361 Videos', 'Videos')))).stdout, 'null\n');
});

test('zero counts stay zero; unavailable, blocked and unsupported counts remain null', async () => {
  const zero = settings(fixture('tiktok-profile.html').replace('"followerCount":12345', '"followerCount":0').replace('"videoCount":42', '"videoCount":0'));
  assert.equal((await run(tiktok, ['--follower'], zero)).stdout, '0\n');
  assert.equal((await run(tiktok, ['--posts'], zero)).stdout, '0\n');
  for (const status of [200, 401, 403, 429]) {
    const options = settings('<p>No public metrics</p>', status);
    for (const flag of ['--follower', '--posts']) {
      const result = await run(tiktok, [flag], options);
      assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, 'null\n'); assert.equal(result.stderr, '');
    }
  }
  const unsupported = await run('https://www.facebook.com/example', ['--follower', '--posts', '--json'], settings('<p>Public profile</p>'));
  assert.equal(unsupported.code, 0, unsupported.stderr); assert.deepEqual(JSON.parse(unsupported.stdout), { followers: null, posts: null });
  const partial = await run('https://github.com/example', ['--follower', '--posts', '--list'], settings('<a href="/example?tab=followers">17 followers</a>'));
  assert.equal(partial.stdout, '17\nnull\n');
});

test('insight count selection preserves quiet, stderr diagnostics and transport exit codes', async () => {
  const quiet = await run(tiktok, ['--follower', '--quiet', '--verbose']);
  assert.equal(quiet.code, 0); assert.equal(quiet.stdout, ''); assert.equal(quiet.stderr, '');
  const verbose = await run(tiktok, ['--posts', '--verbose']);
  assert.equal(verbose.stdout, '42\n'); assert.equal(verbose.stderr, 'Extracting social-insights (http)\n');
  const failed = await run(tiktok, ['--follower', '--json'], settings('Unavailable', 503));
  assert.equal(failed.code, 3); assert.equal(failed.stdout, ''); assert.equal(JSON.parse(failed.stderr).error, 'FetcharyFetchError');
});

test('count flags are social-insights-only booleans and fail before fetching when invalid', async () => {
  let requests = 0;
  const options = { ...settings(''), fetch: async () => { requests++; throw new Error('must not fetch'); } };
  for (const type of ['text', 'html', 'favicon', 'images', 'avatar', 'selector', 'social-links', 'emails', 'telephone', 'links', 'documents', 'metadata', 'structured-data']) {
    for (const flag of ['--follower', '--posts']) {
      let stdout = ''; let stderr = '';
      const code = await main(['extract', type, tiktok, flag], { options, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
      assert.equal(code, 2, `${type} ${flag}`); assert.equal(stdout, ''); assert.match(stderr, /not supported/);
    }
  }
  for (const flag of ['--follower=true', '--posts=42']) assert.equal((await run(tiktok, [flag], options)).code, 2);
  assert.equal(requests, 0);
});

test('metric selection does not mutate library results, cached captures or the default full JSON', async () => {
  let requests = 0;
  const options = settings('');
  options.fetch = async () => { requests++; return new Response(fixture('tiktok-profile.html'), { headers: { 'content-type': 'text/html' } }); };
  const original = await api.extractSocialInsights(tiktok, options);
  await run(tiktok, ['--follower'], options); await run(tiktok, ['--posts'], options);
  const full = await run(tiktok, [], options);
  assert.equal(full.code, 0, full.stderr); assert.deepEqual(JSON.parse(full.stdout).data, original.data);
  assert.equal(JSON.parse(full.stdout).cache.hit, true); assert.equal(original.data.metrics.following, 12); assert.equal(requests, 1);
});
