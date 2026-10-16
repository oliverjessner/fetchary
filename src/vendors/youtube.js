'use strict';
const { jsonRoots, objects, insightBuilder, jsonLdMetrics, legacyFollower } = require('../metrics/insights');
const { classifyUrl } = require('../utils/social');

const { elementCount, labeledCount } = require('../metrics/followers');
const { profilePictures } = require('../metrics/profile-pictures');

const COOKIE_CONSENT = 'youtube-cookie-consent';

function matches(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') ||
      hostname === 'youtu.be' || hostname.endsWith('.youtu.be');
  } catch {
    return false;
  }
}

const overlays = [
  {
    id: COOKIE_CONSENT,
    async dismiss(page) {
      const consentPage = typeof page.url === 'function' &&
        new URL(page.url()).hostname === 'consent.youtube.com';
      const controller = new AbortController();
      // The standalone consent form navigates back to YouTube. Start listening
      // before the click so even a zero post-load wait captures the target page.
      const navigation = consentPage && typeof page.waitForNavigation === 'function'
        ? page.waitForNavigation({ waitUntil: 'load', timeout: 5_000, signal: controller.signal }).catch(() => {})
        : null;

      try {
        const dismissed = await page.evaluate(isConsentPage => {
          const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const declineLabels = new Set(['reject all', 'alle ablehnen']);
          const dialogs = [...document.querySelectorAll(
            'ytd-consent-bump-v2-lightbox, ytd-consent-bump-lightbox, [role="dialog"]',
          )];
          if (isConsentPage && document.body) dialogs.push(document.body);

          for (const dialog of dialogs) {
            const button = [...dialog.querySelectorAll('button, [role="button"], input[type="submit"]')]
              .find(element => {
                if (element.disabled || element.getAttribute('aria-disabled') === 'true' ||
                    element.getClientRects().length === 0) return false;
                return [element.innerText || element.textContent, element.getAttribute('aria-label'), element.value]
                  .some(label => declineLabels.has(normalize(label)));
              });
            if (!button) continue;
            button.click();
            return true;
          }
          return false;
        }, consentPage);

        if (dismissed && navigation) await navigation;
        return dismissed;
      } finally {
        controller.abort();
      }
    },
  },
];

function followerCount(document, url) {
  if (!/^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/[^/]+)?\/?$/.test(new URL(url).pathname)) return null;
  const labels = 'subscribers?|abonnenten';
  const legacy = elementCount(document.querySelector('ytd-c4-tabbed-header-renderer #subscriber-count, ytd-channel-header-renderer #subscriber-count'), labels);
  if (legacy !== null) return legacy;
  for (const element of document.querySelectorAll('yt-page-header-renderer span, ytd-page-header-renderer span, yt-page-header-view-model span')) {
    if (labeledCount(element.getAttribute('aria-label'), labels) === null && labeledCount(element.textContent, labels) === null) continue;
    const count = elementCount(element, labels);
    if (count !== null) return count;
  }
  return null;
}

function profilePicture(document, url) {
  return profilePictures(document, url, {
    matches, canonicalAlias: true,
    pattern: /^\/(\@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/(?:about|videos|shorts|streams|featured|playlists|community))?\/?$/,
    selectors: 'ytd-c4-tabbed-header-renderer #avatar img, ytd-channel-header-renderer #avatar img, yt-page-header-renderer yt-avatar-shape img, yt-page-header-view-model .ytAvatarShapeImage, yt-page-header-view-model yt-avatar-shape img',
    metadata: true,
    json: object => [object.c4TabbedHeaderRenderer?.avatar?.thumbnails,
      object.pageHeaderRenderer?.content?.pageHeaderViewModel?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources],
  });
}

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const builder = insightBuilder(url, identity.kind === 'video' ? ['views','likes','comments'] : identity.kind === 'channel' ? ['subscribers'] : []);
  if (identity.kind === 'channel') {
    for (const root of jsonRoots(document, ['ytInitialData'])) for (const object of objects(root)) {
      const header = object.header?.c4TabbedHeaderRenderer || object.header?.pageHeaderRenderer;
      if (header?.channelId && identity.id !== header.channelId && !url.includes('/@')) continue;
      if (header?.subscriberCountText) builder.set('subscribers', header.subscriberCountText, 'embedded-json', 'header.subscriberCountText');
    }
    legacyFollower(document, url, builder, followerCount, 'subscribers');
  } else if (identity.kind === 'video') {
    for (const root of jsonRoots(document, ['ytInitialPlayerResponse','ytInitialData'])) {
      if (root.videoDetails?.videoId === identity.id) builder.set('views', root.videoDetails.viewCount, 'embedded-json', 'videoDetails.viewCount');
      if (root.currentVideoEndpoint?.watchEndpoint?.videoId !== identity.id) continue;
      const contents = root.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
      for (const item of contents) for (const object of objects(item)) {
        if (object.videoPrimaryInfoRenderer) for (const button of objects(object.videoPrimaryInfoRenderer)) {
          const toggle = button.toggleButtonRenderer;
          if (toggle?.defaultIcon?.iconType === 'LIKE') builder.set('likes', toggle.defaultText, 'embedded-json', 'videoPrimaryInfoRenderer.toggleButtonRenderer.defaultText');
        }
        if (object.commentsHeaderRenderer) builder.set('comments', object.commentsHeaderRenderer.countText, 'embedded-json', 'commentsHeaderRenderer.countText');
      }
    }
    jsonLdMetrics(document, url, builder);
  }
  return builder.finish();
}

module.exports = { name: 'youtube', matches, classifyUrl, socialInsights, overlays, followerCount, profilePicture };
