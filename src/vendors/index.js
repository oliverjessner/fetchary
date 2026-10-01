'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FetcharyValidationError } = require('../errors');

// Every direct .js file except this entrypoint is a vendor module. Adding a
// module no longer requires maintaining a second list of integrations.
function discoverVendors(directory = __dirname) {
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'index.js')
    .map(entry => entry.name).sort();
  const vendors = [];
  const names = new Set();
  const overlayIds = new Set();
  for (const file of files) {
    const vendor = require(path.join(directory, file));
    if (!vendor || typeof vendor.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(vendor.name) ||
        typeof vendor.matches !== 'function' || !Array.isArray(vendor.overlays) ||
        (vendor.prepare !== undefined && typeof vendor.prepare !== 'function') ||
        (vendor.followerCount !== undefined && typeof vendor.followerCount !== 'function') ||
        (vendor.followerCountFromRaw !== undefined && typeof vendor.followerCountFromRaw !== 'function')) {
      throw new FetcharyValidationError(`invalid vendor module "${file}"`);
    }
    if (names.has(vendor.name)) throw new FetcharyValidationError(`duplicate vendor name "${vendor.name}"`);
    names.add(vendor.name);
    for (const overlay of vendor.overlays) {
      if (!overlay || typeof overlay.id !== 'string' || !overlay.id.trim() || typeof overlay.dismiss !== 'function') {
        throw new FetcharyValidationError(`invalid overlay in vendor "${vendor.name}"`);
      }
      if (overlayIds.has(overlay.id)) throw new FetcharyValidationError(`duplicate vendor overlay "${overlay.id}"`);
      overlayIds.add(overlay.id);
    }
    vendors.push(vendor);
  }
  return vendors;
}

async function prepareVendorPage(page, url, vendors = discoverVendors()) {
  for (const vendor of vendors) {
    if (!vendor.matches(url) || typeof vendor.prepare !== 'function') continue;
    try {
      await vendor.prepare(page);
    } catch {
      // Vendor preparation is best-effort and must never prevent archiving.
    }
  }
}

async function dismissVendorOverlays(page, url, alreadyDismissed = [], vendors = discoverVendors()) {
  const completed = new Set(alreadyDismissed);
  const dismissed = [];

  for (const vendor of vendors) {
    if (!vendor.matches(url)) continue;
    for (const overlay of vendor.overlays) {
      if (completed.has(overlay.id)) continue;
      try {
        if (await overlay.dismiss(page)) dismissed.push(overlay.id);
      } catch {
        // Vendor helpers are best-effort and must never prevent archiving.
      }
    }
  }

  return dismissed;
}

module.exports = { discoverVendors, prepareVendorPage, dismissVendorOverlays };
