'use strict';
const { platformFor, classifyUrl } = require('../utils/social');
module.exports = { name: 'vimeo', matches: url => platformFor(url) === 'vimeo', classifyUrl, overlays: [] };
