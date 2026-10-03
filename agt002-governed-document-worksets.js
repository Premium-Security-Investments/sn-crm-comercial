import crypto from 'node:crypto';

export const AGT002_WORKSET_SOURCE_CLASSIFICATIONS = Object.freeze(
  new Set(['official', 'corporate', 'internal', 'third_party', 'draft']),
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_LOWER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64_LOWER_RE = /^[0-9a-f]{64}$/;
const ALLOWED_MEMBER_KEYS = new Set(['document_version_id', 'source_classification', 'inclusion_reason']);

const MIN_MEMBERS = 1;
const MAX_MEMBERS = 12;
const MAX_REASON_LENGTH = 500;

export function normalizeRequestedAgt002WorksetMembers(requestedMembers) {
  if (!Array.isArray(requestedMembers) || requestedMembers.length < MIN_MEMBERS) {
    throw new Error('At least one requested member is required.');
  }
  if (requestedMembers.length > MAX_MEMBERS) {
    throw new Error(`At most ${MAX_MEMBERS} requested members are allowed.`);
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

    if (!AGT002_WORKSET_SOURCE_CLASSIFICATIONS.has(source_classification)) {
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

  normalized.sort((a, b) =>
    a.document_version_id < b.document_version_id ? -1 : a.document_version_id > b.document_version_id ? 1 : 0,
  );

  return normalized;
}

/**
 * The single canonical selection-hash payload/digest: exactly
 * {opportunityId, tenderId, members:[{document_version_id, source_classification,
 * inclusion_reason, content_hash, extraction_id, extraction_text_hash}]}, JSON-stringified over
 * `members` in the order given (never re-sorted here — callers pass already-canonically-ordered
 * members). freezeAgt002WorksetEvidence and every re-verifier of a frozen selection (the
 * migration-084 freeze RPC, the reanalysis executor) must compute this identically, byte-for-byte.
 */
export function computeAgt002WorksetSelectionHash({ opportunityId, tenderId, members }) {
  const canonicalPayload = JSON.stringify({
    opportunityId,
    tenderId,
    members: members.map((m) => ({
      document_version_id: m.document_version_id,
      source_classification: m.source_classification,
      inclusion_reason: m.inclusion_reason,
      content_hash: m.content_hash,
      extraction_id: m.extraction_id,
      extraction_text_hash: m.extraction_text_hash,
    })),
  });
  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

export function freezeAgt002WorksetEvidence({ opportunityId, tenderId, requestedMembers, evidenceRows }) {
  if (typeof opportunityId !== 'string' || !UUID_LOWER_RE.test(opportunityId)) {
    throw new Error('opportunityId must be a well-formed lowercase UUID.');
  }
  if (typeof tenderId !== 'string' || !UUID_LOWER_RE.test(tenderId)) {
    throw new Error('tenderId must be a well-formed lowercase UUID.');
  }
  if (!Array.isArray(evidenceRows)) {
    throw new Error('evidenceRows must be an array.');
  }

  const members = normalizeRequestedAgt002WorksetMembers(requestedMembers);

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

  const selectionHash = computeAgt002WorksetSelectionHash({ opportunityId, tenderId, members: frozenMembers });

  return {
    opportunityId,
    tenderId,
    members: frozenMembers,
    selectionHash,
  };
}

const PUBLIC_SUMMARY_BANNED_KEYS = new Set([
  'extracted_text',
  'storage_path',
  'source_url',
  'signed_url',
  'frozen_engine_input',
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

export function publicAgt002WorksetSummary(workset) {
  return stripBannedKeysDeep(workset);
}

export function computeAgt002GovernedWorksetIdempotencyKey({ opportunityId, tenderId, snapshotId, contextVersionId, selectionHash }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    kind: 'agt002_governed_document_workset',
    opportunity_id: opportunityId,
    tender_id: tenderId,
    snapshot_id: snapshotId,
    context_version_id: contextVersionId,
    selection_hash: selectionHash,
  })).digest('hex');
}
