'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {main}=require('../cli');
const api=require('../src');
const url='https://example.test/product';
const html='<script type="application/ld+json">{"@type":"Product","name":"Example Product","offers":{"@type":"Offer","price":"99.90","priceCurrency":"EUR"}}</script><main id="product"><h1>Example Product</h1><span class="current-price">89,90 €</span></main>';
const settings=()=>({mode:'http',allowPrivateNetwork:true,fetch:async()=>new Response(html,{headers:{'content-type':'text/html'}})});
async function cli(flags=[],options=settings(),extra={}) {
  let stdout='';let stderr='';const code=await main(['extract','price',url,...flags],{options,stdout:{write:value=>stdout+=value},stderr:{write:value=>stderr+=value},...extra});
  return {code,stdout,stderr};
}

test('CLI default and --json serialize the complete library conflict with successful exit',async()=>{
  const options=settings();const library=await api.extractPrice(url,options);
  for(const flags of [[],['--json'],['--json','--list']]) {
    const result=await cli(flags,options);assert.equal(result.code,0);assert.equal(result.stderr,'');
    const parsed=JSON.parse(result.stdout);assert.deepEqual(parsed.data,library.data);assert.equal(parsed.type,'price');assert.equal(parsed.cache.hit,true);
    assert.equal(parsed.data.selected,null);assert.equal(parsed.data.candidates.length,2);
  }
});
test('CLI list prints one tab-separated row per candidate with complete JSON evidence',async()=>{
  const result=await cli(['--list','--verbose']);assert.equal(result.code,0);assert.equal(result.stderr,'Extracting price (http)\n');
  const rows=result.stdout.trim().split('\n').map(row=>row.split('\t'));assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>row.slice(0,3)),[['99.90','EUR','current'],['89.90','EUR','current']]);
  for(const row of rows){assert.equal(row.length,4);assert.ok(JSON.parse(row[3])[0].locator);}
  assert.equal((await cli(['--urls-only'])).stdout.replace(/"capturedAt":"[^"]+"/g,''),result.stdout.replace(/"capturedAt":"[^"]+"/g,''));
});
test('CLI selectors and common flags work, invalid price-specific options use exit 2',async()=>{
  const result=await cli(['--product-selector','#product','--price-selector','.current-price','--mode','http','--no-history']);assert.equal(result.code,0);assert.equal(JSON.parse(result.stdout).data.status,'conflict');
  for(const flags of [['--price-selector','['],['--product-selector',''],['--price-selector'],['--price-selector='],['--binary'],['--all'],['--nonsense']]) assert.equal((await cli(flags)).code,2,flags.join(' '));
  for(const type of ['text','analyse']) {
    let stderr='';const args=type==='analyse'?['analyse',url]:['extract',type,url];
    assert.equal(await main([...args,'--price-selector','.price'],{options:settings(),stdout:{write:()=>{}},stderr:{write:value=>stderr+=value}}),2);assert.match(stderr,/not supported/);
  }
  assert.equal((await cli(['--quiet','--verbose'])).stdout,'');assert.equal((await cli(['--quiet','--verbose'])).stderr,'');
  assert.equal((await cli(['--price-selector','.absent'])).code,0);
  const help=await cli(['--help']);assert.match(help.stdout,/price\s+Product prices/);assert.match(help.stdout,/--product-selector/);assert.match(help.stdout,/--price-selector/);
});
test('filepath saves full JSON by default, supports automatic extension and quiet output',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fetchary-price-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const result=await cli(['--filepath',path.join(root,'price.json')]);assert.equal(result.code,0);
  assert.equal(await fs.readFile(path.join(root,'price.json'),'utf8'),result.stdout);
  const quiet=await cli(['--filepath',path.join(root,'directory')+path.sep,'--quiet']);assert.equal(quiet.code,0);assert.equal(quiet.stdout,'');
  const [filename]=await fs.readdir(path.join(root,'directory'));assert.match(filename,/\.json$/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'directory',filename),'utf8')).data.status,'conflict');
});
test('spawned native CLI and library retain equivalent conflict payloads',async t=>{
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const target=`http://127.0.0.1:${server.address().port}/product`;
  const child=spawn(process.execPath,[path.join(__dirname,'../cli/index.js'),'extract','price',target,'--mode','http','--allow-private-network','--json','--no-history']);
  let stdout='';let stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  assert.equal(await new Promise(resolve=>child.on('close',resolve)),0,stderr);assert.equal(stderr,'');
  const library=await api.extractPrice(target,{mode:'http',allowPrivateNetwork:true});
  const strip=value=>JSON.parse(JSON.stringify(value,(key,value)=>key==='capturedAt'?undefined:value));
  assert.deepEqual(strip(JSON.parse(stdout).data),strip(library.data));
});
test('public declarations include price in all typed API entry points and analysis',async()=>{
  const declarations=await fs.readFile(path.join(__dirname,'../src/index.d.ts'),'utf8');
  for(const value of ['export type PriceOptions','export type PriceCandidate','export type PriceEvidence','export type PriceResult','export declare function extractPrice','extractPrice: typeof extractPrice','price: PriceResult','price: PriceOptions'])assert.ok(declarations.includes(value),value);
  assert.match(declarations,/export type AnalysisType = [^;]*'price'/);
});
