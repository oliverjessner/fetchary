'use strict';
const { platformFor, classifyUrl, sameEntity } = require('../utils/social');
const { jsonRoots, objects, insightBuilder } = require('../metrics/insights');

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const builder = insightBuilder(url, identity.kind === 'post' ? ['score', 'comments'] : []);
  if (identity.kind !== 'post') return builder.finish();
  const fullname = `t3_${identity.id}`;
  const matchingPermalink = value => {
    try { return sameEntity(new URL(value, url).href, url); } catch { return false; }
  };
  const posts = [];
  for (const element of document.querySelectorAll('shreddit-post')) {
    if (element.getAttribute('id') !== fullname || element.closest('[hidden], [aria-hidden="true"], [inert]')) continue;
    const permalink = element.getAttribute('permalink');
    if (permalink && !matchingPermalink(permalink)) continue;
    const hidden = element.getAttribute('score-hidden');
    posts.push({ score: element.getAttribute('score'), comments: element.getAttribute('comment-count'),
      hidden: hidden !== null && hidden !== 'false', type: 'vendor', scoreField: 'shreddit-post.score', commentsField: 'shreddit-post.comment-count' });
  }
  for (const root of jsonRoots(document)) for (const object of objects(root)) {
    const post = object.kind === 't3' ? object.data : object.name === fullname ? object : null;
    if (!post || (post.name !== fullname && post.id !== identity.id)) continue;
    if ((post.name != null && post.name !== fullname) || (post.id != null && post.id !== identity.id)) continue;
    if (post.permalink && !matchingPermalink(post.permalink)) continue;
    posts.push({ score: post.score, comments: post.num_comments, hidden: post.score_hidden === true,
      type: 'embedded-json', scoreField: 'post.score', commentsField: 'post.num_comments' });
  }
  const hiddenScore = posts.some(post => post.hidden);
  for (const post of posts) {
    if (!hiddenScore) builder.set('score', post.score, post.type, post.scoreField);
    builder.set('comments', post.comments, post.type, post.commentsField);
  }
  return builder.finish();
}

module.exports = { name: 'reddit', matches: url => platformFor(url) === 'reddit', classifyUrl, overlays: [], socialInsights };
