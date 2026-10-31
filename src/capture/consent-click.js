'use strict';

// Vendor-specific selectors stay with each vendor; the selected DOM control is
// clicked through Puppeteer so the site's handlers receive trusted input.
async function clickConsentControl(page, selectControl, ...args) {
  if (typeof page.evaluateHandle !== 'function') {
    // Existing lightweight browser doubles report a boolean from evaluate().
    // A serialized DOM object is never accepted as a completed browser click.
    return await page.evaluate(selectControl, ...args) === true;
  }
  let handle;
  try {
    handle = await page.evaluateHandle(selectControl, ...args);
    const element = handle.asElement?.();
    if (!element || typeof element.click !== 'function') return false;
    await element.click();
    return true;
  } finally {
    try { await handle?.dispose?.(); } catch {}
  }
}

module.exports = { clickConsentControl };
