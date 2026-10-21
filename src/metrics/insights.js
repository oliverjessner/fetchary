'use strict';
const { parseCount } = require('./followers');
const { sameEntity, classifyUrl } = require('../utils/social');
const metricNames = ['likes','comments','views','shares','saves','followers','following','posts','subscribers','score'];

function countDetails(value) {
  if (value && typeof value === 'object') value = value.simpleText ?? value.runs?.map(run => run.text).join('');
  if (typeof value === 'string') value = value.trim().match(/^(\d[\d., '’\u00a0\u202f]*(?:k|m|b|tsd\.?|mio\.?|mrd\.?|thousand|million|billion)?)(?=\s|$)/i)?.[1]?.trim() ?? value;
  const count = parseCount(value);
  return count === null ? null : { value: count, approximate: typeof value === 'string' && /[a-z]/i.test(value) };
}

function balancedJson(text, start) {
  let depth = 0; let quoted = false; let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if ((char === '}' || char === ']') && --depth === 0) return text.slice(start, index+1);
  }
  return '';
}

function* jsonRoots(document, assignments = []) {
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent.trim();
    try { yield JSON.parse(text); continue; } catch {}
    for (const name of assignments) {
      const match = text.match(new RegExp(`(?:^|[;\\s])(?:var\\s+|let\\s+|const\\s+)?${name}\\s*=\\s*([\\[{])`));
      if (!match) continue;
      try { yield JSON.parse(balancedJson(text, match.index + match[0].length - 1)); } catch {}
    }
  }
}
function* objects(root) {
  const pending = [root];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    yield value;
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
}

function insightBuilder(url, supported = []) {
  const { platform, kind } = classifyUrl(url);
  const metrics = Object.fromEntries(metricNames.map(name => [name, null]));
  const sources = {};
  function set(name, value, type, field, approximate) {
    if (!supported.includes(name) || metrics[name] !== null) return;
    // Reddit's reported net score can be negative; ordinary counts cannot.
    const negative = name === 'score' && (typeof value === 'number' ? value < 0 : typeof value === 'string' && /^[-−]/.test(value.trim()));
    const unsigned = negative ? (typeof value === 'number' ? -value : value.trim().slice(1)) : value;
    const parsed = countDetails(unsigned);
    if (!parsed) return;
    metrics[name] = negative && parsed.value !== 0 ? -parsed.value : parsed.value;
    sources[name] = { type, field, approximate: approximate === undefined ? parsed.approximate : approximate };
  }
  function finish(reason) {
    const unavailable = Object.fromEntries(metricNames.filter(name => metrics[name] === null)
      .map(name => [name, reason || (supported.includes(name) ? 'not_exposed' : 'unsupported')]));
    const found = Object.keys(sources).length;
    return { platform, kind, url, metrics, status: reason || (!supported.length ? 'unsupported' : !found ? 'unavailable' : found === supported.length ? 'available' : 'partial'), sources, unavailable };
  }
  return { set, finish, metrics };
}

function jsonLdMetrics(document, url, builder) {
  for (const root of jsonRoots(document)) for (const object of objects(root)) {
    const types = [object['@type']].flat();
    if (!types.some(type => ['VideoObject','SocialMediaPosting','Article'].includes(type))) continue;
    const target = object.url || object['@id'] || object.mainEntityOfPage?.['@id'];
    if (typeof target !== 'string') continue;
    try { if (!sameEntity(new URL(target, url).href, url)) continue; } catch { continue; }
    builder.set('comments', object.commentCount, 'json-ld', 'commentCount');
    for (const statistic of [object.interactionStatistic].flat()) {
      if (!statistic) continue;
      const action = typeof statistic.interactionType === 'object' ? statistic.interactionType['@type'] : statistic.interactionType;
      const name = { LikeAction:'likes', CommentAction:'comments', WatchAction:'views', ViewAction:'views', ShareAction:'shares' }[String(action).split(/[/#]/).pop()];
      if (name) builder.set(name, statistic.userInteractionCount, 'json-ld', `interactionStatistic.${action}`);
    }
  }
}

function legacyFollower(document, url, builder, followerCount, metric = 'followers') {
  const count = followerCount(document, url);
  if (count !== null) {
    const approximate = [...document.querySelectorAll('meta[content], a, span, strong, p')].some(element => {
      const details = countDetails(element.getAttribute('content') || element.textContent);
      return details?.approximate && details.value === count;
    });
    builder.set(metric, count, 'vendor', 'followerCount', approximate ? true : null);
  }
}
module.exports = { metricNames, countDetails, jsonRoots, objects, insightBuilder, jsonLdMetrics, legacyFollower };
