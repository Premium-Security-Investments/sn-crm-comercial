// AGT-002 P0-02 — neutral initial-analysis evidence package, pure logic half.
//
// Distinct, neutral module belonging to the initial-analysis slice
// (docs/agt002/initial-analysis/CURRENT.md) — never imported by, and never imports, any
// agt002-reanalysis-*.js module. Unlike the governed workset's normalizer/freezer this mirrors
// the shape of, there is no functional package-member upper bound here: only a per-BATCH cap of
// AGT002_EVIDENCE_PACKAGE_BATCH_SIZE, and a package computes three distinct deterministic digests
// (document_manifest_hash, semantic_manifest_hash, package_hash) instead of a single selection hash.
import crypto from 'node:crypto';

export const AGT002_EVIDENCE_PACKAGE_SOURCE_CLASSIFICATIONS = Object.freeze(
  new Set(['official', 'corporate', 'internal', 'third_party', 'draft']),
);

export const AGT002_EVIDENCE_PACKAGE_BATCH_SIZE = 12;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_LOWER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64_LOWER_RE = /^[0-9a-f]{64}$/;
const ALLOWED_MEMBER_KEYS = new Set(['document_version_id', 'source_classification', 'inclusion_reason']);

const MIN_MEMBERS = 1;
const MAX_REASON_LENGTH = 500;

function sortByDocumentVersionId(members) {
  return [...members].sort((a, b) =>
    a.document_version_id < b.document_version_id ? -1 : a.document_version_id > b.document_version_id ? 1 : 0,
  );
}

export function normalizeRequestedAgt002EvidencePackageMembers(requestedMembers) {
  if (!Array.isArray(requestedMembers) || requestedMembers.length < MIN_MEMBERS) {
    throw new Error('At least one requested member is required.');
  }

  const normalized = requestedMembers.map((member) => {
    if (member == null || typeof member !== 'object') {
      throw new Error('Each requested member must be an object.');
    }

    const extraKeys = Object.keys(member).filter((key) => !ALLOWED_MEMBER_KEYS.has(key));
    if (extraKeys.length > 0) {
      throw new Error(`Requested member carries unexpected key(s): ${extraKeys.join(', ')}`);
    }

    const { document_version_id, source_classification, inclusion_reason } = member;

    if (typeof document_version_id !== 'string' || !UUID_RE.test(document_version_id)) {
      throw new Error('document_version_id must be a well-formed UUID.');
    }
    const canonicalDocumentVersionId = document_version_id.toLowerCase();

    if (!AGT002_EVIDENCE_PACKAGE_SOURCE_CLASSIFICATIONS.has(source_classification)) {
      throw new Error(`Unknown source_classification: ${source_classification}`);
    }

    if (typeof inclusion_reason !== 'string') {
      throw new Error('inclusion_reason must be a string.');
    }
    const trimmedReason = inclusion_reason.trim();
    if (trimmedReason.length === 0) {
      throw new Error('inclusion_reason must not be blank.');
    }
    if (trimmedReason.length > MAX_REASON_LENGTH) {
      throw new Error(`inclusion_reason must be at most ${MAX_REASON_LENGTH} characters.`);
    }

    return {
      document_version_id: canonicalDocumentVersionId,
      source_classification,
      inclusion_reason: trimmedReason,
    };
  });

  const seen = new Set();
  for (const member of normalized) {
    if (seen.has(member.document_version_id)) {
      throw new Error(`Duplicate document_version_id: ${member.document_version_id}`);
    }
    seen.add(member.document_version_id);
  }

  return sortByDocumentVersionId(normalized);
}

/** Deterministic partition into batches of at most AGT002_EVIDENCE_PACKAGE_BATCH_SIZE members,
 * sorted by document_version_id so the partition is independent of input order. Every member
 * appears in exactly one batch. */
export function partitionAgt002EvidencePackageBatches(members) {
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error('At least one member is required to partition into batches.');
  }

  const sorted = sortByDocumentVersionId(members);
  const batches = [];
  for (let i = 0; i < sorted.length; i += AGT002_EVIDENCE_PACKAGE_BATCH_SIZE) {
    batches.push({
      batch_index: batches.length,
      members: sorted.slice(i, i + AGT002_EVIDENCE_PACKAGE_BATCH_SIZE),
    });
  }
  return batches;
}

export function freezeAgt002EvidencePackageEvidence({ opportunityId, tenderId, requestedMembers, evidenceRows }) {
  if (typeof opportunityId !== 'string' || !UUID_LOWER_RE.test(opportunityId)) {
    throw new Error('opportunityId must be a well-formed lowercase UUID.');
  }
  if (typeof tenderId !== 'string' || !UUID_LOWER_RE.test(tenderId)) {
    throw new Error('tenderId must be a well-formed lowercase UUID.');
  }
  if (!Array.isArray(evidenceRows)) {
    throw new Error('evidenceRows must be an array.');
  }

  const members = normalizeRequestedAgt002EvidencePackageMembers(requestedMembers);

  if (evidenceRows.length !== members.length) {
    throw new Error('Evidence row count does not match requested member count.');
  }

  const evidenceByDocId = new Map();
  for (const row of evidenceRows) {
    if (row == null || typeof row !== 'object') {
      throw new Error('Malformed evidence row.');
    }
    if (typeof row.document_version_id !== 'string' || !UUID_LOWER_RE.test(row.document_version_id)) {
      throw new Error('Evidence row document_version_id must be a well-formed lowercase UUID.');
    }
    if (typeof row.opportunity_id !== 'string' || !UUID_LOWER_RE.test(row.opportunity_id)) {
      throw new Error('Evidence row opportunity_id must be a well-formed lowercase UUID.');
    }
    if (typeof row.tender_id !== 'string' || !UUID_LOWER_RE.test(row.tender_id)) {
      throw new Error('Evidence row tender_id must be a well-formed lowercase UUID.');
    }
    if (typeof row.extraction_id !== 'string' || !UUID_LOWER_RE.test(row.extraction_id)) {
      throw new Error('Evidence row extraction_id must be a well-formed lowercase UUID.');
    }
    if (typeof row.content_hash !== 'string' || !HEX64_LOWER_RE.test(row.content_hash)) {
      throw new Error('Evidence row content_hash must be a well-formed lowercase 64-hex digest.');
    }
    if (typeof row.extraction_text_hash !== 'string' || !HEX64_LOWER_RE.test(row.extraction_text_hash)) {
      throw new Error('Evidence row extraction_text_hash must be a well-formed lowercase 64-hex digest.');
    }
    if (evidenceByDocId.has(row.document_version_id)) {
      throw new Error(`Duplicate evidence row for document_version_id: ${row.document_version_id}`);
    }
    evidenceByDocId.set(row.document_version_id, row);
  }

  const frozenMembers = members.map((member) => {
    const evidence = evidenceByDocId.get(member.document_version_id);
    if (!evidence) {
      throw new Error(`No matching evidence row for document_version_id: ${member.document_version_id}`);
    }
    if (evidence.opportunity_id !== opportunityId) {
      throw new Error('Evidence row belongs to a different opportunity.');
    }
    if (evidence.tender_id !== tenderId) {
      throw new Error('Evidence row belongs to a different tender.');
    }
    if (evidence.current !== true) {
      throw new Error('Evidence row is not current.');
    }
    if (evidence.extraction_status !== 'ok') {
      throw new Error('Evidence row extraction_status is not ok.');
    }

    return {
      document_version_id: member.document_version_id,
      source_classification: member.source_classification,
      inclusion_reason: member.inclusion_reason,
      content_hash: evidence.content_hash,
      extraction_id: evidence.extraction_id,
      extraction_text_hash: evidence.extraction_text_hash,
    };
  });

  const documentManifestHash = computeAgt002EvidencePackageDocumentManifestHash({
    opportunityId, tenderId, members: frozenMembers,
  });
  const semanticManifestHash = computeAgt002EvidencePackageSemanticManifestHash({
    opportunityId, tenderId, members: frozenMembers,
  });
  const packageHash = computeAgt002EvidencePackageHash({
    opportunityId, tenderId, documentManifestHash, semanticManifestHash,
  });
  const batches = partitionAgt002EvidencePackageBatches(frozenMembers);

  return {
    opportunityId,
    tenderId,
    members: frozenMembers,
    batches,
    documentManifestHash,
    semanticManifestHash,
    packageHash,
  };
}

/** Identity-only digest: document_version_id + content_hash. Deliberately independent of
 * source_classification/inclusion_reason (provenance/usage), which belong only to the semantic
 * manifest below. Order-independent over `members`. */
export function computeAgt002EvidencePackageDocumentManifestHash({ opportunityId, tenderId, members }) {
  const sorted = sortByDocumentVersionId(members);
  const canonicalPayload = JSON.stringify({
    kind: 'agt002_evidence_package_document_manifest',
    opportunityId,
    tenderId,
    members: sorted.map((m) => ({
      document_version_id: m.document_version_id,
      content_hash: m.content_hash,
    })),
  });
  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

/** Provenance/usage-aware digest: document_version_id, source_classification, inclusion_reason,
 * extraction_text_hash. Order-independent over `members`. */
export function computeAgt002EvidencePackageSemanticManifestHash({ opportunityId, tenderId, members }) {
  const sorted = sortByDocumentVersionId(members);
  const canonicalPayload = JSON.stringify({
    kind: 'agt002_evidence_package_semantic_manifest',
    opportunityId,
    tenderId,
    members: sorted.map((m) => ({
      document_version_id: m.document_version_id,
      source_classification: m.source_classification,
      inclusion_reason: m.inclusion_reason,
      extraction_text_hash: m.extraction_text_hash,
    })),
  });
  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

export function computeAgt002EvidencePackageHash({ opportunityId, tenderId, documentManifestHash, semanticManifestHash }) {
  const canonicalPayload = JSON.stringify({
    kind: 'agt002_evidence_package_hash',
    opportunityId,
    tenderId,
    documentManifestHash,
    semanticManifestHash,
  });
  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

export function computeAgt002EvidencePackageIdempotencyKey({ opportunityId, tenderId, packageHash }) {
  const canonicalPayload = JSON.stringify({
    kind: 'agt002_evidence_package_idempotency',
    opportunityId,
    tenderId,
    packageHash,
  });
  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

const PUBLIC_SUMMARY_BANNED_KEYS = new Set([
  'extracted_text',
  'storage_path',
  'source_url',
  'signed_url',
  'raw_error',
]);

function stripBannedKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripBannedKeysDeep(item));
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      if (PUBLIC_SUMMARY_BANNED_KEYS.has(key)) continue;
      result[key] = stripBannedKeysDeep(val);
    }
    return result;
  }
  return value;
}

export function publicAgt002EvidencePackageSummary(evidencePackage) {
  return stripBannedKeysDeep(evidencePackage);
}
