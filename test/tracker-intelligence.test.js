'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const api = require('../src');
const { main } = require('../cli');
const { trackerIntelligence } = require('../src/extract/tracker-intelligence');
const { discoverDetectors } = require('../src/trackers');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/trackers', name + '.html'), 'utf8');
const url = 'https://example.test/page';
const raw = html => [{ html, url, document: 'raw' }];
function options(html, extra = {}) { return { mode: 'http', allowPrivateNetwork: true, fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), ...extra }; }
const find = (data, provider) => data.trackers.find(tracker => tracker.provider === provider);
async function cli(flags, settings) {
  let stdout = ''; let stderr = '';
  const code = await main(['extract', 'tracker-intelligence', url, ...flags], { options: settings, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { code, stdout, stderr };
}

const expected = {
  'google-tag-manager': [['container-id','GTM-ABC1234']],
  'google-analytics': [['measurement-id','G-ABC1234567'],['tracking-id','UA-123456-1']],
  'google-ads': [['conversion-id','AW-123456789']],
  'meta-pixel': [['pixel-id','123456789012345'],['pixel-id','123456789012346']],
  'tiktok-pixel': [['pixel-id','C123456789Abcdefghij']],
  'linkedin-insight': [['partner-id','123456']],
  'pinterest-tag': [['tag-id','123456789']],
  'microsoft-clarity': [['project-id','abc123def4']],
  'microsoft-advertising-uet': [['tag-id','12345678']],
  hotjar: [['site-id','1234567']], 'yandex-metrica': [['counter-id','12345678']],
  matomo: [['site-id','1'],['site-id','1']], plausible: [],
};
for (const detector of discoverDetectors()) test(`independent ${detector.provider} detector extracts its literal configuration`, () => {
  const data = trackerIntelligence(raw(fixture('all')), [detector]);
  assert.equal(data.trackers.length, 1);
  assert.deepEqual(data.trackers[0].identifiers.map(id => [id.kind,id.value]), expected[detector.provider]);
  assert.equal(data.trackers[0].detection, 'confirmed_configuration');
});

test('all providers deduplicate identifiers, retain distinct evidence and redact secrets', async () => {
  const html = fixture('all'); const result = await api.extractTrackerIntelligence(url, options(html));
  const data = result.data;
  assert.equal(result.type, 'tracker-intelligence'); assert.equal(result.status, 200); assert.equal(result.finalUrl, url); assert.equal(result.captureMode, 'http');
  assert.deepEqual(data.summary, { providers: 13, uniqueIdentifiers: 15 });
  assert.deepEqual(data.trackers.map(item => item.provider), Object.keys(expected).sort());
  const gtm = find(data, 'google-tag-manager'); assert.equal(gtm.identifiers.length, 1); assert.equal(gtm.evidence.length, 3);
  assert.ok(gtm.evidence.some(item => item.source === 'noscript'));
  assert.deepEqual(find(data, 'matomo').identifiers.map(id => id.scope), ['https://second.example.net/piwik.php','https://stats.example.net/matomo.php']);
  assert.deepEqual(find(data, 'plausible').configuration, { trackedDomains: ['Example.COM','example.net'] });
  assert.equal(find(data, 'plausible').identifiers.length, 0);
  assert.ok(data.externalHosts.includes('cdn.example.net')); assert.ok(!data.externalHosts.includes('not-a-resource.example'));
  assert.equal(JSON.stringify(data).includes('SECRET_'), false);
  assert.deepEqual(data, trackerIntelligence(raw(html)));
});

test('raw and rendered documents deduplicate IDs while preserving provenance', () => {
  const html = '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"></script>';
  const data = trackerIntelligence([...raw(html), { html: html + '<script>fbq("init","123456789012345")</script>', url, document: 'rendered' }]);
  assert.equal(data.summary.uniqueIdentifiers, 2);
  assert.deepEqual(find(data, 'google-tag-manager').evidence.map(item => item.document), ['raw','rendered']);
  assert.equal(find(data, 'meta-pixel').evidence[0].document, 'rendered');
});

test('prose, comments, quoted code, regex literals, JSON-LD and unrelated hosts do not install trackers', () => {
  assert.deepEqual(trackerIntelligence(raw(fixture('mentions'))), { trackers: [], externalHosts: [], summary: { providers: 0, uniqueIdentifiers: 0 } });
  assert.equal(trackerIntelligence(raw('<script src="https://connect.facebook.net.evil.test/fbevents.js"></script><script src="https://evil.test/analytics.js"></script>')).trackers.length, 0);
});

test('provider references survive missing and malformed identifiers without invented values', () => {
  const html = '<script src="https://connect.facebook.net/en_US/fbevents.js"></script><script src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script><script>fbq("init","12");ttq.load("short");gtag("config","G-A");</script>';
  const data = trackerIntelligence(raw(html));
  for (const item of data.trackers) { assert.equal(item.detection, 'provider_reference'); assert.deepEqual(item.identifiers, []); }
  assert.equal(data.summary.uniqueIdentifiers, 0);
  assert.deepEqual(data.trackers.map(item => item.provider), ['google-analytics','google-tag-manager','meta-pixel','tiktok-pixel']);
});

test('relative resource URLs, explicit data attributes and metadata configuration are recognized', () => {
  const html = '<base href="https://www.googletagmanager.com/"><script src="gtm.js?id=GTM-ABC1234"></script><div data-meta-pixel-id="123456789012345"></div><meta name="ga-measurement-id" content="G-ABC1234567"><script data-domain="example.test" src="/js/script.js"></script>';
  const data = trackerIntelligence(raw(html));
  assert.equal(find(data,'google-tag-manager').identifiers[0].value, 'GTM-ABC1234');
  assert.equal(find(data,'meta-pixel').evidence[0].source, 'data-attribute');
  assert.equal(find(data,'google-analytics').evidence[0].source, 'metadata');
  assert.equal(find(data,'plausible').configuration.trackedDomains[0], 'example.test');
});

test('URL-based pixel identifiers and legacy Yandex initialization remain scoped to technical resources', () => {
  const html = '<img src="https://px.ads.linkedin.com/collect/?pid=123456"><img src="https://ct.pinterest.com/v3/?tid=123456789"><img src="https://bat.bing.com/action/12345678"><img src="https://mc.yandex.ru/watch/12345678"><img src="https://www.googleadservices.com/pagead/conversion/123456789/"><script>new Ya.Metrika({id:12345678});</script>';
  const data = trackerIntelligence(raw(html));
  assert.equal(data.summary.providers, 5); assert.equal(data.summary.uniqueIdentifiers, 5);
  assert.ok(data.trackers.every(item => item.detection === 'confirmed_configuration'));
});

test('Matomo never promotes an unscoped site ID into a global identifier', () => {
  const data = trackerIntelligence(raw('<script>_paq.push(["setSiteId","1"])</script><img src="/matomo.php?idsite=1&amp;token=SECRET">'));
  assert.deepEqual(find(data,'matomo').identifiers, [{ kind:'site-id', value:'1', scope:'https://example.test/matomo.php' },{ kind:'site-id', value:'1', scope:null }]);
  assert.ok(!JSON.stringify(data).includes('SECRET'));
});

test('empty, absent and non-HTML documents produce successful empty results without browser fallback', async () => {
  for (const html of ['', '<html></html>', '<p>No trackers</p>', '<script>window.app=true</script>']) {
    const result = await api.extractTrackerIntelligence(url, options(html, { mode:'auto', launchBrowser: async () => { throw new Error('unexpected launch'); } }));
    assert.deepEqual(result.data, { trackers:[], externalHosts:[], summary:{providers:0, uniqueIdentifiers:0} });
  }
  const result = await api.extractTrackerIntelligence(url, options('', { fetch:async () => new Response('<script>fbq("init","123456789012345")</script>', {headers:{'content-type':'text/plain'}}) }));
  assert.equal(result.data.summary.providers, 0);
  assert.equal(trackerIntelligence([]).summary.providers, 0);
});

test('private clients, dispatcher, shared HTTP snapshots, concurrent deduplication and cache bypass work', async () => {
  let requests = 0; const settings = options(fixture('all'), { fetch:async () => { requests++; await new Promise(resolve => setTimeout(resolve, 5)); return new Response(fixture('all'), {headers:{'content-type':'text/html'}}); } });
  const client = api.createExtractor(settings);
  const [first, second] = await Promise.all([client.extractTrackerIntelligence(url), client.extract(url, {type:'tracker-intelligence'})]);
  assert.deepEqual(first.data, second.data); assert.equal(requests, 1); assert.equal(second.cache.hit, false);
  assert.equal((await client.extractTrackerIntelligence(url)).cache.hit,true);
  first.data.trackers.length = 0;
  assert.equal((await client.extractTrackerIntelligence(url)).data.summary.providers,13);
  await client.extractHtml(url); assert.equal(requests, 1);
  client.clearCache(); await client.extractTrackerIntelligence(url); assert.equal(requests, 2);
  await Promise.all([client.extractTrackerIntelligence(url,{cacheTtlMs:0}),client.extractTrackerIntelligence(url,{cacheTtlMs:0})]); assert.equal(requests,4);
  const esm = await import('../src/index.js'); assert.equal(esm.extractTrackerIntelligence,api.extractTrackerIntelligence);
});

test('stateless extraction makes only the document request and respects abort, security and byte limits', async () => {
  let requests = 0;
  const settings = options(fixture('all'), { fetch:async target => { requests++; assert.equal(target,url); return new Response(fixture('all'),{headers:{'content-type':'text/html'}}); } });
  await api.extractTrackerIntelligence(url,settings); assert.equal(requests,1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.extractTrackerIntelligence(url,{...settings,signal:controller.signal}),api.FetcharyFetchError); assert.equal(requests,1);
  await assert.rejects(api.extractTrackerIntelligence(url,{...settings,maxResponseBytes:10}),api.FetcharyFetchError);
  await assert.rejects(api.extractTrackerIntelligence('http://127.0.0.1/',{fetch:settings.fetch}),api.FetcharyValidationError);
  await assert.rejects(api.extractTrackerIntelligence(url,{...settings,mode:'browser',waitAfterLoad:0,launchBrowser:async () => ({newPage:async () => ({close:async()=>{}}),close:async()=>{}})}),api.FetcharyBrowserError);
});

test('CLI JSON, list, provider-only and Matomo scoped list output are deterministic', async () => {
  const settings = options(fixture('all'));
  const standard = await cli([],settings); assert.equal(standard.code,0); assert.equal(standard.stderr,''); assert.equal(JSON.parse(standard.stdout).type,'tracker-intelligence');
  assert.deepEqual(JSON.parse((await cli(['--json','--list'],settings)).stdout).data, JSON.parse((await cli(['--json'],settings)).stdout).data);
  const list = await cli(['--list'],settings); assert.equal(list.code,0); assert.match(list.stdout,/google-tag-manager:GTM-ABC1234\n/); assert.match(list.stdout,/matomo:https%3A%2F%2Fstats.example.net%2Fmatomo.php:1\n/); assert.match(list.stdout,/\nplausible\n/);
  assert.equal((await cli(['--list'], options('<script src="https://connect.facebook.net/en_US/fbevents.js"></script>'))).stdout,'meta-pixel\n');
  assert.equal((await cli(['--list'],options('<p>Empty</p>'))).stdout,'');
  assert.equal((await cli(['--follower'],settings)).code,2);
});

async function server(t, html) {
  const requests = [];
  const instance = http.createServer((request,response) => { requests.push(request.url); response.writeHead(200,{'content-type':'text/html'});response.end(html); });
  await new Promise(resolve => instance.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => instance.close(resolve)));
  return { target:`http://127.0.0.1:${instance.address().port}/`, requests };
}

test('guarded browser inspects dynamic and original HTML with no resource, pixel, beacon or script downloads', async t => {
  const site = await server(t,fixture('dynamic'));
  const result = await api.extractTrackerIntelligence(site.target,{mode:'browser',allowPrivateNetwork:true,waitAfterLoad:0,cacheTtlMs:0});
  assert.deepEqual(site.requests,['/']); assert.equal(result.captureMode,'browser');
  assert.equal(find(result.data,'google-tag-manager').identifiers[0].value,'GTM-DYNAMIC1');
  assert.equal(find(result.data,'meta-pixel').identifiers[0].value,'123456789012345');
  assert.ok(find(result.data,'meta-pixel').evidence.some(item => item.document === 'raw'));
  assert.ok(find(result.data,'meta-pixel').evidence.some(item => item.document === 'rendered'));
});

test('browser cache policy is isolated from ordinary rendering and the real CLI accepts tracker-intelligence', async t => {
  const site = await server(t,'<script src="/site.js"></script><div data-meta-pixel-id="123456789012345"></div>');
  const client = api.createExtractor({mode:'browser',allowPrivateNetwork:true,waitAfterLoad:0});
  const first = await client.extractTrackerIntelligence(site.target); const second = await client.extractTrackerIntelligence(site.target);
  assert.equal(first.cache.hit,false); assert.equal(second.cache.hit,true); assert.deepEqual(site.requests,['/']);
  await client.extractHtml(site.target); assert.ok(site.requests.includes('/site.js'));
  const child = spawn(process.execPath,[path.join(__dirname,'../cli/index.js'),'extract','tracker-intelligence',site.target,'--mode','http','--allow-private-network','--list']);
  let stdout='';let stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0,stderr);assert.equal(stdout,'meta-pixel:123456789012345\n');
});

test('all known script-only integrations are retained without claiming configuration', () => {
  const sources = [
    'https://www.googletagmanager.com/gtm.js', 'https://www.google-analytics.com/analytics.js',
    'https://www.googleadservices.com/pagead/conversion.js', 'https://connect.facebook.net/en_US/fbevents.js',
    'https://analytics.tiktok.com/i18n/pixel/events.js', 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
    'https://s.pinimg.com/ct/core.js', 'https://www.clarity.ms/tag/', 'https://bat.bing.com/bat.js',
    'https://static.hotjar.com/c/hotjar-unknown.js', 'https://mc.yandex.ru/metrika/tag.js',
    '/matomo.js', 'https://plausible.io/js/pa-opaque.js',
  ];
  const data = trackerIntelligence(raw(sources.map(src => `<script src="${src}"></script>`).join('')));
  assert.equal(data.summary.providers,13);assert.equal(data.summary.uniqueIdentifiers,0);
  assert.ok(data.trackers.every(tracker => tracker.detection === 'provider_reference' && tracker.identifiers.length === 0));
});

test('standard GTM bootstrap and ID-bearing resource URLs extract identifiers without contacting providers', () => {
  const html = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var j=d.createElement(s);j.src='https://www.googletagmanager.com/gtm.js?id='+i;})(window,document,'script','dataLayer','GTM-ABC1234');</script>
    <script src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script>
    <script src="https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=C123456789Abcdefghij"></script>
    <script src="https://www.clarity.ms/tag/Abc123def4"></script>`;
  const data = trackerIntelligence(raw(html));
  assert.equal(data.summary.providers,4);assert.equal(data.summary.uniqueIdentifiers,4);
  assert.equal(find(data,'microsoft-clarity').identifiers[0].value,'Abc123def4');
  assert.equal(find(data,'google-analytics'),undefined);
  assert.equal(find(data,'google-tag-manager').identifiers[0].value,'GTM-ABC1234');
});

test('quoted documentation URLs and unrelated UET properties do not manufacture identifiers', () => {
  const html = `<script>const doc='https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234';const settings={ti:'12345678'};</script><template><script src="https://connect.facebook.net/en_US/fbevents.js"></script></template>`;
  assert.deepEqual(trackerIntelligence(raw(html)).trackers,[]);
});

test('inline parsing is bounded and malformed scripts cannot create partial-call identifiers', () => {
  const { javascript } = require('../src/trackers/javascript');
  assert.equal(javascript('x;'.repeat(200_001)).tokens.length,200_000);
  assert.equal(trackerIntelligence(raw('<script>fbq("init","123456789012345"</script>')).summary.providers,0);
});

test('browser replay handles URL fragments and HTTP redirects without a second navigation fetch', async t => {
  const requests = [];
  const instance = http.createServer((request,response) => {
    requests.push(request.url);
    if (request.url === '/start') {response.writeHead(302,{location:'/final'});response.end();return;}
    response.writeHead(200,{'content-type':'text/html'});response.end('<script>document.body.dataset.metaPixelId="123456789012345"</script><body></body>');
  });
  await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>instance.close(resolve)));
  const result = await api.extractTrackerIntelligence(`http://127.0.0.1:${instance.address().port}/start#fragment`,{mode:'browser',allowPrivateNetwork:true,waitAfterLoad:0});
  assert.deepEqual(requests,['/start','/final']); assert.match(result.finalUrl,/\/final$/);
});

test('Matomo resolves a following server setting and keeps ambiguous variables unscoped', () => {
  const html = `<script>_paq.push(['setSiteId','1']);_paq.push(['setTrackerUrl','/matomo.php?auth=SECRET']);</script>`;
  assert.deepEqual(find(trackerIntelligence(raw(html)),'matomo').identifiers,[{kind:'site-id',value:'1',scope:'https://example.test/matomo.php'}]);
  const ambiguous = `<script>var u='https://one.test/';var u='https://two.test/';_paq.push(['setTrackerUrl',u+'matomo.php']);_paq.push(['setSiteId','1']);</script>`;
  assert.deepEqual(find(trackerIntelligence(raw(ambiguous)),'matomo').identifiers,[{kind:'site-id',value:'1',scope:null}]);
});

test('object configuration IDs belong to the initialized object rather than nearby properties', () => {
  const html = `<script>
    const unrelated={ti:'99999999',id:99999999};
    const uetOptions={ti:'12345678', nested:{ti:'88888888'}};new UET(uetOptions);
    window._hjSettings={nested:{hjid:99999999},hjid:1234567};
    new Ya.Metrika({nested:{id:99999999},id:12345678});
  </script>`;
  const data = trackerIntelligence(raw(html));
  assert.deepEqual(find(data,'microsoft-advertising-uet').identifiers,[{kind:'tag-id',value:'12345678'}]);
  assert.deepEqual(find(data,'hotjar').identifiers,[{kind:'site-id',value:'1234567'}]);
  assert.deepEqual(find(data,'yandex-metrica').identifiers,[{kind:'counter-id',value:'12345678'}]);
});

test('repeated initialization calls retain distinct evidence without duplicating identifiers', () => {
  const data = trackerIntelligence(raw('<script>fbq("init","123456789012345");fbq("init","123456789012345");</script>'));
  const pixel = find(data,'meta-pixel');assert.equal(pixel.identifiers.length,1);assert.equal(pixel.evidence.length,2);
  assert.notEqual(pixel.evidence[0].tokenIndex,pixel.evidence[1].tokenIndex);
});
