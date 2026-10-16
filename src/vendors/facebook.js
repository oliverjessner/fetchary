'use strict';
const { platformFor, classifyUrl } = require('../utils/social');
module.exports = { name: 'facebook', matches: url => platformFor(url) === 'facebook', classifyUrl, overlays: [] };
