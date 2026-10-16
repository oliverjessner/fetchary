'use strict';

const { parseHTML } = require('linkedom');
const { readResource } = require('../capture/http');

function httpUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function documentBase(document, url) {
  return httpUrl(document.querySelector('base[href]')?.getAttribute('href'), url) || url;
}

function declaredDimensions(value) {
  const sizes = String(value || '').toLowerCase().split(/\s+/)
    .map(size => size.match(/^(\d+)x(\d+)$/))
    .filter(Boolean).map(match => ({ width: Number(match[1]), height: Number(match[2]) }))
    .filter(size => size.width > 0 && size.height > 0 && Number.isSafeInteger(size.width * size.height));
  return sizes.sort((a, b) => b.width * b.height - a.width * a.height)[0] || { width: null, height: null };
}

// Read dimensions from bytes, independent of the filename, MIME type and HTML
// size hints. ICO files can contain several images; use the largest entry.
function imageDimensions(body) {
  const result = (width, height, type, scalable = false) => ({ width, height, type, scalable });
  if (body.length >= 33 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && body.toString('ascii', 12, 16) === 'IHDR') {
    return result(body.readUInt32BE(16), body.readUInt32BE(20), 'image/png');
  }
  if (body.length >= 10 && /^GIF8[79]a$/.test(body.toString('ascii', 0, 6))) {
    return result(body.readUInt16LE(6), body.readUInt16LE(8), 'image/gif');
  }
  if (body.length >= 6 && body.readUInt32LE(0) === 0x00010000) {
    const count = body.readUInt16LE(4);
    if (!count || body.length < 6 + count * 16) return null;
    const sizes = Array.from({ length: count }, (_, index) => {
      const offset = 6 + index * 16;
      const length = body.readUInt32LE(offset + 8);
      const start = body.readUInt32LE(offset + 12);
      if (!length || start < 6 + count * 16 || start + length > body.length) return null;
      const embedded = imageDimensions(body.subarray(start, start + length));
      return embedded || { width: body[offset] || 256, height: body[offset + 1] || 256 };
    }).filter(Boolean).sort((a, b) => b.width * b.height - a.width * a.height);
    if (!sizes.length) return null;
    return result(sizes[0].width, sizes[0].height, 'image/x-icon');
  }
  if (body.length >= 20 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') {
    const kind = body.toString('ascii', 12, 16);
    if (kind === 'VP8X' && body.length >= 30) return result(1 + body.readUIntLE(24, 3), 1 + body.readUIntLE(27, 3), 'image/webp');
    if (kind === 'VP8 ' && body.length >= 30 && body[23] === 0x9d && body[24] === 1 && body[25] === 0x2a) {
      return result(body.readUInt16LE(26) & 0x3fff, body.readUInt16LE(28) & 0x3fff, 'image/webp');
    }
    if (kind === 'VP8L' && body.length >= 25 && body[20] === 0x2f) {
      const bits = body.readUInt32LE(21);
      return result((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 'image/webp');
    }
  }
  if (body.length >= 4 && body[0] === 0xff && body[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= body.length) {
      if (body[offset++] !== 0xff) break;
      while (body[offset] === 0xff) offset++;
      const marker = body[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > body.length) break;
      const length = body.readUInt16BE(offset);
      if (length < 2 || offset + length > body.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return result(body.readUInt16BE(offset + 5), body.readUInt16BE(offset + 3), 'image/jpeg');
      }
      offset += length;
    }
  }
  const text = body.toString('utf8');
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?<svg[\s>]/i.test(text)) {
    const svg = parseHTML(text).document.querySelector('svg');
    const numeric = value => /^\d+(?:\.\d+)?(?:px)?$/.test(value || '') ? Number.parseFloat(value) : null;
    return result(numeric(svg?.getAttribute('width')), numeric(svg?.getAttribute('height')), 'image/svg+xml', true);
  }
  return null;
}

async function selectImage(candidates, options) {
  const byUrl = new Map();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.url);
    if (!existing || (candidate.priority || 0) < (existing.priority || 0)) byUrl.set(candidate.url, candidate);
  }
  const unique = [...byUrl.values()].slice(0, 64);
  const images = [];
  let next = 0;
  // Bound concurrent requests while checking all advertised resolutions.
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (next < unique.length) {
      const index = next++;
      const candidate = unique[index];
      try {
        const resource = await readResource(candidate.url, options, 16 * 1024 * 1024);
        const actual = imageDimensions(resource.body);
        if (!actual && (!resource.contentType?.startsWith('image/')
          || ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'].includes(resource.contentType)
          || /<(?:!doctype\s+html|html|head|body)\b/i.test(resource.body.toString('utf8', 0, 512)))) continue;
        const dimensions = actual || declaredDimensions(candidate.sizes);
        if (!actual?.scalable && (dimensions.width === 0 || dimensions.height === 0)) continue;
        if (candidate.square && (!actual || actual.width !== actual.height || !actual.width)) continue;
        images.push({
          index, priority: candidate.priority || 0,
          url: resource.url, width: dimensions.width, height: dimensions.height,
          scalable: actual?.scalable || false, resolutionVerified: Boolean(actual),
          contentType: actual?.type || resource.contentType, source: candidate.source,
        });
      } catch {
        // One broken icon or CDN URL must not hide another usable candidate.
      }
    }
  }));
  images.sort((a, b) => a.priority - b.priority || Number(b.scalable) - Number(a.scalable)
    || (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0) || a.index - b.index);
  if (!images.length) return null;
  const { index, priority, ...image } = images[0];
  return image;
}

module.exports = { httpUrl, documentBase, declaredDimensions, imageDimensions, readResource, selectImage };
