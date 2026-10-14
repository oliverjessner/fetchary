'use strict';

const { jsonObjects, profileName } = require('./followers');
const { httpUrl, documentBase } = require('../extract/images');

function imageValues(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(imageValues);
  return [value.url, value.src, value.contentUrl, value.uri].filter(item => typeof item === 'string');
}

function* profileJson(document) {
  yield* jsonObjects(document);
  // YouTube also embeds JSON in a known assignment. Parse the JSON payload;
  // page scripts are never evaluated by the extraction code.
  for (const script of document.querySelectorAll('script')) {
    const match = script.textContent.trim().match(/^(?:var\s+)?ytInitialData\s*=\s*([\s\S]+?)\s*;?\s*$/);
    if (!match) continue;
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    const pending = [data];
    while (pending.length) {
      const object = pending.pop();
      if (!object || typeof object !== 'object') continue;
      yield object;
      for (const value of Object.values(object)) if (value && typeof value === 'object') pending.push(value);
    }
  }
}

function profilePictures(document, url, options) {
  const profile = profileName(url, options.pattern);
  if (!profile || options.reserved?.includes(profile)) return null;
  const canonical = document.querySelector('link[rel="canonical"][href]')?.getAttribute('href');
  if (canonical) {
    const target = httpUrl(canonical, url);
    if (!target || !(options.matches ? options.matches(target) : new URL(target).hostname.replace(/^www\./, '') === new URL(url).hostname.replace(/^www\./, ''))
      || !profileName(target, options.pattern) || (!options.canonicalAlias && profileName(target, options.pattern) !== profile)) return null;
  }
  const base = documentBase(document, url);
  const candidates = [];
  const add = (value, source, priority = 0, square = false) => {
    for (const image of imageValues(value)) {
      const target = httpUrl(image, base);
      if (target) candidates.push({ url: target, source, priority, square });
    }
  };
  for (const object of profileJson(document)) add(options.json?.(object, profile, url), 'profile-json');
  if (options.selectors) {
    for (const image of document.querySelectorAll(options.selectors)) {
      if (options.acceptImage && !options.acceptImage(image, profile, url)) continue;
      add(image.getAttribute('src') || image.getAttribute('data-delayed-url') || image.getAttribute('data-src'), 'profile-image');
      // Profile headers often advertise a larger avatar only through srcset.
      for (const entry of (image.getAttribute('srcset') || '').split(',')) {
        add(entry.trim().split(/\s+/)[0], 'profile-srcset');
      }
    }
  }
  if (options.alt) {
    for (const image of document.querySelectorAll('img[alt]')) {
      const alt = image.getAttribute('alt').toLowerCase();
      if ([`${profile}'s profile picture`, `${profile}’s profile picture`, `profile picture of ${profile}`, `profilbild von ${profile}`].includes(alt)) {
        add(image.getAttribute('src'), 'profile-image');
      }
    }
  }
  if (options.metadata) {
    for (const meta of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) {
      // Social preview cards and banners are commonly rectangular. Metadata
      // is a fallback and must be a verified square image to qualify.
      add(meta.getAttribute('content'), 'profile-metadata', 1, true);
    }
  }
  return { profile, candidates };
}

module.exports = { profilePictures };
