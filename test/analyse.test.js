'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const api = require('../src');
const { main } = require('../cli');
const { listItems } = require('../cli/list');
const url = 'https://example.test/page';
const html = fs.readFileSync(path.join(__dirname,'fixtures/analyse/page.html'),'utf8');
const svg = '<svg width="64" height="64"></svg>';
const types = ['favicon','links','social-links','emails','telephone','images','documents','structured-data','metadata','tracker-intelligence'];
function fixture(body = html, extra = {}) {
  const requests = [];
  const options = { mode:'http', allowPrivateNetwork:true, fetch:async (target, init) => {
    requests.push({url:target,init});
    if (target === url) return new Response(body,{headers:{'content-type':'text/html'}});
    if (target === 'https://example.test/icon.svg') return new Response(svg,{headers:{'content-type':'image/svg+xml'}});
    return new Response('Missing',{status:404});
  }, ...extra };
  return {options, requests, count:()=>requests.filter(request=>request.url===url).length};
}
async function cli(args, options) {
  let stdout=''; let stderr='';
  const code = await main(args,{options,stdout:{write:value=>stdout+=value},stderr:{write:value=>stderr+=value}});
  return {code,stdout,stderr};
}

test('analyse combines exactly the ten extractors with unchanged section payloads and metadata', async () => {
  const site = fixture(); const result = await api.analyse(url,site.options);
  assert.equal(result.type,'analyse');assert.equal(result.requestedUrl,url);assert.equal(result.finalUrl,url);
  assert.equal(result.status,200);assert.equal(result.captureMode,'http');assert.equal(site.count(),1);
  assert.deepEqual(Object.keys(result.results),types);assert.deepEqual(result.summary,{succeeded:10,failed:0});assert.deepEqual(result.errors,{});
  for (const type of types) {
    const single = await api.extract(url,{...site.options,type});
    assert.deepEqual(result.results[type].data,single.data,type);
    assert.equal(result.results[type].requestedUrl,url);assert.equal(result.results[type].capturedAt,result.capturedAt);
    assert.equal(result.results[type].type,type);assert.equal(result.results[type].status,200);
  }
  assert.equal(site.count(),1);
  assert.equal(result.results.favicon.data.url,'https://example.test/icon.svg');
  assert.deepEqual(result.results.emails.data,['hello@example.test']);
  assert.deepEqual(result.results.telephone.data,['+436641234567']);
  assert.equal(result.results.documents.data[0].url,'https://example.test/guide.pdf');
  assert.equal(result.results['tracker-intelligence'].data.summary.providers,1);
});

test('auto analysis stays on HTTP when every extractor has static results', async () => {
  const site = fixture(html,{mode:'auto',launchBrowser:async()=>{throw new Error('unnecessary rendering');}});
  const result = await api.analyse(url,site.options);
  assert.deepEqual(result.summary,{succeeded:10,failed:0});assert.equal(result.captureMode,'http');assert.equal(site.count(),1);
});

test('disabled cache, abortable captures and authenticated requests still share one document within an analysis', async () => {
  for (const extra of [{cacheTtlMs:0},{signal:new AbortController().signal},{headers:{Authorization:'Bearer test-only'}}]) {
    const site = fixture(html,extra); const result=await api.analyse(url,site.options);
    assert.equal(result.summary.succeeded,10);assert.equal(site.count(),1);assert.equal(result.cache.hit,false);
  }
});

test('isolated clients reuse captures, clear cache and return independent nested result objects', async () => {
  const site=fixture();const client=api.createExtractor(site.options);
  const [first,second] = await Promise.all([client.analyse(url),client.analyse(url)]);
  assert.equal(site.count(),1);assert.deepEqual(first.results.metadata.data,second.results.metadata.data);
  first.results.metadata.data.title='Changed';first.results.links.data.length=0;
  const third=await client.analyse(url);assert.equal(third.cache.hit,true);assert.equal(third.results.metadata.data.title,'Analysis fixture');assert.ok(third.results.links.data.length);
  await client.extractMetadata(url);assert.equal(site.count(),1);
  client.clearCache();await client.analyse(url);assert.equal(site.count(),2);
  await api.createExtractor(site.options).analyse(url);assert.equal(site.count(),3);
  const module=await import('../src/index.js');assert.equal(module.analyse,api.analyse);
});

test('missing favicon is a section failure and preserves the other nine extraction results', async () => {
  const site=fixture('<html><title>No icon</title><a href="/about">About</a></html>');
  const report=await api.analyse(url,site.options);
  assert.deepEqual(report.summary,{succeeded:9,failed:1});assert.equal(report.results.favicon,null);
  assert.equal(report.errors.favicon.error,'FetcharyNotFoundError');assert.equal(report.results.metadata.data.title,'No icon');assert.deepEqual(report.results.emails.data,[]);
  const output=await cli(['analyse',url],site.options);assert.equal(output.code,0);assert.equal(output.stderr,'');assert.equal(JSON.parse(output.stdout).summary.failed,1);
  assert.equal(site.count(),1);
});

test('primary capture errors fail once and retain the existing CLI HTTP exit code', async () => {
  let requests=0;const options={mode:'http',allowPrivateNetwork:true,fetch:async()=>{requests++;return new Response('Unavailable',{status:503});}};
  await assert.rejects(api.analyse(url,options),error=>error instanceof api.FetcharyFetchError && error.status===503);assert.equal(requests,1);
  const output=await cli(['analyse',url,'--json'],options);assert.equal(output.code,3);assert.equal(output.stdout,'');assert.equal(JSON.parse(output.stderr).error,'FetcharyFetchError');assert.equal(requests,2);
});

test('analysis validates common options, country, binary and target safety before any fetch', async () => {
  let requests=0;const options={fetch:async()=>{requests++;throw new Error('must not fetch');},allowPrivateNetwork:true};
  for(const invalid of [{includeSelectors:['h1']},{platform:'youtube'},{mode:'invalid'},{timeout:0},{defaultCountry:'XX'},{binary:true},{method:'POST'},{cacheTtlMs:-1},{signal:{}}]) await assert.rejects(api.analyse(url,{...options,...invalid}),api.FetcharyValidationError);
  await assert.rejects(api.analyse('http://127.0.0.1',{fetch:options.fetch}),api.FetcharyValidationError);assert.equal(requests,0);
  for(const flag of ['--binary','--follower','--posts','--selector','--platform','--include-selector','--source']) {
    const output=await cli(['analyse',url,flag,...(['--selector','--platform','--include-selector','--source'].includes(flag)?['h1']:[])],options);
    assert.equal(output.code,2,flag);assert.equal(output.stdout,'');
  }
  assert.equal((await cli(['analyse'],options)).code,2);assert.equal((await cli(['analyse',url,url],options)).code,2);assert.equal(requests,0);
});

test('analysis cancellation aborts the shared request and never becomes a partial success', async () => {
  let requests=0;const controller=new AbortController();
  const options={mode:'http',allowPrivateNetwork:true,signal:controller.signal,fetch:async()=>{requests++;controller.abort(new Error('cancelled'));return new Response(html);}};
  await assert.rejects(api.analyse(url,options),api.FetcharyFetchError);assert.equal(requests,1);
  await assert.rejects(api.analyse(url,options),api.FetcharyFetchError);assert.equal(requests,1);
});

test('analysis respects response bounds, timeouts and scoped headers', async () => {
  const site=fixture();await assert.rejects(api.analyse(url,{...site.options,maxResponseBytes:20}),api.FetcharyFetchError);assert.equal(site.count(),1);
  await assert.rejects(api.analyse(url,{mode:'http',allowPrivateNetwork:true,timeout:10,fetch:async()=>new Promise(()=>{})}),api.FetcharyFetchError);
  const headers=fixture(html,{headers:{'X-Test':'value'},userAgent:'analysis-test'});await api.analyse(url,headers.options);
  assert.equal(headers.requests[0].init.headers['x-test'],'value');assert.equal(headers.requests[0].init.headers['user-agent'],'analysis-test');
});

test('CLI emits JSON by default, supports list aliases, deduplicates values and keeps diagnostics on stderr', async () => {
  const site=fixture();const output=await cli(['analyse',url],site.options);assert.equal(output.code,0);assert.equal(output.stderr,'');
  const report=JSON.parse(output.stdout);assert.equal(report.type,'analyse');assert.deepEqual(Object.keys(report.results),types);
  const listed=await cli(['analyse',url,'--list','--verbose'],site.options);assert.equal(listed.code,0);assert.equal(listed.stdout,listItems(report).join('\n')+'\n');assert.equal(listed.stderr,'Analysing website (http)\n');
  assert.equal(listed.stdout.split('\n').filter(line=>line==='https://www.youtube.com/@example').length,1);
  assert.equal((await cli(['analyse',url,'--urls-only'],site.options)).stdout,listed.stdout);
  assert.equal(JSON.parse((await cli(['analyse',url,'--json','--list'],site.options)).stdout).type,'analyse');
  assert.equal((await cli(['analyse',url,'--quiet','--verbose'],site.options)).stdout,'');
  assert.match((await cli(['analyse','--help'],site.options)).stdout,/fetchary analyse <url>/);
});

test('analysis forwards default country to telephone extraction', async () => {
  const site=fixture('<p>Call 0664 1234567</p>');const result=await cli(['analyse',url,'--default-country','AT'],site.options);
  assert.deepEqual(JSON.parse(result.stdout).results.telephone.data,['+436641234567']);
});

async function localSite(t,body) {
  const requests=[];
  const instance=http.createServer((request,response)=>{
    requests.push(request.url);
    if(request.url==='/icon.svg'){response.writeHead(200,{'content-type':'image/svg+xml'});response.end(svg);return;}
    if(request.url==='/favicon.ico'){response.writeHead(404);response.end('Missing');return;}
    response.writeHead(200,{'content-type':'text/html'});response.end(body);
  });
  await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>instance.close(resolve)));
  return {url:`http://127.0.0.1:${instance.address().port}/page`,requests};
}

test('browser analysis shares a single passive rendering and captures dynamically added results for all sections', async t => {
  const site=await localSite(t,html.replace('</body>',`<script>
    fetch('/must-not-fetch');navigator.sendBeacon('/must-not-beacon','secret');
    const pixel=document.createElement('img');pixel.src='https://www.facebook.com/tr?id=123456789012346';document.body.append(pixel);
    document.querySelector('title').textContent='Rendered title';
    document.body.insertAdjacentHTML('beforeend','<a href="/dynamic.pdf">Dynamic guide</a>');
  </script></body>`));
  const puppeteer=require('puppeteer');let launches=0;let closes=0;
  const report=await api.analyse(site.url,{mode:'browser',allowPrivateNetwork:true,waitAfterLoad:0,cacheTtlMs:0,launchBrowser:async options=>{
    launches++;const browser=await puppeteer.launch(options);const close=browser.close.bind(browser);browser.close=async()=>{closes++;await close();};return browser;
  }});
  assert.equal(launches,1);assert.equal(closes,1);assert.equal(site.requests.filter(target=>target==='/page').length,1);
  assert.ok(site.requests.every(target=>['/page','/icon.svg','/favicon.ico'].includes(target)));
  assert.equal(report.captureMode,'browser');assert.equal(report.summary.succeeded,10);assert.equal(report.results.metadata.data.title,'Rendered title');
  assert.ok(report.results.documents.data.some(item=>item.url.endsWith('/dynamic.pdf')));
  assert.equal(report.results['tracker-intelligence'].data.summary.uniqueIdentifiers,2);
  assert.ok(Object.values(report.results).every(result=>result.captureMode==='browser'));
});

test('auto fallbacks share one browser and preserve HTTP-only provenance for already complete sections', async t => {
  const body='<html><head><link rel="icon" href="/icon.svg"><title>Static title</title></head><body><script>document.body.insertAdjacentHTML("beforeend",\'<a href="/guide.pdf">Guide</a><a href="https://github.com/example">GitHub</a><p>hello@example.test +43 664 1234567</p><img src="/photo.png">\');</script></body></html>';
  const site=await localSite(t,body);const puppeteer=require('puppeteer');let launches=0;
  const result=await api.analyse(site.url,{mode:'auto',allowPrivateNetwork:true,waitAfterLoad:0,signal:new AbortController().signal,launchBrowser:async options=>{launches++;return puppeteer.launch(options);}});
  assert.equal(launches,1);assert.equal(site.requests.filter(target=>target==='/page').length,1);
  assert.equal(result.captureMode,'browser');assert.equal(result.results.metadata.captureMode,'http');assert.equal(result.results.documents.captureMode,'browser');
  assert.deepEqual(result.results.emails.data,['hello@example.test']);assert.equal(result.results.documents.data.length,1);
});

test('a failed auto fallback preserves complete sections while explicit browser failure fails the analysis', async () => {
  const site=fixture('<title>Static title</title><link rel="icon" href="/icon.svg"><script>window.app=true</script>',{mode:'auto',launchBrowser:async()=>{throw new Error('no browser');},waitAfterLoad:0});
  const result=await api.analyse(url,site.options);assert.equal(site.count(),1);assert.equal(result.results.metadata.data.title,'Static title');assert.ok(result.summary.failed>0);assert.equal(result.errors.images.error,'FetcharyBrowserError');
  await assert.rejects(api.analyse(url,{...site.options,mode:'browser'}),api.FetcharyBrowserError);
});

test('spawned CLI analyses a local page using native HTTP and serializes all ten results', async t => {
  const site=await localSite(t,html);
  const child=spawn(process.execPath,[path.join(__dirname,'../cli/index.js'),'analyse',site.url,'--mode','http','--allow-private-network']);
  let stdout='';let stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0,stderr);assert.equal(stderr,'');
  const report=JSON.parse(stdout);assert.deepEqual(report.summary,{succeeded:10,failed:0});assert.deepEqual(Object.keys(report.results),types);assert.equal(site.requests.filter(target=>target==='/page').length,1);
});
