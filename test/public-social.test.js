'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const api = require('../src');
const { classifyUrl, sameEntity } = require('../src/utils/social');
const telegram = require('../src/vendors/telegram');
const hackernews = require('../src/vendors/hackernews');
const github = require('../src/vendors/github');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/social', name), 'utf8');
const channel = 'https://t.me/s/PublicNews';
const post = 'https://t.me/PublicNews/42';
const item = 'https://news.ycombinator.com/item?id=8863';
const profile = 'https://news.ycombinator.com/user?id=ExampleUser';
const repo = 'https://github.com/Owner/Project';
const read = (vendor, html, url) => vendor.socialInsights(parseHTML(html).document, url);
const settings = html => ({ mode: 'http', allowPrivateNetwork: true, cacheTtlMs: 0,
  fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
});

test('social URL identities cover public Telegram, Hacker News, repository releases and video aliases', async () => {
  const identities = [
    [channel, 'telegram', 'channel', 'publicnews'], [post, 'telegram', 'post', 'publicnews/42'],
    ['https://telegram.me/s/PublicNews/42?single', 'telegram', 'post', 'publicnews/42'],
    [item, 'hackernews', 'post', '8863'], [profile, 'hackernews', 'profile', 'ExampleUser'],
    [repo, 'github', 'repository', 'owner/project'],
    [`${repo}/releases`, 'github', 'release', 'owner/project/releases'],
    [`${repo}/releases/tag/vOne`, 'github', 'release', 'owner/project/releases/tag/vOne'],
    ['https://clips.twitch.tv/ExampleSlug', 'twitch', 'video', 'clip:ExampleSlug'],
    ['https://www.twitch.tv/example/clip/ExampleSlug', 'twitch', 'video', 'clip:ExampleSlug'],
    ['https://clips.twitch.tv/embed?clip=ExampleSlug', 'twitch', 'video', 'clip:ExampleSlug'],
    ['https://player.vimeo.com/video/12345?h=privatehash', 'vimeo', 'video', '12345'],
  ];
  for (const [url, platform, kind, id] of identities) assert.deepEqual(classifyUrl(url), { platform, kind, id });
  assert.equal(sameEntity(channel, 'https://t.me/publicnews'), true);
  assert.equal(sameEntity(post, 'https://t.me/s/publicnews/42'), true);
  assert.equal(sameEntity(repo, 'https://github.com/owner/project'), true);
  assert.equal(sameEntity(`${repo}/releases/tag/vOne`, `${repo}/releases/tag/vone`), false);
  assert.equal(sameEntity(profile, profile.replace('ExampleUser', 'exampleuser')), false);
  assert.equal(sameEntity('https://clips.twitch.tv/ExampleSlug', 'https://www.twitch.tv/example/clip/ExampleSlug'), true);
  assert.equal(sameEntity('https://clips.twitch.tv/ExampleSlug', 'https://clips.twitch.tv/exampleslug'), false);
  assert.equal(sameEntity('https://player.vimeo.com/video/12345', 'https://vimeo.com/12345'), true);
  for (const url of ['https://t.me/+invite', 'https://t.me/joinchat/private', 'https://t.me/c/123/42', 'https://t.me/share/url?url=example',
    'https://news.ycombinator.com/item?id=not-a-number', 'https://clips.twitch.tv/embed', 'https://github.com/topics/javascript']) assert.equal(classifyUrl(url).kind, 'unknown', url);
  assert.equal(classifyUrl('https://news.ycombinator.com.evil.test/item?id=8863').platform, null);

  const html = identities.map(([url]) => `<a href="${url}">Public link</a>`).join('');
  const links = await api.extractSocialLinks('https://example.test/', settings(html));
  assert.equal(links.data.filter(link => link.platform === 'telegram').length, 3);
  assert.equal((await api.extractSocialLinks('https://example.test/', { ...settings(html), platform: 'hackernews' })).data.length, 2);
});

test('Telegram reads channel subscribers and the requested post views with scoped evidence', async () => {
  const html = fixture('telegram-public.html');
  const subscribers = read(telegram, html, channel);
  assert.equal(subscribers.metrics.subscribers, 1200000);
  assert.equal(subscribers.sources.subscribers.approximate, true);
  assert.equal(subscribers.metrics.followers, null);
  assert.equal(subscribers.metrics.views, null);
  const views = read(telegram, html, post);
  assert.equal(views.metrics.views, 3200);
  assert.equal(views.sources.views.approximate, true);
  assert.equal(views.metrics.subscribers, null);
  assert.equal(views.status, 'available');
  const ownPostHtml = html.replace('href="https://t.me/s/PublicNews"', `href="${post}"`);
  const result = await api.extractSocialInsights(post, settings(ownPostHtml));
  assert.equal(result.data.metrics.views, 3200); assert.equal(result.captureMode, 'http');
  const mismatch = await api.extractSocialInsights(post, settings(ownPostHtml.replace(`href="${post}"`, 'href="https://t.me/OtherNews/42"')));
  assert.equal(mismatch.data.metrics.views, null); assert.equal(mismatch.data.unavailable.views, 'identity_mismatch');
});

test('Telegram public post links resolve to the website preview while preserving requested identity', async () => {
  assert.equal(telegram.captureUrl(post), 'https://t.me/s/publicnews/42');
  assert.equal(telegram.captureUrl('https://telegram.me/PublicNews/42?single'), 'https://t.me/s/publicnews/42?single');
  for (const url of [channel, 'https://t.me/s/PublicNews/42', 'https://t.me/+invite', 'https://t.me/c/123/42', item]) assert.equal(telegram.captureUrl(url), url);
  const seen = [];
  const result = await api.extractSocialInsights(post, { ...settings(fixture('telegram-public.html')), fetch: async url => {
    seen.push(url);
    return new Response(fixture('telegram-public.html'), { headers: { 'content-type': 'text/html' } });
  } });
  assert.deepEqual(seen, ['https://t.me/s/publicnews/42']);
  assert.equal(result.requestedUrl, post);
  assert.equal(result.data.metrics.views, 3200);
});

test('Telegram preserves zero, missing/hidden values and public-post media attribution', () => {
  const html = fixture('telegram-public.html');
  assert.equal(read(telegram, html.replace('1.2M', '0'), channel).metrics.subscribers, 0);
  assert.equal(read(telegram, html.replace('3.2K', '0'), post).metrics.views, 0);
  assert.equal(read(telegram, html.replace('3.2K', 'hidden'), post).metrics.views, null);
  assert.equal(read(telegram, html.replace('data-post="PublicNews/42"', 'hidden data-post="PublicNews/42"'), post).metrics.views, null);
  assert.equal(read(telegram, html.replace('data-post="PublicNews/42"', 'data-post="PublicNews/999"'), post).metrics.views, null);
  assert.equal(read(telegram, html.replace('class="counter_value">1.2M', 'class="counter_value" hidden>1.2M'), channel).metrics.subscribers, null);
  assert.equal(read(telegram, '<link rel="canonical" href="https://t.me/OtherNews"><div class="tgme_page_extra">99 subscribers</div>', channel).metrics.subscribers, null);
  const plain = '<link rel="canonical" href="https://t.me/PublicNews"><div class="tgme_page_extra">1 234 subscribers</div>';
  assert.equal(read(telegram, plain, channel).metrics.subscribers, 1234);
  const document = parseHTML(html).document;
  const video = document.querySelector('video');
  assert.equal(telegram.telegramPostUrl(video, channel), 'https://t.me/publicnews/42');
  assert.equal(telegram.telegramPostUrl(video, post), 'https://t.me/publicnews/42');
  assert.equal(telegram.telegramPostUrl(video, 'https://t.me/PublicNews/43'), null);
  assert.equal(telegram.telegramPostUrl(video, 'https://t.me/OtherNews'), null);
  assert.equal(telegram.telegramPostUrl(video, 'https://example.test/'), null);
  document.querySelector('.tgme_widget_message_date').setAttribute('href', 'https://t.me/OtherNews/42');
  assert.equal(telegram.telegramPostUrl(video, channel), null);
});

test('Telegram channel avatars reuse public HTML and the guarded image reader without account/API requests', async () => {
  const html = fixture('telegram-public.html');
  const seen = [];
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M0 0h32v32H0z"/></svg>';
  const result = await api.extractProfilePicture(channel, { ...settings(html), fetch: async url => {
    seen.push(url);
    if (url === channel) return new Response(html, { headers: { 'content-type': 'text/html' } });
    assert.equal(url, 'https://images.example.test/channel.svg');
    return new Response(image, { headers: { 'content-type': 'image/svg+xml' } });
  } });
  assert.equal(result.vendor, 'telegram'); assert.equal(result.profile, 'publicnews');
  assert.equal(result.image.width, 32); assert.equal(result.image.height, 32);
  assert.deepEqual(seen, [channel, 'https://images.example.test/channel.svg']);
  const background = html.replace('<img src="https://images.example.test/channel.svg" alt="Public News">', '<i style="background-image:url(https://images.example.test/channel.svg)"></i>');
  assert.equal(telegram.profilePicture(parseHTML(background).document, channel).candidates[0].url, result.image.url);
  assert.equal(telegram.profilePicture(parseHTML(html.replace('href="https://t.me/s/PublicNews"', 'href="https://t.me/OtherNews"')).document, channel).candidates.length, 0);
  assert.equal(telegram.profilePicture(parseHTML(html).document, post), null);
});

test('Telegram video extraction attributes media to the public post without downloading the video', async () => {
  const requests = [];
  const result = await api.extractVideos(channel, { ...settings(fixture('telegram-public.html')), fetch: async target => {
    requests.push(target);
    return new Response(fixture('telegram-public.html'), { headers: { 'content-type': 'text/html' } });
  } });
  const video = result.data.find(video => video.url === 'https://media.example.test/clip.mp4');
  assert.equal(video.platform, 'telegram');
  assert.equal(video.postUrl, 'https://t.me/publicnews/42');
  assert.deepEqual(requests, [channel]);
});

test('Hacker News item metrics belong to the matching submission rather than recommendations or comment IDs', async () => {
  const html = fixture('hackernews-item.html');
  const result = read(hackernews, html, item);
  assert.equal(result.metrics.score, 104); assert.equal(result.metrics.comments, 71);
  assert.equal(result.status, 'available'); assert.equal(result.sources.score.type, 'vendor');
  assert.equal(read(hackernews, html.replace('104 points', '0 points').replace('71&nbsp;comments', 'discuss'), item).metrics.comments, 0);
  assert.equal(read(hackernews, html.replace('104 points', '-1 points'), item).metrics.score, -1);
  assert.equal(read(hackernews, html, item.replace('8863', '777')).metrics.score, null);
  assert.equal(read(hackernews, html.replace('class="athing submission" id="8863"', 'class="athing comtr" id="8863"'), item).metrics.score, null);
  assert.equal(read(hackernews, html.replace('id="score_8863"', 'hidden id="score_8863"'), item).metrics.score, null);
  const exposed = await api.extractSocialInsights(item, settings(html));
  assert.equal(exposed.data.metrics.score, 104); assert.equal(exposed.data.metrics.comments, 71);
});

test('Hacker News karma keeps exact profile case and ignores nested biography tables', async () => {
  const html = fixture('hackernews-profile.html');
  assert.equal(read(hackernews, html, profile).metrics.karma, 1234);
  assert.equal(read(hackernews, html.replace('>1234<', '>-4<'), profile).metrics.karma, -4);
  assert.equal(read(hackernews, html.replace('>1234<', '>0<'), profile).metrics.karma, 0);
  assert.equal(read(hackernews, html, profile.replace('ExampleUser', 'exampleuser')).metrics.karma, null);
  assert.equal(read(hackernews, html.replace('>1234<', '>hidden<'), profile).metrics.karma, null);
  const result = await api.extractSocialInsights(profile, settings(html));
  assert.equal(result.data.metrics.karma, 1234); assert.equal(result.data.metrics.followers, null);
});

test('GitHub repositories expose stars and forks while existing profile followers stay distinct', async () => {
  const html = fixture('github-repository.html');
  const result = read(github, html, repo);
  assert.equal(result.metrics.stars, 1234); assert.equal(result.metrics.forks, 0);
  assert.equal(result.sources.stars.approximate, false); assert.equal(result.status, 'available');
  assert.equal(result.metrics.followers, null); assert.equal(result.metrics.likes, null);
  const compact = read(github, html.replace(' title="1,234"', ''), repo);
  assert.equal(compact.metrics.stars, 1200); assert.equal(compact.sources.stars.approximate, true);
  assert.equal(read(github, html, 'https://github.com/Other/Project').metrics.stars, null);
  assert.equal(read(github, html.replace('href="/Owner/Project/stargazers"', 'hidden href="/Owner/Project/stargazers"'), repo).metrics.stars, null);
  assert.equal(read(github, html, `${repo}/releases`).status, 'unsupported');
  const resultFromApi = await api.extractSocialInsights(repo, settings(html));
  assert.equal(resultFromApi.data.metrics.stars, 1234); assert.equal(resultFromApi.data.metrics.forks, 0);
  const legacy = await api.extractSocialInsights('https://github.com/Owner', settings('<a href="/Owner?tab=followers">12 followers</a>'));
  assert.equal(legacy.data.metrics.followers, 12); assert.equal(legacy.data.metrics.stars, null);
});
