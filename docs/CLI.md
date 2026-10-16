# Fetchary CLI

Fetchary — Extract what matters.

The CLI calls the same stateless extraction implementation as the Node.js library.
It writes extracted results to stdout and errors or requested diagnostics to
stderr. It never creates a database, saved sources, archives, or schedules.

## Installation and usage

Requires Node.js 26 or newer. Puppeteer supplies Chrome for Testing; no separate
browser installation is required.

```bash
npm install --global fetchary
fetchary --version
fetchary --help
fetchary extract <type> <url> [options]
```

Running without arguments or with `--help` prints help and exits successfully.
`--version` prints the package version. Help can also follow a command.

## Extraction types

| Type | Example | Default output |
| --- | --- | --- |
| `text` | `fetchary extract text https://example.com` | Readable text |
| `html` | `fetchary extract html https://example.com` | HTML |
| `favicon` | `fetchary extract favicon https://example.com` | Selected image URL |
| `images` | `fetchary extract images https://example.com` | JSON result |
| `avatar` | `fetchary extract avatar https://github.com/oliverjessner` | Selected image URL |
| `selector` | `fetchary extract selector https://example.com --selector h1` | Selected text |
| `social-links` | `fetchary extract social-links https://example.com` | JSON result |
| `social-insights` | `fetchary extract social-insights https://www.youtube.com/@YouTube` | JSON result |

Text and HTML contain exactly the extracted string, with no extra newline or
status message. Image URLs end with a newline. JSON results are objects with
common metadata and a `data` field, followed by a newline. An empty URL-only list
produces no output. Standard output is never colorized.

### Text and HTML

```bash
fetchary extract text https://example.com --include-selector h1
fetchary extract html https://example.com --ignore-selector script
fetchary extract text https://example.com --mode http --json
```

Text removes scripts, styles, comments, and markup, decodes entities, normalizes
whitespace, and preserves block/paragraph separation. HTML keeps the captured
markup, except for explicitly requested selection or removal. Non-HTML resources
are returned as decoded text without DOM conversion. This is not a binary
file downloader.

`--include-selector` and `--ignore-selector` are repeatable. Includes select the
first match per selector in page order; overlapping subtrees appear once. Ignores
remove every matching element, including selected roots and ancestors. Missing
include matches return empty content. These options apply to `text` and `html`.

### Favicon and avatar

```bash
fetchary extract favicon https://example.com --json
fetchary extract avatar https://github.com/oliverjessner --mode http
```

Favicon candidates include icon and Apple touch links, Web App Manifest icons,
and `/favicon.ico`. Relative URLs use the document base; manifest icons use the
manifest's final URL. Broken or inaccessible candidates are skipped. SVG is
preferred as scalable; other candidates are ordered by measured pixel area.
PNG, JPEG, GIF, WebP, ICO, and SVG headers are inspected. ICO uses its largest
embedded image. Other image MIME types may retain unverified declared dimensions.
This checks headers, not full image decoding or visual quality.

At most eight manifests (1 MiB each) and 64 unique image candidates (16 MiB each,
four concurrent requests) are checked, also subject to `--max-response-bytes`.
These requests do not write files and are not independently cached.

Avatar extraction uses account-specific adapters for GitHub, Instagram, Threads,
X, TikTok, Twitch, LinkedIn, and YouTube. It rejects unrelated accounts, post
previews, and banners. A verified square metadata image is a fallback on adapters
which support it. Public HTTP avatar data can be used when the same platform's
browser capture reaches a recognizable login wall; a different profile or
external redirect cannot supply that fallback. See [Social support](SOCIAL_SUPPORT.md).
An unsupported avatar platform is an argument error; a supported profile without
an accessible avatar is a not-found error.

### Images

```bash
fetchary extract images https://example.com --urls-only
fetchary extract images https://example.com --exclude-metadata
fetchary extract images https://example.com --source lazy --source srcset
```

Discover URLs from image `src`, `srcset`, picture sources, `data-src`,
`data-original`, `data-lazy-src`, `data-lazy`, `data-url`, `data-srcset`, Open Graph
and Twitter image metadata, image-file hyperlinks, and inline background URLs.
External CSS files and computed styles are not inspected. Relative and
protocol-relative URLs resolve against the document's valid first base URL.
Only HTTP(S) URLs without embedded credentials are returned.

URLs are unique by default, retaining deterministic page/source order.
`--duplicates` keeps repeated image references. `--exclude-metadata` omits metadata
images. Repeat `--source` to include only `img`, `srcset`, `lazy`, `metadata`,
`link`, or `background`. This extractor never downloads binary images. Dimensions
from HTML attributes are hints, with `resolutionVerified: false`.

### Selector

```bash
fetchary extract selector https://example.com --selector h1 --format text
fetchary extract selector https://example.com --selector p --format html --all
fetchary extract selector https://example.com --selector a --attribute href --all
```

`--selector` is required and validated by linkedom. By default only the first
matching element is returned, as text. `--all` selects all matches in document
order. `--format html` returns outer HTML. `--attribute` instead returns the raw
attribute value, without resolving relative URLs; absent attributes are `null`
in JSON and omitted from plain output. `--format` applies only to selector output.
No matches succeeds with `data: { matched: false, values: [] }` in JSON and empty
plain output. Invalid CSS is an argument error. Multiple plain values are joined
with a newline, without an extra trailing newline.

### Social links

```bash
fetchary extract social-links https://example.com --youtube
fetchary extract social-links https://example.com --platform youtube --urls-only
```

Discover supported social URLs in hyperlinks, `rel="me"` links, JSON-LD `sameAs`,
`og:url`, `og:see_also`, and `twitter:url`. Exact domain/subdomain rules avoid
lookalikes such as `fake-youtube.com`. Account and post identities, URL query
parameters, and fragments are preserved. Deduplication uses the resolved absolute
URL; equivalent platform aliases may remain separate URLs.

`--platform` accepts `youtube`, `tiktok`, `instagram`, `facebook`, `x`, `threads`,
`linkedin`, `twitch`, `reddit`, `github`, `vimeo`, and `bluesky`. `twitter` aliases
`x`. `--youtube` is exactly `--platform youtube`; conflicting filters are rejected.
Each link includes `platform`, `url`, `kind`, and discovery `source`. Kinds are
`profile`, `channel`, `post`, `video`, or `unknown`; recognition makes no request
to that social URL and does not prove the account/post exists.

### Social insights

```bash
fetchary extract social-insights 'https://www.youtube.com/watch?v=VIDEO_ID'
fetchary extract social-insights https://www.tiktok.com/@example
fetchary extract social-insights https://www.instagram.com/example/
```

Return public metrics scoped to the requested profile/channel/post/video.
YouTube, TikTok, and Instagram have additional structured metric parsers; existing
adapters retain profile follower extraction. Every missing metric remains `null`
with an availability reason. Abbreviated counts carry approximation metadata.
Unsupported platforms produce an explicit `unsupported` result, not invented
metrics. HTML login/CAPTCHA walls and HTTP 401/403/429 return explicit availability.
Other transport failures use a nonzero exit code. An inspectable unavailable or
blocked insight result is a successful command (exit 0).

See [Social support](SOCIAL_SUPPORT.md) for implemented patterns and fixtures and
[Library schemas](LIBRARY.md#result-schemas) for the exact result format.

## Shared options

| Option | Behavior |
| --- | --- |
| `--json` | Full structured result for any extraction; takes precedence over `--urls-only` |
| `--mode auto\|http\|browser` | Default `auto`: HTTP first, optional browser fallback |
| `--timeout <ms>` | Positive milliseconds per request/phase; default 30000 |
| `--user-agent <text>` | HTTP and browser user agent; default `fetchary/2.0` |
| `--wait-after-load <duration>` | Browser post-load wait; default `5s`; accepts `500ms`, `5s`, or `0ms` |
| `--max-response-bytes <bytes>` | Positive safe integer; default 10485760 (10 MiB) |
| `--allow-private-network` | Explicitly allow trusted local/internal targets |
| `--quiet` | Suppress successful output, keeping errors on stderr |
| `--verbose` | Print operation/mode diagnostics on stderr |
| `--no-color` | Accepted for compatibility; output already has no ANSI colors |
| `--help`, `--version` | Print help/version without extracting |

Value options support both `--option value` and `--option=value`. Use `--` to
end option parsing. Unknown options and operation-specific options used with the
wrong type are rejected. There is no data-directory or monitoring configuration.

## Capture, network access, and cache

`http` uses only the server response. `browser` performs HTTP capture and renders
HTML through Chromium; non-HTML responses skip rendering. `auto` starts with HTTP
and falls back for JavaScript shells, missing selectors/lists on scripted pages,
missing favicon/avatar candidates, or incomplete insights on scripted pages.
It does not launch Chromium for usable static content or to bypass access walls.
A fallback reuses the original HTTP capture and launches at most one browser.
The browser waits for `load`, then the post-load wait, rather than network idle.

Private, loopback, link-local, reserved/internal targets and embedded URL
credentials are rejected by default. DNS answers, redirect targets, browser
navigation, and browser resources are checked. Native HTTP connections use
validated DNS addresses. Browser requests are fulfilled by the guarded transport;
direct browser networking is disabled through a deny proxy. Local opt-in is for
trusted inputs and also applies to resources and redirects. No proxy rotation,
authentication, CAPTCHA solving, or headless user-agent disguise is performed.

Timeouts, cancellation (library `signal`), response limits, and redirect limits
also apply to auxiliary requests. Up to ten redirects are followed; cross-origin
redirects strip Authorization, Cookie, and Proxy-Authorization headers. The
rendered DOM has the same byte limit; total fetched browser resources are limited
to four times that limit. Invalid or incomplete captures are not retained.

Compatible page captures share a process-local, RAM-only cache, with a default
45-second TTL, 100 entries, and approximately 50 MiB of retained payload memory.
Expiration is lazy; LRU eviction bounds memory, with no background refresh or
cleanup timer. Simultaneous compatible calls share in-flight work. HTTP and
browser cache entries remain separate. Separate CLI executions start empty.
`cache: { hit, ageMs, ttlMs }` appears in JSON; plain output has no cache diagnostics.
`capturedAt` preserves the snapshot time, while `extractedAt` is the result time.
The [library](LIBRARY.md#capture-cache) exposes TTL overrides, disabling, clients,
and clearing. There are no CLI cache flags or disk cache.

## Compatibility and exit codes

These standalone aliases remain:

```bash
fetchary extract https://example.com --text
fetchary favicon https://example.com
fetchary profile-picture https://github.com/oliverjessner
```

Their default capture strategy is now `auto`. The old monitoring, stored-source,
scheduler, archive, and vendor-activation commands are removed. Existing user
directories are neither read nor deleted.

| Code | Meaning |
| --- | --- |
| 0 | Successful extraction, including empty matches and explicit insight unavailability |
| 1 | Unexpected error |
| 2 | Invalid input, unsupported options, unsafe URL, or unsupported avatar platform |
| 3 | HTTP, DNS, timeout, or cancellation failure |
| 4 | Browser launch/navigation/snapshot failure |
| 5 | No accessible favicon or avatar |

Errors go to stderr. With `--json`, their shape is
`{ "error": "Fetchary…Error", "message": "…" }`. There is no change-detection
exit code. Historical application data requires no migration for extraction.
