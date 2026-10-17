# Fetchary CLI

The CLI calls the same extraction implementation as the Node.js library.
It writes extracted results to stdout. `--filepath` also saves successful output;
the executable keeps the most recent 100 commands in a local history file.

## Installation and usage

```bash
fetchary --version
fetchary --help
fetchary extract <type> <url> [options]
fetchary analyse <url> [options]
fetchary login <url> [--session <name>] [options]
fetchary sessions [--json] [--session-dir <directory>]
fetchary logout <name> [--session-dir <directory>]
fetchary history [--json|--list]
```

Running without arguments or with `--help` prints help and exits successfully.
`--version` prints the package version. Help can also follow a command.

## Save command output

```bash
fetchary extract text https://example.com --filepath .
fetchary extract html https://example.com --filepath .
fetchary extract links https://example.com --json --filepath .
fetchary extract links https://example.com --list --filepath ./links.txt
fetchary analyse https://example.com --filepath ./reports/
fetchary history --json --filepath ./history.json
fetchary --filepath .
```

`--filepath <path>` works before or after any command, including compatibility
aliases, login/session commands, history, help and version. With no command it
saves help. The file contains the exact successful stdout bytes; prompts,
diagnostics and errors on stderr are excluded. Stdout remains available as usual;
`--quiet` suppresses stdout while still saving the file. A successful empty list
creates an empty file. Failed commands do not save output.

An existing directory, a path ending in a separator, or a new path without an
extension is an output directory; missing directories are created. Directory
exports get a unique filename containing the command/type, UTC timestamp and
random suffix. A path with an extension selects that exact filename. Existing
files and symlinks are never overwritten. New files use POSIX mode `600`.

| Selected output | Automatic extension |
| --- | --- |
| `--json` or a command/type whose default output is JSON | `.json` |
| HTML extraction or selector `--format html` | `.html` |
| Text, URL lists, selected values, session/history summaries, help/version | `.txt` |
| Favicon `--binary` | Original image extension, or `.bin` if unknown |

Flags choose the contents; an explicit filename does not convert data. `--json`
still overrides `--list`; help/version always remain plain text. Path validation uses exit 2; output-write failures use
exit 1. The command's action may already have completed when saving fails.
`--verbose` reports the saved path on stderr.

## Command history

```bash
fetchary history
fetchary history --json
fetchary history --list
fetchary extract text https://example.com --no-history
```

The executable records the latest 100 command attempts, including failures, in
`~/.fetchary/history.json`. Entries contain the UTC `timestamp`, redacted `args`
array and `exitCode`. Display is newest first. Plain output shows time, exit code
and command; `--list` prints command lines; JSON adds a shell-quoted `command`
field. Page content and extraction results are not stored in this history.

`history` does not record itself. Help, version and empty invocations are omitted.
`--no-history` skips any one call. Importing/using the Node.js extraction library
does not record commands. `FETCHARY_HISTORY_FILE` overrides the history-file path.
Its parent is created only when recording a command. A missing history returns
an empty successful result without creating files. `history` accepts `--json`,
`--list`, `--filepath`, `--quiet`, `--verbose`, `--no-color` and `--no-history`.

Atomic writes are serialized across processes. A stale lock from an exited
process is recoverable after 30 seconds. The history file is bounded to 2 MiB.
New history directories/files use
private modes `700`/`600`; the immediate parent directory and file must belong
to the current user and be private on POSIX. Malformed/unreadable history is
reported rather than overwritten. Recording failures print a warning on stderr
and preserve the command's exit code.

History excludes stdout, cookie contents and browser form input. URL credentials,
sensitive query values (tokens, passwords, signatures, authorization codes),
fragments and credential flags are redacted. Other arguments, including paths,
URLs and session names, remain visible; arguments over 4096 characters are
truncated. Use `--no-history` for other private argument values.

## Website analysis

```bash
fetchary analyse https://oliverjessner.at
fetchary analyse https://oliverjessner.at --json
fetchary analyse https://oliverjessner.at --list
fetchary analyse https://oliverjessner.at --mode browser --wait-after-load 500ms
fetchary analyse https://oliverjessner.at --default-country AT > analysis.json
```

`analyse` combines these extractors, in this order: `favicon`, `links`,
`social-links`, `emails`, `telephone`, `images`, `documents`, `structured-data`,
`metadata`, `tracker-intelligence`. It inspects one supplied page without crawling
its links, downloading linked documents or collecting social profile metrics.

The default output is a complete JSON report, identical to `--json`:

```js
{
    // Common capture metadata: requestedUrl, finalUrl, status, timestamps, cache, ...
    type: 'analyse',
    results: {
        favicon: { type: 'favicon', data: { /* image metadata */ }, /* capture metadata */ },
        links: { type: 'links', data: [/* link occurrences */], /* capture metadata */ },
        // The other eight named extraction results follow in the order above.
    },
    errors: {},
    summary: { succeeded: 10, failed: 0 },
}
```

Each successful section keeps the complete standalone result and its original
schema, including metadata and convenience aliases. A failed section is `null`
and `errors[section]` contains `{ error, message, status?, phase? }`.
`summary` counts successful and failed extractors, not individual findings.
Empty lists count as successful results. A missing favicon therefore gives nine
successful sections and one failure, with a valid report and exit code 0.
Failure of the primary capture, invalid input, or cancellation fails the command
using the regular error/exit-code contract. `--quiet` suppresses success output;
`--verbose` sends diagnostics to stderr.

`--list` and its alias `--urls-only` combine each successful section's normal
list output and remove exact duplicate lines in first-occurrence order. Values
can include URLs, contacts, metadata strings, compact structured-data JSON and
tracker identifiers. Failed sections contribute no lines. `--json` overrides
both list flags; use the full report to inspect section errors.

Common capture/safety flags and `--default-country` apply. Individual extractor
filters (`--platform`, `--source`, selectors, `--binary`, social metric flags,
and other operation-specific flags) are rejected so all sections stay included.
Library cache TTL and AbortSignal options are documented in the
[analysis API](LIBRARY.md#website-analysis).

One analysis shares its primary HTTP capture and at most one browser rendering
across sections, including when cache reuse is disabled. Favicons still require
the usual bounded manifest/icon requests. `http` never renders; `auto` retains
each extractor's fallback rules, so sections may use different raw/rendered
snapshots. Each result's `captureMode` and timestamps identify its source; the
report's common metadata describes the latest successful capture. Explicit
`browser` uses the rendered snapshot for all sections and retains original HTML
for raw-aware extractors such as Tracker Intelligence.

Analysis rendering uses the existing passive tracker policy: inline JavaScript
can change the DOM, but external scripts, pixels, frames and other browser
requests are blocked. Sites requiring external bundles or fetched configuration
may therefore have incomplete results. Ordinary standalone extractors keep
their existing rendering behavior. Analysis does not persist its results.

## Extraction types

| Type              | Example                                                             | Default output     |
| ----------------- | ------------------------------------------------------------------- | ------------------ |
| `text`            | `fetchary extract text https://example.com`                         | Readable text      |
| `html`            | `fetchary extract html https://example.com`                         | HTML               |
| `favicon`         | `fetchary extract favicon https://example.com`                      | Selected image URL |
| `images`          | `fetchary extract images https://example.com`                       | JSON result        |
| `videos`          | `fetchary extract videos https://example.com`                       | JSON result        |
| `avatar`          | `fetchary extract avatar https://github.com/oliverjessner`          | Selected image URL |
| `selector`        | `fetchary extract selector https://example.com --selector h1`       | Selected text      |
| `social-links`    | `fetchary extract social-links https://example.com`                 | JSON result        |
| `social-insights` | `fetchary extract social-insights https://www.youtube.com/@YouTube` | JSON result        |
| `emails`          | `fetchary extract emails https://example.com/contact`              | JSON result        |
| `telephone`       | `fetchary extract telephone https://example.com/contact`           | JSON result        |
| `links`           | `fetchary extract links https://example.com`                       | JSON result        |
| `documents`       | `fetchary extract documents https://example.com`                   | JSON result        |
| `metadata`        | `fetchary extract metadata https://example.com`                    | JSON result        |
| `structured-data` | `fetchary extract structured-data https://example.com`             | JSON result        |
| `tracker-intelligence` | `fetchary extract tracker-intelligence https://example.com` | JSON result |

Text and HTML contain exactly the extracted string, with no extra newline or
status message. Image URLs end with a newline. Unfiltered JSON results are objects with
common metadata and a `data` field, followed by a newline. An empty URL-only list
produces no output. Standard output is never colorized.

### List output

`--list` works with every extraction type and the compatibility aliases. It prints
one URL or selected value per line, with a trailing newline, no headings, bullets,
or metadata. An empty list prints nothing. `--urls-only` is an alias for `--list`.

```bash
fetchary extract social-links https://www.tiktok.com/@oliverjessner --platform tiktok --list
fetchary extract images https://example.com --list
fetchary extract videos https://example.com --list
fetchary extract html https://example.com --list
fetchary extract selector https://example.com --selector a --attribute href --list
```

| Type | List contents |
| --- | --- |
| `text`, `html` | HTTP(S) hyperlinks from `a[href]` and `area[href]`; for non-HTML responses, whitespace-delimited HTTP(S) URLs |
| `images` | Discovered image URLs, respecting source filters and `--duplicates` |
| `favicon`, `avatar` | The selected image URL |
| `selector` | All matching values, as if `--all` were supplied; missing/empty values are omitted and embedded line breaks become spaces |
| `social-links` | Discovered social URLs, respecting `--platform`/`--youtube` |
| `social-insights` | The inspected profile/post URL; with `--follower`/`--posts`, the selected counts |
| `emails` | Found email addresses |
| `telephone` | Found phone numbers in international form, retaining extensions |
| `links`, `documents`, `videos` | Unique discovered URLs in first-occurrence order; JSON retains every occurrence |
| `metadata` | Present values in title, description, canonical, language, publishedAt, modifiedAt order; nulls omitted |
| `structured-data` | One compact JSON object per line, JSON-LD first and Microdata items second |
| `tracker-intelligence` | Provider/identifier pairs; provider name alone when no identifiers exist; Matomo includes its scope |

Text/HTML link lists resolve relative URLs against the document base and final
page URL, remove duplicates in discovery order, and ignore non-HTTP schemes and
URLs containing credentials. Include/ignore selectors still apply. Selector
attribute values retain their original form, including relative URLs.

The flag formats results from the captured page; it does not scroll, paginate,
or crawl every post on a profile. Use `--mode browser` when links require
JavaScript rendering. `--json` takes precedence over either list flag and keeps
the original structured result. `--quiet` suppresses successful list output;
diagnostics/errors stay on stderr. `--binary` cannot be combined with either
list flag (exit 2).

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
include matches return empty content. These options apply to `text`, `html`,
`emails`, `telephone`, `links`, `documents`, and `videos`.

### Videos

```bash
fetchary extract videos https://example.com
fetchary extract videos https://example.com --list
fetchary extract videos https://example.com --include-selector main --ignore-selector footer
fetchary extract videos https://example.com --mode browser --wait-after-load 500ms --list
```

`videos` discovers video references from the captured page:

- `video[src]` and child `source[src]`, including extensionless media endpoints.
- Direct file links in `a`, `area`, `link`, `iframe`, `embed`, and `object`, plus
  video MIME types, download filenames and query format/filename hints.
- Individual video links and recognized players on YouTube (including privacy
  embeds), Vimeo, TikTok, Instagram Reels/TV, Facebook and Twitch.
- Open Graph `og:video`, `og:video:url`, `og:video:secure_url`, Twitter
  `twitter:player` and `twitter:player:stream` metadata.
- JSON-LD `VideoObject` values for `contentUrl`, `embedUrl` and `url`, including
  nested objects and arrays; matching properties inside VideoObject Microdata.
- Lazy `data-src`, `data-lazy-src` and `data-original` attributes on video,
  source and iframe elements when they identify videos by the same rules.

Recognized extensions are `mp4`, `m4v`, `webm`, `mov`, `avi`, `mkv`, `ogv`,
`mpeg`, `mpg`, `mpe`, `ts`, `mts`, `m2ts`, `3gp`, `3g2`, `flv`, `f4v`, `wmv`,
`m3u8` and `mpd`. HLS/DASH references may describe audio-only streams; media
contents are not inspected. Generic social posts and profile links do not prove
that a video exists and are excluded.

JSON returns each occurrence in `data` and its convenience alias `videos`.
Records contain `url`, `rawUrl`, the source tag (or `json-ld`), `originalAttribute`,
and nullable `extension`, `contentType` and `platform` hints. The top-level
`contentType` describes the captured page. `--list`/`--urls-only` prints unique
URLs in discovery order. `--json` takes precedence; empty discoveries succeed
with empty arrays or no list output. `--binary` is unavailable.

Relative URLs use the document base and final page URL. Only HTTP(S) URLs without
credentials are returned; posters, audio/image elements, template/noscript
content and executable scripts are excluded. Include/ignore selectors use the
same scope rules as links and documents. JSON-LD is parsed without execution;
malformed or excessively nested blocks are skipped. Non-HTML responses produce
empty arrays.

The extractor does not request discovered targets, inspect media bytes, crawl,
scroll or paginate. Ordinary browser capture can load page resources. `auto`
renders once when a scripted page has no discovered videos; use `http` to avoid
rendering, or `browser` to inspect JavaScript content even when HTTP found videos.

### Tracker intelligence

```bash
fetchary extract tracker-intelligence https://example.com
fetchary extract tracker-intelligence https://example.com --json
fetchary extract tracker-intelligence https://example.com --list
fetchary extract tracker-intelligence https://example.com --mode browser --wait-after-load 500ms
```

Default output and `--json` both include the complete extraction result:
`data: { trackers, externalHosts, summary: { providers, uniqueIdentifiers } }`.
An empty page succeeds with empty arrays and zero counts. Shared capture flags
apply; there are no provider-specific flags or include/ignore selectors.

`--list` prints one `provider:value` line per identifier. A provider without an
identifier prints its name alone, including Plausible, whose tracked domains
are configuration rather than account identifiers. For example:

```text
google-tag-manager:GTM-ABC1234
matomo:https%3A%2F%2Fstats.example.com%2Fmatomo.php:1
meta-pixel:123456789012345
plausible
```

Matomo uses `matomo:<encodeURIComponent(server endpoint)>:<site ID>`; a missing
server prints `matomo:unscoped:<site ID>`, which must not be used for cross-site
correlation. Provider names, identifier arrays, evidence and hosts have stable,
lexicographic ordering. `--json` takes precedence over `--list`; `--quiet`
suppresses successful output. No findings print nothing in list mode.

`auto` and `http` inspect only the HTTP document for this extractor. Explicit
`browser` mode reuses that document in the existing guarded Chromium capture,
allows inline JavaScript to update the DOM, and blocks all further resources,
external JavaScript, frames, connections and navigation. It merges raw HTML and
rendered DOM findings. This deliberately limits sites whose tags require an
external bundle, consent action or fetched configuration. There is no tracker
API request, script download for analysis, scrolling or crawling.

A `confirmed_configuration` is a recognized initialization, valid identifier in
a provider endpoint, explicit tracker configuration attribute, or Plausible
script with `data-domain`. A `provider_reference` is a known resource or
initialization without a usable identifier. Neither classification establishes
execution, successful transmission, ownership, or control. Plain prose, code
comments, quoted code examples, JSON-LD and ordinary hyperlinks do not install
a tracker. Static signatures cannot establish whether code is reachable or
whether a referenced script is genuine.

See [provider support, schemas and comparison example](LIBRARY.md#tracker-intelligence)
for the exact identifier types and limitations.

### Metadata and structured data

```bash
fetchary extract metadata https://example.com --json
fetchary extract structured-data https://example.com
fetchary extract structured-data https://example.com --list
```

Both types inspect the entire captured document and accept the shared capture
options. `metadata` returns `data: { title, description, canonical, language,
publishedAt, modifiedAt }`. Values are strings or `null`. Title and description
prefer HTML/meta tags, then Open Graph/Twitter values, then eligible Schema.org
page/article objects. Canonical comes from a valid HTTP(S) `rel=canonical` link
and resolves against the document base/final page URL. Language prefers HTML
`lang`/`xml:lang`, then Content-Language/OG locale metadata and Schema.org values;
locale underscores become hyphens. Date meta tags and matching Schema.org dates
retain their declared strings, including date-only values and timezone offsets.
Generic event times and unrelated article/author dates are not substituted.

`structured-data` returns `data: { jsonLd, microdata, errors }`. JSON-LD blocks
are parsed as JSON; root arrays become individual objects and `@graph`,
`@context`, vocabulary names, and values remain intact. A standalone response
with MIME type `application/ld+json` is also supported. Remote contexts are not
requested and JSON-LD is not expanded into RDF. Schema.org data is retained in
both JSON-LD and Microdata; RDFa is outside these two parsers.

Microdata uses `itemscope`, `itemtype`, `itemid`, `itemprop`, and `itemref`.
Top-level items contain `types`, `id`, and a `properties` object whose values are
arrays of strings, nested items, or `null` for a cyclic/deep reference. Repeated
properties retain DOM order. URL-valued HTML properties resolve against the
document base; `meta`, `time`, `data`, and `meter` use their typed attributes.
Ordinary property text and numeric-looking values remain strings.

Malformed JSON-LD and Microdata issues are returned in `errors` with `source`,
zero-based `index`, and `message`, while other valid records remain available.
JSON-LD depth is limited to 128 levels. Microdata allows 64 nested levels and
10000 expanded property values, with a text budget based on `maxResponseBytes`;
an over-budget root is omitted with a diagnostic. Empty results succeed: metadata
has six null fields; structured data has empty arrays. Non-HTML content produces
empty results except for standalone JSON-LD.

Both default to the full extraction JSON. `--list`/`--urls-only` emit the values
listed above; diagnostics remain available in full JSON. `--json` takes precedence
over list mode. Auto capture renders only when all metadata fields or both data
collections are empty and the HTML contains executable scripts; valid data-only
JSON-LD scripts do not trigger rendering. Use `--mode browser` to inspect metadata
or structured data changed by JavaScript even when initial values already exist.
See [library schemas and precedence](LIBRARY.md#metadata-and-structured-data-records).

### Links and documents

```bash
fetchary extract links https://example.com --json
fetchary extract links https://example.com --include-selector main
fetchary extract documents https://example.com --list
fetchary extract documents https://example.com --ignore-selector footer --json
```

`links` discovers HTTP(S) URLs in `a[href]`, `area[href]`, and `link[href]`,
including canonical, alternate, and resource links. Relative URLs resolve against
the document base and final captured page URL. Empty hrefs and fragment links
are retained; queries/fragments are preserved. Other schemes and URLs containing
credentials are skipped. `internal` means the target has the same origin as the
final page (scheme, hostname, and port); subdomains or different ports are external.

Every occurrence contains `url`, `rawUrl`, `text`, `rel`, `internal`, `source`,
and `location: { pageUrl, selector, attribute }`. The CSS selector identifies
the element in the captured DOM, including when include/ignore selectors filter
results. `text` normalizes whitespace and decodes entities; empty link text can
use an accessible label, area/image alt text, or title. `rel` is an array of
distinct lowercase tokens. Repeated URLs retain separate texts and locations in
JSON. `--list`/`--urls-only` print each URL once, in discovery order. Templates and
other inert script/style/noscript content are ignored.

#### Links from XML sitemaps

```bash
fetchary extract links https://oliverjessner.at/sitemap.xml --list
fetchary extract links https://oliverjessner.at/sitemap.xml --json
fetchary extract links https://oliverjessner.at/sitemap.xml --list --filepath .
```

`links` reads XML Sitemap `urlset/url/loc` and index `sitemapindex/sitemap/loc`
entries from the [Sitemaps protocol](https://www.sitemaps.org/protocol.html).
Default/prefixed Sitemap namespaces and unnamespaced files are supported.
The XML root is recognized even when servers label the response as HTML or
another content type. XML entities and CDATA are decoded; relative values resolve
against the final sitemap URL. Only credential-free HTTP(S) URLs are returned.
Image/video-extension locations and namespace/schema declarations are excluded.

Each occurrence has `source: 'loc'`, empty `text`/`rel`, and
`location.attribute: 'textContent'`. `rawUrl` preserves decoded element text;
the location selector identifies that `<loc>` in the XML DOM. JSON retains all
occurrences, while `--list` deduplicates in document order. Include/ignore
selectors apply to the XML DOM with the same first-match/subtree rules as HTML.
Sitemaps with DTD/entity declarations are skipped. This does not perform schema
validation or recursively fetch sitemap-index targets/listed pages. Existing
response limits apply.

#### Document links

`documents` uses the same metadata and also inspects `iframe[src]`, `embed[src]`,
and `object[data]`. It recognizes file extensions, `type` MIME hints, download
filenames, and common query parameters (`file`, `filename`, `name`, `path`,
`attachment`, `document`, `download`, `format`, `ext`, `extension`, `type`).
Detection priority is MIME hint, download filename, URL path, then query hint.
Explicit downloads of an unknown format are retained with nullable format fields;
obvious image, media, executable, script, and stylesheet downloads are excluded.

Recognized extensions: `pdf`, `csv`, `tsv`, `doc`, `docx`, `docm`, `dot`, `dotx`,
`dotm`, `xls`, `xlsx`, `xlsm`, `xlsb`, `xlt`, `xltx`, `xltm`, `ppt`, `pptx`,
`pptm`, `pot`, `potx`, `potm`, `pps`, `ppsx`, `ppsm`, `odt`, `ods`, `odp`, `odg`,
`odf`, `ott`, `ots`, `otp`, `rtf`, `txt`, `md`, `markdown`, `rst`, `tex`, `epub`,
`mobi`, `azw`, `azw3`, `ics`, `vcf`, `json`, `xml`, `yaml`, `yml`, `ndjson`,
`jsonl`, `log`, `zip`, `7z`, `rar`, `tar`, `gz`, `tgz`, `bz2`, and `xz`.

Document records add `filename`, `extension`, `contentType`, and `detectedBy`.
These describe advertised or inferred format hints; linked targets are not
requested, so their existence and actual response MIME type are not verified.
The top-level `contentType` still describes the captured webpage. Discovery
does not follow linked pages or download files. Empty results succeed with
`data: []` (or no list output). HTTP/browser capture, cache and safety limits
apply as usual. See [record schemas](LIBRARY.md#link-and-document-records).

### Emails and telephone

```bash
fetchary extract emails https://example.com/contact --list
fetchary extract telephone https://example.com/contact --default-country AT --list
fetchary extract emails https://example.com --include-selector main --json
```

Both types return a JSON result with `data: string[]` by default. `emails` also
has `emails`; `telephone` has `numbers`. `--list` and its alias `--urls-only`
print the addresses/numbers directly, one per line. No contacts is a successful
empty array (or no output with `--list`). Includes and ignores filter the page
before contact extraction.

Emails are read from `mailto:` recipients (including `cc`/`bcc`), page text,
microdata `email`, and JSON-LD `email` fields. Percent-encoded link recipients and
HTML entities are decoded; query subjects/bodies are ignored. Common ASCII
addresses, including plus tags and punycode domains, are supported. Domains are
lowercased; duplicates are compared case-insensitively, preserving the first
local-part spelling. Obfuscated addresses and quoted/Unicode local parts are not
reconstructed. Script/style/comment/template text is ignored, apart from explicit
JSON-LD contact fields. Non-HTML responses are scanned as decoded text.

Telephone extraction reads `tel:` links, page text, microdata `telephone`, and
JSON-LD `telephone` fields. Numbers must pass the bundled numbering-plan checks
and are normalized to international `+` form; extensions use `;ext=42`. This
checks number syntax, not ownership or reachability. Duplicates are removed after
normalization. Emergency/short numbers are omitted. `--default-country <code>`
accepts a supported uppercase two-letter country code such as `AT`, `DE`, or `US`
and applies only to `telephone`. Without it, national numbers are not inferred.
Leading `00` on a complete contact value is treated as an international prefix;
in surrounding prose, international dialing prefixes follow the selected country's
rules. Country is never inferred from the website hostname or page language.

Contact links are inspected without following contact pages. HTTP-first capture,
browser fallback for missing scripted contacts, cancellation, caching, and
request limits apply as usual.

### Favicon and avatar

```bash
fetchary extract favicon https://example.com --json
fetchary extract favicon https://example.com --binary > favicon.bin
fetchary extract avatar https://github.com/oliverjessner --mode http
```

Favicons print the selected URL by default. `--binary` writes the selected image's
original bytes to stdout, with no newline, JSON wrapper, or base64 encoding.
It also works with `fetchary favicon <url>`. The format is preserved (including
SVG and ICO); there is no conversion to PNG. Use `--json` separately to inspect
`image.contentType` and choose a suitable file extension. The top-level
`contentType` describes the webpage. Binary output cannot be combined with
`--json`, `--list`, or `--urls-only`, or used with another extraction type (exit 2).
`--quiet` suppresses
successful binary output; diagnostics and errors still use stderr.

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
Binary output reuses the bytes downloaded for validation without requesting the
selected image again. A shell redirection such as `> favicon.bin` saves the output.

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
with a newline, without an extra trailing newline. `--list` selects all matches
and prints one non-empty value per line, followed by a trailing newline.

### Social links

```bash
fetchary extract social-links https://example.com --youtube
fetchary extract social-links https://example.com --platform youtube --list
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
fetchary extract social-insights https://github.com/oliverjessner --follower
fetchary extract social-insights https://www.tiktok.com/@example --posts
```

`--follower` selects only the follower count, using subscribers for YouTube.
`--posts` selects only the profile's post count (TikTok videos or Instagram
posts, where supported). Each flag is a boolean and applies only to
`social-insights`; using it with another type is an argument error (exit 2).

With one flag, stdout contains just the number or literal `null`, followed by
a newline. `--json` keeps this scalar result. Missing, unsupported, or blocked
metrics stay `null`; a measured zero stays `0`. The full command without either
flag retains availability reasons, provenance, and metadata.

Both flags can be combined. The default/JSON output is then an object such as
`{ "followers": 12345, "posts": 42 }` containing only the two selected fields.
With `--list` or `--urls-only`, the counts appear on separate lines in the fixed
order followers, posts, including `null` for a missing value. `--json` takes
precedence over list output while retaining the selected fields. `--quiet` and
stderr diagnostics work as usual. Selection changes output formatting; capture,
extraction, caching, and platform support follow the same rules.

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

| Option                         | Behavior                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `--json`                       | JSON result, retaining any insight field selection; takes precedence over `--list`/`--urls-only` |
| `--filepath <path>`             | Save successful stdout to a new file or directory; format follows the output flags/type |
| `--no-history`                 | Skip command-history recording for this invocation |
| `--list`                       | URLs/selected values, one per line, for every extraction type |
| `--urls-only`                  | Alias for `--list` |
| `--mode auto\|http\|browser`   | Default `auto`: HTTP first, optional browser fallback                          |
| `--timeout <ms>`               | Positive milliseconds per request/phase; default 30000                         |
| `--user-agent <text>`          | HTTP and browser user agent; default `fetchary/2.0`                            |
| `--wait-after-load <duration>` | Browser post-load wait; default `5s`; accepts `500ms`, `5s`, or `0ms`          |
| `--max-response-bytes <bytes>` | Decoded response/resource/rendered HTML limit; default 20971520 (20 MiB)                               |
| `--cookies <file>`            | Read a Netscape/JSON cookie export; cookie-file captures bypass page caches |
| `--session <name>`           | Read a locally saved Fetchary login session; authenticated captures bypass page caches |
| `--session-dir <directory>`  | Override `~/.fetchary/sessions`; requires `--session` during extraction |
| `--cookies-from-browser chrome` | Read matching cookies directly from Chrome on macOS; bypass page caches |
| `--browser-profile <name\|path>` | Chrome profile directory name or absolute directory path; default `Default` |
| `--allow-private-network`      | Explicitly allow trusted local/internal targets                                |
| `--quiet`                      | Suppress successful output, keeping errors on stderr                           |
| `--verbose`                    | Print operation/mode diagnostics on stderr                                     |
| `--no-color`                   | Accepted for compatibility; output already has no ANSI colors                  |
| `--help`, `--version`          | Print help/version without extracting                                          |

Value options support both `--option value` and `--option=value`. Use `--` to
end option parsing. Unknown options and operation-specific options used with the
wrong type are rejected. There is no data-directory or monitoring configuration.

## Signed-in sessions

Session imports work with any extraction type, the standalone aliases and
`analyse`. They do not ask for or save your website password.

### Interactive browser login

```bash
fetchary login https://www.linkedin.com --session linkedin
fetchary extract social-insights https://www.linkedin.com/in/oliverjessner --follower --mode browser --session linkedin
fetchary extract videos https://www.linkedin.com/in/oliverjessner --session linkedin --list
fetchary sessions
fetchary sessions --json
fetchary logout linkedin
```

`login` opens a visible, temporary Chromium browser and a fresh isolated context.
Sign in on the website, including any MFA or consent steps, then return to the
terminal and press Enter. Passwords are entered on the website, not through
Fetchary. This does not read your existing Chrome profile or macOS Keychain and
does not need permission to access Chrome cookies. The login window uses normal
browser networking for interactive forms and SSO; extraction keeps its existing
guarded HTTP/browser transport. No vendor overlays are automatically dismissed
in the login window.

The default session name is the target hostname, for example
`www.linkedin.com`. `--session` chooses a different name: 1–64 lowercase letters,
digits, dots, underscores or hyphens, starting with a letter or digit. Session
selection during extraction is explicit; there is no automatic login or session
lookup. Use the same hostname where possible. A saved session is restricted to
the login hostname and its descendants, with normal cookie domain/path/secure
rules still applied. Parent-domain and sibling-host extractions require a
matching login. Unrelated SSO-provider cookies and partitioned cookies are not
saved.

Sessions are JSON files under `~/.fetchary/sessions`, containing website cookies,
origin and save time. Cookies grant account access: these files are not encrypted.
On POSIX systems the directory must be private (`700`) and files must be private
(`600`) and owned by the current user; session files and the session directory
cannot be symlinks.
New directories/files use those permissions. `--session-dir` overrides the
directory for login, extraction, listing and logout. A successful login atomically
replaces the named session. Cancelled/failed logins preserve the old session.
Extraction rereads the file and never updates it; log in again to refresh expired
or revoked credentials.

An interactive terminal is required. Ctrl+C, terminal EOF, closing the login page,
or closing the browser cancels without saving. The overall login timeout is five
minutes; `--timeout <ms>` overrides it. Initial navigation and browser launch are
each limited to at most 30 seconds. Only HTTP(S) URLs without embedded credentials
are accepted; private initial targets require `--allow-private-network`.
`login` accepts `--session`, `--session-dir`, `--timeout`,
`--allow-private-network`, `--json`, `--quiet`, `--verbose` and `--no-color`.
Prompts stay on stderr, including with `--json`/`--quiet`; stdout contains only the
result or is suppressed by `--quiet`.

Saving confirms that cookies were captured, not that every extractor can access
the account. Sites requiring localStorage/IndexedDB tokens or rejecting automated
browsers may remain unavailable. Those stores and saved passwords are not
exported. An empty/expired cookie set fails without replacing a previous session.
`--session` conflicts with `--cookies`, `--cookies-from-browser` and a library
Cookie header. It works with every extraction type and `analyse`, and bypasses
both completed and in-flight capture caches.

`sessions` prints session names, origins and active cookie counts; `--json` adds
save timestamps and total counts. Cookie values are never printed. It accepts
`--session-dir`, `--json`, `--quiet` and `--no-color`. An absent directory gives
an empty successful result without creating it. Invalid session files produce a
validation error. `logout <name>` deletes only that local session file, not the
website account or other browser sessions; a missing name is a successful no-op.
It supports the same output/directory flags as `sessions`. JSON is
`{ session, removed }`; login JSON is `{ session, origin, savedAt, cookieCount }`.
Validation/file errors use exit 2, browser/timeout failures exit 4, and interrupted
logins exit 3.

### Chrome on macOS

Read the relevant cookies directly from your signed-in Chrome profile:

```bash
fetchary extract social-insights https://www.linkedin.com/in/oliverjessner --follower --mode browser --cookies-from-browser chrome
```

The default profile is `~/Library/Application Support/Google/Chrome/Default`.
Select another profile with its directory name (not its Chrome display name),
or pass an absolute profile directory path:

```bash
fetchary analyse https://example.com --cookies-from-browser chrome --browser-profile "Profile 1"
fetchary extract text https://example.com --cookies-from-browser chrome --browser-profile "/absolute/path/to/Chrome/Default"
```

Fetchary opens the existing `Network/Cookies` or `Cookies` SQLite database in
read-only mode. It loads only unexpired, unpartitioned cookies that can match the
initial hostname or its descendants. Unrelated sessions are not decrypted.
The selected profile is reread on every operation; `analyse` reads it once.
No cookie export, persistent copy, saved password, key or refreshed session is
written. Browser capture still uses a new isolated context rather than launching
Chrome with your personal profile.

Encrypted cookies require the `Chrome Safe Storage` key from your macOS
Keychain. macOS may ask you to allow access. Fetchary only reads the existing
item; it does not create a key, change its permissions, or store the key.
Keychain lookup observes cancellation and a timeout of at most 30 seconds.
Denied access and database/decryption errors fail with validation exit code 2
without printing cookie values or Keychain output. If Chrome locks its database,
close Chrome and retry.

If macOS denies file access (`EPERM`/`EACCES`), check **System Settings → Privacy &
Security** for the terminal or app running Fetchary, or use a cookie export.
File access and Keychain access are separate permissions. See
[Apple's file-access guidance](https://support.apple.com/en-gb/guide/security/secddd1d86a6/web).

This option currently supports **Google Chrome on macOS**, database versions
15–24 and `v10` encryption, including version 24's domain hash verification.
Partitioned cookies are skipped. Database size is limited to 256 MiB, matching
cookies to 3000 entries and 1 MiB. Other browsers, Windows/Linux, newer unsupported
schemas and other encryption formats require an exported `--cookies` file.
The format follows Chromium's [Keychain provider](https://chromium.googlesource.com/chromium/src/+/main/components/os_crypt/async/browser/keychain_key_provider.mm)
and [cookie store](https://chromium.googlesource.com/chromium/src/+/main/net/extras/sqlite/sqlite_persistent_cookie_store.cc).

`--cookies-from-browser` conflicts with `--cookies` and an explicit Cookie request
header. `--browser-profile` requires `--cookies-from-browser`. Both session
sources use the hostname restrictions, isolated browser contexts and cache bypass
described below. Importing a session does not guarantee website access.

### Exported cookie files

`--cookies <file>` reads a local Netscape or JSON export:

1. Sign in normally in your browser.
2. Export only the desired site's cookies as a Netscape cookie file or a JSON
   cookie array, and save the file locally outside your repository.
3. Use the hostname where that session is signed in. For LinkedIn, use
   `www.linkedin.com`:

```bash
fetchary extract social-insights https://www.linkedin.com/in/oliverjessner --follower --mode browser --cookies ~/linkedin-cookies.txt
```

The file path is the argument; cookie values never belong in the command line.
Keep the export private: session cookies grant access to the signed-in account.
Fetchary reads it without changing its contents, creating a session directory,
copying it into application storage or writing refreshed cookies back. It does
not automatically inspect your browser profile or saved passwords.

Accepted exports are Netscape's seven tab-separated fields (including
`#HttpOnly_` records and zero-expiry session cookies), a browser JSON cookie
array, or a JSON object with a `cookies` array such as Playwright storage state.
JSON supports `name`, `value`, `domain`, `path`, `secure`, `httpOnly`, `hostOnly`,
`sameSite`, `session`, and `expires`/`expirationDate` in Unix seconds.
Chromium's `-1` means a session cookie. Unsupported partitioned cookies and
malformed entries are rejected. Files are limited to 1 MiB and 3000 entries.
Cookie data is never evaluated as code.

Domain, host-only, path, Secure and expiration constraints control delivery.
Credentials are additionally restricted to the initially requested hostname and
its subdomains: cookies are not sent to parent/sibling hosts or unrelated
redirect destinations, even if the export contains overly broad domains.
For example, a request to `www.linkedin.com` does not send imported credentials
to `at.linkedin.com` or a third-party image host. A request to `linkedin.com`
can use matching domain cookies on its `www` subdomain, but a host-only cookie
for `www.linkedin.com` cannot authenticate the initial bare-host request.
Use the exact signed-in hostname to avoid an unauthenticated first request.

HTTP captures and auxiliary favicon requests apply the export on each request
and redirect. Browser mode imports relevant cookies, including HttpOnly cookies,
into a fresh isolated (incognito) Chromium context before navigation. Browser session updates
and JavaScript-readable cookies work during that run; the file remains unchanged.
Custom browser launchers must implement `browser.createBrowserContext()` with
`setCookie()`, `newPage()` and `close()`.

Cookie-file captures bypass both global and private-client page caches and
in-flight sharing across independent operations. `analyse` still shares its
capture within that one report. File contents are reread on every operation,
so replacing an export or letting it expire cannot reuse an old authenticated
snapshot. Combining a cookie file with an explicit Cookie request header is
rejected. A missing, malformed, expired-only or unrelated export fails with
validation exit code 2 without printing cookie values.

A session import does not guarantee access: expired/revoked sessions, additional
security checks and CAPTCHA pages can still return `blocked` or `login_required`.
Fetchary does not solve CAPTCHA, perform an automatic login, change its user
agent to impersonate a browser, or expose account credentials in extraction
metadata. Without `--follower`, the full social-insights result retains the
availability reason. See [LinkedIn's sign-in security guidance](https://www.linkedin.com/help/linkedin/answer/a1339220/security-verification-when-signing-in?lang=en).

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
redirects strip Authorization, Cookie, Proxy-Authorization and caller-supplied
headers (except the user agent). Caller headers are scoped to the original origin
for auxiliary/browser requests as well. The
rendered DOM has the same byte limit; total fetched browser resources are limited
to four times that limit. Invalid or incomplete captures are not retained.

The per-response limit also applies to browser scripts and other resources, not
only to the final HTML. Large application bundles can exceed the default 20 MiB
before a usable DOM is captured. Such failures report `browser resource request
failed`, `maxResponseBytes`, the effective byte limit, and the option to change it.
For pages that exceed the default, choose a larger explicit bound:

```bash
fetchary extract social-insights https://youtube.com/@oliverjessner --follower --mode browser --max-response-bytes 33554432
```

This sets 32 MiB per response and for the rendered DOM, with an aggregate browser
resource budget of 128 MiB. The default is 20 MiB per response/DOM and 80 MiB
for the aggregate browser resource budget.
The JSON error format and browser exit code 4 are unchanged. Subresource URLs
and query strings are retained in the library cause chain, rather than copied
into the top-level CLI error message.

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

| Code | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| 0    | Successful extraction or analysis report, including empty matches, section failures and explicit insight unavailability |
| 1    | Unexpected error                                                                   |
| 2    | Invalid input, unsupported options, unsafe URL, or unsupported avatar platform     |
| 3    | HTTP, DNS, timeout, or cancellation failure                                        |
| 4    | Browser launch/navigation/snapshot failure                                         |
| 5    | No accessible favicon or avatar                                                    |

Errors go to stderr. With `--json`, their shape is
`{ "error": "Fetchary…Error", "message": "…" }`. There is no change-detection
exit code. Historical application data requires no migration for extraction.
