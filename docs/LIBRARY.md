# Fetchary library

Fetchary is a stateless CommonJS toolkit for Node.js 26+. Importing it creates no
database or application data directory. The CLI imports this same API.
Puppeteer loads lazily, only when rendering is needed.

## Get started

```bash
npm install fetchary
```

```js
const { extract, extractText, extractImages, extractSocialLinks } = require('fetchary');

async function main() {
    const url = 'https://example.com';
    const text = await extractText(url);
    const images = await extractImages(url);
    const socials = await extractSocialLinks(url);
    // Compatible calls within 45 seconds reuse the same captured webpage.
    console.log(text.data, images.data, socials.data);

    const icon = await extract(url, { type: 'favicon' });
    console.log(icon.data.url);
}
main().catch(console.error);
```

Named ESM imports also work:

```js
import { extractText } from 'fetchary';
const result = await extractText('https://example.com');
console.log(result.data);
```

## API

All extraction methods return promises. `extract(url, { type, ...options })`
dispatches to exactly the same implementation as the explicit functions.

The CLI's `--list`/`--urls-only` flags control terminal formatting; they are not
library options. Library calls keep their structured results. For example,
`(await extractSocialLinks(url)).data.map(link => link.url)` gives an array of
found social URLs, and image results offer the same `.data.map(image => image.url)`
pattern. Use `.join('\n')` when you want a newline-separated string.

The CLI's social-insights `--follower`/`--posts` flags also select output only.
In the library, read `result.followers` for followers (or YouTube subscribers)
and `result.data.metrics.posts` for the post count from
`await extractSocialInsights(url)`. Both are `number | null`; the full result
retains metric sources and availability reasons.

| Type | Function | `data` |
| --- | --- | --- |
| `text` | `extractText(url, options?)` | String |
| `html` | `extractHtml(url, options?)` | String |
| `favicon` | `extractFavicon(url, options?)` | Selected image, or a Buffer with `binary: true` |
| `images` | `extractImages(url, options?)` | Array of image references |
| `avatar` | `extractSocialAvatar(url, options?)` | Platform, profile, selected image |
| `selector` | `extractSelector(url, { selector, ...options })` | Match state and values |
| `social-links` | `extractSocialLinks(url, options?)` | Array of social links |
| `social-insights` | `extractSocialInsights(url, options?)` | Normalized metrics and availability |
| `emails` | `extractEmails(url, options?)` | Array of email strings |
| `telephone` | `extractTelephone(url, options?)` | Array of international phone strings |
| `links` | `extractLinks(url, options?)` | Array of link occurrences |
| `documents` | `extractDocuments(url, options?)` | Array of document link occurrences |
| `metadata` | `extractMetadata(url, options?)` | Page metadata fields, with nulls for missing values |
| `structured-data` | `extractStructuredData(url, options?)` | JSON-LD objects, Microdata items, and diagnostics |
| `tracker-intelligence` | `extractTrackerIntelligence(url, options?)` | Tracker configurations, public identifiers, evidence and resource hosts |

Without `type`, `extract(url)` returns HTML. `extract(url, { format: 'text' })`
remains a compatibility path. `extractProfilePicture` aliases
`extractSocialAvatar`. The earlier selector signature
`extractSelector(url, selector, options?)` is also supported.

### Common options

| Option | Default | Meaning |
| --- | --- | --- |
| `mode` | `'auto'` | `'auto'`, `'http'`, or `'browser'` |
| `timeout` | `30000` | Positive milliseconds per request/phase |
| `userAgent` | `'fetchary/2.0'` | Non-empty HTTP and browser user agent |
| `headers` | none | `HeadersInit`; caller headers are scoped to the original origin |
| `waitAfterLoad` | `5000` | Non-negative integer milliseconds or duration such as `'500ms'`, `'5s'` |
| `signal` | none | `AbortSignal`; aborted operations fail and bypass shared in-flight work |
| `maxResponseBytes` | `10485760` | Positive safe integer; decoded body/rendered HTML limit |
| `allowPrivateNetwork` | `false` | Explicitly permit trusted local/internal targets |
| `cacheTtlMs` | `45000` | Finite, non-negative age limit; zero requests a fresh capture |
| `fetch` | guarded native HTTP | Optional Fetch-compatible transport injection |
| `launchBrowser` | Puppeteer launch | Optional browser launcher, receiving headless, args, timeout, signal |
| `lookup` | Node DNS lookup | Trusted async DNS injection returning all `{ address, family }` records |

HTTP mode returns the decoded response and never substitutes rendered HTML.
Browser mode preserves raw bytes and rendered HTML independently; non-HTML skips
Chromium. Auto mode tries HTTP first, then falls back for an empty scripted app,
missing selectors/lists on a scripted page, absent favicon/avatar candidates,
or unavailable/partial insights on scripted pages. Static usable content stays
HTTP-only. HTTP errors and recognizable access walls do not trigger a bypass.
A fallback reuses the HTTP snapshot; a single operation launches at most one
browser. All page/browser resources close on success or failure.

The page HTTP status/content type remain the original HTTP response metadata,
even when the browser subsequently renders or redirects. UTF-8 is the default;
declared supported HTTP charsets and simple HTML meta charset declarations use
`TextDecoder`, with UTF-8 fallback for unsupported labels.

### Tracker intelligence

```js
const { extractTrackerIntelligence, extract, createExtractor } = require('fetchary');

async function inspect() {
    const result = await extractTrackerIntelligence('https://example.com');
    console.log(result.data.trackers, result.data.externalHosts);
    // Equivalent dispatcher and isolated client methods:
    await extract('https://example.com', { type: 'tracker-intelligence' });
    const client = createExtractor({ cacheTtlMs: 120_000 });
    await client.extractTrackerIntelligence('https://example.com');
}
inspect().catch(console.error);
```

New provider modules in `src/trackers/providers/` export
`{ provider, category, detect(context, emit) }` and are discovered automatically.
Detectors receive parsed resource/script/configuration contexts and emit only
validated identifiers and evidence; they do not perform I/O. Each detector can
be tested independently by passing it to the internal `trackerIntelligence`
function. The central extractor needs no provider list update. Public TypeScript
provider/identifier unions should be extended alongside new supported providers.

The extractor accepts `ExtractionOptions`, including timeout, AbortSignal,
network validation, response limits and cache TTL. HTTP captures can be shared
with other extractors. Browser captures have a separate policy in the cache key,
so unrestricted and passive snapshots cannot replace each other. `auto` stays
HTTP-only even for empty scripted pages. Explicit `browser` mode renders the
already captured HTML with inline JavaScript and all further requests blocked.
It examines both raw HTML and rendered DOM without fetching external scripts or
contacting trackers. It does not dismiss consent overlays. Custom browser
implementations must support guarded request interception even when private
network access is allowed.

| Provider | Category | Identifier kinds and recognized configuration |
| --- | --- | --- |
| `google-tag-manager` | `tag-manager` | `container-id`: GTM resource IDs and standard inline bootstrap |
| `google-analytics` | `analytics` | `measurement-id`: GA4 G- IDs; `tracking-id`: Universal Analytics UA- IDs, `gtag('config', ...)`, `ga('create', ...)` |
| `google-ads` | `advertising` | `conversion-id`: AW- IDs in Google tag configuration and conversion endpoints |
| `meta-pixel` | `advertising` | `pixel-id`: `fbq('init', ...)`, Facebook pixel URL IDs |
| `tiktok-pixel` | `advertising` | `pixel-id`: `ttq.load(...)`, pixel script `sdkid` |
| `linkedin-insight` | `advertising` | `partner-id`: `_linkedin_partner_id`, collect pixel `pid` |
| `pinterest-tag` | `advertising` | `tag-id`: `pintrk('load', ...)`, pixel `tid` |
| `microsoft-clarity` | `analytics` | `project-id`: Clarity tag URL or standard bootstrap |
| `microsoft-advertising-uet` | `advertising` | `tag-id`: UET constructor with `ti`, Bing pixel URL |
| `hotjar` | `analytics` | `site-id`: `_hjSettings.hjid`, numbered Hotjar script URL |
| `yandex-metrica` | `analytics` | `counter-id`: `ym(id, 'init', ...)`, legacy `Ya.Metrika`/`Ya.Metrika2` id and watch pixel |
| `matomo` | `analytics` | `site-id` with `scope`: `_paq` setTrackerUrl/setSiteId/addTracker, Matomo/Piwik pixel URLs |
| `plausible` | `analytics` | No account identifier; script integration and `configuration.trackedDomains` from `data-domain` |

Known provider script references are reported even without an identifier.
Resource signatures use known provider hosts and paths, plus Matomo/Piwik file
names for self-hosting. Plausible recognizes its hosted `/js/*.js` scripts and
self-hosted script/plausible filenames with `data-domain`. Renamed proxies,
obfuscated integrations and vendor formats outside these signatures can be missed.
Signature examples follow the vendors' [Google tag](https://developers.google.com/tag-platform/gtagjs/install),
[Matomo](https://developer.matomo.org/guides/tracking-javascript-guide),
[Pinterest](https://help.pinterest.com/en-gb/business/article/add-event-codes) and
[Plausible](https://plausible.github.io/docs/plausible-script) documentation.

```ts
type TrackerIntelligenceData = {
    trackers: Array<{
        provider: TrackerProvider; // stable names in the table above
        category: 'tag-manager' | 'analytics' | 'advertising';
        identifiers: Array<{ kind: string; value: string; scope?: string | null }>;
        detection: 'confirmed_configuration' | 'provider_reference';
        evidence: Array<{
            source: string; document: 'raw' | 'rendered'; field: string; index: number; tokenIndex?: number;
        }>;
        configuration?: { trackedDomains: string[] };
    }>;
    externalHosts: string[];
    summary: { providers: number; uniqueIdentifiers: number };
};
```

`TrackerIntelligenceResult` is `ExtractionResult<TrackerIntelligenceData,
 'tracker-intelligence'>`, with the usual requested/final URL, timestamps,
status, capture mode and cache metadata. One tracker record combines all
identifiers for a provider. Identifier equality includes provider, kind, exact
value and scope. Duplicate raw/rendered findings merge; distinct evidence
locations remain. Provider names, identifiers, evidence and hosts are sorted
lexicographically by their stable fields. `summary.uniqueIdentifiers` counts
these distinct identifier objects, including unscoped Matomo IDs; it excludes
Plausible domains. It is not a count of globally unique accounts.

Evidence contains only a source label, raw/rendered document, allowlisted field
name, zero-based element index in that document traversal, and an optional
zero-based inline JavaScript token index to retain distinct calls. It never includes
full scripts, request headers, cookies, script text excerpts or URL query values.
Resource URLs resolve against `<base>` and the final document URL. External
hosts are resource-attribute hostnames different from the document's hostname
(including sibling subdomains); inline bootstrap literals can identify providers
but are not added to this host inventory until present in a resource attribute.
Hyperlinks and canonical metadata are excluded. This inventory describes
references, not successful requests, ownership or a registrable-domain-based
third-party classification.

A valid technical initialization or configuration is
`confirmed_configuration`; a resource/initialization with no safely usable
identifier is `provider_reference`. Plausible with a valid `data-domain` is
confirmed without an account identifier. Classification applies to the combined
provider record, so an identified configuration can coexist with reference-only
evidence. Neither classification proves execution, transmitted data, common
ownership, identity or control.

Only literal initialization arguments, simple literal variables and string
concatenation are resolved, without evaluation. Comments, quoted code examples,
regex literals, templates and JSON-LD are not scanned as executable code.
There is a 200,000-token JavaScript budget per document, shared across inline
scripts; remaining inline code is skipped. Dynamic expressions, complex scopes,
inter-script variable dependencies and configurations loaded by external scripts
are not resolved. Static analysis can include unreachable code. IDs receive
syntactic checks rather than validation with a provider: GTM has 4–12 uppercase
alphanumeric suffix characters, GA4 has 10, UA uses a numeric property/view
suffix, AW uses 6–15 digits, Meta/Pinterest/UET use 5–25 digits, TikTok uses 20
alphanumeric characters, LinkedIn uses 4–15 digits, and Clarity uses 6–20
alphanumeric characters. Other counter/site IDs are positive decimal strings
of up to 25 digits. Values retain their spelling and case.

Explicit configuration attributes are `data-gtm-id`, `data-gtm-container-id`,
`data-ga-id`, `data-ga-measurement-id`, `data-google-analytics-id`,
`data-google-ads-id`, `data-facebook-pixel-id`, `data-meta-pixel-id`,
`data-tiktok-pixel-id`, `data-linkedin-partner-id`, `data-pinterest-tag-id`,
`data-clarity-id`, `data-uet-tag-id`, `data-hotjar-id` and
`data-yandex-metrica-id`. Matching `<meta name="..." content="...">` names omit
the `data-` prefix. Other arbitrary attributes, verification meta tags and prose
are not tracker configuration.

Matomo pairs setTrackerUrl/setSiteId calls in order within each inline script;
addTracker carries its own server/site pair. A server endpoint is resolved to
HTTP(S), stripped of query/fragment, and rejected if it contains credentials.
A missing server is `scope: null`. **Never correlate an unscoped site ID across
websites.** Different servers with site ID `1` remain distinct. Plausible's
`trackedDomains` identify tracked websites and are not shared account IDs.

A separate analysis application can compare two independent extractions:

```js
const { extractTrackerIntelligence } = require('fetchary');

function correlationKeys(result) {
    return result.data.trackers.flatMap(tracker => tracker.identifiers
        .filter(id => tracker.provider !== 'matomo' || id.scope)
        .map(id => JSON.stringify([tracker.provider, id.kind, id.scope ?? null, id.value])));
}
async function compareSites(leftUrl, rightUrl) {
    const [left, right] = await Promise.all([
        extractTrackerIntelligence(leftUrl), extractTrackerIntelligence(rightUrl),
    ]);
    const rightKeys = new Set(correlationKeys(right));
    return correlationKeys(left).filter(key => rightKeys.has(key));
}
compareSites('https://example.com', 'https://example.org').then(console.log);
```

Shared identifiers are technical indications only, **not proof of common
ownership or identity**. Correlation, attribution and storage belong to the
calling application. Fetchary remains stateless.

### Operation-specific options

`metadata` and `structured-data` accept the common extraction options and inspect
the whole page. Their dispatcher and client methods use the same implementations.

```js
const { extractMetadata, extractStructuredData } = require('fetchary');

async function main() {
    const url = 'https://example.com';
    const metadata = await extractMetadata(url);
    const structured = await extractStructuredData(url);
    console.log(metadata.data.title, metadata.data.publishedAt);
    console.log(structured.data.jsonLd, structured.data.microdata);
}
main().catch(console.error);
```

See [record schemas and precedence](#metadata-and-structured-data-records) and the
[CLI reference](CLI.md#metadata-and-structured-data) for list output, parsing
limits, diagnostics, standalone JSON-LD, and browser fallback behavior.

`links` and `documents` accept `includeSelectors` and `ignoreSelectors`, following
the text/HTML selection rules. Discovery keeps the original document base and
DOM locations. Each occurrence is returned separately, including repeated URLs.
Link locations refer to the captured page; they are not selectors for the target
website. All links use HTTP(S) without credentials. Internal/external classification
compares origins with the final captured page URL.

```js
const { extractLinks, extractDocuments } = require('fetchary');

async function main() {
    const url = 'https://example.com';
    const links = await extractLinks(url, { includeSelectors: ['main'] });
    const documents = await extractDocuments(url);
    console.log(links.data, documents.data);
}
main().catch(console.error);
```

Both methods also work through the dispatcher (`type: 'links'` / `'documents'`)
and isolated clients. They discover references without requesting the targets or
saving files. Document hints are not verified file contents. The
[CLI reference](CLI.md#links-and-documents) lists discovery sources, supported
extensions, MIME/download/query hints, and filtering behavior.

`emails` and `telephone` accept `includeSelectors` and `ignoreSelectors` with the
same selection rules as text/HTML. They inspect contact links, page text,
microdata, and JSON-LD contact fields. `telephone` additionally accepts
`defaultCountry`, a supported uppercase two-letter country code, for national
numbers. Without it, country context is not guessed. Phone parsing uses
[libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) with full
numbering-plan metadata. Results use international `+` form, with `;ext=42` when
an extension is present. Checks establish syntactic validity, not reachability.
See the [CLI contact reference](CLI.md#emails-and-telephone) for recognition limits.

```js
const { extractEmails, extractTelephone } = require('fetchary');

async function main() {
    const url = 'https://example.com/contact';
    const emails = await extractEmails(url);
    const phones = await extractTelephone(url, { defaultCountry: 'AT' });
    console.log(emails.data, phones.data);
}
main().catch(console.error);
```

Both functions are also available through `extract(url, { type: 'emails' })`,
`extract(url, { type: 'telephone', defaultCountry: 'AT' })`, and isolated clients.
Results are deduplicated arrays; empty results are successful. Explicit mail/tel
links are scanned first, then microdata, JSON-LD, and page text. Domains are
lowercased and email duplicates are compared case-insensitively, keeping the first
local-part spelling. Contact targets are not requested and no files are saved.

`text` and `html` accept `includeSelectors: string[]` and `ignoreSelectors: string[]`.
Includes select the first match per selector, deduplicating overlapping trees in
page order. Ignores remove all matches, including selected roots/ancestors. Missing
includes produce empty content. Text removes scripts, styles, comments and tags,
decodes entities, normalizes whitespace, and retains block separation. Non-HTML
responses bypass these DOM transformations.

`selector` requires `selector`, with optional `all: boolean`, `format: 'text' | 'html'`
(default `'text'`), or `attribute: string`. Attributes return their original value,
including relative URLs; a missing attribute is `null`. No matches is a successful
`{ matched: false, values: [] }`, distinct from invalid CSS or fetch errors.

`images` accepts `unique` (default `true`), `includeMetadata` (default `true`), and
`sources`, an array selecting `img`, `srcset`, `lazy`, `metadata`, `link`, or
`background`. It inspects `src`, `srcset`, picture sources, common lazy attributes,
Open Graph/Twitter images, image-file hyperlinks, and inline CSS background URLs.
It does not request binary images, external CSS, or computed styles. URLs resolve
against the document base, retain deterministic discovery order, and must be
HTTP(S) without credentials. HTML dimensions are unverified hints.

`social-links` accepts `platform` from the [support matrix](SOCIAL_SUPPORT.md);
`'twitter'` aliases `'x'`. Sources include hyperlinks, `rel=me`, JSON-LD `sameAs`,
and supported URL metadata. Domain matching is exact or a domain's subdomain;
query strings/fragments and case-sensitive post IDs remain intact. Equivalent
platform aliases can remain distinct URL references. Discovery does not prove
existence or request each linked social page.

`favicon` and `avatar` retain image byte/header checks, source ranking, safe
relative URL handling, and account identity protection. They may fetch manifests
and image candidates separately from the cached primary page, without saving
files. Limits are eight manifests (1 MiB each) and 64 images (16 MiB each, four
concurrent), capped further by `maxResponseBytes`. See [CLI details](CLI.md#favicon-and-avatar)
and [platform limitations](SOCIAL_SUPPORT.md).

`favicon` also accepts `binary: boolean` (default `false`). With `binary: true`,
`data` is a Node.js `Buffer` containing the selected image's original bytes;
`image` still contains its URL, dimensions, MIME type, and source. The top-level
`contentType` describes the webpage; use `image.contentType` for the image.
There is no format conversion, base64 encoding, or extra image request. The same
selection, request limits, redirect checks, and cancellation apply. Image bytes
are not retained in the page cache or written to disk by Fetchary.

```js
const { extractFavicon } = require('fetchary');

async function main() {
    const icon = await extractFavicon('https://github.com', { binary: true });
    process.stdout.write(icon.data);
}
main().catch(console.error);
```

The dispatcher supports `extract(url, { type: 'favicon', binary: true })`, as
does `extractor.extractFavicon(url, { binary: true })` on an isolated client.
TypeScript infers `FaviconResult<true>` with Buffer data for `binary: true` and
`FaviconResult` with image metadata when omitted or false. A boolean variable
produces `FaviconResult<boolean>` with `Buffer | ExtractedImage` data.

## Result schemas

Every result includes the following common fields:

```ts
type ExtractionMetadata = {
    requestedUrl: string;
    finalUrl: string;
    rawFinalUrl: string;
    capturedAt: string | null;
    extractedAt: string;
    type: 'text' | 'html' | 'favicon' | 'images' | 'avatar'
        | 'selector' | 'social-links' | 'social-insights' | 'emails' | 'telephone'
        | 'links' | 'documents' | 'metadata' | 'structured-data' | 'tracker-intelligence';
    captureMode: 'http' | 'browser';
    status: number;
    contentType: string | null;
    dismissedOverlays: string[];
    cache: { hit: boolean; ageMs: number; ttlMs: number };
    data: unknown;
};
```

`capturedAt` is the original chosen snapshot timestamp, retained on cache hits.
`extractedAt` is when this result was produced. `capturedAt: null` is used for
explicit HTTP 401/403/429 insight availability, where no successful capture exists.
`status` is the HTTP status; the social availability status lives in `data.status`.
Availability returned for a failed browser HTTP navigation uses that response's
status, `captureMode: 'browser'`, and `capturedAt: null`.

Operation data shapes:

```ts
// text / html
data: string;

// emails / telephone
data: string[];

// links / documents (types detailed below)
data: ExtractedLink[] | DocumentLink[];

// metadata / structured-data (types detailed below)
data: PageMetadata | StructuredData;

// favicon (binary omitted or false)
data: {
    url: string; width: number | null; height: number | null;
    scalable: boolean; resolutionVerified: boolean;
    contentType: string | null; source: string;
};

// favicon with binary: true (image retains the metadata shape above)
data: Buffer;

// avatar
data: { platform: string; profile: string | null; image: /* favicon image shape */ unknown };

// images
data: Array<{
    url: string; alt: string; width: number | null; height: number | null;
    source: 'img' | 'srcset' | 'lazy' | 'metadata' | 'link' | 'background';
    originalAttribute: string; resolutionVerified: false;
}>;

// selector
data: { matched: boolean; values: Array<string | null> };

// social-links
data: Array<{
    platform: string; url: string;
    kind: 'profile' | 'channel' | 'post' | 'video' | 'unknown';
    source: 'link' | 'rel-me' | 'metadata' | 'json-ld';
}>;

// social-insights
data: {
    platform: string | null; kind: 'profile' | 'channel' | 'post' | 'video' | 'unknown';
    url: string;
    metrics: {
        likes: number | null; comments: number | null; views: number | null;
        shares: number | null; saves: number | null; followers: number | null;
        following: number | null; posts: number | null; subscribers: number | null;
    };
    status: 'available' | 'partial' | 'unavailable' | 'unsupported'
        | 'login_required' | 'blocked' | 'extraction_error';
    sources: Record<string, {
        type: 'embedded-json' | 'json-ld' | 'vendor';
        field: string; approximate: boolean | null;
    }>;
    unavailable: Record<string, string>;
};
```

Compatibility fields remain: text/HTML have `content` and `format`; selectors
also have joined `content` and `format`; image lists have `images`; social links
have `links`; email results have `emails`; telephone results have `numbers`;
favicon/avatar have `image`; avatars also have `platform`, `profile`,
and `vendor`; insights have `vendor` and `followers` (falling back to YouTube
subscribers). Link results also have `links`; document results have `documents`.
Metadata results have `metadata`; structured-data results have `structuredData`.
Prefer `data` for new integrations.

### Metadata and structured-data records

```ts
type PageMetadata = {
    title: string | null;
    description: string | null;
    canonical: string | null;
    language: string | null;
    publishedAt: string | null;
    modifiedAt: string | null;
};
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
type MicrodataItem = {
    types: string[];
    id: string | null;
    properties: Record<string, Array<string | MicrodataItem | null>>;
};
type StructuredDataIssue = {
    source: 'json-ld' | 'microdata';
    index: number;
    message: string;
};
type StructuredData = {
    jsonLd: JsonObject[];
    microdata: MicrodataItem[];
    errors: StructuredDataIssue[];
};
```

Metadata precedence uses the first non-empty value in these groups:

| Field | Sources, in priority order |
| --- | --- |
| `title` | HTML title (excluding SVG/inert content), `og:title`, `twitter:title`, eligible Schema.org `headline`/`name` |
| `description` | `description`, `og:description`, `twitter:description`, eligible Schema.org `description` |
| `canonical` | First valid HTTP(S) link whose rel tokens include `canonical` |
| `language` | HTML `lang`, `xml:lang`, meta Content-Language, `og:locale`, eligible Schema.org `inLanguage` |
| `publishedAt` | Meta `article:published_time`, `datepublished`, `pubdate`, `publishdate`, `publish-date`, `publication_date`, `dcterms.issued`, `dc.date.issued`, `parsely-pub-date`, `date`; eligible Schema.org `datePublished`; explicit `time[pubdate][datetime]` |
| `modifiedAt` | Meta `article:modified_time`, `og:updated_time`, `datemodified`, `last-modified`, `lastmodified`, `dcterms.modified`, `dc.date.modified`; eligible Schema.org `dateModified` |

Eligible Schema.org objects are page/article types, BlogPosting, CreativeWork,
or Report at the JSON-LD root, in `@graph`/`mainEntity`, or top-level Microdata.
Objects explicitly identifying another page are excluded. Identity matching
ignores fragments and accepts the final page or declared canonical URL. Explicitly
matching objects precede unidentified objects; JSON-LD precedes Microdata within
those groups. Nested author/recommendation objects are not scanned for page dates.
Language uses the first comma-separated declaration and normalizes `_` to `-`.
Dates retain their original trimmed strings; no timezone or missing date is inferred.

JSON-LD objects retain their authored structure and context declarations; parsing
does not perform remote-context loading, vocabulary validation, or RDF expansion.
Microdata follows the HTML [item/property model](https://html.spec.whatwg.org/multipage/microdata.html),
with nested scopes, itemref lookup, repeated property arrays, and element-specific
values. Numeric property values remain strings. Top-level items have no `itemprop`
attribute. JSON-LD diagnostics index usable JSON-LD script blocks (or zero for a
standalone response); Microdata diagnostics index all non-inert scopes, including
nested items, in DOM order. Malformed/deep JSON-LD blocks are skipped; non-object
array entries produce diagnostics. Cyclic/deep Microdata values become null;
roots exceeding the property/text budget are skipped. These are inspectable data
issues rather than transport failures. See [CLI limits](CLI.md#metadata-and-structured-data).

### Link and document records

```ts
type LinkLocation = {
    pageUrl: string;
    selector: string;
    attribute: 'href' | 'src' | 'data';
};
type ExtractedLink = {
    url: string;
    rawUrl: string;
    text: string;
    rel: string[];
    internal: boolean;
    source: 'a' | 'area' | 'link';
    location: LinkLocation;
};
type DocumentLink = Omit<ExtractedLink, 'source'> & {
    source: ExtractedLink['source'] | 'iframe' | 'embed' | 'object';
    filename: string | null;
    extension: string | null;
    contentType: string | null;
    detectedBy: 'url' | 'query' | 'download' | 'type';
};
```

`rawUrl` is the original DOM attribute value after HTML entity decoding. `text`
contains normalized link text or its label/alt/title fallback. `location.selector`
is a unique CSS path in the captured DOM, and `location.pageUrl` is the final
captured page URL. Paths remain relative to the full DOM even when extraction
uses includes/ignores. Locations can change on a later capture.

`filename` is a hint from the download attribute, a recognized file query value,
or the URL path. `extension` is a recognized lowercase format, or `null`.
`contentType` is the element's MIME hint, or a known MIME type inferred from the
format; it can be `null`. `detectedBy` records the first matching hint. Explicit
downloads with an unknown format use `download` and nullable format fields.

### Social availability and precision

`available` means every metric implemented for this platform/URL kind was found;
other metrics can still be unsupported. `partial` means some implemented metrics
are missing. `unavailable` means none of the implemented metrics was exposed.
`unsupported` means the platform/kind has no metric implementation. Login,
challenge, and parser failures have the explicit statuses above.

Missing metrics stay `null`; a real zero stays zero. `unavailable` maps each
missing metric to `not_exposed`, `unsupported`, `identity_mismatch`,
`login_required`, `blocked`, or `extraction_error`. HTTP authentication/access
responses (401/403/429) become structured insight availability; other network
errors reject. No account/post is substituted after an identity mismatch. Missing rendered metrics can retain public values from the same capture's matching HTTP page; their source field starts with `rawHTTP:`. LinkedIn preserves its guarded public HTTP follower fallback at a browser login wall, while retaining `login_required` status.

Structured integers are exact as reported by the page. Compact counts such as
`12K`, `12.5K`, `1.2M`, and `1,2 Mio.` are normalized with `approximate: true`.
With a suffix, comma/period is a decimal separator; without one, only integers
and valid thousands grouping are accepted (`12.345`, `12,345`, `12 345`).
Existing follower parsers may not preserve the exact source token; those sources
use `approximate: null` unless a matching compact token is known. This indicates
unknown precision, never a claim of exactness. `field` names identify an embedded
field, JSON-LD statistic, or the legacy vendor parser used.

Platform support is fixture-backed and limited to exposed public data. See
[SOCIAL_SUPPORT.md](SOCIAL_SUPPORT.md) before relying on any metric.

## Capture cache

Standalone exports share a RAM-only page cache: default TTL **45000 ms**, at most
**100 captures** and approximately **50 MiB** of retained payloads, including raw
buffers, decoded/rendered strings, URLs, and metadata. No extracted results or
DOM objects are cached. Each extraction receives independent buffers/metadata and
parses its own document.

```js
const { createExtractor, extractText, clearCache } = require('fetchary');

async function main() {
    const url = 'https://example.com';
    await extractText(url, { cacheTtlMs: 120_000 });
    await extractText(url, { cacheTtlMs: 0 });
    clearCache();

    const extractor = createExtractor({ cacheTtlMs: 120_000, maxEntries: 50 });
    await extractor.extractText(url);
    await extractor.extractImages(url);
    extractor.clearCache();
}
main().catch(console.error);
```

`createExtractor(options?)` is synchronous and lightweight. It returns all
extraction functions plus `clearCache()`, with an isolated cache and copied
headers. Per-call options override defaults without mutating another client.
Per-call headers replace default headers. `maxEntries` and `maxCacheBytes` are
client-only non-negative safe integers; zero retains no completed entries.

Age starts when the original capture completes. Every request compares that age
with its own effective TTL; hits never extend expiration. The earlier caller's
TTL does not belong to the entry. Lazy cleanup uses the current operation's TTL;
eviction or clearing can always produce an earlier miss. Oversized captures are
returned without retention. LRU eviction bounds storage and creates no timer.

Simultaneous compatible requests share an in-flight promise. Joiners report a
miss (`hit: false, ageMs: 0`) because no completed entry existed. Failures are
removed, never cached. Expired content is never silently returned on refresh
failure. There is no stale serving, background refresh, or disk cache.

`cacheTtlMs: 0` bypasses both cache lookup and in-flight work and does not replace
an existing entry. Calls with an explicit `signal` also bypass shared caching so
one caller's cancellation cannot cancel another. Clearing detaches active work
without cancelling it; old work cannot refill the cleared cache.

Compatibility includes normalized requested URL (query and fragment preserved),
actual capture mode, headers/user agent, timeout, response limit, fetch/browser
implementation identity, DNS implementation identity, private-network policy,
and browser wait settings. HTTP and browser snapshots are separate. Extraction
selectors and formats do not change a page snapshot's key.

Authorization, Cookie, and Proxy-Authorization requests bypass the shared global
cache. Private clients isolate their authenticated entries by complete headers.
Never change a custom transport's hidden session while retaining its entries;
clear the client or create a new one when switching contexts. Responses setting
cookies, private/no-store/no-cache responses, partial content, recognizable login
or CAPTCHA pages, and invalid/incomplete captures are not retained. URL, DNS,
and redirect-target validation still run on cache hits.

The cache is process-local. Separate CLI executions start empty. Image candidate
checks are separate requests, while the primary webpage capture is shared.

## Network safety and dependency injection

Only HTTP(S) URLs without embedded credentials are accepted. Private, local,
link-local and reserved/internal targets are blocked by default. All DNS answers
are checked, and default HTTP connections pin the validated address. Redirects
are checked before following; cross-origin redirects strip authentication and
caller-supplied headers, except the user agent. Caller headers are also scoped
to the original origin for auxiliary and browser requests.
Timeout and response limits also cover resource requests and decompression.

Chromium requests go through guarded request interception and the same bounded
transport; direct networking is disabled using a deny proxy and non-proxied UDP
is disabled. Navigations and subresources receive the same URL/DNS checks.
The proxy is a local deny endpoint, not a service or an anti-bot proxy. No proxy
rotation, CAPTCHA solving, login, or headless user-agent rewriting is performed.
Optional-cookie rejection and recognized dismissible dialogs remain in adapters.

Use `{ allowPrivateNetwork: true }` only for trusted inputs, including local test
servers. It applies to redirects and resources as well. `fetch`, `lookup`, and
`launchBrowser` are trusted dependency injection points. A custom fetch must honor
manual redirects, cancellation and response streaming, and must not secretly
perform additional network requests. A custom browser launcher must honor the
provided network restrictions and implement Puppeteer's interception API unless
explicit local trust is enabled. Tests using these injections do not prove live
platform availability.

## Errors, TypeScript, and compatibility

Errors inherit from `FetcharyError`: `FetcharyValidationError` for invalid options,
unsafe URLs and invalid selectors; `FetcharyFetchError` for HTTP/DNS/timeout/abort
failures; `FetcharyBrowserError` for browser failures; `FetcharyNotFoundError`
for inaccessible favicon/avatar candidates. Insights can instead return explicit
availability, as documented above. Type declarations are bundled in
[`src/index.d.ts`](../src/index.d.ts), including dispatcher result inference.

Version 2 removes the old `Fetchary` class, `createFetchary()`, stored-source,
archive, scheduler, diff, vendor-activation and database APIs. They have no runtime
replacement or automatic migration. Historical user directories are never read,
written, migrated or deleted by extraction.
