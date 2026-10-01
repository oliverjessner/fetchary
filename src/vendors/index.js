'use strict';

const threads = require('./threads');

// Add new site integrations here. Each vendor owns its URL matching and
// overlay selectors so the browser capture remains vendor-agnostic.
const vendors = [threads];

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

module.exports = { dismissVendorOverlays };
