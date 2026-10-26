import { extractPrice, extract, createExtractor, analyse, type PriceResult, type PriceCandidate, type PriceEvidence } from '../src';

async function priceTypes() {
  const direct: PriceResult = await extractPrice('https://example.com/product', { productSelector:'#product', priceSelector:'.price' });
  const generic: PriceResult = await extract('https://example.com/product', { type:'price', mode:'http' });
  const client: PriceResult = await createExtractor({ cacheTtlMs:45000 }).extractPrice('https://example.com/product');
  const candidate: PriceCandidate | null = direct.data.selected;
  const evidence: PriceEvidence | undefined = candidate?.evidence[0];
  const report = await analyse('https://example.com/product');
  const section: PriceResult | null = report.results.price;
  // @ts-expect-error selectors are strings
  await extractPrice('https://example.com/product', { priceSelector:42 });
  // @ts-expect-error price options do not apply to text
  await extract('https://example.com/product', { type:'text', priceSelector:'.price' });
  return [direct,generic,client,candidate,evidence,section];
}
void priceTypes;
