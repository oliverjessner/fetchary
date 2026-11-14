'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const api = require('../src');
const { trackerIntelligence } = require('../src/extract/tracker-intelligence');
const url = 'https://example.test/article';
const raw = html => [{html,url,document:'raw'}];
const find = (data,name) => data.trackers.find(tracker => tracker.provider === name);
const fixture = fs.readFileSync(path.join(__dirname,'fixtures/trackers/expanded.html'),'utf8');

test('new passive detectors identify scoped configuration and never promote Adobe Tags to analytics', () => {
  const data = trackerIntelligence(raw(fixture));
  assert.deepEqual(data.summary,{providers:8,uniqueIdentifiers:7});
  assert.deepEqual(find(data,'umami').identifiers,[{kind:'website-id',value:'94db1cb1-74f4-4a40-ad6c-962362670409',scope:'https://stats.example.net/'}]);
  assert.deepEqual(find(data,'posthog').identifiers,[{kind:'project-token',value:'phc_abcdefghijklmnopqrstuvwx',scope:'https://events.example.net/collect'}]);
  assert.deepEqual(find(data,'goatcounter').identifiers,[{kind:'site-endpoint',value:'https://journal.goatcounter.com/count'}]);
  assert.equal(find(data,'cloudflare-web-analytics').identifiers[0].value,'bc40a2d1b5834453aba85c1b9a3054da');
  assert.deepEqual(find(data,'simple-analytics').configuration,{trackedDomains:['archive.example','publication.example']});
  assert.equal(find(data,'adobe-experience-platform-tags').category,'tag-manager');
  assert.equal(find(data,'adobe-analytics'),undefined);
  assert.equal(find(data,'reddit-pixel').identifiers.length,1);
  assert.equal(find(data,'x-pixel').identifiers[0].value,'o6ou1');
  assert.ok(!JSON.stringify(data).includes('SECRET_'));
});

test('self-hosted literal settings and alternate resource signatures remain scoped and deduplicated', () => {
  const html = `<script>window.umamiConfig={websiteId:'94db1cb1-74f4-4a40-ad6c-962362670409',hostUrl:'/statistics'};
    window.__cfBeacon={token:'bc40a2d1b5834453aba85c1b9a3054da'};
    const config={api_host:'https://events.example.net'};posthog.init('phc_abcdefghijklmnopqrstuvwx',config);</script>
    <script src="https://static.cloudflareinsights.com/beacon.min.js?token=bc40a2d1b5834453aba85c1b9a3054da"></script>
    <script src="https://scripts.simpleanalyticscdn.com/latest.js" data-hostname="example.test"></script>
    <script src="https://scripts.simpleanalyticscdn.com/auto-events.js"></script>`;
  const data = trackerIntelligence([...raw(html),{html,url,document:'rendered'}]);
  assert.equal(data.summary.providers,4);
  assert.equal(data.summary.uniqueIdentifiers,3);
  assert.equal(find(data,'umami').identifiers[0].scope,'https://example.test/statistics');
  assert.equal(find(data,'posthog').identifiers[0].scope,'https://events.example.net/');
  assert.deepEqual(new Set(find(data,'cloudflare-web-analytics').evidence.map(item => item.document)),new Set(['raw','rendered']));
});

test('prose, inert examples, unrelated hosts and malformed IDs do not manufacture configuration', () => {
  const example = `<pre>posthog.init('phc_abcdefghijklmnopqrstuvwx',{}); rdt('init','a2_abcdef123'); twq('config','o6ou1')</pre>
    <script>const docs="https://static.cloudflareinsights.com/beacon.min.js";
    // posthog.init('phc_abcdefghijklmnopqrstuvwx',{});
    const example='rdt("init","a2_abcdef123")';</script>
    <script type="application/ld+json">{"text":"twq('config','o6ou1')"}</script>
    <template><script src="https://gc.zgo.at/count.js"></script></template>
    <script src="https://static.cloudflareinsights.com.evil.test/beacon.min.js"></script>
    <script src="https://evil.test/uwt.js"></script>`;
  assert.deepEqual(trackerIntelligence(raw(example)).trackers,[]);
  const malformed = trackerIntelligence(raw(`<script src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon="invalid"></script>
    <script src="https://assets.adobedtm.com/company/launch-unknown.js"></script>
    <script>posthog.init('YOUR_PROJECT_TOKEN',{});rdt('init','{{Pixel ID}}');twq('config','pixel_id1');</script>`));
  assert.equal(malformed.summary.providers,5);
  assert.ok(malformed.trackers.every(item => item.detection === 'provider_reference' && item.identifiers.length === 0));
});

test('public tracker extraction only fetches the supplied document', async () => {
  const requests=[];
  const result=await api.extractTrackerIntelligence(url,{mode:'http',allowPrivateNetwork:true,fetch:async target => {
    requests.push(target);return new Response(fixture,{headers:{'content-type':'text/html'}});
  }});
  assert.deepEqual(requests,[url]);assert.equal(result.data.summary.providers,8);
});
