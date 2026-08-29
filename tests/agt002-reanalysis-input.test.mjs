import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgt002FrozenEngineInput } from '../agt002-reanalysis-input.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT } from '../agt002-preview-reasoning-effort.js';

const FIXTURE_EVIDENCE_IDENTITY = Object.freeze({
  source_snapshot_hash: 'a'.repeat(64),
  preview_artifact_hash: 'b'.repeat(64),
  source_manifest_version: 'v0.3.1-approved-20260829',
});
const FIXTURE_EVIDENCE_AS_OF = '2026-08-29T00:00:00.000Z';

// Factory, never a shared object: each test gets its own fresh, unfrozen fixture tree, so a
// test that mutates its copy (e.g. the deep-clone test below) can never leak that mutation into
// a later test's assertions.
function createSource() {
  return {
    runtimeConfig: { model: 'm', policyVersion: 'p', timeoutMs: 165000, dailyMaxRuns: 20, maxConcurrent: 2 },
    analysisConfig: { AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: true },
    analysisContext: { opportunity: { id: 'opp' }, documents: [{ id: 'doc' }], snapshotId: 'snap', canonicalOnly: true },
    legalCorpusContext: null,
    integralV3Governance: {
      companyEvidenceRegistryEntries: [], categoryOverrides: {}, evidenceClassLinkByRequirementId: {}, governanceProvenance: {},
      evidenceIdentity: FIXTURE_EVIDENCE_IDENTITY, evidenceAsOf: FIXTURE_EVIDENCE_AS_OF,
    },
    manizalesManifestSource: { pilot: true },
    idempotencyKey: 'key',
  };
}

test('builds a JSON-safe frozen engine input with no bridge or database secrets', () => {
  const source = createSource();
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
  const source = createSource();
  const input = buildAgt002FrozenEngineInput(source);
  source.analysisContext.documents[0].id = 'mutated';
  assert.equal(input.analysis_context.documents[0].id, 'doc');
});

// AGT-002 root-cause fix: an unconfigured caller (runtimeConfig with no `effort`) must still
// freeze an explicit, auditable value — the fastest operationally-validated level — never leave
// engine_identity silent about it.
test('defaults to the fastest operationally-validated reasoning effort when the runtime config omits one', () => {
  const input = buildAgt002FrozenEngineInput(createSource());
  assert.equal(input.engine_identity.effort, AGT002_PREVIEW_DEFAULT_REASONING_EFFORT);
});

test('freezes an explicit, accepted operational reasoning effort exactly as configured', () => {
  const source = createSource();
  const input = buildAgt002FrozenEngineInput({
    ...source,
    runtimeConfig: { ...source.runtimeConfig, effort: 'medium' },
  });
  assert.equal(input.engine_identity.effort, 'medium');
});

test('rejects an unsupported reasoning effort instead of freezing it', () => {
  const source = createSource();
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
  const source = createSource();
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

// C: the frozen JSON clone is deep-frozen — not merely its own top-level properties — so no
// caller (this module's own return path, a later executor, a test) can mutate anything reachable
// from the returned object, however deeply nested.
test('deep-freezes every array/object reachable from the frozen engine input, not just the root', () => {
  const input = buildAgt002FrozenEngineInput(createSource());
  assert.ok(Object.isFrozen(input));
  assert.ok(Object.isFrozen(input.engine_identity));
  assert.ok(Object.isFrozen(input.analysis_flags));
  assert.ok(Object.isFrozen(input.analysis_context));
  assert.ok(Object.isFrozen(input.analysis_context.documents));
  assert.ok(Object.isFrozen(input.analysis_context.documents[0]));
  assert.ok(Object.isFrozen(input.integral_v3_governance));
  assert.ok(Object.isFrozen(input.integral_v3_governance.evidenceIdentity));
  assert.ok(Object.isFrozen(input.manizales_manifest_source));

  assert.throws(() => { input.analysis_context.documents[0].id = 'mutated'; }, TypeError);
  assert.equal(input.analysis_context.documents[0].id, 'doc', 'a rejected nested mutation must leave the frozen value unchanged');
  assert.throws(() => { input.integral_v3_governance.evidenceIdentity.source_manifest_version = 'other'; }, TypeError);
  assert.equal(input.integral_v3_governance.evidenceIdentity.source_manifest_version, FIXTURE_EVIDENCE_IDENTITY.source_manifest_version);
});

// C: a NEW job always freezes company-evidence identity/asOf together, re-validated (never
// trusted verbatim) through the real fail-closed validator/parser — never one isolated from the
// other, and never an invalid shape.
test('fails closed when V3 governance is missing or carries an invalid evidence identity/asOf', () => {
  const source = createSource();
  assert.throws(() => buildAgt002FrozenEngineInput({
    ...source,
    integralV3Governance: { ...source.integralV3Governance, evidenceIdentity: undefined },
  }), /identidad de evidencia empresarial/i, 'identity missing entirely must fail closed');
  assert.throws(() => buildAgt002FrozenEngineInput({
    ...source,
    integralV3Governance: { ...source.integralV3Governance, evidenceIdentity: { ...FIXTURE_EVIDENCE_IDENTITY, source_snapshot_hash: 'not-a-hash' } },
  }), /hash/i, 'a malformed hash must fail closed');
  assert.throws(() => buildAgt002FrozenEngineInput({
    ...source,
    integralV3Governance: { ...source.integralV3Governance, evidenceAsOf: undefined },
  }), /evidenceAsOf/i, 'asOf missing entirely must fail closed');
  assert.throws(() => buildAgt002FrozenEngineInput({
    ...source,
    integralV3Governance: { ...source.integralV3Governance, evidenceAsOf: 'not-a-date' },
  }), /evidenceAsOf/i, 'an unparseable asOf must fail closed');
  assert.throws(() => buildAgt002FrozenEngineInput({ ...source, integralV3Governance: null }));
});

// Focal: canonical evidenceAsOf format is enforced exactly — not merely Date-parseable — so an
// offset, a non-midnight time or a calendar-impossible date is rejected, while the exact format
// deriveAgt002CompanyEvidenceAsOf produces is accepted.
test('rejects a non-canonical evidenceAsOf (offset, non-midnight, impossible date) and accepts the canonical form', () => {
  const source = createSource();
  assert.throws(() => buildAgt002FrozenEngineInput({
    ...source,
    integralV3Governance: { ...source.integralV3Governance, evidenceAsOf: '2026-08-29T00:00:00.000+00:00' },
  }), /evidenceAsOf/i, 'an explicit UTC offset instead of Z must fail closed');
  assert.throws(() => buildAgt002FrozenEngineInput({
    ...source,
    integralV3Governance: { ...source.integralV3Governance, evidenceAsOf: '2026-08-29T08:30:00.000Z' },
  }), /evidenceAsOf/i, 'a non-midnight time must fail closed');
  assert.throws(() => buildAgt002FrozenEngineInput({
    ...source,
    integralV3Governance: { ...source.integralV3Governance, evidenceAsOf: '2026-02-30T00:00:00.000Z' },
  }), /evidenceAsOf/i, 'a calendar-impossible date must fail closed even though Date silently rolls it over');
  assert.doesNotThrow(() => buildAgt002FrozenEngineInput({
    ...source,
    integralV3Governance: { ...source.integralV3Governance, evidenceAsOf: '2026-08-29T00:00:00.000Z' },
  }), 'the exact canonical form must be accepted');
});
