import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGT002_PREVIEW_DEFAULT_REASONING_EFFORT,
  AGT002_PREVIEW_REASONING_EFFORT_VALUES,
  isAgt002PreviewReasoningEffort,
} from '../agt002-preview-reasoning-effort.js';

test('the allowlist is narrow and the default is its fastest member', () => {
  assert.deepEqual(AGT002_PREVIEW_REASONING_EFFORT_VALUES, ['low', 'medium']);
  assert.equal(AGT002_PREVIEW_DEFAULT_REASONING_EFFORT, 'low');
  assert.ok(AGT002_PREVIEW_REASONING_EFFORT_VALUES.includes(AGT002_PREVIEW_DEFAULT_REASONING_EFFORT));
  assert.ok(Object.isFrozen(AGT002_PREVIEW_REASONING_EFFORT_VALUES));
});

test('isAgt002PreviewReasoningEffort accepts only exact-case allowlisted strings', () => {
  assert.equal(isAgt002PreviewReasoningEffort('low'), true);
  assert.equal(isAgt002PreviewReasoningEffort('medium'), true);
  for (const invalid of ['high', 'minimal', 'Low', 'LOW', ' low', 'low ', '', null, undefined, 0, {}, []]) {
    assert.equal(isAgt002PreviewReasoningEffort(invalid), false, `must reject ${JSON.stringify(invalid)}`);
  }
});

console.log('agt002-preview-reasoning-effort.test.mjs OK');
