// AGT-002 P0-04 (RED) — initial-analysis admission/claim API gate.
//
// HTTP-orchestration half of the initial-analysis slice, mirroring the conventions of
// agt002-evidence-package-api.js: request validation + RPC error mapping, layered on top of
// ../agt002-initial-analysis-jobs.js. The wished module ../agt002-initial-analysis-api.js does
// not exist yet — that absence (ERR_MODULE_NOT_FOUND) is the RED signal below.
//
// Both AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED and AGT002_MODEL_CALLS_ENABLED are kill
// switches that default OFF: admission and claim must both fail closed unless each variable is
// present and reads exactly the string 'true' (no case-folding, no truthy coercion of '1'/'yes').
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  admitAgt002InitialAnalysisJob,
  claimAgt002InitialAnalysisJob,
} from '../agt002-initial-analysis-api.js';

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

const ENABLED = Object.freeze({ AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true', AGT002_MODEL_CALLS_ENABLED: 'true' });

const VALID_BODY = Object.freeze({
  authorization_id: 'auth-1', workflow_instance_id: 'workflow-1',
  opportunity_id: 'opp-1', tender_id: 'tender-1', package_version_id: 'package-version-1',
  package_hash: 'a'.repeat(64), g1_scope: 'A', policy_version: 'policy-v1',
  idempotency_key: 'key-1', payload: { manifest: 'v1' }, requested_by: 'user-1',
});

const ADMIT_RPC = 'psi_admit_authorized_agt002_initial_analysis_job';
const CLAIM_RPC = 'psi_claim_agt002_initial_analysis_job';

const KILL_SWITCH_CASES = [
  {},
  { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true' },
  { AGT002_MODEL_CALLS_ENABLED: 'true' },
  { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'false', AGT002_MODEL_CALLS_ENABLED: 'true' },
  { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true', AGT002_MODEL_CALLS_ENABLED: 'false' },
  { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'TRUE', AGT002_MODEL_CALLS_ENABLED: 'true' },
  { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true', AGT002_MODEL_CALLS_ENABLED: '1' },
  { AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: ' true', AGT002_MODEL_CALLS_ENABLED: 'true' },
];

for (const environment of KILL_SWITCH_CASES) {
  test(`admit fails closed with environment ${JSON.stringify(environment)}`, async () => {
    const db = fakeDb({ rpcResults: { [ADMIT_RPC]: { data: { status: 'admitted', job_id: 'job-1' }, error: null } } });
    await assert.rejects(admitAgt002InitialAnalysisJob(db, VALID_BODY, environment));
    assert.equal(db.rpcCalls.length, 0, 'the kill switch must gate before any database call');
  });

  test(`claim fails closed with environment ${JSON.stringify(environment)}`, async () => {
    const db = fakeDb({ rpcResults: { [CLAIM_RPC]: { data: { status: 'empty' }, error: null } } });
    await assert.rejects(claimAgt002InitialAnalysisJob(db, { leaseSeconds: 90 }, environment));
    assert.equal(db.rpcCalls.length, 0, 'the kill switch must gate before any database call');
  });
}

test('admit proceeds to the database once both kill switches read exactly "true"', async () => {
  const db = fakeDb({
    rpcResults: {
      [ADMIT_RPC]: {
        data: {
          status: 'admitted', job_id: 'job-1', opportunity_id: 'opp-1', tender_id: 'tender-1',
          idempotency_key: 'key-1', payload: { manifest: 'v1' }, requested_by: null, job_status: 'QUEUED',
        },
        error: null,
      },
    },
  });
  const result = await admitAgt002InitialAnalysisJob(db, VALID_BODY, ENABLED);
  assert.equal(result.status, 'admitted');
  assert.equal(result.jobId, 'job-1');
  assert.equal(db.rpcCalls.length, 1);
  assert.deepEqual(db.rpcCalls[0].args, {
    p_authorization_id: 'auth-1', p_workflow_instance_id: 'workflow-1',
    p_opportunity_id: 'opp-1', p_tender_id: 'tender-1', p_package_version_id: 'package-version-1',
    p_package_hash: 'a'.repeat(64), p_g1_scope: 'A', p_policy_version: 'policy-v1',
    p_idempotency_key: 'key-1', p_payload: { manifest: 'v1' }, p_actor_profile_id: 'user-1',
  });
});

test('claim proceeds to the database once both kill switches read exactly "true", always using the fixed worker identity', async () => {
  const db = fakeDb({ rpcResults: { [CLAIM_RPC]: { data: { status: 'empty' }, error: null } } });
  const result = await claimAgt002InitialAnalysisJob(db, { leaseSeconds: 90 }, ENABLED);
  assert.equal(result, null);
  assert.deepEqual(db.rpcCalls[0], {
    name: CLAIM_RPC,
    args: { p_worker_id: 'agt002-initial-analysis-worker', p_lease_seconds: 90 },
  });
});

test('claim never allows a caller-supplied worker identity to override the fixed one', async () => {
  const db = fakeDb({ rpcResults: { [CLAIM_RPC]: { data: { status: 'empty' }, error: null } } });
  await claimAgt002InitialAnalysisJob(db, { leaseSeconds: 90, workerId: 'someone-else' }, ENABLED);
  assert.equal(db.rpcCalls[0].args.p_worker_id, 'agt002-initial-analysis-worker', 'a request-supplied workerId must never reach the RPC');
});

test('admit rejects a request body with keys outside the closed request shape', async () => {
  const db = fakeDb();
  const body = { ...VALID_BODY, extra_field: 'nope' };
  await assert.rejects(admitAgt002InitialAnalysisJob(db, body, ENABLED));
  assert.equal(db.rpcCalls.length, 0);
});

for (const field of [
  'authorization_id', 'workflow_instance_id', 'opportunity_id', 'tender_id', 'package_version_id',
  'package_hash', 'g1_scope', 'policy_version', 'idempotency_key', 'requested_by',
]) {
  test(`admit rejects a request body missing "${field}" before any RPC call`, async () => {
    const db = fakeDb();
    const body = { ...VALID_BODY };
    delete body[field];
    await assert.rejects(admitAgt002InitialAnalysisJob(db, body, ENABLED));
    assert.equal(db.rpcCalls.length, 0);
  });
}

test('admit maps a second-active-job RPC conflict to a closed 409 without leaking raw DB text as the sole signal', async () => {
  const db = fakeDb({
    rpcResults: {
      [ADMIT_RPC]: {
        data: null,
        error: { code: '55000', status: 409, message: 'Ya existe un job AGT-002 initial-analysis activo (RUNNING) para la oportunidad' },
      },
    },
  });
  await assert.rejects(
    admitAgt002InitialAnalysisJob(db, VALID_BODY, ENABLED),
    error => error.status === 409,
  );
});

test('admit maps an already-COMPLETED-initial-job RPC conflict to a closed 409', async () => {
  const db = fakeDb({
    rpcResults: {
      [ADMIT_RPC]: {
        data: null,
        error: { code: '55001', status: 409, message: 'Ya existe un análisis inicial COMPLETED para la oportunidad' },
      },
    },
  });
  await assert.rejects(
    admitAgt002InitialAnalysisJob(db, VALID_BODY, ENABLED),
    error => error.status === 409,
  );
});

test('an exact idempotent replay is passed through as a successful result, not an error', async () => {
  const db = fakeDb({
    rpcResults: {
      [ADMIT_RPC]: {
        data: {
          status: 'existing', job_id: 'job-1', opportunity_id: 'opp-1', tender_id: 'tender-1',
          idempotency_key: 'key-1', payload: { manifest: 'v1' }, requested_by: null, job_status: 'RUNNING',
        },
        error: null,
      },
    },
  });
  const result = await admitAgt002InitialAnalysisJob(db, VALID_BODY, ENABLED);
  assert.equal(result.status, 'existing');
  assert.equal(result.jobId, 'job-1');
  assert.equal(db.rpcCalls.length, 1);
});

test('a payload mismatch under the same idempotency_key fails closed with no follow-up write', async () => {
  const db = fakeDb({ rpcResults: { [ADMIT_RPC]: { data: { status: 'payload_mismatch', job_id: 'job-1' }, error: null } } });
  await assert.rejects(admitAgt002InitialAnalysisJob(db, VALID_BODY, ENABLED));
  assert.equal(db.rpcCalls.length, 1);
});
