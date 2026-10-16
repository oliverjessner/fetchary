'use strict';

const { FetcharyValidationError } = require('../errors');

const DEFAULT_CACHE_TTL_MS = 45_000;
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024;

function validateCacheTtl(value = DEFAULT_CACHE_TTL_MS) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new FetcharyValidationError('cacheTtlMs must be a finite, non-negative number');
  }
  return value;
}

function cloneCapture(page) {
  return { ...page, rawBody: Buffer.from(page.rawBody), dismissedOverlays: [...page.dismissedOverlays] };
}

// No timers: both age checks and LRU eviction happen only during cache use.
// The clock is injectable internally so expiration tests need no real waiting.
function createCaptureCache({ maxEntries = DEFAULT_MAX_ENTRIES, maxCacheBytes = DEFAULT_MAX_CACHE_BYTES, now = Date.now } = {}) {
  for (const [name, value] of Object.entries({ maxEntries, maxCacheBytes })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new FetcharyValidationError(`${name} must be a non-negative safe integer`);
  }
  const entries = new Map();
  const pending = new Map();
  let bytes = 0;

  function remove(key) {
    bytes -= entries.get(key).bytes;
    entries.delete(key);
  }

  function prune(time, ttlMs) {
    // No entry owns a TTL: every caller applies its effective TTL to age.
    for (const [key, entry] of entries) if (time - entry.completedAt >= ttlMs) remove(key);
  }

  return {
    clear() {
      entries.clear();
      bytes = 0;
      // Detach active work without cancelling it. Pre-clear captures cannot
      // repopulate the cache or delete newer work for the same key.
      pending.clear();
    },
    async capture(key, ttlMs, load) {
      validateCacheTtl(ttlMs);
      if (ttlMs === 0) {
        return { ...await load(), cache: { hit: false, ageMs: 0, ttlMs } };
      }
      const time = now();
      prune(time, ttlMs);
      const entry = entries.get(key);
      if (entry) {
        entries.delete(key);
        entries.set(key, entry);
        return { ...cloneCapture(entry.page), cache: { hit: true, ageMs: Math.max(0, time - entry.completedAt), ttlMs } };
      }

      let promise = pending.get(key);
      if (!promise) {
        promise = Promise.resolve().then(load).then(page => {
          const completedAt = now();
          const snapshot = cloneCapture(page);
          if (page.cacheable !== false && pending.get(key) === promise) {
            const { rawBody, renderedHtml, ...metadata } = snapshot;
            const size = rawBody.length + (renderedHtml?.length || 0) * 2
              + JSON.stringify(metadata).length * 2 + key.length * 2;
            prune(completedAt, ttlMs);
            if (maxEntries > 0 && size <= maxCacheBytes) {
              while (entries.size >= maxEntries || bytes + size > maxCacheBytes) remove(entries.keys().next().value);
              entries.set(key, { page: snapshot, completedAt, bytes: size });
              bytes += size;
            }
          }
          return snapshot;
        }).finally(() => {
          if (pending.get(key) === promise) pending.delete(key);
        });
        pending.set(key, promise);
      }
      // In-flight joiners are misses too: no completed cached capture existed.
      return { ...cloneCapture(await promise), cache: { hit: false, ageMs: 0, ttlMs } };
    },
  };
}

module.exports = { createCaptureCache, validateCacheTtl, DEFAULT_CACHE_TTL_MS };
