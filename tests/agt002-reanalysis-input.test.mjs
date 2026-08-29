import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgt002FrozenEngineInput } from '../agt002-reanalysis-input.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT } from '../agt002-preview-reasoning-effort.js';

const source = {
  runtimeConfig: { model: 'm', policyVersion: 'p', timeoutMs: 165000, dailyMaxRuns: 20, maxConcurrent: 2 },
  analysisConfig: { AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: true },
  analysisContext: { opportunity: { id: 'opp' }, documents: [{ id: 'doc' }], snapshotId: 'snap', canonicalOnly: true },
  legalCorpusContext: null,
  integralV3Governance: { companyEvidenceRegistryEntries: [], categoryOverrides: {}, evidenceClassLinkByRequirementId: {}, governanceProvenance: {} },
  manizalesManifestSource: { pilot: true },
  idempotencyKey: 'key',
};

test('builds a JSON-safe frozen engine input with no bridge or database secrets', () => {
  const input = buildAgt002FrozenEngineInput(source);
  assert.equal(input.schema_version, 1);
  assert.equal(input.engine_identity.idempotency_key, 'key');
  assert.equal(input.analysis_context.snapshotId, 'snap');
  assert.deepEqual(input.integral_v3_governance, source.integralV3Governance);
  const serialized = JSON.stringify(input);
  assert.doesNotMatch(serialized, /HMAC|SERVICE_ROLE|bridge_url|secret/i);
  assert.doesNotThrow(() => structuredClone(input));
});

test('deep-clones inputs so later request mutations cannot change the queued payload', () => {
  const input = buildAgt002FrozenEngineInput(source);
  source.analysisContext.documents[0].id = 'mutated';
  assert.equal(input.analysis_context.documents[0].id, 'doc');
});

// AGT-002 root-cause fix: an unconfigured caller (runtimeConfig with no `effort`) must still
// freeze an explicit, auditable value — the fastest operationally-validated level — never leave
// engine_identity silent about it.
test('defaults to the fastest operationally-validated reasoning effort when the runtime config omits one', () => {
  const input = buildAgt002FrozenEngineInput(source);
  assert.equal(input.engine_identity.effort, AGT002_PREVIEW_DEFAULT_REASONING_EFFORT);
});

test('freezes an explicit, accepted operational reasoning effort exactly as configured', () => {
  const input = buildAgt002FrozenEngineInput({
    ...source,
    runtimeConfig: { ...source.runtimeConfig, effort: 'medium' },
  });
  assert.equal(input.engine_identity.effort, 'medium');
});

test('rejects an unsupported reasoning effort instead of freezing it', () => {
  assert.throws(() => buildAgt002FrozenEngineInput({
    ...source,
    runtimeConfig: { ...source.runtimeConfig, effort: 'high' },
  }));
  assert.throws(() => buildAgt002FrozenEngineInput({
    ...source,
    runtimeConfig: { ...source.runtimeConfig, effort: 'Low' },
  }), /frozen input is invalid/i, 'must be exact-case, never coerced');
});

test('fails closed when canonical identity/config are incomplete or exceed the worker lease budget', () => {
  assert.throws(() => buildAgt002FrozenEngineInput({ ...source, analysisConfig: { ...source.analysisConfig, AGT002_CANONICAL_ONLY: false } }));
  assert.throws(() => buildAgt002FrozenEngineInput({ ...source, runtimeConfig: { ...source.runtimeConfig, timeoutMs: 0 } }));
  // The worker lease budget IS the queue budget: the executor rejects an unfundable two-turn lease
  // before claiming, so a job frozen above 285_000ms (2*285+30 = 600 exactly) could only be
  // reserved and then die on its first cycle. This contract used to stop at 480_000ms, which let
  // the enqueue reserve corridas the worker always refused.
  assert.doesNotThrow(() => buildAgt002FrozenEngineInput({ ...source, runtimeConfig: { ...source.runtimeConfig, timeoutMs: 285_000 } }));
  assert.throws(() => buildAgt002FrozenEngineInput({ ...source, runtimeConfig: { ...source.runtimeConfig, timeoutMs: 285_001 } }));
  assert.throws(() => buildAgt002FrozenEngineInput({ ...source, runtimeConfig: { ...source.runtimeConfig, timeoutMs: 480_000 } }));
});
