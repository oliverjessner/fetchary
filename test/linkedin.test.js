'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const linkedin = require('../src/vendors/linkedin');
const { dismissVendorOverlays } = require('../src/vendors');
const api = require('../src');
const { main } = require('../cli');
const sduiHtml = fs.readFileSync(path.join(__dirname, 'fixtures/social/linkedin-profile.html'), 'utf8');
const profileUrl = 'https://www.linkedin.com/in/example/?isSelfProfile=true';

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
  assert.equal(count('<main><a href="/in/example/followers/">4,288 followers</a></main>', url), 4288);
  assert.equal(count('<aside><a href="/in/other/followers/">99K followers</a></aside><main><a href="/in/example/recent-activity/">4,288 followers</a></main>', url), 4288);
  assert.equal(count('<main><a href="/in/other/followers/">99K followers</a><a href="https://evil.test/in/example/followers/">100K followers</a></main>', url), null);
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

test('LinkedIn SDUI topcards use matching profile identity and labelled paragraphs without depending on generated classes', () => {
  assert.equal(count(sduiHtml, profileUrl), 4288);
  assert.equal(count(sduiHtml.replace(/class="[^"]*"/g, 'class="new-generated-classes"'), profileUrl), 4288);
  assert.equal(count(sduiHtml.replace(/componentkey="[^"]*"/g, ''), profileUrl), 4288);
  const nestedCard = '<div componentkey="com.linkedin.sdui.profile.card.refNESTEDTopcard"><a href="/in/other/"><h2>Other profile</h2></a><p>99K followers</p></div>';
  assert.equal(count(sduiHtml.replace('<p>Founder', `${nestedCard}<p>Founder`), profileUrl), 4288);
  for (const [text, expected] of [['0 followers', 0], ['4.288 Follower', 4288], ['4 288 Follower:innen', 4288], ['4,3K Follower*innen', 4300], ['4.3K followers <span title="4,288"></span>', 4288]]) {
    assert.equal(count(sduiHtml.replace('4,288 followers', text), profileUrl), expected, text);
  }
});

test('LinkedIn SDUI counters exclude connections, unrelated identities, unscoped paragraphs and hidden or ambiguous cards', () => {
  for (const replacement of ['500+ connections', '500 employees', 'Followers', '— followers', '4,288 followers help other followers']) {
    assert.equal(count(sduiHtml.replace('4,288 followers', replacement), profileUrl), null, replacement);
  }
  assert.equal(count('<p>4,288 followers</p>', profileUrl), null);
  assert.equal(count(sduiHtml.replaceAll('/in/example/', '/in/another/'), profileUrl), null);
  assert.equal(count(sduiHtml.replaceAll('https://www.linkedin.com/in/example/', 'https://evil.test/in/example/'), profileUrl), null);
  assert.equal(count(sduiHtml.replaceAll('href="https://www.linkedin.com/in/example/?isSelfProfile=true"', 'href="https://[invalid]/"'), profileUrl), null);
  const mismatchedHeading = sduiHtml.replace('href="https://www.linkedin.com/in/example/?isSelfProfile=true" componentkey="ProfileVerificationTriggerRef-example"',
    'href="/in/other/" componentkey="ProfileVerificationTriggerRef-example"');
  assert.equal(count(mismatchedHeading, profileUrl), null);
  assert.equal(count(sduiHtml.replace('>4,288 followers</p>', ' hidden>4,288 followers</p>'), profileUrl), null);
  for (const hidden of ['hidden', 'aria-hidden="true"', 'inert']) {
    assert.equal(count(sduiHtml.replace('class="i0ll57 i0la1s i0lmlu"', `${hidden} class="i0ll57 i0la1s i0lmlu"`), profileUrl), null);
  }
});

test('real Chromium and CLI extract SDUI profile followers from the supplied header structure', async () => {
  const options = { mode: 'browser', waitAfterLoad: 0, timeout: 15000, lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetch: async () => new Response(sduiHtml, { headers: { 'content-type': 'text/html' } }) };
  const result = await api.extractSocialInsights(profileUrl, options);
  assert.equal(result.captureMode, 'browser'); assert.equal(result.followers, 4288);
  assert.equal(result.data.metrics.followers, 4288); assert.equal(result.data.status, 'available');
  assert.equal(result.data.sources.followers.field, 'followerCount'); assert.equal(result.data.unavailable.likes, 'unsupported');
  let stdout = ''; let stderr = '';
  const code = await main(['extract', 'social-insights', profileUrl, '--follower', '--mode', 'browser', '--no-history'], {
    options, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } },
  });
  assert.equal(code, 0, stderr); assert.equal(stdout, '4288\n'); assert.equal(stderr, '');
});

test('LinkedIn login walls, challenges and post pages do not provide a profile count', () => {
  const html = '<h3 class="top-card-layout__first-subline">1,234 followers</h3>';
  for (const url of ['https://linkedin.com/authwall', 'https://linkedin.com/checkpoint/challenge/', 'https://linkedin.com/login', 'https://linkedin.com/posts/example/', 'https://linkedin.com/feed/', 'https://linkedin.com/company/example/jobs/']) {
    assert.equal(count(html, url), null, url);
  }
  for (const path of ['company', 'school', 'showcase']) assert.equal(count(html, `https://www.linkedin.com/${path}/example/`), 1234);
  assert.equal(count(html, 'https://www.linkedin.com/company/example/about/'), 1234);
});
