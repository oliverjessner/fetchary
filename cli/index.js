#!/usr/bin/env node
'use strict';
const api = require('../src');
const pkg = require('../package.json');
const types = ['text','html','favicon','images','avatar','selector','social-links','social-insights'];
const HELP = `Fetchary ${pkg.version} — Extract what matters.

Usage: fetchary extract <type> <url> [options]

Types:
  text             Readable page text
  html             Raw or rendered HTML
  favicon          Highest-resolution accessible icon URL
  images           Referenced image URLs and metadata
  avatar           A public social profile's avatar URL
  selector         Elements matching a CSS selector
  social-links     Public social URLs linked by a webpage
  social-insights  Public profile and post metrics with availability

Options:
  --json                         Structured extraction result
  --mode auto|http|browser        Capture strategy (default: auto, HTTP first)
  --timeout <ms>                 Request timeout (default: 30000)
  --user-agent <text>            Request user agent
  --wait-after-load <duration>   Browser wait, e.g. 500ms or 5s (default: 5s)
  --max-response-bytes <bytes>   Maximum response/DOM size (default: 10485760)
  --allow-private-network        Allow trusted local/internal targets
  --include-selector <css>       Include first matching section (repeatable)
  --ignore-selector <css>        Remove matching elements (repeatable)
  --selector <css>               Required for selector extraction
  --all                          Select all matching elements
  --attribute <name>             Read an attribute instead of element content
  --format text|html             Selector output format (default: text)
  --platform <name>              Filter social links to one platform
  --youtube                      Shortcut for --platform youtube
  --urls-only                    Print image/social-link URLs, one per line
  --exclude-metadata             Exclude Open Graph/Twitter image metadata
  --source <name>                Filter image sources (repeatable)
  --duplicates                   Keep duplicate image URLs
  --quiet                        Suppress successful output
  --verbose                      Diagnostics on stderr
  --help                         Show help
  --version                      Show version

Examples:
  fetchary extract text https://example.com
  fetchary extract favicon https://example.com
  fetchary extract selector https://example.com --selector h1
  fetchary extract social-links https://example.com --youtube
  fetchary extract social-insights https://www.youtube.com/watch?v=VIDEO_ID

Compatibility aliases:
  fetchary extract <url> [--text]
  fetchary favicon <url>
  fetchary profile-picture <url>
`;
const flags = new Set(['json','all','youtube','urls-only','exclude-metadata','duplicates','quiet','verbose','no-color','allow-private-network','help','version','text']);
const values = new Set(['mode','timeout','user-agent','wait-after-load','max-response-bytes','selector','attribute','format','platform']);
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
  let options = {};
  try {
    const parsed = parseArgs(argv); options = parsed.options;
    const args = parsed.positionals;
    if (options.version) { stdout.write(`${pkg.version}\n`); return 0; }
    if (options.help || !args.length) { stdout.write(HELP); return 0; }
    const command = args.shift();
    let type;
    if (command === 'extract') type = types.includes(args[0]) ? args.shift() : options.text ? 'text' : 'html';
    else if (command === 'favicon') type = 'favicon';
    else if (command === 'profile-picture') type = 'avatar';
    else invalid(`unknown command "${command}"; use "fetchary extract <type> <url>"`);
    if (args.length !== 1) invalid('exactly one URL is required');
    for (const [key, allowed] of Object.entries({ selector:['selector'], all:['selector'], attribute:['selector'], format:['selector','text','html'], platform:['social-links'], youtube:['social-links'], 'urls-only':['images','social-links'], 'exclude-metadata':['images'], source:['images'], duplicates:['images'], 'include-selector':['text','html'], 'ignore-selector':['text','html'], text:['text','html'] })) {
      if (Object.hasOwn(options, key) && !allowed.includes(type)) invalid(`--${key} is not supported for ${type}`);
    }
    if (options.youtube && options.platform && options.platform !== 'youtube') invalid('--youtube conflicts with --platform');
    const settings = { ...(io.options || {}), type };
    for (const [key, name] of Object.entries({ mode:'mode', timeout:'timeout', 'user-agent':'userAgent', 'wait-after-load':'waitAfterLoad', 'max-response-bytes':'maxResponseBytes', selector:'selector', all:'all', attribute:'attribute', format:'format', platform:'platform', 'allow-private-network':'allowPrivateNetwork', 'include-selector':'includeSelectors', 'ignore-selector':'ignoreSelectors', source:'sources' })) {
      if (options[key] !== undefined) settings[name] = ['timeout','maxResponseBytes'].includes(name) ? Number(options[key]) : options[key];
    }
    if (options.youtube) settings.platform = 'youtube';
    if (options['exclude-metadata']) settings.includeMetadata = false;
    if (options.duplicates) settings.unique = false;
    if (options.verbose && !options.quiet) stderr.write(`Extracting ${type} (${settings.mode || 'auto'})\n`);
    const result = await api.extract(args[0], settings);
    if (options.quiet) return 0;
    if (options.json || ['images','social-links','social-insights'].includes(type) && !options['urls-only']) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (options['urls-only']) { const urls = result.data.map(item => item.url); if (urls.length) stdout.write(`${urls.join('\n')}\n`); }
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
