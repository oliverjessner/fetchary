'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePrice, currencyCode } = require('../src/extract/price/normalize');

for (const [raw,amount,currency] of [
  ['€ 99,90','99.90','EUR'],['99.90 EUR','99.90','EUR'],['1.299,95 €','1299.95','EUR'],
  ['EUR89.90','89.90','EUR'],['89.90CHF','89.90','CHF'],
  ['$1,299.95','1299.95',null],['CHF 49.50','49.50','CHF'],['0,00 €','0.00','EUR'],
  ['1\u202f299,95 €','1299.95','EUR'],["CHF 1’299.50",'1299.50','CHF'],
  ['US$ 12.34','12.34','USD'],['CA$12.34','12.34','CAD'],['¥ 100','100.00',null],
  ['EUR 0001.20','1.20','EUR'],['99999999999999999999.99 EUR','99999999999999999999.99','EUR'],
  ['1,234,567.89 EUR','1234567.89','EUR'],['EUR 1.234.567','1234567.00','EUR'],
]) test(`normalizes ${raw} without floating point arithmetic`, () => {
  assert.deepEqual(normalizePrice(raw),{ amount,currency,error:null });
});
for (const raw of ['',null,{},NaN,Infinity,-1,'-1 EUR','EUR 10.20.30','12 34 EUR','EUR 9,9,9','1e3 EUR','99.90–109.90 EUR','99 EUR 12','123.','USD EUR 1','EUR 1.234','1,234']) {
  test(`rejects or marks ambiguous ${JSON.stringify(raw)}`, () => assert.equal(normalizePrice(raw).amount,null));
}
test('machine decimal tokens preserve precision and unknown currencies are explicit', () => {
  assert.equal(normalizePrice('1.234','EUR',true).amount,'1.234');
  assert.equal(normalizePrice('$1.00','USD').currency,'USD');
  assert.equal(normalizePrice('1.00','BOGUS').error,'AMBIGUOUS_CURRENCY');
  assert.equal(normalizePrice('€1','USD').error,'AMBIGUOUS_CURRENCY');
  assert.equal(normalizePrice(0).amount,'0.00');
  assert.equal(normalizePrice(0.1).amount,null);
  assert.equal(currencyCode(' chf '),'CHF');assert.equal(currencyCode('$'),null);
});
