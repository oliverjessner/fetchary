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

async function prepareSnapshot(page, url) {
  const identity = classifyUrl(url);
  if (identity.kind !== 'video') return identity.kind === 'channel';
  return page.evaluate(videoId => {
    const watch = [...document.querySelectorAll('ytd-watch-flexy[video-id]')]
      .find(element => element.getAttribute('video-id') === videoId && !element.closest('[hidden], [aria-hidden="true"], [inert]'));
    const comments = watch?.querySelector('ytd-comments#comments');
    if (!comments || comments.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const count = comments.querySelector('ytd-comments-header-renderer #count');
    if (/\d/.test(count?.textContent || '')) return true;
    // YouTube can restore the player's scroll position while hydrating. Keep
    // the heading in view until its total arrives, without scrolling the list.
    const bounds = (count || comments).getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= innerHeight) comments.scrollIntoView({ block: 'start', behavior: 'instant' });
    return false;
  }, identity.id);
}

function renderedComments(document, videoId, builder) {
  for (const watch of document.querySelectorAll('ytd-watch-flexy[video-id]')) {
    if (watch.getAttribute('video-id') !== videoId || watch.closest('[hidden], [aria-hidden="true"], [inert]')) continue;
    for (const count of watch.querySelectorAll('ytd-comments#comments ytd-comments-header-renderer #count')) {
      if (count.closest('ytd-watch-flexy') !== watch || count.closest('[hidden], [aria-hidden="true"], [inert]')) continue;
      for (const value of [count.textContent, count.getAttribute('aria-label')]) {
        builder.set('comments', value, 'vendor', 'ytd-comments-header-renderer.#count');
      }
    }
  }
}

function renderedChannelPosts(document, builder) {
  const elements = [...document.querySelectorAll(
    'ytd-c4-tabbed-header-renderer #videos-count, ytd-channel-header-renderer #videos-count, ' +
    'yt-page-header-renderer yt-content-metadata-view-model span, ' +
    'ytd-page-header-renderer yt-content-metadata-view-model span, ' +
    'yt-page-header-view-model yt-content-metadata-view-model span, ' +
    '.ytPageHeaderViewModelContentMetadata span',
  )].filter(element => !element.closest('[hidden], [aria-hidden="true"], [inert]'));
  // Accessibility labels can report an exact total while visible text is rounded.
  for (const attribute of ['aria-label', 'textContent']) for (const element of elements) {
    const value = attribute === 'textContent' ? element.textContent : element.getAttribute(attribute);
    if (labeledCount(value, 'videos?') !== null) builder.set('posts', value, 'vendor', 'channelHeader.videoCount');
  }
}

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const builder = insightBuilder(url, identity.kind === 'video' ? ['views','likes','comments'] : identity.kind === 'channel' ? ['subscribers','posts'] : []);
  if (identity.kind === 'channel') {
    for (const root of jsonRoots(document, ['ytInitialData'])) {
      const header = root?.header?.c4TabbedHeaderRenderer || root?.header?.pageHeaderRenderer;
      if (!header) continue;
      const channelId = header.channelId || root.metadata?.channelMetadataRenderer?.externalId;
      if (channelId && new URL(url).pathname.startsWith('/channel/') && identity.id !== channelId) continue;
      if (header?.subscriberCountText) builder.set('subscribers', header.subscriberCountText, 'embedded-json', 'header.subscriberCountText');
      for (const field of ['videosCountText', 'videoCountText']) builder.set('posts', header[field], 'embedded-json', `header.${field}`);
      const metadata = header.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel;
      for (const row of metadata?.metadataRows || []) for (const part of row.metadataParts || []) {
        for (const value of [part.accessibilityLabel, part.text?.content]) {
          for (const [name, labels] of [['subscribers', 'subscribers?|abonnenten'], ['posts', 'videos?']]) {
            if (labeledCount(value, labels) !== null) builder.set(name, value, 'embedded-json', 'header.content.pageHeaderViewModel.metadata.contentMetadataViewModel');
          }
        }
      }
    }
    renderedChannelPosts(document, builder);
    legacyFollower(document, url, builder, followerCount, 'subscribers');
  } else if (identity.kind === 'video') {
    renderedComments(document, identity.id, builder);
    for (const root of jsonRoots(document, ['ytInitialPlayerResponse','ytInitialData'])) {
      if (root.videoDetails?.videoId === identity.id) builder.set('views', root.videoDetails.viewCount, 'embedded-json', 'videoDetails.viewCount');
      if (root.currentVideoEndpoint?.watchEndpoint?.videoId !== identity.id) continue;
      const contents = root.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
      for (const item of contents) for (const object of objects(item)) {
        if (object.videoPrimaryInfoRenderer) for (const button of objects(object.videoPrimaryInfoRenderer)) {
          const toggle = button.toggleButtonRenderer;
          if (toggle?.defaultIcon?.iconType === 'LIKE') builder.set('likes', toggle.defaultText, 'embedded-json', 'videoPrimaryInfoRenderer.toggleButtonRenderer.defaultText');
        }
        if (object.commentsHeaderRenderer) {
          builder.set('comments', object.commentsHeaderRenderer.countText, 'embedded-json', 'commentsHeaderRenderer.countText');
          builder.set('comments', object.commentsHeaderRenderer.commentsCount, 'embedded-json', 'commentsHeaderRenderer.commentsCount');
        }
      }
    }
    jsonLdMetrics(document, url, builder);
  }
  return builder.finish();
}

module.exports = { name: 'youtube', matches, classifyUrl, socialInsights, overlays, prepareSnapshot, followerCount, profilePicture };
