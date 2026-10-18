'use strict';

function browserInstallHint(error) {
  // Only expose the known missing-browser diagnostic, never arbitrary launcher
  // messages, filesystem paths, cookies or protocol payloads.
  const missing = /^Could not find (?:Chrome|Chromium) \(ver\. (\d+\.\d+\.\d+\.\d+)\)/.exec(error?.message || '');
  if (!missing) return '';
  const version = require('puppeteer/package.json').version;
  return `: required Chrome ${missing[1]} is not installed; run "npx puppeteer@${version} browsers install chrome"`;
}

module.exports = { browserInstallHint };
