'use strict';
const fs = require('node:fs');
const path = require('node:path');
function discoverDetectors(directory = path.join(__dirname, 'providers')) {
  const names = new Set();
  return fs.readdirSync(directory).filter(name => name.endsWith('.js')).sort().map(name => {
    const detector = require(path.join(directory, name));
    if (!detector || !/^[a-z][a-z0-9-]*$/.test(detector.provider) || typeof detector.category !== 'string' || typeof detector.detect !== 'function' || names.has(detector.provider)) throw new Error(`invalid tracker detector: ${name}`);
    names.add(detector.provider);
    return detector;
  });
}
module.exports = { discoverDetectors };
