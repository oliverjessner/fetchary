'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const api = require('../src');
const { parseHTML } = require('linkedom');
const { classifyUrl, domains } = require('../src/utils/social');
const { countDetails, jsonRoots } = require('../src/metrics/insights');
const { discoverVendors } = require('../src/vendors');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/social', name), 'utf8');
const url = 'https://page.example.test/';
function options(html, extra = {}) { return { mode:'http', allowPrivateNetwork:true, fetch: async () => new Response(html, { headers: { 'content-type':'text/html' } }), ...extra }; }

test('dispatcher types use shared implementations and predictable result metadata', async () => {
  for (const type of ['text','html','images','selector','social-links','social-insights','emails','telephone','links','documents']) {
    const settings = options('<h1>Hello &copy;</h1><img src="/a.png">', { type, selector:'h1' });
    const result = await api.extract(url, settings);
    assert.equal(result.type, type); assert.ok(Object.hasOwn(result, 'data'));
    assert.equal(result.requestedUrl, url); assert.equal(result.status, 200);
    assert.equal(result.captureMode, 'http'); assert.ok(!Number.isNaN(Date.parse(result.extractedAt)));
    assert.ok(!Number.isNaN(Date.parse(result.capturedAt)));
  }
  assert.equal((await api.extract(url, options('<p>Hello</p>', { format:'text' }))).content, 'Hello');
  assert.equal(api.extractSocialAvatar, api.extractProfilePicture);
  for (const key of ['Fetchary','createFetchary','parseInterval','FetcharyStorageError']) assert.equal(api[key], undefined);
});

test('HTTP-first auto mode avoids Chromium for usable content and uses a single browser fallback for an empty app', async () => {
  let requests = 0; let launches = 0; let closes = 0;
  const fetch = async () => { requests++; return new Response('<html><body><div id="app"></div><script src="/app.js"></script></body></html>', { headers:{'content-type':'text/html'} }); };
  const launchBrowser = async () => { launches++; return { newPage:async()=>({ goto:async()=>{}, content:async()=>'<h1>Rendered</h1>', url:()=>url, close:async()=>{closes++;} }), close:async()=>{closes++;} }; };
  const result = await api.extractText(url, { allowPrivateNetwork:true, fetch, launchBrowser, waitAfterLoad:0 });
  assert.equal(result.content, 'Rendered'); assert.equal(requests,1); assert.equal(launches,1); assert.equal(closes,2);
  const staticResult = await api.extractText(url, options('<p>Static</p>', { mode:'auto', launchBrowser:async()=>assert.fail('unnecessary Chromium') }));
  assert.equal(staticResult.captureMode, 'http'); assert.equal(staticResult.data, 'Static');
});

test('text conversion removes scripts/styles/comments, decodes entities, separates paragraphs and handles declared encodings', async () => {
  const result = await api.extractText(url, options('<p>Hello&nbsp; &copy; <b>world</b></p><p>Next &#x1F642;</p><script>SECRET</script><style>SECRET</style><!-- SECRET -->'));
  assert.equal(result.content, 'Hello © world\nNext 🙂');
  const encoded = Buffer.from('<p>caf\xe9</p>', 'latin1');
  const settings = options('', { fetch:async()=>new Response(encoded,{headers:{'content-type':'text/html; charset=iso-8859-1'}}) });
  assert.equal((await api.extractText(url,settings)).data,'café');
  const selected = await api.extractHtml(url, options('<main><b>first</b><time>clock</time></main><main>second</main>',{includeSelectors:['main'],ignoreSelectors:['time']}));
  assert.equal(selected.content,'<main><b>first</b></main>');
});

test('selector extraction supports first/all, HTML/text, attributes, missing matches and validation', async () => {
  const settings = options('<a class="item" href="/one">One</a><a class="item">Two</a>');
  assert.deepEqual((await api.extractSelector(url,{...settings,selector:'.item'})).data,{matched:true,values:['One']});
  assert.deepEqual((await api.extractSelector(url,{...settings,selector:'.item',all:true,attribute:'href'})).data,{matched:true,values:['/one',null]});
  assert.equal((await api.extractSelector(url,{...settings,selector:'.item',format:'html'})).data.values[0],'<a class="item" href="/one">One</a>');
  assert.deepEqual((await api.extractSelector(url,{...settings,selector:'.missing'})).data,{matched:false,values:[]});
  assert.equal((await api.extractSelector(url,'.item',settings)).content,'One');
  await assert.rejects(api.extractSelector(url,{...settings,selector:'['}),api.FetcharyValidationError);
});

test('image discovery covers srcset, picture, lazy attributes, metadata, image links and CSS without requesting binaries', async () => {
  let requests=0;
  const html = '<base href="https://cdn.example.test/assets/"><img src="a.png" srcset="a.png 1x, b.png 2x" alt="A" width="20" height="30"><picture><source srcset="//img.example.test/c.webp 400w, d.webp 800w"></picture><img data-src="e.png" data-original="f.jpg" data-srcset="g.png 2x"><meta property="og:image" content="meta.jpg"><meta name="twitter:image" content="meta.jpg"><a href="large.avif">Download</a><div style="background-image: url(\'bg.png\'), url(bg2.png)"></div><img src="data:image/png;base64,abc"><img src="javascript:alert(1)">';
  const settings = options(html,{fetch:async()=>{requests++;return new Response(html,{headers:{'content-type':'text/html'}});}});
  const result = await api.extractImages(url,settings);
  assert.deepEqual(result.data.map(image=>new URL(image.url).pathname),['/assets/a.png','/assets/b.png','/c.webp','/assets/d.webp','/assets/g.png','/assets/e.png','/assets/f.jpg','/assets/meta.jpg','/assets/large.avif','/assets/bg.png','/assets/bg2.png']);
  assert.equal(result.data[0].width,20); assert.equal(result.data[0].resolutionVerified,false);
  assert.equal(result.data[2].width,null); assert.equal(requests,1);
  assert.equal((await api.extractImages(url,{...settings,includeMetadata:false})).data.some(image=>image.source==='metadata'),false);
  assert.equal((await api.extractImages(url,{...settings,unique:false})).data.filter(image=>image.url.endsWith('meta.jpg')).length,2);
  assert.ok((await api.extractImages(url,{...settings,sources:['lazy']})).data.every(image=>image.source==='lazy'));
});

test('social links recognize all platforms from links, rel-me, sameAs and metadata, with exact domains and filters', async () => {
  const addresses = ['https://youtu.be/AbC','https://tiktok.com/@example/video/123','https://instagram.com/reel/AbC/','https://facebook.com/example/posts/123','https://twitter.com/example/status/123','https://threads.net/@example/post/AbC','https://linkedin.com/in/example','https://twitch.tv/example','https://reddit.com/r/example/comments/AbC/post','https://github.com/example','https://vimeo.com/123','https://bsky.app/profile/example.test/post/AbC'];
  const html = addresses.map(target=>`<a href="${target}">link</a>`).join('')+'<a href="https://fake-youtube.com/watch?v=bad">decoy</a><a href="https://youtube.com.evil.test/@bad">decoy</a><link rel="me" href="https://github.com/other"><script type="application/ld+json">{"sameAs":["https://www.youtube.com/@example"]}</script><meta property="og:url" content="https://instagram.com/example/">';
  const settings=options(html);
  const result=await api.extractSocialLinks(url,settings);
  assert.deepEqual([...new Set(result.data.map(link=>link.platform))].sort(),Object.keys(domains).sort());
  assert.equal(result.data.length,15);
  assert.equal(result.data.find(link=>link.url==='https://youtu.be/AbC').kind,'video');
  assert.equal((await api.extractSocialLinks(url,{...settings,platform:'youtube'})).data.length,2);
  assert.equal((await api.extractSocialLinks(url,{...settings,platform:'twitter'})).data[0].platform,'x');
  await assert.rejects(api.extractSocialLinks(url,{...settings,platform:'fake'}),api.FetcharyValidationError);
});

for (const [platform, target, file, expected] of [
  ['youtube','https://www.youtube.com/watch?v=AbC123','youtube-video.html',{views:12345,likes:1200,comments:56}],
  ['youtube','https://www.youtube.com/@example','youtube-channel.html',{subscribers:12500}],
  ['tiktok','https://www.tiktok.com/@example','tiktok-profile.html',{followers:12345,following:12,posts:42}],
  ['tiktok','https://www.tiktok.com/@example/video/123','tiktok-video.html',{likes:0,comments:123,views:123456,shares:45,saves:67}],
  ['instagram','https://www.instagram.com/example/','instagram-profile.html',{followers:12345,following:123,posts:42}],
  ['instagram','https://www.instagram.com/reel/AbCd/','instagram-post.html',{likes:1234,comments:23,views:12345}],
]) test(`${platform} insights parse realistic ${file} with metric provenance and explicit missing values`, async () => {
  const result=await api.extractSocialInsights(target,options(fixture(file)));
  assert.equal(result.data.platform,platform);
  assert.equal(result.data.status,'available');
  for (const [metric,value] of Object.entries(expected)) {
    assert.equal(result.data.metrics[metric],value,metric);
    assert.ok(result.data.sources[metric].field);
  }
  for (const metric of Object.keys(result.data.metrics)) if (!Object.hasOwn(expected,metric)) {
    assert.equal(result.data.metrics[metric],null,metric); assert.equal(result.data.unavailable[metric],'unsupported');
  }
  if(file==='youtube-video.html') assert.equal(result.data.sources.likes.approximate,true);
  if(file==='tiktok-video.html') assert.equal(result.data.sources.likes.approximate,false);
});

test('social insights never substitute unrelated profiles, videos or case-sensitive post IDs', async () => {
  for (const [target, file] of [['https://www.youtube.com/watch?v=Other','youtube-video.html'],['https://www.tiktok.com/@example/video/999','tiktok-video.html'],['https://www.instagram.com/reel/abcd/','instagram-post.html'],['https://www.instagram.com/other/','instagram-profile.html']]) {
    const result=await api.extractSocialInsights(target,options(fixture(file)));
    assert.equal(result.data.status,'unavailable'); assert.ok(Object.values(result.data.metrics).every(value=>value===null));
  }
  const missing=await api.extractSocialInsights('https://www.tiktok.com/@example/video/123',options('<html></html>'));
  assert.equal(missing.data.status,'unavailable'); assert.equal(missing.data.metrics.likes,null);
});

test('login, CAPTCHA, unsupported platforms and extraction errors have distinct availability', async () => {
  const target='https://www.tiktok.com/@example';
  assert.equal((await api.extractSocialInsights(target,options('<title>Log in</title><input type="password">'))).data.status,'login_required');
  assert.equal((await api.extractSocialInsights(target,options('<title>Verify you are human</title>'))).data.status,'blocked');
  assert.equal((await api.extractSocialInsights('https://facebook.com/example',options('<p>Public profile</p>'))).data.status,'unsupported');
  const vendor=discoverVendors().find(vendor=>vendor.name==='tiktok');
  const saved=vendor.socialInsights;
  try { vendor.socialInsights=()=>{throw new Error('parser failure');}; assert.equal((await api.extractSocialInsights(target,options('<html></html>'))).data.status,'extraction_error'); }
  finally { vendor.socialInsights=saved; }
});

test('JSON-LD metrics require matching entity URLs and tolerate malformed scripts without evaluating JavaScript', async () => {
  const target='https://www.youtube.com/watch?v=AbC';
  const html='<script>throw new Error("must not execute")</script><script type="application/ld+json">{broken</script><script type="application/ld+json">'+JSON.stringify({'@type':'VideoObject',url:target,commentCount:0,interactionStatistic:[{interactionType:'https://schema.org/WatchAction',userInteractionCount:123},{interactionType:'LikeAction',userInteractionCount:12}]})+'</script>';
  const result=await api.extractSocialInsights(target,options(html));
  assert.equal(result.data.metrics.comments,0); assert.equal(result.data.metrics.views,123); assert.equal(result.data.metrics.likes,12);
  const roots=[...jsonRoots(parseHTML('<script>var ytInitialData = {"text":"} escaped \\\"", "array": [1]};</script>').document,['ytInitialData'])];
  assert.equal(roots.length,1);
});

test('compact counts preserve approximation and grouped counts remain exact', () => {
  for(const [input,value,approximate] of [['12K',12000,true],['12.5K',12500,true],['1.2M',1200000,true],['1,2 Mio.',1200000,true],['12.345',12345,false],['12,345',12345,false],['12 345',12345,false]]) assert.deepEqual(countDetails(input),{value,approximate});
  assert.equal(countDetails('hidden'),null);
});

test('URL classification preserves account/post identity across all supported common URL forms',()=>{
  for(const [target,platform,kind] of [
    ['https://youtu.be/AbC','youtube','video'],['https://youtube.com/shorts/AbC','youtube','video'],['https://youtube.com/embed/AbC','youtube','video'],['https://youtube.com/live/AbC','youtube','video'],['https://youtube.com/channel/UC123','youtube','channel'],['https://youtube.com/c/example/videos','youtube','channel'],['https://youtube.com/user/example','youtube','channel'],
    ['https://tiktok.com/@example','tiktok','profile'],['https://tiktok.com/@example/video/123','tiktok','video'],['https://vm.tiktok.com/short','tiktok','unknown'],
    ['https://instagram.com/example','instagram','profile'],['https://instagram.com/p/AbC','instagram','post'],['https://instagram.com/reel/AbC','instagram','video'],
    ['https://facebook.com/profile.php?id=123','facebook','profile'],['https://facebook.com/example/posts/123','facebook','post'],['https://facebook.com/reel/123','facebook','video'],
    ['https://twitter.com/example','x','profile'],['https://x.com/example/status/123','x','post'],['https://threads.net/@example/post/AbC','threads','post'],
    ['https://linkedin.com/company/example/about','linkedin','profile'],['https://linkedin.com/posts/abc','linkedin','post'],['https://twitch.tv/example/about','twitch','profile'],['https://twitch.tv/videos/123','twitch','video'],
    ['https://reddit.com/user/example','reddit','profile'],['https://redd.it/AbC','reddit','post'],['https://github.com/example','github','profile'],['https://github.com/example/repo','github','unknown'],
    ['https://vimeo.com/example','vimeo','profile'],['https://vimeo.com/123','vimeo','video'],['https://bsky.app/profile/example.test','bluesky','profile'],['https://bsky.app/profile/example.test/post/AbC','bluesky','post'],
  ]) { const result=classifyUrl(target);assert.equal(result.platform,platform,target);assert.equal(result.kind,kind,target); }
  assert.equal(classifyUrl('https://youtube.com/@example?v=not-a-video').kind,'channel');
  assert.equal(classifyUrl('https://instagram.com/p/AbC').id,'AbC');
});

test('rendered insights can retain missing public HTTP metrics without crossing entity boundaries',async()=>{
  const target='https://www.tiktok.com/@example/video/123';
  const raw='<script type="application/json">{"id":"123","stats":{"playCount":1000}}</script>';
  const rendered='<script type="application/json">{"id":"123","stats":{"diggCount":0,"commentCount":2}}</script>';
  const result=await api.extractSocialInsights(target,options(raw,{mode:'auto',waitAfterLoad:0,launchBrowser:async()=>({newPage:async()=>({goto:async()=>{},content:async()=>rendered,url:()=>target,close:async()=>{}}),close:async()=>{}})}));
  assert.equal(result.data.metrics.views,1000);assert.equal(result.data.metrics.likes,0);assert.equal(result.data.metrics.comments,2);
  assert.match(result.data.sources.views.field,/^rawHTTP:/);
});

test('LinkedIn retains the public HTTP follower fallback while reporting a rendered login wall',async()=>{
  const target='https://www.linkedin.com/in/example/';
  const result=await api.extractSocialInsights(target,options('<h3 class="top-card-layout__first-subline">1,234 followers</h3>',{mode:'browser',waitAfterLoad:0,launchBrowser:async()=>({newPage:async()=>({goto:async()=>{},content:async()=>'<title>Sign in</title>',url:()=> 'https://www.linkedin.com/authwall',close:async()=>{}}),close:async()=>{}})}));
  assert.equal(result.data.status,'login_required');assert.equal(result.data.metrics.followers,1234);
  assert.equal(result.data.sources.followers.field,'followerCountFromRaw');
});

for(const [target,html,platform,count] of [
  ['https://x.com/example','<a href="/example/followers">1.2K Followers</a>','x',1200],
  ['https://threads.com/@example','<script type="application/json">{"username":"example","follower_count":42}</script>','threads',42],
  ['https://linkedin.com/company/example/','<h3 class="top-card-layout__first-subline">42 followers</h3>','linkedin',42],
  ['https://twitch.tv/example/about','<script type="application/json">{"login":"example","followers":{"totalCount":42}}</script>','twitch',42],
  ['https://github.com/example','<a href="/example?tab=followers">42 followers</a>','github',42],
]) test(`${platform} existing follower parser is integrated into direct stateless insights`,async()=>{
  const result=await api.extractSocialInsights(target,options(html));
  assert.equal(result.data.platform,platform);assert.equal(result.data.metrics.followers,count);assert.equal(result.data.status,'available');
  assert.equal(result.data.sources.followers.field,'followerCount');
  assert.equal(result.data.sources.followers.approximate,platform==='x'?true:null);
});

test('link-only adapters explicitly leave profile and post metrics unsupported',async()=>{
  for(const target of ['https://facebook.com/example','https://reddit.com/user/example','https://vimeo.com/123','https://bsky.app/profile/example.test/post/123']) {
    const result=await api.extractSocialInsights(target,options('<p>Public reference</p>'));
    assert.equal(result.data.status,'unsupported');assert.ok(Object.values(result.data.unavailable).every(reason=>reason==='unsupported'));
  }
});
