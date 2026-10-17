#!/usr/bin/env node
'use strict';
const api = require('../src');
const pkg = require('../package.json');
const { listItems, listCaptureOptions } = require('./list');
const { prepareOutput, saveOutput } = require('./output');
const { historyFile, readHistory, recordHistory, historyItems } = require('./history');
const types = ['text','html','favicon','images','videos','avatar','selector','social-links','social-insights','emails','telephone','links','documents','metadata','structured-data','tracker-intelligence'];
const HELP = `Fetchary ${pkg.version} — Extract what matters.

Usage: fetchary extract <type> <url> [options]
       fetchary analyse <url> [options]
       fetchary login <url> [--session <name>]
       fetchary sessions [--json]
       fetchary logout <name>
       fetchary history [--json|--list]

Types:
  text             Readable page text
  html             Raw or rendered HTML
  favicon          Highest-resolution accessible icon URL or bytes
  images           Referenced image URLs and metadata
  videos           Video files, streams and linked or embedded videos
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
  --filepath <path>              Save command output to a file or directory
  --no-history                   Do not record this command
  --list                         Print URLs/selected values, one per line
  --binary                       Write favicon bytes to stdout (favicon only)
  --mode auto|http|browser        Capture strategy (default: auto, HTTP first)
  --timeout <ms>                 Request timeout (default: 30000)
  --user-agent <text>            Request user agent
  --wait-after-load <duration>   Browser wait, e.g. 500ms or 5s (default: 5s)
  --max-response-bytes <bytes>   Maximum response/DOM size (default: 20971520)
  --allow-private-network        Allow trusted local/internal targets
  --cookies <file>               Import Netscape or JSON session cookies
  --session <name>               Use a session saved with fetchary login
  --session-dir <directory>      Session directory (default: ~/.fetchary/sessions)
  --cookies-from-browser chrome  Read Chrome session cookies on macOS
  --browser-profile <name|path>  Chrome profile directory (default: Default)
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
  fetchary login https://www.linkedin.com --session linkedin
  fetchary extract social-insights https://www.linkedin.com/in/oliverjessner --follower --session linkedin
  fetchary analyse https://oliverjessner.at
  fetchary extract text https://example.com
  fetchary extract links https://example.com
  fetchary extract links https://oliverjessner.at/sitemap.xml --list
  fetchary extract links https://oliverjessner.at/sitemap.xml --list --filepath .
  fetchary history
  fetchary extract documents https://example.com --list
  fetchary extract videos https://example.com --list
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
const flags = new Set(['json','list','binary','all','youtube','follower','posts','urls-only','exclude-metadata','duplicates','quiet','verbose','no-color','allow-private-network','help','version','text','no-history']);
const values = new Set(['mode','timeout','user-agent','wait-after-load','max-response-bytes','cookies','cookies-from-browser','browser-profile','session','session-dir','selector','attribute','format','platform','default-country','filepath']);
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

async function execute(argv, io, state) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let options = { json: argv.includes('--json') };
  try {
    const parsed = parseArgs(argv); options = parsed.options;
    state.options = options;
    if (options.filepath !== undefined) state.output = await prepareOutput(options.filepath);
    const args = parsed.positionals;
    if (options.version) { stdout.write(`${pkg.version}\n`); return 0; }
    if (options.help || !args.length) { stdout.write(HELP); return 0; }
    const command = args.shift();
    state.command = command;
    if (command === 'history') {
      for (const key of Object.keys(options)) if (!['json','list','filepath','no-history','quiet','no-color','verbose'].includes(key)) invalid(`--${key} is not supported for history`);
      if (args.length) invalid('history does not take arguments');
      const result = historyItems(await readHistory(historyFile(io.historyFile)));
      stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : options.list ? result.map(item => item.command).join('\n') + (result.length ? '\n' : '')
        : result.length ? 'TIME (UTC)\tEXIT\tCOMMAND\n' + result.map(item => `${item.timestamp}\t${item.exitCode}\t${item.command}`).join('\n') + '\n' : 'No command history.\n');
      return 0;
    }
    if (['login','sessions','logout'].includes(command)) {
      const allowed = command === 'login' ? ['session','session-dir','timeout','allow-private-network','json','quiet','verbose','no-color','filepath','no-history'] : ['session-dir','json','quiet','verbose','no-color','filepath','no-history'];
      for (const key of Object.keys(options)) if (!allowed.includes(key)) invalid(`--${key} is not supported for ${command}`);
      if (args.length !== (command === 'sessions' ? 0 : 1)) invalid(command === 'sessions' ? 'sessions does not take arguments' : `exactly one ${command === 'login' ? 'URL' : 'session name'} is required`);
      const settings = { ...(io.options || {}) };
      for (const [flag, name] of Object.entries({ session:'session', 'session-dir':'sessionDir', timeout:'timeout', 'allow-private-network':'allowPrivateNetwork' })) {
        if (options[flag] !== undefined) settings[name] = flag === 'timeout' ? Number(options[flag]) : options[flag];
      }
      const result = command === 'login' ? await require('./login').interactiveLogin(args[0], settings, { ...io, stderr })
        : command === 'logout' ? await api.logout(args[0], settings) : await api.listSessions(settings);
      if (options.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else if (command === 'login') stdout.write(`Saved session "${result.session}" for ${result.origin}. Use --session ${result.session} with your extraction command.\n`);
      else if (command === 'logout') stdout.write(result.removed ? `Removed session "${result.session}".\n` : `Session "${result.session}" was not found.\n`);
      else stdout.write(result.length ? result.map(item => `${item.session}\t${item.origin}\t${item.activeCookieCount} active cookies`).join('\n') + '\n' : 'No saved sessions.\n');
      return 0;
    }
    let type;
    if (command === 'extract') type = types.includes(args[0]) ? args.shift() : options.text ? 'text' : 'html';
    else if (command === 'analyse') type = 'analyse';
    else if (command === 'favicon') type = 'favicon';
    else if (command === 'profile-picture') type = 'avatar';
    else invalid(`unknown command "${command}"; use "fetchary extract <type> <url>"`);
    state.type = type;
    if (args.length !== 1) invalid('exactly one URL is required');
    for (const [key, allowed] of Object.entries({ binary:['favicon'], selector:['selector'], all:['selector'], attribute:['selector'], format:['selector'], platform:['social-links'], 'default-country':['telephone','analyse'], youtube:['social-links'], follower:['social-insights'], posts:['social-insights'], 'exclude-metadata':['images'], source:['images'], duplicates:['images'], 'include-selector':['text','html','emails','telephone','links','documents','videos'], 'ignore-selector':['text','html','emails','telephone','links','documents','videos'], text:['text','html'] })) {
      if (Object.hasOwn(options, key) && !allowed.includes(type)) invalid(`--${key} is not supported for ${type}`);
    }
    if (options.text && type !== 'text') invalid('--text conflicts with the selected extraction type');
    if (options.youtube && options.platform && options.platform !== 'youtube') invalid('--youtube conflicts with --platform');
    if (options.binary && options.json) invalid('--binary conflicts with --json');
    if (options.binary && (options.list || options['urls-only'])) invalid('--binary conflicts with --list/--urls-only');
    const list = !options.json && (options.list || options['urls-only']);
    const settings = { ...(io.options || {}), type };
    for (const [key, name] of Object.entries({ binary:'binary', mode:'mode', timeout:'timeout', 'user-agent':'userAgent', 'wait-after-load':'waitAfterLoad', 'max-response-bytes':'maxResponseBytes', cookies:'cookieFile', 'cookies-from-browser':'cookiesFromBrowser', 'browser-profile':'browserProfile', session:'session', 'session-dir':'sessionDir', selector:'selector', all:'all', attribute:'attribute', format:'format', platform:'platform', 'default-country':'defaultCountry', 'allow-private-network':'allowPrivateNetwork', 'include-selector':'includeSelectors', 'ignore-selector':'ignoreSelectors', source:'sources' })) {
      if (options[key] !== undefined) settings[name] = ['timeout','maxResponseBytes'].includes(name) ? Number(options[key]) : options[key];
    }
    if (options.youtube) settings.platform = 'youtube';
    if (options['exclude-metadata']) settings.includeMetadata = false;
    if (options.duplicates) settings.unique = false;
    const captureOptions = list ? listCaptureOptions(settings) : settings;
    if (options.verbose && !options.quiet) stderr.write(`${type === 'analyse' ? 'Analysing website' : `Extracting ${type}`} (${settings.mode || 'auto'})\n`);
    const result = type === 'analyse' ? await api.analyse(args[0], captureOptions) : await api.extract(args[0], captureOptions);
    state.result = result;
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
    else if (options.json || type === 'analyse' || ['images','videos','social-links','social-insights','emails','telephone','links','documents','metadata','structured-data','tracker-intelligence'].includes(type)) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout; const stderr = io.stderr || process.stderr;
  const state = {}; const chunks = [];
  let code = await execute(argv, { ...io, stdout: { write(value) {
    if (state.output) chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
    if (!state.options?.quiet) return stdout.write(value);
    return true;
  } } }, state);
  if (code === 0 && state.output) {
    try {
      const saved = await saveOutput(state.output, Buffer.concat(chunks), state);
      if (state.options.verbose && !state.options.quiet) stderr.write(`Saved output: ${saved}\n`);
    } catch (error) {
      stderr.write(state.options.json ? `${JSON.stringify({ error: error.name, message: error.message })}\n` : `Error: ${error.message}\n`);
      code = 1;
    }
  }
  const shouldRecord = io.recordHistory ?? (require.main === module);
  if (shouldRecord && argv.length && state.command !== 'history' && !state.options?.help && !state.options?.version && !argv.some(argument => argument === '--no-history' || argument.startsWith('--no-history='))) {
    try { await recordHistory(historyFile(io.historyFile), argv, code); }
    catch (error) { stderr.write(`Warning: ${error.message}\n`); }
  }
  return code;
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main, parseArgs };
