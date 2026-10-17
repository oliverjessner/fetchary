# 2.0.2

- Add global `--filepath` output saving for every CLI command, with automatic text/HTML/JSON extensions, explicit file or directory targets, quiet-mode exports and protection against overwriting existing files.
- Extract links from XML URL sitemaps and sitemap indexes, including namespaces, entity decoding, scopes and source locations. Add dedicated CLI examples.
- Add `history` with the latest 100 CLI commands, timestamps, exit codes, JSON/list output, credential redaction, `--no-history` and an overridable private history file. Serialize atomic updates across processes; keep library extraction free of command-history writes.

- Add `extract videos <url>` with JSON and deduplicated `--list`/`--urls-only` output, typed `extractVideos()` and isolated-client methods. Discover media files/streams, video elements, linked and embedded platform videos, Open Graph/Twitter metadata and Schema.org VideoObject references, with scoped selectors and existing capture/cache behavior.

- Add `login <url>`, `sessions`, `logout <name>` and shared `--session`/`--session-dir` support. Sign in manually in a visible isolated browser without reading an existing Chrome profile or Keychain, then explicitly save scoped cookies in private, atomically replaced session files. Add typed login/session APIs, authenticated cache bypass, cancellation/timeouts and browser/HTTP/CLI regression coverage.

# 2.0.1

- Add `--cookies-from-browser chrome`, `--browser-profile`, and library `cookiesFromBrowser`/`browserProfile` options for Chrome on macOS. Read scoped cookies from the selected SQLite profile in read-only mode, decrypt supported cookies through the existing Keychain item, verify version 24 domain hashes, and reuse isolated browser contexts and authenticated cache bypass without saving credentials or updating the source session.

- Add `--cookies <file>` and library `cookieFile` support for read-only Netscape/JSON session exports across extractors and analysis. Apply scoped cookies to HTTP redirects and browser contexts, bypass authenticated capture caches, preserve browser session updates, and validate/redact exports without storing passwords or rewriting cookie files.

- Increase the default decoded response/resource and rendered HTML limit to 20 MiB (20971520 bytes), with an 80 MiB aggregate browser resource budget. Explicit `maxResponseBytes`/`--max-response-bytes` values continue to override the default.

- Report failed browser resource downloads as resource-phase browser errors. Include effective byte limits and the `--max-response-bytes` recovery option for oversized scripts, without copying signed resource URLs into the top-level message. Document bounded captures for large YouTube bundles.

- Add `fetchary analyse <url>` and typed `analyse()`/client methods combining ten extractors in one JSON report, with preserved per-section metadata, partial error reporting and deduplicated list output. Share one document capture and at most one passive browser rendering per analysis, including uncached/abortable calls.

- Add Tracker Intelligence with 13 modular provider detectors, typed library/dispatcher/client methods, JSON/list CLI output, scoped Matomo IDs, separate Plausible domains and redacted raw/rendered evidence. Reuse guarded capture/cache infrastructure with passive browser rendering that blocks all additional resources and tracking traffic.

- Add `extract metadata` and `extract structured-data`, typed library exports and isolated-client methods. Extract page metadata with HTML/meta/Schema.org precedence, parse JSON-LD and nested Microdata with itemref support and diagnostics, preserve declared dates and missing values, and provide list/JSON output with bounded parsing and guarded capture reuse.
- Add `extract links` and `extract documents`, typed `extractLinks()`/`extractDocuments()` and client methods. Preserve every link occurrence with anchor text, rel tokens, internal/external classification and original DOM location. Discover document extensions, MIME/download/query hints and embedded documents without fetching targets; provide unique URL lists and scoped extraction.
- Add social-insights `--follower` and `--posts` count selection. Single selections print a number or `null`; combined selections return only the named counts, with line-by-line values in list mode. Preserve zero counts, YouTube subscriber fallback, JSON precedence, quiet output, and existing unfiltered library/CLI results.
- Add `extract emails` and `extract telephone` with JSON and list output, plus typed `extractEmails()`/`extractTelephone()` library and client methods. Read contact links, page text, microdata and JSON-LD; deduplicate contacts, normalize phone numbers with libphonenumber-js, and support national numbers via `--default-country`/`defaultCountry`. Preserve scoped selectors, RAM-only captures, and guarded HTTP/browser behavior.
- Add `--list` for every CLI extraction type and compatibility alias, printing found URLs or selector values one per line. Keep `--urls-only` as an alias, preserve JSON precedence, and reject binary/list conflicts. Text/HTML lists resolve safe page links; selector lists include all matches. List output does not crawl or paginate profiles.
- Add optional favicon binary output: CLI `extract favicon <url> --binary` and `favicon <url> --binary` write original image bytes to stdout. Library `binary: true` returns a Buffer in `data` alongside image metadata, reusing the validated image response without another download.
- Keep URL/JSON output as the default; reject CLI binary/JSON conflicts and binary output for other extraction types. Add TypeScript inference, binary regression tests, and CLI/library examples.

# 2.0.0

- Breaking: Fetchary is now a stateless semantic extraction toolkit. Remove SQLite, saved sources, monitoring, archives, history, diffs, hashing, scheduling, stored vendor activation, the `Fetchary` class and `createFetchary()` API. Existing user directories are never accessed or deleted.
- Add `extract <type> <url>` for text, HTML, favicon, images, avatar, selector, social-links and social-insights, backed by the same public Node.js dispatcher and explicit functions. Keep standalone extraction aliases.
- Default to HTTP-first auto capture with one optional browser fallback. Add cancellation, bounded decoded responses, declared charset handling, redirect checks, DNS/address validation, private-network opt-in and guarded Chromium resource loading.
- Expand image URL discovery, first/all CSS selection and attribute output, and social link discovery/filtering across twelve platforms.
- Add fixture-backed YouTube, TikTok and Instagram profile/post metrics with identity checks, sources, approximation flags and explicit metric availability; preserve other existing profile follower parsers.
- Document the actual platform capabilities in `docs/SOCIAL_SUPPORT.md`, rewrite CLI/library guides, and align package metadata and declarations with 2.0.0.
- Reuse compatible webpage captures in a bounded, process-local memory cache for 45 seconds by default, with in-flight deduplication and per-call TTL overrides.
- Add isolated `createExtractor()` clients, cache clearing, capture cache metadata, and shared semantic extraction methods for text, HTML, selectors, images, social links, avatars, and follower insights.

# 1.3.0

- `extract <url>` prints current HTML or text without opening SQLite or creating an archive, with browser/HTTP modes and include/ignore selectors
- `favicon <url>` finds the highest-resolution accessible icon from page links, Apple touch icons, manifest icons, and `/favicon.ico`, checking image dimensions and scalable SVGs
- `profile-picture <url>` extracts public profile image URLs for GitHub, Instagram, Threads, X, TikTok, Twitch, LinkedIn, and YouTube through account-specific vendor hooks
- standalone `extract`, `extractFavicon`, and `extractProfilePicture` library exports with TypeScript results, JSON CLI output, and bounded in-memory image requests

get a favicon

```bash
fetchary favicon https://oliverjessner.at
```

get a profile picture

```bash
fetchary profile-picture https://www.instagram.com/instagram/
```

# 1.2.0

- `open --show-social-media` checks archived external links for Facebook, X, YouTube, Instagram, Vimeo, TikTok, Reddit, and LinkedIn, with per-platform presence, unique URLs, and JSON output
- `open --show-external` lists unique external HTTP(S) link URLs from archived pages, with URL resolution, version selection, rendered/raw capture support, and JSON output
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
