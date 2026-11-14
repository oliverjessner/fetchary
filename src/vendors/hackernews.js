'use strict';

const { platformFor, classifyUrl, sameEntity } = require('../utils/social');
const { insightBuilder, isVisible } = require('../metrics/insights');
const { httpUrl } = require('../extract/images');

const matches = url => platformFor(url) === 'hackernews';

function socialInsights(document, url) {
  const identity = classifyUrl(url);
  const builder = insightBuilder(url, identity.kind === 'post' ? ['score', 'comments'] : identity.kind === 'profile' ? ['karma'] : []);
  if (identity.kind === 'post') {
    const item = [...document.querySelectorAll('tr.athing[id]')].find(element => element.getAttribute('id') === identity.id && !element.classList.contains('comtr') && isVisible(element));
    const details = item?.nextElementSibling;
    if (!isVisible(details)) return builder.finish();
    for (const score of details.querySelectorAll('.score[id]')) {
      if (score.getAttribute('id') !== `score_${identity.id}` || !isVisible(score)) continue;
      const value = score.textContent.trim().match(/^(-?[\d,]+)\s+points?$/)?.[1];
      if (value !== undefined) builder.set('score', value, 'vendor', 'score.id');
    }
    for (const link of details.querySelectorAll('a[href]')) {
      const target = httpUrl(link.getAttribute('href'), url);
      if (!isVisible(link) || !target || !sameEntity(target, url)) continue;
      const text = link.textContent.replace(/\u00a0/g, ' ').trim();
      const count = text.match(/^([\d,]+)\s+comments?$/)?.[1];
      if (count !== undefined) builder.set('comments', count, 'vendor', 'item.comments');
      else if (text === 'discuss') builder.set('comments', 0, 'vendor', 'item.discuss');
    }
  } else if (identity.kind === 'profile') {
    for (const row of document.querySelectorAll('tr')) {
      const cells = [...row.children].filter(element => element.localName === 'td');
      if (cells[0]?.textContent.trim() !== 'user:' || !isVisible(row)) continue;
      const link = cells[1]?.querySelector('a[href]');
      const target = link && httpUrl(link.getAttribute('href'), url);
      if (!target || !isVisible(link) || !sameEntity(target, url) || link.textContent.trim() !== identity.id) continue;
      const table = row.closest('table');
      for (const entry of table.querySelectorAll('tr')) {
        if (entry.closest('table') !== table || !isVisible(entry)) continue;
        const fields = [...entry.children].filter(element => element.localName === 'td');
        if (fields[0]?.textContent.trim() === 'karma:' && fields[1]) builder.set('karma', fields[1].textContent.trim(), 'vendor', 'profile.karma');
      }
      break;
    }
  }
  return builder.finish();
}

module.exports = { name: 'hackernews', matches, classifyUrl, overlays: [], socialInsights };
