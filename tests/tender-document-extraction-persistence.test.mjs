import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  buildTenderDocumentExtractionRpcParams,
  selectCanonicalExtractionsByDocumentVersion,
  mergeCanonicalExtractionIntoDocument,
  publicTenderDocumentProjection,
} from '../tender-document-extraction-persistence.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const ids = {
  opportunity: '44444444-4444-4444-8444-444444444444',
  tender: '55555555-5555-4555-8555-555555555555',
  version: '66666666-6666-4666-8666-666666666666',
  actor: '11111111-1111-4111-8111-111111111111',
};

function okExtraction(text = 'Objeto del contrato: vigilancia física.') {
  return {
    status: 'ok', text, extractor_version: 'tender-document-text-extraction@2', parser: 'pdf-parse',
    char_count: text.length, text_hash: hash(text), metadata: { num_pages: 3 },
  };
}
function gapExtraction(gapReason = 'extraction_error', error = 'RAW_SECRET /home/user/x.pdf') {
  return {
    status: 'gap', text: '', extractor_version: 'tender-document-text-extraction@2', parser: 'pdf',
    char_count: 0, text_hash: hash(''), metadata: { gap_reason: gapReason, error },
  };
}

// --- buildTenderDocumentExtractionRpcParams ---------------------------------
await (async function normalizesOkExtractionIntoExactRpcParams() {
  const extraction = okExtraction('Texto real del pliego.');
  const params = buildTenderDocumentExtractionRpcParams(extraction, {
    opportunityId: ids.opportunity, tenderId: ids.tender, documentVersionId: ids.version, actorId: ids.actor,
  });
  assert.deepEqual(params, {
    p_opportunity_id: ids.opportunity, p_tender_id: ids.tender, p_document_version_id: ids.version,
    p_extractor_version: 'tender-document-text-extraction@2', p_status: 'ok', p_parser: 'pdf-parse',
    p_extracted_text: 'Texto real del pliego.', p_text_hash: hash('Texto real del pliego.'),
    p_char_count: 'Texto real del pliego.'.length, p_text_byte_count: Buffer.byteLength('Texto real del pliego.', 'utf8'),
    p_metadata: { num_pages: 3 }, p_gap_reason: null, p_actor_id: ids.actor,
  });
})();

await (async function normalizesGapExtractionIntoExactRpcParamsWithNullTextAndHash() {
  const extraction = gapExtraction('too_many_entries');
  const params = buildTenderDocumentExtractionRpcParams(extraction, {
    opportunityId: ids.opportunity, tenderId: ids.tender, documentVersionId: ids.version, actorId: ids.actor,
  });
  assert.equal(params.p_status, 'gap');
  assert.equal(params.p_extracted_text, null);
  assert.equal(params.p_text_hash, null);
  assert.equal(params.p_char_count, 0);
  assert.equal(params.p_text_byte_count, 0);
  assert.equal(params.p_gap_reason, 'too_many_entries');
})();

await (async function rejectsMissingIdentityOrMalformedExtraction() {
  assert.throws(() => buildTenderDocumentExtractionRpcParams(okExtraction(), { opportunityId: ids.opportunity, tenderId: ids.tender, actorId: ids.actor }));
  assert.throws(() => buildTenderDocumentExtractionRpcParams({ status: 'ok', text: '' }, { opportunityId: ids.opportunity, tenderId: ids.tender, documentVersionId: ids.version, actorId: ids.actor }));
  assert.throws(() => buildTenderDocumentExtractionRpcParams({ status: 'weird', text: 'x' }, { opportunityId: ids.opportunity, tenderId: ids.tender, documentVersionId: ids.version, actorId: ids.actor }));
  assert.throws(() => buildTenderDocumentExtractionRpcParams(gapExtraction(''), { opportunityId: ids.opportunity, tenderId: ids.tender, documentVersionId: ids.version, actorId: ids.actor }), /gap_reason/i);
  assert.throws(
    () => buildTenderDocumentExtractionRpcParams({ ...okExtraction('texto real'), text_hash: hash('otro texto') }, { opportunityId: ids.opportunity, tenderId: ids.tender, documentVersionId: ids.version, actorId: ids.actor }),
    /no coincide/i,
  );
})();

// --- selectCanonicalExtractionsByDocumentVersion ----------------------------
await (async function pickLatestOkByCreatedAtThenStableId() {
  const rows = [
    { id: 'a', document_version_id: ids.version, status: 'ok', extracted_text: 'v1', text_hash: hash('v1'), char_count: 2, created_at: '2026-01-01T00:00:00Z' },
    { id: 'b', document_version_id: ids.version, status: 'ok', extracted_text: 'v2', text_hash: hash('v2'), char_count: 2, created_at: '2026-02-01T00:00:00Z' },
  ];
  const byVersion = selectCanonicalExtractionsByDocumentVersion(rows);
  assert.equal(byVersion.get(ids.version).id, 'b');
})();

await (async function tiesBreakByStableId() {
  const rows = [
    { id: 'b', document_version_id: ids.version, status: 'ok', extracted_text: 'v2', text_hash: hash('v2'), char_count: 2, created_at: '2026-01-01T00:00:00Z' },
    { id: 'a', document_version_id: ids.version, status: 'ok', extracted_text: 'v1', text_hash: hash('v1'), char_count: 2, created_at: '2026-01-01T00:00:00Z' },
  ];
  const byVersion = selectCanonicalExtractionsByDocumentVersion(rows);
  assert.equal(byVersion.get(ids.version).id, 'b');
})();

await (async function neverPrefersAGapOverAnOlderOk() {
  const rows = [
    { id: 'old-ok', document_version_id: ids.version, status: 'ok', extracted_text: 'v1', text_hash: hash('v1'), char_count: 2, created_at: '2026-01-01T00:00:00Z' },
    { id: 'new-gap', document_version_id: ids.version, status: 'gap', extracted_text: null, text_hash: null, char_count: 0, gap_reason: 'extraction_error', created_at: '2026-03-01T00:00:00Z' },
  ];
  const byVersion = selectCanonicalExtractionsByDocumentVersion(rows);
  assert.equal(byVersion.get(ids.version).id, 'old-ok');
})();

await (async function gapSurfacesWhenNoOkRowExistsAtAll() {
  const rows = [
    { id: 'only-gap', document_version_id: ids.version, status: 'gap', extracted_text: null, text_hash: null, char_count: 0, gap_reason: 'extraction_error', created_at: '2026-01-01T00:00:00Z' },
  ];
  const byVersion = selectCanonicalExtractionsByDocumentVersion(rows);
  assert.equal(byVersion.get(ids.version).status, 'gap');
})();

await (async function failsClosedOnMalformedOkRows() {
  // An 'ok' row missing its hash (or with a mismatched char_count) cannot be trusted;
  // it must be skipped entirely rather than surfacing possibly-corrupt text.
  const rows = [
    { id: 'malformed', document_version_id: ids.version, status: 'ok', extracted_text: 'x', text_hash: hash('otro texto'), char_count: 1, created_at: '2026-01-01T00:00:00Z' },
    { id: 'good', document_version_id: ids.version, status: 'ok', extracted_text: 'y', text_hash: hash('y'), char_count: 1, created_at: '2025-01-01T00:00:00Z' },
  ];
  const byVersion = selectCanonicalExtractionsByDocumentVersion(rows);
  assert.equal(byVersion.get(ids.version).id, 'good');
})();

await (async function failsClosedWhenEveryRowIsMalformed() {
  const rows = [
    { id: 'malformed', document_version_id: ids.version, status: 'ok', extracted_text: null, text_hash: null, char_count: 0, created_at: '2026-01-01T00:00:00Z' },
  ];
  const byVersion = selectCanonicalExtractionsByDocumentVersion(rows);
  assert.equal(byVersion.has(ids.version), false);
})();

// --- mergeCanonicalExtractionIntoDocument -----------------------------------
await (async function canonicalOkExtractionWinsOverLegacyText() {
  const legacyText = 'x'.repeat(90000);
  const canonicalText = 'y'.repeat(200000);
  const document = { id: 'doc-1', name: 'Pliego.pdf' };
  const extractionRow = { status: 'ok', extracted_text: canonicalText, extractor_version: 'v2', parser: 'pdf-parse', char_count: canonicalText.length, text_hash: hash(canonicalText) };
  const merged = mergeCanonicalExtractionIntoDocument(document, extractionRow, legacyText);
  assert.equal(merged.extracted_text, canonicalText);
  assert.equal(merged.extraction_status, 'ok');
  assert.equal(merged.extraction_char_count, canonicalText.length);
})();

await (async function fallsBackToLegacyTextOnlyWhenNoSuccessfulExtractionExists() {
  const document = { id: 'doc-1' };
  const merged = mergeCanonicalExtractionIntoDocument(document, null, 'texto legado');
  assert.equal(merged.extracted_text, 'texto legado');
  assert.equal(merged.extraction_status, 'legacy');
})();

await (async function gapRowNeverFabricatesTextEvenWithLegacyTextAvailable() {
  const document = { id: 'doc-1' };
  const extractionRow = { status: 'gap', extracted_text: null, extractor_version: 'v2', parser: 'pdf', gap_reason: 'extraction_error' };
  const merged = mergeCanonicalExtractionIntoDocument(document, extractionRow, 'texto legado de respaldo');
  assert.equal(merged.extraction_status, 'gap');
  assert.equal(merged.extraction_gap_reason, 'extraction_error');
})();

// --- publicTenderDocumentProjection -----------------------------------------
await (async function publicProjectionNeverLeaksFullTextOrRawMetadataOrError() {
  const secretText = 'CONFIDENCIAL: cláusulas y precios internos del pliego.'.repeat(50);
  const document = {
    id: 'doc-1', name: 'Pliego.pdf', extracted_text: secretText,
    extraction_status: 'ok', extraction_version: 'v2', extraction_parser: 'pdf-parse',
    extraction_char_count: secretText.length, extraction_text_hash: hash(secretText),
    metadata: { raw_dump: secretText }, error: 'raw parser stack trace with /home/user/path',
  };
  const projected = publicTenderDocumentProjection(document);
  assert.equal('extracted_text' in projected, false);
  assert.equal('metadata' in projected, false);
  assert.equal('error' in projected, false);
  assert.equal(projected.extraction_status, 'ok');
  assert.equal(projected.extraction_char_count, secretText.length);
  assert.equal(projected.extraction_text_hash, hash(secretText));
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes('CONFIDENCIAL'), false, 'la proyección pública nunca debe serializar el texto completo');
})();

await (async function publicProjectionDefaultsToLegacyStatusWhenAbsent() {
  const projected = publicTenderDocumentProjection({ id: 'doc-1', extracted_text: 'texto legado' });
  assert.equal(projected.extraction_status, 'legacy');
  assert.equal('extracted_text' in projected, false);
})();

console.log('tender-document-extraction-persistence.test.mjs OK');
