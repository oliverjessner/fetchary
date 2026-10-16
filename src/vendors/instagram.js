'use strict';
const { jsonRoots, objects, insightBuilder, jsonLdMetrics, legacyFollower } = require('../metrics/insights');
const { classifyUrl } = require('../utils/social');
const { profilePictures } = require('../metrics/profile-pictures');

const { parseCount, linkCount, descriptionCount, jsonObjects, profileName } = require('../metrics/followers');

const COOKIE_CONSENT = 'instagram-cookie-consent';
const LOGIN_DIALOG = 'instagram-login-dialog';

function matches(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'instagram.com' || hostname.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

const overlays = [
  {
    id: COOKIE_CONSENT,
    async dismiss(page) {
      return page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const declineLabels = new Set(['decline optional cookies', 'optionale cookies ablehnen']);
        for (const dialog of document.querySelectorAll('[role="dialog"], dialog')) {
          const button = [...dialog.querySelectorAll('button, [role="button"]')]
            .find(element => {
              if (element.disabled || element.getAttribute('aria-disabled') === 'true' ||
                  element.getClientRects().length === 0) return false;
              return [element.innerText || element.textContent, element.getAttribute('aria-label')]
                .some(label => declineLabels.has(normalize(label)));
            });
          if (!button) continue;
          button.click();
          return true;
        }
        return false;
      });
    },
  },
  {
    id: LOGIN_DIALOG,
    async dismiss(page) {
      return page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const loginLabels = new Set(['log in', 'login', 'sign in', 'anmelden']);
        const closeLabels = new Set(['close', 'schließen', 'schliessen', 'not now', 'jetzt nicht']);
        const loginTitles = new Set([
          'log in to instagram', 'log into instagram', 'sign in to instagram',
          'bei instagram anmelden', 'melde dich bei instagram an',
        ]);
        const enabled = element => !element.disabled && element.getAttribute('aria-disabled') !== 'true' &&
          element.getClientRects().length > 0;

        for (const dialog of document.querySelectorAll('[role="dialog"], dialog')) {
          const controls = [...dialog.querySelectorAll('button, [role="button"]')].filter(enabled);
          const hasLoginForm = dialog.querySelector('input[name="username"], input[autocomplete="username"]') &&
            dialog.querySelector('input[type="password"]');
          const hasLoginControl = controls.some(element =>
            [element.innerText || element.textContent, element.getAttribute('aria-label')]
              .some(label => loginLabels.has(normalize(label))));
          const hasLoginTitle = [...dialog.querySelectorAll('h1, h2, h3, [role="heading"], span, p')]
            .some(element => {
              const text = normalize(element.innerText || element.textContent);
              return loginTitles.has(text) || text.startsWith('see photos, videos and more from ') ||
                text.startsWith('see more from ') || text.startsWith('sieh dir fotos, videos und mehr von ') ||
                text.startsWith('sieh dir mehr von ');
            });
          if (!hasLoginForm && !(hasLoginControl && hasLoginTitle)) continue;

          // Instagram often labels only the SVG inside its clickable close control.
          const close = controls.find(element => {
            const labels = [element.innerText || element.textContent, element.getAttribute('aria-label')];
            for (const icon of element.querySelectorAll('svg[aria-label]')) {
              if (icon.closest('button, [role="button"]') === element) labels.push(icon.getAttribute('aria-label'));
            }
            return labels.some(label => closeLabels.has(normalize(label)));
          });
          if (!close) continue;
          close.click();
          return true;
        }
        return false;
      });
    },
  },
];

function followerCount(document, url) {
  const username = profileName(url, /^\/([\w.]+)\/?$/);
  if (!username || ['accounts', 'explore', 'reels', 'p'].includes(username)) return null;
  for (const object of jsonObjects(document)) {
    if (String(object.username || '').toLowerCase() !== username) continue;
    const count = parseCount(object.edge_followed_by?.count ?? object.follower_count);
    if (count !== null) return count;
  }
  return linkCount(document, url, target => target.pathname.replace(/\/$/, '').toLowerCase() === `/${username}/followers`) ?? descriptionCount(document);
}

function profilePicture(document, url) {
  return profilePictures(document, url, {
    pattern: /^\/([\w.]+)\/?$/,
    reserved: ['accounts', 'explore', 'reels', 'p', 'direct', 'stories', 'about'],
    alt: true, metadata: true,
    json: (object, username) => String(object.username || '').toLowerCase() === username
      ? [object.profile_pic_url_hd, object.hd_profile_pic_url_info, object.hd_profile_pic_versions, object.profile_pic_url] : null,
  });
}

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const isProfile = identity.kind === 'profile';
  const builder = insightBuilder(url, isProfile ? ['followers','following','posts'] : ['post','video'].includes(identity.kind) ? ['likes','comments','views'] : []);
  for (const root of jsonRoots(document)) for (const object of objects(root)) {
    if (isProfile && String(object.username || '').toLowerCase() === identity.id) {
      builder.set('followers', object.edge_followed_by?.count ?? object.follower_count, 'embedded-json', 'user.follower_count');
      builder.set('following', object.edge_follow?.count ?? object.following_count, 'embedded-json', 'user.following_count');
      builder.set('posts', object.edge_owner_to_timeline_media?.count ?? object.media_count, 'embedded-json', 'user.media_count');
    }
    if (!isProfile && object.shortcode === identity.id) {
      builder.set('likes', object.edge_media_preview_like?.count ?? object.edge_liked_by?.count ?? object.like_count, 'embedded-json', 'media.like_count');
      builder.set('comments', object.edge_media_to_parent_comment?.count ?? object.edge_media_to_comment?.count ?? object.comment_count, 'embedded-json', 'media.comment_count');
      builder.set('views', object.video_view_count ?? object.video_play_count ?? object.play_count, 'embedded-json', 'media.video_view_count');
    }
  }
  if (isProfile) legacyFollower(document, url, builder, followerCount);
  else jsonLdMetrics(document, url, builder);
  return builder.finish();
}

module.exports = { name: 'instagram', matches, classifyUrl, socialInsights, overlays, followerCount, profilePicture };
