'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const http=require('node:http');
const {spawn}=require('node:child_process');
const zlib=require('node:zlib');
const {main}=require('../cli');
const api=require('../src');
const page='https://example.test/';
const profile='https://github.com/example';
const svg='<svg width="128" height="128"></svg>';
function settings() {
  return { allowPrivateNetwork:true, mode:'http', fetch:async url=>new Response(url.endsWith('.svg')?svg:url===profile?'<div class="h-card"><img class="avatar-user" src="/avatar.svg"></div><a href="/example?tab=followers">42 followers</a>':'<h1>Title</h1><p>Body</p><img src="/image.png"><link rel="icon" href="/icon.svg"><a href="https://youtube.com/@example">YouTube</a>',{headers:{'content-type':url.endsWith('.svg')?'image/svg+xml':url.endsWith('favicon.ico')?'text/plain':'text/html'}}) };
}
async function run(args,options=settings()) {
  let stdout='';let stderr='';
  const code=await main(args,{options,stdout:{write:value=>{stdout+=value;}},stderr:{write:value=>{stderr+=value;}}});
  return {code,stdout,stderr};
}

test('semantic CLI calls the same dispatcher as the library for every extraction type',async()=>{
  for(const type of ['text','html','favicon','images','selector','social-links','social-insights','avatar','emails','telephone','links','documents']) {
    const url=type==='avatar'||type==='social-insights'?profile:page;
    const extra=type==='selector'?['--selector','h1']:[];
    const options=settings();
    const library=await api.extract(url,{...options,type,selector:'h1'});
    const cli=await run(['extract',type,url,...extra,'--json'],options);
    assert.equal(cli.code,0,cli.stderr);assert.equal(cli.stderr,'');
    const json=JSON.parse(cli.stdout);
    assert.deepEqual(json.data,library.data,type);assert.equal(json.type,type);assert.equal(json.status,200);
    assert.equal(json.cache.hit,true);
  }
});

test('plain content/URLs stay clean; list and insight operations default to JSON',async()=>{
  assert.equal((await run(['extract','text',page])).stdout,'Title\nBody\nYouTube');
  assert.match((await run(['extract','html',page])).stdout,/^<h1>/);
  assert.equal((await run(['extract','favicon',page])).stdout,'https://example.test/icon.svg\n');
  assert.equal((await run(['extract','images',page,'--urls-only'])).stdout,'https://example.test/image.png\n');
  assert.equal((await run(['extract','social-links',page,'--youtube','--urls-only'])).stdout,'https://youtube.com/@example\n');
  for(const type of ['images','social-links','social-insights','emails','telephone','links','documents']) assert.equal(JSON.parse((await run(['extract',type,type==='social-insights'?profile:page])).stdout).type,type);
  assert.equal((await run(['extract','selector',page,'--selector','h1','--all','--format','html'])).stdout,'<h1>Title</h1>');
  assert.equal((await run(['extract','selector',page,'--selector','a','--attribute','href','--all'])).stdout,'https://youtube.com/@example');
  assert.equal((await run(['extract','text',page,'--quiet'])).stdout,'');
});

test('legacy standalone aliases keep working without monitoring commands or data options',async()=>{
  assert.equal((await run(['extract',page,'--text'])).stdout,'Title\nBody\nYouTube');
  assert.equal((await run(['favicon',page])).stdout,'https://example.test/icon.svg\n');
  assert.equal((await run(['profile-picture',profile])).stdout,'https://github.com/avatar.svg\n');
  const help=await run(['--help']);
  assert.equal(help.code,0);assert.match(help.stdout,/Extract what matters/);
  for(const command of ['add','list','fetch','history','diff','open','edit','enable','disable','remove','export','schedule','unschedule','schedules','run','status','follower','vendor','vendors']) {
    const result=await run([command]); assert.equal(result.code,2,command); assert.equal(result.stdout,'');
    assert.equal(new RegExp(`^  ${command}\\b`,'m').test(help.stdout),false);
  }
  assert.equal((await run(['extract','text',page,'--data-dir','/tmp/unused'])).code,2);
});

test('CLI validates options and input, keeps diagnostics on stderr and uses documented exit codes',async()=>{
  for(const args of [ ['extract','selector',page], ['extract','selector',page,'--selector','['], ['extract','text',page,'--timeout','-1'], ['extract','text',page,'--mode','invalid'], ['extract','images',page,'--platform','youtube'], ['extract','social-links',page,'--youtube','--platform','x'], ['extract','text',page,'--timeout'], ['extract','text',page,'--json=false'] ]) assert.equal((await run(args)).code,2,args.join(' '));
  const invalid=await run(['extract','text',page,'--json','--bad']);
  assert.equal(invalid.code,2);assert.equal(JSON.parse(invalid.stderr).error,'FetcharyValidationError');
  const failed=await run(['extract','text',page,'--json'],{...settings(),fetch:async()=>new Response('error',{status:503})});
  assert.equal(failed.code,3);assert.equal(failed.stdout,'');assert.equal(JSON.parse(failed.stderr).error,'FetcharyFetchError');
  const missing=await run(['extract','favicon',page,'--mode','http'],{...settings(),fetch:async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}})});
  assert.equal(missing.code,5);
  const browser=await run(['extract','text',page,'--mode','browser'],{...settings(),launchBrowser:async()=>{throw new Error('no browser');}});
  assert.equal(browser.code,4);
  const verbose=await run(['extract','text',page,'--json','--verbose']);
  assert.match(verbose.stderr,/Extracting text/);assert.equal(JSON.parse(verbose.stdout).data,'Title\nBody\nYouTube');
  assert.equal((await run(['--version'])).stdout,'2.0.0\n');
});

test('favicon binary CLI writes Buffers for both command forms and isolates diagnostics',async()=>{
  const body=Buffer.from(svg);
  for(const args of [['extract','favicon',page,'--binary'],['favicon',page,'--binary']]) {
    const chunks=[];let stderr='';
    const code=await main([...args,'--verbose'],{options:settings(),stdout:{write:value=>chunks.push(value)},stderr:{write:value=>{stderr+=value;}}});
    assert.equal(code,0,stderr);
    assert.equal(chunks.length,1);
    assert.ok(Buffer.isBuffer(chunks[0]));
    assert.deepEqual(chunks[0],body);
    assert.match(stderr,/^Extracting favicon \(http\)\n$/);
    assert.equal((await run([...args,'--quiet'])).stdout,'');
  }
  let requests=0;
  const options={...settings(),fetch:async()=>{requests++;throw new Error('must not fetch');}};
  for(const args of [['extract','favicon',page,'--binary','--json'],['favicon',page,'--json','--binary'],['extract','images',page,'--binary'],['extract','text',page,'--binary'],['profile-picture',profile,'--binary'],['favicon',page,'--binary=true']]) {
    const result=await run(args,options);
    assert.equal(result.code,2,args.join(' '));
    assert.equal(result.stdout,'');
    assert.match(result.stderr,/binary/);
  }
  assert.equal(requests,0);
  const missing=await run(['favicon',page,'--binary'],{...settings(),fetch:async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}})});
  assert.equal(missing.code,5);assert.equal(missing.stdout,'');assert.match(missing.stderr,/no accessible favicon/);
});

test('real favicon CLI preserves binary PNG bytes through redirects and HTTP decompression',async t=>{
  const body=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
  const compressed=zlib.gzipSync(body);
  let imageRequests=0;
  const server=http.createServer((request,response)=>{
    if(request.url==='/icon') {response.writeHead(302,{location:'/image.png'});response.end();}
    else if(request.url==='/image.png') {imageRequests++;response.writeHead(200,{'content-type':'image/png','content-encoding':'gzip','content-length':compressed.length});response.end(compressed);}
    else if(request.url==='/favicon.ico') {response.writeHead(404);response.end();}
    else {response.writeHead(200,{'content-type':'text/html'});response.end('<link rel="icon" href="/icon">');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const child=spawn(process.execPath,[path.resolve(__dirname,'../cli/index.js'),'extract','favicon',`http://127.0.0.1:${server.address().port}/`,'--mode','http','--allow-private-network','--binary','--verbose']);
  t.after(()=>{if(child.exitCode===null) child.kill();});
  const stdout=[];const stderr=[];
  child.stdout.on('data',chunk=>stdout.push(chunk));child.stderr.on('data',chunk=>stderr.push(chunk));
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(code,0,Buffer.concat(stderr).toString());
  assert.deepEqual(Buffer.concat(stdout),body);
  assert.equal(imageRequests,1);
  assert.equal(Buffer.concat(stderr).toString(),'Extracting favicon (http)\n');
});

test('--list and --urls-only give one URL/value per line for every extraction type',async()=>{
  const cases=[
    ['text',page,[],'https://youtube.com/@example\n'],
    ['html',page,[],'https://youtube.com/@example\n'],
    ['favicon',page,[],'https://example.test/icon.svg\n'],
    ['images',page,[],'https://example.test/image.png\n'],
    ['avatar',profile,[],'https://github.com/avatar.svg\n'],
    ['selector',page,['--selector','h1'],'Title\n'],
    ['social-links',page,[],'https://youtube.com/@example\n'],
    ['social-insights',profile,[],`${profile}\n`],
    ['emails',page,[],''],
    ['telephone',page,[],''],
    ['links',page,[],'https://example.test/icon.svg\nhttps://youtube.com/@example\n'],
    ['documents',page,[],''],
  ];
  for(const [type,url,extra,expected] of cases) {
    for(const flag of ['--list','--urls-only']) {
      const result=await run(['extract',type,url,...extra,flag]);
      assert.equal(result.code,0,`${type}: ${result.stderr}`);
      assert.equal(result.stdout,expected,`${type} ${flag}`);
      assert.equal(result.stderr,'');
    }
  }
  assert.equal((await run(['favicon',page,'--list'])).stdout,'https://example.test/icon.svg\n');
  assert.equal((await run(['profile-picture',profile,'--list'])).stdout,'https://github.com/avatar.svg\n');
  assert.equal((await run(['extract',page,'--list'])).stdout,'https://youtube.com/@example\n');
  assert.equal((await run(['extract',page,'--text','--list'])).stdout,'https://youtube.com/@example\n');
});

test('--list prints the supplied TikTok video links exactly and only requests the source page',async()=>{
  const profile='https://www.tiktok.com/@oliverjessner';
  const first='https://www.tiktok.com/@oliverjessner/video/7494649516273011990';
  const second='https://www.tiktok.com/@oliverjessner/video/7434164989176466720';
  let requests=0;
  const options={...settings(),fetch:async target=>{
    assert.equal(target,profile);requests++;
    return new Response(`<a href="/@oliverjessner/video/7494649516273011990">First</a><a href="${second}">Second</a><a href="${first}">Duplicate</a><a href="https://youtube.com/@example">Other platform</a>`,{headers:{'content-type':'text/html'}});
  }};
  const result=await run(['extract','social-links',profile,'--platform','tiktok','--list','--verbose'],options);
  assert.equal(result.code,0,result.stderr);assert.equal(result.stdout,`${first}\n${second}\n`);
  assert.equal(result.stderr,'Extracting social-links (http)\n');assert.equal(requests,1);
});

test('text/HTML lists resolve and deduplicate safe links, respecting document base and content filters',async()=>{
  const html='<base href="https://assets.example.test/content/"><nav><a href="/nav">Navigation</a></nav><main><a href="first?a=1&amp;b=2#part">First</a><area href="//other.test/second"><a href="first?a=1&amp;b=2#part">Duplicate</a><a href="mailto:user@example.com">Email</a><a href="javascript:alert(1)">JS</a><a href="https://user:secret@example.test/">Credentials</a><aside><a href="/ignored">Ignore</a></aside></main>';
  const options={...settings(),fetch:async()=>new Response(html,{headers:{'content-type':'text/html'}})};
  for(const type of ['text','html']) {
    const result=await run(['extract',type,page,'--list','--include-selector','main','--ignore-selector','aside'],options);
    assert.equal(result.code,0,result.stderr);
    assert.equal(result.stdout,'https://assets.example.test/content/first?a=1&b=2#part\nhttps://other.test/second\n');
  }
  for(const type of ['text','html']) {
    const plain=await run(['extract',type,page,'--list'],{...settings(),fetch:async()=>new Response('https://one.test/a\nhttps://two.test/b?q=1#p\nhttps://one.test/a',{headers:{'content-type':'text/plain'}})});
    assert.equal(plain.code,0,plain.stderr);assert.equal(plain.stdout,'https://one.test/a\nhttps://two.test/b?q=1#p\n');
  }
});

test('selector lists include all values, omit null/empty values and keep one item per line',async()=>{
  const options={...settings(),fetch:async()=>new Response('<p>First<br>line</p><p>Second</p><p></p><a href="/one">One</a><a>Missing</a><a href="/two">Two</a>',{headers:{'content-type':'text/html'}})};
  const text=await run(['extract','selector',page,'--selector','p','--list'],options);
  assert.equal(text.code,0,text.stderr);assert.equal(text.stdout,'First line\nSecond\n');
  const attributes=await run(['extract','selector',page,'--selector','a','--attribute','href','--list'],options);
  assert.equal(attributes.code,0,attributes.stderr);assert.equal(attributes.stdout,'/one\n/two\n');
  const standard=await run(['extract','selector',page,'--selector','p'],options);
  assert.equal(standard.stdout,'First\nline');
});

test('list output preserves image duplicates on request and emits nothing for empty matches or quiet',async()=>{
  const options={...settings(),fetch:async()=>new Response('<img src="/same.png"><img src="/same.png">',{headers:{'content-type':'text/html'}})};
  assert.equal((await run(['extract','images',page,'--list'],options)).stdout,'https://example.test/same.png\n');
  assert.equal((await run(['extract','images',page,'--list','--duplicates'],options)).stdout,'https://example.test/same.png\nhttps://example.test/same.png\n');
  for(const type of ['text','html','images','social-links','selector','emails','telephone','links','documents']) {
    const extra=type==='selector'?['--selector','missing']:[];
    const result=await run(['extract',type,page,'--list',...extra],{...settings(),fetch:async()=>new Response('<p>No links</p>',{headers:{'content-type':'text/html'}})});
    assert.equal(result.code,0,result.stderr);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
  }
  const quiet=await run(['extract','images',page,'--list','--quiet','--verbose']);
  assert.equal(quiet.code,0);assert.equal(quiet.stdout,'');assert.equal(quiet.stderr,'');
});

test('JSON takes precedence over lists; binary conflicts and invalid list flags fail before requests',async()=>{
  for(const type of ['text','html','favicon','images','social-links','selector','social-insights','avatar','emails','telephone','links','documents']) {
    const url=['avatar','social-insights'].includes(type)?profile:page;
    const extra=type==='selector'?['--selector','a']:[];
    const standard=JSON.parse((await run(['extract',type,url,'--json',...extra])).stdout);
    for(const flag of ['--list','--urls-only']) {
      const result=await run(['extract',type,url,flag,'--json',...extra]);
      assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).type,type);
      assert.deepEqual(JSON.parse(result.stdout).data,standard.data);
    }
  }
  let requests=0;
  const options={...settings(),fetch:async()=>{requests++;throw new Error('must not fetch');}};
  for(const args of [['favicon',page,'--binary','--list'],['favicon',page,'--binary','--urls-only'],['extract','text',page,'--list=true'],['extract','html',page,'--list','--include-selector','['],['extract','selector',page,'--list','--selector','[']]) {
    const result=await run(args,options);assert.equal(result.code,2,args.join(' '));assert.equal(result.stdout,'');
  }
  assert.equal(requests,0);
  const failed=await run(['extract','images',page,'--list'],{...settings(),fetch:async()=>new Response('error',{status:503})});
  assert.equal(failed.code,3);assert.equal(failed.stdout,'');assert.match(failed.stderr,/Error:/);
});
