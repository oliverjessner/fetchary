'use strict';
const { createInterface } = require('node:readline/promises');
const { login, FetcharyValidationError } = require('../src');

async function interactiveLogin(url, settings, io) {
  const input = io.stdin || process.stdin; const output = io.stderr || process.stderr;
  if (!io.confirmLogin && !input.isTTY) throw new FetcharyValidationError('login needs an interactive terminal; run fetchary login in a terminal window');
  const controller = new AbortController();
  const signal = settings.signal ? AbortSignal.any([settings.signal, controller.signal]) : controller.signal;
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort); process.once('SIGHUP', abort);
  try {
    output.write('Opening a browser. Sign in on the website, then return here.\n');
    return await login(url, { ...settings, signal, confirm: io.confirmLogin || (async ({ signal }) => {
      const terminal = createInterface({ input, output, terminal: true });
      terminal.on('SIGINT', abort);
      // EOF is cancellation, never an implicit request to save the session.
      const eof = () => controller.abort();
      terminal.once('close', eof);
      try { await terminal.question('Press Enter after signing in to save this session (Ctrl+C cancels): ', { signal }); }
      finally { terminal.off('close', eof); terminal.close(); }
    }) });
  } finally {
    process.off('SIGINT', abort); process.off('SIGTERM', abort); process.off('SIGHUP', abort);
  }
}
module.exports = { interactiveLogin };
