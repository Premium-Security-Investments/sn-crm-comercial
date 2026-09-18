// Shared immutable allowed-model contract: the single source of truth both the AGT-002 Hetzner
// bridge (agt002-hetzner-bridge-server.js) and the preview runtime's server-owned config boundary
// (getAgt002PreviewRuntimeConfig in agt002-preview-runtime.js) must consume — never a local copy —
// so a caller can never queue/run a model alias the bridge itself would reject.
import { strict as assert } from 'node:assert';
import { AGT002_PREVIEW_ALLOWED_MODELS } from '../agt002-preview-allowed-models.js';

assert.deepEqual(
  AGT002_PREVIEW_ALLOWED_MODELS, ['sonnet'],
  'the shared contract must contain exactly one allowed alias: sonnet',
);

assert.equal(Object.isFrozen(AGT002_PREVIEW_ALLOWED_MODELS), true, 'the shared contract must be immutable');
assert.throws(
  () => { AGT002_PREVIEW_ALLOWED_MODELS.push('gpt-5.6-luna'); },
  TypeError,
  'a frozen contract must reject an attempt to broaden the allowlist by mutation',
);

console.log('AGT-002 Preview shared allowed-model contract (immutable, sonnet-only) passed');
