'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parseHTML } = require('linkedom');
const api = require('../src');
const { extractPrices } = require('../src/extract/price');
const { resolvePrices } = require('../src/extract/price/resolve');
const url = 'https://example.test/product';
const ld = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const product = (price = '99.90',extra = {}) => ({ '@context':'https://schema.org','@type':'Product',name:'Example Product',offers:{ '@type':'Offer',price,priceCurrency:'EUR' },...extra });
const dom = (price = '89,90 €') => `<main><h1>Example Product</h1><span class="current-price">${price}</span></main>`;
const settings = (html,extra = {}) => ({ mode:'http',allowPrivateNetwork:true,fetch:async () => new Response(html,{ headers:{'content-type':'text/html'} }),...extra });
const data = async (html,options) => (await api.extractPrice(url,settings(html,options))).data;

test('JSON-LD-only, DOM-only and missing prices have explicit resolution states', async () => {
  for (const html of [ld(product()),dom('99.90 EUR')]) {
    const result = await data(html);assert.equal(result.status,'single_source');assert.equal(result.selected.amount,'99.90');
  }
  const empty = await data('<main><h1>Example Product</h1><p>100 reviews, 2026 edition</p></main>');
  assert.equal(empty.status,'unavailable');assert.equal(empty.selected,null);assert.deepEqual(empty.candidates,[]);
});

for (const price of ['89,90 €','109,90 €']) test(`disagreement in either direction (${price}) preserves exact evidence through serialization`, async () => {
  const html = ld(product())+dom(price);const result = JSON.parse(JSON.stringify(await api.extractPrice(url,settings(html))));
  assert.equal(result.type,'price');assert.equal(result.data.status,'conflict');assert.equal(result.data.selected,null);
  assert.deepEqual(result.data.candidates.map(candidate => candidate.raw),['99.90',price]);
  assert.equal(result.data.candidates[0].evidence[0].locator,'$.offers.price');assert.equal(result.data.candidates[0].evidence[0].scriptIndex,0);
  const { document } = parseHTML(html);
  assert.equal(document.querySelector(result.data.candidates[1].evidence[0].locator).textContent,price);
  for (const candidate of result.data.candidates) for (const evidence of candidate.evidence) {
    assert.equal(evidence.document,'raw');assert.equal(evidence.url,url);assert.equal(evidence.capturedAt,result.capturedAt);assert.equal(evidence.captureMode,'http');
  }
  for (const name of ['requestedUrl','finalUrl','rawFinalUrl','capturedAt','extractedAt','captureMode','cache']) assert.ok(result[name]);
  assert.ok(result.data.issues.some(issue => issue.code === 'PRICE_MISMATCH'));
});

test('matching JSON-LD and DOM merge values while retaining all raw values and locations', async () => {
  const result = await data(ld(product('89.90'))+dom()+ '<span class="current-price">89.90 EUR</span>');
  assert.equal(result.status,'consistent');assert.equal(result.candidates.length,1);assert.equal(result.selected.evidence.length,3);
  assert.deepEqual(result.selected.evidence.map(entry => entry.raw),['89.90','89,90 €','89.90 EUR']);
});

test('fragmented price markup retains currency without collecting unrelated delivery amounts', async () => {
  for (const value of ['<span class="price"><span>€</span><b>89.90</b></span>',
    '<span class="price"><span class="currency">EUR</span><span class="amount">89.90</span></span>']) {
    const result=await data('<main><h1>Example Product</h1>'+value+'<span class="shipping-price">5 EUR</span><div id="recommendation-list"><b>1 EUR</b></div></main>');
    assert.equal(result.status,'single_source');assert.equal(result.selected.currency,'EUR');assert.equal(result.selected.amount,'89.90');assert.equal(result.candidates.length,1);
  }
});

test('malformed JSON-LD does not prevent usable DOM extraction; script indexes include malformed blocks', async () => {
  const result = await data('<script type="application/ld+json">{bad}</script>'+ld(product())+dom());
  assert.equal(result.status,'conflict');assert.equal(result.candidates[0].evidence[0].scriptIndex,1);
  assert.ok(result.issues.some(issue => issue.code === 'INVALID_JSON_LD'));
});

test('nested graphs, ID-referenced offers, type arrays and URL-form properties retain exact paths', async () => {
  const graph = {'@graph':[
    {'@type':'Organization',price:'1'},
    {'@type':['Thing','https://schema.org/Product'],name:'Example Product',offers:{'@id':'#offer'}},
    {'@type':'Offer','@id':'#offer','https://schema.org/price':'99.90','https://schema.org/priceCurrency':'EUR'},
    product('1',{url:'https://other.test/recommendation',name:'Other Product'}),
  ]};
  const result = await data(ld(graph)+dom());assert.equal(result.status,'conflict');assert.equal(result.candidates.length,2);
  assert.equal(result.candidates[0].evidence[0].locator,'$["@graph"][2]["https://schema.org/price"]');
});

test('multiple blocks and nested arrays keep correct origins, and numeric JSON tokens retain exact digits', async () => {
  const result = await data(ld({ '@type':'Organization' })+ld([{ box:[product()] }])+dom());
  assert.equal(result.status,'conflict');assert.equal(result.candidates[0].evidence[0].scriptIndex,1);
  assert.equal(result.candidates[0].evidence[0].locator,'$[0].box[0].offers.price');
  const precise = await data('<script type="application/ld+json">{"@type":"Offer","price":99999999999999999999.99,"priceCurrency":"EUR"}</script>');
  assert.equal(precise.selected.amount,'99999999999999999999.99');
});

test('recommendations, unrelated products, hidden elements and incidental numbers are excluded', async () => {
  const result = await data(ld([product(),product('1',{name:'Other',url:'/other'})])+dom()+`
    <aside><span class="price">1 EUR</span></aside><nav><span class="price">2 EUR</span></nav>
    <div class="recommendations"><span class="price">3 EUR</span></div><div hidden><span class="price">4 EUR</span></div>
    <span class="price" style="display:none">5 EUR</span><template><span class="price">6 EUR</span></template>
    <p>SKU 12345; page 2; 100 reviews</p>`);
  assert.equal(result.status,'conflict');assert.deepEqual(result.candidates.map(candidate => candidate.amount),['99.90','89.90']);
  const unrelated = await data(ld(product('1',{name:'Other',url:'/other'}))+dom());
  assert.notEqual(unrelated.status,'conflict');assert.equal(unrelated.selected,null);
});

test('listing pages and product variants remain ambiguous without fabricated conflicts or a selection', async () => {
  for (const html of [
    ld([product('10',{name:'First'}),product('20',{name:'Second'})]),
    ld([product('10',{sku:'red'}),product('20',{sku:'blue'})])+dom(),
    '<div class="product-card" data-sku="A"><span class="price">10 EUR</span></div><div class="product-card" data-sku="B"><span class="price">20 EUR</span></div>',
  ]) { const result = await data(html);assert.equal(result.status,'ambiguous');assert.equal(result.selected,null); }
});

test('explicit product IDs and offer SKUs separate otherwise identical product variants', async () => {
  for (const value of [
    [product('10',{'@id':'#red'}),product('20',{'@id':'#blue'})],
    product(null,{offers:[{'@type':'Offer',price:'10',priceCurrency:'EUR',sku:'red'},{'@type':'Offer',price:'20',priceCurrency:'EUR',sku:'blue'}]}),
    [{'@type':'Offer',price:'10',priceCurrency:'EUR'},{'@type':'Offer',price:'20',priceCurrency:'EUR'}],
  ]) { const result=await data(ld(value));assert.equal(result.status,'ambiguous');assert.equal(result.selected,null);assert.equal(result.candidates.length,2); }
});

test('WebPage mainEntity references associate the current product without choosing a recommendation', async () => {
  const graph={'@graph':[
    {'@type':'WebPage',url,mainEntity:{'@id':'#main'}},
    product('99.90',{'@id':'#main'}),product('10',{'@id':'#other',name:'Other'}),
  ]};
  const result=await data(ld(graph)+dom());assert.equal(result.status,'conflict');assert.equal(result.candidates.length,2);assert.equal(result.product.id,url+'#main');
});

test('DOM ranges and schema price specifications retain distinct monetary roles', async () => {
  const range=await data(dom('10–20 EUR'));assert.equal(range.status,'unavailable');assert.deepEqual(range.candidates.map(candidate=>[candidate.amount,candidate.role]),[['10.00','range-min'],['20.00','range-max']]);
  const specified=await data(ld(product(null,{offers:{'@type':'Offer',priceCurrency:'EUR',priceSpecification:[{'@type':'PriceSpecification',price:'89.90'},{'@type':'PriceSpecification',price:'99.90',priceType:'https://schema.org/ListPrice'}]}}))+dom());
  assert.equal(specified.status,'consistent');assert.deepEqual(specified.candidates.map(candidate=>candidate.role),['current','list']);
});

test('metadata identities, DOM variants and installments do not fabricate current-price conflicts', async () => {
  const meta=await data(dom()+'<meta property="og:url" content="/other"><meta property="product:price:amount" content="1"><meta property="product:price:currency" content="EUR">');
  assert.equal(meta.status,'single_source');assert.equal(meta.candidates.length,1);
  const variants=await data('<div data-variant-id="red"><span class="price">10 EUR</span></div><div data-variant-id="blue"><span class="price">20 EUR</span></div>');
  assert.equal(variants.status,'ambiguous');assert.equal(variants.selected,null);
  const installments=await data(dom()+'<span class="price">3 × 30 EUR</span>');assert.equal(installments.status,'single_source');
  assert.equal(installments.candidates[1].role,'installment');assert.equal(installments.candidates[1].amount,'30.00');assert.equal(installments.candidates[1].conditions.installments,'3');
});

test('raw text and duplicated Microdata locations retain their exact attributes and whitespace', async () => {
  const value='  89,90 €\n';const result=await data(dom(value));assert.equal(result.selected.raw,value);assert.equal(result.selected.evidence[0].raw,value);
  const html='<div itemscope itemtype="https://schema.org/Product" itemref="values"><h1 itemprop="name">Example Product</h1><div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="priceCurrency" content="EUR"><meta itemprop="price" content="89.90"><meta itemprop="price" content="89.90"></div></div><div id="values"><span itemprop="sku">A</span></div>';
  const micro=await data(html);assert.equal(micro.status,'single_source');assert.equal(micro.selected.evidence.length,2);assert.equal(micro.product.sku,'A');
});

test('current, list, unit, range, subscription and installment roles remain separate', async () => {
  const result = await data(dom()+ '<del class="old-price">99,90 €</del><span class="unit-price">8,99 €/kg</span><span class="subscription-price">5 EUR/month</span><span class="installment-price">9 EUR</span>');
  assert.equal(result.status,'single_source');assert.equal(result.selected.amount,'89.90');
  assert.deepEqual(result.candidates.map(candidate => candidate.role),['current','list','unit','subscription','installment']);
  const range = await data(ld(product(null,{offers:{'@type':'AggregateOffer',lowPrice:'10',highPrice:'20',priceCurrency:'EUR',offers:[{'@type':'Offer',price:'15',priceCurrency:'EUR'}]}})));
  assert.equal(range.status,'single_source');assert.equal(range.selected.amount,'15.00');assert.deepEqual(range.candidates.map(candidate => candidate.role),['range-min','range-max','current']);
  const unit = await data(ld(product(null,{offers:{'@type':'Offer',priceCurrency:'EUR',price:'89.90',priceSpecification:{'@type':'UnitPriceSpecification',price:'8.99',unitCode:'KGM'}}}))+dom());
  assert.equal(unit.status,'consistent');assert.equal(unit.candidates[1].role,'unit');
});

test('cross currencies, unknown currencies and different tax/eligibility terms are not compared', async () => {
  for (const html of [ld(product())+dom('89.90 USD'),ld(product())+dom('$89.90'),dom('89.90'),
    ld(product(null,{offers:[{'@type':'Offer',price:'99.90',priceCurrency:'EUR',valueAddedTaxIncluded:true},{'@type':'Offer',price:'89.90',priceCurrency:'EUR',valueAddedTaxIncluded:false}]})),
    ld(product())+'<main><h1>Example Product</h1><span class="current-price" data-member-price="true">89.90 EUR</span></main>',
  ]) {const result = await data(html);assert.equal(result.status,'ambiguous');assert.equal(result.selected,null);}
});

test('zero prices are valid, ambiguous numeric formats are marked and invalid values are diagnosed', async () => {
  const zero = await data(ld(product('0'))+dom('0,00 €'));assert.equal(zero.status,'consistent');assert.equal(zero.selected.amount,'0.00');
  const ambiguous = await data(dom('1.299 €'));assert.equal(ambiguous.status,'ambiguous');assert.ok(ambiguous.issues.some(issue => issue.code === 'AMBIGUOUS_NUMBER'));
  const invalid = await data(ld(product('broken')));assert.equal(invalid.status,'unavailable');assert.ok(invalid.issues.some(issue => issue.code === 'INVALID_AMOUNT'));
});

test('Microdata and product metadata keep their own evidence apart from text', async () => {
  const html = `<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Example Product</h1>
    <div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="priceCurrency" content="EUR"><meta itemprop="price" content="99.90"></div></div>
    <meta property="product:price:amount" content="99.90"><meta property="product:price:currency" content="EUR">`+dom('99,90 €');
  const result = await data(html);assert.equal(result.status,'consistent');assert.equal(result.candidates.length,1);
  assert.deepEqual(new Set(result.selected.evidence.map(entry => entry.source)),new Set(['microdata','meta','visible-dom']));
  const document = parseHTML(html).document;
  for (const entry of result.selected.evidence.filter(entry => entry.source !== 'visible-dom')) assert.equal(document.querySelector(entry.locator).getAttribute(entry.attribute),'99.90');
});

test('explicit selectors scope product and prices and validate before any network request', async () => {
  const html = '<div id="target"><h1>Example Product</h1><span class="custom">89 EUR</span></div><span class="price">1 EUR</span>';
  const result = await data(html,{productSelector:'#target',priceSelector:'.custom'});assert.equal(result.selected.amount,'89.00');assert.equal(result.candidates.length,1);
  assert.equal((await data(html,{priceSelector:'.missing'})).status,'unavailable');
  let requests=0;
  for (const name of ['priceSelector','productSelector']) for (const value of ['',null,[],42,'[']) await assert.rejects(api.extractPrice(url,settings('',{[name]:value,fetch:async()=>{requests++;throw Error();}})),api.FetcharyValidationError);
  assert.equal(requests,0);
});

test('non-HTML content is a successful unavailable extraction', async () => {
  const result = await data(dom(),{fetch:async()=>new Response(dom(),{headers:{'content-type':'application/json'}})});
  assert.equal(result.status,'unavailable');assert.deepEqual(result.candidates,[]);
});

test('public dispatcher, client, named ESM export and cache reuse keep independent nested results', async () => {
  let requests=0;const options=settings(ld(product())+dom(),{fetch:async()=>{requests++;return new Response(ld(product())+dom(),{headers:{'content-type':'text/html'}});}});
  const first = await api.extractPrice(url,options);const generic = await api.extract(url,{...options,type:'price'});
  assert.deepEqual(first.data,generic.data);assert.equal(generic.cache.hit,true);assert.equal(requests,1);
  const client=api.createExtractor(options);const cached=await client.extractPrice(url);cached.data.candidates[0].evidence[0].raw='MUTATED';
  const next=await client.extractPrice(url);assert.equal(next.data.candidates[0].evidence[0].raw,'99.90');assert.equal(next.cache.hit,true);assert.equal(requests,2);
  assert.equal(cached.capturedAt,next.capturedAt);client.clearCache();assert.equal((await client.extractPrice(url)).cache.hit,false);assert.equal(requests,3);
  await client.extractPrice(url,{cacheTtlMs:0});assert.equal(requests,4);
  assert.equal((await import('../src/index.js')).extractPrice,api.extractPrice);
});

test('analysis includes price conflicts and unavailability with no additional document requests', async () => {
  for (const html of [ld(product())+dom(),'<h1>No price</h1>']) {
    let requests=0;const result=await api.analyse(url,settings(html,{cacheTtlMs:0,fetch:async target=>{
      requests++;return target===url ? new Response(html,{headers:{'content-type':'text/html'}}) : new Response('',{status:404});
    }}));
    assert.equal(result.results.price.data.status,html.includes('application/ld+json')?'conflict':'unavailable');
    assert.equal(result.results.price.capturedAt,result.capturedAt);assert.equal(result.errors.price,undefined);
    assert.deepEqual(result.summary,{succeeded:10,failed:1});assert.equal(requests,2); // document + existing favicon fallback
  }
});

test('capture safeguards cover cancellation, timeouts, response limits and private addresses', async () => {
  const controller=new AbortController();controller.abort();let requests=0;
  await assert.rejects(api.extractPrice(url,settings('',{signal:controller.signal,fetch:async()=>{requests++;throw Error();}})),api.FetcharyFetchError);assert.equal(requests,0);
  const during=new AbortController();await assert.rejects(api.extractPrice(url,settings('',{signal:during.signal,fetch:async()=>{during.abort();return new Response('');}})),api.FetcharyFetchError);
  await assert.rejects(api.extractPrice(url,settings('',{timeout:10,fetch:async()=>new Promise(()=>{})})),api.FetcharyFetchError);
  await assert.rejects(api.extractPrice(url,settings(dom(),{maxResponseBytes:10})),api.FetcharyFetchError);
  await assert.rejects(api.extractPrice('http://127.0.0.1/product',{mode:'http',fetch:async()=>{requests++;throw Error();}}),api.FetcharyValidationError);assert.equal(requests,0);
});

test('HTTP parses JSON-LD without executing scripts, fetching contexts or extra resources', async () => {
  let requests=0;const html=ld(product('99.90',{'@context':'https://never-fetch.test/context'}))+dom()+'<script>throw Error("must not execute")</script>';
  const result=await data(html,{mode:'auto',fetch:async target=>{assert.equal(target,url);requests++;return new Response(html,{headers:{'content-type':'text/html'}});},launchBrowser:async()=>{throw Error('must not launch');}});
  assert.equal(result.status,'conflict');assert.equal(requests,1);
});

test('resolution is independently testable and never compares uncertain products', () => {
  const candidate={amount:'1.00',currency:'EUR',role:'current',raw:'1',association:'uncertain',product:null,conditions:{},evidence:[]};
  assert.equal(resolvePrices([candidate,{...candidate,amount:'2.00'}],[]).status,'ambiguous');
});

test('extraction limits are reported and never produce an unjustified selected price', () => {
  const result=extractPrices([{html:dom()+Array.from({length:300},(_,i)=>`<span class="price">${i} EUR</span>`).join(''),url,document:'raw'}]);
  assert.ok(result.candidates.length<=256);assert.equal(result.selected,null);assert.ok(result.issues.some(issue=>issue.code==='EXTRACTION_LIMIT'));
  const nodes=extractPrices([{html:'<div></div>'.repeat(10001)+dom(),url,document:'raw'}]);assert.equal(nodes.status,'ambiguous');
});

async function site(t,body) {
  const requests=[];const server=http.createServer((request,response)=>{
    requests.push(request.url);if(request.url==='/favicon.ico'){response.writeHead(404);response.end();return;}
    response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {url:`http://127.0.0.1:${server.address().port}/product`,requests};
}

test('real Chromium preserves raw/rendered conflicts, exact timestamps and qualified visibility', async t => {
  const html=ld(product())+dom('99,90 €')+'<script>document.querySelector(".current-price").textContent="89,90 €";</script>';
  const local=await site(t,html);const result=await api.extractPrice(local.url,{mode:'browser',allowPrivateNetwork:true,waitAfterLoad:0,timeout:15000,cacheTtlMs:0});
  assert.equal(result.data.status,'conflict');assert.equal(result.data.selected,null);assert.equal(result.captureMode,'browser');
  const changed=result.data.candidates.find(candidate=>candidate.amount==='89.90');assert.equal(changed.evidence[0].document,'rendered');assert.equal(changed.evidence[0].visibility,'rendered-not-hidden');
  const unchanged=result.data.candidates.find(candidate=>candidate.amount==='99.90');assert.ok(unchanged.evidence.some(entry=>entry.document==='raw'));assert.ok(unchanged.evidence.some(entry=>entry.document==='rendered'));
  assert.ok(local.requests.every(target=>['/product','/favicon.ico'].includes(target)));
});

test('auto renders executable missing prices once, but static JSON-LD and identical snapshots stay single source', async t => {
  const local=await site(t,'<html><body><h1>Example Product</h1><script>document.body.insertAdjacentHTML("beforeend",\'<span class="price">89,90 €</span>\')</script></body></html>');
  const result=await api.extractPrice(local.url,{mode:'auto',allowPrivateNetwork:true,waitAfterLoad:0,timeout:15000,cacheTtlMs:0});
  assert.equal(result.captureMode,'browser');assert.equal(result.data.status,'single_source');assert.equal(result.data.selected.amount,'89.90');
  let launches=0;const options=settings(ld(product()),{mode:'auto',launchBrowser:async()=>{launches++;throw Error();}});
  assert.equal((await api.extractPrice(url,options)).captureMode,'http');assert.equal(launches,0);
  const repeated=extractPrices(['raw','rendered'].map(document=>({html:ld(product()),url,document,capturedAt:'2026-10-26T00:00:00Z'})));
  assert.equal(repeated.status,'single_source');assert.equal(repeated.selected.evidence.length,2);
});

test('rendered pages with changed product identities or destinations remain ambiguous', () => {
  const result=extractPrices([{html:ld(product()),url,document:'raw'},{html:ld(product('10',{name:'Other'})),url:'https://example.test/other',document:'rendered'}]);
  assert.equal(result.status,'ambiguous');assert.equal(result.selected,null);assert.equal(result.candidates.length,2);
});
