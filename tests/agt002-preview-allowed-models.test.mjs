import assert from 'node:assert/strict';
import test from 'node:test';
import { AGT002_PREVIEW_ALLOWED_MODELS, AGT002_PREVIEW_SONNET_MODEL } from '../agt002-preview-allowed-models.js';

test('the AGT-002 preview model allowlist is exactly one frozen, exact-match model', () => {
  assert.deepEqual(AGT002_PREVIEW_ALLOWED_MODELS, ['sonnet']);
  assert.ok(Object.isFrozen(AGT002_PREVIEW_ALLOWED_MODELS));
});

test('the allowlist is derived from the single named sonnet-model constant, not a restated literal', () => {
  assert.equal(AGT002_PREVIEW_SONNET_MODEL, 'sonnet');
  assert.deepEqual(AGT002_PREVIEW_ALLOWED_MODELS, [AGT002_PREVIEW_SONNET_MODEL]);
});
