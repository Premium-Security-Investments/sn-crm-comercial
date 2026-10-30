// AGT-002 P0-02 — neutral initial-analysis evidence package, DB-orchestration half.
//
// Mirrors the conventions of agt002-governed-document-workset-api.js. The critical difference:
// freezeAgt002EvidencePackage never enqueues any job (initial or reanalysis) —
// projectAgt002EvidencePackageFreezeResult's whitelist carries no job/run field at all. This
// module and agt002-evidence-packages.js belong exclusively to the initial-analysis slice
// (docs/agt002/initial-analysis/CURRENT.md) and must never reference the reanalysis operational
// surface (modules, tables, RPCs) that scripts/agt002_initial_analysis_guard.mjs (P0-00) guards.
import {
  computeAgt002EvidencePackageIdempotencyKey,
  freezeAgt002EvidencePackageEvidence,
  normalizeRequestedAgt002EvidencePackageMembers,
} from './agt002-evidence-packages.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_REQUEST_KEYS = new Set(['opportunity_id', 'documents']);

function evidencePackageError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function invalidEvidencePackageInputError(message) {
  return evidencePackageError(400, 'invalid_evidence_package_input', message);
}
export function evidencePackageConflictError(message) {
  return evidencePackageError(409, 'evidence_package_conflict', message);
}

function requireId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}

/**
 * Closed top-level request shape: exactly opportunity_id and documents[]. tender_id is never a
 * client input — the caller resolves it server-side before calling freezeAgt002EvidencePackage.
 * Per-document validation (allowed keys, UUID format, closed source_classification vocabulary,
 * non-blank bounded inclusion_reason, dedup — and NO functional package member limit) is
 * delegated to normalizeRequestedAgt002EvidencePackageMembers.
 */
export function validateAgt002EvidencePackageFreezeRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidEvidencePackageInputError('Request body must be an object.');
  }
  const extraKeys = Object.keys(body).filter((key) => !ALLOWED_REQUEST_KEYS.has(key));
  if (extraKeys.length > 0) {
    throw invalidEvidencePackageInputError(`Body only admits opportunity_id and documents; unexpected key(s): ${extraKeys.join(', ')}.`);
  }
  const opportunityId = body.opportunity_id;
  if (typeof opportunityId !== 'string' || !UUID_RE.test(opportunityId)) {
    throw invalidEvidencePackageInputError('opportunity_id must be a UUID.');
  }
  const canonicalOpportunityId = opportunityId.toLowerCase();
  let requestedMembers;
  try {
    requestedMembers = normalizeRequestedAgt002EvidencePackageMembers(body.documents);
  } catch (error) {
    throw invalidEvidencePackageInputError(error.message);
  }
  return { opportunityId: canonicalOpportunityId, requestedMembers };
}

// Closed errcode -> HTTP/code mapping for the evidence package resolve/freeze RPCs.
const RPC_ERROR_STATUS_BY_CODE = {
  '22023': [400, 'invalid_evidence_package_input'],
  '42501': [403, 'evidence_package_forbidden'],
  P0002: [404, 'evidence_package_reference_not_found'],
  '55000': [409, 'evidence_package_conflict'],
  '23505': [409, 'evidence_package_conflict'],
};
export function mapAgt002EvidencePackageFreezeRpcError(rpcError) {
  const mapped = RPC_ERROR_STATUS_BY_CODE[rpcError?.code];
  if (!mapped) return evidencePackageError(500, 'evidence_package_internal_error', 'Could not process the AGT-002 evidence package.');
  return evidencePackageError(mapped[0], mapped[1], rpcError.message || 'Could not process the AGT-002 evidence package.');
}

/**
 * Resolves each requested member's frozen evidence through
 * psi_resolve_agt002_evidence_package_candidate — one call per requested member, in canonical
 * order — never a bulk/listing query. The first failure aborts immediately (fail closed, no
 * partial packages): the loop never continues past an error to resolve the remaining members.
 */
export async function resolveAgt002EvidencePackageCandidates(database, { opportunityId, tenderId, requestedMembers }) {
  const evidenceRows = [];
  for (const member of requestedMembers) {
    const { data, error } = await database.rpc('psi_resolve_agt002_evidence_package_candidate', {
      p_opportunity_id: opportunityId,
      p_tender_id: tenderId,
      p_document_version_id: member.document_version_id,
    });
    if (error) throw mapAgt002EvidencePackageFreezeRpcError(error);
    if (!data || typeof data !== 'object') {
      throw evidencePackageConflictError('Resolving an evidence package document did not return a valid result.');
    }
    evidenceRows.push(data);
  }
  return evidenceRows;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const VALID_FREEZE_STATUSES = new Set(['created', 'existing', 'addendum']);

/**
 * Full server-side resolve -> validate -> freeze orchestration for one evidence package. Freezing
 * is the terminal operation here: unlike the governed workset route, this NEVER enqueues any
 * initial-analysis or reanalysis job — the freeze RPC's result carries no job/run identity field
 * at all.
 */
export async function freezeAgt002EvidencePackage(database, { opportunityId, tenderId, actorProfileId, requestedMembers }) {
  requireId(actorProfileId, 'actorProfileId');

  const evidenceRows = await resolveAgt002EvidencePackageCandidates(database, { opportunityId, tenderId, requestedMembers });
  const frozen = freezeAgt002EvidencePackageEvidence({ opportunityId, tenderId, requestedMembers, evidenceRows });

  const pMembers = frozen.members.map((member) => ({
    document_version_id: member.document_version_id,
    source_classification: member.source_classification,
    inclusion_reason: member.inclusion_reason,
    content_hash: member.content_hash,
    extraction_id: member.extraction_id,
    extraction_text_hash: member.extraction_text_hash,
  }));
  const idempotencyKey = computeAgt002EvidencePackageIdempotencyKey({
    opportunityId,
    tenderId,
    packageHash: frozen.packageHash,
  });

  const { data, error } = await database.rpc('psi_freeze_agt002_evidence_package', {
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_idempotency_key: idempotencyKey,
    p_actor_profile_id: actorProfileId,
    p_members: pMembers,
    p_document_manifest_hash: frozen.documentManifestHash,
    p_semantic_manifest_hash: frozen.semanticManifestHash,
    p_package_hash: frozen.packageHash,
  });
  if (error) throw mapAgt002EvidencePackageFreezeRpcError(error);
  if (!data || typeof data !== 'object'
    || !VALID_FREEZE_STATUSES.has(data.status)
    || !isNonEmptyString(data.package_id)
    || !isNonEmptyString(data.package_version_id)
    || typeof data.version_number !== 'number'
    || typeof data.batch_count !== 'number'
    || typeof data.member_count !== 'number'
    || !isNonEmptyString(data.package_hash)
    || !isNonEmptyString(data.document_manifest_hash)
    || !isNonEmptyString(data.semantic_manifest_hash)) {
    throw evidencePackageConflictError('Freezing the AGT-002 evidence package did not return a valid result.');
  }
  if (data.package_hash !== frozen.packageHash
    || data.document_manifest_hash !== frozen.documentManifestHash
    || data.semantic_manifest_hash !== frozen.semanticManifestHash
    || data.member_count !== frozen.members.length
    || data.batch_count !== frozen.batches.length) {
    throw evidencePackageConflictError('El resultado congelado no coincide con el paquete de evidencia calculado por el servidor.');
  }
  return data;
}

const FREEZE_RESULT_KEYS = [
  'status',
  'package_id',
  'package_version_id',
  'version_number',
  'batch_count',
  'member_count',
  'package_hash',
  'document_manifest_hash',
  'semantic_manifest_hash',
];

/** Sanitized public projection: exactly the closed identity/status/hash fields — no job/run field
 * in the vocabulary at all, so a malicious/accidental job/run field on the RPC result is always
 * stripped here regardless of what the RPC returned. */
export function projectAgt002EvidencePackageFreezeResult(result) {
  const projected = {};
  for (const key of FREEZE_RESULT_KEYS) projected[key] = result[key];
  return projected;
}
