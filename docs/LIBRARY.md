# Fetchary library

Fetchary is a CommonJS extraction toolkit for Node.js 26+. Importing it creates no
database or application data directory. The CLI imports this same API.
Puppeteer loads lazily, when rendering or interactive login is requested.

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

## Configure a library client

Use `createExtractor(options?)` to set defaults once for your application. For
example, allow up to 8 MiB per response when reading a large homepage to find its
favicon:

```js
const { createExtractor } = require('fetchary');

const fetchary = createExtractor({
    mode: 'http',
    maxResponseBytes: 8 * 1024 * 1024,
});

async function main() {
    const icon = await fetchary.extractFavicon('https://www.handelsblatt.com/');
    console.log(icon.image.url);

    // Update defaults for subsequent calls on this client.
    fetchary.configure({ maxResponseBytes: 16 * 1024 * 1024 });
}
main().catch(console.error);
```

`client.configure(options)` synchronously merges `ClientConfiguration` into
the client's defaults and returns the same client for chaining. Invalid options
throw `FetcharyValidationError` before changing any defaults. Omitted settings
are kept; setting an option to `undefined` restores its built-in default. Headers
are copied and replace the previous default headers as a whole. Per-call options
still take precedence. Calls already in progress keep their original settings;
other clients and standalone functions keep their own defaults.

`maxResponseBytes` is a positive safe integer in bytes, with a built-in default
of 45 MiB (`45 * 1024 * 1024`). It bounds decoded page responses, resources and
rendered HTML. Favicon/avatar images also have a 16 MiB cap and manifests a
1 MiB cap; the smaller limit applies. Cache capacities `maxEntries` and
`maxCacheBytes` can only be set in `createExtractor()`.

When supplying a custom `fetch`, configure its own limits too. For example, a
transport that rejects a homepage above 2 MiB still rejects it when Fetchary's
`maxResponseBytes` is higher. Fetchary can apply a stricter limit to the returned
response, but cannot raise a limit enforced inside the transport. In an app such
as Pitchary, align the transport's page limit with the client setting and keep
any separate icon-download limit in the transport.

`domainOptions` is available only on `createExtractor()` and `client.configure()`.
Use exact hostnames or `*.hostname` rules, without schemes, paths or ports:

```js
const { createExtractor } = require('fetchary');
const client = createExtractor({
    mode: 'auto',
    domainOptions: {
        '*.example.com': { timeout: 15_000 },
        'news.example.com': { mode: 'http', maxResponseBytes: 8 * 1024 * 1024 },
    },
});
```

Rules match the requested URL's hostname; a wildcard matches descendants but
not the apex host. Matching wildcard rules apply from shorter to longer suffixes,
then an exact-host rule, then per-call options. For example, `*.example.com`
precedes `*.news.example.com`, and `news.example.com` overrides its wildcard.
Each rule contains common extraction options; nested `domainOptions` and cache
capacities are rejected. Headers replace the previous header set instead of
merging individual fields. Configuration snapshots caller-owned headers and
resource-type arrays. `configure({ domainOptions: rules })` replaces the entire
rule map; `domainOptions: undefined` removes it. Invalid merged settings leave
the previous configuration intact.

## API

All extraction methods return promises. `extract(url, { type, ...options })`
dispatches to exactly the same implementation as the explicit functions.

The CLI's `--list`/`--urls-only` flags control terminal formatting; they are not
library options. Library calls keep their structured results. For example,
`(await extractSocialLinks(url)).data.map(link => link.url)` gives an array of
found social URLs, and image results offer the same `.data.map(image => image.url)`
pattern. Use `.join('\n')` when you want a newline-separated string.

The CLI's social-insights `--follower`/`--posts` flags also select output only.
In the library, read `result.followers` for followers (or available channel subscribers)
and `result.data.metrics.posts` for the post count from
`await extractSocialInsights(url)`. Both are `number | null`; the full result
retains metric sources and availability reasons.

For YouTube channels, `result.data.metrics.posts` is the reported video total;
`result.data.metrics.subscribers` is the subscriber count. Embedded channel-header
data and rendered video-count metadata are supported. For example, `14.361 Videos`
becomes `14361`; missing totals remain `null` with
`result.data.unavailable.posts === 'not_exposed'`. Compact totals such as
`14.3K videos` carry `result.data.sources.posts.approximate === true`.

Instagram posts/reels can supply `data.metrics.likes` and `comments` from public
description metadata when matching media JSON/JSON-LD is absent. Canonical/Open
Graph URLs must identify the same case-sensitive shortcode; owner-prefixed URLs
such as `/username/reel/shortcode/` are accepted. These fallback sources have
`type: 'vendor'` and a metadata selector in `field`. Missing views remain `null`
with reason `not_exposed`, and the result stays `partial`.

For social insights in `mode: 'auto'`, optional browser-capture failures retain
an already usable partial HTTP result with its original capture metadata.
`mode: 'browser'` still rejects browser failures. Cancellation and browser
401/403/429 responses are not converted into a partial HTTP success.

Reddit post insights expose `data.metrics.score` (the reported net vote score)
and `data.metrics.comments`. `score` can be negative and remains separate from
`likes`; individual upvotes/downvotes are not calculated from it. Both fields
are scoped to the requested post ID. Modern `shreddit-post` attributes and
matching embedded `t3` post records are supported, with hidden scores left
`null`. Profile/community metrics remain unsupported.

| Type | Function | `data` |
| --- | --- | --- |
| `text` | `extractText(url, options?)` | String |
| `html` | `extractHtml(url, options?)` | String |
| `favicon` | `extractFavicon(url, options?)` | Selected image; checked image list with `all: true`; Buffer with `binary: true` |
| `images` | `extractImages(url, options?)` | Array of image references |
| `videos` | `extractVideos(url, options?)` | Array of video references |
| `avatar` | `extractSocialAvatar(url, options?)` | Platform, profile, selected image |
| `selector` | `extractSelector(url, { selector, ...options })` | Match state and values |
| `social-links` | `extractSocialLinks(url, options?)` | Array of social links |
| `social-insights` | `extractSocialInsights(url, options?)` | Normalized metrics and availability |
| `emails` | `extractEmails(url, options?)` | Email strings, or contact records with `details: true` |
| `telephone` | `extractTelephone(url, options?)` | International phone strings, or contact records with `details: true` |
| `links` | `extractLinks(url, options?)` | Array of link occurrences |
| `documents` | `extractDocuments(url, options?)` | Array of document link occurrences |
| `metadata` | `extractMetadata(url, options?)` | Page metadata fields, with nulls for missing values |
| `structured-data` | `extractStructuredData(url, options?)` | Raw JSON-LD, Microdata, resolved local entities and diagnostics |
| `tracker-intelligence` | `extractTrackerIntelligence(url, options?)` | Tracker configurations, public identifiers, evidence and resource hosts |
| `price` | `extractPrice(url, options?)` | Product price candidates, provenance and resolution |

Without `type`, `extract(url)` returns HTML. `extract(url, { format: 'text' })`
remains a compatibility path. `extractProfilePicture` aliases
`extractSocialAvatar`. The earlier selector signature
`extractSelector(url, selector, options?)` is also supported.

### Website analysis

`analyse(url, options?)` returns one report combining `favicon`, `links`,
`social-links`, `emails`, `telephone`, `images`, `documents`, `structured-data`,
`metadata`, `tracker-intelligence`, and `price`. `createExtractor().analyse()` uses the
client's isolated cache. Named CommonJS and ESM exports are available.

```js
const { analyse, createExtractor } = require('fetchary');

async function main() {
    const report = await analyse('https://oliverjessner.at', { defaultCountry: 'AT' });
    console.log(report.results.metadata?.data.title);
    console.log(report.results.links?.data);
    console.log(report.errors, report.summary);

    const client = createExtractor({ cacheTtlMs: 120_000 });
    await client.analyse('https://oliverjessner.at', { mode: 'http' });
}
main().catch(console.error);
```

```ts
type AnalysisType = 'favicon' | 'links' | 'social-links' | 'emails' | 'telephone'
    | 'images' | 'documents' | 'structured-data' | 'metadata' | 'tracker-intelligence' | 'price';
type AnalysisOptions = ExtractionOptions & { defaultCountry?: CountryCode };
type AnalysisResults = {
    [K in AnalysisType]: (K extends 'favicon' ? FaviconResult
        : K extends 'emails' ? EmailsResult
        : K extends 'telephone' ? TelephoneResult : ResultMap[K]) | null;
};
type AnalysisIssue = { error: string; message: string; status?: number; phase?: string };
type AnalysisResult = ExtractionMetadata & {
    type: 'analyse';
    results: AnalysisResults;
    errors: Partial<Record<AnalysisType, AnalysisIssue>>;
    summary: { succeeded: number; failed: number };
    diagnostics: {
        requests: number;
        decodedBytes: number;
        httpMs: number;
        browserMs: number;
        rawSnapshotBytes: number;
        renderedSnapshotBytes: number;
        cacheHits: number;
        fallbackReasons: string[];
        durationMs: number;
        sectionMs: Partial<Record<AnalysisType, number>>;
    };
};
```

Every successful section contains the complete normal extraction result; favicon
`data` is image metadata, never binary bytes. Failed sections are `null` with a
serialized issue under the same name in `errors`. Missing matches are successful
empty results. A missing favicon does not reject the report. Primary capture,
validation and cancellation failures reject with the existing typed errors.
The report's metadata describes the latest successful capture; each section
retains its own capture metadata, including raw/rendered provenance. Result keys
have the stable order shown above, regardless of completion order.

Analysis accepts common capture options and the telephone `defaultCountry`.
All eleven extractors run without selection/filter flags. Operation-specific
options such as contact `details`/`deobfuscate`, image `includeStylesheets` and
price `country`/`language` are not analysis options. It is a separate aggregate
API, rather than an `extract()` dispatcher type. It reads only the supplied page;
linked documents and social profiles are not fetched. Favicon manifests and
candidates are fetched and validated through the existing bounded transport.
Image discovery can also read linked/imported stylesheets under the image
extractor's CSS budgets; it does not download the discovered background images.

The analysis shares one primary HTTP capture and at most one browser rendering.
This sharing also applies within a single analysis with `cacheTtlMs: 0`, an
AbortSignal, or authenticated headers; it does not join separately cancelled
analyses or retain their snapshots when caching is disabled. Client/global
capture reuse, security checks and cache clearing otherwise behave normally.
Auxiliary favicon checks are not cached with the page.

`diagnostics.requests` counts actual transport attempts, including resource
requests and redirects, rather than extractor invocations. `decodedBytes`
counts consumed decoded response bytes; it is neither compressed wire traffic
nor browser memory usage. Reused captures contribute snapshot sizes and cache
hits without inventing transferred bytes. `httpMs`, `browserMs`, `durationMs`
and `sectionMs` are elapsed milliseconds. Sections run concurrently, so their
times should not be added to obtain total duration. `fallbackReasons` reports
why auto mode requested rendering, such as a consent wall or missing content;
explicit browser mode need not have a fallback reason.

`http` uses the HTTP snapshot throughout. `auto` preserves each extractor's
existing fallback rules; sections already satisfied by raw HTML stay on HTTP,
while those requiring rendering share a browser snapshot. `browser` renders
once before running the extractors. All analysis rendering uses the passive
tracker policy, which allows inline JavaScript but blocks external scripts and
all additional browser resources/connections/navigation. This protects tracker
inspection and can limit pages dependent on external bundles or fetched data.
Standalone extractors retain their existing capture policies. The library does
not store the report, crawl other pages, monitor the site or infer ownership.

### Common options

| Option | Default | Meaning |
| --- | --- | --- |
| `mode` | `'auto'` | `'auto'`, `'http'`, or `'browser'` |
| `consent` | `'reject'` | `'reject'`, `'accept'`, or `'off'`; generic browser consent policy |
| `timeout` | `30000` | Positive milliseconds per request/phase |
| `userAgent` | `'fetchary/2.0'` | Non-empty HTTP and browser user agent |
| `headers` | none | `HeadersInit`; caller headers are scoped to the original origin |
| `cookieFile` | none | Path to a read-only Netscape/JSON session cookie export; disables page caching |
| `session` | none | Name of an explicitly saved Fetchary login session; disables page caching |
| `sessionDir` | `~/.fetchary/sessions` | Session directory override; requires `session` during extraction |
| `cookiesFromBrowser` | none | `'chrome'`: read matching cookies from Google Chrome on macOS; disables page caching |
| `browserProfile` | `'Default'` | Profile directory name or absolute path; requires `cookiesFromBrowser` |
| `waitAfterLoad` | `5000` | Non-negative integer milliseconds or duration such as `'500ms'`, `'5s'` |
| `signal` | none | `AbortSignal`; aborted operations fail and bypass shared in-flight work |
| `maxResponseBytes` | `47185920` | Positive safe integer; decoded response/resource/rendered HTML limit |
| `blockedResourceTypes` | `[]` | Browser subresource types to omit; the document navigation is retained |
| `allowPrivateNetwork` | `false` | Explicitly permit trusted local/internal targets |
| `insecure` | `true` | Skip TLS certificate and hostname verification; set `false` to verify |
| `cacheTtlMs` | `45000` | Finite, non-negative age limit; zero requests a fresh capture |
| `fetch` | guarded native HTTP | Optional Fetch-compatible transport injection |
| `launchBrowser` | Puppeteer launch | Optional browser launcher, receiving headless, acceptInsecureCerts, args, timeout, signal |
| `lookup` | Node DNS lookup | Trusted async DNS injection returning all `{ address, family }` records |

HTTP mode returns the decoded response and never substitutes rendered HTML.
Browser mode preserves raw bytes and rendered HTML independently; non-HTML skips
Chromium. Auto mode tries HTTP first, then falls back for strong consent-wall evidence, an empty scripted app,
missing selectors/lists on a scripted page, absent favicon/avatar candidates,
or unavailable/partial insights on scripted pages. Static usable content stays
HTTP-only. HTTP errors and recognizable access walls do not trigger a bypass.
A fallback reuses the HTTP snapshot; a single operation launches at most one
browser. All page/browser resources close on success or failure.

`blockedResourceTypes` accepts `image`, `font`, `media`, `stylesheet`, `script`,
`xhr`, `fetch`, `eventsource`, `websocket`, `manifest`, and `other`. It affects
browser subresources only, never the document navigation or ordinary HTTP
capture. Blocking scripts, styles or data requests can change the resulting
content. The selected resource policy participates in browser-cache identity;
the passive tracker policy remains stricter than this optional filter.

The page HTTP status/content type remain the original HTTP response metadata,
even when the browser subsequently renders or redirects. UTF-8 is the default;
declared supported HTTP charsets and simple HTML meta charset declarations use
`TextDecoder`, with UTF-8 fallback for unsupported labels.

### Cookie consent

```js
const { extractText, createExtractor } = require('fetchary');

async function main() {
    const result = await extractText('https://golem.de', {
        mode: 'auto', consent: 'reject',
    });
    console.log(result.consent, result.data);

    const client = createExtractor({ consent: 'reject' });
    const untouched = await client.extractHtml('https://example.com', { consent: 'off' });
    console.log(untouched.consent);
}
main().catch(console.error);
```

`consent` applies to standalone methods, `extract()`, `analyse()` and isolated
clients. The default `'reject'` policy uses real browser clicks to reject
optional cookies, or opens settings and disables optional purposes before
saving. It never clicks an accept-all control as a fallback. `'accept'` permits
accept-all only when explicitly selected. `'off'` disables the generic handler;
non-consent vendor overlay handling remains active.

The handler recognizes Sourcepoint, OneTrust, Cookiebot, Usercentrics, Didomi,
consentmanager and generic German/English consent patterns in the DOM, frames
and open shadow roots. It watches for delayed banners during `waitAfterLoad`,
allows at most three interaction steps per dialog, and respects capture
cancellation/timeouts. A result is `handled` only after the dialog disappears
following a completed interaction and readable page content is verified. These
patterns are verified against local Chromium fixtures. A known provider can
still present an unsupported or blocked dialog on an individual site.

`mode: 'auto'` examines HTTP HTML for strong consent-wall evidence and renders
such pages even if their banner text is lengthy. This fallback reuses the
existing HTTP capture and launches at most one browser. `mode: 'http'` never
launches a browser; `consent: 'off'` disables consent-specific fallback. Browser
captures finish consent handling before taking their HTML snapshot. Existing
passive tracker/analysis capture remains interaction-free and blocks additional
browser resources; those operations do not click consent controls. This also
prevents externally loaded CMPs from running. Use a standalone text/HTML
extraction when you need active consent handling.

Every result's `consent` field has this shape:

```ts
type ConsentMode = 'reject' | 'accept' | 'off';
type ConsentStatus = 'not_detected' | 'handled' | 'failed' | 'unsupported' | 'blocked';
type ConsentMetadata = {
    detected: boolean;
    provider: string | null; // provider name, 'generic', or null
    action: ConsentMode;     // requested policy, not proof of success
    status: ConsentStatus;
    reason?: string;        // explanation for unresolved consent
};
```

`not_detected` means no banner was recognized; with `'off'` generic browser inspection
is disabled. `handled` confirms completed interaction, disappearance and readable content;
`failed` reports an unsuccessful attempt, `unsupported` a recognized dialog
without a supported way to finish (including HTTP-only walls), and `blocked`
an access/consent barrier that cannot be completed under the requested policy.
Inspect the status before treating output as editorial content. HTTP-only/off
results can still contain the banner. The library keeps the structured result
available; the CLI additionally warns and exits with code `1` for detected
unresolved consent. Browser handling cannot unlock content
withheld after rejection or replace a site's paid subscription, login or CAPTCHA.
This also applies to Golem pages that require tracking consent or a subscription.
The [Golem live-check notes](CLI.md#cookie-consent) record the homepage and article
limitations observed on 2026-10-31.
Unresolved consent captures are not retained in the capture cache. Cache keys
isolate `'reject'`, `'accept'` and `'off'` policies.

### Browser-cookie authentication

```js
const { extractSocialInsights, createExtractor } = require('fetchary');

async function main() {
    const result = await extractSocialInsights('https://www.linkedin.com/in/oliverjessner', {
        mode: 'browser', cookiesFromBrowser: 'chrome', browserProfile: 'Default',
    });
    console.log(result.followers);

    const client = createExtractor({ cookiesFromBrowser: 'chrome', browserProfile: 'Profile 1' });
    return client.analyse('https://example.com');
}
```

`cookiesFromBrowser?: 'chrome'` and `browserProfile?: string` are common extraction
options for explicit methods, dispatch, analysis and clients. Chrome on macOS is
currently supported. `browserProfile` defaults to the `Default` directory under
`~/Library/Application Support/Google/Chrome`; it accepts another directory name
or an absolute profile directory path. Relative paths and Chrome display names
are not profile selectors.

The importer opens the existing cookie database read-only and filters matching,
unexpired, unpartitioned rows before decrypting values. It reads `Chrome Safe
Storage` from the macOS Keychain only when relevant encrypted cookies exist.
macOS may request access. It never writes the key, an export, refreshed cookies,
or your website password. There is no Keychain/profile access during module
import or `createExtractor()` construction. Each method reloads the profile;
an analysis loads it once for all sections.

Both session sources share scoped HTTP delivery, isolated Chromium contexts and
cache bypass described below. `cookiesFromBrowser` conflicts with `cookieFile`
and an explicit Cookie header; `browserProfile` requires `cookiesFromBrowser`.
Unsupported platforms, formats, denied Keychain access and unreadable/locked
databases raise sanitized `FetcharyValidationError`; cancellation raises
`FetcharyFetchError`. Keychain lookup is bounded by `min(timeout, 30000)` ms.
See the [CLI reference](CLI.md#chrome-on-macos) for supported schemas/encryption,
size limits and profile examples. No live authenticated LinkedIn result is
guaranteed by this API.

### Interactive login and saved sessions

```js
const readline = require('node:readline/promises');
const { login, extractMetadata, listSessions, logout } = require('fetchary');

async function main() {
    await login('https://www.linkedin.com', {
        session: 'linkedin',
        confirm: async ({ signal }) => {
            const terminal = readline.createInterface({ input: process.stdin, output: process.stderr });
            try { await terminal.question('Sign in in the browser, then press Enter: ', { signal }); }
            finally { terminal.close(); }
        },
    });
    const result = await extractMetadata('https://www.linkedin.com/in/oliverjessner', {
        session: 'linkedin', mode: 'browser',
    });
    console.log(result.data, await listSessions());
    await logout('linkedin'); // Remove only Fetchary's local session file.
}
main().catch(console.error);
```

`login(url, options)` requires `confirm({ session, origin, signal })`, which must
resolve after the user has completed website login in the visible browser.
Reject the callback or abort the signal to cancel without saving. The result is
`{ session, origin, savedAt, cookieCount }`, with no cookie values. Saving indicates
that relevant cookies were captured; it does not verify account authorization.

`LoginOptions` accepts `session` (default: target hostname), `sessionDir`
(default: `~/.fetchary/sessions`), `signal`, `timeout` (overall default 300000 ms),
`allowPrivateNetwork`, `insecure` (default: `true`), `lookup` and a separate
`launchBrowser` callback. Login's launcher receives `headless: false`,
`defaultViewport: null`, `acceptInsecureCerts` matching `insecure`, a bounded launch
timeout and AbortSignal; unlike extraction's launcher it does not set a proxy or
replace native browser networking. It must return `LoginBrowser`, with
`createBrowserContext()` returning `newPage()`, `cookies()` and `close()`. Optional
browser `disconnected` and page `close` events support immediate cancellation.
The bundled implementation uses Puppeteer's [isolated browser contexts](https://pptr.dev/api/puppeteer.browser.createbrowsercontext)
and [context cookies](https://pptr.dev/api/puppeteer.browsercontext.cookies).

Browser launch failures use `FetcharyBrowserError` with `phase: 'launch'`.
A missing Puppeteer-managed Chrome includes a matching browser-install command
in the message; arbitrary login launcher/protocol details remain redacted.
See the [CLI setup instructions](CLI.md#interactive-browser-login).

Only unexpired, unpartitioned cookies belonging to the login hostname tree or
matching parent cookie domain are exported; unrelated SSO-provider cookies are
discarded. localStorage, IndexedDB and saved passwords are not exported. Website
MFA and other checks are completed manually. Some sites may reject this browser
or use authentication stores that cookie-only sessions cannot reproduce.

The login command explicitly persists credentials in JSON files with private
permissions (POSIX directory `700`, file `600`); these files are not encrypted.
Writes replace the named session atomically, and errors/cancellation preserve the
previous file. Session files and the session directory cannot be symlinks.
The [CLI reference](CLI.md#interactive-browser-login) defines session names,
storage, output and cancellation behavior.

`session?: string` and `sessionDir?: string` are common extraction options across
all explicit methods, dispatcher, analysis and isolated clients. They load the
saved cookies afresh, restrict use to the login hostname or its descendants,
bypass all capture caches and share existing scoped HTTP/cookie-context rules.
Extraction never changes the session file. `session` conflicts with `cookieFile`,
`cookiesFromBrowser` and a caller Cookie header; `sessionDir` requires `session`.
No saved session is selected implicitly, and importing the package or creating
an extractor does not access session files.

`listSessions({ sessionDir?, signal? })` returns `SessionInfo[]`, with `session`,
`origin`, `savedAt`, `cookieCount` and `activeCookieCount`, never cookie values.
Missing directories produce `[]` without creating files; corrupt/unreadable
entries fail with `FetcharyValidationError`.
`logout(name, { sessionDir?, signal? })` returns `{ session, removed }`; a missing
session is a successful no-op and does not log out other browsers or revoke the
website account. These three session-management methods are top-level exports.

For explicit bulk removal, pass session names or an exact domain:

```js
const { logout } = require('fetchary');

async function main() {
    const selected = await logout(['work', 'personal']);
    const matching = await logout({ domain: 'example.com' }, { sessionDir: '/private/sessions' });
    console.log(selected.removed, matching.failed, matching.sessions);
}
main().catch(console.error);
```

Both bulk forms return `{ removed: number, failed: number, sessions:
Array<{ session: string, removed: boolean, error?: string }> }`. Names are
validated before removal and duplicate names are processed once. Domain
selection matches the saved origin's exact hostname; it accepts no scheme,
port, path or wildcard and does not include subdomains automatically. A failure
removing one selected file is recorded without hiding other results. Invalid
selection, session-listing failures or cancellation reject the operation.

### Cookie-file authentication

```js
const { extractSocialInsights, createExtractor } = require('fetchary');

async function main() {
    const url = 'https://www.linkedin.com/in/oliverjessner';
    const result = await extractSocialInsights(url, {
        mode: 'browser', cookieFile: '/absolute/path/to/linkedin-cookies.txt',
    });
    console.log(result.followers, result.data.status);

    const client = createExtractor({ cookieFile: '/absolute/path/to/linkedin-cookies.txt' });
    await client.extractMetadata(url, { mode: 'http' });
    await client.analyse(url);
}
main().catch(console.error);
```

`cookieFile?: string` is a common `ExtractionOptions` field, available on explicit
methods, the dispatcher, analysis and isolated clients. The file is read afresh
per operation, never modified or copied into persistent application state. An
analysis imports it once and shares that session among its eleven extractors.
Authenticated page captures bypass completed cache entries and in-flight work
in both global and private-client caches; `cache.ttlMs` is 0. Anonymous cache
entries are neither overwritten nor reused for cookie-file calls.

[CLI cookie-file documentation](CLI.md#signed-in-sessions) defines accepted
Netscape/JSON formats, validation, bounds and exact hostname/path behavior.
The native HTTP transport computes scoped Cookie headers on every redirect,
including auxiliary icon requests. Browser mode seeds a fresh isolated (incognito) context with
relevant cookies using [BrowserContext.setCookie](https://pptr.dev/api/puppeteer.browsercontext.setcookie).
It preserves HttpOnly, Secure, expiry and SameSite attributes, supports JS-readable
cookies, and allows normal in-memory browser session updates. Imported credentials
are stripped from requests outside the initially requested hostname tree.
The HTTP phase uses the exported values; refreshed browser cookies stay in that
browser run and are not written back to the export.

A custom extraction `launchBrowser` used with any session source must expose
`browser.createBrowserContext()` returning a context with `setCookie()`,
`newPage()` and `close()`; `CaptureCookieData` documents the values
passed to it. Protocol errors during cookie import are sanitized rather than
retaining a cause which might contain serialized credentials. File and format
failures are `FetcharyValidationError`; browser import failures are
`FetcharyBrowserError` with `phase: 'cookies'`. Cookie values and file contents
are absent from result metadata and diagnostics. `cookieFile` cannot be combined
with a caller-provided Cookie header. No cookie file is read during import or
`createExtractor()` construction; validation and I/O happen when a method runs.

An authenticated session may still encounter access checks. This option does
not automate login or guarantee LinkedIn availability, and it imports no saved
passwords or browser-profile data.

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
| `umami` | `analytics` | Scoped `website-id` from script configuration or supported inline configuration |
| `posthog` | `analytics` | Scoped `project-token` from `posthog.init(...)` and its declared `api_host` |
| `goatcounter` | `analytics` | `site-endpoint` from the embedded `data-goatcounter` destination |
| `cloudflare-web-analytics` | `analytics` | `site-token` from the beacon URL, `data-cf-beacon` or supported inline configuration |
| `simple-analytics` | `analytics` | Hosted or configured alternative scripts; optional `configuration.trackedDomains` |
| `adobe-experience-platform-tags` | `tag-manager` | Scoped `library-id` from a recognized Adobe Launch script URL |
| `reddit-pixel` | `advertising` | `pixel-id` from supported `rdt('init', ...)` or pixel URL configuration |
| `x-pixel` | `advertising` | `pixel-id` from supported `twq('config', ...)` or `twq('init', ...)` |

Known provider script references are reported even without an identifier.
Resource signatures use known provider hosts and paths, plus Matomo/Piwik file
names for self-hosting. Plausible recognizes its hosted `/js/*.js` scripts and
self-hosted script/plausible filenames with `data-domain`. Renamed proxies,
obfuscated integrations and vendor formats outside these signatures can be missed.
Signature examples follow the vendors' [Google tag](https://developers.google.com/tag-platform/gtagjs/install),
[Matomo](https://developer.matomo.org/guides/tracking-javascript-guide),
[Pinterest](https://help.pinterest.com/en-gb/business/article/add-event-codes) and
[Plausible](https://plausible.github.io/docs/plausible-script) documentation.

Scope is part of identifier identity for self-hosted integrations such as Umami
and PostHog. An ID with unknown server scope is not a globally unique correlation
key. Simple Analytics domains describe configured tracking destinations rather
than account IDs. Detectors inspect embedded page code and configuration only;
none of these additions call provider APIs or fetch their scripts.

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
Plausible/Simple Analytics domains. It is not a count of globally unique accounts.

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
calling application. Extraction does not persist these results.

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
    console.log(metadata.data.authors, metadata.data.scientific);
    console.log(structured.data.jsonLd, structured.data.resolved);
}
main().catch(console.error);
```

See [record schemas and precedence](#metadata-and-structured-data-records) and the
[CLI reference](CLI.md#metadata-and-structured-data) for list output, parsing
limits, diagnostics, standalone JSON-LD, and browser fallback behavior.

`links` and `documents` accept `includeSelectors` and `ignoreSelectors`, following
the text/HTML selection rules. Discovery keeps the original document base and
DOM locations. Each occurrence is returned separately, including repeated URLs.
`extractLinks()` also reads URL and index XML sitemaps, including default/prefixed
namespaces, XML entities and CDATA. It reads direct `<loc>` entries for each
page/sitemap, without fetching them, and preserves optional `lastmod`,
`changefreq` and numeric `priority` fields. Missing or invalid optional values
are `null`; no freshness or crawl behavior is inferred. Sitemap results use `source: 'loc'` and
`location.attribute: 'textContent'`. Scoping selectors apply to the XML DOM;
the final captured URL is the base for relative values. See the
[sitemap CLI examples](CLI.md#links-from-xml-sitemaps).
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

`videos` accepts the common capture options plus `includeSelectors` and
`ignoreSelectors` (`LinksOptions`). It returns every discovered video reference,
including repeated URLs, in `data` and the `videos` alias. It works through
`extract(url, { type: 'videos' })` and isolated clients' `extractVideos()` methods.

```js
const { extractVideos } = require('fetchary');

async function main() {
    const result = await extractVideos('https://example.com', {
        includeSelectors: ['main'],
    });
    console.log([...new Set(result.data.map(video => video.url))]);
}
main().catch(console.error);
```

```ts
type VideoLink = {
    url: string;
    rawUrl: string;
    source: string; // DOM tag, or 'json-ld'
    originalAttribute: string; // e.g. src, href, contentUrl, or textContent
    extension: string | null;
    contentType: string | null;
    platform: Platform | null;
    postUrl?: string; // Original public Telegram post for a matching media widget.
};
type VideosResult = ExtractionResult<VideoLink[], 'videos'> & { videos: VideoLink[] };
```

Video discovery reads media elements, video files/streams, recognized platform
links and players, Open Graph/Twitter metadata and Schema.org VideoObject
references. URLs are resolved against the full document base. Format and MIME
fields are hints, and targets are not downloaded or verified. Results use the
existing capture cache, limits, cancellation and HTTP/browser fallback rules.
See the [video CLI reference](CLI.md#videos) for sources, supported extensions,
scope rules, list output and discovery limits.

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

Both methods accept `details: true` for rich records while retaining `string[]`
by default. Email extraction also accepts `deobfuscate: true` to read explicit
bracketed spellings such as `sales [at] example [dot] com` (also parenthesized or
braced `at`/`dot` and `punkt`). This is opt-in and does not evaluate scripts or
guess unrestricted prose. `deobfuscate` is not a telephone option.

```js
const { extractEmails, extractTelephone } = require('fetchary');

async function main() {
    const emails = await extractEmails('https://example.com/contact', {
        details: true, deobfuscate: true,
    });
    const phones = await extractTelephone('https://example.com/contact', {
        details: true, defaultCountry: 'AT',
    });
    console.log(emails.data, phones.data);
}
main().catch(console.error);
```

```ts
type ContactDetail = {
    value: string;
    raw: string;
    label: string | null;
    department: string | null;
    location: string | null;
};
type TelephoneDetail = ContactDetail & {
    kind: 'fax' | 'mobile' | 'landline' | null;
};
```

`value` is normalized; `raw` preserves the matched spelling. Labels and department
names come from nearby page text, explicit attributes or declared contact
fields, with unknown values left `null`. Telephone kind requires an explicit
fax/mobile/landline label; a generic “Telephone” label does not establish a
landline. `location` identifies the captured DOM element (or a script contact
field), and is `null` when the contact is available only from unlocated text.
Deduplication still uses the normalized contact value. TypeScript infers rich
arrays for literal `details: true`, strings when omitted/false, and their union
for a boolean variable. Dispatcher and isolated-client calls share this behavior.

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
`sources`, an array selecting `img`, `srcset`, `lazy`, `metadata`, `link`,
`background`, or `stylesheet`. It inspects `src`, `srcset`, picture sources, common lazy attributes,
Open Graph/Twitter images, image-file hyperlinks, and inline CSS background URLs.
It does not request binary images or compute styles. URLs resolve
against the document base, retain deterministic discovery order, and must be
HTTP(S) without credentials. HTML dimensions are unverified hints.

`includeStylesheets` defaults to `true`. Image discovery also inspects page
`style` blocks and linked stylesheets for CSS background-image URLs, including
bounded `@import` traversal. It reads at most eight external CSS resources,
512 KiB each, 4 MiB total, to an import depth of two; `maxResponseBytes` can
lower these limits. Requests use the same URL, DNS, redirect, timeout and
cancellation guards as page resources. Missing, inaccessible or non-CSS
resources are ignored; cancellation still rejects. Found backgrounds have
`source: 'stylesheet'`, `originalAttribute: 'background-image'` and
`stylesheetUrl` identifying their CSS base. No background image is downloaded.
Use `includeStylesheets: false`, or a `sources` selection excluding `stylesheet`,
to avoid the extra CSS requests. CSS media rules are discovery hints rather than
proof that a background was visible in the rendered page.

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

Favicon discovery includes Safari `mask-icon` links. Regular icons, Apple touch
icons, manifest icons and the normal fallback take precedence over monochrome
mask icons; candidates within a priority group retain scalable-image,
verified-area and document-order ranking.

`extractFavicon(url, { all: true })` returns all accessible, checked candidates in
that ranking as `data: ExtractedImage[]` and `images`, with the first candidate
also available as `image`. Invalid or inaccessible candidates are omitted, and
no usable candidate still raises `FetcharyNotFoundError`. It uses the same
candidate limits as ordinary favicon selection. `all: true` cannot be combined
with `binary: true`; this rejects with `FetcharyValidationError`. The dispatcher
and isolated clients support the same options and TypeScript result inference.

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
    type: 'text' | 'html' | 'favicon' | 'images' | 'videos' | 'avatar'
        | 'selector' | 'social-links' | 'social-insights' | 'emails' | 'telephone'
        | 'links' | 'documents' | 'metadata' | 'structured-data' | 'tracker-intelligence' | 'price';
    captureMode: 'http' | 'browser';
    status: number;
    contentType: string | null;
    dismissedOverlays: string[];
    consent: ConsentMetadata;
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
// With details: true, respectively:
data: ContactDetail[] | TelephoneDetail[];

// links / documents (types detailed below)
data: ExtractedLink[] | DocumentLink[];

// videos (type detailed above)
data: VideoLink[];

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
// favicon with all: true (image is the first entry, images aliases data)
data: ExtractedImage[];

// avatar
data: { platform: string; profile: string | null; image: /* favicon image shape */ unknown };

// images
data: Array<{
    url: string; alt: string; width: number | null; height: number | null;
    source: 'img' | 'srcset' | 'lazy' | 'metadata' | 'link' | 'background' | 'stylesheet';
    originalAttribute: string; resolutionVerified: false;
    stylesheetUrl?: string;
}>;

// selector
data: { matched: boolean; values: Array<string | null> };

// social-links
data: Array<{
    platform: string; url: string;
    kind: 'profile' | 'channel' | 'post' | 'video' | 'repository' | 'release' | 'unknown';
    source: 'link' | 'rel-me' | 'metadata' | 'json-ld';
}>;

// social-insights
data: {
    platform: string | null; kind: 'profile' | 'channel' | 'post' | 'video' | 'repository' | 'release' | 'unknown';
    url: string;
    metrics: {
        likes: number | null; comments: number | null; views: number | null;
        shares: number | null; saves: number | null; followers: number | null;
        following: number | null; posts: number | null; subscribers: number | null;
        score: number | null; stars: number | null; forks: number | null; karma: number | null;
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
and `vendor`; insights have `vendor` and `followers` (falling back to available
channel subscribers). Link results also have `links`; document results have `documents`.
Metadata results have `metadata`; structured-data results have `structuredData`.
Prefer `data` for new integrations.

### Metadata and structured-data records

```ts
type MetadataPerson = { name: string | null; url: string | null };
type MetadataEvidence = {
    value: string; raw: string;
    source: 'html' | 'meta' | 'json-ld' | 'microdata';
    field: string;
};
type MetadataField = 'title' | 'description' | 'publishedAt' | 'modifiedAt';
type PageMetadata = {
    title: string | null;
    description: string | null;
    canonical: string | null;
    language: string | null;
    publishedAt: string | null;
    modifiedAt: string | null;
    authors: MetadataPerson[];
    publisher: MetadataPerson | null;
    openGraph: Record<string, string[]>;
    twitter: Record<string, string[]>;
    scientific: {
        doi: string | null; authors: string[];
        journal: string | null; pdfUrl: string | null;
    };
    sources: Record<MetadataField, MetadataEvidence | null>;
    alternatives: Record<MetadataField, MetadataEvidence[]>;
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
    resolved: {
        roots: string[];
        entities: Record<string, {
            id: string;
            types: string[];
            properties: JsonObject;
        }>;
    };
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

`authors` combines explicit author metadata, `rel="author"` links, scientific
citation authors and eligible page/article schema authors; profile URLs are
resolved against the document base. `publisher` uses eligible schema or explicit
publisher metadata. These records do not fetch people or publisher pages.
`openGraph` and `twitter` retain every matching meta content attribute value
after HTML entity decoding, including repeated keys and original whitespace,
under normalized lowercase field names.

`sources` identifies the selected title, description and date values with their
original spelling, source category and field. `alternatives` retains differing
values encountered at the other eligible locations; it does not replace the
existing precedence. Scientific metadata recognizes declared citation/DC author
fields, citation/PRISM DOI fields, journal title and `citation_pdf_url`. DOI URL
prefixes are removed only when the remainder has DOI syntax. Unknown values
stay `null` or empty arrays. DOI and PDF targets are not requested.

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

`resolved` adds a local JSON-LD entity table alongside untouched `jsonLd` and
`microdata`. Page-relative `@id` values use the document base; definitions sharing
an ID are merged, repeated types/values are deduplicated, and anonymous root or
typed nodes receive local blank-node IDs. `roots` identifies the root entities
(or nodes in a graph-only container). Identified/typed nested objects become
`{ "@id": "..." }` references into `entities`, so cyclic references remain
serializable. Missing local definitions produce entries with no properties;
they do not trigger a network lookup. Anonymous IDs are capture-local identifiers.
The model does not expand JSON-LD contexts, fetch external vocabularies or claim
full RDF semantics. Resolution is bounded to 10000 values and 64 levels; a limit
adds a diagnostic and can leave a partial entity table while preserving raw data.

### Link and document records

```ts
type LinkLocation = {
    pageUrl: string;
    selector: string;
    attribute: 'href' | 'src' | 'data' | 'textContent';
};
type ExtractedLink = {
    url: string;
    rawUrl: string;
    text: string;
    rel: string[];
    internal: boolean;
    source: 'a' | 'area' | 'link' | 'loc';
    location: LinkLocation;
    lastmod?: string | null;
    changefreq?: string | null;
    priority?: number | null;
};
type DocumentLink = Omit<ExtractedLink, 'source'> & {
    source: Exclude<ExtractedLink['source'], 'loc'> | 'iframe' | 'embed' | 'object';
    filename: string | null;
    extension: string | null;
    contentType: string | null;
    detectedBy: 'url' | 'query' | 'download' | 'type';
};
```

`rawUrl` is the original DOM attribute value after HTML entity decoding, or the
decoded `<loc>` text for sitemap links. `text`
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

`score` is the only signed metric; all ordinary counts remain nonnegative.
It reports Reddit's net score or Hacker News points and cannot establish individual vote totals.
Structured integers are exact as reported by the page. Compact counts such as
`12K`, `12.5K`, `1.2M`, and `1,2 Mio.` are normalized with `approximate: true`.
With a suffix, comma/period is a decimal separator; without one, only integers
and valid thousands grouping are accepted (`12.345`, `12,345`, `12 345`).
Existing follower parsers may not preserve the exact source token; those sources
use `approximate: null` unless a matching compact token is known. This indicates
unknown precision, never a claim of exactness. `field` names identify an embedded
field, JSON-LD statistic, or the legacy vendor parser used.
YouTube's rendered comment header is reported as source type `vendor` with field
`ytd-comments-header-renderer.#count`, scoped to the matching watch video.
During browser capture, the YouTube adapter keeps the comment heading in view
within the configured `waitAfterLoad` period to trigger lazy loading.
It reads the reported total without paginating or counting loaded threads;
disabled or unavailable totals stay `null`.

The metrics object always contains thirteen fields: `likes`, `comments`, `views`,
`shares`, `saves`, `followers`, `following`, `posts`, `subscribers`, `score`,
`stars`, `forks` and `karma`. Stars, forks and karma retain their own meaning
instead of being reported as followers or likes.

Additional HTML adapters and URL kinds include:

| Platform / URL kind | Exposed data and boundaries |
| --- | --- |
| Telegram public channel | `subscribers` and channel-avatar candidates from matching public channel HTML |
| Telegram public post | `views` from the matching visible message widget; discovered videos can carry `postUrl` |
| Hacker News item | `score` and `comments` from its matching item row; a reported `discuss` link means zero comments |
| Hacker News user | `karma` from the matching profile table; username case is preserved |
| GitHub repository | `stars` and `forks` from matching repository HTML, separately from user follower counts |
| GitHub release URL | Classified as `release`; recognizing that URL does not imply release-engagement metrics |

Library platform names are `telegram` and `hackernews`. Telegram supports
`t.me`/`telegram.me` public channel and numeric-post paths, including `/s/`
previews. Direct public post URLs are captured through their `/s/` preview while
retaining the requested URL. Private `/c/` paths, invitation/reserved routes and
unrelated or forwarded message identities do not supply another post's values.
No Telegram or Hacker News API is called. New metrics follow the existing
identity, visibility, missing-value and provenance rules; these are supported
HTML patterns rather than guarantees that every live page exposes every field.

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
    console.log(extractor.getCacheStats());
    extractor.clearCache();
}
main().catch(console.error);
```

`createExtractor(options?)` is synchronous and lightweight. It returns all
extraction functions and `analyse()` plus `configure()`, `getCacheStats()` and `clearCache()`, with
an isolated cache and copied headers. See [client configuration](#configure-a-library-client)
for changing capture defaults. Per-call options override defaults without mutating another client.
Per-call headers replace default headers. `maxEntries` and `maxCacheBytes` are
client-only non-negative safe integers; zero retains no completed entries.

`client.getCacheStats()` returns an independent snapshot:

```ts
type CaptureCacheStats = {
    hits: number; misses: number; deduplicated: number;
    loads: number; failures: number; evictions: number;
    expired: number; bypasses: number;
    entries: number; bytes: number; pending: number;
    maxEntries: number; maxCacheBytes: number;
};
```

Counters cover that client's cache lifetime. `hits` counts completed captures
reused; `misses` includes in-flight joiners; `deduplicated` counts those joiners;
`loads` counts new load attempts, including bypasses; `failures` counts failed
loads rather than every joining caller. `evictions` counts capacity removals,
`expired` counts TTL pruning, and `bypasses` counts captures with effective TTL
zero. `entries`, `bytes` and `pending` describe current retained captures,
estimated payload bytes and attached in-flight work. Limits are the configured
capacities. Clearing removes entries and detaches pending work while keeping
lifetime counters; it does not reset statistics or count as an eviction.

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
TLS certificate-verification policy, consent policy, browser resource filters and browser wait settings. HTTP and browser
snapshots are separate. Extraction selectors and formats do not change a page
snapshot's key.

Cookie-file and browser-cookie requests bypass all capture caches, including isolated clients.
Authorization, Cookie, and Proxy-Authorization headers bypass the shared global
cache. Private clients isolate their authenticated entries by complete headers.
Never change a custom transport's hidden session while retaining its entries;
clear the client or create a new one when switching contexts. Responses setting
cookies, private/no-store/no-cache responses, partial content, recognizable login
or CAPTCHA pages, unresolved consent captures, and invalid/incomplete captures are not retained. URL, DNS,
and redirect-target validation still run on cache hits.

The cache is process-local. Separate CLI executions start empty. Image candidate
checks are separate requests, while the primary webpage capture is shared.

## Network safety and dependency injection

Fetchary defaults to `insecure: true` for OSINT collection from servers with
invalid certificates:

```js
const { extractFavicon, createExtractor } = require('fetchary');

async function main() {
    const icon = await extractFavicon('https://www.faktor3.de');
    console.log(icon.image.url);

    const research = createExtractor();
    const report = await research.analyse('https://example.com');
    console.log(report.results.metadata?.data);
    // Per-call options override the client's defaults.
    await research.extractText('https://example.com', { insecure: false });
}
main().catch(console.error);
```

`insecure` must be a boolean and defaults to `true`. Set `insecure: false` for
certificate-chain and hostname verification. Set that option on `createExtractor()`
to make verification the client's default, or override it on an individual call.
The option applies to all extraction methods, the dispatcher, `analyse()` and
isolated clients, including HTTP capture,
auto fallback, guarded Chromium resources, redirects, manifests and image
candidate downloads. The default skips certificate-chain and hostname verification,
including self-signed, expired, untrusted or incomplete certificates. TLS
handshakes and HTTP status handling still apply.

The policy is local to the operation or client. It does not change Node's
global TLS environment or trust store. Verified and unverified captures and
HTTPS connection pools stay separate; a later `insecure: false` call cannot reuse
an unverified snapshot or socket. Login also defaults to `insecure: true` through
Puppeteer's `acceptInsecureCerts`; saved sessions do not store the policy.
Custom browser launchers receive `acceptInsecureCerts` and must honor it. A custom
`fetch` implementation controls its own TLS policy and must be configured
separately to accept certificate errors.

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
The bundled Chromium capture uses CDP request-body entries to preserve binary
POST payloads, including compressed JSON. Custom browser implementations without
those entries support textual bodies; unavailable binary bodies fail rather than
being forwarded as corrupted UTF-8 text. Request bodies remain in memory only
for the capture and are never included in output or command history.

## Errors, TypeScript, and compatibility

Errors inherit from `FetcharyError`: `FetcharyValidationError` for invalid options,
unsafe URLs and invalid selectors; `FetcharyFetchError` for HTTP/DNS/timeout/abort
failures; `FetcharyBrowserError` for browser failures; `FetcharyNotFoundError`
for inaccessible favicon/avatar candidates. A failed browser resource download
is a `FetcharyBrowserError` with `phase: 'resource'` and its original transport
error in `cause`. Byte-limit errors include the effective `maxResponseBytes`
and a recovery hint without echoing resource URLs into the top-level message.
The default 45 MiB limit applies to external scripts as well as the document and
rendered HTML; large bundles may require an explicit override, for example
`{ mode: 'browser', maxResponseBytes: 64 * 1024 * 1024 }`. The aggregate browser
resource budget remains four times that limit (180 MiB by default). Insights can
instead return explicit availability, as documented above. Type declarations are
bundled in [`src/index.d.ts`](../src/index.d.ts), including dispatcher result inference.

Version 2 removes the old `Fetchary` class, `createFetchary()`, stored-source,
archive, scheduler, diff, vendor-activation and database APIs. They have no runtime
replacement or automatic migration. Historical user directories are never read,
written, migrated or deleted by extraction.

CLI `--filepath` output exports and command history are separate from the library.
Extraction methods still do not save their results or record commands. The
executable records up to 100 recent commands; see the
[CLI reference](CLI.md#command-history) for storage and opt-out behavior.

## Development checks

```bash
npm test
npm run test:coverage
```

Both commands run at most two test files concurrently so browser integration
tests do not compete with a CPU-scaled number of Chromium instances. The
resource-limit, contact and one-shot browser fixtures allow 15 seconds per
capture, including startup, navigation and snapshotting. Explicit short timeout
and cancellation tests retain their own budgets. Production capture timeouts
continue to come from the caller's `timeout` option.

## Product prices

```js
const { extractPrice, extract, createExtractor } = require('fetchary');

async function main() {
    const url = 'https://example.com/product';
    const price = await extractPrice(url);
    const generic = await extract(url, { type: 'price' });
    const client = createExtractor({ cacheTtlMs: 45000 });
    const cached = await client.extractPrice(url);
    const scoped = await client.extractPrice(url, {
        mode: 'browser',
        productSelector: '#product-detail',
        priceSelector: '.current-price',
        country: 'AT', language: 'de-AT',
    });
    console.log(price.data, generic.data, cached.cache, scoped.data);
}
main().catch(console.error);
```

All entry points share one implementation. `PriceOptions` extends
`ExtractionOptions` with optional `productSelector` and `priceSelector` strings.
It also accepts `country` (two-letter format, normalized to uppercase) and
`language` (a valid language tag, canonicalized by `Intl`). They are returned
as `data.context`, with omitted values `null`. A requested language supplies
`Accept-Language` unless the caller already supplied that header; browser
language follows that header. Country records the requested context only: it
does not geolocate requests, choose a shop region, infer a currency or establish
that the shop honored the request. There is no currency conversion.
Selectors use the existing CSS validation before capture; empty or malformed
selectors reject with `FetcharyValidationError`. A valid selector matching
nothing succeeds. Product scope applies to DOM prices; structured evidence is
still examined and associated independently. No selector makes unrelated
products comparable. `analyse()` includes `results.price` after
`results['tracker-intelligence']`; unavailable prices count as a successful section.

### Matching and conflicting snapshots

This runnable fixture needs no live shop or browser:

```js
const { extractPrice } = require('fetchary');

async function snapshot(declared) {
    const html = `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Product',
        name: 'Example Product',
        offers: { '@type': 'Offer', price: declared, priceCurrency: 'EUR' },
    })}</script><main><h1>Example Product</h1>
    <span class="current-price">89,90 €</span></main>`;
    return extractPrice('https://example.com/product', {
        mode: 'http', cacheTtlMs: 0,
        fetch: async () => new Response(html, {
            headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    });
}
async function main() {
    const conflict = await snapshot('99.90');
    console.log(conflict.data.status);   // conflict
    console.log(conflict.data.selected); // null
    console.log(conflict.data.candidates.map(p => [p.amount, p.currency]));
    // [ [ '99.90', 'EUR' ], [ '89.90', 'EUR' ] ]
    const matching = await snapshot('89.90');
    console.log(matching.data.status);   // consistent
    console.log(matching.data.selected.evidence.length); // 2
}
main().catch(console.error);
```

Complete serialized examples are available for a [conflicting snapshot](examples/price-conflict.json)
and a [matching snapshot](examples/price-consistent.json), generated with an
injected fixture response rather than a live product page.

Neither JSON-LD nor page text wins a disagreement. A conflict is a successful
extraction, with `selected: null` and a `PRICE_MISMATCH` issue. The top-level
numeric `status` is the HTTP status; `data.status` is the price resolution:

| Status | Resolution |
| --- | --- |
| `consistent` | Comparable current values agree across different source categories; all locations remain |
| `single_source` | One normalized current value from one source category, possibly with repeated locations |
| `conflict` | Same product, current role, currency and declared conditions have different amounts |
| `ambiguous` | Unknown currency, uncertain product, incompatible conditions/identities, ambiguous number format or extraction limits prevent selection |
| `unavailable` | No usable current price; candidates may still contain list, unit or range prices |

`selected` is a complete candidate or `null`. Agreement merges normalized
amounts only when product, currency, role, association and conditions match.
`candidate.raw` is the first original spelling; `evidence[].raw` preserves each
spelling separately, including display qualifiers removed for parsing. Repeated
DOM elements and identical raw/rendered markup do not establish independent
confirmation. `consistent` requires agreement across source categories, such as
JSON-LD and DOM. A range-only page has no selected current price.

### Complete provenance schema

Every price result has the ordinary `ExtractionMetadata` fields (`requestedUrl`,
`finalUrl`, `rawFinalUrl`, `capturedAt`, `extractedAt`, `status`, `contentType`,
`captureMode`, `dismissedOverlays`, `cache`) and `type: 'price'`:

```ts
type PriceProduct = {
    id: string | null; name: string | null;
    url: string | null; sku: string | null;
    variant?: {
        size: string[]; color: string[]; material: string[];
        model: string[]; configuration: string[];
    };
};
type PriceShipping = {
    cost: { amount: string; currency: string | null } | null;
    regions: Array<{
        country: string | null; region: string | null; postalCode: string | null;
    }>;
    deliveryTime: {
        handling: { min: string | null; max: string | null; unit: string | null } | null;
        transit: { min: string | null; max: string | null; unit: string | null } | null;
    } | null;
};
type PriceEvidence = {
    source: 'json-ld' | 'visible-dom' | 'microdata' | 'meta';
    document: 'raw' | 'rendered';
    locator: string;
    url: string;                 // source document's final URL
    raw: string;                 // exact original extracted value
    capturedAt: string;          // source snapshot timestamp, preserved on cache hits
    captureMode: 'http' | 'browser';
    scriptIndex?: number;        // zero-based JSON-LD block index, including malformed blocks
    attribute?: string;          // content, textContent, data-price, etc.
    visibility?: 'static-not-hidden' | 'rendered-not-hidden' | 'computed-visible';
};
type PriceCandidate = {
    amount: string;              // decimal string, never a floating-point amount
    currency: string | null;    // ISO 4217 or unknown
    role: 'current' | 'list' | 'unit' | 'subscription' | 'installment'
        | 'range-min' | 'range-max';
    raw: string;
    product: PriceProduct | null;
    association: 'matched' | 'uncertain';
    conditions: Record<string, string>;
    shipping: PriceShipping[];
    evidence: PriceEvidence[];
};
type PriceIssue = {
    code: string; message: string;
    document?: 'raw' | 'rendered'; scriptIndex?: number;
    locator?: string; raw?: string | null;
};
type PriceData = {
    status: 'consistent' | 'conflict' | 'single_source' | 'ambiguous' | 'unavailable';
    selected: PriceCandidate | null;
    product: PriceProduct | null; // associated current product, null when uncertain
    candidates: PriceCandidate[];
    issues: PriceIssue[];
    context: { country: string | null; language: string | null };
};
type PriceResult = ExtractionResult<PriceData, 'price'>;
```

JSON-LD `locator` is rooted at `$` in its originating script. Identifier-like
properties use dot notation, other keys use JSON-quoted brackets, and arrays use
zero-based indexes: `$["@graph"][0].offers.price`. DOM/Microdata/meta locations
are deterministic CSS paths with `:nth-child` positions. Combined with
`attribute`, document, URL and raw value they identify the exact extraction
location. These selectors locate the captured snapshot, not a future page.

Conditions preserve declared Schema.org tax, customer/region/quantity/member,
billing, unit, validity, seller, availability and shipping terms as JSON-encoded
strings, plus recognized DOM condition attributes/display text. Conditions must
agree exactly for comparison. Unspecified terms cannot prove equivalence to a
different explicit condition. Empty conditions mean no qualifiers were found;
they do not verify tax treatment or customer eligibility.

`shipping` additionally normalizes declared shipping rates, destinations and
handling/transit ranges while retaining the original `conditions` evidence.
Amounts and time quantities remain decimal strings; missing shipping costs are
`null`, never assumed free. Destinations preserve declared country/region/postal
information. `variant`, when present, contains explicitly supplied size, color,
material, model and configuration arrays from supported schema/DOM fields. It
does not infer product options from marketing copy or combine distinct variants.

Issue codes include `PRICE_MISMATCH`, `PRICE_AMBIGUOUS`, `INVALID_AMOUNT`,
`AMBIGUOUS_NUMBER`, `AMBIGUOUS_CURRENCY`, `INVALID_JSON_LD`, and
`EXTRACTION_LIMIT`. Invalid monetary values are diagnosed rather than emitted as
usable candidates. Issues include the raw value and location where available.

### Sources, identity and limits

JSON-LD supports Products, Offers and AggregateOffers, nested arrays/objects,
multiple blocks, `@graph`, `@id` references within a document, type arrays,
Schema.org URL-form types/properties, price specifications and unit/range roles.
Offers remain attached to their products; document URL/canonical identity,
`mainEntity`, product heading and explicit Microdata scope help identify the
current product. Conflicting product identities or variants remain separate.
External product URLs and recognized recommendation containers are excluded;
listing pages without a unique association stay ambiguous. A lone unassociated
Offer is scoped to the page; multiple unassociated current offers are uncertain.

DOM extraction looks for price-related classes/IDs, monetary leaf text, semantic
price attributes and explicit selectors. Crossed-out/old/list prices, units,
subscriptions and installments have separate roles. Explicit display ranges
using an en/em dash, spaced hyphen or `to` retain both endpoints. Microdata
prices preserve their property element and attribute; metadata supports `price`
with `priceCurrency`, `product:price:amount`, `og:price:amount`,
`product:sale_price:amount` and `product:original_price:amount`, paired with their
corresponding `:currency` meta values. These remain separate source categories.

Scripts/styles/templates, navigation, footers, advertisements and recognized
recommendations are excluded from DOM prices. Hidden/aria-hidden and inline
`display:none`/`visibility:hidden` elements are ignored. Ordinary browser price
captures also run a bounded computed-style scan for `display`, `visibility`,
`opacity` and `content-visibility`, including external stylesheet effects.
Completed scans label retained rendered DOM evidence `computed-visible`.
When such a reliable scan exists, raw visible-DOM candidates are omitted so a
pre-render value hidden by CSS cannot re-enter through raw markup; raw JSON-LD,
Microdata and metadata evidence remain available. A missing or truncated scan
keeps qualified markup-only visibility and reports limits where relevant.
Viewport position and occlusion are not established: `computed-visible` does
not prove that a human saw the price.

There are no retailer adapters or AI guesses. Unrecognized condition wording,
complex price displays or identities may require selectors or remain unavailable
or ambiguous. The extractor cannot establish that an offer is purchasable,
that taxes/shipping are complete, or that a displayed price is legally valid.

Amounts use decimal strings and preserve zero. Examples: `€ 99,90` → `99.90`
EUR, `1.299,95 €` → `1299.95` EUR, `CHF 49.50` → `49.50` CHF,
`$1,299.95` → `1299.95` with unknown currency. Explicit ISO codes and unambiguous
symbols/prefixes identify currencies; bare `$` and `¥` do not. No exchange-rate
conversion occurs. Comma/dot decimal formats and validated groups of three
using whitespace/apostrophes are supported. A single separator followed by
three digits in display text (`1.299`) is ambiguous and not guessed. Machine
Schema.org/meta decimal tokens allow that precision. At least two fractional
digits are returned, retaining additional significant fractional digits.
JSON numeric tokens retain their source digits rather than passing through
floating-point arithmetic. Unsupported/malformed formats produce issues.

Extraction is bounded per snapshot: at most 10000 DOM elements (128 levels),
128 JSON-LD blocks, 10000 JSON-LD traversal steps (64 levels), 10000 Microdata
property steps and offer steps (32 offer levels), 2048 collected schema prices,
256 normalized candidates, 2048 evidence entries, and 128 issues. Values longer
than 2048 characters are not treated as monetary values. Limits yield an
`EXTRACTION_LIMIT` issue and prevent an unjustified selection; already observed
conflicts remain conflicts. The ordinary response byte limit applies first.

### Capture and external tracking

`http` captures only the server response. `browser` retains both raw and rendered
documents with their individual URLs and timestamps. Changed current prices
remain available even if the raw node disappears after rendering. A redirect or
product identity change cannot manufacture a comparable current price.
`auto` falls back once for unavailable prices only when executable scripts and
price/product/application-shell hints suggest dynamic content. Usable HTTP
prices, including conflicts, stay on HTTP. Request `browser` explicitly to inspect
dynamic content on pages already containing static prices.

JSON-LD is parsed as data; contexts are never fetched and scripts are never
evaluated by the extractor. Ordinary Chromium rendering executes the page's
executable scripts through the existing guarded capture pipeline. Price
extraction makes no offer/context/product requests. Shared capture caching,
45-second default TTL, abort/timeout/byte bounds, TLS policy, private-network
protections and per-client isolation are unchanged. Analysis shares its existing
single HTTP capture and at most one passive rendering; its rendering blocks
external resources, so some JavaScript applications cannot populate prices
there. The passive analysis snapshot does not run the ordinary computed-price
visibility scan. Standalone browser extraction uses the normal resource policy,
including any explicitly blocked resource types.

For an external tracker, store the complete result in your own system and
handle `conflict`/`ambiguous` explicitly before recording a selected price.
Keep source evidence, conditions, currencies and capture timestamps when
comparing snapshots. `capturedAt` may be older than `extractedAt` on a cache hit;
use `cacheTtlMs: 0` when your workflow needs a new capture. Fetchary does not
store price history, schedule captures or monitor products. One snapshot is an
observed declaration, not a verified historical selling price.
