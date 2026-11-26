'use strict';

function browserInstallHint(error) {
  // Only expose the known missing-browser diagnostic, never arbitrary launcher
  // messages, filesystem paths, cookies or protocol payloads.
  const missing = /^Could not find (?:Chrome|Chromium) \(ver\. (\d+\.\d+\.\d+\.\d+)\)/.exec(error?.message || '');
  if (!missing) return '';
  return `: required Chrome ${missing[1]} is not installed; run "fetchary browser install" (local library installation: "npx --no-install fetchary browser install")`;
}

module.exports = { browserInstallHint };
