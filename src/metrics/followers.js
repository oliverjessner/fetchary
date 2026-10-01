'use strict';

// Keep unknown or hidden counts distinct from a profile with zero followers.
function parseCount(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  const text = String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').trim();
  const match = text.match(/^(\d[\d., '’]*?)\s*(k|m|b|tsd\.?|mio\.?|mrd\.?|thousand|million|billion)?$/i);
  if (!match) return null;
  let number = match[1].replace(/[ '’]/g, '');
  const unit = (match[2] || '').toLowerCase().replace(/\.$/, '');
  if (unit) {
    const separator = Math.max(number.lastIndexOf(','), number.lastIndexOf('.'));
    if (separator >= 0) number = number.slice(0, separator).replace(/[.,]/g, '') + '.' + number.slice(separator + 1);
  } else {
    if (!/^\d+$/.test(number) && !/^\d{1,3}(?:,\d{3})+$/.test(number) && !/^\d{1,3}(?:\.\d{3})+$/.test(number)) return null;
    number = number.replace(/[.,]/g, '');
  }
  const multiplier = /^(k|tsd|thousand)$/.test(unit) ? 1e3 : /^(m|mio|million)$/.test(unit) ? 1e6 : unit ? 1e9 : 1;
  const count = Math.round(Number(number) * multiplier);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function labeledCount(value, labels = 'followers?|abonnenten') {
  const match = String(value || '').trim().match(new RegExp(`^(\\d[\\d., '’\\u00a0\\u202f]*(?:k|m|b|tsd\\.?|mio\\.?|mrd\\.?|thousand|million|billion)?)\\s*(?:${labels})(?:$|\\s|[•·,])`, 'i'));
  return match ? parseCount(match[1]) : null;
}

function elementCount(element, labels) {
  if (!element) return null;
  // A tooltip often contains the exact number while visible text is rounded.
  for (const candidate of [element, ...element.querySelectorAll('[title]')]) {
    const exact = parseCount(candidate.getAttribute('title'));
    if (exact !== null) return exact;
  }
  for (const value of [element.getAttribute('aria-label'), element.textContent]) {
    const count = labeledCount(value, labels) ?? parseCount(value);
    if (count !== null) return count;
  }
  return null;
}

function linkCount(document, url, accepts) {
  const origin = new URL(url);
  for (const element of document.querySelectorAll('a[href]')) {
    let target;
    try { target = new URL(element.getAttribute('href'), origin); } catch { continue; }
    if (target.hostname.replace(/^www\./, '') !== origin.hostname.replace(/^www\./, '') || !accepts(target)) continue;
    const count = elementCount(element);
    if (count !== null) return count;
  }
  return null;
}

function descriptionCount(document) {
  for (const element of document.querySelectorAll('meta[property="og:description"], meta[name="description"], meta[name="twitter:description"]')) {
    const count = labeledCount(element.getAttribute('content'));
    if (count !== null) return count;
  }
  return null;
}

function* jsonObjects(document) {
  for (const script of document.querySelectorAll('script')) {
    let data;
    // Embedded JSON is data only; never evaluate JavaScript from an archive.
    try { data = JSON.parse(script.textContent); } catch { continue; }
    const pending = [data];
    while (pending.length) {
      const object = pending.pop();
      if (!object || typeof object !== 'object') continue;
      yield object;
      for (const value of Object.values(object)) if (value && typeof value === 'object') pending.push(value);
    }
  }
}

function profileName(url, pattern) {
  const match = new URL(url).pathname.match(pattern);
  try { return match ? decodeURIComponent(match[1]).toLowerCase() : null; } catch { return null; }
}

module.exports = { parseCount, labeledCount, elementCount, linkCount, descriptionCount, jsonObjects, profileName };
