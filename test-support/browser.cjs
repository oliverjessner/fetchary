'use strict';

// Integration tests exercise the same packaged browser as CLI and library users.
module.exports = { launch: require('../src/capture/browser-runtime').launchBrowser };
