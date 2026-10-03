// AGT-002 P0-04 (RED) — initial-analysis jobs adapter.
//
// This is the neutral initial-analysis queue adapter (docs/agt002/initial-analysis/CURRENT.md):
// it must never mention or import the reanalysis operational surface (agt002-reanalysis-*.js
// modules, psi_agt002_reanalysis_jobs, or any psi_*_agt002_reanalysis_* RPC), and its admitted
// job shape carries no source_analysis_run_id — this is the FIRST run for an opportunity, not a
// re-run of one. The wished module ../agt002-initial-analysis-jobs.js does not exist yet: that
// absence (ERR_MODULE_NOT_FOUND) is the RED signal for every test below.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  AGT002_INITIAL_ANALYSIS_WORKER_ID,
  AGT002_INITIAL_ANALYSIS_ACTIVE_JOB_STATUSES,
  isAgt002InitialAnalysisJobStatusActive,
  admitAgt002InitialAnalysisJob,
  claimAgt002InitialAnalysisJob,
  renewAgt002InitialAnalysisJobLease,
  failAgt002InitialAnalysisJob,
} from '../agt002-initial-analysis-jobs.js';

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

const IDENTITY = Object.freeze({
  authorizationId: 'auth-1', workflowInstanceId: 'workflow-1',
  opportunityId: 'opp-1', tenderId: 'tender-1', packageVersionId: 'package-version-1',
  packageHash: 'a'.repeat(64), g1Scope: 'A', policyVersion: 'policy-v1',
  idempotencyKey: 'key-1', payload: { manifest: 'v1' }, requestedBy: 'user-1',
});

// --- Source coupling / shape guard (static, mirrors scripts/agt002_initial_analysis_guard.mjs) ---

test('the jobs module source never references the reanalysis operational surface', () => {
  const source = readFileSync(new URL('../agt002-initial-analysis-jobs.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /agt002-reanalysis-(api|jobs|worker|input|executor|error-message)\.js/);
  assert.doesNotMatch(source, /psi_agt002_reanalysis_jobs/);
  assert.doesNotMatch(source, /psi_(create|claim|complete|fail)_agt002_reanalysis_job/);
  assert.doesNotMatch(source, /source_analysis_run_id/, 'an initial-analysis job is never framed as re-running a prior source run');
});

// --- Status vocabulary ---

test('QUEUED, CLAIMED, RUNNING and NEEDS_ATTENTION are active; COMPLETED and FAILED are not', () => {
  for (const status of ['QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION']) {
    assert.equal(isAgt002InitialAnalysisJobStatusActive(status), true, status);
    assert.ok(AGT002_INITIAL_ANALYSIS_ACTIVE_JOB_STATUSES.includes(status), status);
  }
  for (const status of ['COMPLETED', 'FAILED', 'bogus', null, undefined]) {
    assert.equal(isAgt002InitialAnalysisJobStatusActive(status), false, String(status));
  }
});

// --- admit ---

test('authorized admit maps every G1/job binding to one atomic RPC and returns camelCase on a fresh admission', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_admit_authorized_agt002_initial_analysis_job: {
        data: {
          status: 'admitted', job_id: 'job-1', opportunity_id: 'opp-1', tender_id: 'tender-1',
          idempotency_key: 'key-1', payload: { manifest: 'v1' }, requested_by: 'user-1', job_status: 'QUEUED',
        },
        error: null,
      },
    },
  });
  const result = await admitAgt002InitialAnalysisJob(db, IDENTITY);
  assert.deepEqual(db.rpcCalls[0], {
    name: 'psi_admit_authorized_agt002_initial_analysis_job',
    args: {
      p_authorization_id: 'auth-1', p_workflow_instance_id: 'workflow-1',
      p_opportunity_id: 'opp-1', p_tender_id: 'tender-1', p_package_version_id: 'package-version-1',
      p_package_hash: 'a'.repeat(64), p_g1_scope: 'A', p_policy_version: 'policy-v1',
      p_idempotency_key: 'key-1', p_payload: { manifest: 'v1' }, p_actor_profile_id: 'user-1',
    },
  });
  assert.deepEqual(result, {
    status: 'admitted', jobId: 'job-1', opportunityId: 'opp-1', tenderId: 'tender-1',
    idempotencyKey: 'key-1', payload: { manifest: 'v1' }, requestedBy: 'user-1', jobStatus: 'QUEUED',
  });
});

test('admit rejects an incomplete authorization/job identity before any RPC call', async () => {
  for (const field of [
    'authorizationId', 'workflowInstanceId', 'opportunityId', 'tenderId', 'packageVersionId',
    'packageHash', 'g1Scope', 'policyVersion', 'idempotencyKey', 'requestedBy',
  ]) {
    const db = fakeDb();
    const bad = { ...IDENTITY, [field]: '' };
    await assert.rejects(admitAgt002InitialAnalysisJob(db, bad), `missing ${field} must fail closed`);
    assert.equal(db.rpcCalls.length, 0, `missing ${field} must never reach the database`);
  }
});

test('an exact idempotent replay returns the original job, not an error', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_admit_authorized_agt002_initial_analysis_job: {
        data: {
          status: 'existing', job_id: 'job-1', opportunity_id: 'opp-1', tender_id: 'tender-1',
          idempotency_key: 'key-1', payload: { manifest: 'v1' }, requested_by: 'user-1', job_status: 'RUNNING',
        },
        error: null,
      },
    },
  });
  const result = await admitAgt002InitialAnalysisJob(db, IDENTITY);
  assert.deepEqual(result, {
    status: 'existing', jobId: 'job-1', opportunityId: 'opp-1', tenderId: 'tender-1',
    idempotencyKey: 'key-1', payload: { manifest: 'v1' }, requestedBy: 'user-1', jobStatus: 'RUNNING',
  });
  assert.equal(db.rpcCalls.length, 1, 'an idempotent replay is a single read-mapping call, not a retry loop');
});

test('a payload mismatch under the same idempotency key fails closed without mutation', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_admit_authorized_agt002_initial_analysis_job: {
        data: { status: 'payload_mismatch', job_id: 'job-1' },
        error: null,
      },
    },
  });
  await assert.rejects(admitAgt002InitialAnalysisJob(db, IDENTITY), 'a payload mismatch must never be returned as if it were a successful admission');
  assert.equal(db.rpcCalls.length, 1, 'a payload mismatch must not trigger any follow-up write');
});

for (const activeStatus of AGT002_INITIAL_ANALYSIS_ACTIVE_JOB_STATUSES) {
  test(`admit rejects a second active job for the same opportunity (existing status ${activeStatus})`, async () => {
    const db = fakeDb({
      rpcResults: {
        psi_admit_authorized_agt002_initial_analysis_job: {
          data: null,
          error: { code: '55000', status: 409, message: `Ya existe un job AGT-002 initial-analysis activo (${activeStatus}) para la oportunidad` },
        },
      },
    });
    await assert.rejects(
      admitAgt002InitialAnalysisJob(db, IDENTITY),
      error => error.code === '55000' && error.status === 409 && error.message.includes(activeStatus),
    );
    assert.equal(db.rpcCalls.length, 1);
  });
}

test('admit rejects when a COMPLETED initial job already exists for the opportunity (canonical-run proxy until P0-06)', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_admit_authorized_agt002_initial_analysis_job: {
        data: null,
        error: { code: '55001', status: 409, message: 'Ya existe un análisis inicial COMPLETED para la oportunidad' },
      },
    },
  });
  await assert.rejects(
    admitAgt002InitialAnalysisJob(db, IDENTITY),
    error => error.code === '55001' && error.status === 409 && /COMPLETED/.test(error.message),
  );
  assert.equal(db.rpcCalls.length, 1);
});

// --- claim ---

test('claim rejects any worker identity other than exactly "agt002-initial-analysis-worker"', async () => {
  assert.equal(AGT002_INITIAL_ANALYSIS_WORKER_ID, 'agt002-initial-analysis-worker');
  for (const workerId of ['', null, undefined, 'agt002-reanalysis-worker', 'Agt002-Initial-Analysis-Worker', ' agt002-initial-analysis-worker', 'agt002-initial-analysis-worker ']) {
    const db = fakeDb();
    await assert.rejects(claimAgt002InitialAnalysisJob(db, { workerId, leaseSeconds: 90 }), `workerId=${JSON.stringify(workerId)} must be rejected before any RPC`);
    assert.equal(db.rpcCalls.length, 0);
  }
});

test('claim maps params and returns null on an empty queue', async () => {
  const db = fakeDb({ rpcResults: { psi_claim_agt002_initial_analysis_job: { data: { status: 'empty' }, error: null } } });
  const claim = await claimAgt002InitialAnalysisJob(db, { workerId: AGT002_INITIAL_ANALYSIS_WORKER_ID, leaseSeconds: 90 });
  assert.equal(claim, null);
  assert.deepEqual(db.rpcCalls[0], {
    name: 'psi_claim_agt002_initial_analysis_job',
    args: { p_worker_id: AGT002_INITIAL_ANALYSIS_WORKER_ID, p_lease_seconds: 90 },
  });
});

test('claim maps a claimed row to camelCase including the fencing token', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_initial_analysis_job: {
        data: {
          status: 'claimed', job_id: 'job-1', lease_id: 'lease-1', fence_version: 1, lease_expires_at: '2026-09-30T00:10:00Z',
          opportunity_id: 'opp-1', tender_id: 'tender-1', idempotency_key: 'key-1', payload: { manifest: 'v1' }, requested_by: 'user-1',
        },
        error: null,
      },
    },
  });
  const claim = await claimAgt002InitialAnalysisJob(db, { workerId: AGT002_INITIAL_ANALYSIS_WORKER_ID, leaseSeconds: 90 });
  assert.deepEqual(claim, {
    jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, leaseExpiresAt: '2026-09-30T00:10:00Z',
    opportunityId: 'opp-1', tenderId: 'tender-1', idempotencyKey: 'key-1', payload: { manifest: 'v1' }, requestedBy: 'user-1',
  });
});

test('reclaiming an expired lease returns a strictly incremented fence_version, relayed verbatim', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_claim_agt002_initial_analysis_job: {
        data: {
          status: 'claimed', job_id: 'job-1', lease_id: 'lease-2', fence_version: 3, lease_expires_at: '2026-09-30T01:00:00Z',
          opportunity_id: 'opp-1', tender_id: 'tender-1', idempotency_key: 'key-1', payload: { manifest: 'v1' }, requested_by: 'user-1',
        },
        error: null,
      },
    },
  });
  const claim = await claimAgt002InitialAnalysisJob(db, { workerId: AGT002_INITIAL_ANALYSIS_WORKER_ID, leaseSeconds: 90 });
  assert.equal(claim.fenceVersion, 3, 'a reclaim must surface the new, strictly higher fence_version untouched');
  assert.equal(claim.leaseId, 'lease-2');
});

// --- lease renewal / stale fence ---

test('renew maps params and returns the renewed lease on the current fence', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_renew_agt002_initial_analysis_job_lease: {
        data: { status: 'renewed', lease_expires_at: '2026-09-30T01:30:00Z' },
        error: null,
      },
    },
  });
  const result = await renewAgt002InitialAnalysisJobLease(db, { jobId: 'job-1', leaseId: 'lease-2', fenceVersion: 3, leaseSeconds: 90 });
  assert.deepEqual(db.rpcCalls[0], {
    name: 'psi_renew_agt002_initial_analysis_job_lease',
    args: { p_job_id: 'job-1', p_lease_id: 'lease-2', p_fence_version: 3, p_lease_seconds: 90 },
  });
  assert.deepEqual(result, { status: 'renewed', leaseExpiresAt: '2026-09-30T01:30:00Z' });
});

test('a stale fence (superseded by a newer claim) is rejected, not silently accepted', async () => {
  const db = fakeDb({ rpcResults: { psi_renew_agt002_initial_analysis_job_lease: { data: { status: 'fenced' }, error: null } } });
  await assert.rejects(
    renewAgt002InitialAnalysisJobLease(db, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, leaseSeconds: 90 }),
    'status "fenced" must never be treated as a successful renewal',
  );
  assert.equal(db.rpcCalls.length, 1, 'a stale fence must not trigger any follow-up write');
});

test('a late worker writing on a lost lease fails closed', async () => {
  const db = fakeDb({ rpcResults: { psi_renew_agt002_initial_analysis_job_lease: { data: { status: 'lost' }, error: null } } });
  await assert.rejects(renewAgt002InitialAnalysisJobLease(db, { jobId: 'job-1', leaseId: 'lease-2', fenceVersion: 3, leaseSeconds: 90 }));
  assert.equal(db.rpcCalls.length, 1);
});

// --- fail (P0-06) ---

test('fail maps params to snake_case and returns camelCase on a fresh failure', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_fail_agt002_initial_analysis_job: {
        data: { status: 'unavailable', job_id: 'job-1', error_code: 'model_call_failed' },
        error: null,
      },
    },
  });
  const result = await failAgt002InitialAnalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, errorCode: 'model_call_failed' });
  assert.deepEqual(db.rpcCalls[0], {
    name: 'psi_fail_agt002_initial_analysis_job',
    args: { p_job_id: 'job-1', p_lease_id: 'lease-1', p_fence_version: 1, p_error_code: 'model_call_failed' },
  });
  assert.deepEqual(result, { status: 'unavailable', jobId: 'job-1', errorCode: 'model_call_failed' });
});

test('an exact idempotent replay with the same error code returns the existing result', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_fail_agt002_initial_analysis_job: {
        data: { status: 'existing', job_id: 'job-1', error_code: 'lease_lost' },
        error: null,
      },
    },
  });
  const result = await failAgt002InitialAnalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, errorCode: 'lease_lost' });
  assert.deepEqual(result, { status: 'existing', jobId: 'job-1', errorCode: 'lease_lost' });
});

test('fail rejects an incomplete identity before any RPC call', async () => {
  const BASE = { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, errorCode: 'lease_lost' };
  for (const [field, badValue] of [['jobId', ''], ['leaseId', ''], ['fenceVersion', null], ['fenceVersion', 1.5], ['fenceVersion', 'one']]) {
    const db = fakeDb();
    await assert.rejects(failAgt002InitialAnalysisJob(db, { ...BASE, [field]: badValue }), `missing/invalid ${field} must fail closed`);
    assert.equal(db.rpcCalls.length, 0, `missing/invalid ${field} must never reach the database`);
  }
});

test('fail rejects any error code that is not a closed snake_case code, including raw provider/DB text', async () => {
  for (const errorCode of [
    '', 'Lease_Lost', 'lease-lost', 'lease lost', 'ab', 'a'.repeat(81),
    'Error: connection refused at line 42', 'ORA-00001: unique constraint violated',
    undefined, null, 123,
  ]) {
    const db = fakeDb();
    await assert.rejects(
      failAgt002InitialAnalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, errorCode }),
      `errorCode=${JSON.stringify(errorCode)} must be rejected before any RPC`,
    );
    assert.equal(db.rpcCalls.length, 0);
  }
});

test('fail accepts the full closed snake_case alphabet at both length extremes', async () => {
  for (const errorCode of ['abc', 'a'.repeat(80), 'model_call_failed', 'persistence_failure_v2_0']) {
    const db = fakeDb({
      rpcResults: {
        psi_fail_agt002_initial_analysis_job: { data: { status: 'unavailable', job_id: 'job-1', error_code: errorCode }, error: null },
      },
    });
    await failAgt002InitialAnalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, errorCode });
    assert.equal(db.rpcCalls.length, 1, errorCode);
  }
});

test('fail sanitizes a raw database rejection rather than relaying it verbatim', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_fail_agt002_initial_analysis_job: {
        data: null,
        error: { code: '55000', status: 409, message: 'raw postgres detail: relation "psi_x" column 7 at offset 42 leaked internal state' },
      },
    },
  });
  await assert.rejects(
    failAgt002InitialAnalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, errorCode: 'lease_lost' }),
    error => !/raw postgres detail|relation|offset 42/i.test(error.message),
  );
});

test('fail rejects a conflicting replay (database reports a different prior error code) without relaying the raw conflict detail', async () => {
  const db = fakeDb({
    rpcResults: {
      psi_fail_agt002_initial_analysis_job: {
        data: null,
        error: { code: '23505', status: 409, message: 'El job de análisis inicial ya falló con un código de error distinto.' },
      },
    },
  });
  await assert.rejects(failAgt002InitialAnalysisJob(db, { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, errorCode: 'model_call_failed' }));
});
