<p align="center">
  <img src="assets/images/logo/logo_raw_trans_250.webp" alt="Fetchary logo" width="128">
</p>

# Fetchary 👁️

Fetchary is a command-line tool for extracting information from web pages.
It helps you collect text, links, contact details and public social metrics without manually searching each page.
Choose what you need and get results ready to copy, save or use in another tool.

Start with a page URL and request a full analysis or a specific kind of information.
You can turn a sitemap into a URL list, find contact details on a company page,
or check the public metrics of a social profile. Save the results when you need
to share them or continue your research later.

## What it does

- Extract readable text, HTML or the contents of a selected page element.
- Find images, videos, favicons and profile pictures.
- Discover page links, sitemap URLs and downloadable documents.
- Collect email addresses, phone numbers and social profile links.
- Read available follower counts, post totals and engagement metrics.
- Inspect page metadata, structured data and public analytics or advertising tags.
- Combine ten kinds of extraction in one page analysis report.
- Reuse signed-in sessions, save output and revisit recent commands.

See the [social platform support matrix](docs/SOCIAL_SUPPORT.md) for available
metrics and platform limitations.

## Install

Use Fetchary on macOS, Linux or Windows with Node.js 26 or newer.
Browser rendering and interactive sign-in also require the browser normally
downloaded during installation. If it is missing, Fetchary prints the setup
command to run; see [browser setup](docs/CLI.md#interactive-browser-login).

### Homebrew

```bash
brew install oliverjessner/tap/fetchary
```

### npm

```bash
npm install --global fetchary
```

## CLI

Extract specific information or analyse a page from your terminal:

```bash
fetchary analyse https://oliverjessner.at
fetchary extract text https://example.com
fetchary extract links https://oliverjessner.at/sitemap.xml --list
```

See the [CLI documentation](docs/CLI.md) for all commands and options.

## Read pages and discover assets

Read a page as plain text, keep its HTML or select a specific element.
Find image and video URLs, embedded players and linked documents, or save a
favicon's original image with `--binary`.

## Find contacts and social metrics

Collect email addresses, phone numbers and social profile links from a page.
On supported social pages, read available follower counts, post totals and
engagement metrics; unavailable values include a reason instead of becoming zero.

## Inspect a page in one report

Use `analyse` to gather contacts, links, images, documents, metadata, structured
data, a favicon and public tracking integrations from one page.
Tracking IDs can help investigate connections between websites, but do not prove
common ownership.

## Reuse signed-in sessions

Sign in through a browser with `fetchary login` and reuse the saved session for
later extraction. You can also supply an exported cookie file or, on macOS,
read the relevant cookies from Chrome; see [signed-in sessions](docs/CLI.md#signed-in-sessions).

## Save results and revisit commands

Add `--filepath .` to save output in the current directory, or choose a filename.
Use `--list` for values one per line, `--json` for structured results and
`fetchary history` to revisit your last 100 commands.

## Who it is for

- Journalists and researchers gathering information from public web pages.
- Analysts checking company contacts, social profiles and available metrics.
- Content creators collecting image, video and document links.
- People automating repeated web research from the terminal.

## Changelog

See the [changelog](docs/changelog.md) for release notes and changes.

## License

MIT
