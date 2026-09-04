// AGT-002 durable batched analysis — runtime checkpoint adapter (Task 2 of
// docs/plans/2026-09-03-agt002-durable-batched-analysis.md). Thin, closed wrapper around
// migration 081's six new RPCs (supabase/migrations/081_agt002_durable_batched_analysis.sql):
// exact snake_case param mapping in, exact camelCase result mapping out, nothing else. Never
// reads an environment variable, never calls the legacy single-turn completion RPC
// (psi_complete_agt002_reanalysis_job), never trusts a persisted row's `output` as safe to
// reuse without the caller's own current-schema validator running over it first.
//
// Canonical hashing reuses tender-semantic-discovery-batches.js's exact `stableForHash`
// convention (recursively sorted object keys, array order preserved) so hashes are
// reproducible regardless of caller-side key insertion order, and effort validation reuses
// the existing closed AGT002_PREVIEW_REASONING_EFFORT_VALUES allowlist rather than inventing a
// second one.

import { createHash } from 'node:crypto';
import { isAgt002PreviewReasoningEffort } from './agt002-preview-reasoning-effort.js';

export const AGT002_CHECKPOINT_STAGES = Object.freeze([
  'semantic_discovery_batch',
  'semantic_manifest',
  'integral_analysis_plan',
  'integral_analysis_batch',
]);
const AGT002_CHECKPOINT_STAGE_SET = new Set(AGT002_CHECKPOINT_STAGES);

export const AGT002_CHECKPOINT_PROGRESS_PHASES = Object.freeze(['semantic_discovery', 'integral_analysis']);
const AGT002_CHECKPOINT_PROGRESS_PHASE_SET = new Set(AGT002_CHECKPOINT_PROGRESS_PHASES);
const AGT002_CHECKPOINT_STAGE_PROGRESS_PHASE = Object.freeze({
  semantic_discovery_batch: 'semantic_discovery',
  semantic_manifest: 'semantic_discovery',
  integral_analysis_plan: 'integral_analysis',
  integral_analysis_batch: 'integral_analysis',
});

export const AGT002_CHECKPOINT_ERROR_CODES = Object.freeze({
  IDENTITY_INVALID: 'AGT002_CHECKPOINT_IDENTITY_INVALID',
  WORKSET_RESPONSE_INVALID: 'AGT002_CHECKPOINT_WORKSET_RESPONSE_INVALID',
  WORKSET_PERSISTENCE_CONFLICT: 'AGT002_CHECKPOINT_WORKSET_PERSISTENCE_CONFLICT',
  CHECKPOINT_INVALID: 'AGT002_CHECKPOINT_INVALID',
  CHECKPOINT_RESPONSE_INVALID: 'AGT002_CHECKPOINT_RESPONSE_INVALID',
  CHECKPOINT_PERSISTENCE_CONFLICT: 'AGT002_CHECKPOINT_PERSISTENCE_CONFLICT',
  LEASE_LOST: 'AGT002_CHECKPOINT_LEASE_LOST',
  FINALIZE_INVALID: 'AGT002_CHECKPOINT_FINALIZE_INVALID',
  FINALIZE_RESPONSE_INVALID: 'AGT002_CHECKPOINT_FINALIZE_RESPONSE_INVALID',
  PERSISTENCE_FAILED: 'AGT002_CHECKPOINT_PERSISTENCE_FAILED',
});

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const EVIDENCE_IDENTITY_KEYS = ['source_snapshot_hash', 'preview_artifact_hash', 'source_manifest_version'];
const LEGAL_CORPUS_IDENTITY_KEYS = ['legal_corpus_version_id', 'content_sha256'];
// Deep-scanned, at any depth, against every checkpoint output before it may ever be forwarded
// to the store RPC: a checkpoint persists model-accepted structured output only, never a raw
// prompt/provider response/source document text/credential.
const FORBIDDEN_OUTPUT_KEYS = ['prompt', 'raw_output', 'raw_response', 'source_text', 'credential', 'api_key', 'secret', 'password'];

function checkpointError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHash256(value) {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Mirrors tender-semantic-discovery-batches.js's own `stableForHash` convention exactly.
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

/** Deterministic sha256 of a frozen engine input; key order never affects the result. */
export function computeAgt002FrozenEngineInputHash(frozenEngineInput) {
  return canonicalSha256(frozenEngineInput);
}

/**
 * Cross-checks a claimed frozenEngineInputHash against the exact frozen job input it claims to
 * represent, before that hash is ever bound into a workset identity handed to get-or-create.
 * Fails closed on a malformed hash shape or on any disagreement.
 */
export function assertAgt002FrozenEngineInputHashMatches(frozenEngineInputHash, frozenEngineInput) {
  if (!isHash256(frozenEngineInputHash) || computeAgt002FrozenEngineInputHash(frozenEngineInput) !== frozenEngineInputHash) {
    throw checkpointError(
      AGT002_CHECKPOINT_ERROR_CODES.IDENTITY_INVALID,
      'AGT-002 checkpoint: el hash del insumo congelado del motor no coincide con el job que dice representar.',
    );
  }
}

function validateOptionalCompanyEvidenceIdentity(value, invalid) {
  if (value === null || value === undefined) return null;
  if (
    !isPlainObject(value)
    || Object.keys(value).length !== EVIDENCE_IDENTITY_KEYS.length
    || !EVIDENCE_IDENTITY_KEYS.every(key => Object.hasOwn(value, key))
    || !isHash256(value.source_snapshot_hash)
    || !isHash256(value.preview_artifact_hash)
    || !isNonEmptyString(value.source_manifest_version)
  ) {
    invalid('companyEvidenceIdentity');
  }
  return {
    source_snapshot_hash: value.source_snapshot_hash,
    preview_artifact_hash: value.preview_artifact_hash,
    source_manifest_version: value.source_manifest_version.trim(),
  };
}

function validateOptionalLegalCorpusIdentity(value, invalid) {
  if (value === null || value === undefined) return null;
  if (
    !isPlainObject(value)
    || Object.keys(value).length !== LEGAL_CORPUS_IDENTITY_KEYS.length
    || !LEGAL_CORPUS_IDENTITY_KEYS.every(key => Object.hasOwn(value, key))
    || !isNonEmptyString(value.legal_corpus_version_id)
    || !isHash256(value.content_sha256)
  ) {
    invalid('legalCorpusIdentity');
  }
  return {
    legal_corpus_version_id: value.legal_corpus_version_id.trim(),
    content_sha256: value.content_sha256,
  };
}

/**
 * Pure: never touches a database. Validates every bound field of a durable analysis workset's
 * canonical identity and derives the exact `frozen_identity` jsonb blob migration 081's
 * get-or-create RPC persists. Rejects anything incomplete or malformed before returning.
 */
export function deriveAgt002AnalysisWorksetIdentity(input) {
  const value = isPlainObject(input) ? input : {};
  const invalid = reason => {
    throw checkpointError(
      AGT002_CHECKPOINT_ERROR_CODES.IDENTITY_INVALID,
      `AGT-002 checkpoint: identidad de workset inválida (${reason}).`,
    );
  };

  if (!isNonEmptyString(value.opportunityId)) invalid('opportunityId');
  if (!isNonEmptyString(value.tenderId)) invalid('tenderId');
  if (!isNonEmptyString(value.snapshotId)) invalid('snapshotId');
  if (!isNonEmptyString(value.contextVersionId)) invalid('contextVersionId');
  if (!isNonEmptyString(value.idempotencyKey)) invalid('idempotencyKey');
  if (!isNonEmptyString(value.model)) invalid('model');
  if (!isAgt002PreviewReasoningEffort(value.effort)) invalid('effort');
  if (!isNonEmptyString(value.policyVersion)) invalid('policyVersion');
  if (!isNonEmptyString(value.semanticDiscoveryPolicyVersion)) invalid('semanticDiscoveryPolicyVersion');
  if (!isNonEmptyString(value.semanticDiscoverySchemaVersion)) invalid('semanticDiscoverySchemaVersion');
  if (!isNonEmptyString(value.semanticDiscoveryPlannerVersion)) invalid('semanticDiscoveryPlannerVersion');
  if (!isNonEmptyString(value.integralAnalysisBatchPolicyVersion)) invalid('integralAnalysisBatchPolicyVersion');
  if (!isNonEmptyString(value.integralAnalysisBatchSchemaVersion)) invalid('integralAnalysisBatchSchemaVersion');
  if (!isNonEmptyString(value.integralAnalysisBatchPlannerVersion)) invalid('integralAnalysisBatchPlannerVersion');
  if (!isHash256(value.frozenEngineInputHash)) invalid('frozenEngineInputHash');

  const companyEvidenceIdentity = validateOptionalCompanyEvidenceIdentity(value.companyEvidenceIdentity, invalid);
  const legalCorpusIdentity = validateOptionalLegalCorpusIdentity(value.legalCorpusIdentity, invalid);

  const inventoryHashPresent = value.inventoryHash !== null && value.inventoryHash !== undefined;
  const snapshotHashPresent = value.snapshotHash !== null && value.snapshotHash !== undefined;
  if (inventoryHashPresent !== snapshotHashPresent) invalid('inventoryHash/snapshotHash');
  if (inventoryHashPresent && (!isHash256(value.inventoryHash) || !isHash256(value.snapshotHash))) {
    invalid('inventoryHash/snapshotHash');
  }

  return Object.freeze({
    opportunityId: value.opportunityId.trim(),
    tenderId: value.tenderId.trim(),
    snapshotId: value.snapshotId.trim(),
    contextVersionId: value.contextVersionId.trim(),
    idempotencyKey: value.idempotencyKey.trim(),
    frozenIdentity: Object.freeze({
      model: value.model.trim(),
      effort: value.effort,
      policy_version: value.policyVersion.trim(),
      semantic_discovery_policy_version: value.semanticDiscoveryPolicyVersion.trim(),
      semantic_discovery_schema_version: value.semanticDiscoverySchemaVersion.trim(),
      semantic_discovery_planner_version: value.semanticDiscoveryPlannerVersion.trim(),
      integral_analysis_batch_policy_version: value.integralAnalysisBatchPolicyVersion.trim(),
      integral_analysis_batch_schema_version: value.integralAnalysisBatchSchemaVersion.trim(),
      integral_analysis_batch_planner_version: value.integralAnalysisBatchPlannerVersion.trim(),
      company_evidence_identity: companyEvidenceIdentity,
      legal_corpus_identity: legalCorpusIdentity,
      frozen_engine_input_hash: value.frozenEngineInputHash,
      inventory_hash: inventoryHashPresent ? value.inventoryHash : null,
      snapshot_hash: inventoryHashPresent ? value.snapshotHash : null,
    }),
  });
}

/**
 * Single RPC choke point: exact-name call, closed-code error mapping, raw DB message never
 * forwarded. `conflictCode` selects which closed code a unique-violation (23505) maps to;
 * every other classified/unclassified DB error maps to LEASE_LOST (55000) or the generic
 * PERSISTENCE_FAILED fallback.
 */
async function callRpc(database, name, params, { conflictCode = AGT002_CHECKPOINT_ERROR_CODES.PERSISTENCE_FAILED } = {}) {
  const { data, error } = await database.rpc(name, params);
  if (error) {
    if (error.code === '23505') {
      throw checkpointError(conflictCode, 'AGT-002 checkpoint: conflicto de persistencia bajo la misma identidad.');
    }
    if (error.code === '55000') {
      throw checkpointError(AGT002_CHECKPOINT_ERROR_CODES.LEASE_LOST, 'AGT-002 checkpoint: el job perdió su reserva.');
    }
    throw checkpointError(AGT002_CHECKPOINT_ERROR_CODES.PERSISTENCE_FAILED, 'AGT-002 checkpoint: fallo de persistencia no clasificado.');
  }
  return data;
}

/** Idempotent create/reuse of one durable analysis workset, keyed by its frozen identity. */
export async function getOrCreateAgt002AnalysisWorkset(database, identity) {
  if (
    !isPlainObject(identity)
    || !isNonEmptyString(identity.opportunityId)
    || !isNonEmptyString(identity.tenderId)
    || !isNonEmptyString(identity.snapshotId)
    || !isNonEmptyString(identity.contextVersionId)
    || !isNonEmptyString(identity.idempotencyKey)
    || !isPlainObject(identity.frozenIdentity)
  ) {
    throw checkpointError(AGT002_CHECKPOINT_ERROR_CODES.IDENTITY_INVALID, 'AGT-002 checkpoint: identidad de workset incompleta.');
  }

  const data = await callRpc(database, 'psi_get_or_create_agt002_analysis_workset', {
    p_opportunity_id: identity.opportunityId,
    p_tender_id: identity.tenderId,
    p_snapshot_id: identity.snapshotId,
    p_context_version_id: identity.contextVersionId,
    p_idempotency_key: identity.idempotencyKey,
    p_frozen_identity: identity.frozenIdentity,
  }, { conflictCode: AGT002_CHECKPOINT_ERROR_CODES.WORKSET_PERSISTENCE_CONFLICT });

  if (
    !isPlainObject(data)
    || !['created', 'existing'].includes(data.status)
    || !isNonEmptyString(data.workset_id)
    || typeof data.published !== 'boolean'
  ) {
    throw checkpointError(AGT002_CHECKPOINT_ERROR_CODES.WORKSET_RESPONSE_INVALID, 'AGT-002 checkpoint: respuesta de creación de workset inválida.');
  }
  return { status: data.status, worksetId: data.workset_id, published: data.published };
}

/** Narrow read of every checkpoint row for a workset; a structural mapping only — never interprets `output`. */
export async function listAgt002AnalysisCheckpoints(database, worksetId) {
  if (!isNonEmptyString(worksetId)) {
    throw checkpointError(AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID, 'AGT-002 checkpoint: worksetId requerido.');
  }
  const data = await callRpc(database, 'psi_list_agt002_analysis_checkpoints', { p_workset_id: worksetId });
  if (!isPlainObject(data) || !Array.isArray(data.checkpoints)) {
    throw checkpointError(AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_RESPONSE_INVALID, 'AGT-002 checkpoint: respuesta de listado de checkpoints inválida.');
  }
  return data.checkpoints.map(row => ({
    checkpointId: row.checkpoint_id,
    worksetId: row.workset_id,
    stage: row.stage,
    batchIndex: row.batch_index,
    requestHash: row.request_hash,
    stageContractVersion: row.stage_contract_version,
    output: row.output,
    outputSha256: row.output_sha256,
    usage: row.usage,
    providerIdempotencyKey: row.provider_idempotency_key,
    createdAt: row.created_at,
  }));
}

/**
 * Reports a hit only when a row exists for the exact (stage, batchIndex) whose `requestHash`
 * matches, AND whose persisted `output` — always untrusted — passes the caller's own current
 * validator/canonicalizer. A stale request hash never reaches the validator; a validator that
 * throws or returns falsy never surfaces its error and never becomes a hit.
 */
export async function loadAgt002AnalysisCheckpoint(database, { worksetId, stage, batchIndex, expectedRequestHash }, { validate }) {
  const rows = await listAgt002AnalysisCheckpoints(database, worksetId);
  const row = rows.find(candidate => candidate.stage === stage && candidate.batchIndex === batchIndex);
  if (!row || row.requestHash !== expectedRequestHash) return { hit: false };

  let canonical;
  try {
    canonical = validate(row.output);
  } catch {
    return { hit: false };
  }
  if (!canonical) return { hit: false };

  return {
    hit: true,
    output: canonical,
    usage: row.usage,
    requestHash: row.requestHash,
    stageContractVersion: row.stageContractVersion,
    providerIdempotencyKey: row.providerIdempotencyKey,
  };
}

function findForbiddenOutputKeyPaths(value, path = '') {
  const paths = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => paths.push(...findForbiddenOutputKeyPaths(item, `${path}[${index}]`)));
    return paths;
  }
  if (!isPlainObject(value)) return paths;
  for (const key of Object.keys(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_OUTPUT_KEYS.includes(key)) paths.push(nextPath);
    paths.push(...findForbiddenOutputKeyPaths(value[key], nextPath));
  }
  return paths;
}

/**
 * Stores one immutable (workset_id, stage, batch_index) checkpoint. Every field is validated
 * before any RPC call: closed stage, non-negative integer batchIndex, `output` an object whose
 * own canonical sha256 matches the caller-supplied `outputSha256` exactly, `usage` null or an
 * object, and `output` free of any prompt/response/source-text/credential key at any depth.
 * Only this already-validated, safe metadata is ever forwarded to the RPC.
 */
export async function storeAgt002AnalysisCheckpoint(database, params) {
  const value = isPlainObject(params) ? params : {};
  const invalid = reason => {
    throw checkpointError(
      AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID,
      `AGT-002 checkpoint: almacenamiento de checkpoint inválido (${reason}).`,
    );
  };

  if (!isNonEmptyString(value.jobId)) invalid('jobId');
  if (!isNonEmptyString(value.leaseId)) invalid('leaseId');
  if (!isNonEmptyString(value.worksetId)) invalid('worksetId');
  if (!AGT002_CHECKPOINT_STAGE_SET.has(value.stage)) invalid('stage');
  if (!Number.isInteger(value.batchIndex) || value.batchIndex < 0) invalid('batchIndex');
  if (!isNonEmptyString(value.requestHash)) invalid('requestHash');
  if (!isNonEmptyString(value.stageContractVersion)) invalid('stageContractVersion');
  if (!isPlainObject(value.output)) invalid('output');
  if (value.usage !== null && value.usage !== undefined && !isPlainObject(value.usage)) invalid('usage');
  if (!isNonEmptyString(value.providerIdempotencyKey)) invalid('providerIdempotencyKey');
  if (!AGT002_CHECKPOINT_PROGRESS_PHASE_SET.has(value.progressPhase)) invalid('progressPhase');
  if (!Number.isInteger(value.completedBatchCount) || value.completedBatchCount < 1) invalid('completedBatchCount');
  if (!Number.isInteger(value.totalBatchCount) || value.totalBatchCount < value.completedBatchCount) invalid('totalBatchCount');
  if (AGT002_CHECKPOINT_STAGE_PROGRESS_PHASE[value.stage] !== value.progressPhase) invalid('stage/progressPhase pairing');

  if (canonicalSha256(value.output) !== value.outputSha256) {
    invalid('outputSha256 no coincide con el hash canónico recalculado de output');
  }

  const forbiddenPaths = findForbiddenOutputKeyPaths(value.output);
  if (forbiddenPaths.length) invalid(`output contiene campos prohibidos: ${forbiddenPaths.join(', ')}`);

  const usage = value.usage === undefined ? null : value.usage;

  const data = await callRpc(database, 'psi_record_agt002_analysis_checkpoint', {
    p_job_id: value.jobId,
    p_lease_id: value.leaseId,
    p_workset_id: value.worksetId,
    p_stage: value.stage,
    p_batch_index: value.batchIndex,
    p_request_hash: value.requestHash,
    p_stage_contract_version: value.stageContractVersion,
    p_output: value.output,
    p_output_sha256: value.outputSha256,
    p_usage: usage,
    p_provider_idempotency_key: value.providerIdempotencyKey,
    p_progress_phase: value.progressPhase,
    p_completed_batch_count: value.completedBatchCount,
    p_total_batch_count: value.totalBatchCount,
  }, { conflictCode: AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_PERSISTENCE_CONFLICT });

  if (!isPlainObject(data) || !['created', 'existing'].includes(data.status) || !isNonEmptyString(data.checkpoint_id)) {
    throw checkpointError(AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_RESPONSE_INVALID, 'AGT-002 checkpoint: respuesta de almacenamiento de checkpoint inválida.');
  }
  return { status: data.status, checkpointId: data.checkpoint_id };
}

/**
 * The single atomic, lease-fenced finalize call (migration 081's
 * psi_finalize_agt002_durable_batched_analysis): records the canonical run and completes the
 * queue job in the SAME RPC. Never calls any other RPC — in particular, never the legacy
 * single-turn psi_complete_agt002_reanalysis_job.
 */
export async function finalizeAgt002DurableBatchedAnalysis(database, params) {
  const value = isPlainObject(params) ? params : {};
  const invalid = reason => {
    throw checkpointError(
      AGT002_CHECKPOINT_ERROR_CODES.FINALIZE_INVALID,
      `AGT-002 checkpoint: finalización inválida (${reason}).`,
    );
  };

  if (!isNonEmptyString(value.jobId)) invalid('jobId');
  if (!isNonEmptyString(value.leaseId)) invalid('leaseId');
  if (!isNonEmptyString(value.worksetId)) invalid('worksetId');
  if (!isNonEmptyString(value.snapshotId)) invalid('snapshotId');
  if (!isNonEmptyString(value.opportunityId)) invalid('opportunityId');
  if (!isNonEmptyString(value.tenderId)) invalid('tenderId');
  if (!isPlainObject(value.result)) invalid('result');
  if (!Number.isInteger(value.criticalOpenCount) || value.criticalOpenCount < 0) invalid('criticalOpenCount');
  if (!isNonEmptyString(value.idempotencyKey)) invalid('idempotencyKey');
  if (!isNonEmptyString(value.schemaVersion)) invalid('schemaVersion');
  if (!isNonEmptyString(value.policyVersion)) invalid('policyVersion');
  if (!isNonEmptyString(value.model)) invalid('model');
  if (!isPlainObject(value.usage)) invalid('usage');
  if (!isNonEmptyString(value.contextVersionId)) invalid('contextVersionId');
  if (value.legalCorpusVersionId !== null && !isNonEmptyString(value.legalCorpusVersionId)) invalid('legalCorpusVersionId');

  const data = await callRpc(database, 'psi_finalize_agt002_durable_batched_analysis', {
    p_job_id: value.jobId,
    p_lease_id: value.leaseId,
    p_workset_id: value.worksetId,
    p_snapshot_id: value.snapshotId,
    p_opportunity_id: value.opportunityId,
    p_tender_id: value.tenderId,
    p_result: value.result,
    p_critical_open_count: value.criticalOpenCount,
    p_idempotency_key: value.idempotencyKey,
    p_schema_version: value.schemaVersion,
    p_policy_version: value.policyVersion,
    p_model: value.model,
    p_usage: value.usage,
    p_context_version_id: value.contextVersionId,
    p_legal_corpus_version_id: value.legalCorpusVersionId,
  });

  if (
    !isPlainObject(data)
    || !isNonEmptyString(data.analysis_run_id)
    || !isNonEmptyString(data.workset_id)
    || !isNonEmptyString(data.job_id)
  ) {
    throw checkpointError(AGT002_CHECKPOINT_ERROR_CODES.FINALIZE_RESPONSE_INVALID, 'AGT-002 checkpoint: respuesta de finalización inválida.');
  }
  return { analysisRunId: data.analysis_run_id, worksetId: data.workset_id, jobId: data.job_id };
}

/**
 * Builds the `{ loadCheckpoint, storeCheckpoint }` hooks the durable_batched_v1 executor path
 * injects, fenced by one claimed job's own (jobId, leaseId, worksetId) — the caller never
 * threads that identity through per-call.
 *
 * Accepts exactly one resolver identity alongside jobId/leaseId: an explicit nonempty
 * `worksetId` (byte-compatible with the original contract — never resolves, never calls
 * psi_get_agt002_analysis_workset) or a canonical nonempty `idempotencyKey`. The constructor
 * stays synchronous and issues zero RPCs either way; the idempotencyKey path lazily resolves
 * its worksetId via the exact `psi_get_agt002_analysis_workset({ p_idempotency_key })` RPC on
 * the first load/store hook call, caching the validated result and sharing one in-flight
 * resolution promise across concurrent first calls. A missing/conflicting/malformed resolution
 * fails closed with a sanitized closed AGT002_CHECKPOINT_* code and never reaches a checkpoint
 * read/write RPC.
 */
export function createAgt002AnalysisCheckpointAdapter(database, { jobId, leaseId, worksetId, idempotencyKey } = {}) {
  const invalid = () => {
    throw checkpointError(AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID, 'AGT-002 checkpoint: identidad del adaptador de checkpoints incompleta.');
  };
  if (!isNonEmptyString(jobId) || !isNonEmptyString(leaseId)) invalid();
  const hasWorksetId = isNonEmptyString(worksetId);
  const hasIdempotencyKey = isNonEmptyString(idempotencyKey);
  if (hasWorksetId === hasIdempotencyKey) invalid();

  let resolvedWorksetId = hasWorksetId ? worksetId : null;
  let resolutionPromise = null;

  function resolveWorksetId() {
    if (resolvedWorksetId) return Promise.resolve(resolvedWorksetId);
    if (!resolutionPromise) {
      resolutionPromise = (async () => {
        const data = await callRpc(database, 'psi_get_agt002_analysis_workset', { p_idempotency_key: idempotencyKey });
        if (
          !isPlainObject(data)
          || !isNonEmptyString(data.workset_id)
          || data.idempotency_key !== idempotencyKey
          || typeof data.published !== 'boolean'
        ) {
          throw checkpointError(
            AGT002_CHECKPOINT_ERROR_CODES.WORKSET_RESPONSE_INVALID,
            'AGT-002 checkpoint: no se pudo resolver el workset a partir de la clave de idempotencia.',
          );
        }
        resolvedWorksetId = data.workset_id;
        return resolvedWorksetId;
      })();
    }
    return resolutionPromise;
  }

  return Object.freeze({
    async loadCheckpoint({ stage, batchIndex, expectedRequestHash, validate }) {
      const resolvedWorksetIdValue = await resolveWorksetId();
      return loadAgt002AnalysisCheckpoint(database, { worksetId: resolvedWorksetIdValue, stage, batchIndex, expectedRequestHash }, { validate });
    },
    async storeCheckpoint({ stage, batchIndex, requestHash, stageContractVersion, output, outputSha256, usage, providerIdempotencyKey, progressPhase, completedBatchCount, totalBatchCount }) {
      const resolvedWorksetIdValue = await resolveWorksetId();
      return storeAgt002AnalysisCheckpoint(database, {
        jobId, leaseId, worksetId: resolvedWorksetIdValue, stage, batchIndex, requestHash, stageContractVersion, output, outputSha256, usage, providerIdempotencyKey,
        progressPhase, completedBatchCount, totalBatchCount,
      });
    },
  });
}
