# Fetchary

<p align="center">
  <img src="assets/images/logo/logo_raw_trans_250.webp" alt="Fetchary logo" width="250">
</p>

> **Extract what you need from the web.**

Fetchary extracts text, HTML, image URLs, and social information from public web pages.

Use it from your terminal for a quick result, or in a Node.js app when you need
several things from the same page. Extraction works without setting up a database
or saving an archive.

## Install

Node.js 26 or newer is required.

For the command line:

```bash
npm install --global fetchary
```

On macOS, you can also use Homebrew:

```bash
brew tap oliverjessner/tap
brew install fetchary
```

For a Node.js project:

```bash
npm install fetchary
```

## Examples

### Get a page's text or HTML

Read the text without the markup:

```bash
fetchary extract https://example.com --text
```

Leave out `--text` to get HTML:

```bash
fetchary extract https://example.com
```

### Extract just one part

Only need the heading? Select it with CSS:

```bash
fetchary extract https://example.com --include-selector "h1" --text
```

You can also leave out elements you don't need:

```bash
fetchary extract https://example.com --ignore-selector "script" --ignore-selector "style"
```

### Find an icon or profile picture

Get a website's highest-resolution accessible icon:

```bash
fetchary favicon https://github.com
```

Or a public social profile's avatar:

```bash
fetchary profile-picture https://github.com/oliverjessner --mode http
```

Both commands print an image URL. They don't save the image.

### Use the results in a script

Add `--json` for structured output, including the page URL and capture timestamp:

```bash
fetchary extract https://example.com --text --json
fetchary favicon https://github.com --json
```

## Use Fetchary in Node.js

Need text, images, and social links from the same page?

```js
const { extractText, extractImages, extractSocialLinks } = require('fetchary');

async function main() {
  const url = 'https://example.com';
  const text = await extractText(url);
  const images = await extractImages(url);
  const socials = await extractSocialLinks(url);

  console.log(text.content);
  console.log(images.images);
  console.log(socials.links);
}

main().catch(console.error);
```

Compatible calls reuse the captured webpage for **45 seconds** by default.
The cache stays in memory in the current process; separate CLI executions each
start fresh.

You can change the TTL, request a fresh capture, or use `createExtractor()` for
a client with its own cache. The library also extracts selected elements,
favicons, social avatars, and public follower counts. See the
[library guide](docs/LIBRARY.md#one-time-extraction-without-storage) for examples.

## Browser or HTTP?

By default, page extraction uses bundled Chromium to include content added by
JavaScript. You don't need a separate browser installation.

If the content is already in the server response, use HTTP mode to skip the browser:

```bash
fetchary extract https://example.com --mode http --text
```

The same choice is available in the library through `{ mode: 'http' }`.
Favicon extraction uses HTTP mode by default.

## Documentation

- [CLI reference](docs/CLI.md) — commands, flags, and output formats.
- [Library guide](docs/LIBRARY.md) — extraction methods, cache settings, and TypeScript.
- [Changelog](docs/changelog.md) — release changes.
