# Watchive CLI

> **Watchive 👁️ — Watch changes. Keep the proof.**

Watchive is a small command-line tool for monitoring web pages, archiving raw HTML responses, and tracking changes over time.

The core workflow is intentionally simple:

1. Add a URL.
2. Fetch the page.
3. Store the raw HTML.
4. Compare its SHA-256 hash with the latest archived version.
5. Save a new version only when the page changed.

Watchive is designed for research, journalism, investigations, documentation, and any workflow where it matters to know **what a web page looked like at a specific point in time**.

## Installation

```bash
npm install -g watchive
```

Check the installed version:

```bash
watchive --version
```

Show help:

```bash
watchive --help
```

## Usage

```bash
watchive <command> [arguments] [options]
```

## Commands

### `watchive add`

Add a URL to Watchive.

```bash
watchive add <url>
```

Example:

```bash
watchive add https://example.com/news
```

Watchive immediately performs the first fetch and stores the initial version.

Optional metadata:

```bash
watchive add https://example.com/news --name "Example News"
```

Add a tag:

```bash
watchive add https://example.com/news --tag research
```

Combine options:

```bash
watchive add https://example.com/news \
  --name "Example News" \
  --tag research
```

Example output:

```text
✓ Added #12 https://example.com/news
✓ Saved version 1
```

#### Options

```text
--name <name>    Human-readable name
--tag <tag>      Assign a tag
```

---

### `watchive list`

List all monitored URLs.

```bash
watchive list
```

Example output:

```text
ID   NAME           URL                         LAST CHECK      LAST CHANGE
1    Example News   https://example.com/news    2 min ago       3 days ago
2    Press          https://example.org/press   2 min ago       17 min ago
```

Filter by tag:

```bash
watchive list --tag research
```

Return machine-readable output:

```bash
watchive list --json
```

---

### `watchive fetch`

Fetch monitored URLs and check for changes.

Fetch all active URLs:

```bash
watchive fetch
```

Fetch one URL:

```bash
watchive fetch 12
```

Fetch multiple URLs:

```bash
watchive fetch 12 14 18
```

Example output:

```text
Fetching 3 sources...

#12 Example News     unchanged
#14 Press Release    changed → version 7
#18 Company Page     unchanged

1 changed, 2 unchanged
```

When a page changes:

```text
✓ #14 changed
  previous: 4d37a3...
  current:  89fa21...
  version:  7
```

When a page has not changed, Watchive updates only `last_checked_at`.

A new archived HTML version is created only if the response body differs from the previous version.

---

### `watchive status`

Show a short overview of the local Watchive installation.

```bash
watchive status
```

Example:

```text
Watchive 👁️

Sources:        27
Versions:       143
Changed today:  4
Last fetch:     8 min ago
Database:       ~/.watchive/watchive.sqlite
```

---

### `watchive show`

Show detailed information about a monitored URL.

```bash
watchive show <id>
```

Example:

```bash
watchive show 12
```

Output:

```text
ID:             12
Name:           Example News
URL:            https://example.com/news
Created:        2026-08-30 14:22
Last checked:   2026-08-31 11:42
Last changed:   2026-08-29 09:14
Versions:       8
Current hash:   89fa21...
```

---

### `watchive history`

Show all archived versions of a URL.

```bash
watchive history <id>
```

Example:

```bash
watchive history 12
```

Output:

```text
VERSION   FETCHED               STATUS   SIZE
8         2026-08-31 11:42      200      94 KB
7         2026-08-29 09:14      200      93 KB
6         2026-08-25 16:31      200      92 KB
```

Machine-readable output:

```bash
watchive history 12 --json
```

---

### `watchive diff`

Compare archived versions.

By default, Watchive compares the latest version with the previous version.

```bash
watchive diff <id>
```

Example:

```bash
watchive diff 12
```

Compare two specific versions:

```bash
watchive diff 12 6 8
```

Example output:

```diff
- Geschäftsführer: Max Mustermann
+ Geschäftsführer: Erika Musterfrau

- Stand: August 2026
+ Stand: September 2026
```

Optional output modes:

```bash
watchive diff 12 --html
watchive diff 12 --raw
```

`--raw` compares the raw archived HTML.

`--html` may generate or open a rendered HTML diff.

---

### `watchive open`

Open an archived HTML version in the default browser.

Open the latest version:

```bash
watchive open <id>
```

Example:

```bash
watchive open 12
```

Open a specific version:

```bash
watchive open 12 4
```

Watchive opens the local archived HTML file and does not request the live website again.

---

### `watchive edit`

Edit metadata for a monitored URL.

Change the name:

```bash
watchive edit 12 --name "Tesla Press"
```

Assign or change a tag:

```bash
watchive edit 12 --tag automotive
```

Change the monitored URL:

```bash
watchive edit 12 --url https://example.com/new-url
```

---

### `watchive disable`

Temporarily stop monitoring a URL without deleting it or its archive.

```bash
watchive disable <id>
```

Example:

```bash
watchive disable 12
```

Disabled URLs are skipped by:

```bash
watchive fetch
```

---

### `watchive enable`

Re-enable a disabled URL.

```bash
watchive enable <id>
```

Example:

```bash
watchive enable 12
```

---

### `watchive remove`

Remove a URL from active monitoring.

```bash
watchive remove <id>
```

Example:

```bash
watchive remove 12
```

By default, archived versions are kept.

Example output:

```text
✓ Removed #12 from monitoring
  8 archived versions kept
```

Delete the URL and all archived versions:

```bash
watchive remove 12 --purge
```

`--purge` is destructive.

---

### `watchive export`

Export a monitored source and its archived versions.

```bash
watchive export <id>
```

Example:

```bash
watchive export 12
```

Example export structure:

```text
watchive-export-12/
├── metadata.json
├── versions/
│   ├── 001.html
│   ├── 002.html
│   └── 003.html
└── hashes.txt
```

Specify an output directory:

```bash
watchive export 12 --output ./research
```

The export should contain enough metadata to independently verify archived versions.

## Global options

The following options should work where applicable:

```text
--json        Return machine-readable JSON
--quiet       Suppress normal output
--verbose     Show additional diagnostic information
--help        Show help
--version     Show Watchive version
```

Examples:

```bash
watchive list --json
```

```bash
watchive fetch --quiet
```

```bash
watchive fetch 12 --verbose
```

## Exit codes

Watchive uses exit codes so it can be used with shell scripts, cron jobs, CI jobs, and other automation.

```text
0    Command completed successfully, no changes detected
1    General error
2    Invalid arguments
3    Fetch failed
10   At least one monitored page changed
```

Example:

```bash
watchive fetch

if [ $? -eq 10 ]; then
  echo "At least one page changed"
fi
```

## Storage

Watchive stores all data locally by default.

```text
~/.watchive/
├── watchive.sqlite
└── pages/
    ├── 1/
    ├── 2/
    └── 3/
```

Each monitored URL gets its own directory.

Each archived version gets its own subdirectory:

```text
~/.watchive/pages/12/8/
├── response.html
└── metadata.json
```

Example `metadata.json`:

```json
{
  "url": "https://example.com/news",
  "finalUrl": "https://example.com/news",
  "fetchedAt": "2026-08-31T11:42:16+02:00",
  "status": 200,
  "contentType": "text/html",
  "contentLength": 96256,
  "sha256": "89fa21...",
  "etag": "\"abc123\"",
  "lastModified": "Mon, 31 Aug 2026 08:12:00 GMT"
}
```

## Data model

Watchive uses SQLite for metadata and indexing.

A minimal schema can consist of two tables.

### `urls`

```sql
CREATE TABLE urls (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    name TEXT,
    tag TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_checked_at TEXT,
    last_changed_at TEXT,
    current_hash TEXT,
    current_version_id INTEGER
);
```

### `versions`

```sql
CREATE TABLE versions (
    id INTEGER PRIMARY KEY,
    url_id INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    status_code INTEGER,
    final_url TEXT,
    content_type TEXT,
    content_length INTEGER,
    hash TEXT NOT NULL,
    file TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    FOREIGN KEY (url_id) REFERENCES urls(id)
);
```

The raw HTML itself is stored on disk rather than inside SQLite.

## Change detection

Watchive uses the response body's SHA-256 hash as its primary change detector.

Simplified logic:

```text
Fetch URL
↓
Receive raw HTML
↓
Calculate SHA-256
↓
Compare with current_hash
↓
Same hash?
├── yes → update last_checked_at
└── no  → archive HTML
          create version
          update current_hash
          update last_changed_at
```

The original HTTP response body should be archived without DOM cleanup, readability extraction, normalization, or AI processing.

This preserves the fetched source as closely as possible.

## HTTP metadata

For every archived version, Watchive should retain relevant HTTP information where available:

```text
Requested URL
Final URL after redirects
Fetched timestamp
HTTP status code
Content-Type
Content-Length
ETag
Last-Modified
SHA-256
```

Response headers may optionally be stored separately:

```text
headers.json
```

## Automation

Watchive itself does not need a scheduler.

Use the operating system's scheduler instead.

Example cron job:

```cron
*/15 * * * * watchive fetch
```

This checks all active URLs every 15 minutes.

Example with logging:

```cron
*/15 * * * * watchive fetch >> ~/.watchive/watchive.log 2>&1
```

## MVP

The first usable Watchive release only needs:

```text
watchive add <url>
watchive list
watchive fetch [id...]
watchive show <id>
watchive history <id>
watchive diff <id>
watchive remove <id>
```

Everything else can be added later.

## Non-goals for v0.1

Watchive v0.1 intentionally does not need:

```text
Browser automation
JavaScript rendering
Puppeteer or Playwright
Screenshots
AI-based change analysis
DOM-aware change detection
Link crawling
Cloud accounts
Web UI
Built-in scheduling
Notifications
```

The initial product philosophy is:

> URL in. HTML archived. Changes visible.

## Example workflow

Add a company imprint:

```bash
watchive add https://example.com/impressum \
  --name "Example GmbH Impressum" \
  --tag investigation
```

Run checks:

```bash
watchive fetch
```

Inspect the source:

```bash
watchive show 1
```

View its archive:

```bash
watchive history 1
```

Compare the latest changes:

```bash
watchive diff 1
```

Open the archived response:

```bash
watchive open 1
```

Export the evidence:

```bash
watchive export 1 --output ./research
```

## Philosophy

Watchive should remain small and predictable.

It is not a crawler, scraping framework, browser automation platform, or monitoring SaaS.

It does one thing:

**Watch changes. Keep the proof.**
