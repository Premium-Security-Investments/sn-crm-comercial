import { strict as assert } from 'node:assert';
import {
  createAgt002ReanalysisJob,
  claimAgt002ReanalysisJob,
  completeAgt002ReanalysisJob,
  failAgt002ReanalysisJob,
} from '../agt002-reanalysis-jobs.js';

function fakeDb({ rpcResults = {} } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const result = rpcResults[name];
      if (typeof result === 'function') return Promise.resolve(result(args));
      return Promise.resolve(result || { data: null, error: null });
    },
  };
}

async function createMapsParamsAndReturnsCamelCase() {
  const db = fakeDb({ rpcResults: { psi_create_agt002_reanalysis_job: { data: { status: 'created', job_id: 'job-1' }, error: null } } });
  const result = await createAgt002ReanalysisJob(db, {
    opportunityId: 'o-1', tenderId: 't-1', snapshotId: 's-1', contextVersionId: 'cv-1', idempotencyKey: 'key-1',
    frozenEngineInput: { manifest: 'v1' }, requestedBy: 'u-1',
  });
  assert.deepEqual(db.rpcCalls[0], {
    name: 'psi_create_agt002_reanalysis_job',
    args: {
      p_opportunity_id: 'o-1', p_tender_id: 't-1', p_snapshot_id: 's-1', p_context_version_id: 'cv-1', p_idempotency_key: 'key-1',
      p_frozen_engine_input: { manifest: 'v1' }, p_requested_by: 'u-1',
    },
  });
  assert.deepEqual(result, { status: 'created', jobId: 'job-1' });
}

async function createRejectsMissingIdentity() {
  const db = fakeDb();
  await assert.rejects(createAgt002ReanalysisJob(db, {
    opportunityId: '', tenderId: 't-1', snapshotId: 's-1', contextVersionId: 'cv-1', idempotencyKey: 'key-1', frozenEngineInput: {}, requestedBy: 'u-1',
  }));
  assert.equal(db.rpcCalls.length, 0, 'must not call the RPC with an incomplete identity');
}

async function createRejectsMissingContextVersionId() {
  const db = fakeDb();
  await assert.rejects(createAgt002ReanalysisJob(db, {
    opportunityId: 'o-1', tenderId: 't-1', snapshotId: 's-1', contextVersionId: '', idempotencyKey: 'key-1', frozenEngineInput: {}, requestedBy: 'u-1',
  }));
  assert.equal(db.rpcCalls.length, 0, 'must not call the RPC without a real context_version_id');
}

async function createPreservesRpcErrorIdentityForClosedConflictHandling() {
  const db = fakeDb({ rpcResults: { psi_create_agt002_reanalysis_job: { data: null, error: { code: '55000', status: 409, message: 'Ya existe otro trabajo AGT-002 activo para la oportunidad' } } } });
  await assert.rejects(
    createAgt002ReanalysisJob(db, {
      opportunityId: 'o-1', tenderId: 't-1', snapshotId: 's-1', contextVersionId: 'cv-1', idempotencyKey: 'key-1',
      frozenEngineInput: { manifest: 'v1' }, requestedBy: 'u-1',
    }),
    error => error.code === '55000' && error.status === 409 && /otro trabajo AGT-002 activo/.test(error.message),
  );
}

async function claimReturnsNullWhenEmpty() {
  const db = fakeDb({ rpcResults: { psi_claim_agt002_reanalysis_job: { data: { status: 'empty' }, error: null } } });
  const claim = await claimAgt002ReanalysisJob(db, { leaseSeconds: 90 });
  assert.equal(claim, null);
  assert.deepEqual(db.rpcCalls[0].args, { p_lease_seconds: 90 });
}

async function claimMapsClaimedShapeToCamelCase() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          status: 'claimed', job_id: 'job-1', lease_id: 'lease-1', lease_expires_at: '2026-08-17T00:00:00Z',
          opportunity_id: 'o-1', tender_id: 't-1', snapshot_id: 's-1', context_version_id: 'cv-1', idempotency_key: 'key-1',
          frozen_engine_input: { manifest: 'v1' }, requested_by: 'u-1',
        },
        error: null,
      },
    },
  });
  const claim = await claimAgt002ReanalysisJob(db);
  assert.deepEqual(claim, {
    jobId: 'job-1', leaseId: 'lease-1', leaseExpiresAt: '2026-08-17T00:00:00Z',
    opportunityId: 'o-1', tenderId: 't-1', snapshotId: 's-1', contextVersionId: 'cv-1', idempotencyKey: 'key-1',
    frozenEngineInput: { manifest: 'v1' }, requestedBy: 'u-1',
  });
}

async function claimReturnsNullOnlyForEmptyStatusNotForOtherNonClaimedStatuses() {
  const dbEmpty = fakeDb({ rpcResults: { psi_claim_agt002_reanalysis_job: { data: { status: 'empty' }, error: null } } });
  assert.equal(await claimAgt002ReanalysisJob(dbEmpty), null);

  const dbUnknown = fakeDb({ rpcResults: { psi_claim_agt002_reanalysis_job: { data: { status: 'bogus' }, error: null } } });
  await assert.rejects(claimAgt002ReanalysisJob(dbUnknown), 'an unrecognized status must never be silently treated as null/empty');

  const dbNull = fakeDb({ rpcResults: { psi_claim_agt002_reanalysis_job: { data: null, error: null } } });
  await assert.rejects(claimAgt002ReanalysisJob(dbNull), 'a null RPC response must never be silently treated as empty');
}

async function claimThrowsOnMalformedClaimedResponse() {
  const db = fakeDb({
    rpcResults: {
      // status says 'claimed' but the payload is missing required fields (e.g. job_id) —
      // this must never be returned to the caller as if it were a usable claim.
      psi_claim_agt002_reanalysis_job: { data: { status: 'claimed', lease_id: 'lease-1' }, error: null },
    },
  });
  await assert.rejects(claimAgt002ReanalysisJob(db));
}

async function completeMapsParamsAndReturnsCamelCase() {
  const db = fakeDb({ rpcResults: { psi_complete_agt002_reanalysis_job: { data: { status: 'completed', job_id: 'job-1', analysis_run_id: 'run-1' }, error: null } } });
  const result = await completeAgt002ReanalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', analysisRunId: 'run-1' });
  assert.deepEqual(db.rpcCalls[0], {
    name: 'psi_complete_agt002_reanalysis_job',
    args: { p_job_id: 'job-1', p_lease_id: 'lease-1', p_analysis_run_id: 'run-1' },
  });
  assert.deepEqual(result, { status: 'completed', jobId: 'job-1', analysisRunId: 'run-1' });
}

async function completeRejectsMissingAnalysisRunId() {
  const db = fakeDb();
  await assert.rejects(completeAgt002ReanalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', analysisRunId: null }));
  assert.equal(db.rpcCalls.length, 0, 'completion without a real canonical run id must never reach the RPC');
}

async function failRejectsCodesOutsideTheClosedSetBeforeAnyRpcCall() {
  const db = fakeDb();
  await assert.rejects(failAgt002ReanalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', errorCode: 'raw provider secret leak' }));
  assert.equal(db.rpcCalls.length, 0, 'a non-closed error code must never reach the database');
}

async function failNeverAcceptsAFreeTextMessageParameter() {
  const db = fakeDb({ rpcResults: { psi_fail_agt002_reanalysis_job: { data: { status: 'unavailable', job_id: 'job-1', error_code: 'timeout', error_message: 'closed message' }, error: null } } });
  const result = await failAgt002ReanalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', errorCode: 'timeout' });
  assert.deepEqual(db.rpcCalls[0], {
    name: 'psi_fail_agt002_reanalysis_job',
    args: { p_job_id: 'job-1', p_lease_id: 'lease-1', p_error_code: 'timeout' },
  });
  assert.ok(!Object.hasOwn(db.rpcCalls[0].args, 'p_error_message'), 'the wrapper must never forward a caller-supplied error message');
  assert.deepEqual(result, { status: 'unavailable', jobId: 'job-1', errorCode: 'timeout', errorMessage: 'closed message' });
}

async function run() {
  await createMapsParamsAndReturnsCamelCase();
  await createRejectsMissingIdentity();
  await createRejectsMissingContextVersionId();
  await createPreservesRpcErrorIdentityForClosedConflictHandling();
  await claimReturnsNullWhenEmpty();
  await claimMapsClaimedShapeToCamelCase();
  await claimReturnsNullOnlyForEmptyStatusNotForOtherNonClaimedStatuses();
  await claimThrowsOnMalformedClaimedResponse();
  await completeMapsParamsAndReturnsCamelCase();
  await completeRejectsMissingAnalysisRunId();
  await failRejectsCodesOutsideTheClosedSetBeforeAnyRpcCall();
  await failNeverAcceptsAFreeTextMessageParameter();
  console.log('agt002-reanalysis-jobs adapter passed');
}
run();
