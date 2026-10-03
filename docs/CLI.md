# fetchary CLI

> **fetchary 👁️ — Watch changes. Keep the proof.**

fetchary is a local command-line monitor that archives exact HTTP responses and, for HTML pages, the DOM rendered by bundled Chromium.

The core workflow is intentionally simple:

1. Add a URL.
2. Fetch the page.
3. Store the exact HTTP response bytes.
4. In browser mode, wait for `load`, wait another five seconds by default, and store `page.content()` separately.
5. Select configured comparison sections, remove ignored elements from a temporary comparison DOM, and report meaningful changes separately.

fetchary is designed for research, journalism, investigations, documentation, and any workflow where it matters to know **what a web page looked like at a specific point in time**.

## Installation

Node.js 26.0 or newer is required.

```bash
npm install -g fetchary
```

The package installs Puppeteer and its bundled Chrome for Testing. No separate
browser installation or executable-path configuration is required.

Check the installed version:

```bash
fetchary --version
```

Show help:

```bash
fetchary --help
```

Running `fetchary` without a command shows the same help.

## Usage

```bash
fetchary <command> [arguments] [options]
```

## Commands

### `fetchary add`

Add a URL to fetchary.

```bash
fetchary add <url> [--name <name>] [--tag <tag>] [--every <interval>] [--mode <browser|http>] [--wait-after-load <duration>] [--include-selector <css> ...] [--ignore-selector <css> ...]
```

Example:

```bash
fetchary add https://example.com/news
```

fetchary immediately performs the first fetch and stores the initial version.
HTML sources use browser mode by default. Clearly non-HTML responses such as
JSON, XML, images, or archives automatically use HTTP-only capture semantics.

YouTube pages automatically reject optional cookies in English and German
consent dialogs when using browser mode, including redirects through
`consent.youtube.com` and short `youtu.be` links:

```bash
fetchary add https://www.youtube.com/@YouTube --name "YouTube channel"
```

Instagram pages automatically decline optional cookies and close dismissible
login dialogs in English and German when using browser mode:

```bash
fetchary add https://www.instagram.com/instagram/ --name "Instagram profile"
```

Login requirements still apply when Instagram does not offer a dismiss control.

TikTok and Twitch pages also decline optional cookies and close recognized,
dismissible login dialogs in English and German:

```bash
fetchary add https://www.tiktok.com/@tiktok --name "TikTok profile"
fetchary add https://www.twitch.tv/twitch --name "Twitch channel"
```

Both vendors are registered automatically. Use `fetchary vendor tiktok disable`
or `fetchary vendor twitch disable` to turn off their actions. TikTok consent
controls in open shadow DOM are supported. CAPTCHA prompts and content gates
remain part of the captured page.

LinkedIn pages reject optional cookies and close recognized, dismissible sign-in
dialogs. The vendor is registered automatically and can be disabled with
`fetchary vendor linkedin disable`.

```bash
fetchary add https://www.linkedin.com/company/linkedin/ --name "LinkedIn company"
```

Public personal, company, school, and showcase pages can supply follower counts
to `fetchary follower`. Connections and post reactions are excluded. Full login
walls and verification pages remain in the capture; counts are unavailable when
neither the rendered page nor the archived HTTP response exposes the profile.
If Chromium reaches an authentication wall but the HTTP response in the same
capture contains the public profile, its follower count is used. Both archived
files are preserved and no additional request is made.

Optional metadata:

```bash
fetchary add https://example.com/news --name "Example News"
```

Add a tag:

```bash
fetchary add https://example.com/news --tag research
```

Combine options:

```bash
fetchary add https://example.com/news \
  --name "Example News" \
  --tag research
```

Ignore one or more dynamic elements during comparison:

```bash
fetchary add https://github.com/owner/repo \
  --ignore-selector "relative-time" \
  --ignore-selector ".timestamp" \
  --ignore-selector "[data-updated]"
```

Compare only selected sections and optionally ignore elements within them:

```bash
fetchary add https://example.com/news \
  --include-selector "#main" \
  --include-selector ".sidebar-news" \
  --ignore-selector ".timestamp"
```

`--include-selector` and `--ignore-selector` are repeatable. Selectors are trimmed, deduplicated, and
validated immediately. A valid selector that currently matches no element is
accepted.

Each include selector uses `querySelector` on the original DOM to select only
its first matching element and that element's descendants. With multiple include
selectors, selected sections are compared in page order. Overlapping selections
are compared once. Ignore selectors then remove matching elements; an ignored
selected element or ancestor
also excludes that section. Without include selectors, the whole page is compared.
If include selectors match nothing, the comparison is empty. A selected section
appearing or disappearing therefore counts as a content change when its text changes.

Example output:

```text
✓ Added #12 https://example.com/news
✓ Saved version 1
```

#### Options

```text
--name <name>       Human-readable name
--tag <tag>         Assign a tag
--every <interval>  Schedule recurring fetches, for example 15m, 2h, or 3d
--mode <mode>       browser (default) or http
--wait-after-load <duration>
                    Browser post-load wait, for example 500ms, 5s, or 10s
--include-selector <css>
                    Compare the first matching element and its descendants; repeatable
--ignore-selector <css>
                    Ignore matching elements during comparison; repeatable
```

Add a URL and schedule checks every 30 minutes:

```bash
fetchary add https://example.com/news --every 30m
```

The initial fetch happens immediately. Recurring checks require a running
`fetchary run` process; `--every` saves the schedule without starting the runner.

---

### `fetchary list`

List all monitored URLs.

```bash
fetchary list
```

Example output:

```text
ID   NAME           TAG        URL                         VERSION   LAST CHECK   LAST CHANGE
1    Example News   research   https://example.com/news    7         2 min ago    3 days ago
2    Press          -          https://example.org/press   3         2 min ago    17 min ago
```

`VERSION` is the latest archived version for the source.
In supported interactive terminals, URLs are clickable. Redirected output,
`--json`, and `--no-color` do not contain hyperlink control sequences.

Filter by tag:

```bash
fetchary list --tag research
```

Return machine-readable output:

```bash
fetchary list --json
```

JSON source objects include `captureMode`, `waitAfterLoadMs`, and the current
raw, rendered, and comparison hashes.

---

### `fetchary vendors`

List all persisted vendors and their activation state:

```bash
fetchary vendors
fetchary vendors --json
```

The table has `VENDOR` and `ACTIVE` columns. JSON records contain `name` and a
boolean `active`. At startup, Fetchary discovers modules in `src/vendors/` and
inserts new vendors as active while preserving existing settings.

### `fetchary vendor`

Enable or disable a vendor for all sources in the selected data directory:

```bash
fetchary vendor instagram disable
fetchary vendor instagram enable
fetchary vendor youtube disable --json
```

Disabled vendors skip browser preparation and overlay actions. Ordinary
capturing continues. The setting persists across restarts and is read on the
next browser capture, including by an already running scheduler.

---

### `fetchary fetch`

Fetch monitored URLs and check for changes.

Fetch all active URLs:

```bash
fetchary fetch
```

Fetch one URL:

```bash
fetchary fetch 12
```

Fetch multiple URLs:

```bash
fetchary fetch 12 14 18
```

Example output:

```text
Fetching now
  ◉ #12 Example News
    ↳ https://example.com/news [browser]
  ◉ #14 Press Release
    ↳ https://example.org/press [browser]
  ◉ #18 Company Page
    ↳ https://example.net/company [http]

Results

#12 unchanged
#14 content changed → version 7
#18 raw changed, content unchanged → version 4

1 content changed, 1 raw only, 1 unchanged
```

In an interactive terminal Fetchary renders this as an in-place progress bar,
including the current page and completed/total count. Redirected output uses the
log-friendly `◉` entries shown above. Progress is suppressed by `--json` and
`--quiet`.

`content changed` means the normalized comparison DOM differs. `raw changed, content unchanged`
means that the exact HTML bytes changed—for example because of a rotating CSRF
token or script nonce—while the text shown by the page stayed the same. Both are
archived as exact versions. A rendered DOM can also change while the raw
application shell stays identical; that case creates a new version too.

---

### `fetchary status`

Show a short overview of the local fetchary installation.

```bash
fetchary status
```

Example:

```text
fetchary 👁️

Sources:        27
Versions:       143
Fetch storage:  18.4 MB
Changed today:  4
Last fetch:     8 min ago
Database:       ~/.fetchary/fetchary.sqlite
```

`Fetch storage` is the total byte size of all archived response bodies and rendered DOMs,
including archives retained for removed sources. With `--json`, the exact value
is returned as `fetchBytes`.

---

### `fetchary show`

Show detailed information about a monitored URL.

```bash
fetchary show <id> [--json]
```

In supported interactive terminals, the displayed URL is clickable.

Example:

```bash
fetchary show 12
```

Output:

```text
ID:             12
Name:           Example News
URL:            https://example.com/news
Capture mode:   browser
Wait after load: 5s
Created:        2026-08-30 14:22
Last checked:   2026-08-31 11:42
Last changed:   2026-08-29 09:14
Versions:       8
Raw hash:       89fa21...
Rendered hash:  71ab42...
Comparison hash: 52b14c...
Include selectors: main
Ignore selectors: relative-time, .timestamp
```

---

### `fetchary follower`

Print a single vendor profile's latest archived follower count, or list all
available counts with a sum. Without an ID, `--tag` filters the list and its sum.

```bash
fetchary follower [id] [--tag <tag>] [--json]
```

With an ID, output is only the number:

```bash
fetchary follower 3
# 65
```

Without an ID:

```bash
fetchary follower
fetchary follower --tag personal
```

Example output:

```text
ID  FOLLOWER  NAME     URL                                    LAST CHECK  LAST CHANGE
5   65        github   https://github.com/oliverjessner        1 min ago   1 min ago
6   1473      threads  https://www.threads.com/@oliverjessner  1 min ago   1 min ago
9   1711      youtube  https://youtube.com/@oliverjessner     1 min ago   1 min ago
------
sum: 3.249
```

Supported vendors are GitHub, Threads, X, Instagram, TikTok, Twitch, LinkedIn, and
YouTube; YouTube returns subscribers. `NAME` uses the source's name, or the
vendor name if none was set. `LAST CHECK` and `LAST CHANGE` are the source's
capture and content-change timestamps, as in `list`. URLs are clickable in
supported terminals.

The list omits removed sources, unsupported sources, and captures without an
available count. Sources disabled for fetching and disabled vendor integrations
still contribute their saved counts. Zero counts are included. Empty lists
print `No follower counts available.` and `sum: 0`. `--tag` applies to lists
only and cannot be combined with an ID.

With an ID, `--json` returns a number. For lists, it returns
`{ "followers": [...], "sum": 3249 }`; each row contains `id`, `follower`,
`name`, `url`, `lastCheckedAt`, and `lastChangedAt`. JSON numbers are unformatted;
the terminal sum uses dots as thousands separators.

Exact embedded profile statistics and tooltips take priority over rounded
counts. If only `1.5K` is available, the output is `1500` with the precision of
the captured page.

This command reads the newest rendered archive, falling back to raw HTML for
HTTP-only captures. LinkedIn can also fall back to the HTTP profile response
from the same capture when its rendered page has no count. It does not fetch
or modify captured evidence; use
`fetchary fetch 5` to update the capture first. Ignore selectors and vendor
activation do not filter archive reads. For a single ID, unsupported sources
exit with code 2; missing or hidden counts exit with code 1 and no number on
stdout. Archive read errors still fail the list instead of silently changing
its total.

---

### `fetchary history`

Show all archived versions of a URL.

```bash
fetchary history <id> [--content-change] [--json]
```

Example:

```bash
fetchary history 12
```

Output:

```text
VERSION   CHANGE    FETCHED               STATUS   SIZE
8         content   2026-08-31 11:42      200      94 KB
7         raw only  2026-08-29 09:14      200      93 KB
6         rendered only 2026-08-28 10:00   200      93 KB
5         content   2026-08-25 16:31      200      92 KB
```

The first archived response is marked `initial`. Later versions are classified
as `content` when the comparison DOM changed, `raw only` when only the response
changed, or `rendered only` when JavaScript changed the DOM without changing the
response. Classification always uses the source's current include and ignore selectors,
including for older versions. In terminal output, HTTP status `200` is shown in green.

Machine-readable output:

```bash
fetchary history 12 --json
```

Show only versions whose comparison content changed from the immediately
preceding archived version:

```bash
fetchary history 4 --content-change
fetchary history 4 --content-change --json
```

The filter uses the source's current include and ignore selectors. It excludes
the initial capture and changes confined to raw HTML or rendered markup. Versions
keep their original numbers and appear newest first. With no matching versions,
the console prints `No content changes.` and JSON output is `[]`.

---

### `fetchary diff`

Compare archived versions.

By default, fetchary compares the latest version with the previous version.

```bash
fetchary diff <id> [from to] [--include-selector <css> ...] [--element-content|--element-raw|--raw] [--html]
```

Example:

```bash
fetchary diff 12
```

Compare two specific versions:

```bash
fetchary diff 12 6 8
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
fetchary diff 12 --html
fetchary diff 12 --element-content
fetchary diff 12 --element-raw
fetchary diff 12 --raw
```

Limit console output to selected elements for this invocation:

```bash
fetchary diff 12 --include-selector "#main"
fetchary diff 12 6 8 --include-selector "#main" --element-content
fetchary diff 12 --include-selector "#main" --element-raw
fetchary diff 12 --include-selector "main" --include-selector ".sidebar-news"
```

`--include-selector` is repeatable and replaces the source's stored include
selection only for this diff. Each selector selects only its first match. It
applies to console, JSON, and HTML output and does not change monitoring settings.
If neither version contains a match, no
differences are shown.

Normal diffs use `rendered.html` when available and gracefully fall back to the
historical raw response. The default text diff selects elements matching the
source's current include selectors, then removes elements matching its ignore
selectors before applying normal text extraction. `--element-content` shows
each changed text fragment together with its nearest useful HTML element and
also applies the include selection and stored ignore selectors. `--element-raw`
groups raw changes by HTML element, includes tag and attribute changes, and
ignores stored comparison selectors. An explicit `--include-selector` limits
element-raw output to those elements, including their attributes and ignored
descendants. `--raw` always compares exact HTTP responses and cannot be combined
with `--include-selector`; use `--element-raw` to inspect selected HTML elements.

`--html` may generate or open a rendered HTML diff.

In terminal output, removed lines are red and added lines are blue. Colors are
disabled automatically when output is redirected and can be disabled explicitly
with `--no-color` or the `NO_COLOR` environment variable.

---

### `fetchary open`

Open an archived HTML version in the default browser, or print selected content
or external link URLs.

Open the latest version:

```bash
fetchary open <id> [version] [--show-include-selector|--show-external] [--html] [--raw]
```

Example:

```bash
fetchary open 12
```

Open a specific version:

```bash
fetchary open 12 4 --html
fetchary open 12 4 --raw
```

Browser captures open `rendered.html` by default; historical and HTTP-only
versions fall back to `response.html`. Use `--raw` to explicitly open the exact
HTTP response. Without `--html`, fetchary opens the selected artifact in the
system's default application. With `--html`, it opens that artifact in the
standard editor. Fetchary uses `$VISUAL`, then `$EDITOR`, followed by the
platform editor fallback. No variant requests the live website again.

Print only content matching the source's stored include selectors to the console:

```bash
fetchary open 16 --show-include-selector
fetchary open 16 4 --show-include-selector
fetchary open 16 --show-include-selector --html
fetchary open 16 --show-include-selector --raw
```

`--show-include-selector` prints text by default. With `--html`, it prints the
matching HTML elements and their descendants. Both variants write directly to
the console. `--raw` selects the archived HTTP response; otherwise the rendered
capture is used when available. The current include selectors apply even when
viewing an older version. Each selector selects only its first matching element.
Selected sections are shown in page order, with overlapping selections included
once. Stored ignore selectors do not hide any content in this view.

If no include selectors are configured, the command reports an error with an
`edit --include-selector` example. If the selectors match nothing in the selected
archive, the output is empty. `--json` returns `sourceId`, `version`,
`includeSelectors`, and `content`. Viewing content does not change source settings
or archived files.

Print external link URLs from an archived page:

```bash
fetchary open 16 --show-external
fetchary open 16 4 --show-external
fetchary open 16 --show-external --raw
fetchary open 16 --show-external --json
```

`--show-external` lists HTTP(S) URLs from links (`a[href]` and `area[href]`) whose
hostname differs from the archived page's hostname. Subdomains count as different
hosts; changes to the protocol or port alone do not. Relative and protocol-relative
links are resolved using the selected capture's final URL and the first
`<base href>`, when valid. The captured URL is used even if the source URL has
since been edited. Email, telephone, JavaScript, and other non-HTTP(S) links are
excluded, along with invalid or empty URLs.

Each URL is printed once, in page order, one per line. The whole archive is read;
stored include and ignore selectors do not limit this list. The command uses
rendered HTML when available; `--raw` reads the archived HTTP response. If a
rendered file is unavailable, both the HTML and its URL fall back to the raw
capture. No browser or editor is launched, and no live website is requested.

When there are no external links, the console output is empty. `--json` returns
`sourceId`, `version`, and a `urls` array, which is empty when no links qualify.
`--quiet` suppresses normal output. `--show-external` cannot be combined with
`--show-include-selector` or `--html`.

---

### `fetchary edit`

Edit metadata for a monitored URL.

Change the name:

```bash
fetchary edit 12 --name "Tesla Press"
```

Assign or change a tag:

```bash
fetchary edit 12 --tag automotive
```

Change the monitored URL:

```bash
fetchary edit 12 --url https://example.com/new-url
```

Change capture behavior:

```bash
fetchary edit 12 --mode http
fetchary edit 12 --mode browser --wait-after-load 8s
```

Replace all include selectors:

```bash
fetchary edit 12 --include-selector "main" --include-selector "article"
```

Clear all include selectors to compare the whole page again:

```bash
fetchary edit 12 --clear-include-selectors
```

Supplying `--include-selector` to `edit` replaces the complete list. It cannot be
combined with `--clear-include-selectors`. Existing ignore selectors still apply
after include selectors are cleared.

Replace all ignore selectors:

```bash
fetchary edit 12 \
  --ignore-selector "relative-time" \
  --ignore-selector ".timestamp"
```

Clear all ignore selectors:

```bash
fetchary edit 12 --clear-ignore-selectors
```

Supplying `--ignore-selector` to `edit` replaces the complete list; it does not
append to the stored list. It cannot be combined with
`--clear-ignore-selectors`.

Include and ignore selectors affect comparison only. Raw responses and rendered DOMs remain
unmodified and retain independent SHA-256 evidence hashes.

---

### `fetchary disable`

Temporarily stop monitoring a URL without deleting it or its archive.

```bash
fetchary disable <id>
```

Example:

```bash
fetchary disable 12
```

Disabled URLs are skipped by:

```bash
fetchary fetch
```

---

### `fetchary enable`

Re-enable a disabled URL.

```bash
fetchary enable <id>
```

Example:

```bash
fetchary enable 12
```

---

### `fetchary remove`

Remove a URL from active monitoring.

```bash
fetchary remove <id>
```

Example:

```bash
fetchary remove 12
```

By default, archived versions are kept.

Example output:

```text
✓ Removed #12 from monitoring
  8 archived versions kept
```

Delete the URL and all archived versions:

```bash
fetchary remove 12 --purge
```

`--purge` is destructive.

---

### `fetchary export`

Export a monitored source and its archived versions.

```bash
fetchary export <id>
```

Example:

```bash
fetchary export 12
```

Example export structure:

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

Specify an output directory:

```bash
fetchary export 12 --output ./research
```

The export should contain enough metadata to independently verify archived versions.

---

### `fetchary schedule`

Create, update, or re-enable a recurring fetch schedule for an existing source.

```bash
fetchary schedule <id> <interval> [--now]
```

Intervals use a positive whole number followed by `m` (minutes), `h` (hours), or
`d` (days). The minimum interval is `1m`; examples include `15m`, `2h`, and `3d`.

```bash
fetchary schedule 12 15m
```

The next check is due one interval after scheduling. Use `--now` to fetch the
source immediately before saving the schedule:

```bash
fetchary schedule 12 15m --now
```

#### Options

```text
--now           Fetch immediately, then schedule the next check after the interval
--json          Return the saved schedule as JSON
```

Schedules persist in SQLite. Recurring checks run only while `fetchary run` is
active for the same data directory. Scheduling a source does not start a background
process, and disabled sources are skipped by the runner.

---

### `fetchary unschedule`

Disable a source's recurring schedule while keeping the source and its archive.
Manual fetches remain available.

```bash
fetchary unschedule <id>
```

Example:

```bash
fetchary unschedule 12
```

Use `fetchary schedule` to re-enable the schedule.

---

### `fetchary schedules`

List active schedules with their source ID, interval, last run, and next run.

```bash
fetchary schedules [--json]
```

Return machine-readable output:

```bash
fetchary schedules --json
```

---

### `fetchary run`

Run the scheduler in the foreground to fetch sources when their schedules are due.

```bash
fetchary run [--poll-interval <milliseconds>]
```

#### Options

```text
--poll-interval <milliseconds>  How often to check for due schedules (default: 1000, minimum: 10)
```

The polling interval controls how often the runner checks for work; each source's
schedule determines how often it is fetched. At startup, the command prints each
scheduled page and its fetch interval. Schedules belonging to disabled sources are
shown as disabled and are not fetched until the source is enabled again.

```bash
fetchary schedule 12 15m
fetchary run --poll-interval 2000
```

Stop with `Ctrl+C` or `SIGTERM`. Only one runner may manage a data directory at a
time. Fetch failures do not stop the runner; the source is retried at its next
scheduled check. Due schedules are checked when the runner starts again.

## Global options

The following options should work where applicable:

```text
--json             Return machine-readable JSON
--quiet            Suppress normal output
--verbose          Show additional diagnostic information
--no-color         Disable colored terminal output
--help             Show help
--example          Show common examples
--version          Show fetchary version
--data-dir <path>  Override the storage directory
```

`FETCHARY_DATA_DIR` also selects the storage directory; `--data-dir` takes
precedence. Use the same directory when creating schedules and running the scheduler.

Human-readable terminal output uses green for successful actions, yellow for
changes and disabled states, red for errors and destructive removals, blue for
new values, cyan for URLs and paths, and gray for unchanged or secondary details.
Color is never added to JSON or redirected output.

Examples:

```bash
fetchary list --json
```

```bash
fetchary fetch --quiet
```

```bash
fetchary fetch 12 --verbose
```

## Exit codes

fetchary uses exit codes so it can be used with shell scripts, cron jobs, CI jobs, and other automation.

```text
0    Command completed successfully, no visible content changes detected
1    General error
2    Invalid arguments
3    Fetch failed
10   At least one monitored page had a visible content change
```

Example:

```bash
fetchary fetch

if [ $? -eq 10 ]; then
  echo "At least one page had a visible content change"
fi
```

## Storage

fetchary stores all data locally by default.

```text
~/.fetchary/
├── fetchary.sqlite
└── pages/
    ├── 1/
    ├── 2/
    └── 3/
```

Each monitored URL gets its own directory.

Each archived version gets its own subdirectory:

```text
~/.fetchary/pages/12/8/
├── response.html
├── rendered.html
└── metadata.json
```

Example `metadata.json`:

```json
{
    "url": "https://example.com/news",
    "finalUrl": "https://example.com/news",
    "browserFinalUrl": "https://example.com/news",
    "fetchedAt": "2026-08-31T11:42:16+02:00",
    "status": 200,
    "contentType": "text/html",
    "contentLength": 96256,
    "capture": {
        "mode": "browser",
        "engine": "chromium",
        "waitUntil": "load",
        "waitAfterLoadMs": 5000
    },
    "rawSha256": "89fa21...",
    "renderedSha256": "71ab42...",
    "comparisonSha256": "52b14c...",
    "etag": "\"abc123\"",
    "lastModified": "Mon, 31 Aug 2026 08:12:00 GMT"
}
```

## Data model

fetchary uses SQLite for metadata and indexing.

Metadata includes sources, versions, schedules, and vendor activation.

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
    current_raw_hash TEXT,
    current_rendered_hash TEXT,
    current_comparison_hash TEXT,
    capture_mode TEXT NOT NULL DEFAULT 'browser',
    wait_after_load_ms INTEGER NOT NULL DEFAULT 5000,
    current_version_id INTEGER
);
```

### `versions`

```sql
CREATE TABLE versions (
    id INTEGER PRIMARY KEY,
    url_id INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    final_url TEXT NOT NULL,
    content_type TEXT,
    content_length INTEGER NOT NULL,
    hash TEXT NOT NULL,
    file TEXT NOT NULL,
    raw_hash TEXT,
    rendered_hash TEXT,
    comparison_hash TEXT,
    rendered_file TEXT,
    capture_mode TEXT NOT NULL DEFAULT 'http',
    browser_final_url TEXT,
    etag TEXT,
    last_modified TEXT,
    FOREIGN KEY (url_id) REFERENCES urls(id)
);
```

The raw HTTP body and rendered DOM are stored on disk rather than inside SQLite.

### `vendors`

```sql
CREATE TABLE vendors (
    name TEXT PRIMARY KEY NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
```

SQLite stores the activation boolean as `0` or `1`; the library and CLI JSON
expose it as `false` or `true`.

## Change detection

fetchary keeps three hashes: the exact HTTP response, the exact rendered DOM,
and the normalized comparison DOM after include and ignore selectors. A version is archived
when the raw or rendered hash changes; `last_changed_at` changes only when the
comparison hash changes.

Simplified logic:

```text
URL
├── HTTP fetch → response.html → raw SHA-256
└── Chromium → load → post-load wait → rendered.html → rendered SHA-256
                                              └── temporary comparison DOM
                                                   → comparison SHA-256
```

The original HTTP response body is archived without DOM cleanup, normalization,
or rendering. Comparison selectors never modify either archived artifact.

This preserves the fetched source as closely as possible.

## HTTP metadata

For every archived version, fetchary should retain relevant HTTP information where available:

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

## MVP

The first usable fetchary release only needs:

```text
fetchary add <url>
fetchary list
fetchary fetch [id...]
fetchary show <id>
fetchary history <id>
fetchary diff <id>
fetchary remove <id>
```

Everything else can be added later.

## Non-goals

Chromium is used only for deterministic DOM capture. fetchary is not:

```text
Screenshots
a crawler
a full browser automation framework
a scraping framework
a screenshot service
an authenticated-session manager
```

## Example workflow

Add a company imprint:

```bash
fetchary add https://example.com/impressum \
  --name "Example GmbH Impressum" \
  --tag investigation
```

Run checks:

```bash
fetchary fetch
```

Inspect the source:

```bash
fetchary show 1
```

View its archive:

```bash
fetchary history 1
```

Compare the latest changes:

```bash
fetchary diff 1
```

Open the archived response:

```bash
fetchary open 1
```

Export the evidence:

```bash
fetchary export 1 --output ./research
```

## Philosophy

fetchary should remain small and predictable.

It is not a crawler, scraping framework, browser automation platform, or monitoring SaaS.

It does one thing:

**Watch changes. Keep the proof.**
