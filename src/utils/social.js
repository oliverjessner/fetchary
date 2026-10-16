'use strict';

const domains = Object.freeze({
  youtube: ['youtube.com','youtu.be'], tiktok: ['tiktok.com'], instagram: ['instagram.com'],
  facebook: ['facebook.com','fb.com'], x: ['x.com','twitter.com'], threads: ['threads.com','threads.net'],
  linkedin: ['linkedin.com'], twitch: ['twitch.tv'], reddit: ['reddit.com','redd.it'],
  github: ['github.com'], vimeo: ['vimeo.com'], bluesky: ['bsky.app'],
});

function platformFor(value) {
  try {
    const url = new URL(value);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return null;
    return Object.keys(domains).find(platform => domains[platform].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) || null;
  } catch { return null; }
}

function classifyUrl(value) {
  const platform = platformFor(value);
  if (!platform) return { platform: null, kind: 'unknown', id: null };
  const url = new URL(value);
  const p = url.pathname.replace(/\/+$/, '');
  let kind = 'unknown'; let id = null; let match;
  if (platform === 'youtube') {
    id = url.hostname.endsWith('youtu.be') ? p.match(/^\/([^/]+)$/)?.[1] : (p === '/watch' ? url.searchParams.get('v') : null) || p.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
    if (id) kind = 'video';
    else if ((match = p.match(/^\/(?:@([^/]+)|(?:channel|c|user)\/([^/]+))(?:\/(?:about|videos|shorts|streams|featured|playlists|community))?$/))) { kind = 'channel'; id = match[1] || match[2]; }
  } else if (platform === 'tiktok') {
    if ((match = p.match(/^\/@([^/]+)\/video\/(\d+)$/))) { kind = 'video'; id = match[2]; }
    else if ((match = p.match(/^\/@([^/]+)$/))) { kind = 'profile'; id = match[1]; }
  } else if (platform === 'instagram') {
    if ((match = p.match(/^\/(p|reel|reels|tv)\/([^/]+)$/))) { kind = match[1] === 'p' ? 'post' : 'video'; id = match[2]; }
    else if ((match = p.match(/^\/([\w.]+)$/)) && !['accounts','explore','direct','stories','reels','about'].includes(match[1])) { kind = 'profile'; id = match[1]; }
  } else if (platform === 'x') {
    if ((match = p.match(/^\/[^/]+\/status\/(\d+)$/))) { kind = 'post'; id = match[1]; }
    else if ((match = p.match(/^\/([\w]+)$/)) && !['home','explore','search','login','signup','settings','i'].includes(match[1])) { kind = 'profile'; id = match[1]; }
  } else if (platform === 'threads') {
    if ((match = p.match(/^\/@[^/]+\/post\/([^/]+)$/))) { kind = 'post'; id = match[1]; }
    else if ((match = p.match(/^\/@([^/]+)$/))) { kind = 'profile'; id = match[1]; }
  } else if (platform === 'linkedin') {
    if ((match = p.match(/^\/(in|company|school|showcase)\/([^/]+)(?:\/(?:about|life|people|posts|recent-activity))?$/))) { kind = 'profile'; id = `${match[1]}/${match[2]}`; }
    else if (/^\/(posts|feed\/update)\//.test(p)) { kind = 'post'; id = p; }
  } else if (platform === 'twitch') {
    if ((match = p.match(/^\/videos\/(\d+)$/))) { kind = 'video'; id = match[1]; }
    else if ((match = p.match(/^\/([\w-]+)(?:\/about)?$/)) && !['directory','downloads','login','signup','settings'].includes(match[1])) { kind = 'profile'; id = match[1]; }
  } else if (platform === 'github') {
    if ((match = p.match(/^\/([\w-]+)$/)) && !['login','signup','explore','settings','features','marketplace','pricing','orgs','organizations','topics','collections','trending','about'].includes(match[1])) { kind = 'profile'; id = match[1]; }
  } else if (platform === 'reddit') {
    if ((match = p.match(/\/comments\/([^/]+)/)) || (url.hostname === 'redd.it' && (match = p.match(/^\/([^/]+)$/)))) { kind = 'post'; id = match[1]; }
    else if ((match = p.match(/^\/(?:user|u)\/([^/]+)$/))) { kind = 'profile'; id = match[1]; }
  } else if (platform === 'bluesky') {
    if ((match = p.match(/^\/profile\/[^/]+\/post\/([^/]+)$/))) { kind = 'post'; id = match[1]; }
    else if ((match = p.match(/^\/profile\/([^/]+)$/))) { kind = 'profile'; id = match[1]; }
  } else if (platform === 'vimeo') {
    if ((match = p.match(/^\/(\d+)$/))) { kind = 'video'; id = match[1]; }
    else if ((match = p.match(/^\/([^/]+)$/))) { kind = 'profile'; id = match[1]; }
  } else if (platform === 'facebook') {
    if (url.searchParams.has('v') || /\/(?:videos|reel|watch)(?:\/|$)/.test(p)) { kind = 'video'; id = url.searchParams.get('v') || p; }
    else if (/\/(?:posts|permalink|story)(?:\/|\.)/.test(p) || url.searchParams.has('story_fbid')) { kind = 'post'; id = url.searchParams.get('story_fbid') || p; }
    else if ((match = p.match(/^\/([^/]+)$/)) && !['login','watch','marketplace','groups','gaming','help'].includes(match[1])) { kind = 'profile'; id = url.searchParams.get('id') || match[1]; }
  }
  return { platform, kind, id: id ? (kind === 'profile' ? id.toLowerCase() : id) : null };
}

function sameEntity(left, right) {
  const a = classifyUrl(left); const b = classifyUrl(right);
  return a.platform !== null && a.platform === b.platform && a.kind === b.kind && a.id !== null && a.id === b.id;
}

module.exports = { domains, platformFor, classifyUrl, sameEntity };
