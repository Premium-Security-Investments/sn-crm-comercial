// AGT-002 governed document worksets — Phase 3 of
// .hermes/plans/2026-09-17-agt002-governed-document-worksets.md ("Governed API / enqueue /
// worker identity"). Pure request validation plus the DB-touching orchestration that turns a
// client's `{opportunity_id, documents[]}` request into a frozen, enqueued governed workset
// through the Phase 2 migration-084 RPCs. tender_id is never accepted from the client — the
// caller resolves it server-side (getTenderIdForOpportunity) before calling
// freezeAgt002GovernedDocumentWorkset. Nothing here ever lists or re-resolves "all current
// tender documents": every document identity that reaches the frozen package is either the
// exact set the client named (bounded 1..12 by normalizeRequestedAgt002WorksetMembers) or a
// single-id lookup resolved through psi_resolve_agt002_governed_document_candidate.
import {
  computeAgt002GovernedWorksetIdempotencyKey,
  freezeAgt002WorksetEvidence,
  normalizeRequestedAgt002WorksetMembers,
  publicAgt002WorksetSummary,
} from './agt002-governed-document-worksets.js';
import {
  AGT002_GOVERNED_WORKSET_APTO,
  AGT002_GOVERNED_WORKSET_CHARS_PER_BATCH,
  AGT002_GOVERNED_WORKSET_FREEZE_ROUTE,
  evaluateAgt002GovernedWorksetCapacity,
} from './agt002-governed-workset-capacity.js';

// Re-exported for backward compatibility: this used to be defined locally in this module.
export { computeAgt002GovernedWorksetIdempotencyKey } from './agt002-governed-document-worksets.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_REQUEST_KEYS = new Set(['opportunity_id', 'documents']);

function governedWorksetError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function invalidGovernedWorksetInputError(message) {
  return governedWorksetError(400, 'invalid_governed_workset_input', message);
}
export function governedWorksetConflictError(message) {
  return governedWorksetError(409, 'governed_workset_conflict', message);
}

// Operational batch-capacity preflight (agt002-governed-workset-capacity.js), run after
// server-candidate resolution and strictly before the psi_freeze_agt002_governed_document_workset
// RPC (which both freezes and enqueues): a package predicted to need more operational batches than
// the route's server-owned ceiling is rejected here, before anything is queued.
export const AGT002_GOVERNED_WORKSET_CAPACITY_REJECTED_CODE = 'agt002_governed_workset_capacity_rejected';
export const AGT002_GOVERNED_WORKSET_CAPACITY_UNAVAILABLE_CODE = 'agt002_governed_workset_capacity_unavailable';

function governedWorksetCapacityRejectedError(capacity) {
  const error = governedWorksetError(
    422,
    AGT002_GOVERNED_WORKSET_CAPACITY_REJECTED_CODE,
    'El paquete documental gobernado AGT-002 excede la capacidad operativa de lotes de esta ruta.',
  );
  error.report = Object.freeze({
    code: AGT002_GOVERNED_WORKSET_CAPACITY_REJECTED_CODE,
    criterion: capacity.verdict,
    predicted_batch_count: capacity.predicted_batch_count,
    max_batch_count: capacity.max_batch_count,
    source_char_count: capacity.source_char_count,
  });
  return error;
}

function governedWorksetCapacityUnavailableError() {
  const error = governedWorksetError(
    503,
    AGT002_GOVERNED_WORKSET_CAPACITY_UNAVAILABLE_CODE,
    'La verificación de capacidad operativa AGT-002 no está disponible.',
  );
  error.report = Object.freeze({ code: AGT002_GOVERNED_WORKSET_CAPACITY_UNAVAILABLE_CODE });
  return error;
}

/**
 * Derives SERVER-RESOLVED size evidence for the capacity preflight strictly from the candidate
 * rows psi_resolve_agt002_governed_document_candidate already returned — never from the client
 * request. A missing/malformed extracted_text_char_count on any candidate fails closed (returns
 * null) rather than guessing or defaulting a package's size.
 */
function deriveAgt002GovernedWorksetCapacityEvidence(evidenceRows) {
  if (!Array.isArray(evidenceRows) || evidenceRows.length === 0) return null;
  let sourceCharCount = 0;
  for (const row of evidenceRows) {
    const count = row?.extracted_text_char_count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null;
    sourceCharCount += count;
  }
  return {
    source_char_count: sourceCharCount,
    chars_per_batch: AGT002_GOVERNED_WORKSET_CHARS_PER_BATCH,
    document_count: evidenceRows.length,
  };
}

/**
 * Evaluates the route's operational batch-capacity preflight against server-resolved candidate
 * evidence. Fails closed with a safe 503 when the evidence or the module's policy is
 * unavailable/malformed; rejects with a safe 422 (carrying the closed capacity report) when the
 * package is NO_APTO. Returns the closed, safe capacity result on APTO.
 */
export function evaluateAgt002GovernedWorksetFreezeCapacityPreflight(evidenceRows) {
  const evidence = deriveAgt002GovernedWorksetCapacityEvidence(evidenceRows);
  if (!evidence) throw governedWorksetCapacityUnavailableError();
  let capacity;
  try {
    capacity = evaluateAgt002GovernedWorksetCapacity({ route: AGT002_GOVERNED_WORKSET_FREEZE_ROUTE, evidence });
  } catch {
    throw governedWorksetCapacityUnavailableError();
  }
  if (capacity.verdict !== AGT002_GOVERNED_WORKSET_APTO) throw governedWorksetCapacityRejectedError(capacity);
  return capacity;
}

function requireId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} es obligatorio.`);
  return value;
}

/**
 * Closed top-level request shape: exactly opportunity_id and documents[]. tender_id is never a
 * client input — the browser has no reliable tender_id before the first AGT-002 run, so the
 * caller resolves it server-side via getTenderIdForOpportunity after this validates. Any other
 * key (a client-declared tender id, snapshot id, hash, extraction id, or anything else) is
 * rejected before any DB access, never silently ignored. Per-document validation (allowed keys,
 * UUID format, closed source_classification vocabulary, non-blank bounded inclusion_reason,
 * dedup, 1..12 bound) is delegated to the already-tested normalizeRequestedAgt002WorksetMembers.
 */
export function validateAgt002GovernedWorksetFreezeRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidGovernedWorksetInputError('El cuerpo de la solicitud no es válido.');
  }
  const extraKeys = Object.keys(body).filter((key) => !ALLOWED_REQUEST_KEYS.has(key));
  if (extraKeys.length > 0) {
    throw invalidGovernedWorksetInputError(`El cuerpo sólo admite opportunity_id y documents; clave(s) inesperada(s): ${extraKeys.join(', ')}.`);
  }
  const opportunityId = body.opportunity_id;
  if (typeof opportunityId !== 'string' || !UUID_RE.test(opportunityId)) {
    throw invalidGovernedWorksetInputError('opportunity_id debe ser un UUID.');
  }
  const canonicalOpportunityId = opportunityId.toLowerCase();
  let requestedMembers;
  try {
    requestedMembers = normalizeRequestedAgt002WorksetMembers(body.documents);
  } catch (error) {
    throw invalidGovernedWorksetInputError(error.message);
  }
  return { opportunityId: canonicalOpportunityId, requestedMembers };
}

// §18-style closed errcode -> HTTP/code mapping, mirroring agt002-actionable-review-http.js's
// convention for the migration-084 RPCs' own closed error vocabulary.
const RPC_ERROR_STATUS_BY_CODE = {
  '22023': [400, 'invalid_governed_workset_input'],
  '42501': [403, 'governed_workset_forbidden'],
  P0002: [404, 'governed_workset_reference_not_found'],
  '55000': [409, 'governed_workset_conflict'],
  '23505': [409, 'governed_workset_conflict'],
};
export function mapAgt002GovernedWorksetFreezeRpcError(rpcError) {
  const mapped = RPC_ERROR_STATUS_BY_CODE[rpcError?.code];
  if (!mapped) return governedWorksetError(500, 'governed_workset_internal_error', 'No se pudo procesar el paquete documental gobernado AGT-002.');
  return governedWorksetError(mapped[0], mapped[1], rpcError.message || 'No se pudo procesar el paquete documental gobernado AGT-002.');
}

/**
 * Resolves each requested member's frozen evidence through
 * psi_resolve_agt002_governed_document_candidate — one call per requested member, in canonical
 * order — never a bulk/listing query. The first failure aborts immediately (fail closed, no
 * partial packages): the loop never continues past an error to resolve the remaining members.
 */
export async function resolveAgt002GovernedWorksetCandidates(database, { opportunityId, tenderId, requestedMembers }) {
  const evidenceRows = [];
  for (const member of requestedMembers) {
    const { data, error } = await database.rpc('psi_resolve_agt002_governed_document_candidate', {
      p_opportunity_id: opportunityId,
      p_tender_id: tenderId,
      p_document_version_id: member.document_version_id,
    });
    if (error) throw mapAgt002GovernedWorksetFreezeRpcError(error);
    if (!data || typeof data !== 'object') {
      throw governedWorksetConflictError('La resolución de un documento del paquete gobernado no devolvió un resultado válido.');
    }
    evidenceRows.push(data);
  }
  return evidenceRows;
}

/**
 * The exact (opportunity, tender) scope's most recently registered document snapshot id — an
 * id-only lookup, never a read of the documents/manifest a snapshot carries. A tender that has
 * never had a document snapshot registered fails closed: a governed workset can never be frozen
 * against a scope that has no snapshot to bind its queue identity to.
 */
export async function findLatestAgt002GovernedWorksetSnapshotId(database, { opportunityId, tenderId }) {
  const { data, error } = await database
    .from('psi_tender_document_snapshots')
    .select('id')
    .eq('opportunity_id', opportunityId)
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message || String(error));
  if (!data?.id) {
    throw governedWorksetConflictError('No existe un snapshot documental registrado para esta licitación; ejecute un análisis AGT-002 antes de congelar un paquete gobernado.');
  }
  return data.id;
}

/** Same id-only-lookup shape as findLatestAgt002GovernedWorksetSnapshotId, scoped additionally to the resolved snapshot. */
export async function findLatestAgt002GovernedWorksetContextVersionId(database, { opportunityId, tenderId, snapshotId }) {
  const { data, error } = await database
    .from('psi_agt002_context_versions')
    .select('id')
    .eq('opportunity_id', opportunityId)
    .eq('tender_id', tenderId)
    .eq('snapshot_id', snapshotId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message || String(error));
  if (!data?.id) {
    throw governedWorksetConflictError('No existe una versión de contexto AGT-002 registrada para este snapshot; ejecute un análisis AGT-002 antes de congelar un paquete gobernado.');
  }
  return data.id;
}

/** JSON-clones `value`, failing closed if it is not JSON-safe — never trusts a source verbatim. */
function cloneAgt002GovernedWorksetJson(value, label) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
    return JSON.parse(serialized);
  } catch {
    throw new Error(`AGT-002 governed workset ${label} must be JSON-safe.`);
  }
}

/** Recursively freezes every array/object reachable from `value` — not only the root. */
function deepFreezeAgt002GovernedWorksetJson(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeAgt002GovernedWorksetJson(item);
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreezeAgt002GovernedWorksetJson(value[key]);
    return Object.freeze(value);
  }
  return value;
}

/**
 * A "canonical base frozen input" is exactly what buildAgt002FrozenEngineInput itself produces
 * for a NEW job — schema_version, a real engine_identity/idempotency_key, resolved
 * analysis_flags and an analysis_context — and NOT already carrying this route's own governed
 * extension (document_workset_identity/governed_workset_members), which only this function may
 * append. Never trusted verbatim: a corrupted/hostile/legacy-shaped source is rejected here,
 * before any of its fields reach a queued job.
 */
function assertCanonicalAgt002GovernedWorksetFrozenEngineInputSource(source) {
  if (source == null || typeof source !== 'object' || Array.isArray(source)
    || source.schema_version !== 2
    || source.engine_identity == null || typeof source.engine_identity !== 'object' || Array.isArray(source.engine_identity)
    || typeof source.engine_identity.idempotency_key !== 'string' || !source.engine_identity.idempotency_key.trim()
    || source.analysis_flags == null || typeof source.analysis_flags !== 'object' || Array.isArray(source.analysis_flags)
    || source.analysis_context == null || typeof source.analysis_context !== 'object' || Array.isArray(source.analysis_context)
    || Object.hasOwn(source, 'document_workset_identity')
    || Object.hasOwn(source, 'governed_workset_members')) {
    throw new Error('AGT-002 governed workset frozen engine input source is not a canonical base frozen input.');
  }
}

/**
 * Worker/job payload identity contract: the ONLY document identity this function can ever emit
 * is derived from `frozen.members` — the already-bounded (1..12), already-evidence-verified
 * frozen package. There is no parameter here through which "every current tender document"
 * could enter the engine input, structurally: the function never receives (and could not
 * accept) a live document list.
 *
 * `frozenEngineInputSource` is REQUIRED and must be a canonical base frozen input built by
 * buildAgt002FrozenEngineInput (never a locally-shadowed shape): its analysis_context must carry
 * the SAME opportunity/snapshot this freeze is producing for, and its engine_identity's
 * idempotency_key must equal the caller-supplied `idempotencyKey`, which itself must equal the
 * server-computed computeAgt002GovernedWorksetIdempotencyKey for this exact
 * opportunity/tender/snapshot/context/selection tuple — never a client- or caller-chosen value.
 * The output preserves every canonical source field untouched and appends only
 * document_workset_identity/governed_workset_members, then is JSON-cloned (the source is never
 * mutated) and deep-frozen.
 */
export function buildAgt002GovernedWorksetFrozenEngineInput({
  opportunityId, tenderId, snapshotId, contextVersionId, frozen, frozenEngineInputSource, idempotencyKey,
}) {
  assertCanonicalAgt002GovernedWorksetFrozenEngineInputSource(frozenEngineInputSource);

  const analysisContext = frozenEngineInputSource.analysis_context;
  if (analysisContext.opportunity?.id !== opportunityId || analysisContext.snapshotId !== snapshotId) {
    throw new Error('AGT-002 governed workset frozen engine input source analysis_context does not match this freeze scope.');
  }

  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw new Error('AGT-002 governed workset idempotency key is required.');
  }
  const expectedIdempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({
    opportunityId, tenderId, snapshotId, contextVersionId, selectionHash: frozen.selectionHash,
  });
  if (idempotencyKey !== expectedIdempotencyKey || frozenEngineInputSource.engine_identity.idempotency_key !== idempotencyKey) {
    throw new Error('AGT-002 governed workset idempotency key does not match the frozen engine input source.');
  }

  const documentWorksetIdentity = {
    opportunity_id: opportunityId,
    tender_id: tenderId,
    snapshot_id: snapshotId,
    context_version_id: contextVersionId,
    selection_hash: frozen.selectionHash,
  };
  // The full evidence-bearing six-field shape — the same shape the executor's
  // validateAgt002GovernedWorksetExtension re-validates and the same shape the selection hash is
  // computed over — never the public three-field projection (that stays exclusively
  // analysis_context.documents' shape, projected separately below via frozen.members).
  const governedWorksetMembers = frozen.members.map((member) => ({
    document_version_id: member.document_version_id,
    source_classification: member.source_classification,
    inclusion_reason: member.inclusion_reason,
    content_hash: member.content_hash,
    extraction_id: member.extraction_id,
    extraction_text_hash: member.extraction_text_hash,
  }));

  const composed = cloneAgt002GovernedWorksetJson({
    ...frozenEngineInputSource,
    document_workset_identity: documentWorksetIdentity,
    governed_workset_members: governedWorksetMembers,
  }, 'frozen engine input');
  return deepFreezeAgt002GovernedWorksetJson(composed);
}

const FREEZE_RESULT_KEYS = ['status', 'workset_id', 'run_id', 'reanalysis_job_id', 'member_count', 'selection_hash', 'capacity_preflight'];

/** Sanitized public projection: the six closed identity/status fields plus the closed capacity
 * preflight result (never raw text or raw candidate evidence), defense-in-depth stripped through
 * the same banned-key guard as publicAgt002WorksetSummary. */
export function projectAgt002GovernedWorksetFreezeResult(result) {
  const projected = {};
  for (const key of FREEZE_RESULT_KEYS) projected[key] = result[key];
  return publicAgt002WorksetSummary(projected);
}

/**
 * Full server-side resolve -> validate -> freeze -> enqueue orchestration for one governed
 * document workset. Transactional atomicity (freeze + enqueue together, or neither) lives
 * entirely inside psi_freeze_agt002_governed_document_workset (migration 084); this function
 * only ever makes ONE call to it.
 */
export async function freezeAgt002GovernedDocumentWorkset(database, {
  opportunityId, tenderId, actorProfileId, requestedMembers, buildFrozenEngineInputSource,
}) {
  requireId(actorProfileId, 'El actor');
  // The server-owned frozen-engine-input source factory is mandatory and is checked before any
  // database RPC work — there is no default/local input this function may ever compose instead,
  // so a caller that forgets to wire one fails closed immediately rather than queuing a job with
  // a fabricated payload.
  if (typeof buildFrozenEngineInputSource !== 'function') {
    throw new Error('AGT-002 governed workset freeze requires an explicit server-owned buildFrozenEngineInputSource callback.');
  }
  const evidenceRows = await resolveAgt002GovernedWorksetCandidates(database, { opportunityId, tenderId, requestedMembers });
  const frozen = freezeAgt002WorksetEvidence({ opportunityId, tenderId, requestedMembers, evidenceRows });

  // Operational batch-capacity preflight: server-resolved candidate evidence only, evaluated
  // strictly before the freeze RPC below (which both freezes AND enqueues). NO_APTO or an
  // unavailable preflight must never reach the freeze/enqueue call.
  const capacity = evaluateAgt002GovernedWorksetFreezeCapacityPreflight(evidenceRows);

  const snapshotId = await findLatestAgt002GovernedWorksetSnapshotId(database, { opportunityId, tenderId });
  const contextVersionId = await findLatestAgt002GovernedWorksetContextVersionId(database, { opportunityId, tenderId, snapshotId });
  const idempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({
    opportunityId, tenderId, snapshotId, contextVersionId, selectionHash: frozen.selectionHash,
  });
  // The canonical frozen-engine-input SOURCE is built only after the snapshot, context version,
  // idempotency identity AND resolved evidence are all known — never before — so the source
  // factory can bind the exact identity/evidence this freeze is producing.
  const frozenEngineInputSource = await buildFrozenEngineInputSource({
    opportunityId, tenderId, snapshotId, contextVersionId, idempotencyKey, frozen, evidenceRows,
  });
  const frozenEngineInput = buildAgt002GovernedWorksetFrozenEngineInput({
    opportunityId, tenderId, snapshotId, contextVersionId, frozen, frozenEngineInputSource, idempotencyKey,
  });
  const pMembers = frozen.members.map((member) => ({
    document_version_id: member.document_version_id,
    source_classification: member.source_classification,
    inclusion_reason: member.inclusion_reason,
    content_hash: member.content_hash,
    extraction_id: member.extraction_id,
    extraction_text_hash: member.extraction_text_hash,
  }));
  const { data, error } = await database.rpc('psi_freeze_agt002_governed_document_workset', {
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_snapshot_id: snapshotId,
    p_context_version_id: contextVersionId,
    p_idempotency_key: idempotencyKey,
    p_members: pMembers,
    p_frozen_engine_input: frozenEngineInput,
    p_actor_profile_id: actorProfileId,
  });
  if (error) throw mapAgt002GovernedWorksetFreezeRpcError(error);
  if (!data || !['created', 'existing'].includes(data.status)
    || typeof data.workset_id !== 'string' || !data.workset_id
    || typeof data.run_id !== 'string' || !data.run_id
    || typeof data.reanalysis_job_id !== 'string' || !data.reanalysis_job_id
    || typeof data.member_count !== 'number'
    || typeof data.selection_hash !== 'string' || !data.selection_hash) {
    throw governedWorksetConflictError('La congelación del paquete documental gobernado AGT-002 no devolvió un resultado válido.');
  }
  return { ...data, capacity_preflight: capacity };
}
