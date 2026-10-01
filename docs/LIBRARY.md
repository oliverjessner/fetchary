# fetchary Library

`fetchary` can be used as a CLI or embedded directly as a Node.js library.

The library is the core implementation. The CLI should remain a thin wrapper around the same public API so that fetching, archiving, change detection, scheduling, and storage behave identically in both modes.

Fetchary preserves both what the server returned and what the browser rendered.
New HTML sources default to browser capture: Chromium waits for the `load` event,
waits another five seconds, and snapshots `page.content()`. This intentionally
does not use `networkidle`. Clearly non-HTML responses and sources configured as
`http` skip Chromium.

On public Threads pages, browser capture also declines the optional-cookie
prompt when it appears during the configured post-load wait. The capture result
records this as `dismissedOverlays: ['threads-cookie-consent']`; it does not log
in or bypass logged-out content limits.

Vendor-specific browser behavior is isolated in `src/vendors/`. Each module
declares its unique name, URL matcher, and overlay actions. Direct `.js` files
in that directory, except `index.js`, are discovered automatically and registered
in SQLite at startup, keeping the generic browser capture site-agnostic.
The X vendor handles non-essential-cookie prompts and dismissible login dialogs;
successful actions are recorded as `x-cookie-consent` and `x-login-dialog`. Its
pre-navigation hook replaces Chromium's `HeadlessChrome` token with `Chrome`,
which allows X to serve the same public page it serves regular Chromium.
The YouTube vendor rejects optional cookies using the English “Reject all” or
German “Alle ablehnen” control, both in inline consent dialogs and on
`consent.youtube.com`. Standalone consent submissions wait up to five seconds
for the destination page's `load` event before capture, including when
`waitAfterLoad` is zero. Successful actions are recorded as
`youtube-cookie-consent` in `dismissedOverlays`. `youtu.be` redirects are handled
automatically. Vendor actions are best-effort; unavailable controls or failed
actions do not prevent archiving.

The Instagram vendor handles English and German optional-cookie prompts and
dismissible login dialogs during the post-load wait. Successful actions are
recorded as `instagram-cookie-consent` and `instagram-login-dialog`. It recognizes
both login forms and the profile's sign-up invitation, including close controls
whose label is on a nested SVG. Unrelated dialogs and login pages without a
dismiss control are preserved. No authentication is performed.

The TikTok vendor handles English/German cookie controls in `tiktok-cookie-banner`
components, including nested open shadow roots, and inline cookie banners. It
closes recognized, dismissible login dialogs and records `tiktok-cookie-consent`
and `tiktok-login-dialog`. Short links on `vm.tiktok.com` and `vt.tiktok.com`
are handled through their redirects. CAPTCHA controls are preserved.

The Twitch vendor rejects optional cookies in the Twitch consent banner or
OneTrust controls and closes dismissible authentication dialogs. It records
`twitch-cookie-consent` and `twitch-login-dialog`. English and German labels are
supported; unrelated dialogs and content classification gates are preserved.

Both vendors are discovered automatically and respect their persisted `active`
flags. Cookie and login actions are best-effort and run during the configured
post-load wait; delayed controls require a sufficient wait, such as the default
five seconds.

The LinkedIn vendor supports `linkedin.com` and localized subdomains. It rejects
optional cookies and closes recognized, dismissible sign-in modals, recording
`linkedin-cookie-consent` and `linkedin-login-dialog`. English/German labels
and LinkedIn's stable consent actions are supported. Hidden controls, unrelated
dialogs, full `/authwall` or `/checkpoint` pages, and CAPTCHA challenges are
preserved.

LinkedIn follower counts are read from public `/in/`, `/company/`, `/school/`,
and `/showcase/` pages when available. Profile JSON follower statistics, header
counts, and description metadata are supported. Connections, employees, post
reactions, and recommended profiles are not used as follower counts. The module
is registered automatically and respects its persisted activation flag during
browser capture.

If Chromium redirects a LinkedIn profile to a login wall, follower extraction
can use the public profile in the same capture's archived HTTP response.
This also applies when the rendered page is the same profile without a count.
The response must belong to LinkedIn and contain a recognized profile; a
different rendered profile or an external redirect does not use this fallback.
A valid rendered count, including zero, has priority. No network request is
made and both archives stay unchanged. If neither archive supplies a count,
it remains unavailable; older captures are not reused.

## Installation

Node.js 26.0 or newer is required.

```bash
npm install fetchary
```

## Import

ES modules:

```js
import { createFetchary } from 'fetchary';
```

CommonJS, if the package exposes a CommonJS build:

```js
const { createFetchary } = require('fetchary');
```

## Quick start

```js
import { createFetchary } from 'fetchary';

const fetchary = await createFetchary();

const source = await fetchary.add('https://example.com/news', {
    name: 'Example News',
    tag: 'research',
    ignoreSelectors: ['relative-time', '.timestamp'],
});

console.log(source.id);

const result = await fetchary.fetch(source.id);

console.log(result.contentChanged, result.rawChanged, result.renderedChanged);

await fetchary.close();
```

By default, fetchary uses the same local storage as the CLI:

```text
~/.fetchary/
├── fetchary.sqlite
└── pages/
```

This means the CLI and library can work with the same sources and archived versions.

## Creating an instance

```js
const fetchary = await createFetchary();
```

With options:

```js
const fetchary = await createFetchary({
    dataDir: './data/fetchary',
    timeout: 30_000,
    userAgent: 'fetchary/1.0',
});
```

### Options

```ts
type FetcharyOptions = {
    dataDir?: string;
    timeout?: number;
    userAgent?: string;
    fetch?: typeof globalThis.fetch;
};
```

Puppeteer and its bundled Chrome for Testing are runtime dependencies; callers
do not configure an executable path. One browser is created lazily per Fetchary
instance and is closed by `fetchary.close()`.

### `dataDir`

Custom storage directory.

```js
const fetchary = await createFetchary({
    dataDir: './research',
});
```

Result:

```text
research/
├── fetchary.sqlite
└── pages/
```

### `timeout`

HTTP request timeout in milliseconds.

```js
const fetchary = await createFetchary({
    timeout: 15_000,
});
```

### `userAgent`

Custom HTTP User-Agent.

```js
const fetchary = await createFetchary({
    userAgent: 'MyResearchBot/1.0',
});
```

### `fetch`

Inject a custom Fetch-compatible implementation.

This is useful for testing, proxies, custom HTTP handling, or applications that already wrap `fetch`.

```js
const fetchary = await createFetchary({
    fetch: customFetch,
});
```

## API

### `add(url, options?)`

Add a URL and immediately store its first version.

```js
const source = await fetchary.add('https://example.com/news');
```

With metadata:

```js
const source = await fetchary.add('https://example.com/news', {
    name: 'Example News',
    tag: 'research',
    mode: 'browser',
    waitAfterLoad: '5s',
});
```

Create the source with a schedule:

```js
const source = await fetchary.add('https://example.com/news', {
    every: '30m',
});
```

Ignore dynamic elements during comparison:

```js
const source = await fetchary.add('https://github.com/owner/repo', {
    ignoreSelectors: ['relative-time', '.timestamp', '[data-updated]'],
});
```

Selectors are trimmed, deduplicated, and validated before the initial fetch. A
valid selector that matches no elements is allowed. The input array is not
mutated.

Options:

```ts
type AddOptions = {
    name?: string;
    tag?: string;
    every?: string;
    ignoreSelectors?: string[];
    mode?: 'browser' | 'http';
    waitAfterLoad?: string | number;
};
```

Example result:

```js
{
  id: 12,
  url: "https://example.com/news",
  name: "Example News",
  tag: "research",
  ignoreSelectors: ["relative-time", ".timestamp"],
  captureMode: "browser",
  waitAfterLoadMs: 5000,
  enabled: true,
  version: 1,
  changed: true
}
```

The initial fetch always creates version `1` when successful.

---

### `list(options?)`

List monitored URLs.

```js
const sources = await fetchary.list();
```

Filter by tag:

```js
const sources = await fetchary.list({
    tag: 'research',
});
```

Example:

```js
[
    {
        id: 1,
        name: 'Example News',
        url: 'https://example.com/news',
        enabled: true,
        lastCheckedAt: '2026-08-31T11:42:16.000Z',
        lastChangedAt: '2026-08-29T09:14:00.000Z',
        currentVersionId: 8,
    },
];
```

---

### `get(id)`

Get one monitored source.

```js
const source = await fetchary.get(12);
```

Example:

```js
{
  id: 12,
  name: "Example News",
  tag: "research",
  url: "https://example.com/news",
  enabled: true,
  ignoreSelectors: ["relative-time", ".timestamp"],
  createdAt: "2026-08-30T12:22:00.000Z",
  lastCheckedAt: "2026-08-31T09:42:16.000Z",
  lastChangedAt: "2026-08-29T07:14:00.000Z",
  currentHash: "89fa21...",
  currentRawHash: "89fa21...",
  currentRenderedHash: "71ab42...",
  currentComparisonHash: "52b14c...",
  currentVersionId: 8,
  versions: 8,
  schedule: {
    enabled: true,
    every: "1h",
    intervalSeconds: 3600,
    lastRunAt: "2026-08-31T09:00:00.000Z",
    nextRunAt: "2026-08-31T10:00:00.000Z"
  }
}
```

If the source does not exist, the method should throw a `FetcharyNotFoundError`.

---

### `fetch(id?)`

Fetch sources and run change detection.

Fetch one source:

```js
const result = await fetchary.fetch(12);
```

Fetch multiple sources:

```js
const results = await fetchary.fetch([12, 14, 18]);
```

Fetch all active sources:

```js
const results = await fetchary.fetch();
```

Example result for one source:

```js
{
  id: 12,
  url: "https://example.com/news",
  changed: true,
  rawChanged: true,
  renderedChanged: true,
  contentChanged: true,
  previousHash: "4d37a3...",
  hash: "89fa21...",
  contentHash: "52b14c...",
  version: 8,
  fetchedAt: "2026-08-31T11:42:16.000Z",
  status: 200,
  contentLength: 96256
}
```

Unchanged response:

```js
{
  id: 12,
  url: "https://example.com/news",
  changed: false,
  rawChanged: false,
  renderedChanged: false,
  contentChanged: false,
  hash: "89fa21...",
  contentHash: "52b14c...",
  version: 8,
  fetchedAt: "2026-08-31T12:42:16.000Z",
  status: 200,
  contentLength: 96256
}
```

`changed` is an alias for `contentChanged` and reports a visible-text change.
`rawChanged` reports whether the exact response bytes changed.
`renderedChanged` reports whether the exact browser DOM changed. A new version
is archived when either is true. A response can therefore have `rawChanged: true` and
`contentChanged: false` when only a rotating token, nonce, or other HTML detail
changed.

If a source has `ignoreSelectors`, Fetchary parses the rendered HTML (or raw HTTP
document in HTTP mode) into a temporary DOM, removes every matched element, and
then applies text normalization. Raw and rendered SHA-256 hashing and archive
writes always use the unmodified artifacts.

If neither the raw bytes nor rendered DOM changed, no new version is created.

Only `last_checked_at` is updated.

---

### `history(id)`

Return archived versions for a source.

```js
const versions = await fetchary.history(12);
```

Example:

```js
[
    {
        id: 8,
        sourceId: 12,
        fetchedAt: '2026-08-31T11:42:16.000Z',
        status: 200,
        contentLength: 96256,
        hash: '89fa21...',
        file: '/Users/user/.fetchary/pages/12/8/response.html',
    },
    {
        id: 7,
        sourceId: 12,
        fetchedAt: '2026-08-29T09:14:00.000Z',
        status: 200,
        contentLength: 95110,
        hash: '4d37a3...',
        file: '/Users/user/.fetchary/pages/12/7/response.html',
    },
];
```

Optional pagination:

```js
const versions = await fetchary.history(12, {
    limit: 50,
    offset: 0,
});
```

---

### `version(sourceId, versionId?)`

Read metadata for an archived version.

Latest version:

```js
const version = await fetchary.version(12);
```

Specific version:

```js
const version = await fetchary.version(12, 7);
```

Example:

```js
{
  id: 7,
  sourceId: 12,
  requestedUrl: "https://example.com/news",
  finalUrl: "https://example.com/news",
  fetchedAt: "2026-08-29T09:14:00.000Z",
  status: 200,
  contentType: "text/html",
  contentLength: 95110,
  hash: "4d37a3...",
  rawHash: "4d37a3...",
  renderedHash: "71ab42...",
  comparisonHash: "52b14c...",
  etag: "\"abc123\"",
  lastModified: "Sat, 29 Aug 2026 08:57:00 GMT",
  file: "/Users/user/.fetchary/pages/12/7/response.html",
  rawFile: "/Users/user/.fetchary/pages/12/7/response.html",
  renderedFile: "/Users/user/.fetchary/pages/12/7/rendered.html",
  captureMode: "browser"
}
```

---

### `read(sourceId, versionId?)`

Read archived HTML.

Latest version:

```js
const html = await fetchary.read(12);
```

Specific version:

```js
const html = await fetchary.read(12, 7);
```

The method reads the local archive.

It must not fetch the live URL again.

`read()` remains backwards-compatible and returns the exact raw response.
Use `readRendered()` to read the rendered DOM; historical HTTP-only versions
gracefully fall back to their raw response:

```js
const renderedHtml = await fetchary.readRendered(12, 7);
```

---

### `diff(sourceId, options?)`

Compare archived versions.

Compare the latest two versions:

```js
const diff = await fetchary.diff(12);
```

Compare specific versions:

```js
const diff = await fetchary.diff(12, {
    from: 6,
    to: 8,
});
```

Raw HTTP response comparison:

```js
const diff = await fetchary.diff(12, {
    from: 6,
    to: 8,
    mode: 'raw',
});
```

Text and element diffs use rendered HTML when available. `mode: 'raw'` always
uses `response.html`.

Possible options:

```ts
type DiffOptions = {
    from?: number;
    to?: number;
    mode?: 'text' | 'element-content' | 'element-raw' | 'raw';
};
```

Text mode, which is the default, applies the source's current ignore selectors
to both selected versions. Element-content mode returns content changes with
their HTML elements and also applies ignore selectors. Element-raw mode groups
raw changes by HTML element and does not apply selectors. Raw mode compares the
complete archived HTML and never applies selectors.

Example result:

```js
{
  sourceId: 12,
  from: 6,
  to: 8,
  changed: true,
  diff: [
    {
      type: "removed",
      value: "Geschäftsführer: Max Mustermann"
    },
    {
      type: "added",
      value: "Geschäftsführer: Erika Musterfrau"
    }
  ]
}
```

The exact diff representation may evolve, but the library API should return structured data rather than CLI-formatted text.

---

### `edit(id, changes)`

Edit a monitored source.

```js
await fetchary.edit(12, {
    name: 'Tesla Press',
});
```

Change a tag:

```js
await fetchary.edit(12, {
    tag: 'automotive',
});
```

Change the URL:

```js
await fetchary.edit(12, {
    url: 'https://example.com/new-url',
});
```

Replace all ignore selectors:

```js
await fetchary.edit(12, {
    ignoreSelectors: ['relative-time', '.timestamp'],
});
```

Clear all ignore selectors:

```js
await fetchary.edit(12, {
    ignoreSelectors: [],
});
```

Change capture behavior:

```js
await fetchary.edit(12, {
    captureMode: 'browser',
    waitAfterLoadMs: '8s',
});
```

Possible input:

```ts
type EditSourceInput = {
    url?: string;
    name?: string | null;
    tag?: string | null;
    ignoreSelectors?: string[];
    captureMode?: 'browser' | 'http';
    waitAfterLoadMs?: string | number;
};
```

---

### `enable(id)`

Enable a source.

```js
await fetchary.enable(12);
```

---

### `disable(id)`

Disable a source.

```js
await fetchary.disable(12);
```

Disabled sources remain in the database and keep their archived versions.

They are skipped by:

```js
await fetchary.fetch();
```

and by the scheduler.

---

### `remove(id, options?)`

Remove a source from active monitoring.

Keep archived files:

```js
await fetchary.remove(12);
```

Delete the source and archive:

```js
await fetchary.remove(12, {
    purge: true,
});
```

Options:

```ts
type RemoveOptions = {
    purge?: boolean;
};
```

`purge: true` is destructive.

---

## Vendors

Vendor activation is stored in the data directory's SQLite database. New
vendor modules default to active; synchronization only inserts missing names
and preserves existing flags. Existing databases receive the table automatically.

```js
const vendors = await fetchary.vendors();
// [{ name: 'instagram', active: true }, ...], sorted by name.

await fetchary.setVendorActive('instagram', false);
await fetchary.setVendorActive('instagram', true);

const synchronized = await fetchary.syncVendors();
```

`vendors()` lists persisted records. `setVendorActive(name, active)` requires
a boolean and returns the updated record. Unknown names throw
`FetcharyNotFoundError`; invalid names or activation values throw
`FetcharyValidationError`. Names are trimmed and converted to lowercase.

`syncVendors()` scans `src/vendors/` again and returns the persisted list.
New module files are loaded without restarting; changing an already loaded
module's implementation requires a restart. Each module must export `name`,
`matches(url)`, and an `overlays` array of `{ id, dismiss(page) }` actions, with
an optional `prepare(page)` hook. Names and overlay IDs must be unique. Invalid
or duplicate modules fail synchronization without partially adding records.

Each browser capture reads the current activation flags, including changes
made by another instance using the same data directory. Disabled vendors skip
both preparation and overlay actions, including after redirects. HTTP fetching,
browser rendering, and archiving continue. A capture already in progress keeps
its initial vendor selection. Removed modules retain their database records and
flags but are not executed.

Read a vendor profile's follower count from its latest archive:

```js
const followers = await fetchary.followerCount(5); // number, for example 63

const all = await fetchary.followers(); // { followers: [...], sum: 3249 }
const personal = await fetchary.followers({ tag: 'personal' });
```

Supported vendors: GitHub, Threads, X, Instagram, TikTok, Twitch, LinkedIn, and YouTube
(subscribers). This uses the archived final URL to select the vendor, prefers
rendered HTML, and falls back to raw HTML for HTTP-only captures. LinkedIn
also supports the same-capture HTTP fallback described above. It performs
no network request and does not apply ignore selectors or vendor activation
flags. Call `fetch(id)` first when you need a new capture.

Exact embedded profile statistics or tooltips take priority over compact
labels. Compact counts are expanded (`1.5K` becomes `1500`), retaining the
page's limited precision. Unsupported vendors throw `FetcharyValidationError`;
missing, hidden, or unrecognized counts throw `FetcharyNotFoundError`.
Zero is returned only when the archived profile reports zero.

`followers({ tag })` returns available counts for non-removed sources, ordered
by ID, and their sum. Each row contains `id`, `follower`, `name`, `url`,
`lastCheckedAt`, and `lastChangedAt`. The name falls back to the vendor name
when the source has no name. Timestamps use the source's check and content-change
times. Disabled sources and vendors remain included because this reads archives.
Unsupported sources and unavailable counts are omitted; zero counts are included.
Archive read errors propagate. An empty list returns `{ followers: [], sum: 0 }`.
The sum must remain a safe integer or a `FetcharyValidationError` is thrown.

Vendor modules can optionally export `followerCount(document, url)`, returning
a non-negative safe integer or `null` when unavailable. `document` is the
parsed archive DOM and `url` is its final capture URL. This hook is validated
during automatic discovery.

Modules can also opt into an HTTP fallback with
`followerCountFromRaw(document, rawUrl, renderedUrl)`. It is called only when
the rendered count is unavailable and the archived HTTP final URL matches
the same vendor. Return a non-negative safe integer or `null`. LinkedIn uses
this hook to accept the same profile or a rendered authentication wall and
reject unrelated profiles. The hook is validated during discovery.

## Scheduling

Scheduling is part of the library and uses the same interval syntax as the CLI.

Supported units:

```text
m    minutes
h    hours
d    days
```

Examples:

```text
5m
15m
1h
6h
1d
7d
```

The minimum interval is:

```text
1m
```

### `schedule(id, every, options?)`

Set the automatic fetch interval for a source.

```js
await fetchary.schedule(12, '15m');
```

Every two hours:

```js
await fetchary.schedule(12, '2h');
```

Every three days:

```js
await fetchary.schedule(12, '3d');
```

Fetch immediately and then continue with the interval:

```js
await fetchary.schedule(12, '1h', {
    now: true,
});
```

Example result:

```js
{
  sourceId: 12,
  enabled: true,
  every: "1h",
  intervalSeconds: 3600,
  nextRunAt: "2026-08-31T12:00:00.000Z"
}
```

Invalid intervals must throw an error:

```js
await fetchary.schedule(12, '30s');
```

Example:

```text
FetcharyIntervalError: invalid interval "30s". Use minutes, hours, or days.
```

---

### `unschedule(id)`

Disable automatic fetching for a source.

```js
await fetchary.unschedule(12);
```

This does not disable or remove the source itself.

Manual fetching still works:

```js
await fetchary.fetch(12);
```

---

### `schedules()`

List active schedules.

```js
const schedules = await fetchary.schedules();
```

Example:

```js
[
    {
        sourceId: 12,
        every: '15m',
        intervalSeconds: 900,
        lastRunAt: '2026-08-31T11:30:00.000Z',
        nextRunAt: '2026-08-31T11:45:00.000Z',
    },
];
```

---

### `run(options?)`

Start the scheduler inside the current Node.js process.

```js
const runner = await fetchary.run();
```

The runner processes enabled sources where:

```text
next_fetch_at <= now
```

and uses the normal:

```js
fetchary.fetch(id);
```

code path.

The scheduler must not have a separate implementation of fetching or change detection.

Example:

```js
import { createFetchary } from 'fetchary';

const fetchary = await createFetchary();

await fetchary.schedule(12, '15m');

const runner = await fetchary.run();

process.on('SIGINT', async () => {
    await runner.stop();
    await fetchary.close();
    process.exit(0);
});
```

### Runner options

```js
const runner = await fetchary.run({
    pollInterval: 1_000,
});
```

Possible options:

```ts
type RunnerOptions = {
    pollInterval?: number;
};
```

`pollInterval` controls how often the runner checks SQLite for due sources.

It does not change the configured fetch interval of a source.

### `runner.stop()`

Stop the scheduler.

```js
await runner.stop();
```

Stopping the runner does not remove schedules.

A later call to:

```js
await fetchary.run();
```

continues using the stored schedules.

---

## Events

### `fetch:start`

Emitted immediately before a source capture starts. The CLI uses this event to
show the page currently being fetched.

```js
fetchary.on('fetch:start', event => {
    console.log(event.sourceId, event.name, event.url, event.captureMode);
});
```

Applications embedding fetchary often need to react when a page changes or a fetch fails.

The library should expose events without requiring applications to parse console output.

```js
fetchary.on('change', event => {
    console.log('Page changed:', event.sourceId);
});

fetchary.on('fetch', event => {
    console.log('Fetched:', event.sourceId);
});

fetchary.on('error', error => {
    console.error(error);
});
```

Recommended events:

```text
fetch
change
version
fetch:error
scheduler:start
scheduler:stop
```

### `fetch`

Emitted after a successful fetch.

```js
fetchary.on('fetch', result => {
    console.log(result);
});
```

### `change`

Emitted only when the visible text content changes.

```js
fetchary.on('change', result => {
    console.log(`Source ${result.id} changed`);
});
```

### `version`

Emitted after a new archived version is written.

```js
fetchary.on('version', version => {
    console.log(version.file);
});
```

### `fetch:error`

Emitted when one source fails to fetch.

```js
fetchary.on('fetch:error', event => {
    console.error(event.sourceId, event.error);
});
```

A scheduler fetch error must not stop the runner.

---

## Export

### `export(id, options?)`

Export a source and its archived versions.

```js
const result = await fetchary.export(12);
```

Custom output directory:

```js
const result = await fetchary.export(12, {
    output: './research',
});
```

Example result:

```js
{
  sourceId: 12,
  directory: "/project/research/fetchary-export-12",
  versions: 8
}
```

Example structure:

```text
fetchary-export-12/
├── metadata.json
├── versions/
│   ├── 001-response.html
│   ├── 001-rendered.html
│   ├── 002-response.html
│   └── 002-rendered.html
└── hashes.txt
```

---

## Hooks

For embedding fetchary into larger applications, hooks can be used to observe or enrich the fetch lifecycle.

Example:

```js
const fetchary = await createFetchary({
    hooks: {
        beforeFetch: async context => {
            console.log('Fetching', context.url);
        },

        afterFetch: async result => {
            console.log('Status', result.status);
        },

        onChange: async result => {
            await notifyUser(result);
        },
    },
});
```

A minimal hook API could be:

```ts
type FetcharyHooks = {
    beforeFetch?: (context: FetchContext) => void | Promise<void>;
    afterFetch?: (result: FetchResult) => void | Promise<void>;
    onChange?: (result: FetchResult) => void | Promise<void>;
    onError?: (error: FetchError) => void | Promise<void>;
};
```

Hooks are optional.

The archive operation itself should not depend on user hooks succeeding.

---

## Errors

The library should expose typed errors.

```js
import { FetcharyError, FetcharyFetchError, FetcharyBrowserError, FetcharyNotFoundError, FetcharyIntervalError } from 'fetchary';
```

Example:

```js
try {
    await fetchary.fetch(999);
} catch (error) {
    if (error instanceof FetcharyNotFoundError) {
        console.log('Source does not exist');
    }
}
```

Recommended errors:

```text
FetcharyError
├── FetcharyFetchError
├── FetcharyBrowserError
├── FetcharyNotFoundError
├── FetcharyIntervalError
├── FetcharyStorageError
└── FetcharyValidationError
```

Errors should contain machine-readable properties where applicable.

Example:

```js
{
  name: "FetcharyFetchError",
  sourceId: 12,
  url: "https://example.com/news",
  status: 503,
  cause: error
}
```

---

## TypeScript

The package should ship its own TypeScript declarations.

Example:

```ts
import { createFetchary, type Fetchary, type FetchResult, type Source, type Version } from 'fetchary';

const fetchary: Fetchary = await createFetchary();

const result: FetchResult = await fetchary.fetch(12);
```

A simplified public interface:

```ts
interface Fetchary {
    add(url: string, options?: AddOptions): Promise<Source>;
    list(options?: ListOptions): Promise<Source[]>;
    get(id: number): Promise<Source>;

    fetch(): Promise<FetchResult[]>;
    fetch(id: number): Promise<FetchResult>;
    fetch(ids: number[]): Promise<FetchResult[]>;

    history(id: number, options?: HistoryOptions): Promise<Version[]>;
    version(sourceId: number, versionId?: number): Promise<Version>;
    read(sourceId: number, versionId?: number): Promise<string>;
    readRendered(sourceId: number, versionId?: number): Promise<string>;
    diff(sourceId: number, options?: DiffOptions): Promise<DiffResult>;

    edit(id: number, changes: EditSourceInput): Promise<Source>;
    enable(id: number): Promise<Source>;
    disable(id: number): Promise<Source>;
    remove(id: number, options?: RemoveOptions): Promise<void>;

    schedule(id: number, every: string, options?: ScheduleOptions): Promise<Schedule>;

    unschedule(id: number): Promise<void>;
    schedules(): Promise<Schedule[]>;

    run(options?: RunnerOptions): Promise<FetcharyRunner>;

    export(id: number, options?: ExportOptions): Promise<ExportResult>;

    close(): Promise<void>;
}
```

---

## Dependency injection

The core library should remain easy to test.

HTTP can be injected:

```js
const fetchary = await createFetchary({
    fetch: async url => {
        return new Response('<html>Hello</html>', {
            status: 200,
            headers: {
                'content-type': 'text/html',
            },
        });
    },
});
```

This allows deterministic tests without network access.

A temporary data directory can be used for storage tests:

```js
const fetchary = await createFetchary({
    dataDir: '/tmp/fetchary-test',
});
```

---

## Multiple instances

Multiple Fetchary instances may read from the same SQLite database, but write access should rely on SQLite locking and transactions.

Only one scheduler runner should actively manage scheduled fetches for the same `dataDir`.

Starting a second runner for the same storage directory should fail clearly.

```js
await fetchary.run();
```

Second runner:

```text
FetcharyRunnerError: a scheduler is already active for this data directory
```

---

## Storage guarantees

The library must preserve the same storage model as the CLI.

```text
dataDir/
├── fetchary.sqlite
└── pages/
    └── <source-id>/
        └── <version-id>/
            ├── response.html
            ├── rendered.html
            └── metadata.json
```

`response.html` stores the exact HTTP response bytes. `rendered.html` stores the
UTF-8 bytes returned by `page.content()` when browser capture applies.

It should not be normalized, cleaned, parsed, rewritten, or processed before hashing and archiving.

The raw SHA-256 hash is calculated from the same bytes that are written to the archive.

This is important so that the archived file and recorded hash correspond exactly.

---

## Change detection

The core change-detection path is shared by CLI, library, and scheduler:

```text
URL
├── HTTP request → exact response bytes → raw SHA-256
└── Chromium → load + configured wait → rendered DOM → rendered SHA-256
                                               └── temporary filtered DOM
                                                    → comparison SHA-256
↓
raw unchanged?
├── yes → update last checked
└── no  → write archive and emit version event
          visible text changed?
          ├── no  → report raw-only change
          └── yes → update last changed and emit change event
```

There must be only one implementation of this flow.

---

## Suggested internal architecture

```text
src/
├── index.js
├── fetchary.js
├── fetch.js
├── archive.js
├── diff.js
├── scheduler.js
├── intervals.js
├── storage/
│   ├── database.js
│   ├── sources.js
│   └── versions.js
└── errors.js
```

CLI:

```text
cli/
├── index.js
└── commands/
    ├── add.js
    ├── fetch.js
    ├── list.js
    ├── schedule.js
    ├── history.js
    └── diff.js
```

The CLI imports the public library:

```js
import { createFetchary } from '../src/index.js';
```

Example CLI implementation:

```js
const fetchary = await createFetchary();

const result = await fetchary.fetch(id);

if (result.contentChanged) {
    console.log(`content changed → version ${result.version}`);
} else if (result.rawChanged) {
    console.log(`raw changed, content unchanged → version ${result.version}`);
} else {
    console.log('unchanged');
}
```

The CLI is responsible for:

```text
Argument parsing
Human-readable output
Exit codes
Terminal formatting
```

The library is responsible for:

```text
HTTP fetching
Hashing
SQLite
Archiving
Change detection
Diffs
Schedules
Scheduler execution
Errors
Events
```

---

## Application example

A small application can use fetchary without invoking a child process:

```js
import { createFetchary } from 'fetchary';

const fetchary = await createFetchary({
    dataDir: './data',
});

let source;

try {
    source = await fetchary.add('https://example.com/impressum', {
        name: 'Example GmbH',
        tag: 'investigation',
        every: '30m',
    });
} catch (error) {
    console.error(error);
}

fetchary.on('change', async event => {
    console.log(`Changed: ${event.url}`);

    const diff = await fetchary.diff(event.id);

    console.log(diff);
});

const runner = await fetchary.run();

process.on('SIGINT', async () => {
    await runner.stop();
    await fetchary.close();
});
```

---

## Minimal library API for v0.1

The first library release does not need every convenience method.

The MVP should expose:

```js
createFetchary();

fetchary.add();
fetchary.list();
fetchary.get();
fetchary.fetch();
fetchary.history();
fetchary.read();
fetchary.diff();
fetchary.remove();

fetchary.schedule();
fetchary.unschedule();
fetchary.schedules();
fetchary.run();

fetchary.on();
fetchary.close();
```

Everything else can be added without changing the core model.

## Design principle

The CLI and embedded library are two interfaces to the same engine.

```text
CLI ───────┐
           │
Node.js ───┼──> fetchary core ──> SQLite + HTML archive
           │
Scheduler ─┘
```

There should be no duplicated fetch, archive, diff, or scheduling logic.

**One engine. Two interfaces. Same archive.**
