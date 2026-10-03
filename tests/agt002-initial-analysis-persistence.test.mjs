// AGT-002 P0-06 — initial-analysis canonical persistence adapter unit tests.
//
// Pins agt002-initial-analysis-persistence.js: schema validation first, then INITIAL-shape
// invariants, then a deterministic canonical envelope hash computed locally (never accepted from
// the caller), and only then the exact 14-param RPC call migration 100 defines. No PGlite, no
// network — database is a hand-rolled fake capturing the exact rpc(name, args) call.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  completeAgt002InitialAnalysisJob,
  AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES,
} from '../agt002-initial-analysis-persistence.js';
import { buildBaselineScopeA } from './fixtures/agt002-pre-go-analysis-v1.mjs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function expectedEnvelopeHash(envelope) {
  return createHash('sha256').update(JSON.stringify(canonicalize(envelope))).digest('hex');
}

function validEnvelope(overrides = {}) {
  const base = buildBaselineScopeA();
  return { ...base, ...overrides, meta: { ...base.meta, ...(overrides.meta || {}) } };
}

const BASE_ENVELOPE = validEnvelope();

function baseCompletion(overrides = {}) {
  return {
    workflowInstanceId: 'wf-0000-0000-0000-0000',
    authorizationId: BASE_ENVELOPE.meta.g1_authorization_id,
    packageVersionId: 'pkgver-0000-0000-0000-0000',
    packageHash: BASE_ENVELOPE.meta.package_hash,
    g1Scope: BASE_ENVELOPE.meta.g1_scope,
    policyVersion: 'policy-v1',
    envelope: BASE_ENVELOPE,
    ...overrides,
  };
}

function fakeDatabase({ data = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data, error };
    },
  };
}

const SUCCESS_RESPONSE = { status: 'completed', job_id: 'job-1', analysis_run_id: BASE_ENVELOPE.meta.analysis_run_id, aggregate_version: 1, lineage_id: 'lineage-1' };

test('happy path: calls the RPC with the exact 14 params derived from the envelope, and a deterministic canonical hash', async () => {
  const database = fakeDatabase({ data: SUCCESS_RESPONSE });
  const completion = baseCompletion();

  const result = await completeAgt002InitialAnalysisJob(database, {
    jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, completion,
  });

  assert.equal(database.calls.length, 1);
  const { name, args } = database.calls[0];
  assert.equal(name, 'psi_complete_agt002_initial_analysis_job');
  assert.deepEqual(Object.keys(args).sort(), [
    'p_analysis_core_hash', 'p_analysis_run_id', 'p_authorization_id', 'p_envelope', 'p_envelope_hash',
    'p_fence_version', 'p_g1_scope', 'p_job_id', 'p_lease_id', 'p_package_hash', 'p_package_version_id',
    'p_policy_version', 'p_schema_version', 'p_workflow_instance_id',
  ].sort());
  assert.deepEqual(args, {
    p_job_id: 'job-1',
    p_lease_id: 'lease-1',
    p_fence_version: 1,
    p_analysis_run_id: BASE_ENVELOPE.meta.analysis_run_id,
    p_workflow_instance_id: completion.workflowInstanceId,
    p_authorization_id: completion.authorizationId,
    p_package_version_id: completion.packageVersionId,
    p_package_hash: completion.packageHash,
    p_g1_scope: completion.g1Scope,
    p_analysis_core_hash: BASE_ENVELOPE.meta.analysis_core_hash,
    p_policy_version: completion.policyVersion,
    p_schema_version: BASE_ENVELOPE.meta.schema_version,
    p_envelope: BASE_ENVELOPE,
    p_envelope_hash: expectedEnvelopeHash(BASE_ENVELOPE),
  });

  assert.deepEqual(result, {
    status: 'completed', jobId: 'job-1', analysisRunId: BASE_ENVELOPE.meta.analysis_run_id, aggregateVersion: 1, lineageId: 'lineage-1',
  });
});

test('the canonical envelope hash is deterministic across key order and never taken from the caller', async () => {
  const database = fakeDatabase({ data: SUCCESS_RESPONSE });
  const reordered = JSON.parse(JSON.stringify(BASE_ENVELOPE));
  // Rebuild meta with reversed key insertion order: the hash must be key-order independent.
  const reorderedMeta = {};
  for (const key of Object.keys(reordered.meta).reverse()) reorderedMeta[key] = reordered.meta[key];
  reordered.meta = reorderedMeta;

  const completion = baseCompletion({
    envelope: reordered,
    // A caller-supplied envelopeHash-shaped field must be fully ignored; the adapter accepts no
    // such parameter at all, but this proves nothing resembling it leaks into the RPC call.
    envelopeHash: '0'.repeat(64),
  });

  await completeAgt002InitialAnalysisJob(database, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, completion });

  const { args } = database.calls[0];
  assert.equal(args.p_envelope_hash, expectedEnvelopeHash(BASE_ENVELOPE));
  assert.notEqual(args.p_envelope_hash, '0'.repeat(64));
});

test('rejects a malformed call: missing jobId/leaseId/fenceVersion/completion', async () => {
  const database = fakeDatabase({ data: SUCCESS_RESPONSE });
  for (const bad of [
    { leaseId: 'lease-1', fenceVersion: 1, completion: baseCompletion() },
    { jobId: 'job-1', fenceVersion: 1, completion: baseCompletion() },
    { jobId: 'job-1', leaseId: 'lease-1', completion: baseCompletion() },
    { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1 },
  ]) {
    await assert.rejects(
      completeAgt002InitialAnalysisJob(database, bad),
      err => err.code === AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.INVALID_CALL,
    );
  }
  assert.equal(database.calls.length, 0, 'a malformed call must never reach the RPC');
});

test('rejects a malformed completion: each required completion field is individually mandatory', async () => {
  const database = fakeDatabase({ data: SUCCESS_RESPONSE });
  for (const field of ['workflowInstanceId', 'authorizationId', 'packageVersionId', 'packageHash', 'g1Scope', 'policyVersion', 'envelope']) {
    const completion = baseCompletion({ [field]: undefined });
    await assert.rejects(
      completeAgt002InitialAnalysisJob(database, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, completion }),
      err => err.code === AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.INVALID_CALL,
      `missing completion.${field} must be rejected`,
    );
  }
  assert.equal(database.calls.length, 0);
});

test('rejects an envelope that fails pre_go_analysis.v1 schema validation', async () => {
  const database = fakeDatabase({ data: SUCCESS_RESPONSE });
  const completion = baseCompletion({ envelope: { not: 'a valid envelope' } });
  await assert.rejects(
    completeAgt002InitialAnalysisJob(database, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, completion }),
    err => err.code === AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_SCHEMA_INVALID,
  );
  assert.equal(database.calls.length, 0);
});

test('rejects an envelope whose identity fields are inconsistent with the caller-supplied bindings', async () => {
  const database = fakeDatabase({ data: SUCCESS_RESPONSE });
  const mismatches = [
    { authorizationId: 'some-other-authorization-id' },
    { g1Scope: 'A_PLUS_B' },
    { packageHash: 'f'.repeat(64) },
  ];
  for (const overrides of mismatches) {
    const completion = baseCompletion(overrides);
    await assert.rejects(
      completeAgt002InitialAnalysisJob(database, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, completion }),
      err => err.code === AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_INVARIANT_VIOLATION,
    );
  }
  assert.equal(database.calls.length, 0);
});

test('rejects an envelope at the wrong stage/version/kind for an INITIAL completion', async () => {
  const database = fakeDatabase({ data: SUCCESS_RESPONSE });
  const badMetaVariants = [
    { aggregate_stage: 'G2_RECORDED' },
    { aggregate_version: 2 },
    { analysis_kind: 'REANALYSIS', analysis_version: 2, source_analysis_run_id: BASE_ENVELOPE.meta.analysis_run_id },
    { analysis_version: 2 },
  ];
  for (const metaOverrides of badMetaVariants) {
    const completion = baseCompletion({ envelope: validEnvelope({ meta: metaOverrides }) });
    await assert.rejects(
      completeAgt002InitialAnalysisJob(database, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, completion }),
      err => err.code === AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_INVARIANT_VIOLATION
        || err.code === AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_SCHEMA_INVALID,
    );
  }
  assert.equal(database.calls.length, 0);
});

test('rejects a non-null human_decision on the first (ANALYSIS_PUBLISHED) aggregate', async () => {
  const database = fakeDatabase({ data: SUCCESS_RESPONSE });
  const completion = baseCompletion({ envelope: validEnvelope({ human_decision: { decision: 'CONTINUE' } }) });
  await assert.rejects(
    completeAgt002InitialAnalysisJob(database, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, completion }),
    err => err.code === AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_INVARIANT_VIOLATION
      || err.code === AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_SCHEMA_INVALID,
  );
  assert.equal(database.calls.length, 0);
});

test('a DB error is wrapped into a closed code and never leaks the raw database message', async () => {
  const cases = [
    { dbError: { code: '55000', message: 'raw secret detail: lease token xyz' }, expected: AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.LEASE_LOST },
    { dbError: { code: '23505', message: 'raw secret detail: duplicate key xyz' }, expected: AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ALREADY_COMPLETED },
    { dbError: { code: 'P0002', message: 'raw secret detail: row not found xyz' }, expected: AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.NOT_FOUND },
    { dbError: { code: '42501', message: 'raw secret detail: forbidden xyz' }, expected: AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.FORBIDDEN },
    { dbError: { code: '22023', message: 'raw secret detail: invalid xyz' }, expected: AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_INVARIANT_VIOLATION },
    { dbError: { code: '99999', message: 'raw secret detail: unclassified xyz' }, expected: AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.PERSISTENCE_FAILED },
  ];
  for (const { dbError, expected } of cases) {
    const database = fakeDatabase({ data: null, error: dbError });
    const completion = baseCompletion();
    await assert.rejects(
      completeAgt002InitialAnalysisJob(database, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, completion }),
      err => {
        assert.equal(err.code, expected);
        assert.doesNotMatch(err.message, /raw secret detail/);
        return true;
      },
    );
  }
});

console.log('AGT-002 initial-analysis canonical persistence adapter unit suite passed');
