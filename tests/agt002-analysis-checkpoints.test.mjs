// AGT-002 durable batched analysis — runtime checkpoint adapter (RED, no production change).
//
// Pins the JS half of Task 2 (docs/plans/2026-09-03-agt002-durable-batched-analysis.md,
// "Task 2: Runtime checkpoint adapter"): the not-yet-created `agt002-analysis-checkpoints.js`
// module that wraps migration 081's six new RPCs
// (psi_get_or_create_agt002_analysis_workset, psi_list_agt002_analysis_checkpoints,
// psi_record_agt002_analysis_checkpoint, psi_finalize_agt002_durable_batched_analysis — see
// supabase/migrations/081_agt002_durable_batched_analysis.sql and
// tests/agt002-durable-batched-analysis-migration.test.mjs for the exact SQL contract this
// module must call).
//
// The module does not exist yet — that absence is the RED signal: importing it below fails
// with ERR_MODULE_NOT_FOUND, which aborts this whole file before any test() body runs. That is
// the expected, intentional RED failure mode for this file (never a syntax error). Every
// assertion in this file is otherwise an ordinary node:test assertion, written to define the
// exact contract Task 2's implementation step must satisfy.
//
// Only mocked Supabase-shaped `{ rpc(name, params) }` clients are used below — no network, no
// environment variables, no real database, and no production module is imported here.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { classifyAgt002ReanalysisWorkerError } from '../agt002-reanalysis-worker.js';
import {
  AGT002_CHECKPOINT_STAGES,
  AGT002_CHECKPOINT_ERROR_CODES,
  computeAgt002FrozenEngineInputHash,
  assertAgt002FrozenEngineInputHashMatches,
  deriveAgt002AnalysisWorksetIdentity,
  getOrCreateAgt002AnalysisWorkset,
  listAgt002AnalysisCheckpoints,
  loadAgt002AnalysisCheckpoint,
  storeAgt002AnalysisCheckpoint,
  finalizeAgt002DurableBatchedAnalysis,
  createAgt002AnalysisCheckpointAdapter,
} from '../agt002-analysis-checkpoints.js';

const IDS = Object.freeze({
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: '55555555-5555-4555-8555-555555555555',
  contextVersion: '77777777-7777-4777-8777-777777777777',
  job: '88888888-8888-4888-8888-888888888888',
  lease: '99999999-9999-4999-8999-999999999999',
  workset: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
});

// Mirrors tender-semantic-discovery-batches.js's own `stableForHash` convention (recursively
// sorted object keys, array order preserved) — the implementation is expected to reuse this
// exact established canonicalization, not invent a second one, so hashes are reproducible
// regardless of caller-side key insertion order.
function stableForHash(value) {
  if (Array.isArray(value)) return value.map(stableForHash);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableForHash(value[key])]));
  }
  return value;
}
function canonicalSha256(value) {
  return createHash('sha256').update(JSON.stringify(stableForHash(value))).digest('hex');
}

function validIdentityInput(overrides = {}) {
  return {
    opportunityId: IDS.opportunity,
    tenderId: IDS.tender,
    snapshotId: IDS.snapshot,
    contextVersionId: IDS.contextVersion,
    idempotencyKey: 'k'.repeat(64),
    model: 'model-1',
    effort: 'medium',
    policyVersion: 'agt002-integral-v3-policy-v5',
    semanticDiscoveryPolicyVersion: 'tender-semantic-discovery.v9',
    semanticDiscoverySchemaVersion: 'tender-semantic-manifest.v3',
    semanticDiscoveryPlannerVersion: 'tender-semantic-discovery-batches.v1',
    integralAnalysisBatchPolicyVersion: 'agt002-integral-analysis-batch.v1',
    integralAnalysisBatchSchemaVersion: 'agt002-integral-analysis-batch-contract.v1',
    integralAnalysisBatchPlannerVersion: 'agt002-integral-analysis-batches.v1',
    companyEvidenceIdentity: { source_snapshot_hash: 'a'.repeat(64), preview_artifact_hash: 'b'.repeat(64), source_manifest_version: 'v0.3.1-approved-20260829' },
    legalCorpusIdentity: { legal_corpus_version_id: IDS.contextVersion, content_sha256: 'c'.repeat(64) },
    frozenEngineInputHash: 'd'.repeat(64),
    inventoryHash: null,
    snapshotHash: null,
    ...overrides,
  };
}

function checkpointRow(overrides = {}) {
  const output = overrides.output ?? { requirement_id: 'r-1' };
  return {
    checkpoint_id: 'cp-1', workset_id: IDS.workset, stage: 'integral_analysis_batch', batch_index: 0,
    request_hash: 'h'.repeat(64), stage_contract_version: 'agt002-integral-analysis-batch-contract.v1',
    output, output_sha256: canonicalSha256(output), usage: { input_tokens: 1, output_tokens: 1 },
    provider_idempotency_key: 'prov-1', created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function validStoreParams(overrides = {}) {
  const output = overrides.output ?? { requirement_id: 'r-1', findings: [] };
  const outputSha256 = overrides.outputSha256 ?? canonicalSha256(output);
  return {
    jobId: IDS.job, leaseId: IDS.lease, worksetId: IDS.workset,
    stage: 'integral_analysis_batch', batchIndex: 0,
    requestHash: 'h'.repeat(64), stageContractVersion: 'agt002-integral-analysis-batch-contract.v1',
    usage: { input_tokens: 10, output_tokens: 5 },
    providerIdempotencyKey: 'prov-key-1',
    ...overrides,
    output, outputSha256,
  };
}

function validFinalizeParams(overrides = {}) {
  return {
    jobId: IDS.job, leaseId: IDS.lease, worksetId: IDS.workset,
    snapshotId: IDS.snapshot, opportunityId: IDS.opportunity, tenderId: IDS.tender,
    result: { recommendation: 'go' }, criticalOpenCount: 0,
    idempotencyKey: 'k'.repeat(64), schemaVersion: '3.0.0', policyVersion: 'agt002-integral-v3-policy-v5',
    model: 'model-1', usage: { model: 'model-1', input_tokens: 1, output_tokens: 1 },
    contextVersionId: IDS.contextVersion, legalCorpusVersionId: null,
    ...overrides,
  };
}

function neverCalledDatabase() {
  return { async rpc(name) { throw new Error(`must never be called (got RPC ${name})`); } };
}

// ---------------------------------------------------------------------------------------------
// 1) Closed checkpoint identity: exact workset/job/lease + canonical opportunity/tender/
//    snapshot/context/idempotency identity; reject incomplete/malformed identity before any DB
//    call.
// ---------------------------------------------------------------------------------------------

test('AGT002_CHECKPOINT_STAGES matches migration 081\'s closed stage vocabulary exactly', () => {
  assert.deepEqual(
    [...AGT002_CHECKPOINT_STAGES].sort(),
    ['integral_analysis_batch', 'integral_analysis_plan', 'semantic_discovery_batch', 'semantic_manifest'].sort(),
  );
});

test('deriveAgt002AnalysisWorksetIdentity is pure: it never touches a database and rejects every incomplete/malformed bound field before returning', () => {
  const cases = [
    ['opportunityId', { opportunityId: '' }],
    ['tenderId', { tenderId: undefined }],
    ['snapshotId', { snapshotId: 123 }],
    ['contextVersionId', { contextVersionId: null }],
    ['idempotencyKey', { idempotencyKey: '' }],
    ['model', { model: '' }],
    ['effort', { effort: 'ultra-high' }],
    ['policyVersion', { policyVersion: '' }],
    ['semanticDiscoveryPolicyVersion', { semanticDiscoveryPolicyVersion: '' }],
    ['semanticDiscoverySchemaVersion', { semanticDiscoverySchemaVersion: '' }],
    ['semanticDiscoveryPlannerVersion', { semanticDiscoveryPlannerVersion: '' }],
    ['integralAnalysisBatchPolicyVersion', { integralAnalysisBatchPolicyVersion: '' }],
    ['integralAnalysisBatchSchemaVersion', { integralAnalysisBatchSchemaVersion: '' }],
    ['integralAnalysisBatchPlannerVersion', { integralAnalysisBatchPlannerVersion: '' }],
    ['frozenEngineInputHash', { frozenEngineInputHash: 'not-64-hex' }],
    ['companyEvidenceIdentity (malformed, non-null)', { companyEvidenceIdentity: { source_snapshot_hash: 'bad' } }],
    ['legalCorpusIdentity (malformed, non-null)', { legalCorpusIdentity: { legal_corpus_version_id: '', content_sha256: 'x' } }],
    ['inventoryHash/snapshotHash (one without the other)', { inventoryHash: 'a'.repeat(64), snapshotHash: null }],
  ];
  for (const [field, override] of cases) {
    assert.throws(
      () => deriveAgt002AnalysisWorksetIdentity(validIdentityInput(override)),
      error => error.code === AGT002_CHECKPOINT_ERROR_CODES.IDENTITY_INVALID,
      `${field} must fail closed with IDENTITY_INVALID before any workset identity can be derived`,
    );
  }
});

test('deriveAgt002AnalysisWorksetIdentity accepts a null companyEvidenceIdentity/legalCorpusIdentity (both are optional, absent when their governing flag is off)', () => {
  const identity = deriveAgt002AnalysisWorksetIdentity(validIdentityInput({ companyEvidenceIdentity: null, legalCorpusIdentity: null }));
  assert.equal(identity.frozenIdentity.company_evidence_identity, null);
  assert.equal(identity.frozenIdentity.legal_corpus_identity, null);
});

test('deriveAgt002AnalysisWorksetIdentity is deterministic: identical input produces byte-identical frozen identity; any single bound field changes it', () => {
  const base = deriveAgt002AnalysisWorksetIdentity(validIdentityInput());
  const again = deriveAgt002AnalysisWorksetIdentity(validIdentityInput());
  assert.deepEqual(base.frozenIdentity, again.frozenIdentity);
  assert.deepEqual(
    { opportunityId: base.opportunityId, tenderId: base.tenderId, snapshotId: base.snapshotId, contextVersionId: base.contextVersionId, idempotencyKey: base.idempotencyKey },
    { opportunityId: IDS.opportunity, tenderId: IDS.tender, snapshotId: IDS.snapshot, contextVersionId: IDS.contextVersion, idempotencyKey: 'k'.repeat(64) },
  );

  for (const [field, value] of [
    ['model', 'other-model'],
    ['effort', 'low'],
    ['policyVersion', 'other-policy'],
    ['semanticDiscoveryPolicyVersion', 'other'],
    ['integralAnalysisBatchPlannerVersion', 'other'],
    ['frozenEngineInputHash', 'e'.repeat(64)],
  ]) {
    const changed = deriveAgt002AnalysisWorksetIdentity(validIdentityInput({ [field]: value }));
    assert.notDeepEqual(changed.frozenIdentity, base.frozenIdentity, `${field} must be bound into the frozen identity`);
  }
});

test('inventory/snapshot hash bind into the frozen identity once discovery inventory exists, and default to null before it does', () => {
  const withoutInventory = deriveAgt002AnalysisWorksetIdentity(validIdentityInput());
  assert.equal(withoutInventory.frozenIdentity.inventory_hash, null);
  assert.equal(withoutInventory.frozenIdentity.snapshot_hash, null);
  const withInventory = deriveAgt002AnalysisWorksetIdentity(validIdentityInput({ inventoryHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64) }));
  assert.equal(withInventory.frozenIdentity.inventory_hash, 'a'.repeat(64));
  assert.equal(withInventory.frozenIdentity.snapshot_hash, 'b'.repeat(64));
  assert.notDeepEqual(withInventory.frozenIdentity, withoutInventory.frozenIdentity);
});

// ---------------------------------------------------------------------------------------------
// 8) The frozen workset identity is deterministically derived from and cross-checked against
//    the same frozen job input/canonical key; mismatch fails before any DB write.
// ---------------------------------------------------------------------------------------------

test('computeAgt002FrozenEngineInputHash is deterministic and key-order independent, and changes with any bound field', () => {
  const base = { schema_version: 1, engine_identity: { model: 'm', policy_version: 'p' } };
  const reordered = { engine_identity: { policy_version: 'p', model: 'm' }, schema_version: 1 };
  assert.equal(computeAgt002FrozenEngineInputHash(base), computeAgt002FrozenEngineInputHash(reordered));
  assert.match(computeAgt002FrozenEngineInputHash(base), /^[0-9a-f]{64}$/);

  const changed = { ...base, engine_identity: { ...base.engine_identity, model: 'other' } };
  assert.notEqual(computeAgt002FrozenEngineInputHash(base), computeAgt002FrozenEngineInputHash(changed));
});

test('assertAgt002FrozenEngineInputHashMatches passes silently on agreement and fails closed on mismatch before any DB write', () => {
  const frozenEngineInput = { schema_version: 1, engine_identity: { model: 'm', policy_version: 'p' } };
  const realHash = computeAgt002FrozenEngineInputHash(frozenEngineInput);
  assert.doesNotThrow(() => assertAgt002FrozenEngineInputHashMatches(realHash, frozenEngineInput));

  const tamperedInput = { ...frozenEngineInput, engine_identity: { ...frozenEngineInput.engine_identity, model: 'tampered' } };
  assert.throws(
    () => assertAgt002FrozenEngineInputHashMatches(realHash, tamperedInput),
    error => error.code === AGT002_CHECKPOINT_ERROR_CODES.IDENTITY_INVALID,
    'a workset identity whose frozenEngineInputHash disagrees with the job it claims to represent must never be handed to get-or-create',
  );
});

// ---------------------------------------------------------------------------------------------
// 2) get-or-create workset RPC exact snake_case mapping, exact reuse, created/existing states,
//    conflict/malformed response fail-closed.
// ---------------------------------------------------------------------------------------------

test('getOrCreateAgt002AnalysisWorkset maps to the exact RPC name and snake_case params', async () => {
  const identity = deriveAgt002AnalysisWorksetIdentity(validIdentityInput());
  const calls = [];
  const database = { async rpc(name, params) { calls.push({ name, params }); return { data: { status: 'created', workset_id: IDS.workset, published: false }, error: null }; } };
  const result = await getOrCreateAgt002AnalysisWorkset(database, identity);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'psi_get_or_create_agt002_analysis_workset');
  assert.deepEqual(calls[0].params, {
    p_opportunity_id: identity.opportunityId,
    p_tender_id: identity.tenderId,
    p_snapshot_id: identity.snapshotId,
    p_context_version_id: identity.contextVersionId,
    p_idempotency_key: identity.idempotencyKey,
    p_frozen_identity: identity.frozenIdentity,
  });
  assert.deepEqual(result, { status: 'created', worksetId: IDS.workset, published: false });
});

test('getOrCreateAgt002AnalysisWorkset reuses an existing workset by exact identity, mapping published verbatim', async () => {
  const identity = deriveAgt002AnalysisWorksetIdentity(validIdentityInput());
  const database = { async rpc() { return { data: { status: 'existing', workset_id: IDS.workset, published: true }, error: null }; } };
  const result = await getOrCreateAgt002AnalysisWorkset(database, identity);
  assert.deepEqual(result, { status: 'existing', worksetId: IDS.workset, published: true });
});

test('getOrCreateAgt002AnalysisWorkset fails closed on a conflicting bound-field replay, never leaking the raw DB message', async () => {
  const identity = deriveAgt002AnalysisWorksetIdentity(validIdentityInput());
  const rawLeak = `RAW_DB_LEAK_MARKER_${'x'.repeat(40)}`;
  const database = { async rpc() { return { data: null, error: { code: '23505', message: rawLeak } }; } };
  await assert.rejects(
    () => getOrCreateAgt002AnalysisWorkset(database, identity),
    error => {
      assert.equal(error.code, AGT002_CHECKPOINT_ERROR_CODES.WORKSET_PERSISTENCE_CONFLICT);
      assert.equal(String(error.message).includes(rawLeak), false, 'the raw DB message must never escape the adapter');
      assert.equal(JSON.stringify(error).includes(rawLeak), false);
      return true;
    },
  );
});

test('getOrCreateAgt002AnalysisWorkset fails closed on a malformed RPC response', async () => {
  const identity = deriveAgt002AnalysisWorksetIdentity(validIdentityInput());
  for (const malformed of [{ status: 'created' }, { status: 'bogus', workset_id: IDS.workset, published: false }, null]) {
    const database = { async rpc() { return { data: malformed, error: null }; } };
    await assert.rejects(
      () => getOrCreateAgt002AnalysisWorkset(database, identity),
      error => error.code === AGT002_CHECKPOINT_ERROR_CODES.WORKSET_RESPONSE_INVALID,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// 3) load/list checkpoint hit/miss; every loaded row treated as untrusted and passed through a
//    caller-supplied current validator/canonicalizer before reuse; invalid persisted output
//    fails closed and never becomes a hit.
// ---------------------------------------------------------------------------------------------

test('listAgt002AnalysisCheckpoints maps to the exact RPC and snake_case->camelCase rows, without interpreting output content', async () => {
  const row = checkpointRow();
  const calls = [];
  const database = { async rpc(name, params) { calls.push({ name, params }); return { data: { checkpoints: [row] }, error: null }; } };
  const rows = await listAgt002AnalysisCheckpoints(database, IDS.workset);
  assert.equal(calls[0].name, 'psi_list_agt002_analysis_checkpoints');
  assert.deepEqual(calls[0].params, { p_workset_id: IDS.workset });
  assert.deepEqual(rows, [{
    checkpointId: row.checkpoint_id, worksetId: row.workset_id, stage: row.stage, batchIndex: row.batch_index,
    requestHash: row.request_hash, stageContractVersion: row.stage_contract_version, output: row.output,
    outputSha256: row.output_sha256, usage: row.usage, providerIdempotencyKey: row.provider_idempotency_key,
    createdAt: row.created_at,
  }]);
});

test('listAgt002AnalysisCheckpoints fails closed on a malformed RPC response', async () => {
  const database = { async rpc() { return { data: { checkpoints: 'not-an-array' }, error: null }; } };
  await assert.rejects(
    () => listAgt002AnalysisCheckpoints(database, IDS.workset),
    error => error.code === AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_RESPONSE_INVALID,
  );
});

test('loadAgt002AnalysisCheckpoint reports a hit only when a matching row passes the caller-supplied current validator/canonicalizer', async () => {
  const row = checkpointRow({ output: { requirement_ids: ['r-1'] } });
  const database = { async rpc() { return { data: { checkpoints: [row] }, error: null }; } };
  const validateCalls = [];
  const canonical = Object.freeze({ requirement_ids: ['r-1'], canonicalized: true });
  const validate = output => { validateCalls.push(output); return canonical; };
  const result = await loadAgt002AnalysisCheckpoint(
    database,
    { worksetId: IDS.workset, stage: row.stage, batchIndex: row.batch_index, expectedRequestHash: row.request_hash },
    { validate },
  );
  assert.deepEqual(result, {
    hit: true, output: canonical, usage: row.usage, requestHash: row.request_hash,
    stageContractVersion: row.stage_contract_version, providerIdempotencyKey: row.provider_idempotency_key,
  });
  assert.deepEqual(validateCalls, [row.output], 'the validator must receive the raw persisted output exactly once, as untrusted input');
});

test('loadAgt002AnalysisCheckpoint reports a miss when no row exists for the exact (stage, batchIndex)', async () => {
  const database = { async rpc() { return { data: { checkpoints: [] }, error: null }; } };
  const result = await loadAgt002AnalysisCheckpoint(
    database,
    { worksetId: IDS.workset, stage: 'integral_analysis_batch', batchIndex: 0, expectedRequestHash: 'h'.repeat(64) },
    { validate: () => { throw new Error('must never be called'); } },
  );
  assert.deepEqual(result, { hit: false });
});

test('a request-hash mismatch is treated as a miss and never even reaches the current validator', async () => {
  const row = checkpointRow({ request_hash: 'h'.repeat(64) });
  const database = { async rpc() { return { data: { checkpoints: [row] }, error: null }; } };
  let validated = false;
  const result = await loadAgt002AnalysisCheckpoint(
    database,
    { worksetId: IDS.workset, stage: row.stage, batchIndex: row.batch_index, expectedRequestHash: 'i'.repeat(64) },
    { validate: () => { validated = true; return {}; } },
  );
  assert.deepEqual(result, { hit: false });
  assert.equal(validated, false, 'a stale/mismatched request_hash must never reach the current validator');
});

test('invalid persisted output (validator returns falsy) fails closed to a miss, never a hit', async () => {
  const row = checkpointRow();
  const database = { async rpc() { return { data: { checkpoints: [row] }, error: null }; } };
  const result = await loadAgt002AnalysisCheckpoint(
    database,
    { worksetId: IDS.workset, stage: row.stage, batchIndex: row.batch_index, expectedRequestHash: row.request_hash },
    { validate: () => null },
  );
  assert.deepEqual(result, { hit: false });
});

test('invalid persisted output (validator throws) fails closed to a miss, never propagates the validator error or the raw output', async () => {
  const row = checkpointRow();
  const database = { async rpc() { return { data: { checkpoints: [row] }, error: null }; } };
  const result = await loadAgt002AnalysisCheckpoint(
    database,
    { worksetId: IDS.workset, stage: row.stage, batchIndex: row.batch_index, expectedRequestHash: row.request_hash },
    { validate: () => { throw new Error('corrupt current-schema mismatch, must never surface verbatim'); } },
  );
  assert.deepEqual(result, { hit: false });
});

// ---------------------------------------------------------------------------------------------
// 4) store checkpoint RPC only receives already validated canonical JSON + SHA-256/hash/
//    version/safe usage/provider idempotency metadata; exact replay succeeds, conflict/lease
//    loss fail closed; no prompt/raw response/source text/credential/free-form provider error
//    forwarded.
// ---------------------------------------------------------------------------------------------

test('storeAgt002AnalysisCheckpoint maps to the exact RPC name and snake_case params, forwarding only safe checkpoint metadata', async () => {
  const params = validStoreParams();
  const calls = [];
  const database = { async rpc(name, rpcParams) { calls.push({ name, rpcParams }); return { data: { status: 'created', checkpoint_id: 'cp-1' }, error: null }; } };
  const result = await storeAgt002AnalysisCheckpoint(database, params);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'psi_record_agt002_analysis_checkpoint');
  assert.deepEqual(calls[0].rpcParams, {
    p_job_id: params.jobId, p_lease_id: params.leaseId, p_workset_id: params.worksetId,
    p_stage: params.stage, p_batch_index: params.batchIndex, p_request_hash: params.requestHash,
    p_stage_contract_version: params.stageContractVersion, p_output: params.output,
    p_output_sha256: params.outputSha256, p_usage: params.usage, p_provider_idempotency_key: params.providerIdempotencyKey,
  });
  assert.deepEqual(result, { status: 'created', checkpointId: 'cp-1' });
});

test('storeAgt002AnalysisCheckpoint rejects incomplete lease/workset/checkpoint identity before any RPC call', async () => {
  for (const field of ['jobId', 'leaseId', 'worksetId', 'requestHash', 'stageContractVersion', 'providerIdempotencyKey']) {
    await assert.rejects(
      () => storeAgt002AnalysisCheckpoint(neverCalledDatabase(), validStoreParams({ [field]: '' })),
      error => error.code === AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID,
      `${field} must be validated before any RPC call`,
    );
  }
});

test('storeAgt002AnalysisCheckpoint rejects an unrecognized stage before any RPC call', async () => {
  await assert.rejects(
    () => storeAgt002AnalysisCheckpoint(neverCalledDatabase(), validStoreParams({ stage: 'bogus_stage' })),
    error => error.code === AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID,
  );
});

test('storeAgt002AnalysisCheckpoint rejects a negative or non-integer batchIndex before any RPC call', async () => {
  for (const batchIndex of [-1, 1.5, 'zero', null]) {
    await assert.rejects(
      () => storeAgt002AnalysisCheckpoint(neverCalledDatabase(), validStoreParams({ batchIndex })),
      error => error.code === AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID,
    );
  }
});

test('storeAgt002AnalysisCheckpoint rejects an outputSha256 that does not match its own recomputed canonical hash, before any RPC call', async () => {
  await assert.rejects(
    () => storeAgt002AnalysisCheckpoint(neverCalledDatabase(), validStoreParams({ outputSha256: '0'.repeat(64) })),
    error => error.code === AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID,
  );
});

test('storeAgt002AnalysisCheckpoint rejects a non-object, non-null usage before any RPC call', async () => {
  await assert.rejects(
    () => storeAgt002AnalysisCheckpoint(neverCalledDatabase(), validStoreParams({ usage: 'not-an-object' })),
    error => error.code === AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID,
  );
});

test('storeAgt002AnalysisCheckpoint rejects output carrying a raw prompt/response/source/credential field at any depth, before any RPC call', async () => {
  for (const forbiddenKey of ['prompt', 'raw_output', 'raw_response', 'source_text', 'credential', 'api_key', 'secret', 'password']) {
    const output = { requirement_id: 'r-1', analysis_units: [{ requirement_id: 'r-1', nested: { [forbiddenKey]: 'leak' } }] };
    const outputSha256 = canonicalSha256(output);
    await assert.rejects(
      () => storeAgt002AnalysisCheckpoint(neverCalledDatabase(), validStoreParams({ output, outputSha256 })),
      error => error.code === AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID,
      `${forbiddenKey} must be rejected`,
    );
  }
});

test('storeAgt002AnalysisCheckpoint reuses the existing row on an exact replay', async () => {
  const params = validStoreParams();
  const database = { async rpc() { return { data: { status: 'existing', checkpoint_id: 'cp-1' }, error: null }; } };
  const result = await storeAgt002AnalysisCheckpoint(database, params);
  assert.deepEqual(result, { status: 'existing', checkpointId: 'cp-1' });
});

test('storeAgt002AnalysisCheckpoint fails closed on a conflicting payload under the same identity, never leaking the raw DB message', async () => {
  const params = validStoreParams();
  const rawLeak = `RAW_DB_LEAK_${'y'.repeat(40)}`;
  const database = { async rpc() { return { data: null, error: { code: '23505', message: rawLeak } }; } };
  await assert.rejects(
    () => storeAgt002AnalysisCheckpoint(database, params),
    error => {
      assert.equal(error.code, AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_PERSISTENCE_CONFLICT);
      assert.equal(String(error.message).includes(rawLeak), false);
      return true;
    },
  );
});

test('storeAgt002AnalysisCheckpoint fails closed with a dedicated lease-lost code, never leaking the raw DB message', async () => {
  const params = validStoreParams();
  const rawLeak = `reserva perdida ${'z'.repeat(40)}`;
  const database = { async rpc() { return { data: null, error: { code: '55000', message: rawLeak } }; } };
  await assert.rejects(
    () => storeAgt002AnalysisCheckpoint(database, params),
    error => {
      assert.equal(error.code, AGT002_CHECKPOINT_ERROR_CODES.LEASE_LOST);
      assert.equal(String(error.message).includes(rawLeak), false);
      return true;
    },
  );
});

test('storeAgt002AnalysisCheckpoint fails closed with a generic sanitized code for an unclassified RPC failure, never the raw DB message', async () => {
  const params = validStoreParams();
  const rawLeak = `RAW_DB_LEAK_${'w'.repeat(40)}`;
  const database = { async rpc() { return { data: null, error: { code: '57014', message: rawLeak } }; } };
  await assert.rejects(
    () => storeAgt002AnalysisCheckpoint(database, params),
    error => {
      assert.equal(error.code, AGT002_CHECKPOINT_ERROR_CODES.PERSISTENCE_FAILED);
      assert.equal(String(error.message).includes(rawLeak), false);
      return true;
    },
  );
});

test('storeAgt002AnalysisCheckpoint fails closed on a malformed RPC response', async () => {
  const params = validStoreParams();
  const database = { async rpc() { return { data: { status: 'created' }, error: null }; } };
  await assert.rejects(
    () => storeAgt002AnalysisCheckpoint(database, params),
    error => error.code === AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_RESPONSE_INVALID,
  );
});

// ---------------------------------------------------------------------------------------------
// 5) Deterministic, sanitized closed errors using existing allowlisted AGT-002 error codes/
//    conventions; DB/provider arbitrary message must not escape.
// ---------------------------------------------------------------------------------------------

test('every checkpoint adapter error code is a closed AGT002_CHECKPOINT_* member classifiable by the existing queue error classifier', () => {
  const expectations = {
    IDENTITY_INVALID: 'invalid_output',
    WORKSET_RESPONSE_INVALID: 'invalid_output',
    WORKSET_PERSISTENCE_CONFLICT: 'persistence_failure',
    CHECKPOINT_INVALID: 'invalid_output',
    CHECKPOINT_RESPONSE_INVALID: 'invalid_output',
    CHECKPOINT_PERSISTENCE_CONFLICT: 'persistence_failure',
    LEASE_LOST: 'lease_lost',
    FINALIZE_INVALID: 'invalid_output',
    FINALIZE_RESPONSE_INVALID: 'invalid_output',
    PERSISTENCE_FAILED: 'persistence_failure',
  };
  assert.deepEqual(Object.keys(AGT002_CHECKPOINT_ERROR_CODES).sort(), Object.keys(expectations).sort());
  for (const [key, expectedQueueCode] of Object.entries(expectations)) {
    const code = AGT002_CHECKPOINT_ERROR_CODES[key];
    assert.match(code, /^AGT002_CHECKPOINT_[A-Z0-9_]+$/, `${key} must be a closed, uppercase AGT002_CHECKPOINT_* code`);
    const error = new Error('synthetic');
    error.code = code;
    assert.equal(classifyAgt002ReanalysisWorkerError(error), expectedQueueCode, `${key} (${code}) must classify to ${expectedQueueCode}`);
  }
});

// ---------------------------------------------------------------------------------------------
// 6) Finalize adapter maps exactly to the atomic finalize RPC and validates its response
//    identity; it must not call legacy completion itself.
// ---------------------------------------------------------------------------------------------

test('finalizeAgt002DurableBatchedAnalysis maps to the exact atomic finalize RPC and snake_case params, calling no other RPC', async () => {
  const params = validFinalizeParams();
  const calls = [];
  const database = {
    async rpc(name, rpcParams) {
      calls.push({ name, rpcParams });
      return { data: { analysis_run_id: 'run-1', workset_id: IDS.workset, job_id: IDS.job }, error: null };
    },
  };
  const result = await finalizeAgt002DurableBatchedAnalysis(database, params);
  assert.deepEqual(calls.map(call => call.name), ['psi_finalize_agt002_durable_batched_analysis'], 'the adapter must call exactly one RPC: it must never separately call legacy completion');
  assert.deepEqual(calls[0].rpcParams, {
    p_job_id: params.jobId, p_lease_id: params.leaseId, p_workset_id: params.worksetId,
    p_snapshot_id: params.snapshotId, p_opportunity_id: params.opportunityId, p_tender_id: params.tenderId,
    p_result: params.result, p_critical_open_count: params.criticalOpenCount,
    p_idempotency_key: params.idempotencyKey, p_schema_version: params.schemaVersion,
    p_policy_version: params.policyVersion, p_model: params.model, p_usage: params.usage,
    p_context_version_id: params.contextVersionId, p_legal_corpus_version_id: params.legalCorpusVersionId,
  });
  assert.deepEqual(result, { analysisRunId: 'run-1', worksetId: IDS.workset, jobId: IDS.job });
});

test('finalizeAgt002DurableBatchedAnalysis never calls the legacy single-turn completion RPC, even on success', async () => {
  const params = validFinalizeParams();
  const calledNames = [];
  const database = {
    async rpc(name) {
      calledNames.push(name);
      return { data: { analysis_run_id: 'run-1', workset_id: IDS.workset, job_id: IDS.job }, error: null };
    },
  };
  await finalizeAgt002DurableBatchedAnalysis(database, params);
  assert.equal(calledNames.includes('psi_complete_agt002_reanalysis_job'), false);
});

test('finalizeAgt002DurableBatchedAnalysis rejects incomplete params before any RPC call', async () => {
  for (const field of ['jobId', 'leaseId', 'worksetId', 'snapshotId', 'opportunityId', 'tenderId', 'idempotencyKey', 'schemaVersion', 'policyVersion', 'model']) {
    await assert.rejects(
      () => finalizeAgt002DurableBatchedAnalysis(neverCalledDatabase(), validFinalizeParams({ [field]: '' })),
      error => error.code === AGT002_CHECKPOINT_ERROR_CODES.FINALIZE_INVALID,
      `${field} must be validated before any finalize RPC call`,
    );
  }
  await assert.rejects(
    () => finalizeAgt002DurableBatchedAnalysis(neverCalledDatabase(), validFinalizeParams({ result: null })),
    error => error.code === AGT002_CHECKPOINT_ERROR_CODES.FINALIZE_INVALID,
  );
  await assert.rejects(
    () => finalizeAgt002DurableBatchedAnalysis(neverCalledDatabase(), validFinalizeParams({ criticalOpenCount: -1 })),
    error => error.code === AGT002_CHECKPOINT_ERROR_CODES.FINALIZE_INVALID,
  );
});

test('finalizeAgt002DurableBatchedAnalysis validates the atomic finalize response identity, failing closed on a malformed/missing analysis_run_id', async () => {
  const params = validFinalizeParams();
  for (const malformed of [{}, { analysis_run_id: '', workset_id: IDS.workset, job_id: IDS.job }, { analysis_run_id: 'run-1' }]) {
    const database = { async rpc() { return { data: malformed, error: null }; } };
    await assert.rejects(
      () => finalizeAgt002DurableBatchedAnalysis(database, params),
      error => error.code === AGT002_CHECKPOINT_ERROR_CODES.FINALIZE_RESPONSE_INVALID,
    );
  }
});

test('finalizeAgt002DurableBatchedAnalysis fails closed on lease loss, never leaking the raw DB message', async () => {
  const params = validFinalizeParams();
  const rawLeak = `RAW_DB_LEAK_${'z'.repeat(40)}`;
  const database = { async rpc() { return { data: null, error: { code: '55000', message: rawLeak } }; } };
  await assert.rejects(
    () => finalizeAgt002DurableBatchedAnalysis(database, params),
    error => {
      assert.equal(error.code, AGT002_CHECKPOINT_ERROR_CODES.LEASE_LOST);
      assert.equal(String(error.message).includes(rawLeak), false);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 7) Executor/runtime inject checkpoint hooks ONLY for claimed jobs with
//    executionMode === 'durable_batched_v1'. Here: the composed hook factory itself.
//    (No-hook byte-equivalence for legacy/direct/Manizales paths is asserted in
//    tests/agt002-reanalysis-executor.test.mjs and tests/agt002-preview-runtime.test.mjs.)
// ---------------------------------------------------------------------------------------------

test('createAgt002AnalysisCheckpointAdapter builds loadCheckpoint/storeCheckpoint hooks fenced by the given job/lease/workset identity', async () => {
  const calls = [];
  const database = {
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'psi_list_agt002_analysis_checkpoints') return { data: { checkpoints: [] }, error: null };
      if (name === 'psi_record_agt002_analysis_checkpoint') return { data: { status: 'created', checkpoint_id: 'cp-1' }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const adapter = createAgt002AnalysisCheckpointAdapter(database, { jobId: IDS.job, leaseId: IDS.lease, worksetId: IDS.workset });
  assert.equal(typeof adapter.loadCheckpoint, 'function');
  assert.equal(typeof adapter.storeCheckpoint, 'function');

  const missResult = await adapter.loadCheckpoint({ stage: 'integral_analysis_batch', batchIndex: 0, expectedRequestHash: 'h'.repeat(64), validate: () => { throw new Error('never'); } });
  assert.deepEqual(missResult, { hit: false });
  assert.deepEqual(calls[0].params, { p_workset_id: IDS.workset });

  const output = { requirement_id: 'r-1' };
  const outputSha256 = canonicalSha256(output);
  const storeResult = await adapter.storeCheckpoint({
    stage: 'integral_analysis_batch', batchIndex: 0, requestHash: 'h'.repeat(64),
    stageContractVersion: 'agt002-integral-analysis-batch-contract.v1', output, outputSha256, usage: null, providerIdempotencyKey: 'prov-1',
  });
  assert.deepEqual(storeResult, { status: 'created', checkpointId: 'cp-1' });
  assert.deepEqual(calls[1].params, {
    p_job_id: IDS.job, p_lease_id: IDS.lease, p_workset_id: IDS.workset,
    p_stage: 'integral_analysis_batch', p_batch_index: 0, p_request_hash: 'h'.repeat(64),
    p_stage_contract_version: 'agt002-integral-analysis-batch-contract.v1', p_output: output, p_output_sha256: outputSha256,
    p_usage: null, p_provider_idempotency_key: 'prov-1',
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2 remediation (RED): the real default `createAgt002AnalysisCheckpointAdapter` currently
// requires a known `worksetId`, but `agt002-reanalysis-executor.js` calls it with
// `{ jobId, leaseId, idempotencyKey }` (no worksetId) for every claimed `durable_batched_v1`
// job — see tests/agt002-reanalysis-executor.test.mjs's mocked-DI test at
// "a durable_batched_v1 job constructs exactly one checkpoint adapter...", which passes only
// because it injects a fake `createCheckpointAdapter` and never exercises the real one. Against
// the real default adapter, construction throws synchronously and the job never even reaches a
// provider call. These tests pin the minimal plan-compatible contract (Task 2 step 2 of
// docs/plans/2026-09-03-agt002-durable-batched-analysis.md): the adapter must also accept the
// canonical `idempotencyKey` and lazily resolve `worksetId` via the already-migrated
// `psi_get_agt002_analysis_workset(p_idempotency_key)` RPC on first use, never at construction.
// ---------------------------------------------------------------------------------------------

test('createAgt002AnalysisCheckpointAdapter accepts a canonical idempotencyKey as an alternative to a known worksetId, synchronously, with zero RPC calls at construction', () => {
  let adapter;
  assert.doesNotThrow(() => {
    adapter = createAgt002AnalysisCheckpointAdapter(neverCalledDatabase(), { jobId: IDS.job, leaseId: IDS.lease, idempotencyKey: 'k'.repeat(64) });
  }, 'the real default adapter must accept an idempotencyKey-only identity without throwing during construction');
  assert.equal(typeof adapter.loadCheckpoint, 'function');
  assert.equal(typeof adapter.storeCheckpoint, 'function');
});

test('the first load/store hook lazily resolves worksetId via psi_get_agt002_analysis_workset with the exact idempotencyKey param, and uses the resolved worksetId for the checkpoint RPC', async () => {
  const idempotencyKey = 'k'.repeat(64);
  const calls = [];
  const database = {
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'psi_get_agt002_analysis_workset') {
        return { data: { workset_id: IDS.workset, idempotency_key: idempotencyKey, published: false }, error: null };
      }
      if (name === 'psi_list_agt002_analysis_checkpoints') return { data: { checkpoints: [] }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const adapter = createAgt002AnalysisCheckpointAdapter(database, { jobId: IDS.job, leaseId: IDS.lease, idempotencyKey });
  const result = await adapter.loadCheckpoint({ stage: 'integral_analysis_batch', batchIndex: 0, expectedRequestHash: 'h'.repeat(64), validate: () => { throw new Error('never'); } });
  assert.deepEqual(result, { hit: false });
  assert.equal(calls.length, 2, 'resolution then the checkpoint read, in that order');
  assert.equal(calls[0].name, 'psi_get_agt002_analysis_workset');
  assert.deepEqual(calls[0].params, { p_idempotency_key: idempotencyKey });
  assert.equal(calls[1].name, 'psi_list_agt002_analysis_checkpoints');
  assert.deepEqual(calls[1].params, { p_workset_id: IDS.workset }, 'the resolved worksetId, not the idempotencyKey, must fence the checkpoint RPC');
});

test('a resolved workset may be published or unpublished; both are accepted for a load hook', async () => {
  const idempotencyKey = 'k'.repeat(64);
  for (const published of [true, false]) {
    const database = {
      async rpc(name) {
        if (name === 'psi_get_agt002_analysis_workset') return { data: { workset_id: IDS.workset, idempotency_key: idempotencyKey, published }, error: null };
        if (name === 'psi_list_agt002_analysis_checkpoints') return { data: { checkpoints: [] }, error: null };
        throw new Error(`unexpected RPC ${name}`);
      },
    };
    const adapter = createAgt002AnalysisCheckpointAdapter(database, { jobId: IDS.job, leaseId: IDS.lease, idempotencyKey });
    const result = await adapter.loadCheckpoint({ stage: 'integral_analysis_batch', batchIndex: 0, expectedRequestHash: 'h'.repeat(64), validate: () => null });
    assert.deepEqual(result, { hit: false }, `published=${published} must resolve successfully`);
  }
});

test('the resolved worksetId is cached: a second load hook on the same adapter never calls psi_get_agt002_analysis_workset again', async () => {
  const idempotencyKey = 'k'.repeat(64);
  let getWorksetCalls = 0;
  const database = {
    async rpc(name) {
      if (name === 'psi_get_agt002_analysis_workset') {
        getWorksetCalls += 1;
        return { data: { workset_id: IDS.workset, idempotency_key: idempotencyKey, published: false }, error: null };
      }
      if (name === 'psi_list_agt002_analysis_checkpoints') return { data: { checkpoints: [] }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const adapter = createAgt002AnalysisCheckpointAdapter(database, { jobId: IDS.job, leaseId: IDS.lease, idempotencyKey });
  await adapter.loadCheckpoint({ stage: 'integral_analysis_batch', batchIndex: 0, expectedRequestHash: 'h'.repeat(64), validate: () => null });
  await adapter.loadCheckpoint({ stage: 'integral_analysis_batch', batchIndex: 1, expectedRequestHash: 'h'.repeat(64), validate: () => null });
  assert.equal(getWorksetCalls, 1, 'worksetId resolution must be cached after the first hook call');
});

test('concurrent first hook calls on the same adapter share a single in-flight worksetId resolution', async () => {
  const idempotencyKey = 'k'.repeat(64);
  let getWorksetCalls = 0;
  let releaseResolution;
  const database = {
    async rpc(name) {
      if (name === 'psi_get_agt002_analysis_workset') {
        getWorksetCalls += 1;
        await new Promise(resolve => { releaseResolution = resolve; });
        return { data: { workset_id: IDS.workset, idempotency_key: idempotencyKey, published: false }, error: null };
      }
      if (name === 'psi_list_agt002_analysis_checkpoints') return { data: { checkpoints: [] }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const adapter = createAgt002AnalysisCheckpointAdapter(database, { jobId: IDS.job, leaseId: IDS.lease, idempotencyKey });
  const first = adapter.loadCheckpoint({ stage: 'integral_analysis_batch', batchIndex: 0, expectedRequestHash: 'h'.repeat(64), validate: () => null });
  const second = adapter.loadCheckpoint({ stage: 'integral_analysis_batch', batchIndex: 1, expectedRequestHash: 'h'.repeat(64), validate: () => null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getWorksetCalls, 1, 'two concurrent first hooks must share exactly one in-flight resolution RPC, not one each');
  releaseResolution();
  await Promise.all([first, second]);
});

test('a missing/conflicting/malformed workset resolution fails closed with a sanitized closed AGT002_CHECKPOINT_* code and makes no checkpoint read/write RPC', async () => {
  const idempotencyKey = 'k'.repeat(64);
  const scenarios = [
    ['missing (RPC returns null: no workset for this idempotencyKey yet)', async () => ({ data: null, error: null })],
    ['conflicting identity (returned idempotency_key disagrees with the requested one)', async () => ({ data: { workset_id: IDS.workset, idempotency_key: 'other-key', published: false }, error: null })],
    ['malformed response (missing workset_id)', async () => ({ data: { idempotency_key: idempotencyKey, published: false }, error: null })],
  ];
  for (const [label, respond] of scenarios) {
    const calls = [];
    const database = {
      async rpc(name) {
        calls.push(name);
        if (name === 'psi_get_agt002_analysis_workset') return respond();
        throw new Error(`must never call ${name} (${label})`);
      },
    };
    const adapter = createAgt002AnalysisCheckpointAdapter(database, { jobId: IDS.job, leaseId: IDS.lease, idempotencyKey });
    await assert.rejects(
      () => adapter.loadCheckpoint({ stage: 'integral_analysis_batch', batchIndex: 0, expectedRequestHash: 'h'.repeat(64), validate: () => { throw new Error('never'); } }),
      error => {
        assert.match(error.code, /^AGT002_CHECKPOINT_[A-Z0-9_]+$/, `${label} must fail closed with a closed AGT002_CHECKPOINT_* code`);
        assert.ok(Object.values(AGT002_CHECKPOINT_ERROR_CODES).includes(error.code), `${label} code must be a member of the existing closed catalog`);
        return true;
      },
      label,
    );
    assert.deepEqual(calls, ['psi_get_agt002_analysis_workset'], `${label} must make no checkpoint read/write RPC`);
  }
});

test('an explicit worksetId path never calls psi_get_agt002_analysis_workset and stays byte-compatible with today', async () => {
  const calls = [];
  const database = {
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'psi_list_agt002_analysis_checkpoints') return { data: { checkpoints: [] }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const adapter = createAgt002AnalysisCheckpointAdapter(database, { jobId: IDS.job, leaseId: IDS.lease, worksetId: IDS.workset });
  await adapter.loadCheckpoint({ stage: 'integral_analysis_batch', batchIndex: 0, expectedRequestHash: 'h'.repeat(64), validate: () => { throw new Error('never'); } });
  assert.equal(calls.every(call => call.name !== 'psi_get_agt002_analysis_workset'), true, 'an explicit worksetId must never trigger resolution');
  assert.deepEqual(calls[0].params, { p_workset_id: IDS.workset });
});
