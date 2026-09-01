'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FetcharyRunnerError } = require('./errors');

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireLock(dataDir) {
  const lockPath = path.join(dataDir, 'scheduler.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      return { descriptor, lockPath };
    } catch (cause) {
      if (cause.code !== 'EEXIST') throw new FetcharyRunnerError('could not acquire scheduler lock', { cause });
      let owner;
      try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
      if (attempt === 0 && owner && !processExists(owner.pid)) {
        try { fs.unlinkSync(lockPath); } catch {}
        continue;
      }
      throw new FetcharyRunnerError('a scheduler is already active for this data directory', { lockPath, pid: owner?.pid });
    }
  }
  throw new FetcharyRunnerError('a scheduler is already active for this data directory', { lockPath });
}

function releaseLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.descriptor); } catch {}
  try { fs.unlinkSync(lock.lockPath); } catch {}
}

module.exports = { acquireLock, releaseLock };
