# Fetchary

> **Fetchary 👁️ — Watch changes. Keep the proof.**

Fetchary monitors web pages, archives their raw HTTP response bodies, and records a new version only when the bytes change. It can be used as a command-line tool or embedded as a Node.js library. Both interfaces use the same core, SQLite database, archive, change detector, and scheduler.

## Requirements and installation

Fetchary requires Node.js 22.5 or newer.

Install the library from npm:

```bash
npm install fetchary
```

Install the CLI globally from npm:

```bash
npm install --global fetchary
fetchary --version
```

Or install the CLI with Homebrew:

```bash
brew tap oliverjessner/tap
brew install fetchary
fetchary --version
```

## Library quick start

```js
import { createFetchary } from 'fetchary';

const fetchary = await createFetchary();

const source = await fetchary.add('https://example.com/news', {
  name: 'Example News',
  tag: 'research',
  every: '30m',
});

const result = await fetchary.fetch(source.id);
console.log(result.changed, result.hash);

await fetchary.close();
```

CommonJS is supported too:

```js
const { createFetchary } = require('fetchary');
```

By default, the library and CLI share `~/.fetchary`. Use an isolated location when needed:

```js
const fetchary = await createFetchary({
  dataDir: './data/fetchary',
  timeout: 15_000,
  userAgent: 'MyResearchBot/1.0',
  fetch: customFetch,
});
```

The optional Fetch-compatible implementation makes tests, proxies, and custom HTTP handling deterministic.

## CLI

```text
fetchary add <url> [--name <name>] [--tag <tag>] [--every <interval>]
fetchary list [--tag <tag>] [--json]
fetchary fetch [id...]
fetchary status
fetchary show <id>
fetchary history <id> [--json]
fetchary diff <id> [from to] [--raw|--html]
fetchary open <id> [version]
fetchary edit <id> [--url <url>] [--name <name>] [--tag <tag>]
fetchary enable <id>
fetchary disable <id>
fetchary remove <id> [--purge]
fetchary export <id> [--output <directory>]
fetchary schedule <id> <interval> [--now]
fetchary unschedule <id>
fetchary schedules [--json]
fetchary run [--poll-interval <milliseconds>]
```

Global flags include `--json`, `--quiet`, `--verbose`, `--help`, `--version`, and `--data-dir`. `FETCHARY_DATA_DIR` can also select the storage directory.

Examples:

```bash
fetchary add https://example.com/impressum \
  --name "Example GmbH" \
  --tag investigation

fetchary fetch
fetchary diff 1
fetchary export 1 --output ./research
```

CLI exit codes are suitable for cron and CI:

| Code | Meaning |
| ---: | --- |
| `0` | Success; a fetch detected no changes |
| `1` | General error |
| `2` | Invalid arguments or validation error |
| `3` | HTTP fetch failed |
| `10` | At least one fetched page changed |

## Public API

The instance returned by `createFetchary()` exposes:

- Sources: `add`, `list`, `get`, `edit`, `enable`, `disable`, `remove`
- Fetching and archives: `fetch`, `history`, `version`, `read`, `diff`, `export`
- Scheduling: `schedule`, `unschedule`, `schedules`, `run`
- Lifecycle: `on`, `close`

Fetch one source, selected sources, or all enabled sources:

```js
await fetchary.fetch(12);
await fetchary.fetch([12, 14, 18]);
await fetchary.fetch();
```

Read and compare local versions without contacting the live website:

```js
const html = await fetchary.read(12, 4);
const latestTextDiff = await fetchary.diff(12);
const rawDiff = await fetchary.diff(12, { from: 3, to: 4, mode: 'raw' });
```

All public TypeScript declarations ship with the package. Typed errors include `FetcharyFetchError`, `FetcharyNotFoundError`, `FetcharyIntervalError`, `FetcharyStorageError`, `FetcharyValidationError`, and `FetcharyRunnerError`.

## Scheduling

Schedules are stored in SQLite and accept minutes, hours, or days. The minimum interval is one minute.

```js
await fetchary.schedule(12, '15m');
await fetchary.schedule(14, '2h');
await fetchary.schedule(18, '3d', { now: true });

const runner = await fetchary.run();

process.on('SIGINT', async () => {
  await runner.stop();
  await fetchary.close();
});
```

The CLI equivalent is a long-running process:

```bash
fetchary schedule 12 15m
fetchary run
```

Only one runner may manage a data directory at a time. Fetch errors emit an event and do not stop the runner. Scheduled requests call the same `fetchary.fetch(id)` path as manual requests.

## Events and hooks

```js
fetchary.on('fetch', result => console.log('checked', result.sourceId));
fetchary.on('change', result => console.log('changed', result.sourceId));
fetchary.on('version', version => console.log('archived', version.file));
fetchary.on('fetch:error', event => console.error(event.sourceId, event.error));
```

Available events are `fetch`, `change`, `version`, `fetch:error`, `scheduler:start`, and `scheduler:stop`. A conventional `error` event is also emitted when a listener is registered.

Lifecycle hooks can be passed as `hooks.beforeFetch`, `hooks.afterFetch`, `hooks.onChange`, and `hooks.onError`. Hook failures never roll back or prevent an archive operation.

## Storage and verification

```text
~/.fetchary/
├── fetchary.sqlite
└── pages/
    └── <source-id>/
        └── <version-number>/
            ├── response.html
            └── metadata.json
```

SQLite contains source, version, and schedule metadata. The response body stays on disk. Fetchary never parses, normalizes, rewrites, or cleans a response before archiving it. SHA-256 is calculated from the exact same `Buffer` written to `response.html`; an unchanged hash updates only the source's last-check time.

An export contains independently verifiable files:

```text
fetchary-export-12/
├── metadata.json
├── hashes.txt
└── versions/
    ├── 001.html
    └── 002.html
```

For example, verify an exported file with:

```bash
shasum -a 256 fetchary-export-12/versions/001.html
```

`remove` keeps archived files by default and hides the source from active monitoring. `remove(id, { purge: true })` or `fetchary remove <id> --purge` permanently deletes its metadata and archive.

## Scope

Fetchary performs normal HTTP requests. It intentionally does not provide browser automation, JavaScript rendering, screenshots, crawling, DOM-aware detection, AI analysis, cloud accounts, or notifications.

The detailed behavior is specified in [the library documentation](docs/LIBRARY.md) and [the CLI documentation](docs/CLI.md).

## Development

```bash
npm test
npm run test:coverage
```

The test suite covers exact-byte archiving and hashing, unchanged and changed fetches, source lifecycle, exports, typed failures, interval parsing, persisted schedules, scheduler locking, core events, CLI JSON output, and documented exit codes.

## License

MIT
