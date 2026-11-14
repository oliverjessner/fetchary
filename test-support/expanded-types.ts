import {
  analyse, createExtractor, extract, extractEmails, extractTelephone, extractFavicon,
  extractImages, extractLinks, extractMetadata, extractStructuredData, extractPrice,
  logout, type ContactDetail, type TelephoneDetail, type ExtractedImage,
  type FaviconOptions, type TrackerProvider, type TrackerIdentifier, type SocialKind,
  type Metric, type Platform, type BulkLogoutResult,
} from '../src';
import type { Buffer } from 'node:buffer';

async function expandedTypes(details: boolean, faviconOptions: FaviconOptions) {
  const url = 'https://example.com';
  const client = createExtractor({
    domainOptions: { '*.example.com': { maxResponseBytes: 1024, blockedResourceTypes: ['font', 'media'] } },
  });
  client.configure({ domainOptions: { 'example.com': { mode: 'http' } } });
  const cacheEntries: number = client.getCacheStats().entries;
  const strings: string[] = (await extractEmails(url, { deobfuscate: true })).data;
  const emailDetails: ContactDetail[] = (await extractEmails(url, { details: true })).data;
  const phoneDetails: TelephoneDetail[] = (await client.extractTelephone(url, { details: true, defaultCountry: 'AT' })).data;
  const maybeDetails: ContactDetail[] | string[] = (await extractEmails(url, { details })).data;
  const dispatchedEmails: ContactDetail[] = (await extract(url, { type: 'emails', details: true })).data;
  const dispatchedPhones: string[] = (await extract(url, { type: 'telephone' })).data;
  const binaryIcon: Buffer = (await extractFavicon(url, { binary: true })).data;
  const singleIcon: ExtractedImage = (await extractFavicon(url)).data;
  const allIcons: ExtractedImage[] = (await extractFavicon(url, { all: true })).data;
  const dispatchedIcons: ExtractedImage[] = (await client.extract(url, { type: 'favicon', all: true })).data;
  const dynamicIcons: Buffer | ExtractedImage | ExtractedImage[] = (await extractFavicon(url, faviconOptions)).data;
  const images = await extractImages(url, { includeStylesheets: true, sources: ['stylesheet'] });
  const stylesheet: string | undefined = images.data[0]?.stylesheetUrl;
  const sitemapPriority: number | null | undefined = (await extractLinks(url)).data[0]?.priority;
  const metadata = (await extractMetadata(url)).data;
  const author: string | null | undefined = metadata.authors[0]?.name;
  const rawCards: string[] = metadata.openGraph['og:image'];
  const metadataField: string | undefined = metadata.sources.title?.field;
  const graphRoots: string[] = (await extractStructuredData(url)).data.resolved.roots;
  const price = await extractPrice(url, { country: 'AT', language: 'de-AT' });
  const shippingAmount: string | null | undefined = price.data.candidates[0]?.shipping[0]?.cost?.amount;
  const sizes: string[] | undefined = price.data.product?.variant?.size;
  const duration: number = (await analyse(url)).diagnostics.durationMs;
  const normalLogout: boolean = (await logout('example')).removed;
  const batchLogout: BulkLogoutResult = await logout(['one', 'two']);
  const domainLogout: number = (await logout({ domain: 'example.com' })).removed;
  const platform: Platform = 'telegram';
  const kind: SocialKind = 'repository';
  const metric: Metric = 'stars';
  const provider: TrackerProvider = 'adobe-experience-platform-tags';
  const identifier: TrackerIdentifier = { kind: 'website-id', value: 'id' };
  // @ts-expect-error all favicon metadata cannot be combined with binary output
  await extractFavicon(url, { all: true, binary: true });
  // @ts-expect-error dispatcher preserves the same favicon option constraint
  await extract(url, { type: 'favicon', all: true, binary: true });
  // @ts-expect-error email deobfuscation is a boolean
  await extractEmails(url, { deobfuscate: 'yes' });
  // @ts-expect-error telephone extraction has no email deobfuscation option
  await extractTelephone(url, { deobfuscate: true });
  // @ts-expect-error cache capacity is fixed when creating the client
  client.configure({ maxEntries: 20 });
  // @ts-expect-error domain response limits are numeric
  client.configure({ domainOptions: { 'example.com': { maxResponseBytes: 'large' } } });
  // @ts-expect-error rich contacts are not strings
  const invalidStrings: string[] = (await extractEmails(url, { details: true })).data;
  return [cacheEntries, strings, emailDetails, phoneDetails, maybeDetails, dispatchedEmails, dispatchedPhones,
    binaryIcon, singleIcon, allIcons, dispatchedIcons, dynamicIcons, stylesheet, sitemapPriority,
    author, rawCards, metadataField, graphRoots, shippingAmount, sizes, duration, normalLogout,
    batchLogout, domainLogout, platform, kind, metric, provider, identifier, invalidStrings];
}
void expandedTypes;
