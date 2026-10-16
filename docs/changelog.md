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
