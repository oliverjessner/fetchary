# 1.2.0

- `open --show-external` lists unique external HTTP(S) link URLs from archived pages, with URL resolution, version selection, rendered/raw capture support, and JSON output
- `npm run publish` creates a GitHub release with a version tag and changelog notes after npm and Homebrew publication, with release previews, preflight checks, and `--skip-github` support
- `history --content-change` filters console and JSON history to versions with content changes using the source's current comparison selectors
- include selectors use `querySelector` to select only the first match per selector across monitoring, diffs, and console views
- repeatable `--include-selector` support for `add`, `edit`, and `diff` to compare only selected page sections
- one-off include selections for console, JSON, and HTML diffs, including `--element-content` and `--element-raw`, without changing source settings
- `open --show-include-selector` prints the stored include selection as text or HTML, with archived version, raw-response, and JSON options
- `--clear-include-selectors` and library `includeSelectors` support, with persisted configuration and backwards-compatible SQLite migration

# 1.1.0

- include and ignore selectors apply to change detection, history classification, and content diffs; raw and rendered evidence stays complete
- automatic vendor discovery and persisted activation flags in SQLite
- vendor listing and activation controls in the CLI and library
- support for youtube, instagram, twitch, tiktok, linkedin
- LinkedIn follower fallback to the same capture's HTTP profile when Chromium reaches a login wall
- follower [id] to show a vendor count or list all available counts with a sum
- follower --tag to filter the list and its sum by source tag

# 1.0.0

- browser capture for HTML using Puppeteer and bundled Chrome for Testing
- separate raw response, rendered DOM, and comparison hashes
- per-source `browser`/`http` capture mode and configurable post-load wait
- rendered-aware diffs, exports, metadata, scheduler runs, and public API
- backwards-compatible SQLite and archive migration

# 0.4.1

- Improving schedule run std out

# 0.4.0

- two flags --element-raw and --element-content for dif
- status now shows the amount of storage fetchary takes
- clickable links in list und show
- open --html opens html

# 0.3.0

- per-source CSS ignore selectors for comparison and text diffs
- repeatable `--ignore-selector` support for `add` and `edit`
- `--clear-ignore-selectors` support for `edit`
- exact raw archives, evidence hashegs, and raw diffs remain unfiltered
- flag --example for examples
- fetchary list shows VERSION
- fetchary history shows STATUS
- overall a much better struct for the CLI interface a lot of fallbacks if commands or parameter are omited
- new naming for changed

# 0.1.1

- init version
