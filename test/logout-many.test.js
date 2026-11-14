'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const api=require('../src');
function sessions(t,entries){
  const sessionDir=fs.mkdtempSync(path.join(os.tmpdir(),'fetchary-logout-many-'));
  fs.chmodSync(sessionDir,0o700);
  t.after(()=>fs.rmSync(sessionDir,{recursive:true,force:true}));
  for(const [name,origin] of Object.entries(entries))fs.writeFileSync(path.join(sessionDir,`${name}.json`),JSON.stringify({version:1,origin,savedAt:'2026-11-15T12:00:00Z',cookies:[]}),{mode:0o600});
  return {sessionDir,exists:name=>fs.existsSync(path.join(sessionDir,`${name}.json`))};
}

test('logout removes only explicitly selected sessions and retains the existing single-session result',async t=>{
  const site=sessions(t,{one:'https://example.test',two:'https://example.test',kept:'https://other.test'});
  const result=await api.logout(['one','two'],{sessionDir:site.sessionDir});
  assert.equal(result.removed,2);assert.equal(result.failed,0);
  assert.deepEqual(result.sessions,[{session:'one',removed:true},{session:'two',removed:true}]);
  assert.ok(!site.exists('one'));assert.ok(!site.exists('two'));assert.ok(site.exists('kept'));
  assert.deepEqual(await api.logout('kept',{sessionDir:site.sessionDir}),{session:'kept',removed:true});
  assert.deepEqual(await api.logout('kept',{sessionDir:site.sessionDir}),{session:'kept',removed:false});
});

test('logout prevalidates every selected name before deleting any session',async t=>{
  const site=sessions(t,{one:'https://example.test',two:'https://example.test'});
  await assert.rejects(api.logout(['one','INVALID'],{sessionDir:site.sessionDir}),api.FetcharyValidationError);
  await assert.rejects(api.logout(['one', ,],{sessionDir:site.sessionDir}),api.FetcharyValidationError);
  assert.ok(site.exists('one'));assert.ok(site.exists('two'));
});

test('logout domain selection normalizes hostnames but excludes subdomains and other hosts',async t=>{
  const site=sessions(t,{exact:'https://example.test',sub:'https://sub.example.test',other:'https://example.net'});
  const result=await api.logout({domain:'EXAMPLE.TEST'},{sessionDir:site.sessionDir});
  assert.equal(result.removed,1);assert.equal(result.failed,0);assert.deepEqual(result.sessions,[{session:'exact',removed:true}]);
  assert.ok(!site.exists('exact'));assert.ok(site.exists('sub'));assert.ok(site.exists('other'));
});
