#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const pkg = require('../package.json');
const { textHash } = require('../src/diff');
const {
  createFetchary,
  FetcharyFetchError,
  FetcharyValidationError,
  FetcharyIntervalError,
} = require('../src');

class CliUsageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.usage = details.usage;
    this.example = details.example;
  }
}

const HELP = `Fetchary 👁️ — ${pkg.version}

Usage: fetchary <command> [arguments] [options]

Commands:
  add <url>                   Add and immediately archive a URL
  list                        List monitored sources
  fetch [id...]               Fetch one, several, or all enabled sources
  status                      Show storage statistics
  show <id>                   Show source details
  history <id>                List archived versions
  diff <id> [from] [to]       Compare archived versions
  open <id> [version]         Open a local archived version
  edit <id>                   Edit URL, name, or tag
  enable <id>                 Enable a source
  disable <id>                Disable a source
  remove <id>                 Remove a source (use --purge for its archive)
  export <id>                 Export a source and all versions
  schedule <id> <interval>    Schedule fetching (for example 15m, 2h, 3d)
  unschedule <id>             Disable a source schedule
  schedules                   List active schedules
  run                         Run the persistent scheduler

Global options:
  --json                      Machine-readable output
  --quiet                     Suppress normal output
  --verbose                   Show diagnostic information
  --no-color                  Disable colored terminal output
  --data-dir <path>           Override the storage directory
  --help                      Show help
  --example                   Show common examples
  --version                   Show version
`;

const EXAMPLES = `Fetchary examples

Add a page and check it every 15 minutes:
  fetchary add https://example.com/news --name "Example News" --tag news --every 15m

List sources and fetch one of them:
  fetchary list
  fetchary fetch 1

Inspect and compare archived versions:
  fetchary history 1
  fetchary diff 1
  fetchary open 1

Export an archive:
  fetchary export 1 --output ./research

Run scheduled checks:
  fetchary schedules
  fetchary run
`;

const COMMAND_GUIDANCE = Object.freeze({
  add: { usage: 'fetchary add <url> [--name <name>] [--tag <tag>] [--every <interval>]', example: 'fetchary add https://example.com --name "Example"' },
  list: { usage: 'fetchary list [--tag <tag>] [--json]', example: 'fetchary list --tag research' },
  status: { usage: 'fetchary status', example: 'fetchary status' },
  show: { usage: 'fetchary show <id>', example: 'fetchary show 1' },
  history: { usage: 'fetchary history <id>', example: 'fetchary history 1' },
  diff: { usage: 'fetchary diff <id> or fetchary diff <id> <version1> <version2>', example: 'fetchary diff 4 1 2' },
  open: { usage: 'fetchary open <id> [version]', example: 'fetchary open 1 2' },
  edit: { usage: 'fetchary edit <id> [--url <url>] [--name <name>] [--tag <tag>]', example: 'fetchary edit 1 --name "Example News"' },
  enable: { usage: 'fetchary enable <id>', example: 'fetchary enable 1' },
  disable: { usage: 'fetchary disable <id>', example: 'fetchary disable 1' },
  remove: { usage: 'fetchary remove <id> [--purge]', example: 'fetchary remove 1' },
  export: { usage: 'fetchary export <id> [--output <directory>]', example: 'fetchary export 1 --output ./research' },
  schedule: { usage: 'fetchary schedule <id> <interval> [--now]', example: 'fetchary schedule 1 15m' },
  unschedule: { usage: 'fetchary unschedule <id>', example: 'fetchary unschedule 1' },
  schedules: { usage: 'fetchary schedules [--json]', example: 'fetchary schedules' },
  run: { usage: 'fetchary run [--poll-interval <milliseconds>]', example: 'fetchary run --poll-interval 2000' },
});

const VALUE_OPTIONS = new Set(['name', 'tag', 'url', 'output', 'data-dir', 'poll-interval', 'every']);
const FLAG_OPTIONS = new Set(['json', 'quiet', 'verbose', 'no-color', 'help', 'example', 'version', 'purge', 'raw', 'html', 'now']);
const ANSI = Object.freeze({
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
});

function colorize(value, color, enabled) {
  return enabled ? `${ANSI[color]}${value}${ANSI.reset}` : value;
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const equalAt = value.indexOf('=');
    const name = value.slice(2, equalAt === -1 ? undefined : equalAt);
    if (FLAG_OPTIONS.has(name)) {
      if (equalAt !== -1) throw new CliUsageError(`--${name} does not accept a value`);
      options[name] = true;
    } else if (VALUE_OPTIONS.has(name)) {
      const optionValue = equalAt === -1 ? argv[++index] : value.slice(equalAt + 1);
      if (optionValue == null || optionValue.startsWith('--')) throw new CliUsageError(`--${name} requires a value`);
      options[name] = optionValue;
    } else {
      throw new CliUsageError(`unknown option --${name}`);
    }
  }
  return { command: positionals.shift(), args: positionals, options };
}

function usageError(command, message = 'invalid number of arguments') {
  return new CliUsageError(message, COMMAND_GUIDANCE[command]);
}

function requireArgs(args, command, minimum, maximum = minimum) {
  if (args.length < minimum || args.length > maximum) throw usageError(command);
}

function relativeTime(value) {
  if (!value) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function localDate(value) {
  if (!value) return 'never';
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16);
}

function size(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function table(rows, columns) {
  if (!rows.length) return '';
  const visibleLength = value => String(value).replace(/\x1b\[[0-9;]*m/g, '').length;
  const widths = columns.map(column => Math.max(column.label.length, ...rows.map(row => visibleLength(column.value(row)))));
  const render = (values) => values.map((value, index) => {
    const rendered = String(value);
    return `${rendered}${' '.repeat(widths[index] - visibleLength(rendered))}`;
  }).join('  ').trimEnd();
  return [render(columns.map(column => column.label)), ...rows.map(row => render(columns.map(column => column.value(row))))].join('\n');
}

async function classifyVersions(versions) {
  const hashes = new Map(await Promise.all(versions.map(async version => [
    version.id,
    textHash(await fs.promises.readFile(version.file, 'utf8')),
  ])));
  return versions.map(version => {
    if (version.id === 1) return { ...version, change: 'initial', rawChanged: false, contentChanged: null };
    const previousHash = hashes.get(version.id - 1);
    const contentChanged = previousHash == null ? null : hashes.get(version.id) !== previousHash;
    return {
      ...version,
      change: contentChanged == null ? 'unknown' : contentChanged ? 'content' : 'raw only',
      rawChanged: true,
      contentChanged,
    };
  });
}

function htmlEscape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

async function openFile(file) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function execute(fetchary, parsed, write, format = {}) {
  const { command, args, options } = parsed;
  const color = (value, name) => colorize(value, name, format.color);
  const emit = value => { if (!options.quiet) write(value); };
  const emitValue = (value, human) => emit(options.json ? `${JSON.stringify(value, null, 2)}\n` : `${human}\n`);

  switch (command) {
    case 'add': {
      requireArgs(args, command, 1);
      const source = await fetchary.add(args[0], { name: options.name, tag: options.tag, every: options.every });
      emitValue(source, `${color('✓ Added', 'green')} ${color(`#${source.id}`, 'blue')} ${color(source.url, 'cyan')}\n${color('✓ Saved', 'green')} version ${color(String(source.version), 'blue')}`);
      return 0;
    }
    case 'list': {
      requireArgs(args, command, 0);
      const sources = await fetchary.list({ tag: options.tag });
      emitValue(sources, sources.length ? table(sources, [
        { label: 'ID', value: row => row.id },
        { label: 'NAME', value: row => row.name || '-' },
        { label: 'TAG', value: row => row.tag || '-' },
        { label: 'URL', value: row => row.url },
        { label: 'VERSION', value: row => row.currentVersionId ?? '-' },
        { label: 'LAST CHECK', value: row => relativeTime(row.lastCheckedAt) },
        { label: 'LAST CHANGE', value: row => relativeTime(row.lastChangedAt) },
      ]) : 'No monitored sources.');
      return 0;
    }
    case 'fetch': {
      const target = args.length === 0 ? undefined : args.length === 1 ? args[0] : args;
      const value = await fetchary.fetch(target);
      const results = Array.isArray(value) ? value : [value];
      const contentChanged = results.filter(result => result.contentChanged).length;
      const rawOnly = results.filter(result => result.rawChanged && !result.contentChanged).length;
      const unchanged = results.length - contentChanged - rawOnly;
      const human = [
        `Fetching ${results.length} source${results.length === 1 ? '' : 's'}...`,
        '',
        ...results.map(result => `${color(`#${result.id}`, 'blue')} ${result.contentChanged
          ? `${color('content changed', 'yellow')} → version ${color(String(result.version), 'blue')}`
          : result.rawChanged
            ? `${color('raw changed', 'yellow')}, ${color('content unchanged', 'gray')} → version ${color(String(result.version), 'blue')}`
            : color('unchanged', 'gray')}`),
        '',
        `${color(String(contentChanged), contentChanged ? 'yellow' : 'gray')} ${color('content changed', contentChanged ? 'yellow' : 'gray')}, ${color(String(rawOnly), rawOnly ? 'yellow' : 'gray')} ${color('raw only', rawOnly ? 'yellow' : 'gray')}, ${color(String(unchanged), 'gray')} ${color('unchanged', 'gray')}`,
      ].join('\n');
      emitValue(value, human);
      return contentChanged ? 10 : 0;
    }
    case 'status': {
      requireArgs(args, command, 0);
      const status = await fetchary.status();
      emitValue(status, `Fetchary 👁️\n\nSources:        ${color(String(status.sources), 'blue')}\nVersions:       ${color(String(status.versions), 'blue')}\nChanged today:  ${color(String(status.changedToday), status.changedToday ? 'yellow' : 'gray')}\nLast fetch:     ${color(relativeTime(status.lastFetch), 'gray')}\nDatabase:       ${color(status.database, 'cyan')}`);
      return 0;
    }
    case 'show': {
      requireArgs(args, command, 1);
      const source = await fetchary.get(args[0]);
      emitValue(source, `ID:             ${color(String(source.id), 'blue')}\nName:           ${source.name || '-'}\nTag:            ${color(source.tag || '-', 'blue')}\nURL:            ${color(source.url, 'cyan')}\nEnabled:        ${color(source.enabled ? 'yes' : 'no', source.enabled ? 'green' : 'yellow')}\nCreated:        ${color(localDate(source.createdAt), 'gray')}\nLast checked:   ${color(localDate(source.lastCheckedAt), 'gray')}\nLast changed:   ${color(localDate(source.lastChangedAt), 'gray')}\nVersions:       ${color(String(source.versions), 'blue')}\nCurrent hash:   ${color(source.currentHash || '-', 'gray')}`);
      return 0;
    }
    case 'history': {
      if (args.length !== 1) {
        throw usageError(command);
      }
      const versions = await fetchary.history(args[0]);
      const classified = await classifyVersions(versions);
      emitValue(classified, classified.length ? table(classified, [
        { label: 'VERSION', value: row => row.id },
        { label: 'CHANGE', value: row => row.change },
        { label: 'FETCHED', value: row => localDate(row.fetchedAt) },
        { label: 'STATUS', value: row => row.status === 200 ? color(String(row.status), 'green') : row.status },
        { label: 'SIZE', value: row => size(row.contentLength) },
      ]) : 'No archived versions.');
      return 0;
    }
    case 'diff': {
      if (args.length !== 1 && args.length !== 3) {
        throw usageError(command, args.length === 2 ? 'diff requires both from and to versions' : 'invalid number of arguments');
      }
      const result = await fetchary.diff(args[0], {
        ...(args.length === 3 ? { from: args[1], to: args[2] } : {}),
        mode: options.raw ? 'raw' : 'text',
      });
      if (options.html && !options.json) {
        const lines = result.diff.map(part => `<div class="${part.type}">${part.type === 'added' ? '+' : '-'} ${htmlEscape(part.value)}</div>`).join('\n');
        emit(`<!doctype html><meta charset="utf-8"><title>Fetchary diff</title><style>body{font-family:monospace;white-space:pre-wrap}.added{color:#1d4ed8;background:#dbeafe}.removed{color:#b91c1c;background:#fee2e2}</style>${lines}\n`);
      } else {
        const humanDiff = result.diff.map(part => {
          const line = `${part.type === 'added' ? '+' : '-'} ${part.value}`;
          return color(line, part.type === 'added' ? 'blue' : 'red');
        }).join('\n');
        emitValue(result, humanDiff || 'No differences.');
      }
      return 0;
    }
    case 'open': {
      requireArgs(args, command, 1, 2);
      const archived = await fetchary.version(args[0], args[1]);
      await openFile(archived.file);
      emitValue(archived, `${color('✓ Opened', 'green')} ${color(archived.file, 'cyan')}`);
      return 0;
    }
    case 'edit': {
      requireArgs(args, command, 1);
      const changes = {};
      for (const key of ['name', 'tag', 'url']) if (options[key] !== undefined) changes[key] = options[key];
      const source = await fetchary.edit(args[0], changes);
      emitValue(source, `${color('✓ Updated', 'green')} ${color(`#${source.id}`, 'blue')}`);
      return 0;
    }
    case 'enable':
    case 'disable': {
      requireArgs(args, command, 1);
      const source = await fetchary[command](args[0]);
      const stateColor = command === 'enable' ? 'green' : 'yellow';
      emitValue(source, `${color(`✓ ${command === 'enable' ? 'Enabled' : 'Disabled'}`, stateColor)} ${color(`#${source.id}`, 'blue')}`);
      return 0;
    }
    case 'remove': {
      requireArgs(args, command, 1);
      const versions = (await fetchary.history(args[0])).length;
      const sourceId = Number(args[0]);
      await fetchary.remove(sourceId, { purge: options.purge });
      const result = { sourceId, purged: Boolean(options.purge), versions };
      emitValue(result, options.purge
        ? `${color('✓ Removed', 'red')} ${color(`#${sourceId}`, 'blue')} ${color(`and purged ${versions} archived version${versions === 1 ? '' : 's'}`, 'red')}`
        : `${color('✓ Removed', 'yellow')} ${color(`#${sourceId}`, 'blue')} from monitoring\n  ${color(`${versions} archived version${versions === 1 ? '' : 's'} kept`, 'gray')}`);
      return 0;
    }
    case 'export': {
      requireArgs(args, command, 1);
      const result = await fetchary.export(args[0], { output: options.output });
      emitValue(result, `${color('✓ Exported', 'green')} ${color(String(result.versions), 'blue')} version${result.versions === 1 ? '' : 's'} to ${color(result.directory, 'cyan')}`);
      return 0;
    }
    case 'schedule': {
      requireArgs(args, command, 2);
      const schedule = await fetchary.schedule(args[0], args[1], { now: options.now });
      emitValue(schedule, `${color('✓ Scheduled', 'green')} ${color(`#${schedule.sourceId}`, 'blue')} every ${color(schedule.every, 'blue')}\n  Next run: ${color(localDate(schedule.nextRunAt), 'cyan')}`);
      return 0;
    }
    case 'unschedule': {
      requireArgs(args, command, 1);
      await fetchary.unschedule(args[0]);
      const result = { sourceId: Number(args[0]), enabled: false };
      emitValue(result, `${color('✓ Unscheduled', 'yellow')} ${color(`#${args[0]}`, 'blue')}`);
      return 0;
    }
    case 'schedules': {
      requireArgs(args, command, 0);
      const schedules = await fetchary.schedules();
      emitValue(schedules, schedules.length ? table(schedules, [
        { label: 'ID', value: row => row.sourceId },
        { label: 'EVERY', value: row => row.every },
        { label: 'LAST RUN', value: row => relativeTime(row.lastRunAt) },
        { label: 'NEXT RUN', value: row => relativeTime(row.nextRunAt) },
      ]) : 'No active schedules.');
      return 0;
    }
    case 'run': {
      requireArgs(args, command, 0);
      const pollInterval = options['poll-interval'] == null ? undefined : Number(options['poll-interval']);
      const runner = await fetchary.run({ pollInterval });
      emit(`${color('Fetchary scheduler running.', 'green')} ${color('Press Ctrl+C to stop.', 'gray')}\n`);
      await new Promise(resolve => {
        const stop = async () => {
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          await runner.stop();
          resolve();
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
      });
      return 0;
    }
    default:
      throw new CliUsageError(command ? `unknown command "${command}"` : 'a command is required');
  }
}

async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const stdoutColorSupport = io.color ?? Boolean(stdout.isTTY
    && !Object.hasOwn(process.env, 'NO_COLOR')
    && process.env.TERM !== 'dumb');
  const stderrColorSupport = io.color ?? Boolean(stderr.isTTY
    && !Object.hasOwn(process.env, 'NO_COLOR')
    && process.env.TERM !== 'dumb');
  let color = Boolean(stdoutColorSupport && !argv.includes('--no-color'));
  let errorColor = Boolean(stderrColorSupport && !argv.includes('--no-color'));
  let parsed;
  try { parsed = parseArgs(argv); } catch (error) {
    stderr.write(`${colorize(`Error: ${error.message}`, 'red', errorColor)}\n${colorize('Run "fetchary --help" for usage.', 'gray', errorColor)}\n`);
    return 2;
  }
  color = Boolean(stdoutColorSupport && !parsed.options['no-color']);
  errorColor = Boolean(stderrColorSupport && !parsed.options['no-color']);
  if (parsed.options.version) {
    stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (parsed.options.help) {
    stdout.write(HELP);
    return 0;
  }
  if (parsed.options.example) {
    stdout.write(EXAMPLES);
    return 0;
  }
  if (!parsed.command) {
    stdout.write(HELP);
    return 0;
  }

  let fetchary;
  try {
    fetchary = await createFetchary({ dataDir: parsed.options['data-dir'] || process.env.FETCHARY_DATA_DIR });
    if (parsed.options.verbose && !parsed.options.quiet) stderr.write(`${colorize('Using', 'gray', errorColor)} ${colorize(fetchary.dataDir, 'cyan', errorColor)}\n`);
    return await execute(fetchary, parsed, value => stdout.write(value), { color });
  } catch (error) {
    const json = parsed.options.json;
    const payload = { error: error.name, message: error.message };
    if (json) {
      stderr.write(`${JSON.stringify(payload)}\n`);
    } else {
      stderr.write(`${colorize(`Error: ${error.message}`, 'red', errorColor)}\n`);
      if (error instanceof CliUsageError && error.usage) {
        stderr.write(`\n${colorize('Usage:', 'gray', errorColor)}   ${error.usage}\n`);
        if (error.example) stderr.write(`${colorize('Example:', 'gray', errorColor)} ${error.example}\n`);
      }
    }
    if (error instanceof CliUsageError || error instanceof FetcharyValidationError || error instanceof FetcharyIntervalError) return 2;
    if (error instanceof FetcharyFetchError) return 3;
    return 1;
  } finally {
    if (fetchary) await fetchary.close().catch(() => {});
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; });
}

module.exports = { main, parseArgs, execute, CliUsageError };
