'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const api = require('../src');
const { main } = require('../cli');
const { parseCookieFile, createCookieJar } = require('../src/capture/cookies');
const { readResource } = require('../src/capture/http');
const netscape = fs.readFileSync(path.join(__dirname,'fixtures/cookies/linkedin.txt'),'utf8');
const publicLookup = async()=>[{address:'93.184.216.34',family:4}];
const root = 'https://www.linkedin.test/in/example';
const cookie = (extra={}) => ({name:'session',value:'test-session',domain:'.linkedin.test',path:'/',secure:true,httpOnly:true,expires:-1,...extra});
function file(t, contents) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fetchary-cookie-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const target=path.join(dir,'session.txt');fs.writeFileSync(target,contents,{mode:0o600});return target;
}
async function cli(args,options) {
  let stdout='';let stderr='';const code=await main(args,{options,stdout:{write:value=>stdout+=value},stderr:{write:value=>stderr+=value}});return {code,stdout,stderr};
}

test('Netscape imports HttpOnly, session, quoted values and precise cookie scoping', () => {
  const parsed=parseCookieFile(netscape);assert.equal(parsed.length,5);
  const jar=createCookieJar(parsed,'https://linkedin.test/in/example');
  assert.equal(jar.header(root),'li_at=test-session; host_only=www-only');
  assert.equal(jar.header('https://www.linkedin.test/voyager/api'), 'JSESSIONID="ajax:test-csrf"; li_at=test-session; host_only=www-only');
  assert.equal(jar.header('https://www.linkedin.test/voyagerish'), 'li_at=test-session; host_only=www-only');
  assert.equal(jar.header('https://at.linkedin.test/'),'li_at=test-session');
  for(const target of ['http://www.linkedin.test/','https://other.test/','https://linkedin.test.evil.test/']) assert.equal(jar.header(target),'',target);
  assert.equal(jar.browserCookies().some(value=>value.name==='expired'||value.name==='unrelated'),false);
  assert.equal(jar.browserCookies()[0].httpOnly,true);assert.equal(jar.browserCookies()[0].expires,undefined);
});

test('JSON exports support browser arrays, storage-state wrappers, expirationDate and stable duplicate replacement', () => {
  for(const wrap of [cookies=>cookies,cookies=>({cookies,origins:[]})]) {
    const jar=createCookieJar(parseCookieFile(JSON.stringify(wrap([
      cookie({value:'first'}),cookie({value:'second',expirationDate:Date.now()/1000+3600,sameSite:'no_restriction'}),
      cookie({name:'path',path:'/in',value:'specific',sameSite:'Lax'}),
    ]))),root);
    assert.equal(jar.header(root),'path=specific; session=second');
    assert.equal(jar.browserCookies()[0].sameSite,'None');
  }
});

test('cookies remain within the initially requested hostname tree, even with overly broad exported domains', () => {
  const jar=createCookieJar(parseCookieFile(JSON.stringify([cookie({domain:'.test'})])),root);
  assert.equal(jar.header(root),'session=test-session');
  assert.equal(jar.header('https://attacker.test/'),'');assert.equal(jar.header('https://linkedin.test/'),'');
  assert.equal(jar.header('https://static.www.linkedin.test/'),'session=test-session');
});

test('invalid exports reject safely without echoing credential values', () => {
  const secret='PRIVATE_SESSION_VALUE';
  const invalid=[`[{"value":"${secret}",]`,JSON.stringify({value:secret}),JSON.stringify([cookie({value:secret+'; injection'})]),
    JSON.stringify([cookie({domain:'linkedin.test/evil',value:secret})]),JSON.stringify([cookie({path:'/bad\npath',value:secret})]),
    JSON.stringify([cookie({value:'"'})]),JSON.stringify([cookie({hostOnly:'false',value:secret})]),JSON.stringify([cookie({name:'bad name',value:secret})]),
    JSON.stringify([cookie({sameSite:'invalid',value:secret})]),JSON.stringify([cookie({partitionKey:'https://example.test',value:secret})]),
    JSON.stringify([cookie({name:'__Host-session',value:secret,hostOnly:false})]),'not a cookie export',
    JSON.stringify(Array.from({length:3001},()=>cookie({value:secret})))];
  for(const input of invalid) assert.throws(()=>parseCookieFile(input),error=>error instanceof api.FetcharyValidationError&&!error.message.includes(secret)&&error.cause===undefined);
});

test('HTTP follows redirects with domain/path cookies, strips raw auth headers across origins and never sends imported cookies to unrelated hosts', async t => {
  const cookieFile=file(t,netscape);const seen=[];
  const fetch=async(target,options)=>{
    seen.push({target,headers:options.headers});
    const next={ 'https://linkedin.test/start':'https://www.linkedin.test/voyager/api',
      'https://www.linkedin.test/voyager/api':'https://other.test/leave',
      'https://other.test/leave':'https://www.linkedin.test/in/example' }[target];
    return next?new Response(null,{status:302,headers:{location:next}}):new Response('<p>Public</p>',{headers:{'content-type':'text/html'}});
  };
  const result=await api.extractText('https://linkedin.test/start',{mode:'http',cookieFile,fetch,lookup:publicLookup,headers:{authorization:'Bearer test-auth'}});
  assert.equal(result.data,'Public');assert.equal(seen[0].headers.cookie,'li_at=test-session');
  assert.equal(seen[1].headers.cookie,'JSESSIONID="ajax:test-csrf"; li_at=test-session; host_only=www-only');
  assert.equal(seen[1].headers.authorization,undefined);assert.equal(seen[2].headers.cookie,undefined);
  assert.equal(seen[3].headers.cookie,'li_at=test-session; host_only=www-only');
  assert.equal(result.cache.ttlMs,0);assert.ok(!JSON.stringify(result).includes('test-session'));
  assert.equal(fs.readFileSync(cookieFile,'utf8'),netscape);
});

test('cookie-file captures bypass global/client caches, reload changed files and leave anonymous entries isolated', async t => {
  const cookieFile=file(t,JSON.stringify([cookie()]));let requests=0;
  const options={mode:'http',lookup:publicLookup,fetch:async(target,settings)=>{requests++;return new Response(`<p>${settings.headers.cookie?'Signed in':'Anonymous'}</p>`,{headers:{'content-type':'text/html'}});}};
  const client=api.createExtractor(options);
  assert.equal((await client.extractText(root)).data,'Anonymous');assert.equal(requests,1);
  await Promise.all([client.extractText(root,{cookieFile}),client.extractText(root,{cookieFile})]);assert.equal(requests,3);
  assert.equal((await client.extractText(root,{cookieFile})).cache.hit,false);assert.equal(requests,4);
  assert.equal((await client.extractText(root)).data,'Anonymous');assert.equal(requests,4);
  fs.writeFileSync(cookieFile,JSON.stringify([cookie({expires:1})]));
  await assert.rejects(client.extractText(root,{cookieFile}),api.FetcharyValidationError);assert.equal(requests,4);
});

test('cookie loading rejects missing, malformed, oversized, non-file, expired or unrelated exports before network access', async t => {
  let requests=0;const fetch=async()=>{requests++;throw new Error('must not fetch');};
  const cases=[file(t,'{"PRIVATE":"bad JSON"'),file(t,'x'.repeat(1024*1024+1)),file(t,JSON.stringify([cookie({expires:1})])),file(t,JSON.stringify([cookie({domain:'.other.test'})]))];
  cases.push(path.join(path.dirname(cases[0]),'missing'),path.dirname(cases[0]));
  for(const cookieFile of cases) await assert.rejects(api.extractText(root,{cookieFile,fetch,lookup:publicLookup}),api.FetcharyValidationError);
  for(const cookieFile of ['',true,42,{}]) await assert.rejects(api.extractText(root,{cookieFile,fetch}),api.FetcharyValidationError);
  await assert.rejects(api.extractText(root,{cookieFile:cases[0],headers:{cookie:'secret'},fetch}),api.FetcharyValidationError);
  const controller=new AbortController();controller.abort();
  await assert.rejects(api.extractText(root,{cookieFile:cases[0],signal:controller.signal,fetch}),api.FetcharyFetchError);assert.equal(requests,0);
});

test('authenticated favicon and analysis use scoped cookies without persisting sessions', async t => {
  const cookieFile=file(t,JSON.stringify([cookie()]));const seen=[];
  const fetch=async(target,options)=>{
    seen.push({target,headers:options.headers});
    if(target===root)return new Response('<title>Account</title><link rel="icon" href="/icon.svg"><img src="https://cdn.other.test/photo.svg"><a href="/about">About</a>',{headers:{'content-type':'text/html'}});
    if(target.endsWith('/icon.svg'))return new Response('<svg width="64" height="64"></svg>',{headers:{'content-type':'image/svg+xml'}});
    return new Response('',{status:404});
  };
  const result=await api.analyse(root,{mode:'http',cookieFile,lookup:publicLookup,fetch});
  assert.equal(result.summary.succeeded,11);assert.equal(seen.filter(request=>request.target===root).length,1);
  assert.equal(seen.find(request=>request.target.endsWith('/icon.svg')).headers.cookie,'session=test-session');
  assert.ok(!JSON.stringify(result).includes('test-session'));
  assert.equal(fs.readdirSync(path.dirname(cookieFile)).length,1);
});

test('browser authentication imports HttpOnly cookies, supports JS cookies and honors session updates without leaking to foreign resources', async () => {
  const jar=createCookieJar(parseCookieFile(JSON.stringify([cookie({name:'li_at'}),cookie({name:'JSESSIONID',value:'"ajax:test-csrf"',httpOnly:false})])),root);
  const seen=[];
  const cookieFileContents=JSON.stringify([cookie({name:'li_at'}),cookie({name:'JSESSIONID',value:'"ajax:test-csrf"',httpOnly:false}),cookie({name:'hostOnly',domain:'www.linkedin.test',hostOnly:true}),cookie({name:'voyagerOnly',path:'/voyager'})]);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fetchary-cookie-browser-'));const cookieFile=path.join(dir,'cookies.json');fs.writeFileSync(cookieFile,cookieFileContents,{mode:0o600});
  try {
    const html='<html><body><h1>Profile</h1><script>document.body.dataset.csrf=document.cookie.includes("JSESSIONID");document.body.dataset.httpOnlyHidden=!document.cookie.includes("li_at");document.cookie="runtime=updated; path=/; secure";fetch("/voyager/api");</script><img src="https://cdn.other.test/image.svg"><img src="https://sub.www.linkedin.test/image.svg"></body></html>';
    const result=await api.extractHtml(root,{cookieFile,mode:'browser',waitAfterLoad:100,lookup:publicLookup,fetch:async(target,options)=>{
      seen.push({target,headers:options.headers});
      if(target===root)return new Response(html,{headers:{'content-type':'text/html'}});
      return new Response('<svg width="1" height="1"></svg>',{headers:{'content-type':'image/svg+xml'}});
    }});
    assert.match(result.data,/data-csrf="true"/);assert.match(result.data,/data-http-only-hidden="true"/);
    const internal=seen.find(request=>request.target==='https://www.linkedin.test/voyager/api');assert.ok(internal);assert.match(internal.headers.cookie,/runtime=updated/);assert.match(internal.headers.cookie,/li_at=test-session/);assert.match(internal.headers.cookie,/voyagerOnly=test-session/);assert.match(internal.headers.cookie,/hostOnly=test-session/);
    const child=seen.find(request=>request.target==='https://sub.www.linkedin.test/image.svg');assert.ok(child);assert.ok(!child.headers.cookie.includes('hostOnly='));assert.ok(!child.headers.cookie.includes('voyagerOnly='));
    const foreign=seen.find(request=>request.target==='https://cdn.other.test/image.svg');assert.ok(foreign);assert.equal(foreign.headers.cookie,undefined);
    assert.equal(result.cache.ttlMs,0);assert.equal(fs.readFileSync(cookieFile,'utf8'),cookieFileContents);
    assert.equal(jar.header(root),'li_at=test-session; JSESSIONID="ajax:test-csrf"');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('browser cookie-import failures are sanitized and close custom browser resources', async t => {
  const cookieFile=file(t,JSON.stringify([cookie()]));let closes=0;let pageCloses=0;let contextCloses=0;
  await assert.rejects(api.extractText(root,{cookieFile,mode:'browser',lookup:publicLookup,fetch:async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}}),launchBrowser:async()=>({
    newPage:async()=>{throw new Error('default context must not be used');},createBrowserContext:async()=>({setCookie:async()=>{throw new Error('PROTOCOL secret test-session');},newPage:async()=>({close:async()=>{pageCloses++;}}),close:async()=>{contextCloses++;}}),close:async()=>{closes++;},
  })}),error=>error instanceof api.FetcharyBrowserError&&error.phase==='cookies'&&!error.message.includes('test-session')&&error.cause===undefined);
  assert.equal(closes,1);assert.equal(pageCloses,0);assert.equal(contextCloses,1);
});

test('CLI --cookies works for public result shapes and errors remain redacted', async t => {
  const cookieFile=file(t,JSON.stringify([cookie({domain:'.linkedin.com'})]));const target='https://www.linkedin.com/in/example';
  const options={mode:'http',lookup:publicLookup,fetch:async(url,settings)=>new Response(settings.headers.cookie?.includes('session=test-session')?'<h3 class="top-card-layout__first-subline">1234 followers</h3>':'<title>Sign in</title>',{headers:{'content-type':'text/html'}})};
  const result=await cli(['extract','social-insights',target,'--follower','--cookies',cookieFile],options);
  assert.equal(result.code,0,result.stderr);assert.equal(result.stdout,'1234\n');assert.equal(result.stderr,'');
  const json=await cli(['extract','social-insights',target,'--json','--cookies',cookieFile],options);assert.equal(JSON.parse(json.stdout).followers,1234);assert.ok(!json.stdout.includes('test-session'));
  assert.equal((await cli(['extract','text',target,'--cookies'],options)).code,2);
  fs.writeFileSync(cookieFile,'[{"secret":"test-session",]');
  const invalid=await cli(['extract','text',target,'--cookies',cookieFile,'--json'],options);assert.equal(invalid.code,2);assert.ok(!invalid.stderr.includes('test-session'));
});

test('native HTTP and spawned CLI send imported cookies to an authenticated local fixture', async t => {
  const cookieFile=file(t,JSON.stringify([cookie({domain:'127.0.0.1',hostOnly:true,secure:false})]));const seen=[];
  const server=http.createServer((request,response)=>{seen.push(request.headers.cookie);response.writeHead(200,{'content-type':'text/html'});response.end(request.headers.cookie==='session=test-session'?'<title>Signed in</title>':'<title>Anonymous</title>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const target=`http://127.0.0.1:${server.address().port}/`;
  const child=spawn(process.execPath,[path.join(__dirname,'../cli/index.js'),'extract','metadata',target,'--mode','http','--allow-private-network','--cookies',cookieFile]);
  let stdout='';let stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  assert.equal(await new Promise(resolve=>child.on('close',resolve)),0,stderr);assert.equal(JSON.parse(stdout).data.title,'Signed in');assert.deepEqual(seen,['session=test-session']);
});
