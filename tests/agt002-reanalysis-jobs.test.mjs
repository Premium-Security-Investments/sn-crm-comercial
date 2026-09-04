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

function claimedLegacyBase() {
  return {
    status: 'claimed', job_id: 'job-1', lease_id: 'lease-1', lease_expires_at: '2026-08-17T00:00:00Z',
    opportunity_id: 'o-1', tender_id: 't-1', snapshot_id: 's-1', context_version_id: 'cv-1', idempotency_key: 'key-1',
    frozen_engine_input: { manifest: 'v1' }, requested_by: 'u-1',
  };
}

async function claimMapsModernBatchedShapeToCamelCase() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          ...claimedLegacyBase(),
          execution_mode: 'durable_batched_v1',
          phase: 'integral_analysis',
          completed_batch_count: 2,
          total_batch_count: 5,
          resume_count: 1,
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
    executionMode: 'durable_batched_v1', phase: 'integral_analysis',
    completedBatchCount: 2, totalBatchCount: 5, resumeCount: 1,
  });
}

// Migration 081's `phase` column is a closed-DB *operational* phase vocabulary
// ('semantic_discovery', 'integral_analysis', 'merge', 'finalize'), entirely distinct from
// the checkpoint `p_stage` names ('semantic_discovery_batch', 'semantic_manifest',
// 'integral_analysis_plan', 'integral_analysis_batch'). A claim for a job still in its
// first (semantic discovery) phase must map successfully to camelCase.
async function claimMapsModernPhaseSemanticDiscoveryToCamelCase() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          ...claimedLegacyBase(),
          execution_mode: 'durable_batched_v1',
          phase: 'semantic_discovery',
          completed_batch_count: 1,
          total_batch_count: 3,
          resume_count: 0,
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
    executionMode: 'durable_batched_v1', phase: 'semantic_discovery',
    completedBatchCount: 1, totalBatchCount: 3, resumeCount: 0,
  });
}

// A reclaim of an expired durable job (bounded automatic resume, migration 081) is
// returned through the same psi_claim_agt002_reanalysis_job RPC with a nonzero
// resume_count and whatever operational phase/counters the earlier checkpoint left behind.
async function claimMapsModernReclaimIntegralAnalysisToCamelCase() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          ...claimedLegacyBase(),
          execution_mode: 'durable_batched_v1',
          phase: 'integral_analysis',
          completed_batch_count: 3,
          total_batch_count: 5,
          resume_count: 2,
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
    executionMode: 'durable_batched_v1', phase: 'integral_analysis',
    completedBatchCount: 3, totalBatchCount: 5, resumeCount: 2,
  });
}

// 'merge' and 'finalize' are the two remaining phases in migration 081's closed DB phase
// vocabulary and must be accepted exactly like 'semantic_discovery'/'integral_analysis'.
async function claimAcceptsMergeAndFinalizePhases() {
  for (const phase of ['merge', 'finalize']) {
    const db = fakeDb({
      rpcResults: {
        psi_claim_agt002_reanalysis_job: {
          data: {
            ...claimedLegacyBase(),
            execution_mode: 'durable_batched_v1', phase,
            completed_batch_count: 4, total_batch_count: 5, resume_count: 1,
          },
          error: null,
        },
      },
    });
    const claim = await claimAgt002ReanalysisJob(db);
    assert.equal(claim.phase, phase, `phase "${phase}" from the closed DB vocabulary must be accepted`);
    assert.equal(claim.completedBatchCount, 4);
    assert.equal(claim.totalBatchCount, 5);
    assert.equal(claim.resumeCount, 1);
  }
}

// Checkpoint p_stage names are a distinct closed vocabulary (migration 081) from the job's
// phase column and must never be accepted as a claim's operational phase.
async function claimRejectsCheckpointStageNamesAsMalformedClaimPhase() {
  const checkpointStageNames = [
    'semantic_discovery_batch', 'semantic_manifest', 'integral_analysis_plan', 'integral_analysis_batch',
  ];
  for (const phase of checkpointStageNames) {
    const db = fakeDb({
      rpcResults: {
        psi_claim_agt002_reanalysis_job: {
          data: {
            ...claimedLegacyBase(),
            execution_mode: 'durable_batched_v1', phase,
            completed_batch_count: 2, total_batch_count: 5, resume_count: 1,
          },
          error: null,
        },
      },
    });
    await assert.rejects(
      claimAgt002ReanalysisJob(db),
      `checkpoint stage name "${phase}" must never be accepted as a claim phase`,
    );
  }
}

async function claimAcceptsNullPhaseInModernShape() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          ...claimedLegacyBase(),
          execution_mode: 'durable_batched_v1', phase: null,
          completed_batch_count: 2, total_batch_count: 5, resume_count: 1,
        },
        error: null,
      },
    },
  });
  const claim = await claimAgt002ReanalysisJob(db);
  assert.equal(claim.phase, null, 'a null phase is an allowed value, not malformed metadata');
  assert.equal(claim.executionMode, 'durable_batched_v1');
  assert.equal(claim.completedBatchCount, 2);
  assert.equal(claim.totalBatchCount, 5);
  assert.equal(claim.resumeCount, 1);
}

async function claimNeverDerivesIdempotencyKeyFromIdentityFields() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          ...claimedLegacyBase(),
          idempotency_key: 'opaque-server-key-unrelated-to-identity-fields',
          execution_mode: 'durable_batched_v1', phase: 'integral_analysis',
          completed_batch_count: 2, total_batch_count: 5, resume_count: 1,
        },
        error: null,
      },
    },
  });
  const claim = await claimAgt002ReanalysisJob(db);
  assert.equal(
    claim.idempotencyKey,
    'opaque-server-key-unrelated-to-identity-fields',
    'the adapter must pass idempotency_key through verbatim and never derive/recompute it',
  );
}

async function claimRejectsUnknownExecutionMode() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          ...claimedLegacyBase(),
          execution_mode: 'bogus_mode', phase: 'integral_analysis_batch',
          completed_batch_count: 2, total_batch_count: 5, resume_count: 1,
        },
        error: null,
      },
    },
  });
  await assert.rejects(claimAgt002ReanalysisJob(db), 'an unrecognized execution_mode must fail closed');
}

async function claimRejectsUnknownPhase() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          ...claimedLegacyBase(),
          execution_mode: 'durable_batched_v1', phase: 'bogus_phase',
          completed_batch_count: 2, total_batch_count: 5, resume_count: 1,
        },
        error: null,
      },
    },
  });
  await assert.rejects(claimAgt002ReanalysisJob(db), 'an unrecognized phase must fail closed');
}

async function claimRejectsNegativeOrNonIntegerCounters() {
  const overridesCases = [
    { completed_batch_count: -1, total_batch_count: 5, resume_count: 1 },
    { completed_batch_count: 2, total_batch_count: -5, resume_count: 1 },
    { completed_batch_count: 2, total_batch_count: 5, resume_count: -1 },
    { completed_batch_count: 1.5, total_batch_count: 5, resume_count: 1 },
    { completed_batch_count: 2, total_batch_count: 5.5, resume_count: 1 },
    { completed_batch_count: 2, total_batch_count: 5, resume_count: 1.5 },
  ];
  for (const overrides of overridesCases) {
    const db = fakeDb({
      rpcResults: {
        psi_claim_agt002_reanalysis_job: {
          data: {
            ...claimedLegacyBase(),
            execution_mode: 'durable_batched_v1', phase: 'integral_analysis_batch',
            ...overrides,
          },
          error: null,
        },
      },
    });
    await assert.rejects(
      claimAgt002ReanalysisJob(db),
      `negative/non-integer batch counters must fail closed: ${JSON.stringify(overrides)}`,
    );
  }
}

async function claimRejectsCompletedBatchCountAboveTotal() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          ...claimedLegacyBase(),
          execution_mode: 'durable_batched_v1', phase: 'integral_analysis_batch',
          completed_batch_count: 6, total_batch_count: 5, resume_count: 1,
        },
        error: null,
      },
    },
  });
  await assert.rejects(claimAgt002ReanalysisJob(db), 'completed_batch_count exceeding total_batch_count must fail closed');
}

async function claimRejectsResumeCountAboveClosedCap() {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_reanalysis_job: {
        data: {
          ...claimedLegacyBase(),
          execution_mode: 'durable_batched_v1', phase: 'integral_analysis_batch',
          completed_batch_count: 2, total_batch_count: 5, resume_count: 6,
        },
        error: null,
      },
    },
  });
  await assert.rejects(claimAgt002ReanalysisJob(db), 'resume_count above the closed cap of 5 must fail closed');
}

async function claimRejectsPartialModernMetadata() {
  const fullOverrides = {
    execution_mode: 'durable_batched_v1', phase: 'integral_analysis_batch',
    completed_batch_count: 2, total_batch_count: 5, resume_count: 1,
  };
  const requiredProgressFields = ['phase', 'completed_batch_count', 'total_batch_count', 'resume_count'];
  for (const field of requiredProgressFields) {
    const overrides = { ...fullOverrides };
    delete overrides[field];
    const db = fakeDb({
      rpcResults: {
        psi_claim_agt002_reanalysis_job: {
          data: { ...claimedLegacyBase(), ...overrides },
          error: null,
        },
      },
    });
    await assert.rejects(
      claimAgt002ReanalysisJob(db),
      `execution_mode present without "${field}" must fail closed, never partially applied`,
    );
  }
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
  await claimMapsModernBatchedShapeToCamelCase();
  await claimMapsModernPhaseSemanticDiscoveryToCamelCase();
  await claimMapsModernReclaimIntegralAnalysisToCamelCase();
  await claimAcceptsMergeAndFinalizePhases();
  await claimRejectsCheckpointStageNamesAsMalformedClaimPhase();
  await claimAcceptsNullPhaseInModernShape();
  await claimNeverDerivesIdempotencyKeyFromIdentityFields();
  await claimRejectsUnknownExecutionMode();
  await claimRejectsUnknownPhase();
  await claimRejectsNegativeOrNonIntegerCounters();
  await claimRejectsCompletedBatchCountAboveTotal();
  await claimRejectsResumeCountAboveClosedCap();
  await claimRejectsPartialModernMetadata();
  await claimReturnsNullOnlyForEmptyStatusNotForOtherNonClaimedStatuses();
  await claimThrowsOnMalformedClaimedResponse();
  await completeMapsParamsAndReturnsCamelCase();
  await completeRejectsMissingAnalysisRunId();
  await failRejectsCodesOutsideTheClosedSetBeforeAnyRpcCall();
  await failNeverAcceptsAFreeTextMessageParameter();
  console.log('agt002-reanalysis-jobs adapter passed');
}
run();
