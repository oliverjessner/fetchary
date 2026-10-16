'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const api = require('../src');
const { main } = require('../cli');
const target = 'https://www.youtube.com/@example';
const scriptUrl = 'https://www.youtube.com/channel.js?token=must-not-leak';
const script = '/*' + 'x'.repeat(1600) + '*/document.body.insertAdjacentHTML("beforeend", \'<ytd-c4-tabbed-header-renderer><span id="subscriber-count">1.93K subscribers</span></ytd-c4-tabbed-header-renderer>\');';
const html = `<html><body><script src="${scriptUrl}"></script></body></html>`;
function settings() {
  return { mode:'browser', waitAfterLoad:0, timeout:5000, lookup:async()=>[{address:'93.184.216.34',family:4}], fetch:async url=>new Response(url===target?html:script, {
    headers:{'content-type':url===target?'text/html':'application/javascript','content-length':String(Buffer.byteLength(url===target?html:script))},
  }) };
}
async function cli(flags, options, mode = 'browser') {
  let stdout='';let stderr='';
  const code=await main(['extract','social-insights',target,'--follower',...(mode ? ['--mode',mode] : []),...flags],{options,stdout:{write:value=>stdout+=value},stderr:{write:value=>stderr+=value}});
  return {code,stdout,stderr};
}

test('oversized browser scripts report a resource failure with the limit and recovery option', async () => {
  const options=settings();
  await assert.rejects(api.extractSocialInsights(target,{...options,maxResponseBytes:1024}),error=>{
    assert.ok(error instanceof api.FetcharyBrowserError);assert.equal(error.phase,'resource');
    assert.match(error.message,/browser resource.*maxResponseBytes \(1024 bytes\)/);
    assert.match(error.message,/--max-response-bytes/);assert.ok(!error.message.includes('must-not-leak'));
    assert.equal(error.cause.name,'FetcharyFetchError');assert.match(error.cause.cause.message,/response exceeds maxResponseBytes/);return true;
  });
  const result=await api.extractSocialInsights(target,{...options,maxResponseBytes:4096});
  assert.equal(result.followers,1930);assert.equal(result.captureMode,'browser');assert.equal(result.data.sources.subscribers.approximate,true);
});

test('CLI surfaces the bounded browser-resource cause, keeps stdout empty and accepts a larger explicit limit', async () => {
  const options=settings();
  const failed=await cli(['--max-response-bytes','1024'],options);
  assert.equal(failed.code,4);assert.equal(failed.stdout,'');assert.match(failed.stderr,/maxResponseBytes \(1024 bytes\)/);assert.ok(!failed.stderr.includes('must-not-leak'));
  const json=await cli(['--max-response-bytes','1024','--json'],options);
  assert.equal(json.code,4);assert.equal(JSON.parse(json.stderr).error,'FetcharyBrowserError');assert.match(JSON.parse(json.stderr).message,/--max-response-bytes/);
  const passed=await cli(['--max-response-bytes','4096'],options);assert.equal(passed.code,0,passed.stderr);assert.equal(passed.stdout,'1930\n');assert.equal(passed.stderr,'');
});


test('the default auto capture supports bundles above 10 MiB while explicit limits and the 20 MiB bound remain enforced', async () => {
  const largeScript = '/*' + 'x'.repeat(12 * 1024 * 1024) + '*/' + script;
  const options = settings();
  delete options.mode;
  options.fetch = async url => new Response(url === target ? html : largeScript, {
    headers: { 'content-type': url === target ? 'text/html' : 'application/javascript',
      'content-length': String(Buffer.byteLength(url === target ? html : largeScript)) },
  });
  // The user's normal command: no --mode and no --max-response-bytes override.
  const result = await cli([], options, null);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, '1930\n'); assert.equal(result.stderr, '');
  await assert.rejects(api.extractSocialInsights(target, { ...options, maxResponseBytes: 10 * 1024 * 1024 }), error =>
    error instanceof api.FetcharyBrowserError && /maxResponseBytes \(10485760 bytes\)/.test(error.message));
  await assert.rejects(api.extractHtml(target, { ...options, mode: 'http', fetch: async () => new Response('<p>Oversized</p>', {
    headers: { 'content-length': String(20 * 1024 * 1024 + 1), 'content-type': 'text/html' },
  }) }), error => error instanceof api.FetcharyFetchError && /maxResponseBytes/.test(error.message));
});
