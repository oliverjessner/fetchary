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
  for(const type of ['text','html','favicon','images','selector','social-links','social-insights','avatar']) {
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
  for(const type of ['images','social-links','social-insights']) assert.equal(JSON.parse((await run(['extract',type,type==='social-insights'?profile:page])).stdout).type,type);
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
