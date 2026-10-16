'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseHTML } = require('linkedom');
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

