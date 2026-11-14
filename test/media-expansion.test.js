'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const api=require('../src');
const url='https://example.test/page';
const svg=size=>`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path d="M0 0h${size}v${size}H0z"/></svg>`;
function fixture(entries,extra={}){
  const requests=[];
  return {requests,options:{mode:'http',allowPrivateNetwork:true,fetch:async target=>{
    requests.push(target);const entry=entries[target];
    if(!entry)return new Response('',{status:404});
    const [body,type='text/html']=Array.isArray(entry)?entry:[entry];
    return new Response(body,{headers:{'content-type':type}});
  },...extra}};
}

test('favicon all returns ordered metadata including Safari mask icons without changing the first selection',async()=>{
  const site=fixture({[url]:'<link rel="icon" href="/small.svg"><link rel="mask-icon" href="/mask.svg" color="#000">',
    'https://example.test/small.svg':[svg(32),'image/svg+xml'],'https://example.test/mask.svg':[svg(64),'image/svg+xml']});
  const result=await api.extractFavicon(url,{...site.options,all:true});
  assert.equal(result.data.length,2);assert.deepEqual(result.images,result.data);assert.deepEqual(result.image,result.data[0]);
  assert.deepEqual(result.data.map(image=>image.width),[32,64]);
  assert.ok(result.data.some(image=>image.source==='mask-icon'));
  assert.equal((await api.extractFavicon(url,site.options)).image.url,result.image.url);
});

test('favicon all and binary conflict before any fetch',async()=>{
  const site=fixture({});
  await assert.rejects(api.extractFavicon(url,{...site.options,all:true,binary:true}),api.FetcharyValidationError);
  assert.deepEqual(site.requests,[]);
});

test('stylesheet image discovery resolves CSS URLs against each stylesheet and bounds imports',async()=>{
  const site=fixture({[url]:'<link rel="stylesheet" href="/css/main.css"><img src="/inline.png">',
    'https://example.test/css/main.css':['@import "nested/theme.css";.main{background:url(../images/main.png)}','text/css'],
    'https://example.test/css/nested/theme.css':['@import "deeper/final.css";.theme{background-image:url(../../images/theme.webp)}','text/css'],
    'https://example.test/css/nested/deeper/final.css':['@import "never.css";.deep{background:url(../../../images/deep.jpg)}','text/css'],
    'https://example.test/css/nested/deeper/never.css':['.never{background:url(/must-not-load.png)}','text/css']});
  const result=await api.extractImages(url,{...site.options,sources:['stylesheet']});
  assert.deepEqual(new Set(result.data.map(image=>image.url)),new Set(['https://example.test/images/main.png','https://example.test/images/theme.webp','https://example.test/images/deep.jpg']));
  assert.ok(result.data.every(image=>image.source==='stylesheet'));
  assert.ok(!site.requests.some(target=>target.endsWith('never.css')));
  assert.ok(!site.requests.some(target=>/\.(?:png|webp|jpg)$/.test(target)));
});

test('stylesheet discovery can be disabled and never reads more than eight CSS files',async()=>{
  const entries={[url]:Array.from({length:10},(_,index)=>`<link rel="stylesheet" href="/style${index}.css">`).join('')+'<img src="/inline.png">'};
  for(let index=0;index<10;index++)entries[`https://example.test/style${index}.css`]=[`.image{background:url(/image${index}.png)}`,'text/css'];
  const enabled=fixture(entries);await api.extractImages(url,enabled.options);
  assert.equal(enabled.requests.filter(target=>target.endsWith('.css')).length,8);
  const disabled=fixture(entries);const result=await api.extractImages(url,{...disabled.options,includeStylesheets:false});
  assert.deepEqual(disabled.requests,[url]);assert.equal(result.data.length,1);assert.equal(result.data[0].url,'https://example.test/inline.png');
});

test('sitemap links preserve modification time, frequency and normalized priority',async()=>{
  const site=fixture({[url]:['<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/article</loc><lastmod>2026-11-15T12:00:00Z</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url></urlset>','application/xml']});
  const result=await api.extractLinks(url,site.options);
  assert.equal(result.data[0].lastmod,'2026-11-15T12:00:00Z');assert.equal(result.data[0].changefreq,'weekly');assert.equal(result.data[0].priority,0.8);
});

test('analysis diagnostics count real attempts and bytes while reused snapshots create no phantom traffic',async()=>{
  const html='<h1>Example</h1><p>Readable static content.</p>';
  const site=fixture({[url]:html});
  const first=await api.analyse(url,site.options);
  assert.equal(first.diagnostics.requests,site.requests.length);
  assert.equal(first.diagnostics.decodedBytes,Buffer.byteLength(html));
  assert.equal(first.diagnostics.rawSnapshotBytes,Buffer.byteLength(html));assert.equal(first.diagnostics.browserMs,0);
  assert.ok(first.diagnostics.durationMs>=0);assert.ok(first.diagnostics.httpMs>=0);
  assert.ok(Object.values(first.diagnostics.sectionMs).every(value=>Number.isFinite(value)&&value>=0));
  const previousRequests=site.requests.length;
  const second=await api.analyse(url,site.options);
  assert.equal(second.diagnostics.requests,site.requests.length-previousRequests);
  assert.equal(second.diagnostics.decodedBytes,0);assert.ok(second.diagnostics.cacheHits>=1);
  assert.equal(second.diagnostics.rawSnapshotBytes,Buffer.byteLength(html));
});
