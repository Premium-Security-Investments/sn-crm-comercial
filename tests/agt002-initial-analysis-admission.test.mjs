import test from 'node:test';
import assert from 'node:assert/strict';

import {
  admitAgt002InitialAnalysis,
  computeAgt002InitialAnalysisAdmissionIdempotencyKey,
} from '../agt002-initial-analysis-admission.js';

const OPPORTUNITY_ID = '10000000-0000-4000-8000-000000000001';
const TENDER_ID = '10000000-0000-4000-8000-000000000002';
const ACTOR_ID = '10000000-0000-4000-8000-000000000003';
const DOCUMENT_ID = '10000000-0000-4000-8000-000000000004';
const EXTRACTION_ID = '10000000-0000-4000-8000-000000000005';
const PACKAGE_ID = '10000000-0000-4000-8000-000000000006';
const PACKAGE_VERSION_ID = '10000000-0000-4000-8000-000000000007';
const WORKFLOW_ID = '10000000-0000-4000-8000-000000000008';
const AUTHORIZATION_ID = '10000000-0000-4000-8000-000000000009';
const JOB_ID = '10000000-0000-4000-8000-000000000010';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const PACKAGE_HASH = 'c'.repeat(64);
const EXPIRES_AT = '2026-10-05T13:00:00.000Z';

const ENVIRONMENT = Object.freeze({
  AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED: 'true',
  AGT002_MODEL_CALLS_ENABLED: 'true',
  AGT002_INITIAL_ANALYSIS_RUNTIME_IDENTITY: 'agt002-initial-analysis-worker',
  AGT002_INITIAL_ANALYSIS_MODEL_ID: 'approved-model',
  AGT002_INITIAL_ANALYSIS_MAX_TOTAL_TOKENS: '12000',
  AGT002_INITIAL_ANALYSIS_MAX_COST_USD: '10',
  AGT002_INITIAL_ANALYSIS_TIMEOUT_MS: '30000',
  AGT002_INITIAL_ANALYSIS_REASONING_EFFORT: 'medium',
  AGT002_INITIAL_ANALYSIS_INPUT_COST_PER_MILLION_USD: '2',
  AGT002_INITIAL_ANALYSIS_OUTPUT_COST_PER_MILLION_USD: '8',
});

function fakeDatabase() {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'psi_resolve_agt002_evidence_package_candidate') {
        return { data: {
          document_version_id: DOCUMENT_ID,
          opportunity_id: OPPORTUNITY_ID,
          tender_id: TENDER_ID,
          current: true,
          content_hash: HASH_A,
          extraction_id: EXTRACTION_ID,
          extraction_text_hash: HASH_B,
          extraction_status: 'ok',
        }, error: null };
      }
      if (name === 'psi_freeze_agt002_evidence_package') {
        return { data: {
          status: 'created', package_id: PACKAGE_ID, package_version_id: PACKAGE_VERSION_ID,
          version_number: 1, batch_count: 1, member_count: 1,
          package_hash: args.p_package_hash,
          document_manifest_hash: args.p_document_manifest_hash,
          semantic_manifest_hash: args.p_semantic_manifest_hash,
        }, error: null };
      }
      if (name === 'psi_create_agt002_workflow_instance') {
        return { data: { status: 'created', workflow_instance_id: WORKFLOW_ID }, error: null };
      }
      if (name === 'psi_grant_agt002_g1_analysis_authorization') {
        return { data: { status: 'created', authorization_id: AUTHORIZATION_ID }, error: null };
      }
      if (name === 'psi_admit_authorized_agt002_initial_analysis_job') {
        return { data: {
          status: 'created', job_id: JOB_ID, opportunity_id: OPPORTUNITY_ID,
          tender_id: TENDER_ID, idempotency_key: args.p_idempotency_key,
          payload: args.p_payload, requested_by: ACTOR_ID, job_status: 'QUEUED',
        }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
}

test('admission freezes one exact package, records G1, consumes it and creates one INITIAL job', async () => {
  const database = fakeDatabase();
  const result = await admitAgt002InitialAnalysis(database, {
    opportunityId: OPPORTUNITY_ID,
    tenderId: TENDER_ID,
    actorProfileId: ACTOR_ID,
    requestedMembers: [{
      document_version_id: DOCUMENT_ID,
      source_classification: 'official',
      inclusion_reason: 'Documento oficial vigente seleccionado para el canario C1A.',
    }],
    expiresAt: EXPIRES_AT,
    policyVersion: 'agt002-initial-c1a.v1',
    environment: ENVIRONMENT,
  });

  assert.deepEqual(database.calls.map(call => call.name), [
    'psi_resolve_agt002_evidence_package_candidate',
    'psi_freeze_agt002_evidence_package',
    'psi_create_agt002_workflow_instance',
    'psi_grant_agt002_g1_analysis_authorization',
    'psi_admit_authorized_agt002_initial_analysis_job',
  ]);
  assert.equal(result.jobId, JOB_ID);
  assert.equal(result.jobStatus, 'QUEUED');
  assert.equal(result.workflowInstanceId, WORKFLOW_ID);
  assert.equal(result.authorizationId, AUTHORIZATION_ID);

  const admission = database.calls.at(-1).args;
  const freeze = database.calls.find(call => call.name === 'psi_freeze_agt002_evidence_package').args;
  assert.equal(admission.p_package_version_id, PACKAGE_VERSION_ID);
  assert.equal(admission.p_package_hash, freeze.p_package_hash);
  assert.deepEqual(admission.p_payload, {
    execution: { modelId: 'approved-model', timeoutMs: 30000, reasoningEffort: 'medium' },
    budget: {
      maxTotalTokens: 12000,
      maxCostUsd: 10,
      inputCostPerMillionUsd: 2,
      outputCostPerMillionUsd: 8,
    },
  });
});

test('admission key is deterministic and binding-sensitive', () => {
  const input = {
    workflowInstanceId: WORKFLOW_ID,
    authorizationId: AUTHORIZATION_ID,
    packageVersionId: PACKAGE_VERSION_ID,
    packageHash: PACKAGE_HASH,
    policyVersion: 'agt002-initial-c1a.v1',
  };
  const first = computeAgt002InitialAnalysisAdmissionIdempotencyKey(input);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, computeAgt002InitialAnalysisAdmissionIdempotencyKey({ ...input }));
  assert.notEqual(first, computeAgt002InitialAnalysisAdmissionIdempotencyKey({ ...input, policyVersion: 'changed' }));
});

test('admission fails closed before any RPC unless the complete runtime readback is ready', async () => {
  const database = fakeDatabase();
  await assert.rejects(
    admitAgt002InitialAnalysis(database, {
      opportunityId: OPPORTUNITY_ID,
      tenderId: TENDER_ID,
      actorProfileId: ACTOR_ID,
      requestedMembers: [{
        document_version_id: DOCUMENT_ID,
        source_classification: 'official',
        inclusion_reason: 'Canario C1A.',
      }],
      expiresAt: EXPIRES_AT,
      policyVersion: 'agt002-initial-c1a.v1',
      environment: { ...ENVIRONMENT, AGT002_MODEL_CALLS_ENABLED: 'false' },
    }),
    /runtime/i,
  );
  assert.equal(database.calls.length, 0);
});
