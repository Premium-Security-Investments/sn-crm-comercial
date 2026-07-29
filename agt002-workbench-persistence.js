import { createHash } from 'node:crypto';
import {
  validateAgt002WorkbenchJobInput,
  validateAgt002WorkbenchResult,
} from './agt002-workbench-contract.js';

const IDEMPOTENCY_KEYS = Object.freeze([
  'threadId',
  'originMessageId',
  'snapshotId',
  'capabilityId',
  'contractVersion',
  'policyVersion',
  'baseVersionId',
]);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} debe ser un objeto.`);
  }
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} usa claves inesperadas; el contrato debe ser cerrado.`);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

async function rpc(database, name, args) {
  if (!database || typeof database.rpc !== 'function') throw new TypeError('database.rpc es obligatorio.');
  const { data, error } = await database.rpc(name, args);
  if (error) {
    const failure = new Error(error.message || `RPC ${name} falló.`);
    for (const key of ['code', 'details', 'hint']) {
      if (error[key] !== undefined) failure[key] = error[key];
    }
    throw failure;
  }
  return data;
}

export function computeAgt002WorkbenchIdempotencyKey(input) {
  assertExactKeys(input, IDEMPOTENCY_KEYS, 'idempotency input');
  for (const key of IDEMPOTENCY_KEYS.filter(key => key !== 'baseVersionId')) {
    if (typeof input[key] !== 'string' || input[key].trim() === '') {
      throw new TypeError(`${key} es obligatorio para idempotencia.`);
    }
  }
  if (input.baseVersionId !== null && (typeof input.baseVersionId !== 'string' || input.baseVersionId.trim() === '')) {
    throw new TypeError('baseVersionId debe ser UUID o null.');
  }
  return createHash('sha256').update(JSON.stringify(stableValue(input))).digest('hex');
}

export function getAgt002Workbench(database, { opportunityId, actorId }) {
  return rpc(database, 'psi_get_agt002_workbench', {
    p_opportunity_id: opportunityId,
    p_actor_id: actorId,
  });
}

export function retryAgt002WorkbenchJob(database, input) {
  assertExactKeys(input, ['opportunityId', 'actorId', 'jobId'], 'retry');
  return rpc(database, 'psi_retry_agt002_workbench_job', {
    p_opportunity_id: input.opportunityId,
    p_actor_id: input.actorId,
    p_job_id: input.jobId,
  });
}

export function appendAgt002HumanMessage(database, input) {
  assertExactKeys(input, [
    'opportunityId', 'actorId', 'threadId', 'messageId', 'content', 'contextLinks', 'idempotencyKey',
    'contractVersion', 'policyVersion', 'capabilityId', 'snapshotId', 'baseVersionId',
  ], 'mensaje humano');
  return rpc(database, 'psi_append_agt002_workbench_message', {
    p_opportunity_id: input.opportunityId,
    p_actor_id: input.actorId,
    p_thread_id: input.threadId,
    p_message_id: input.messageId,
    p_content: input.content,
    p_context_links: input.contextLinks,
    p_idempotency_key: input.idempotencyKey,
    p_contract_version: input.contractVersion,
    p_policy_version: input.policyVersion,
    p_capability_id: input.capabilityId,
    p_snapshot_id: input.snapshotId,
    p_base_version_id: input.baseVersionId,
  });
}

export function claimAgt002WorkbenchJob(database, input) {
  assertExactKeys(input, ['workerId', 'dailyMaxJobs', 'maxConcurrent', 'leaseSeconds'], 'claim');
  return rpc(database, 'psi_claim_agt002_workbench_job', {
    p_worker_id: input.workerId,
    p_daily_max_jobs: input.dailyMaxJobs,
    p_max_concurrent: input.maxConcurrent,
    p_lease_seconds: input.leaseSeconds,
  });
}

export function appendAgt002WorkbenchJobEvent(database, input) {
  assertExactKeys(input, ['jobId', 'claimId', 'eventType', 'metadata'], 'evento');
  return rpc(database, 'psi_append_agt002_workbench_job_event', {
    p_job_id: input.jobId,
    p_claim_id: input.claimId,
    p_event_type: input.eventType,
    p_metadata: input.metadata,
  });
}

export function appendAgt002AgentResult(database, { jobId, claimId, agentId, input, result }) {
  validateAgt002WorkbenchJobInput(input);
  validateAgt002WorkbenchResult(result, { input });
  return rpc(database, 'psi_append_agt002_agent_result', {
    p_job_id: jobId,
    p_claim_id: claimId,
    p_agent_id: agentId,
    p_result: result,
  });
}

// Persistencia terminal atómica del trabajo agente: mensaje + acciones requeridas +
// propuesta y/o versión documental + evento completed en una sola transacción RPC.
// El worker exige exactamente esta firma; versión y resultado nunca se separan.
export function completeAgt002WorkbenchJob(database, { jobId, claimId, agentId, input, result }) {
  validateAgt002WorkbenchJobInput(input);
  validateAgt002WorkbenchResult(result, { input });
  return rpc(database, 'psi_complete_agt002_workbench_job', {
    p_job_id: jobId,
    p_claim_id: claimId,
    p_agent_id: agentId,
    p_result: result,
  });
}

export function appendAgt002AgentArtifactVersion(database, input) {
  assertObject(input, 'versión agente');
  if (!Object.hasOwn(input, 'baseVersionId')) throw new TypeError('baseVersionId es obligatorio, incluso cuando es null.');
  assertExactKeys(input, [
    'jobId', 'claimId', 'agentId', 'artifactId', 'baseVersionId',
    'contentKind', 'contentText', 'contentMetadata',
  ], 'versión agente');
  return rpc(database, 'psi_append_agt002_agent_artifact_version', {
    p_job_id: input.jobId,
    p_claim_id: input.claimId,
    p_agent_id: input.agentId,
    p_artifact_id: input.artifactId,
    p_base_version_id: input.baseVersionId,
    p_content_kind: input.contentKind,
    p_content_text: input.contentText,
    p_content_metadata: input.contentMetadata,
  });
}

export function reviewAgt002LearningProposal(database, input) {
  assertExactKeys(input, ['opportunityId', 'actorId', 'proposalId', 'decision', 'scope', 'comment'], 'revisión de aprendizaje');
  return rpc(database, 'psi_review_agt002_learning_proposal', {
    p_opportunity_id: input.opportunityId,
    p_actor_id: input.actorId,
    p_proposal_id: input.proposalId,
    p_decision: input.decision,
    p_scope: input.scope,
    p_comment: input.comment,
  });
}
