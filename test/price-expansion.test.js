'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const api = require('../src');
const { extractPrices, normalizePriceContext } = require('../src/extract/price');
const { capturePriceVisibility } = require('../src/extract/price/visibility');
const url = 'https://example.test/product';
const ld = object => `<script type="application/ld+json">${JSON.stringify(object)}</script>`;
const product = extra => ({'@type':'Product',name:'Example Product',offers:{'@type':'Offer',price:'19.90',priceCurrency:'EUR'},...extra});
const documents = html => [{html,url,document:'raw',capturedAt:'2026-11-15T12:00:00.000Z'}];

test('shipping costs, delivery regions and time ranges are typed without adding shipping to product prices', () => {
  const shipping={'@type':'OfferShippingDetails',shippingRate:{'@type':'MonetaryAmount',value:'0',currency:'EUR'},
    shippingDestination:[{'@type':'DefinedRegion',addressCountry:'at',addressRegion:'Wien',postalCode:'1010'},{'@type':'DefinedRegion',addressCountry:{'@type':'Country',name:'Germany'}}],
    deliveryTime:{'@type':'ShippingDeliveryTime',handlingTime:{minValue:0,maxValue:1,unitCode:'DAY'},transitTime:{minValue:2,maxValue:4,unitCode:'DAY'}}};
  const html=ld(product({offers:{'@type':'Offer',price:'19.90',priceCurrency:'EUR',shippingDetails:shipping}}));
  const result=extractPrices(documents(html));
  assert.equal(result.selected.amount,'19.90');assert.equal(result.candidates.length,1);
  assert.deepEqual(result.selected.shipping,[{cost:{amount:'0.00',currency:'EUR'},regions:[{country:'AT',region:'Wien',postalCode:'1010'},{country:'Germany',region:null,postalCode:null}],deliveryTime:{handling:{min:'0',max:'1',unit:'DAY'},transit:{min:'2',max:'4',unit:'DAY'}}}]);
  assert.ok(result.selected.conditions.shippingDetails.includes('OfferShippingDetails'));
});

test('referenced shipping objects and Microdata retain declared costs and unknown fields', () => {
  const graph={'@graph':[product({offers:{'@type':'Offer',price:'19.90',priceCurrency:'EUR',shippingDetails:{'@id':'#shipping'}}}),
    {'@id':'#shipping','@type':'OfferShippingDetails',shippingRate:{value:'4.95',currency:'EUR'},shippingDestination:{addressCountry:'DE'}}]};
  const referenced=extractPrices(documents(ld(graph)));
  assert.deepEqual(referenced.selected.shipping[0].cost,{amount:'4.95',currency:'EUR'});
  const html=`<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Example Product</h1>
    <div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="19.90"><meta itemprop="priceCurrency" content="EUR">
    <div itemprop="shippingDetails" itemscope itemtype="https://schema.org/OfferShippingDetails"><div itemprop="shippingRate" itemscope itemtype="https://schema.org/MonetaryAmount"><meta itemprop="value" content="4.95"><meta itemprop="currency" content="EUR"></div>
    <div itemprop="shippingDestination" itemscope itemtype="https://schema.org/DefinedRegion"><meta itemprop="addressCountry" content="AT"></div></div></div></div>`;
  const micro=extractPrices(documents(html));
  assert.deepEqual(micro.selected.shipping[0],{cost:{amount:'4.95',currency:'EUR'},regions:[{country:'AT',region:null,postalCode:null}],deliveryTime:null});
});

test('explicit variant attributes separate offers that have no distinct SKU', () => {
  const first=product({size:' M ',color:'Red',material:'Cotton',model:{name:'Classic'},additionalProperty:[{name:'Ausführung',value:'Matt'}]});
  const second=product({size:'L',color:'Blue',offers:{'@type':'Offer',price:'24.90',priceCurrency:'EUR'}});
  const result=extractPrices(documents(ld([first,second])));
  assert.equal(result.status,'ambiguous');assert.equal(result.selected,null);
  assert.deepEqual(result.candidates[0].product.variant,{size:['M'],color:['Red'],material:['Cotton'],model:['Classic'],configuration:['Matt']});
  assert.equal(result.candidates[1].product.variant.color[0],'Blue');
  const dom=extractPrices(documents('<main id="selected" data-size="M" data-color="Red"><h1>Example Product</h1><span class="price">19.90 EUR</span></main>'),{productSelector:'#selected'});
  assert.equal(dom.selected.product.variant.size[0],'M');
});

test('requested country and language remain explicit context without inventing a currency or geolocation', async () => {
  assert.deepEqual(normalizePriceContext({country:'at',language:'de-at'}),{country:'AT',language:'de-AT'});
  const result=extractPrices(documents('<h1>Example Product</h1><span class="price">19.90</span>'),{country:'US',language:'en-US'});
  assert.deepEqual(result.context,{country:'US',language:'en-US'});assert.equal(result.candidates[0].currency,null);
  for (const options of [{country:'Austria'},{country:1},{language:'de_AT'},{language:3}]) assert.throws(()=>normalizePriceContext(options),api.FetcharyValidationError);
  assert.equal(await capturePriceVisibility({}),undefined);
});

test('reliable computed visibility excludes hidden raw DOM evidence while preserving structured sources', () => {
  const html='<!doctype html><html><head>'+ld(product())+'</head><body><main><h1>Example Product</h1><div><span class="price">99 EUR</span></div><span class="price">19.90 EUR</span></main></body></html>';
  const rendered={...documents(html)[0],document:'rendered',computedVisibility:{hidden:['html:nth-child(1) > body:nth-child(2) > main:nth-child(1) > div:nth-child(2)'],truncated:false}};
  const result=extractPrices([...documents(html),rendered]);
  assert.equal(result.selected.amount,'19.90');assert.equal(result.status,'consistent');
  assert.ok(result.selected.evidence.some(entry=>entry.source==='json-ld'&&entry.document==='raw'));
  assert.ok(result.selected.evidence.some(entry=>entry.visibility==='computed-visible'));
});

test('browser price visibility follows an external stylesheet and inherited opacity', async t => {
  const requests=[];
  const html=ld(product())+'<link rel="stylesheet" href="/style.css"><main><h1>Example Product</h1><div class="hidden"><span class="price">99 EUR</span></div><div class="transparent"><span class="price">79 EUR</span></div><span class="price">19.90 EUR</span></main>';
  const server=http.createServer((request,response)=>{requests.push(request.url);response.writeHead(200,{'content-type':request.url==='/style.css'?'text/css':'text/html'});response.end(request.url==='/style.css'?'.hidden{display:none}.transparent{opacity:0}':html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const result=await api.extractPrice(`http://127.0.0.1:${server.address().port}/product`,{mode:'browser',allowPrivateNetwork:true,waitAfterLoad:0,timeout:15000,cacheTtlMs:0});
  assert.equal(result.data.status,'consistent');assert.equal(result.data.selected.amount,'19.90');
  assert.ok(requests.includes('/style.css'));
  assert.ok(result.data.selected.evidence.some(entry=>entry.visibility==='computed-visible'));
});
