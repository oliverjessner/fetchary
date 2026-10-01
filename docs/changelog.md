# 1.1.0

- automatic vendor discovery and persisted activation flags in SQLite
- vendor listing and activation controls in the CLI and library
- support for youtube, instagram, twitch, tiktok

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
