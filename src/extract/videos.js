'use strict';
const { httpUrl, documentBase } = require('./images');
const { classifyUrl } = require('../utils/social');
const { structuredData } = require('./structured-data');

const mimeTypes = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', ogv: 'video/ogg',
  mpeg: 'video/mpeg', mpg: 'video/mpeg', mpe: 'video/mpeg',
  ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t',
  '3gp': 'video/3gpp', '3g2': 'video/3gpp2', flv: 'video/x-flv', f4v: 'video/mp4',
  wmv: 'video/x-ms-wmv', m3u8: 'application/vnd.apple.mpegurl', mpd: 'application/dash+xml',
};
const streamTypes = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'application/dash+xml']);
const videoObject = value => /^(?:https?:\/\/schema\.org\/)?VideoObject$/.test(value);
function extension(value) {
  try { value = decodeURIComponent(value); } catch { /* Keep malformed URL text as supplied. */ }
  const format = value?.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  return Object.hasOwn(mimeTypes, format) ? format : null;
}
function videoPlatform(value) {
  const url = new URL(value);
  const identity = classifyUrl(value);
  if (identity.kind === 'video') {
    // Facebook's video directories are not individual videos.
    if (identity.platform !== 'facebook' || url.searchParams.get('v')
      || /\/(?:videos|reel|watch)\/[^/]+/.test(url.pathname)) return identity.platform;
  }
  const host = url.hostname;
  if ((host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) && /^\/embed\/[^/]+/.test(url.pathname)) return 'youtube';
  if (host === 'player.vimeo.com' && /^\/video\/\d+\/?$/.test(url.pathname)) return 'vimeo';
  if ((host === 'tiktok.com' || host.endsWith('.tiktok.com')) && /^\/embed\/(?:v2\/)?\d+\/?$/.test(url.pathname)) return 'tiktok';
  if (host === 'player.twitch.tv' && url.searchParams.get('video')) return 'twitch';
  if (host === 'clips.twitch.tv' && (url.pathname === '/embed' ? url.searchParams.get('clip') : /^\/[^/]+\/?$/.test(url.pathname))) return 'twitch';
  return null;
}

function videoLinks(document, pageUrl, options = {}) {
  const base = documentBase(document, pageUrl);
  const included = (options.includeSelectors || []).map(selector => document.querySelector(selector)).filter(Boolean);
  const ignored = (options.ignoreSelectors || []).flatMap(selector => [...document.querySelectorAll(selector)]);
  const results = [];
  function add(rawUrl, element, originalAttribute, explicit = false, source = element.localName) {
    const url = httpUrl(rawUrl, base);
    if (!url) return;
    const target = new URL(url);
    const contentType = element.getAttribute('type')?.split(';')[0].trim().toLowerCase() || null;
    if (/^(?:audio|image)\//.test(contentType || '')) return;
    let format = extension(target.pathname) || extension(element.getAttribute('download'));
    for (const [name, value] of target.searchParams) {
      if (/^(?:file(?:name)?|name|path|download)$/i.test(name)) format ||= extension(value);
      if (/^(?:format|ext(?:ension)?|type)$/i.test(name) && Object.hasOwn(mimeTypes, value.toLowerCase())) format ||= value.toLowerCase();
    }
    const platform = videoPlatform(url);
    if (!explicit && !format && !platform && !/^video\//.test(contentType || '') && !streamTypes.has(contentType)) return;
    results.push({ url, rawUrl, source, originalAttribute, extension: format,
      contentType: contentType && contentType !== 'application/ld+json' ? contentType : mimeTypes[format] || null, platform });
  }
  for (const element of document.querySelectorAll('a[href], area[href], link[href], video, source, iframe, embed, object, meta, [itemprop], script[type]')) {
    if (element.closest('template, noscript, style')) continue;
    if (options.includeSelectors?.length && !included.some(root => root.contains(element))) continue;
    if (ignored.some(root => root.contains(element))) continue;
    const tag = element.localName;
    const start = results.length;
    if (tag === 'script') {
      if (element.getAttribute('type').split(';')[0].trim().toLowerCase() !== 'application/ld+json') continue;
      const pending = structuredData(null, pageUrl, options.maxResponseBytes, element.textContent).jsonLd.reverse();
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object') continue;
        const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
        if (types.some(type => typeof type === 'string' && videoObject(type))) {
          for (const field of ['contentUrl', 'embedUrl', 'url']) {
            const values = Array.isArray(value[field]) ? value[field] : [value[field]];
            for (const item of values) add(typeof item === 'string' ? item : item?.['@id'], element, field, true, 'json-ld');
          }
        }
        for (const child of Object.values(value).reverse()) if (child && typeof child === 'object') pending.push(child);
      }
      continue;
    }
    if (element.closest('script')) continue;
    const attribute = ['a','area','link'].includes(tag) ? 'href' : tag === 'object' ? 'data' : 'src';
    if (['a','area','link','video','source','iframe','embed','object'].includes(tag) && !element.closest('audio, picture')) {
      const explicit = tag === 'video' || tag === 'source' && element.parentElement?.localName === 'video';
      for (const name of [attribute, ...(['video','source','iframe'].includes(tag) ? ['data-src','data-lazy-src','data-original'] : [])]) add(element.getAttribute(name), element, name, explicit);
    }
    const metadata = element.getAttribute('property') || element.getAttribute('name') || '';
    const properties = (element.getAttribute('itemprop') || '').split(/\s+/);
    const scope = element.closest('[itemscope]');
    const isVideoProperty = properties.some(property => ['contentUrl','embedUrl','url'].includes(property))
      && (scope?.getAttribute('itemtype') || '').split(/\s+/).some(videoObject);
    if (tag === 'meta' && /^(?:og:video(?::url|:secure_url)?|twitter:player(?::stream)?)$/i.test(metadata) || isVideoProperty) {
      const name = tag === 'meta' ? 'content' : ['a','area','link'].includes(tag) ? 'href'
        : ['video','source','iframe','embed'].includes(tag) ? 'src' : tag === 'object' ? 'data' : null;
      // An element may already have contributed the same attribute above.
      if (name && !results.slice(start).some(result => result.rawUrl === element.getAttribute(name) && result.originalAttribute === name)) add(element.getAttribute(name), element, name, true);
      else if (!name) add(element.textContent.trim(), element, 'textContent', true);
    }
  }
  return results;
}

module.exports = { videoLinks };
