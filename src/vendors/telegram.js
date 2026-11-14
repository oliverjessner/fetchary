'use strict';

const { platformFor, classifyUrl, sameEntity } = require('../utils/social');
const { insightBuilder, countDetails, isVisible } = require('../metrics/insights');
const { httpUrl } = require('../extract/images');

const matches = url => platformFor(url) === 'telegram';
const channelOf = identity => identity.id?.split('/')[0];

function captureUrl(url) {
  const identity = classifyUrl(url);
  if (identity.platform !== 'telegram' || identity.kind !== 'post' || new URL(url).pathname.startsWith('/s/')) return url;
  return `https://t.me/s/${identity.id}${new URL(url).search}`;
}

function channelMatches(document, url) {
  const requested = classifyUrl(url);
  const channel = channelOf(requested);
  if (!channel) return false;
  const declared = document.querySelector('link[rel="canonical"][href]')?.getAttribute('href')
    || document.querySelector('meta[property="og:url"]')?.getAttribute('content');
  if (declared) {
    const target = httpUrl(declared, url);
    if (!target || !sameEntity(target, url)) return false;
    return true;
  }
  return [...document.querySelectorAll('.tgme_channel_info_header_username a[href], .tgme_page_photo a[href], .tgme_page_title a[href]')]
    .some(link => {
      const target = httpUrl(link.getAttribute('href'), url);
      const identity = target && classifyUrl(target);
      return identity && identity.kind === 'channel' && channelOf(identity) === channel;
    });
}

// Widget data-post identifies the original public post even when its media is
// served from a CDN. Keep private /c links and unrelated forwarded posts out.
function telegramPostUrl(element, pageUrl) {
  const requested = classifyUrl(pageUrl);
  const widget = element.closest('.tgme_widget_message[data-post]');
  if (requested.platform !== 'telegram' || !widget || !isVisible(widget)) return null;
  const target = httpUrl(`https://t.me/${widget.getAttribute('data-post')}`, pageUrl);
  if (!target) return null;
  const identity = classifyUrl(target);
  if (identity.kind !== 'post' || channelOf(identity) !== channelOf(requested)
    || requested.kind === 'post' && !sameEntity(target, pageUrl)) return null;
  const permalink = widget.querySelector('a.tgme_widget_message_date[href]');
  if (permalink) {
    const linked = httpUrl(permalink.getAttribute('href'), pageUrl);
    if (!linked || !sameEntity(linked, target)) return null;
  }
  return `https://t.me/${identity.id}`;
}

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const builder = insightBuilder(url, identity.kind === 'channel' ? ['subscribers'] : identity.kind === 'post' ? ['views'] : []);
  if (identity.kind === 'channel' && channelMatches(document, url)) {
    for (const counter of document.querySelectorAll('.tgme_channel_info_counter')) {
      const label = counter.querySelector('.counter_type');
      const value = counter.querySelector('.counter_value');
      if (isVisible(counter) && isVisible(label) && isVisible(value) && /^subscribers?$/i.test(label?.textContent.trim() || '')) {
        builder.set('subscribers', value.textContent.trim(), 'vendor', 'tgme_channel_info_counter.subscribers');
      }
    }
    for (const extra of document.querySelectorAll('.tgme_page_extra')) {
      const value = extra.textContent.trim().match(/^([\d.,\s'’]+(?:[KMB])?)\s+subscribers?$/i)?.[1]?.trim();
      if (isVisible(extra) && value) builder.set('subscribers', value, 'vendor', 'tgme_page_extra.subscribers');
    }
  } else if (identity.kind === 'post') {
    for (const widget of document.querySelectorAll('.tgme_widget_message[data-post]')) {
      if (!telegramPostUrl(widget, url)) continue;
      for (const value of widget.querySelectorAll('.tgme_widget_message_views')) {
        if (value.closest('.tgme_widget_message[data-post]') !== widget || !isVisible(value)) continue;
        const parsed = countDetails(value.textContent.trim());
        if (parsed) builder.set('views', parsed.value, 'vendor', 'tgme_widget_message_views', parsed.approximate);
      }
    }
  }
  return builder.finish();
}

function profilePicture(document, url) {
  const identity = classifyUrl(url);
  if (identity.kind !== 'channel') return null;
  const result = { profile: identity.id, candidates: [] };
  if (!channelMatches(document, url)) return result;
  const seen = new Set();
  function add(value, source, square = false) {
    const target = httpUrl(value, url);
    if (!target || seen.has(target)) return;
    seen.add(target); result.candidates.push({ url: target, source, priority: square ? 1 : 0, square });
  }
  for (const root of document.querySelectorAll('.tgme_channel_info_logo, .tgme_page_photo_image')) {
    if (!isVisible(root)) continue;
    for (const element of [root, ...root.querySelectorAll('img, [style]')]) {
      if (!isVisible(element)) continue;
      if (element.localName === 'img') add(element.getAttribute('src'), 'profile-image');
      const background = (element.getAttribute('style') || '').match(/background-image\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)/i)?.[2];
      if (background) add(background, 'profile-image');
    }
  }
  for (const element of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) add(element.getAttribute('content'), 'profile-metadata', true);
  return result;
}

module.exports = { name: 'telegram', matches, classifyUrl, overlays: [], socialInsights, profilePicture, telegramPostUrl, captureUrl };
