# Fetchary

<p align="center">
  <img src="assets/images/logo/logo_raw_trans_250.webp" alt="Fetchary logo" width="250">
</p>

> **Extract what matters.**

Fetchary is a stateless web extraction toolkit for your terminal and Node.js apps.
Ask for text, images, favicons, social links, or public social metrics without
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

### Read a page

Get readable text, or keep the HTML:

```bash
fetchary extract text https://example.com
fetchary extract html https://example.com
```

Fetchary tries HTTP first. When the extractor needs content added by JavaScript,
it can fall back to bundled Chromium. Use `--mode browser` to request rendering
or `--mode http` to read only the server response.

### Find images and icons

```bash
fetchary extract images https://example.com --urls-only
fetchary extract favicon https://github.com
fetchary extract avatar https://github.com/oliverjessner
```

These commands return image URLs. They don't save image files.

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
fetchary extract social-insights https://www.youtube.com/@YouTube
```

Lists and social insights use JSON output by default. Add `--json` to other
commands for structured results too. A missing metric stays `null`, with a reason;
it never silently becomes zero. Platform support varies: see the
[social support matrix](docs/SOCIAL_SUPPORT.md).

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

Extraction creates no database or saved application state. Private and internal
network targets are blocked by default; trusted local development can opt in
with `--allow-private-network` or `{ allowPrivateNetwork: true }`.

## Documentation

- [CLI reference](docs/CLI.md) — commands, flags, output, and exit codes.
- [Library guide](docs/LIBRARY.md) — methods, result schemas, cache settings, and TypeScript.
- [Social support](docs/SOCIAL_SUPPORT.md) — tested capabilities and platform limitations.
- [Changelog](docs/changelog.md) — release changes.
