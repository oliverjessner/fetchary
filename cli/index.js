#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const pkg = require('../package.json');
const {
  createFetchary,
  FetcharyFetchError,
  FetcharyValidationError,
  FetcharyIntervalError,
} = require('../src');

class CliUsageError extends Error {}

const HELP = `Fetchary 👁️ — Watch changes. Keep the proof.

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
  --data-dir <path>           Override the storage directory
  --help                      Show help
  --version                   Show version
`;

const VALUE_OPTIONS = new Set(['name', 'tag', 'url', 'output', 'data-dir', 'poll-interval', 'every']);
const FLAG_OPTIONS = new Set(['json', 'quiet', 'verbose', 'help', 'version', 'purge', 'raw', 'html', 'now']);

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

function requireArgs(args, minimum, maximum = minimum) {
  if (args.length < minimum || args.length > maximum) throw new CliUsageError('invalid number of arguments');
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
  const widths = columns.map(column => Math.max(column.label.length, ...rows.map(row => String(column.value(row)).length)));
  const render = (values) => values.map((value, index) => String(value).padEnd(widths[index])).join('  ').trimEnd();
  return [render(columns.map(column => column.label)), ...rows.map(row => render(columns.map(column => column.value(row))))].join('\n');
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

async function execute(fetchary, parsed, write) {
  const { command, args, options } = parsed;
  const emit = value => { if (!options.quiet) write(value); };
  const emitValue = (value, human) => emit(options.json ? `${JSON.stringify(value, null, 2)}\n` : `${human}\n`);

  switch (command) {
    case 'add': {
      requireArgs(args, 1);
      const source = await fetchary.add(args[0], { name: options.name, tag: options.tag, every: options.every });
      emitValue(source, `✓ Added #${source.id} ${source.url}\n✓ Saved version ${source.version}`);
      return 0;
    }
    case 'list': {
      requireArgs(args, 0);
      const sources = await fetchary.list({ tag: options.tag });
      emitValue(sources, sources.length ? table(sources, [
        { label: 'ID', value: row => row.id },
        { label: 'NAME', value: row => row.name || '-' },
        { label: 'URL', value: row => row.url },
        { label: 'LAST CHECK', value: row => relativeTime(row.lastCheckedAt) },
        { label: 'LAST CHANGE', value: row => relativeTime(row.lastChangedAt) },
      ]) : 'No monitored sources.');
      return 0;
    }
    case 'fetch': {
      const target = args.length === 0 ? undefined : args.length === 1 ? args[0] : args;
      const value = await fetchary.fetch(target);
      const results = Array.isArray(value) ? value : [value];
      const changed = results.filter(result => result.changed).length;
      const human = [
        `Fetching ${results.length} source${results.length === 1 ? '' : 's'}...`,
        '',
        ...results.map(result => `#${result.id} ${result.changed ? `changed → version ${result.version}` : 'unchanged'}`),
        '',
        `${changed} changed, ${results.length - changed} unchanged`,
      ].join('\n');
      emitValue(value, human);
      return changed ? 10 : 0;
    }
    case 'status': {
      requireArgs(args, 0);
      const status = await fetchary.status();
      emitValue(status, `Fetchary 👁️\n\nSources:        ${status.sources}\nVersions:       ${status.versions}\nChanged today:  ${status.changedToday}\nLast fetch:     ${relativeTime(status.lastFetch)}\nDatabase:       ${status.database}`);
      return 0;
    }
    case 'show': {
      requireArgs(args, 1);
      const source = await fetchary.get(args[0]);
      emitValue(source, `ID:             ${source.id}\nName:           ${source.name || '-'}\nTag:            ${source.tag || '-'}\nURL:            ${source.url}\nEnabled:        ${source.enabled ? 'yes' : 'no'}\nCreated:        ${localDate(source.createdAt)}\nLast checked:   ${localDate(source.lastCheckedAt)}\nLast changed:   ${localDate(source.lastChangedAt)}\nVersions:       ${source.versions}\nCurrent hash:   ${source.currentHash || '-'}`);
      return 0;
    }
    case 'history': {
      requireArgs(args, 1);
      const versions = await fetchary.history(args[0]);
      emitValue(versions, versions.length ? table(versions, [
        { label: 'VERSION', value: row => row.id },
        { label: 'FETCHED', value: row => localDate(row.fetchedAt) },
        { label: 'STATUS', value: row => row.status },
        { label: 'SIZE', value: row => size(row.contentLength) },
      ]) : 'No archived versions.');
      return 0;
    }
    case 'diff': {
      requireArgs(args, 1, 3);
      if (args.length === 2) throw new CliUsageError('diff requires both from and to versions');
      const result = await fetchary.diff(args[0], {
        ...(args.length === 3 ? { from: args[1], to: args[2] } : {}),
        mode: options.raw ? 'raw' : 'text',
      });
      if (options.html && !options.json) {
        const lines = result.diff.map(part => `<div class="${part.type}">${part.type === 'added' ? '+' : '-'} ${htmlEscape(part.value)}</div>`).join('\n');
        emit(`<!doctype html><meta charset="utf-8"><title>Fetchary diff</title><style>body{font-family:monospace;white-space:pre-wrap}.added{background:#dfd}.removed{background:#fdd}</style>${lines}\n`);
      } else {
        emitValue(result, result.diff.length ? result.diff.map(part => `${part.type === 'added' ? '+' : '-'} ${part.value}`).join('\n') : 'No differences.');
      }
      return 0;
    }
    case 'open': {
      requireArgs(args, 1, 2);
      const archived = await fetchary.version(args[0], args[1]);
      await openFile(archived.file);
      emitValue(archived, `✓ Opened ${archived.file}`);
      return 0;
    }
    case 'edit': {
      requireArgs(args, 1);
      const changes = {};
      for (const key of ['name', 'tag', 'url']) if (options[key] !== undefined) changes[key] = options[key];
      const source = await fetchary.edit(args[0], changes);
      emitValue(source, `✓ Updated #${source.id}`);
      return 0;
    }
    case 'enable':
    case 'disable': {
      requireArgs(args, 1);
      const source = await fetchary[command](args[0]);
      emitValue(source, `✓ ${command === 'enable' ? 'Enabled' : 'Disabled'} #${source.id}`);
      return 0;
    }
    case 'remove': {
      requireArgs(args, 1);
      const versions = (await fetchary.history(args[0])).length;
      const sourceId = Number(args[0]);
      await fetchary.remove(sourceId, { purge: options.purge });
      const result = { sourceId, purged: Boolean(options.purge), versions };
      emitValue(result, options.purge ? `✓ Removed #${sourceId} and purged ${versions} archived version${versions === 1 ? '' : 's'}` : `✓ Removed #${sourceId} from monitoring\n  ${versions} archived version${versions === 1 ? '' : 's'} kept`);
      return 0;
    }
    case 'export': {
      requireArgs(args, 1);
      const result = await fetchary.export(args[0], { output: options.output });
      emitValue(result, `✓ Exported ${result.versions} version${result.versions === 1 ? '' : 's'} to ${result.directory}`);
      return 0;
    }
    case 'schedule': {
      requireArgs(args, 2);
      const schedule = await fetchary.schedule(args[0], args[1], { now: options.now });
      emitValue(schedule, `✓ Scheduled #${schedule.sourceId} every ${schedule.every}\n  Next run: ${localDate(schedule.nextRunAt)}`);
      return 0;
    }
    case 'unschedule': {
      requireArgs(args, 1);
      await fetchary.unschedule(args[0]);
      const result = { sourceId: Number(args[0]), enabled: false };
      emitValue(result, `✓ Unscheduled #${args[0]}`);
      return 0;
    }
    case 'schedules': {
      requireArgs(args, 0);
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
      requireArgs(args, 0);
      const pollInterval = options['poll-interval'] == null ? undefined : Number(options['poll-interval']);
      const runner = await fetchary.run({ pollInterval });
      emit('Fetchary scheduler running. Press Ctrl+C to stop.\n');
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
  let parsed;
  try { parsed = parseArgs(argv); } catch (error) {
    stderr.write(`Error: ${error.message}\nRun "fetchary --help" for usage.\n`);
    return 2;
  }
  if (parsed.options.version) {
    stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (parsed.options.help) {
    stdout.write(HELP);
    return 0;
  }

  let fetchary;
  try {
    fetchary = await createFetchary({ dataDir: parsed.options['data-dir'] || process.env.FETCHARY_DATA_DIR });
    if (parsed.options.verbose && !parsed.options.quiet) stderr.write(`Using ${fetchary.dataDir}\n`);
    return await execute(fetchary, parsed, value => stdout.write(value));
  } catch (error) {
    const json = parsed.options.json;
    const payload = { error: error.name, message: error.message };
    stderr.write(json ? `${JSON.stringify(payload)}\n` : `Error: ${error.message}\n`);
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
