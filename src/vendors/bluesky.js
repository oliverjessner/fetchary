'use strict';
const { platformFor, classifyUrl } = require('../utils/social');
module.exports = { name: 'bluesky', matches: url => platformFor(url) === 'bluesky', classifyUrl, overlays: [] };
