'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { elementDiff } = require('../src/diff');

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
