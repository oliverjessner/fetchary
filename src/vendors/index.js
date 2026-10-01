'use strict';

const threads = require('./threads');
const x = require('./x');

// Add new site integrations here. Each vendor owns its URL matching and
// overlay selectors so the browser capture remains vendor-agnostic.
const vendors = [threads, x];

async function prepareVendorPage(page, url) {
  for (const vendor of vendors) {
    if (!vendor.matches(url) || typeof vendor.prepare !== 'function') continue;
    try {
      await vendor.prepare(page);
    } catch {
      // Vendor preparation is best-effort and must never prevent archiving.
    }
  }
}

async function dismissVendorOverlays(page, url, alreadyDismissed = []) {
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

module.exports = { prepareVendorPage, dismissVendorOverlays };
