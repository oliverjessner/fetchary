'use strict';
const { platformFor, classifyUrl } = require('../utils/social');
module.exports = { name: 'reddit', matches: url => platformFor(url) === 'reddit', classifyUrl, overlays: [] };
