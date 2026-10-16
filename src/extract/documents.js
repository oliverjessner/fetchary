'use strict';
const { linkOccurrences } = require('./links');

const mimeTypes = {
  pdf: 'application/pdf', csv: 'text/csv', tsv: 'text/tab-separated-values',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation', rtf: 'application/rtf', txt: 'text/plain',
  md: 'text/markdown', json: 'application/json', xml: 'application/xml', epub: 'application/epub+zip',
  zip: 'application/zip', gz: 'application/gzip', '7z': 'application/x-7z-compressed',
};
const extensions = new Set([...Object.keys(mimeTypes), 'docm','dot','dotx','dotm','xlsm','xlsb','xlt','xltx','xltm',
  'pptm','pot','potx','potm','pps','ppsx','ppsm','odg','odf','ott','ots','otp','markdown','rst','tex',
  'mobi','azw','azw3','ics','vcf','yaml','yml','ndjson','jsonl','rar','tar','tgz','bz2','xz','log']);
const extensionByMime = new Map(Object.entries(mimeTypes).map(([extension, mime]) => [mime, extension]));
extensionByMime.set('text/rtf', 'rtf'); extensionByMime.set('text/xml', 'xml');
extensionByMime.set('application/csv', 'csv'); extensionByMime.set('application/x-pdf', 'pdf');

function decode(value) { try { return decodeURIComponent(value); } catch { return value; } }
function filename(value) { return value ? value.split(/[\\/]/).at(-1).trim() || null : null; }
function extension(value) {
  const match = value?.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match && extensions.has(match[1]) ? match[1] : null;
}

function documentLinks(document, pageUrl, options) {
  const results = [];
  for (const { element, link } of linkOccurrences(document, pageUrl, options, true)) {
    const url = new URL(link.url);
    const downloadName = filename(element.getAttribute('download'));
    const pathName = filename(decode(url.pathname));
    const queryNames = []; const queryFormats = [];
    for (const [name, value] of url.searchParams) {
      if (/^(?:file(?:name)?|name|path|attachment|document|download)$/i.test(name)) queryNames.push(filename(value));
      if (/^(?:format|ext(?:ension)?|type)$/i.test(name) && extensions.has(value.toLowerCase())) queryFormats.push(value.toLowerCase());
    }
    const contentType = element.getAttribute('type')?.split(';')[0].trim().toLowerCase() || null;
    let format = extensionByMime.get(contentType);
    let detectedBy;
    if (format || /^application\/vnd\.(?:openxmlformats-officedocument\.|ms-(?:word|excel|powerpoint)[.\-]|oasis\.opendocument\.)/.test(contentType || '')) detectedBy = 'type';
    else if ((format = extension(downloadName))) detectedBy = 'download';
    else if ((format = extension(pathName))) detectedBy = 'url';
    else if ((format = queryNames.map(extension).find(Boolean) || queryFormats[0])) detectedBy = 'query';
    else if (element.hasAttribute('download') && !/^(?:image|audio|video)\//.test(contentType || '')
      && ![downloadName, pathName, ...queryNames].some(name => /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp[34]|m4[av]|wav|ogg|webm|mov|avi|exe|dmg|apk|js|css)$/i.test(name || ''))) detectedBy = 'download';
    if (!detectedBy) continue;
    results.push({ ...link, filename: downloadName || queryNames.find(name => extension(name)) || pathName,
      extension: format || null, contentType: contentType || mimeTypes[format] || null, detectedBy });
  }
  return results;
}

module.exports = { documentLinks };
