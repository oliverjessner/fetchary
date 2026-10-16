'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const api = require('../src');
const { isPrivateAddress } = require('../src/utils/url');
const publicLookup = async () => [{ address:'93.184.216.34',family:4 }];

async function localSite(t, handler) {
  const server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('private/internal IP variants, schemes, credentials and local hostnames fail before transport', async () => {
  let requests=0;
  const fetch=async()=>{requests++;return new Response('<p>wrong</p>');};
  for (const target of ['file:///etc/passwd','data:text/html,Hello','ftp://example.com','http://localhost/','http://local.internal/','http://intranet/','http://127.0.0.1/','http://2130706433/','http://0x7f000001/','http://10.0.0.1/','http://169.254.169.254/','http://192.168.1.1/','http://[::1]/','http://[::ffff:127.0.0.1]/','http://[fc00::1]/','https://user:password@example.com/']) await assert.rejects(api.extractText(target,{fetch}),api.FetcharyValidationError,target);
  assert.equal(requests,0);
  assert.equal(isPrivateAddress('8.8.8.8'),false); assert.equal(isPrivateAddress('2606:4700:4700::1111'),false);
  assert.equal(isPrivateAddress('not-an-ip'),true);
});

test('all DNS answers and redirect destinations are checked, including cached operations', async () => {
  let requests=0;
  const fetch=async()=>{requests++;return new Response('<p>Public</p>',{headers:{'content-type':'text/html'}});};
  const target='https://public.example.test/';
  await assert.rejects(api.extractText(target,{fetch,lookup:async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]}),api.FetcharyValidationError);
  assert.equal(requests,0);
  let privateNow=false;
  const lookup=async()=>[{address:privateNow?'127.0.0.1':'93.184.216.34',family:4}];
  await api.extractText(target,{fetch,lookup}); privateNow=true;
  await assert.rejects(api.extractText(target,{fetch,lookup}),api.FetcharyValidationError);
  assert.equal(requests,1);
  let redirects=0;
  const redirected=async()=>{redirects++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/admin'}});};
  await assert.rejects(api.extractText(target,{fetch:redirected,lookup:publicLookup}),api.FetcharyValidationError);
  assert.equal(redirects,1);
});

test('native HTTP pins the validated DNS address instead of resolving again when connecting', async t => {
  let selected;
  t.mock.method(http,'request',(target,settings,callback)=>{
    assert.equal(target.hostname,'public.example.test');
    settings.lookup(target.hostname,{all:false},(error,address,family)=>{assert.equal(error,null);selected={address,family};});
    const request=new EventEmitter();
    request.end=()=>{
      const response=Readable.from([Buffer.from('<p>Pinned</p>')]);
      response.rawHeaders=['content-type','text/html']; response.statusCode=200;
      callback(response);
    };
    return request;
  });
  const result=await api.extractText('http://public.example.test/',{lookup:publicLookup});
  assert.equal(result.data,'Pinned'); assert.deepEqual(selected,{address:'93.184.216.34',family:4});
});

test('trusted local opt-in supports redirects and gzip while enforcing decoded body limits', async t => {
  let requests=0;
  const site=await localSite(t,(request,response)=>{
    requests++;
    if(request.url==='/start'){response.writeHead(302,{location:'/page'});response.end();}
    else if(request.url==='/large'){response.writeHead(200,{'content-encoding':'gzip','content-type':'text/html'});response.end(zlib.gzipSync('<p>'+ 'x'.repeat(10000)+'</p>'));}
    else {response.writeHead(200,{'content-type':'text/html'});response.end('<p>Local content</p>');}
  });
  await assert.rejects(api.extractText(site),api.FetcharyValidationError);
  assert.equal(requests,0);
  const result=await api.extractText(`${site}/start`,{allowPrivateNetwork:true});
  assert.equal(result.data,'Local content');assert.equal(result.finalUrl,`${site}/page`);
  await assert.rejects(api.extractText(`${site}/large`,{allowPrivateNetwork:true,maxResponseBytes:100}),api.FetcharyFetchError);
});

test('timeouts, AbortSignal cancellation, streaming limits and DNS failures produce typed errors', async t => {
  const site=await localSite(t,(request,response)=>{if(request.url==='/slow') return;response.end('<p>ok</p>');});
  await assert.rejects(api.extractText(`${site}/slow`,{allowPrivateNetwork:true,timeout:20}),api.FetcharyFetchError);
  const controller=new AbortController(); controller.abort();
  await assert.rejects(api.extractText(`${site}/page`,{allowPrivateNetwork:true,signal:controller.signal}),api.FetcharyFetchError);
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1000));controller.close();}});
  await assert.rejects(api.extractText('https://public.example.test/',{lookup:publicLookup,maxResponseBytes:100,fetch:async()=>new Response(stream)}),api.FetcharyFetchError);
  await assert.rejects(api.extractText('https://public.example.test/',{lookup:async()=>{throw new Error('DNS unavailable');}}),api.FetcharyFetchError);
});

test('cross-origin redirects strip credentials and incomplete/error responses cannot be cached', async () => {
  const headers=[];
  const fetch=async(target,options)=>{
    headers.push(options.headers);
    if(target.includes('/start')) return new Response(null,{status:302,headers:{location:'https://other.example.test/page'}});
    return new Response('<p>Public</p>',{headers:{'content-type':'text/html'}});
  };
  await api.extractText('https://public.example.test/start',{fetch,lookup:publicLookup,headers:{authorization:'Bearer secret',cookie:'session=secret'}});
  assert.equal(headers[0].authorization,'Bearer secret');assert.equal(headers[1].authorization,undefined);assert.equal(headers[1].cookie,undefined);
  let requests=0;
  const client=api.createExtractor({lookup:publicLookup,fetch:async()=>{requests++;return new Response('blocked',{status:403});}});
  await assert.rejects(client.extractText('https://public.example.test/'),api.FetcharyFetchError);
  await assert.rejects(client.extractText('https://public.example.test/'),api.FetcharyFetchError);
  assert.equal(requests,2);
});

test('HTTP authentication and access errors become explicit social insight availability', async () => {
  for(const [status,availability] of [[401,'login_required'],[403,'blocked'],[429,'blocked']]) {
    const result=await api.extractSocialInsights('https://www.tiktok.com/@example',{lookup:publicLookup,fetch:async()=>new Response('wall',{status})});
    assert.equal(result.status,status);assert.equal(result.data.status,availability);assert.ok(Object.values(result.data.metrics).every(value=>value===null));
  }
});

test('import and extraction create no application data files and leave existing data untouched', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fetchary-stateless-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const existing=path.join(root,'fetchary.sqlite');fs.writeFileSync(existing,'historical user bytes');
  const before=fs.readdirSync(root);
  await api.extractText('https://public.example.test/',{lookup:publicLookup,fetch:async()=>new Response('<p>hello</p>',{headers:{'content-type':'text/html'}})});
  assert.deepEqual(fs.readdirSync(root),before);assert.equal(fs.readFileSync(existing,'utf8'),'historical user bytes');
  for(const module of Object.keys(require.cache)) assert.equal(/src\/(?:storage|scheduler|fetchary\.js)/.test(module),false,module);
});

test('real Chromium blocks private subresources and direct WebSocket networking',async t=>{
  let requests=0;
  const server=http.createServer((request,response)=>{requests++;response.end('private');});
  server.on('upgrade',(request,socket)=>{requests++;socket.destroy();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const privateUrl=`http://127.0.0.1:${server.address().port}`;
  const options={mode:'browser',waitAfterLoad:150,timeout:5000,lookup:publicLookup,fetch:async()=>new Response(`<html><body><main>Public</main><script>new WebSocket('${privateUrl.replace('http:','ws:')}/socket').onerror=()=>{document.body.dataset.wsBlocked='true';};</script></body></html>`,{headers:{'content-type':'text/html'}})};
  const result=await api.extractHtml('https://public.example.test/',options);
  assert.match(result.data,/data-ws-blocked="true"/);assert.equal(requests,0);
  await assert.rejects(api.extractHtml('https://public.example.test/',{...options,fetch:async()=>new Response(`<html><body><img src="${privateUrl}/secret"></body></html>`,{headers:{'content-type':'text/html'}})}));
  assert.equal(requests,0);
});

test('browser cancellation returns promptly and closes a late custom launch result',async()=>{
  let resolveLaunch;let launched;
  const started=new Promise(resolve=>{launched=resolve;});
  const controller=new AbortController();
  const pending=api.extractText('https://public.example.test/',{mode:'browser',signal:controller.signal,lookup:publicLookup,fetch:async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}}),launchBrowser:()=>{launched();return new Promise(resolve=>{resolveLaunch=resolve;});}});
  const rejected=assert.rejects(pending,api.FetcharyFetchError);
  await started;controller.abort();await rejected;
  let closes=0;resolveLaunch({close:async()=>{closes++;}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(closes,1);
});

test('DNS and custom browser launch timeouts are bounded and typed',async()=>{
  await assert.rejects(api.extractText('https://public.example.test/',{timeout:20,lookup:()=>new Promise(()=>{})}),api.FetcharyFetchError);
  await assert.rejects(api.extractText('https://public.example.test/',{mode:'browser',timeout:20,waitAfterLoad:0,lookup:publicLookup,fetch:async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}}),launchBrowser:()=>new Promise(()=>{})}),api.FetcharyBrowserError);
});

test('undocumented transport options cannot alter the HTTP method or bypass redirect/cache policy',async()=>{
  let requests=0;
  const fetch=async()=>{requests++;return new Response('<p>public</p>');};
  for(const override of [{method:'POST'},{body:'payload'},{followRedirects:false},{getVendors:()=>[]}]) await assert.rejects(api.extractText('https://public.example.test/',{lookup:publicLookup,fetch,...override}),api.FetcharyValidationError);
  assert.equal(requests,0);
});

test('favicon resources and browser subresources never receive another origin\'s caller headers',async()=>{
  const primary='https://public.example.test/';const icon='https://cdn.example.test/icon.svg';
  const seen=[];
  const fetch=async(target,options)=>{
    seen.push({url:target,headers:options.headers});
    if(target===primary) return new Response(`<html><body><main>Public</main><img src="${icon}"><link rel="icon" href="${icon}"></body></html>`,{headers:{'content-type':'text/html'}});
    if(target===icon) return new Response('<svg width="128" height="128"></svg>',{headers:{'content-type':'image/svg+xml'}});
    return new Response('',{status:404});
  };
  const options={lookup:publicLookup,fetch,headers:{authorization:'Bearer secret','x-api-key':'secret-key'},waitAfterLoad:0};
  await api.extractFavicon(primary,{...options,mode:'http'});
  await api.extractHtml(primary,{...options,mode:'browser'});
  assert.ok(seen.filter(request=>request.url===primary).every(request=>request.headers.authorization==='Bearer secret'));
  const foreign=seen.filter(request=>request.url===icon);assert.ok(foreign.length>=2);
  assert.ok(foreign.every(request=>request.headers.authorization===undefined&&request.headers['x-api-key']===undefined));
});

test('browser navigation access responses preserve insight availability and HTTP status',async()=>{
  for(const [status,availability] of [[401,'login_required'],[403,'blocked'],[429,'blocked']]) {
    const target='https://www.tiktok.com/@example';
    const result=await api.extractSocialInsights(target,{mode:'browser',waitAfterLoad:0,allowPrivateNetwork:true,fetch:async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}}),launchBrowser:async()=>({newPage:async()=>({goto:async()=>({status:()=>status}),close:async()=>{}}),close:async()=>{}})});
    assert.equal(result.data.status,availability);assert.equal(result.status,status);assert.equal(result.captureMode,'browser');assert.equal(result.capturedAt,null);
  }
});

test('the aggregate browser resource budget aborts remaining requests and closes Chromium',async()=>{
  const primary='https://public.example.test/';
  const html='<html><head>'+Array.from({length:6},(_,index)=>`<link rel="stylesheet" href="/style-${index}.css">`).join('')+'</head><body>Public</body></html>';
  await assert.rejects(api.extractHtml(primary,{mode:'browser',lookup:publicLookup,waitAfterLoad:0,timeout:5000,maxResponseBytes:1024,fetch:async target=>new Response(target===primary?html:'/*'+'x'.repeat(896)+'*/',{headers:{'content-type':target===primary?'text/html':'text/css'}})}),error=>error instanceof api.FetcharyBrowserError && /budget/.test(error.cause?.message || error.message));
});
