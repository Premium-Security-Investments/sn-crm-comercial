// AGT-002 P0-06 — initial-analysis canonical persistence adapter (docs/agt002/initial-analysis/
// CURRENT.md). The sole JS-side gateway to psi_complete_agt002_initial_analysis_job (migration
// 102). Every identity field (analysis_run_id, analysis_core_hash, schema_version) is derived
// from the synthesis envelope itself — this module never accepts an envelope hash from the
// caller, it always recomputes the canonical SHA-256 of the envelope's own deterministic JSON.
// The envelope is validated first against the pre_go_analysis.v2 schema (the first-analysis schema; v1 stays immutable for later stages)
// (agt002-pre-go-analysis-v1.js), then against the INITIAL-shape invariants this RPC call
// requires, before the RPC is ever invoked. Never imports, and is never imported by, any
// parallel operational runtime module.

import { createHash } from 'node:crypto';
import { validatePreGoAnalysisV2 } from './agt002-pre-go-analysis-v2.js';

export const AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES = Object.freeze({
  INVALID_CALL: 'AGT002_INITIAL_PERSISTENCE_INVALID_CALL',
  ENVELOPE_SCHEMA_INVALID: 'AGT002_INITIAL_PERSISTENCE_ENVELOPE_SCHEMA_INVALID',
  ENVELOPE_INVARIANT_VIOLATION: 'AGT002_INITIAL_PERSISTENCE_ENVELOPE_INVARIANT_VIOLATION',
  LEASE_LOST: 'AGT002_INITIAL_PERSISTENCE_LEASE_LOST',
  ALREADY_COMPLETED: 'AGT002_INITIAL_PERSISTENCE_ALREADY_COMPLETED',
  NOT_FOUND: 'AGT002_INITIAL_PERSISTENCE_NOT_FOUND',
  FORBIDDEN: 'AGT002_INITIAL_PERSISTENCE_FORBIDDEN',
  PERSISTENCE_FAILED: 'AGT002_INITIAL_PERSISTENCE_FAILED',
});

const REQUIRED_COMPLETION_FIELDS = Object.freeze([
  'workflowInstanceId', 'authorizationId', 'packageVersionId', 'packageHash', 'g1Scope', 'policyVersion', 'analysisRunId', 'envelope',
]);

function persistenceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalEnvelopeHash(envelope) {
  return createHash('sha256').update(JSON.stringify(canonicalize(envelope))).digest('hex');
}

function assertInvariant(condition, message) {
  if (!condition) {
    throw persistenceError(AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_INVARIANT_VIOLATION, message);
  }
}

function mapDatabaseError(error) {
  const code = error?.code;
  if (code === '55000') {
    return persistenceError(
      AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.LEASE_LOST,
      'AGT-002 initial-analysis persistence: el job perdió su reserva, o ya existe un análisis canónico para la oportunidad, o la autorización/instancia de flujo de trabajo no está en el estado requerido.',
    );
  }
  if (code === '23505') {
    return persistenceError(
      AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ALREADY_COMPLETED,
      'AGT-002 initial-analysis persistence: el job ya se completó con otra ejecución.',
    );
  }
  if (code === 'P0002') {
    return persistenceError(
      AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.NOT_FOUND,
      'AGT-002 initial-analysis persistence: el job de análisis inicial no existe.',
    );
  }
  if (code === '42501') {
    return persistenceError(
      AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.FORBIDDEN,
      'AGT-002 initial-analysis persistence: el paquete de evidencia congelado no pertenece a la oportunidad/licitación del job.',
    );
  }
  if (code === '22023') {
    return persistenceError(
      AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_INVARIANT_VIOLATION,
      'AGT-002 initial-analysis persistence: la base de datos rechazó la consistencia del agregado o de sus identidades.',
    );
  }
  return persistenceError(
    AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.PERSISTENCE_FAILED,
    'AGT-002 initial-analysis persistence: fallo de persistencia no clasificado.',
  );
}

/**
 * Validates and persists the single INITIAL-analysis canonical completion for one claimed job,
 * via the one atomic RPC (psi_complete_agt002_initial_analysis_job). `completion.envelope` is the
 * raw synthesis-phase output; every identity field the RPC needs (analysis_run_id,
 * analysis_core_hash, schema_version) is derived from `completion.envelope.meta`, never accepted
 * directly from the caller. The envelope's own canonical SHA-256 is always recomputed here.
 */
export async function completeAgt002InitialAnalysisJob(database, { jobId, leaseId, fenceVersion, completion } = {}) {
  if (!isPresent(jobId) || !isPresent(leaseId) || fenceVersion === undefined || fenceVersion === null || !completion || typeof completion !== 'object') {
    throw persistenceError(
      AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.INVALID_CALL,
      'AGT-002 initial-analysis persistence: identidad de job/lease/fence/completion incompleta.',
    );
  }
  for (const field of REQUIRED_COMPLETION_FIELDS) {
    if (!isPresent(completion[field])) {
      throw persistenceError(
        AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.INVALID_CALL,
        `AGT-002 initial-analysis persistence: completion.${field} es obligatorio.`,
      );
    }
  }

  const { envelope } = completion;

  const validation = validatePreGoAnalysisV2(envelope);
  if (!validation.ok) {
    throw persistenceError(
      AGT002_INITIAL_ANALYSIS_PERSISTENCE_ERROR_CODES.ENVELOPE_SCHEMA_INVALID,
      'AGT-002 initial-analysis persistence: el agregado de síntesis no cumple el esquema pre_go_analysis.v2.',
    );
  }

  const meta = envelope.meta;
  assertInvariant(meta.schema_version === 'pre_go_analysis.v2', 'AGT-002 initial-analysis persistence: meta.schema_version debe ser pre_go_analysis.v2.');
  assertInvariant(meta.aggregate_stage === 'ANALYSIS_PUBLISHED', 'AGT-002 initial-analysis persistence: meta.aggregate_stage del primer agregado debe ser ANALYSIS_PUBLISHED.');
  assertInvariant(meta.aggregate_version === 1, 'AGT-002 initial-analysis persistence: meta.aggregate_version del primer agregado debe ser 1.');
  assertInvariant(meta.analysis_kind === 'INITIAL', 'AGT-002 initial-analysis persistence: meta.analysis_kind debe ser INITIAL.');
  assertInvariant(meta.analysis_version === 1, 'AGT-002 initial-analysis persistence: meta.analysis_version de un análisis INITIAL debe ser 1.');
  assertInvariant(envelope.human_decision === null, 'AGT-002 initial-analysis persistence: human_decision del primer agregado (ANALYSIS_PUBLISHED) debe ser nulo.');
  assertInvariant(meta.g1_authorization_id === completion.authorizationId, 'AGT-002 initial-analysis persistence: meta.g1_authorization_id no coincide con la autorización indicada.');
  assertInvariant(meta.g1_scope === completion.g1Scope, 'AGT-002 initial-analysis persistence: meta.g1_scope no coincide con el alcance indicado.');
  assertInvariant(meta.package_hash === completion.packageHash, 'AGT-002 initial-analysis persistence: meta.package_hash no coincide con la huella del paquete indicado.');
  assertInvariant(meta.analysis_run_id === completion.analysisRunId, 'AGT-002 initial-analysis persistence: meta.analysis_run_id no coincide con la identidad reservada por el servidor.');

  const analysisRunId = meta.analysis_run_id;
  const analysisCoreHash = meta.analysis_core_hash;
  const schemaVersion = meta.schema_version;
  const envelopeHash = canonicalEnvelopeHash(envelope);

  const { data, error } = await database.rpc('psi_complete_agt002_initial_analysis_job', {
    p_job_id: jobId,
    p_lease_id: leaseId,
    p_fence_version: fenceVersion,
    p_analysis_run_id: analysisRunId,
    p_workflow_instance_id: completion.workflowInstanceId,
    p_authorization_id: completion.authorizationId,
    p_package_version_id: completion.packageVersionId,
    p_package_hash: completion.packageHash,
    p_g1_scope: completion.g1Scope,
    p_analysis_core_hash: analysisCoreHash,
    p_policy_version: completion.policyVersion,
    p_schema_version: schemaVersion,
    p_envelope: envelope,
    p_envelope_hash: envelopeHash,
  });

  if (error) {
    throw mapDatabaseError(error);
  }

  return {
    status: data.status,
    jobId: data.job_id,
    analysisRunId: data.analysis_run_id,
    aggregateVersion: data.aggregate_version,
    lineageId: data.lineage_id ?? null,
  };
}
