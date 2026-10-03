// AGT-002 P0-05 (RED, no production change) — initial-analysis checkpoint adapter.
//
// Pins the not-yet-created `agt002-initial-analysis-checkpoints.js` module: a thin, closed
// wrapper around the (not-yet-authored) initial-analysis checkpoint RPCs, fenced by one claimed
// P0-04 job's own (jobId, leaseId, fenceVersion) — see agt002-initial-analysis-jobs.js for the
// claim/renew fence-token shape this module's callers already produce. Mirrors the conventions
// of agt002-analysis-checkpoints.js (exact snake_case param mapping in, exact camelCase result
// mapping out, raw DB messages never forwarded) but belongs to the initial-analysis slice and
// never imports, and is never imported by, any agt002-reanalysis-*.js module
// (docs/agt002/initial-analysis/CURRENT.md).
//
// The module does not exist yet — that absence is the RED signal: importing it below fails with
// ERR_MODULE_NOT_FOUND, which aborts this whole file before any test() body runs. That is the
// expected, intentional RED failure mode for this file (never a syntax error).
//
// Only mocked Supabase-shaped `{ rpc(name, params) }` clients are used below — no network, no
// PGlite, no real database, and no production module is imported here.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  AGT002_INITIAL_ANALYSIS_CHECKPOINT_PHASES,
  AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES,
  storeAgt002InitialAnalysisCheckpoint,
  loadAgt002InitialAnalysisCheckpoint,
  assertAgt002InitialAnalysisCheckpointResumable,
  resumeAgt002InitialAnalysisCheckpoint,
} from '../agt002-initial-analysis-checkpoints.js';

const IDS = Object.freeze({ job: 'job-1', lease: 'lease-1' });

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

function validStoreParams(overrides = {}) {
  const output = overrides.output ?? { memberId: 'm-1', finding: 'ok' };
  return {
    jobId: IDS.job, leaseId: IDS.lease, fenceVersion: 1,
    batchIndex: 0, phase: 'member_batch_analysis',
    requestHash: 'h'.repeat(64), output, outputSha256: canonicalSha256(output),
    usage: { totalTokens: 100 },
    ...overrides,
  };
}

function checkpointRow(overrides = {}) {
  const output = overrides.output ?? { memberId: 'm-1', finding: 'ok' };
  return {
    job_id: IDS.job, batch_index: 0, phase: 'member_batch_analysis',
    request_hash: 'h'.repeat(64), output, output_sha256: canonicalSha256(output),
    usage: { totalTokens: 100 },
    ...overrides,
  };
}

function neverCalledDatabase() {
  return { async rpc(name) { throw new Error(`must never be called (got RPC ${name})`); } };
}

test('AGT002_INITIAL_ANALYSIS_CHECKPOINT_PHASES is a closed, non-empty vocabulary', () => {
  assert.ok(Array.isArray(AGT002_INITIAL_ANALYSIS_CHECKPOINT_PHASES));
  assert.ok(AGT002_INITIAL_ANALYSIS_CHECKPOINT_PHASES.length > 0);
  assert.ok(Object.isFrozen(AGT002_INITIAL_ANALYSIS_CHECKPOINT_PHASES));
});

// ---------------------------------------------------------------------------------------------
// General store/load mapping correctness (foundation for the resume/lease-loss behavior below).
// ---------------------------------------------------------------------------------------------

test('storeAgt002InitialAnalysisCheckpoint maps to a dedicated RPC name and exact snake_case params, always carrying the fence token', async () => {
  const params = validStoreParams();
  const calls = [];
  const database = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { status: 'created', checkpoint_id: 'cp-1' }, error: null };
    },
  };
  const result = await storeAgt002InitialAnalysisCheckpoint(database, params);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].name.startsWith('psi_'));
  assert.ok(Object.hasOwn(calls[0].args, 'p_fence_version'), 'a fence-less write must never be attempted');
  assert.equal(calls[0].args.p_fence_version, 1);
  assert.equal(calls[0].args.p_job_id, IDS.job);
  assert.equal(calls[0].args.p_lease_id, IDS.lease);
  assert.equal(calls[0].args.p_batch_index, 0);
  assert.equal(calls[0].args.p_phase, 'member_batch_analysis');
  assert.deepEqual(result, { status: 'created', checkpointId: 'cp-1' });
});

test('storeAgt002InitialAnalysisCheckpoint rejects incomplete identity before any RPC call', async () => {
  for (const field of ['jobId', 'leaseId', 'fenceVersion', 'batchIndex', 'phase', 'requestHash', 'outputSha256']) {
    const params = validStoreParams({ [field]: undefined });
    await assert.rejects(
      storeAgt002InitialAnalysisCheckpoint(neverCalledDatabase(), params),
      error => {
        assert.equal(error.code, AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID);
        return true;
      },
      `expected rejection for missing ${field}`,
    );
  }
});

test('loadAgt002InitialAnalysisCheckpoint maps a found row to camelCase without interpreting output content', async () => {
  const row = checkpointRow();
  const database = { async rpc() { return { data: { checkpoint: row }, error: null }; } };
  const result = await loadAgt002InitialAnalysisCheckpoint(database, { jobId: IDS.job, batchIndex: 0, phase: 'member_batch_analysis' });
  assert.deepEqual(result, {
    jobId: row.job_id, batchIndex: row.batch_index, phase: row.phase,
    requestHash: row.request_hash, output: row.output, outputSha256: row.output_sha256, usage: row.usage,
  });
});

test('loadAgt002InitialAnalysisCheckpoint returns null when no checkpoint row exists yet', async () => {
  const database = { async rpc() { return { data: { checkpoint: null }, error: null }; } };
  const result = await loadAgt002InitialAnalysisCheckpoint(database, { jobId: IDS.job, batchIndex: 0, phase: 'member_batch_analysis' });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------------------------
// 3) resume from invalid checkpoint (wrong job, wrong batch, wrong phase, or hash mismatch)
//    fails closed.
// ---------------------------------------------------------------------------------------------

test('assertAgt002InitialAnalysisCheckpointResumable passes silently when every bound field agrees', () => {
  const checkpoint = { jobId: IDS.job, batchIndex: 2, phase: 'member_batch_analysis', requestHash: 'h'.repeat(64) };
  assert.doesNotThrow(() => assertAgt002InitialAnalysisCheckpointResumable({
    checkpoint, expectedJobId: IDS.job, expectedBatchIndex: 2, expectedPhase: 'member_batch_analysis', expectedRequestHash: 'h'.repeat(64),
  }));
});

test('assertAgt002InitialAnalysisCheckpointResumable fails closed on a wrong job, wrong batch, wrong phase, or a request hash mismatch', () => {
  const expected = { expectedJobId: IDS.job, expectedBatchIndex: 0, expectedPhase: 'member_batch_analysis', expectedRequestHash: 'h'.repeat(64) };
  const base = { jobId: IDS.job, batchIndex: 0, phase: 'member_batch_analysis', requestHash: 'h'.repeat(64) };
  const mismatches = [
    { ...base, jobId: 'job-other' },
    { ...base, batchIndex: 1 },
    { ...base, phase: 'synthesis' },
    { ...base, requestHash: 'f'.repeat(64) },
  ];
  for (const checkpoint of mismatches) {
    assert.throws(
      () => assertAgt002InitialAnalysisCheckpointResumable({ checkpoint, ...expected }),
      error => {
        assert.equal(error.code, AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES.RESUME_INVALID);
        return true;
      },
      `expected rejection for checkpoint ${JSON.stringify(checkpoint)}`,
    );
  }
});

test('resumeAgt002InitialAnalysisCheckpoint fails closed on a mismatched persisted row rather than silently reusing it', async () => {
  const row = checkpointRow({ phase: 'synthesis' });
  const database = { async rpc() { return { data: { checkpoint: row }, error: null }; } };
  await assert.rejects(
    resumeAgt002InitialAnalysisCheckpoint(database, {
      expectedJobId: IDS.job, expectedBatchIndex: 0, expectedPhase: 'member_batch_analysis', expectedRequestHash: 'h'.repeat(64),
    }),
    error => {
      assert.equal(error.code, AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES.RESUME_INVALID);
      return true;
    },
  );
});

test('resumeAgt002InitialAnalysisCheckpoint returns null (nothing to resume) when no row exists, never throwing', async () => {
  const database = { async rpc() { return { data: { checkpoint: null }, error: null }; } };
  const result = await resumeAgt002InitialAnalysisCheckpoint(database, {
    expectedJobId: IDS.job, expectedBatchIndex: 0, expectedPhase: 'member_batch_analysis', expectedRequestHash: 'h'.repeat(64),
  });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------------------------
// 4) provider response after lost lease/stale fence is discarded, never persisted.
// 5) partial persistence (checkpoint write fails mid-run) does not complete the job (checkpoint
//    layer: the write call itself never resolves as a success on a lease/fence loss or on an
//    unclassified persistence failure).
// ---------------------------------------------------------------------------------------------

test('storeAgt002InitialAnalysisCheckpoint fails closed with a dedicated lease-lost code on a stale fence, discarding the output rather than persisting it, never leaking the raw DB message', async () => {
  const database = {
    async rpc() {
      return { data: null, error: { code: '55000', message: 'raw database detail: fence 1 superseded by fence 3' } };
    },
  };
  await assert.rejects(
    storeAgt002InitialAnalysisCheckpoint(database, validStoreParams()),
    error => {
      assert.equal(error.code, AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES.LEASE_LOST);
      assert.doesNotMatch(String(error.message), /fence 1 superseded/);
      return true;
    },
  );
});

test('storeAgt002InitialAnalysisCheckpoint fails closed with a sanitized code on an unclassified persistence failure, never returning a success and never leaking the raw DB message', async () => {
  const database = {
    async rpc() { return { data: null, error: { code: '53300', message: 'raw database detail: connection pool exhausted' } }; },
  };
  await assert.rejects(
    storeAgt002InitialAnalysisCheckpoint(database, validStoreParams()),
    error => {
      assert.equal(error.code, AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES.PERSISTENCE_FAILED);
      assert.doesNotMatch(String(error.message), /connection pool exhausted/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Reanalysis decoupling (docs/agt002/initial-analysis/CURRENT.md, guard category 6).
// ---------------------------------------------------------------------------------------------

test('agt002-initial-analysis-checkpoints.js never imports a reanalysis operational module', () => {
  const source = readFileSync(new URL('../agt002-initial-analysis-checkpoints.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /agt002-reanalysis-(api|jobs|worker|input|executor|error-message)\.js/);
});
