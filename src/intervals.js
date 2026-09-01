'use strict';

const { FetcharyIntervalError } = require('./errors');

const UNIT_SECONDS = Object.freeze({ m: 60, h: 3600, d: 86400 });

function parseInterval(every) {
  if (typeof every !== 'string') {
    throw new FetcharyIntervalError('interval must be a string such as "15m", "2h", or "3d"', { interval: every });
  }
  const normalized = every.trim().toLowerCase();
  const match = /^(\d+)([mhd])$/.exec(normalized);
  if (!match || Number(match[1]) < 1) {
    throw new FetcharyIntervalError(`invalid interval "${every}". Use minutes, hours, or days.`, { interval: every });
  }
  const amount = Number(match[1]);
  const intervalSeconds = amount * UNIT_SECONDS[match[2]];
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(intervalSeconds)) {
    throw new FetcharyIntervalError(`invalid interval "${every}". Use minutes, hours, or days.`, { interval: every });
  }
  return { every: `${amount}${match[2]}`, intervalSeconds };
}

module.exports = { parseInterval };
