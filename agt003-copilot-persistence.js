import { createHash } from 'node:crypto';
import { validateAgt003CopilotRequest, validateAgt003CopilotResponse } from './agt003-copilot-contract.js';

const IDEMPOTENCY_KEY = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} es obligatorio para persistir Vig-IA.`);
  return value.trim();
}

function requireIdempotencyKey(value) {
  const key = requireText(value, 'La clave de idempotencia');
  if (!IDEMPOTENCY_KEY.test(key)) throw new Error('La clave de idempotencia Vig-IA no es válida.');
  return key;
}

function requirePositiveLimits(values) {
  if (!values.every(value => Number.isInteger(value) && value > 0)) throw new Error('Los límites de reserva Vig-IA no son válidos.');
}

function unwrapRpc(response, label) {
  if (response?.error) throw new Error(response.error.message || String(response.error));
  if (!response || response.data == null) throw new Error(`${label} no devolvió un resultado.`);
  return response.data;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function computeAgt003CopilotHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function computeAgt003CopilotIdempotencyKey({ snapshotId, policyVersion, model }) {
  const snapshot = requireText(snapshotId, 'El snapshot');
  const policy = requireText(policyVersion, 'La versión de política');
  const modelId = requireText(model, 'El modelo');
  return createHash('sha256').update(`agt003-copilot\0${snapshot}\0${policy}\0${modelId}`).digest('hex');
}

export function computeAgt003CopilotRetryKey({ previousKey, failedRunId }) {
  const key = requireIdempotencyKey(previousKey);
  const runId = requireText(failedRunId, 'La ejecución fallida');
  if (!UUID.test(runId)) throw new Error('La ejecución fallida Vig-IA no es válida.');
  return createHash('sha256').update(`agt003-copilot-retry\0${key}\0${runId}`).digest('hex');
}

export async function claimAgt003CopilotRun(database, { idempotencyKey, dailyMaxRuns, maxConcurrent, leaseSeconds }) {
  const key = requireIdempotencyKey(idempotencyKey);
  requirePositiveLimits([dailyMaxRuns, maxConcurrent, leaseSeconds]);
  const result = unwrapRpc(await database.rpc('psi_claim_agt003_copilot_run', {
    p_idempotency_key: key,
    p_daily_max_runs: dailyMaxRuns,
    p_max_concurrent: maxConcurrent,
    p_lease_seconds: leaseSeconds,
  }), 'La reserva Vig-IA');
  if (!['claimed', 'existing', 'in_progress', 'quota', 'saturated'].includes(result?.status)) throw new Error('La reserva Vig-IA devolvió un estado inválido.');
  if (result.status === 'claimed') {
    if (typeof result.claim_id !== 'string' || !result.claim_id) throw new Error('La reserva Vig-IA no devolvió su identificador.');
    return { status: result.status, claim_id: result.claim_id };
  }
  return { status: result.status };
}

export async function findAgt003CopilotRunByKey(database, idempotencyKey) {
  const key = requireIdempotencyKey(idempotencyKey);
  const response = await database.rpc('psi_get_agt003_copilot_run_by_key', { p_idempotency_key: key });
  if (response?.error) throw new Error(response.error.message || String(response.error));
  if (response?.data == null) return null;
  const row = response.data;
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('La consulta Vig-IA devolvió una ejecución inválida.');
  return { ...row, run_id: requireText(row.id, 'La ejecución Vig-IA') };
}

export async function findAgt003CopilotRunById(database, runId) {
  const id = requireText(runId, 'La ejecución Vig-IA');
  const response = await database.rpc('psi_get_agt003_copilot_run_by_id', { p_run_id: id });
  if (response?.error) throw new Error(response.error.message || String(response.error));
  if (response?.data == null) return null;
  const row = response.data;
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('La consulta Vig-IA devolvió una ejecución inválida.');
  return { ...row, run_id: requireText(row.id, 'La ejecución Vig-IA') };
}

export async function releaseAgt003CopilotClaim(database, { idempotencyKey, claimId }) {
  const released = unwrapRpc(await database.rpc('psi_release_agt003_copilot_claim', {
    p_idempotency_key: requireIdempotencyKey(idempotencyKey),
    p_claim_id: requireText(claimId, 'La reserva'),
  }), 'La liberación de reserva Vig-IA');
  if (released !== true) throw new Error('No fue posible liberar la reserva Vig-IA.');
  return true;
}

function validateUsage(usage, model) {
  const exactKeys = ['provider', 'model', 'input_tokens', 'output_tokens', 'rate_limit'];
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)
    || Object.keys(usage).length !== exactKeys.length || !exactKeys.every(key => Object.hasOwn(usage, key))
    || usage.model !== model || typeof usage.provider !== 'string' || !usage.provider.trim()
    || !Number.isInteger(usage.input_tokens) || usage.input_tokens < 0
    || !Number.isInteger(usage.output_tokens) || usage.output_tokens < 0) {
    throw new Error('Vig-IA requiere usage cerrado con modelo y tokens válidos.');
  }
}

export async function recordAgt003CopilotRun(database, { opportunityId, actorId, claimId, idempotencyKey: claimedIdempotencyKey, request, response, usage }) {
  const opportunity = requireText(opportunityId, 'La oportunidad');
  const actor = requireText(actorId, 'El actor');
  const claim = requireText(claimId, 'La reserva');
  validateAgt003CopilotRequest(request);
  validateAgt003CopilotResponse(response, { request });
  validateUsage(usage, response.model);
  const baseIdempotencyKey = computeAgt003CopilotIdempotencyKey({
    snapshotId: response.snapshot_id,
    policyVersion: response.policy_version,
    model: response.model,
  });
  const idempotencyKey = claimedIdempotencyKey === undefined
    ? baseIdempotencyKey
    : requireIdempotencyKey(claimedIdempotencyKey);
  const row = unwrapRpc(await database.rpc('psi_record_agt003_copilot_run', {
    p_idempotency_key: idempotencyKey,
    p_claim_id: claim,
    p_opportunity_id: opportunity,
    p_actor_id: actor,
    p_snapshot_id: response.snapshot_id,
    p_contract_version: response.contract_version,
    p_capability_id: response.capability_id,
    p_policy_version: response.policy_version,
    p_model: response.model,
    p_output: response,
    p_usage: usage,
    p_input_hash: computeAgt003CopilotHash(request),
    p_output_hash: computeAgt003CopilotHash(response),
  }), 'El registro de ejecución Vig-IA');
  const runId = requireText(row.id, 'La ejecución Vig-IA');
  return {
    run_id: runId,
    idempotency_key: row.idempotency_key || idempotencyKey,
    status: row.status || 'completed',
    output: row.output || response,
    created_at: row.created_at || null,
    completed_at: row.completed_at || null,
  };
}

export async function recordAgt003CopilotFailure(database, {
  opportunityId,
  actorId,
  claimId,
  idempotencyKey: claimedIdempotencyKey,
  request,
  policyVersion,
  model,
  usage,
  failureCode,
}) {
  const opportunity = requireText(opportunityId, 'La oportunidad');
  const actor = requireText(actorId, 'El actor');
  const claim = requireText(claimId, 'La reserva');
  const policy = requireText(policyVersion, 'La versión de política');
  const modelId = requireText(model, 'El modelo');
  validateAgt003CopilotRequest(request);
  validateUsage(usage, modelId);
  if (typeof failureCode !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(failureCode)) {
    throw new Error('El código de failure Vig-IA no es válido.');
  }
  const baseIdempotencyKey = computeAgt003CopilotIdempotencyKey({
    snapshotId: request.snapshot_id,
    policyVersion: policy,
    model: modelId,
  });
  const idempotencyKey = claimedIdempotencyKey === undefined
    ? baseIdempotencyKey
    : requireIdempotencyKey(claimedIdempotencyKey);
  const row = unwrapRpc(await database.rpc('psi_record_agt003_copilot_failure', {
    p_idempotency_key: idempotencyKey,
    p_claim_id: claim,
    p_opportunity_id: opportunity,
    p_actor_id: actor,
    p_snapshot_id: request.snapshot_id,
    p_contract_version: request.contract_version,
    p_capability_id: request.capability_id,
    p_policy_version: policy,
    p_model: modelId,
    p_usage: usage,
    p_input_hash: computeAgt003CopilotHash(request),
    p_failure_code: failureCode,
  }), 'El registro de fallo Vig-IA');
  return {
    run_id: requireText(row.id, 'La ejecución Vig-IA'),
    idempotency_key: row.idempotency_key || idempotencyKey,
    status: row.status || 'failed',
    failure_code: row.failure_code || failureCode,
    created_at: row.created_at || null,
    completed_at: row.completed_at || null,
  };
}

export async function recordAgt003CopilotFeedback(database, { runId, opportunityId, actorId, rating, comment = null }) {
  const allowed = ['useful', 'needs_change', 'discarded'];
  if (!allowed.includes(rating)) throw new Error('El rating de feedback Vig-IA no es válido.');
  if (comment !== null && (typeof comment !== 'string' || comment.length > 2000)) throw new Error('El comentario de feedback Vig-IA no es válido.');
  const cleanComment = typeof comment === 'string' && comment.trim() ? comment.trim() : null;
  const row = unwrapRpc(await database.rpc('psi_record_agt003_copilot_feedback', {
    p_run_id: requireText(runId, 'La ejecución Vig-IA'),
    p_opportunity_id: requireText(opportunityId, 'La oportunidad'),
    p_actor_id: requireText(actorId, 'El actor'),
    p_rating: rating,
    p_comment: cleanComment,
  }), 'El feedback Vig-IA');
  return {
    id: requireText(row.id, 'El feedback Vig-IA'),
    run_id: row.run_id || runId,
    opportunity_id: row.opportunity_id || opportunityId,
    actor_id: row.actor_id || actorId,
    rating: row.rating || rating,
    comment: row.comment ?? cleanComment,
    created_at: row.created_at || null,
  };
}
