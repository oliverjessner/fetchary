'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { FetcharyValidationError } = require('../src/errors');
const MAX_BYTES = 2 * 1024 * 1024;
const privateName = /token|secret|pass(?:word|wd)?|authorization|credential|api[-_]?key|session|signature|(?:^|[-_])(?:key|sig|code|jwt|auth)(?:$|[-_])/i;
function historyFile(value = process.env.FETCHARY_HISTORY_FILE) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.includes('\0'))) throw new FetcharyValidationError('FETCHARY_HISTORY_FILE must be a file path');
  return path.resolve(value ?? path.join(os.homedir(), '.fetchary', 'history.json'));
}
function redactedArgs(args) {
  let hideNext = false;
  return args.map(argument => {
    if (hideNext) { hideNext = false; return '[redacted]'; }
    const flag = argument.match(/^--([^=]+)(?:=(.*))?$/s);
    if (flag && privateName.test(flag[1]) && !['session','session-dir','cookies','cookies-from-browser','browser-profile'].includes(flag[1])) {
      hideNext = flag[2] === undefined;
      return `--${flag[1]}${hideNext ? '' : '=[redacted]'}`;
    }
    if (/^https?:\/\//i.test(argument)) {
      try {
        const url = new URL(argument);
        if (url.username || url.password) { url.username = 'redacted'; url.password = ''; }
        for (const key of [...url.searchParams.keys()]) if (privateName.test(key)) url.searchParams.set(key, '[redacted]');
        if (url.hash) url.hash = '[redacted]';
        argument = url.href;
      } catch { return '[invalid URL]'; }
    }
    return argument;
  }).map(argument => argument.length > 4096 ? argument.slice(0, 4096) + '[truncated]' : argument);
}
function commandLine(args) {
  return ['fetchary', ...args].map(value => /^[a-zA-Z0-9_./:@%+=,-]+$/.test(value) ? value
    : /[\x00-\x1f\x7f]/.test(value) ? "$'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replace(/[\x00-\x1f\x7f]/g, char => '\\x' + char.charCodeAt(0).toString(16).padStart(2, '0')) + "'"
    : `'${value.replaceAll("'", "'\\''")}'`).join(' ');
}
function validate(entries) {
  if (!Array.isArray(entries) || entries.length > 100 || entries.some(entry => !entry || typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))
    || !Number.isInteger(entry.exitCode) || !Array.isArray(entry.args) || entry.args.some(arg => typeof arg !== 'string' || arg.length > 4120))) throw new FetcharyValidationError('invalid command history file');
  return entries;
}
async function readHistory(file) {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error();
    if (process.platform !== 'win32' && (stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error();
    const buffer = Buffer.alloc(MAX_BYTES + 1); let length = 0;
    while (length < buffer.length) { const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length); if (!bytesRead) break; length += bytesRead; }
    if (length > MAX_BYTES) throw new Error();
    return validate(JSON.parse(buffer.toString('utf8', 0, length)));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new FetcharyValidationError('could not read command history; check its format, size and private file permissions');
  } finally { await handle?.close().catch(() => {}); }
}
async function acquireLock(file) {
  const deadline = Date.now() + 5000;
  while (true) {
    let handle;
    try { handle = await fs.open(file, 'wx', 0o600); await handle.writeFile(JSON.stringify({ pid: process.pid })); return handle; }
    catch (error) {
      if (handle) { await handle.close().catch(() => {}); await fs.unlink(file).catch(() => {}); }
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = await fs.lstat(file);
        if (stat.isFile() && Date.now() - stat.mtimeMs > 30_000) {
          let owner; try { owner = JSON.parse(await fs.readFile(file, 'utf8')).pid; } catch {}
          let active = Number.isSafeInteger(owner) && owner > 0;
          if (active) { try { process.kill(owner, 0); } catch (failure) { if (failure.code === 'ESRCH') active = false; } }
          if (!active) { await fs.unlink(file); continue; }
        }
      } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      if (Date.now() >= deadline) throw new Error('history is busy');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}
async function recordHistory(file, args, exitCode) {
  const directory = path.dirname(file); const lockFile = file + '.lock'; let lock; let temporary;
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || process.platform !== 'win32' && (stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error();
    lock = await acquireLock(lockFile);
    const entries = await readHistory(file);
    entries.push({ timestamp: new Date().toISOString(), args: redactedArgs(args), exitCode });
    const body = JSON.stringify(validate(entries.slice(-100)), null, 2) + '\n';
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error();
    temporary = path.join(directory, `.${randomUUID()}.tmp`);
    await fs.writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file); temporary = null;
  } catch { throw new FetcharyValidationError('could not save command history; check FETCHARY_HISTORY_FILE and private directory/file permissions'); }
  finally {
    if (temporary) await fs.unlink(temporary).catch(() => {});
    if (lock) { await lock.close().catch(() => {}); await fs.unlink(lockFile).catch(() => {}); }
  }
}
function historyItems(entries) { return [...entries].reverse().map(entry => ({ ...entry, command: commandLine(entry.args) })); }
module.exports = { historyFile, readHistory, recordHistory, historyItems, redactedArgs };
