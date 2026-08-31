# fetchary Library

`fetchary` can be used as a CLI or embedded directly as a Node.js library.

The library is the core implementation. The CLI should remain a thin wrapper around the same public API so that fetching, archiving, change detection, scheduling, and storage behave identically in both modes.

## Installation

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
});

console.log(source.id);

const result = await fetchary.fetch(source.id);

console.log(result.changed);

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
});
```

Create the source with a schedule:

```js
const source = await fetchary.add('https://example.com/news', {
    every: '30m',
});
```

Options:

```ts
type AddOptions = {
    name?: string;
    tag?: string;
    every?: string;
};
```

Example result:

```js
{
  id: 12,
  url: "https://example.com/news",
  name: "Example News",
  tag: "research",
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
  createdAt: "2026-08-30T12:22:00.000Z",
  lastCheckedAt: "2026-08-31T09:42:16.000Z",
  lastChangedAt: "2026-08-29T07:14:00.000Z",
  currentHash: "89fa21...",
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
  previousHash: "4d37a3...",
  hash: "89fa21...",
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
  hash: "89fa21...",
  version: 8,
  fetchedAt: "2026-08-31T12:42:16.000Z",
  status: 200,
  contentLength: 96256
}
```

If the HTML has not changed, no new archived version is created.

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
  etag: "\"abc123\"",
  lastModified: "Sat, 29 Aug 2026 08:57:00 GMT",
  file: "/Users/user/.fetchary/pages/12/7/response.html"
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

Raw HTML comparison:

```js
const diff = await fetchary.diff(12, {
    from: 6,
    to: 8,
    mode: 'raw',
});
```

Possible options:

```ts
type DiffOptions = {
    from?: number;
    to?: number;
    mode?: 'text' | 'raw';
};
```

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

Possible input:

```ts
type EditSourceInput = {
    url?: string;
    name?: string | null;
    tag?: string | null;
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

Emitted only when a new version is archived.

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
│   ├── 001.html
│   ├── 002.html
│   └── 003.html
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
import { FetcharyError, FetcharyFetchError, FetcharyNotFoundError, FetcharyIntervalError } from 'fetchary';
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
            └── metadata.json
```

The response body is stored as raw HTML.

It should not be normalized, cleaned, parsed, rewritten, or processed before hashing and archiving.

The SHA-256 hash is calculated from the same bytes that are written to the archive.

This is important so that the archived file and recorded hash correspond exactly.

---

## Change detection

The core change-detection path is shared by CLI, library, and scheduler:

```text
HTTP request
↓
response body
↓
SHA-256
↓
compare with current hash
↓
unchanged?
├── yes → update last checked
└── no  → write archive
          insert version
          update current hash
          emit change event
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

if (result.changed) {
    console.log(`changed → version ${result.version}`);
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
