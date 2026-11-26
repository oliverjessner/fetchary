#!/usr/bin/env node
'use strict';

// Shipped in src so both npm dependency and global installations can run it.
const { installBrowser } = require('./browser-runtime');

installBrowser({ respectSkipDownload: true }).then(result => {
  process.stdout.write(result.skipped ? `Fetchary browser download skipped (${result.reason}).\n`
    : `Fetchary Chrome ${result.buildId} installed.\n`);
}).catch(error => {
  process.stderr.write(`Fetchary: ${error.message}\n`);
  process.exitCode = 1;
});
