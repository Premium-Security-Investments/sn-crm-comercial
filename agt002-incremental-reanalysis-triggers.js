import { computeAgt002StableContentHash } from './tender-analysis-foundation.js';
import { buildAgt002IncrementalDeltaManifest } from './agt002-incremental-analysis-input.js';

const TRUST_CLASSES = new Set(['trusted', 'pending_validation']);

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} es obligatorio.`);
  return value.trim();
}

async function rpc(database, name, args) {
  const { data, error } = await database.rpc(name, args);
  if (error) {
    const wrapped = new Error(error.message || String(error));
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}

export function buildAgt002IncrementalSignal({
  triggerKind,
  trustClass,
  sourceTable,
  sourceType,
  sourceId,
  sourceVersion,
  content,
  contentHash,
  observedAt,
  actorProfileId = null,
  validatesSignalId = null,
}) {
  if (!TRUST_CLASSES.has(trustClass)) throw new Error('La clase de confianza incremental no es válida.');
  const normalizedContent = String(content ?? '');
  const derivedHash = computeAgt002StableContentHash(normalizedContent);
  if (contentHash != null && contentHash !== derivedHash) throw new Error('La señal no coincide con su hash de contenido.');
  return Object.freeze({
    trigger_kind: required(triggerKind, 'El tipo de disparador'),
    trust_class: trustClass,
    source_table: required(sourceTable, 'La tabla fuente'),
    source_type: required(sourceType, 'El tipo de fuente'),
    source_id: required(sourceId, 'La identidad fuente'),
    source_version: required(sourceVersion, 'La versión fuente'),
    content_hash: derivedHash,
    observed_at: required(observedAt, 'El momento observado'),
    actor_profile_id: actorProfileId == null ? null : required(actorProfileId, 'El actor'),
    validates_signal_id: validatesSignalId == null ? null : required(validatesSignalId, 'La señal validada'),
  });
}

export async function recordAgt002IncrementalSignals(database, {
  opportunityId,
  tenderId,
  sourceBatchId = null,
  sourceTransactionId,
  signals,
}) {
  if (!Array.isArray(signals) || signals.length === 0) throw new Error('Se requiere al menos una señal incremental.');
  const result = await rpc(database, 'psi_record_agt002_incremental_signals', {
    p_opportunity_id: required(opportunityId, 'La oportunidad'),
    p_tender_id: required(tenderId, 'La licitación'),
    p_source_batch_id: sourceBatchId,
    p_source_transaction_id: required(sourceTransactionId, 'La transacción fuente'),
    p_signals: signals,
  });
  if (!result || !['pending_validation', 'accumulating', 'ready_to_seal', 'sealed', 'existing'].includes(result.status)) {
    throw new Error('El ingreso incremental no devolvió un estado válido.');
  }
  if (!['ready_to_seal', 'sealed', 'existing'].includes(result.status)) return result;
  const manifest = buildAgt002IncrementalDeltaManifest({
    opportunityId,
    tenderId,
    changeSetId: result.change_set_id,
    priorCanonicalRunId: result.prior_canonical_run_id,
    priorContextVersionId: result.prior_context_version_id,
    members: result.members,
    affectedFindingRefs: result.affected_finding_refs || [],
    comparisonExcerpts: result.comparison_excerpts || [],
    policyVersion: result.policy_version,
  });
  if (result.status !== 'ready_to_seal' && result.manifest_hash !== manifest.manifest_hash) {
    throw new Error('El hash server-side del conjunto incremental no coincide con el manifiesto reconstruido.');
  }
  return { ...result, manifest };
}

export async function sealAgt002IncrementalChangeSet(database, manifest) {
  const result = await rpc(database, 'psi_seal_agt002_incremental_change_set', {
    p_change_set_id: required(manifest?.change_set_id, 'El conjunto de cambios'),
    p_manifest: manifest,
    p_manifest_hash: required(manifest?.manifest_hash, 'El hash del manifiesto'),
  });
  if (!result || !['sealed', 'existing'].includes(result.status)) {
    throw new Error('El sellado incremental no devolvió un estado válido.');
  }
  return result;
}

export async function dispatchAgt002IncrementalChangeSet(database, { changeSetId, jobId, manifestHash }) {
  const result = await rpc(database, 'psi_dispatch_agt002_incremental_change_set', {
    p_change_set_id: required(changeSetId, 'El conjunto de cambios'),
    p_job_id: required(jobId, 'El job incremental'),
    p_manifest_hash: required(manifestHash, 'El hash del manifiesto'),
  });
  if (!result || !['dispatched', 'existing'].includes(result.status)) {
    throw new Error('El despacho incremental no devolvió un estado válido.');
  }
  return result;
}

export async function closeAgt002IncrementalChangeSet(database, { jobId, outcome, analysisRunId = null, safeError = null, workerId }) {
  const result = await rpc(database, 'psi_close_agt002_incremental_change_set', {
    p_job_id: required(jobId, 'El job incremental'),
    p_outcome: required(outcome, 'El resultado incremental'),
    p_analysis_run_id: analysisRunId,
    p_safe_error: safeError,
    p_worker_id: required(workerId, 'El worker incremental'),
  });
  if (!result || !['not_incremental', 'completed', 'failed', 'existing'].includes(result.status)) {
    throw new Error('El cierre incremental no devolvió un estado válido.');
  }
  return result;
}
