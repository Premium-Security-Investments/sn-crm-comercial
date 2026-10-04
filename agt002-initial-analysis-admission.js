import { createHash } from 'node:crypto';

import { freezeAgt002EvidencePackage } from './agt002-evidence-package-api.js';
import {
  computeAgt002WorkflowInstanceIdempotencyKey,
  normalizeAgt002WorkflowScopeSnapshot,
} from './agt002-initial-workflow.js';
import { computeAgt002AnalysisAuthorizationIdempotencyKey } from './agt002-analysis-authorizations.js';
import { admitAgt002InitialAnalysisJob } from './agt002-initial-analysis-api.js';
import { readAgt002InitialAnalysisRuntimeConfig } from './agt002-initial-analysis-observability.js';

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requireNonBlank(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} es obligatorio.`);
  return value;
}

async function rpc(database, name, args) {
  const { data, error } = await database.rpc(name, args);
  if (error) {
    const wrapped = new Error(error.message || `Falló ${name}.`);
    if (error.code != null) wrapped.code = error.code;
    if (error.status != null) wrapped.status = error.status;
    throw wrapped;
  }
  return data;
}

export function computeAgt002InitialAnalysisAdmissionIdempotencyKey({
  workflowInstanceId, authorizationId, packageVersionId, packageHash, policyVersion,
}) {
  return hash({
    kind: 'agt002_initial_analysis_admission',
    workflowInstanceId,
    authorizationId,
    packageVersionId,
    packageHash,
    policyVersion,
  });
}

/**
 * Bounded C1A admission transaction chain for one exact opportunity and an explicit governed
 * document selection. Each database boundary is independently idempotent; the final admission
 * RPC atomically consumes G1 and creates the INITIAL job. This function never claims or executes
 * the job and never touches the REANALYSIS queue.
 */
export async function admitAgt002InitialAnalysis(database, {
  opportunityId,
  tenderId,
  actorProfileId,
  requestedMembers,
  scope = 'A',
  profileSnapshotId = null,
  profileSnapshotHash = null,
  expiresAt,
  policyVersion,
  environment = {},
} = {}) {
  requireNonBlank(opportunityId, 'La oportunidad');
  requireNonBlank(tenderId, 'La licitación');
  requireNonBlank(actorProfileId, 'El actor');
  requireNonBlank(expiresAt, 'La expiración G1');
  requireNonBlank(policyVersion, 'La versión de política');
  if (!Number.isFinite(Date.parse(expiresAt))) throw new Error('La expiración G1 no es válida.');

  const runtime = readAgt002InitialAnalysisRuntimeConfig(environment);
  if (!runtime.runtimeReady) {
    throw new Error('El runtime INITIAL no está listo para admitir un job.');
  }
  const normalizedScope = normalizeAgt002WorkflowScopeSnapshot({
    scope,
    profileSnapshotId,
    profileSnapshotHash,
  });

  const frozen = await freezeAgt002EvidencePackage(database, {
    opportunityId,
    tenderId,
    actorProfileId,
    requestedMembers,
  });

  const workflowIdempotencyKey = computeAgt002WorkflowInstanceIdempotencyKey({
    opportunityId,
    tenderId,
    workflowType: 'INITIAL',
    scope: normalizedScope.scope,
    profileSnapshotHash: normalizedScope.profileSnapshotHash,
    requestedBy: actorProfileId,
  });
  const workflow = await rpc(database, 'psi_create_agt002_workflow_instance', {
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_workflow_type: 'INITIAL',
    p_scope: normalizedScope.scope,
    p_profile_snapshot_id: normalizedScope.profileSnapshotId,
    p_profile_snapshot_hash: normalizedScope.profileSnapshotHash,
    p_idempotency_key: workflowIdempotencyKey,
    p_actor_profile_id: actorProfileId,
  });
  const workflowInstanceId = workflow?.workflow_instance_id;
  requireNonBlank(workflowInstanceId, 'La instancia INITIAL creada');

  const authorizationIdempotencyKey = computeAgt002AnalysisAuthorizationIdempotencyKey({
    workflowInstanceId,
    packageVersionId: frozen.package_version_id,
    packageHash: frozen.package_hash,
    expiresAt,
  });
  const authorization = await rpc(database, 'psi_grant_agt002_g1_analysis_authorization', {
    p_workflow_instance_id: workflowInstanceId,
    p_package_version_id: frozen.package_version_id,
    p_package_hash: frozen.package_hash,
    p_expires_at: expiresAt,
    p_idempotency_key: authorizationIdempotencyKey,
    p_actor_profile_id: actorProfileId,
  });
  const authorizationId = authorization?.authorization_id;
  requireNonBlank(authorizationId, 'La autorización G1 creada');

  const admissionIdempotencyKey = computeAgt002InitialAnalysisAdmissionIdempotencyKey({
    workflowInstanceId,
    authorizationId,
    packageVersionId: frozen.package_version_id,
    packageHash: frozen.package_hash,
    policyVersion,
  });
  const job = await admitAgt002InitialAnalysisJob(database, {
    authorization_id: authorizationId,
    workflow_instance_id: workflowInstanceId,
    opportunity_id: opportunityId,
    tender_id: tenderId,
    package_version_id: frozen.package_version_id,
    package_hash: frozen.package_hash,
    g1_scope: normalizedScope.scope,
    policy_version: policyVersion,
    idempotency_key: admissionIdempotencyKey,
    payload: {
      execution: {
        modelId: runtime.modelId,
        timeoutMs: runtime.timeoutMs,
        reasoningEffort: runtime.reasoningEffort,
      },
      budget: {
        maxTotalTokens: runtime.maxTotalTokens,
        maxCostUsd: runtime.maxCostUsd,
        inputCostPerMillionUsd: runtime.inputCostPerMillionUsd,
        outputCostPerMillionUsd: runtime.outputCostPerMillionUsd,
      },
    },
    requested_by: actorProfileId,
  }, environment);

  return Object.freeze({
    packageVersionId: frozen.package_version_id,
    packageHash: frozen.package_hash,
    workflowInstanceId,
    authorizationId,
    jobId: job.jobId,
    jobStatus: job.jobStatus,
    admissionStatus: job.status,
  });
}
