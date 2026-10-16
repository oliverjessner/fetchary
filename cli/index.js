#!/usr/bin/env node
'use strict';
const api = require('../src');
const pkg = require('../package.json');
const { listItems, listCaptureOptions } = require('./list');
const types = ['text','html','favicon','images','avatar','selector','social-links','social-insights','emails','telephone','links','documents','metadata','structured-data','tracker-intelligence'];
const HELP = `Fetchary ${pkg.version} — Extract what matters.

Usage: fetchary extract <type> <url> [options]
       fetchary analyse <url> [options]

Types:
  text             Readable page text
  html             Raw or rendered HTML
  favicon          Highest-resolution accessible icon URL or bytes
  images           Referenced image URLs and metadata
  avatar           A public social profile's avatar URL
  selector         Elements matching a CSS selector
  social-links     Public social URLs linked by a webpage
  social-insights  Public profile and post metrics with availability
  emails           Email addresses from links, page text and structured data
  telephone        Phone numbers from links, page text and structured data
  links            Internal/external links with text, rel and locations
  documents        Document/download links with format hints and locations
  metadata         Title, description, canonical URL, language and dates
  structured-data  JSON-LD and Microdata objects, including Schema.org data
  tracker-intelligence  Public tracker references and scoped identifiers

Options:
  --json                         Structured extraction result
  --list                         Print URLs/selected values, one per line
  --binary                       Write favicon bytes to stdout (favicon only)
  --mode auto|http|browser        Capture strategy (default: auto, HTTP first)
  --timeout <ms>                 Request timeout (default: 30000)
  --user-agent <text>            Request user agent
  --wait-after-load <duration>   Browser wait, e.g. 500ms or 5s (default: 5s)
  --max-response-bytes <bytes>   Maximum response/DOM size (default: 20971520)
  --allow-private-network        Allow trusted local/internal targets
  --cookies <file>               Import Netscape or JSON session cookies
  --include-selector <css>       Include first matching section (repeatable)
  --ignore-selector <css>        Remove matching elements (repeatable)
  --selector <css>               Required for selector extraction
  --all                          Select all matching elements
  --attribute <name>             Read an attribute instead of element content
  --format text|html             Selector output format (default: text)
  --platform <name>              Filter social links to one platform
  --default-country <code>       Country for national phone numbers, e.g. AT
  --youtube                      Shortcut for --platform youtube
  --follower                     Only the social follower/subscriber count
  --posts                        Only the social post count
  --urls-only                    Alias for --list
  --exclude-metadata             Exclude Open Graph/Twitter image metadata
  --source <name>                Filter image sources (repeatable)
  --duplicates                   Keep duplicate image URLs
  --quiet                        Suppress successful output
  --verbose                      Diagnostics on stderr
  --help                         Show help
  --version                      Show version

Examples:
  fetchary analyse https://oliverjessner.at
  fetchary extract text https://example.com
  fetchary extract links https://example.com
  fetchary extract documents https://example.com --list
  fetchary extract metadata https://example.com
  fetchary extract structured-data https://example.com
  fetchary extract tracker-intelligence https://example.com --list
  fetchary extract emails https://example.com --list
  fetchary extract telephone https://example.com --default-country AT --list
  fetchary extract favicon https://example.com
  fetchary extract favicon https://example.com --binary > favicon.bin
  fetchary extract selector https://example.com --selector h1
  fetchary extract social-links https://example.com --youtube
  fetchary extract social-links https://www.tiktok.com/@oliverjessner --list
  fetchary extract social-insights https://www.youtube.com/watch?v=VIDEO_ID
  fetchary extract social-insights https://github.com/oliverjessner --follower
  fetchary extract social-insights https://www.tiktok.com/@oliverjessner --posts

Compatibility aliases:
  fetchary extract <url> [--text]
  fetchary favicon <url>
  fetchary profile-picture <url>
`;
const flags = new Set(['json','list','binary','all','youtube','follower','posts','urls-only','exclude-metadata','duplicates','quiet','verbose','no-color','allow-private-network','help','version','text']);
const values = new Set(['mode','timeout','user-agent','wait-after-load','max-response-bytes','cookies','selector','attribute','format','platform','default-country']);
const repeated = new Set(['include-selector','ignore-selector','source']);
function invalid(message) { throw new api.FetcharyValidationError(message); }

function parseArgs(argv) {
  const positionals = []; const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--') { positionals.push(...argv.slice(index+1)); break; }
    if (!argument.startsWith('--')) { positionals.push(argument); continue; }
    const equal = argument.indexOf('=');
    const key = argument.slice(2, equal === -1 ? undefined : equal);
    if (flags.has(key)) {
      if (equal !== -1) invalid(`--${key} does not take a value`);
      options[key] = true;
    } else if (values.has(key) || repeated.has(key)) {
      const value = equal === -1 ? argv[++index] : argument.slice(equal+1);
      if (value === undefined || value.startsWith('--') || !value.trim()) invalid(`--${key} requires a value`);
      if (repeated.has(key)) (options[key] ||= []).push(value); else options[key] = value;
    } else invalid(`unknown option --${key}`);
  }
  return { positionals, options };
}

async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let options = { json: argv.includes('--json') };
  try {
    const parsed = parseArgs(argv); options = parsed.options;
    const args = parsed.positionals;
    if (options.version) { stdout.write(`${pkg.version}\n`); return 0; }
    if (options.help || !args.length) { stdout.write(HELP); return 0; }
    const command = args.shift();
    let type;
    if (command === 'extract') type = types.includes(args[0]) ? args.shift() : options.text ? 'text' : 'html';
    else if (command === 'analyse') type = 'analyse';
    else if (command === 'favicon') type = 'favicon';
    else if (command === 'profile-picture') type = 'avatar';
    else invalid(`unknown command "${command}"; use "fetchary extract <type> <url>"`);
    if (args.length !== 1) invalid('exactly one URL is required');
    for (const [key, allowed] of Object.entries({ binary:['favicon'], selector:['selector'], all:['selector'], attribute:['selector'], format:['selector'], platform:['social-links'], 'default-country':['telephone','analyse'], youtube:['social-links'], follower:['social-insights'], posts:['social-insights'], 'exclude-metadata':['images'], source:['images'], duplicates:['images'], 'include-selector':['text','html','emails','telephone','links','documents'], 'ignore-selector':['text','html','emails','telephone','links','documents'], text:['text','html'] })) {
      if (Object.hasOwn(options, key) && !allowed.includes(type)) invalid(`--${key} is not supported for ${type}`);
    }
    if (options.text && type !== 'text') invalid('--text conflicts with the selected extraction type');
    if (options.youtube && options.platform && options.platform !== 'youtube') invalid('--youtube conflicts with --platform');
    if (options.binary && options.json) invalid('--binary conflicts with --json');
    if (options.binary && (options.list || options['urls-only'])) invalid('--binary conflicts with --list/--urls-only');
    const list = !options.json && (options.list || options['urls-only']);
    const settings = { ...(io.options || {}), type };
    for (const [key, name] of Object.entries({ binary:'binary', mode:'mode', timeout:'timeout', 'user-agent':'userAgent', 'wait-after-load':'waitAfterLoad', 'max-response-bytes':'maxResponseBytes', cookies:'cookieFile', selector:'selector', all:'all', attribute:'attribute', format:'format', platform:'platform', 'default-country':'defaultCountry', 'allow-private-network':'allowPrivateNetwork', 'include-selector':'includeSelectors', 'ignore-selector':'ignoreSelectors', source:'sources' })) {
      if (options[key] !== undefined) settings[name] = ['timeout','maxResponseBytes'].includes(name) ? Number(options[key]) : options[key];
    }
    if (options.youtube) settings.platform = 'youtube';
    if (options['exclude-metadata']) settings.includeMetadata = false;
    if (options.duplicates) settings.unique = false;
    const captureOptions = list ? listCaptureOptions(settings) : settings;
    if (options.verbose && !options.quiet) stderr.write(`${type === 'analyse' ? 'Analysing website' : `Extracting ${type}`} (${settings.mode || 'auto'})\n`);
    const result = type === 'analyse' ? await api.analyse(args[0], captureOptions) : await api.extract(args[0], captureOptions);
    if (options.quiet) return 0;
    if (options.follower || options.posts) {
      const selected = {};
      if (options.follower) selected.followers = result.followers ?? null;
      if (options.posts) selected.posts = result.data.metrics.posts ?? null;
      const values = Object.values(selected);
      const output = list ? values.map(String).join('\n') : JSON.stringify(values.length === 1 ? values[0] : selected, null, 2);
      stdout.write(`${output}\n`);
    }
    else if (options.binary) stdout.write(result.data);
    else if (list) { const items = listItems(result, settings); if (items.length) stdout.write(`${items.join('\n')}\n`); }
    else if (options.json || type === 'analyse' || ['images','social-links','social-insights','emails','telephone','links','documents','metadata','structured-data','tracker-intelligence'].includes(type)) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (type === 'favicon' || type === 'avatar') stdout.write(`${result.image.url}\n`);
    else stdout.write(result.content);
    return 0;
  } catch (error) {
    stderr.write(options.json ? `${JSON.stringify({ error: error.name, message: error.message })}\n` : `Error: ${error.message}\n`);
    if (error instanceof api.FetcharyValidationError) return 2;
    if (error instanceof api.FetcharyFetchError) return 3;
    if (error instanceof api.FetcharyBrowserError) return 4;
    if (error instanceof api.FetcharyNotFoundError) return 5;
    return 1;
  }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main, parseArgs };
