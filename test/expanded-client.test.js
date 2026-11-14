'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const api = require('../src');
const html = '<p>'+'x'.repeat(180)+'</p>';

test('domain settings prefer exact hosts over wildcards and per-call options over both', async () => {
  const client=api.createExtractor({mode:'http',allowPrivateNetwork:true,maxResponseBytes:64,
    domainOptions:{'*.example.test':{maxResponseBytes:128},'large.example.test':{maxResponseBytes:256}},
    fetch:async()=>new Response(html,{headers:{'content-type':'text/html'}})});
  assert.equal((await client.extractText('https://large.example.test/')).content,'x'.repeat(180));
  await assert.rejects(client.extractText('https://small.example.test/'),api.FetcharyFetchError);
  assert.equal((await client.extractText('https://small.example.test/',{maxResponseBytes:256})).content,'x'.repeat(180));
  await assert.rejects(client.extractText('https://unrelated.test/'),api.FetcharyFetchError);
  await assert.rejects(client.extractText('https://large.example.test/',{maxResponseBytes:64}),api.FetcharyFetchError);
});

test('configure snapshots headers and domain rules and rejects invalid updates atomically', async () => {
  const observed=[];
  const client=api.createExtractor({mode:'http',allowPrivateNetwork:true,fetch:async(_url,settings)=>{
    observed.push(new Headers(settings.headers).get('x-config'));
    return new Response(html,{headers:{'content-type':'text/html'}});
  }});
  const headers=new Headers({'x-config':'original'});
  const rules={'large.example.test':{maxResponseBytes:256}};
  client.configure({headers,domainOptions:rules});
  headers.set('x-config','mutated');rules['large.example.test'].maxResponseBytes=1;
  assert.throws(()=>client.configure({headers:{'x-config':'invalid-update'},domainOptions:{'large.example.test':{maxResponseBytes:0}}}),api.FetcharyValidationError);
  assert.equal((await client.extractText('https://large.example.test/')).content,'x'.repeat(180));
  assert.deepEqual(observed,['original']);
});

test('cache statistics distinguish hits, shared work, bypasses, failures and clearing', async () => {
  let started;let release;
  const requestStarted=new Promise(resolve=>{started=resolve;});
  const held=new Promise(resolve=>{release=resolve;});
  let requests=0;
  const client=api.createExtractor({mode:'http',allowPrivateNetwork:true,fetch:async url=>{
    requests++;
    if(url.endsWith('/failure'))throw new Error('fixture failure');
    if(requests===1){started();await held;}
    return new Response('<p>Hello</p>',{headers:{'content-type':'text/html'}});
  }});
  const first=client.extractText('https://cache.example.test/');
  await requestStarted;
  const second=client.extractHtml('https://cache.example.test/');
  await new Promise(resolve=>setImmediate(resolve));
  release();await Promise.all([first,second]);
  await client.extractText('https://cache.example.test/');
  const cached=client.getCacheStats();
  assert.equal(cached.loads,1);assert.equal(cached.deduplicated,1);assert.equal(cached.hits,1);
  assert.equal(cached.entries,1);assert.equal(cached.pending,0);assert.ok(cached.bytes>0);
  const misses=cached.misses;
  await client.extractText('https://cache.example.test/',{cacheTtlMs:0});
  assert.equal(client.getCacheStats().bypasses,1);assert.equal(client.getCacheStats().misses,misses);
  await assert.rejects(client.extractText('https://cache.example.test/failure'),api.FetcharyFetchError);
  const beforeClear=client.getCacheStats();assert.equal(beforeClear.failures,1);
  client.clearCache();const cleared=client.getCacheStats();
  assert.equal(cleared.entries,0);assert.equal(cleared.bytes,0);assert.equal(cleared.loads,beforeClear.loads);assert.equal(cleared.hits,beforeClear.hits);
  cleared.loads=999;assert.notEqual(client.getCacheStats().loads,999);
});

test('cache statistics report eviction under configured capacities', async () => {
  const client=api.createExtractor({mode:'http',allowPrivateNetwork:true,maxEntries:1,maxCacheBytes:4096,
    fetch:async()=>new Response('<p>Hello</p>',{headers:{'content-type':'text/html'}})});
  await client.extractText('https://cache.example.test/one');await client.extractText('https://cache.example.test/two');
  const stats=client.getCacheStats();
  assert.equal(stats.evictions,1);assert.equal(stats.entries,1);assert.equal(stats.maxEntries,1);assert.equal(stats.maxCacheBytes,4096);
});

test('blocked resource types reject malformed configuration before extraction', () => {
  for(const blockedResourceTypes of ['image',[1],['imaginary'],null])assert.throws(()=>api.createExtractor({blockedResourceTypes}),api.FetcharyValidationError);
  assert.doesNotThrow(()=>api.createExtractor({blockedResourceTypes:['font','media']}));
});

test('browser resource filters prevent image requests and remain isolated in the capture cache', async () => {
  const requests=[];
  const client=api.createExtractor({mode:'browser',allowPrivateNetwork:true,waitAfterLoad:0,timeout:15000,
    blockedResourceTypes:['image'],fetch:async target=>{
      requests.push(target);
      return new Response(target.endsWith('/image.svg') ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>' : '<html><body><p>Readable</p><img src="/image.svg"></body></html>',
        {headers:{'content-type':target.endsWith('/image.svg')?'image/svg+xml':'text/html'}});
    }});
  const blocked=await client.extractHtml('https://assets.example.test/');
  assert.match(blocked.content,/Readable/);
  assert.ok(!requests.some(target=>target.endsWith('/image.svg')));
  client.configure({blockedResourceTypes:[]});
  const allowed=await client.extractHtml('https://assets.example.test/');
  assert.equal(allowed.cache.hit,false);
  assert.ok(requests.some(target=>target.endsWith('/image.svg')));
});
