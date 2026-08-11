import { createHash } from 'node:crypto';

// Pure, server-only persistence/selection logic for migration 065
// (psi_tender_document_extractions). No DB/network access here: server/index.js and
// api/[...path].js own the actual RPC calls/queries and pass their results through
// these functions. Kept separate from tender-document-text-extraction.js (the parser)
// so the "what do we store, pick and expose" policy is independently testable and
// independently provable never to reach the browser (see the import-boundary test).

function nonEmptyString(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

/**
 * Normalizes a typed extraction result (tender-document-text-extraction.js's
 * extractTenderDocumentText output) into the exact params for the
 * psi_record_tender_document_extraction RPC (migration 065). Never persists a
 * fabricated success: an 'ok' extraction must carry real non-blank text with a
 * valid SHA-256 hash; a 'gap' extraction always carries null text/hash, zeroed
 * counts and a non-blank gap_reason.
 */
export function buildTenderDocumentExtractionRpcParams(extraction, { opportunityId, tenderId, documentVersionId, actorId }) {
  if (!extraction || typeof extraction !== 'object') throw new Error('El resultado de extracción es obligatorio.');
  if (!nonEmptyString(opportunityId) || !nonEmptyString(tenderId) || !nonEmptyString(documentVersionId) || !nonEmptyString(actorId)) {
    throw new Error('La oportunidad, licitación, versión documental y actor son obligatorios.');
  }
  if (extraction.status !== 'ok' && extraction.status !== 'gap') {
    throw new Error('El estado de la extracción debe ser ok o gap.');
  }
  const extractorVersion = nonEmptyString(extraction.extractor_version);
  const parser = nonEmptyString(extraction.parser);
  if (!extractorVersion || !parser) throw new Error('La versión del extractor y el parser son obligatorios.');
  const metadata = extraction.metadata && typeof extraction.metadata === 'object' && !Array.isArray(extraction.metadata)
    ? extraction.metadata
    : {};

  if (extraction.status === 'ok') {
    const text = typeof extraction.text === 'string' ? extraction.text : '';
    if (!text.trim()) throw new Error('Una extracción ok requiere texto no vacío.');
    const textHash = String(extraction.text_hash || '');
    if (!/^[0-9a-f]{64}$/.test(textHash)) throw new Error('El hash de texto debe ser SHA-256 hexadecimal en minúscula.');
    const computedTextHash = createHash('sha256').update(text, 'utf8').digest('hex');
    if (textHash !== computedTextHash) throw new Error('El hash de texto no coincide con el texto extraído.');
    return {
      p_opportunity_id: opportunityId, p_tender_id: tenderId, p_document_version_id: documentVersionId,
      p_extractor_version: extractorVersion, p_status: 'ok', p_parser: parser,
      p_extracted_text: text, p_text_hash: textHash,
      p_char_count: text.length, p_text_byte_count: Buffer.byteLength(text, 'utf8'),
      p_metadata: metadata, p_gap_reason: null, p_actor_id: actorId,
    };
  }

  const gapReason = nonEmptyString(extraction.metadata?.gap_reason);
  if (!gapReason) throw new Error('Una extracción gap requiere gap_reason.');
  return {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_document_version_id: documentVersionId,
    p_extractor_version: extractorVersion, p_status: 'gap', p_parser: parser,
    p_extracted_text: null, p_text_hash: null, p_char_count: 0, p_text_byte_count: 0,
    p_metadata: metadata, p_gap_reason: gapReason, p_actor_id: actorId,
  };
}

function isWellFormedExtractionRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.status === 'ok') {
    return typeof row.extracted_text === 'string' && row.extracted_text.trim().length > 0
      && typeof row.text_hash === 'string' && /^[0-9a-f]{64}$/.test(row.text_hash)
      && row.text_hash === createHash('sha256').update(row.extracted_text, 'utf8').digest('hex')
      && Number.isInteger(row.char_count) && row.char_count > 0
      && row.char_count === row.extracted_text.length;
  }
  if (row.status === 'gap') return true;
  return false;
}

function extractionRank(row) {
  return row.status === 'ok' ? 1 : 0;
}

function isBetterExtractionRow(candidate, incumbent) {
  const candidateRank = extractionRank(candidate);
  const incumbentRank = extractionRank(incumbent);
  if (candidateRank !== incumbentRank) return candidateRank > incumbentRank;
  const candidateTime = Date.parse(candidate.created_at || '') || 0;
  const incumbentTime = Date.parse(incumbent.created_at || '') || 0;
  if (candidateTime !== incumbentTime) return candidateTime > incumbentTime;
  return String(candidate.id ?? '') > String(incumbent.id ?? '');
}

/**
 * Deterministically chooses, per document_version_id, the extraction row that should
 * be treated as canonical: the latest 'ok' row (by created_at, then stable id) always
 * wins over any 'gap' row, however recent. A 'gap' row only surfaces when no 'ok' row
 * exists at all for that version. Malformed rows (claiming 'ok' without a trustworthy
 * text/hash/char_count) are skipped entirely — fail closed rather than trusting
 * possibly-corrupt data.
 */
export function selectCanonicalExtractionsByDocumentVersion(rows) {
  const byVersion = new Map();
  for (const row of rows || []) {
    if (!isWellFormedExtractionRow(row)) continue;
    const versionId = row.document_version_id;
    if (!versionId) continue;
    const incumbent = byVersion.get(versionId);
    if (!incumbent || isBetterExtractionRow(row, incumbent)) byVersion.set(versionId, row);
  }
  return byVersion;
}

/**
 * Merges the canonical extraction (if any) into a document record: an 'ok' extraction
 * replaces extracted_text outright (even when much larger than the legacy column); a
 * 'gap' extraction never fabricates text (fallback text is discarded, not merged in);
 * legacy fallback text is used only when no extraction row exists at all for this
 * document version.
 */
export function mergeCanonicalExtractionIntoDocument(document, extractionRow, legacyExtractedText) {
  const base = { ...document };
  if (!extractionRow) {
    return { ...base, extracted_text: legacyExtractedText ?? '', extraction_status: 'legacy' };
  }
  if (extractionRow.status === 'ok') {
    return {
      ...base,
      extracted_text: extractionRow.extracted_text,
      extraction_status: 'ok',
      extraction_version: extractionRow.extractor_version,
      extraction_parser: extractionRow.parser,
      extraction_char_count: extractionRow.char_count,
      extraction_text_hash: extractionRow.text_hash,
    };
  }
  return {
    ...base,
    extracted_text: '',
    extraction_status: 'gap',
    extraction_version: extractionRow.extractor_version,
    extraction_parser: extractionRow.parser,
    extraction_char_count: 0,
    extraction_text_hash: null,
    extraction_gap_reason: extractionRow.gap_reason ?? null,
  };
}

/**
 * Safe, browser-facing projection of a document record: strips the full extracted
 * text and any raw metadata/error, keeping only bounded/typed extraction summary
 * fields (status, extractor version, parser, char count, hash, gap reason).
 */
export function publicTenderDocumentProjection(document = {}) {
  const { extracted_text, metadata, error, ...safe } = document || {};
  if (!safe.extraction_status) safe.extraction_status = 'legacy';
  return safe;
}
