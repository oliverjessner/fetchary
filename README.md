# Fetchary

<p align="center">
  <img src="assets/images/logo/logo_raw_trans_250.webp" alt="Fetchary logo" width="250">
</p>

> **Extract what matters.**

Fetchary is a web extraction toolkit for your terminal and Node.js apps.
Ask for text, images, favicons, contact details, social links, or public social metrics without
working out a different set of CSS selectors for every website.

## Install

Node.js 26 or newer is required.

```bash
npm install --global fetchary
```

For a Node.js project:

```bash
npm install fetchary
```

## Examples

### Analyse a website

Get a single report with a page's favicon, links, social profiles, contact details,
images, documents, metadata, structured data, and public tracking integrations:

```bash
fetchary analyse https://oliverjessner.at
```

Add `--list` for the combined values, one per line, or save the full JSON report
with `fetchary analyse https://oliverjessner.at > analysis.json`. The command
inspects that page; it does not crawl the whole website. Missing results in one
section leave the other sections available.

### Read a page

Get readable text, or keep the HTML:

```bash
fetchary extract text https://example.com
fetchary extract html https://example.com
```

Fetchary tries HTTP first. When the extractor needs content added by JavaScript,
it can fall back to bundled Chromium. Use `--mode browser` to request rendering
or `--mode http` to read only the server response.

Fetchary also extracts from sites with broken certificates by default:

```bash
fetchary extract favicon https://www.faktor3.de
```

Add `--secure` when you want to require certificate verification. See the
[CLI reference](docs/CLI.md#tls-certificates) for details.

### Read metadata and structured data

Get a page's title, description, canonical URL, language, and publication dates,
or inspect its embedded Schema.org data:

```bash
fetchary extract metadata https://example.com
fetchary extract structured-data https://example.com
```

Structured data includes JSON-LD objects and Microdata with nested properties.

### Inspect public tracking integrations

See which analytics and advertising tags a page references, including public
tracking IDs when available:

```bash
fetchary extract tracker-intelligence https://example.com --list
```

Matching IDs can help investigate connections between websites, but they do not
prove common ownership or identity. Fetchary inspects the captured page without
contacting the tracking services. See the [tracker reference](docs/CLI.md#tracker-intelligence)
for supported providers and capture limits.

### Find images, videos and icons

```bash
fetchary extract images https://example.com --list
fetchary extract videos https://example.com --list
fetchary extract favicon https://github.com
fetchary extract avatar https://github.com/oliverjessner
```

These commands return URLs. They don't save media files. Video extraction also
finds linked videos and embedded players, such as YouTube and Vimeo.

To get the favicon itself, use `--binary`. You can pipe it to another tool or
save it in its original format:

```bash
fetchary extract favicon https://github.com --binary > favicon.bin
```

### Discover links and documents

Inspect internal and external links, or find downloadable documents:

```bash
fetchary extract links https://example.com
fetchary extract documents https://example.com --list
```

Link results include their text, `rel` values, and where they appeared on the
page. Document discovery finds PDFs, spreadsheets, Word files, and other downloads.

You can also read page URLs from a sitemap:

```bash
fetchary extract links https://oliverjessner.at/sitemap.xml --list
```

### Find contact details

Get email addresses and phone numbers from a contact page:

```bash
fetchary extract emails https://example.com/contact --list
fetchary extract telephone https://example.com/contact --default-country AT --list
```

Use `--default-country` for national phone numbers. Numbers with an international
country code work without it.

### Use a signed-in session

On macOS, you can reuse your signed-in Chrome session:

```bash
fetchary extract social-insights https://www.linkedin.com/in/oliverjessner --follower --mode browser --cookies-from-browser chrome
```

Fetchary reads the relevant cookies without changing your Chrome session or
storing your password. You can also pass an exported cookie file with
`--cookies ~/linkedin-cookies.txt`. See [signed-in sessions](docs/CLI.md#signed-in-sessions)
for profiles, supported exports and session limits.

### Select an element

When you know exactly which element you need:

```bash
fetchary extract selector https://example.com --selector h1
```

Use `--all` for every match, `--format html` for markup, or `--attribute href`
to read a link target.

### Find social links and public metrics

```bash
fetchary extract social-links https://example.com
fetchary extract social-links https://example.com --youtube
fetchary extract social-links https://www.tiktok.com/@oliverjessner --platform tiktok --list
fetchary extract social-insights https://www.youtube.com/@YouTube
```

For just the follower or post count:

```bash
fetchary extract social-insights https://github.com/oliverjessner --follower
fetchary extract social-insights https://www.tiktok.com/@oliverjessner --posts
```

Use `--list` to print found URLs one per line, ready to copy or pipe to another
tool. It works with every extraction type; for selectors, it lists all matching
values. It uses the loaded page and does not collect additional profile posts.

Lists and social insights use JSON output by default. Add `--json` to other
commands for structured results too. A missing metric stays `null`, with a reason;
it never silently becomes zero. Platform support varies: see the
[social support matrix](docs/SOCIAL_SUPPORT.md).

### Sign in to a website

Open a browser, sign in as usual, then return to the terminal and press Enter:

```bash
fetchary login https://www.linkedin.com --session linkedin
fetchary extract social-insights https://www.linkedin.com/in/oliverjessner --follower --mode browser --session linkedin
```

Fetchary keeps the session locally so you can reuse it with `--session linkedin`.
Use `fetchary sessions` to see saved sessions and `fetchary logout linkedin` to
remove one. Your website password is entered in the browser.

### Save output and revisit commands

Add `--filepath .` to save output in the current directory. Fetchary chooses a
new filename and the matching format:

```bash
fetchary extract html https://example.com --filepath .
fetchary extract links https://oliverjessner.at/sitemap.xml --list --filepath .
fetchary analyse https://example.com --json --filepath ./analysis.json
```

`fetchary history` shows your last 100 commands. Use `--no-history` on a command
you do not want to keep.

## Use Fetchary in Node.js

```js
const { extractText, extractImages, extractSocialLinks } = require('fetchary');

async function main() {
    const url = 'https://example.com';
    const text = await extractText(url);
    const images = await extractImages(url);
    const socials = await extractSocialLinks(url);

    console.log(text.data);
    console.log(images.data);
    console.log(socials.data);
}

main().catch(console.error);
```

Compatible calls reuse the captured webpage for **45 seconds** by default.
The cache lives in memory in the current process; separate CLI executions each
start fresh. You can adjust the TTL, request a fresh capture, or use
`createExtractor()` for a client with its own cache.

The library creates no database or saved extraction results. The CLI keeps a
command history; `--filepath` saves output and `login` saves session cookies when
requested. Private and internal network targets are blocked by default;
trusted local development can opt in
with `--allow-private-network` or `{ allowPrivateNetwork: true }`.

## Documentation

- [CLI reference](docs/CLI.md) — commands, flags, output, and exit codes.
- [Library guide](docs/LIBRARY.md) — methods, result schemas, cache settings, and TypeScript.
- [Social support](docs/SOCIAL_SUPPORT.md) — tested capabilities and platform limitations.
- [Changelog](docs/changelog.md) — release changes.
