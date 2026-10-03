'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { comparisonHtml, comparisonText, comparisonHash, elementDiff } = require('../src/diff');

test('element content and raw diffs distinguish content, attributes, and ignored elements', () => {
  const before = '<h1 class="old">Same</h1><p>Before</p><relative-time>09:41</relative-time>';
  const after = '<h1 class="new">Same</h1><p>After</p><relative-time>09:43</relative-time>';

  const content = elementDiff(before, after, { mode: 'content', ignoreSelectors: ['relative-time'] });
  assert.deepEqual(content, [
    { type: 'removed', value: '<p>Before</p>' },
    { type: 'added', value: '<p>After</p>' },
  ]);

  const raw = elementDiff(before, after, { mode: 'raw' });
  assert.deepEqual(raw, [
    { type: 'removed', value: '<h1 class="old">Same</h1>' },
    { type: 'removed', value: '<p>Before</p>' },
    { type: 'removed', value: '<relative-time>09:41</relative-time>' },
    { type: 'added', value: '<h1 class="new">Same</h1>' },
    { type: 'added', value: '<p>After</p>' },
    { type: 'added', value: '<relative-time>09:43</relative-time>' },
  ]);
});

test('include selectors keep only the first matching subtree per selector in document order', () => {
  const html = '<header>Outside</header><main><p>First</p><span class="clock">Old</span></main><aside>Second</aside><footer>Outside</footer>';
  const options = { includeSelectors: ['aside', 'main p', 'main', 'main'], ignoreSelectors: ['.clock'] };
  assert.equal(comparisonHtml(html, options), '<main><p>First</p></main>\n<aside>Second</aside>');
  assert.equal(comparisonText(html, options), 'First\n\nSecond');
  assert.equal(comparisonText(html, { includeSelectors: ['aside', 'main p'] }), 'First\n\nSecond');
  assert.equal(comparisonHash(html, options), comparisonHash(html.replaceAll('Outside', 'Updated').replace('Old', 'New'), options));
  assert.deepEqual(elementDiff(html, html.replace('First', 'Changed'), { mode: 'content', ...options }), [
    { type: 'removed', value: '<p>First</p>' },
    { type: 'added', value: '<p>Changed</p>' },
  ]);

  const repeated = '<div class="item">One</div><div>Outside</div><div class="item">Two</div>';
  const firstMatch = { includeSelectors: ['.item'] };
  assert.equal(comparisonText(repeated, firstMatch), 'One');
  assert.equal(comparisonHtml(repeated, firstMatch), '<div class="item">One</div>');
  assert.equal(comparisonText(repeated, { includeSelectors: ['.item, div'] }), 'One');
  assert.equal(comparisonText(repeated, { includeSelectors: ['.item:last-child', '.item'] }), 'One\n\nTwo');
  assert.equal(comparisonHash(repeated, firstMatch), comparisonHash(repeated.replace('Two', 'Changed later match'), firstMatch));
  assert.notEqual(comparisonHash(repeated, firstMatch), comparisonHash(repeated.replace('One', 'Changed first match'), firstMatch));
  assert.deepEqual(elementDiff(repeated, repeated.replace('Two', 'Changed later match'), { mode: 'content', ...firstMatch }), []);
  assert.equal(comparisonText(repeated, { ...firstMatch, ignoreSelectors: ['.item:first-child'] }), '', 'ignoring the first match does not select a later match');
});

test('include selectors match the original DOM and ignored roots and ancestors take precedence', () => {
  const html = '<main><span class="clock">Old</span><p>Keep</p></main>';
  assert.equal(comparisonText(html, { includeSelectors: ['main p:nth-child(2)'], ignoreSelectors: ['.clock'] }), 'Keep');
  assert.equal(comparisonText(html, { includeSelectors: ['main'], ignoreSelectors: ['main'] }), '');
  assert.equal(comparisonText(html, { includeSelectors: ['main p'], ignoreSelectors: ['main'] }), '');
  assert.equal(comparisonText(html, { includeSelectors: ['main .clock'], ignoreSelectors: ['.clock'] }), '');
});

test('missing include matches compare as empty and detect a subtree appearing or disappearing', () => {
  const before = '<p>Outside</p>';
  const after = '<p>Updated outside</p><main>Appeared</main>';
  const options = { includeSelectors: ['main'] };
  assert.equal(comparisonHtml(before, options), '');
  assert.equal(comparisonText(before, options), '');
  assert.equal(comparisonHash(before, options), comparisonHash('<p>Different</p>', options));
  assert.deepEqual(elementDiff(before, '<p>Different</p>', { mode: 'content', ...options }), []);
  assert.deepEqual(elementDiff(before, after, { mode: 'content', ...options }), [{ type: 'added', value: '<main>Appeared</main>' }]);
  assert.deepEqual(elementDiff(after, before, { mode: 'content', ...options }), [{ type: 'removed', value: '<main>Appeared</main>' }]);
});

test('raw element diffs compare the complete DOM regardless of comparison selectors', () => {
  const before = '<main>Same</main><p>Before</p>';
  const after = '<main>Same</main><p>After</p>';
  const options = { includeSelectors: ['main'], ignoreSelectors: ['p'] };
  assert.deepEqual(elementDiff(before, after, { mode: 'content', ...options }), []);
  assert.deepEqual(elementDiff(before, after, { mode: 'raw', ...options }), [
    { type: 'removed', value: '<p>Before</p>' },
    { type: 'added', value: '<p>After</p>' },
  ]);
});
