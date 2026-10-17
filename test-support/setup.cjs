'use strict';
// CLI subprocesses inherit an isolated history file, never the user's history.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.env.FETCHARY_TEST_HISTORY_ROOT) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-test-history-'));
  process.env.FETCHARY_TEST_HISTORY_ROOT = directory;
  process.env.FETCHARY_HISTORY_FILE = path.join(directory, 'history.json');
  process.once('exit', () => fs.rmSync(directory, { recursive: true, force: true }));
}
