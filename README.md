# Fetchary

<p align="center">
  <img src="assets/images/logo/logo_raw_trans_250.webp" alt="Fetchary logo" width="250">
</p>

> **Watch changes. Keep the proof.**

Fetchary watches public web pages from your terminal.

It tells you when something changed, keeps the previous versions locally, and lets you inspect exactly what was there before.

Think of it as a small, local `git diff` for the public web.

```bash
brew tap oliverjessner/tap
brew install fetchary
```

Or:

```bash
npm install --global fetchary
```

## Examples

### Watch a whole page

Want to know when a pricing page, press release, terms page, or public document changes?

```bash
fetchary add https://example.com/pricing \
  --name "Pricing" \
  --every 1h
```

Then run the scheduler:

```bash
fetchary run
```

Fetchary checks the page every hour and stores new versions when something changes.

### Watch only one part of a page

Maybe you don't care about the whole page.

Watch only the element you're interested in:

```bash
fetchary add https://example.com/pricing \
  --name "Pro Plan Price" \
  --include-selector ".pro-plan .price" \
  --every 30m
```

Fetchary still archives the complete page.

`--include-selector` only controls **what counts as a relevant change**.

### Ignore noisy elements

Timestamps, counters, rotating banners, and similar elements can create useless changes.

Ignore them:

```bash
fetchary add https://example.com/news \
  --ignore-selector ".timestamp" \
  --ignore-selector ".live-counter"
```

The original page is still archived unchanged. The selectors only affect comparison.

### Watch social media followers

Fetchary can read follower counts from supported public profiles.

```bash
fetchary add https://www.instagram.com/instagram/ \
  --name "Instagram" \
  --tag social

fetchary add https://www.youtube.com/@YouTube \
  --name "YouTube" \
  --tag social
```

Refresh the profiles:

```bash
fetchary fetch
```

Then read the latest saved counts:

```bash
fetchary follower --tag social
```

Example:

```text
ID  FOLLOWER   NAME
1   68500  Instagram
2   45200   YouTube

sum: 113.700
```

Supported platforms currently include

- GitHub
- Threads
- X
- Instagram
- TikTok
- Twitch
- LinkedIn
- YouTube

You can schedule the profiles like any other source:

```bash
fetchary schedule 1 1h
fetchary schedule 2 1h
fetchary run
```

### See what changed

Check the archived versions:

```bash
fetchary history 1
```

Just want to see when the content changed?

```bash
fetchary history 1 --content-change
```

Compare the latest two versions:

```bash
fetchary diff 1
```

Or compare two specific versions:

```bash
fetchary diff 1 3 7
```

### Open an old version

Want to see what the page looked like before it changed?

```bash
fetchary open 1
```

Or open a specific archived version:

```bash
fetchary open 1 4
```

See which other websites an archived page links to:

```bash
fetchary open 1 --show-external
```

### Keep evidence

Export everything Fetchary has stored for a source:

```bash
fetchary export 1 --output ./evidence
```

The export contains the archived responses, rendered pages, metadata, and SHA-256 hashes.

You can verify the files without Fetchary:

```bash
shasum -a 256 evidence/fetchary-export-1/versions/001-response.html
```

## The basic workflow

Most Fetchary workflows are just:

```bash
# Add something
fetchary add https://example.com

# Check it
fetchary fetch

# See previous versions
fetchary history 1

# See what changed
fetchary diff 1
```

That's it.

## Browser or HTTP?

For normal websites, you usually don't need to think about this.

Fetchary uses its bundled Chromium for HTML pages so JavaScript-rendered content can be captured.

For APIs, feeds, or other resources you can explicitly use HTTP mode:

```bash
fetchary add https://example.com/api/status --mode http
```

## Common commands

```bash
fetchary add <url>
fetchary list
fetchary fetch
fetchary show <id>
fetchary history <id>
fetchary diff <id>
fetchary open <id>
fetchary follower
fetchary export <id>
fetchary schedule <id> <interval>
fetchary run
```

For the complete command reference: [docs/CLI.md](docs/CLI.md) \*\*

For using Fetchary as a Node.js library: [docs/LIBRARY.md](docs/LIBRARY.md)

For publishing a new version: [docs/PUBLISHING.md](docs/PUBLISHING.md)

## What Fetchary is not

Fetchary isn't a crawler or a general browser automation framework.

It doesn't try to crawl entire websites, log into accounts, click through applications, or run scraping workflows.

It does one thing:

**Watch changes. Keep the proof.**
