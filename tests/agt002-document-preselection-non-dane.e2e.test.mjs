// AGT-002 / Vig-IA — end-to-end contract for the document preselection flow, built entirely from
// non-DANE, generic fixture data (a fictitious Bucaramanga process). Hermetic: no HTTP endpoint, no
// DB, no provider call, no production job — every module exercised here is pure and synchronous.
// Wires the real chain: suggestAgt002DocumentRelevance -> publicTenderDocumentProjection ->
// currentAgt002GovernedWorksetDocuments / buildAgt002RecommendedWorksetSelection (real TS module,
// bundled with esbuild the same way tests/tender-governed-workset-selection.test.mjs does) ->
// freezeAgt002WorksetEvidence.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import crypto from 'node:crypto';
import { buildSync } from 'esbuild';

import { suggestAgt002DocumentRelevance } from '../agt002-document-relevance-suggestion.js';
import { publicTenderDocumentProjection } from '../tender-document-extraction-persistence.js';
import { freezeAgt002WorksetEvidence } from '../agt002-governed-document-worksets.js';

const modulePath = new URL('../src/tenders/governedWorksetSelection.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [modulePath], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const { currentAgt002GovernedWorksetDocuments, buildAgt002RecommendedWorksetSelection } = await import(moduleUrl);

function hex64(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

// --- Fixture: a fictitious Bucaramanga tender process, entirely non-DANE. ------------------------
const OPPORTUNITY_ID = '10000000-0000-4000-8000-000000000001';
const TENDER_ID = '20000000-0000-4000-8000-000000000002';

const PLIEGO_DOC = {
  id: '30000000-0000-4000-8000-000000000003',
  name: 'Pliego definitivo del proceso.pdf',
  document_type: 'pliego',
  extracted_text: 'Pliego definitivo del proceso de contratación de obra pública en Bucaramanga.',
  current: true,
  opportunity_id: OPPORTUNITY_ID,
  tender_id: TENDER_ID,
  extraction_status: 'ok',
  extraction_gap_reason: null,
  extraction_id: '40000000-0000-4000-8000-000000000004',
  content_hash: hex64('pliego-content-1'),
  extraction_text_hash: hex64('pliego-text-1'),
  // Internal-only fields that must never survive the public projection.
  storage_path: '/internal/storage/pliego-definitivo.pdf',
  source_url: 'https://internal.example/secret/pliego-definitivo.pdf?token=should-not-leak',
};

const HEADINGS_DOC = {
  id: '30000000-0000-4000-8000-000000000005',
  name: 'documento_adjunto_002.pdf',
  document_type: 'documento_adjunto',
  extracted_text: [
    'REQUISITOS HABILITANTES',
    'Los proponentes deberán acreditar experiencia en obras similares en el municipio de Bucaramanga.',
    'ESPECIFICACIONES TÉCNICAS',
    'El proyecto contempla el suministro de materiales certificados y su instalación conforme a norma.',
  ].join('\n'),
  current: true,
  opportunity_id: OPPORTUNITY_ID,
  tender_id: TENDER_ID,
  extraction_status: 'ok',
  extraction_gap_reason: null,
  extraction_id: '40000000-0000-4000-8000-000000000006',
  content_hash: hex64('anexo-content-2'),
  extraction_text_hash: hex64('anexo-text-2'),
  storage_path: '/internal/storage/documento-adjunto-002.pdf',
  source_url: 'https://internal.example/secret/documento-adjunto-002.pdf?token=should-not-leak',
};

const PHOTO_DOC = {
  id: '30000000-0000-4000-8000-000000000007',
  name: 'Fotografias del predio.zip',
  document_type: 'registro_fotografico',
  extracted_text:
    'Registro fotográfico del predio ubicado en la vereda El Diamante, Bucaramanga, sin observaciones adicionales.',
  current: true,
  opportunity_id: OPPORTUNITY_ID,
  tender_id: TENDER_ID,
  extraction_status: 'ok',
  extraction_gap_reason: null,
  extraction_id: '40000000-0000-4000-8000-000000000008',
  content_hash: hex64('foto-content-3'),
  extraction_text_hash: hex64('foto-text-3'),
  storage_path: '/internal/storage/fotografias-del-predio.zip',
  source_url: 'https://internal.example/secret/fotografias-del-predio.zip?token=should-not-leak',
};

const INTERNAL_DOCS = [PLIEGO_DOC, HEADINGS_DOC, PHOTO_DOC];

// Annotate each internal doc with its real, independently computed suggestion.
for (const doc of INTERNAL_DOCS) {
  doc.analysis_suggestion = suggestAgt002DocumentRelevance(doc);
}

// Safe-project every internal doc, exactly as the server would before it ever reaches the browser.
const PROJECTED_DOCS = INTERNAL_DOCS.map(doc => publicTenderDocumentProjection(doc, { opportunityId: OPPORTUNITY_ID }));
const [projectedPliego, projectedHeadings, projectedPhoto] = PROJECTED_DOCS;

test('suggestAgt002DocumentRelevance recommends the canonical pliego with high confidence', () => {
  assert.equal(PLIEGO_DOC.analysis_suggestion.recommended, true);
  assert.equal(PLIEGO_DOC.analysis_suggestion.confidence, 'high');
  assert.equal(PLIEGO_DOC.analysis_suggestion.reason_code, 'type_and_filename_match');
});

test('suggestAgt002DocumentRelevance recommends the generically named doc from its two strong headings', () => {
  assert.equal(HEADINGS_DOC.analysis_suggestion.recommended, true);
  assert.equal(HEADINGS_DOC.analysis_suggestion.confidence, 'medium');
  assert.equal(HEADINGS_DOC.analysis_suggestion.reason_code, 'multiple_content_headings');
});

test('suggestAgt002DocumentRelevance does not recommend the site photo package, but never marks it excluded', () => {
  assert.equal(PHOTO_DOC.analysis_suggestion.recommended, false);
  assert.equal(PHOTO_DOC.analysis_suggestion.confidence, 'low');
  assert.equal(PHOTO_DOC.analysis_suggestion.reason_code, 'no_signal_detected');
  assert.equal(Object.prototype.hasOwnProperty.call(PHOTO_DOC.analysis_suggestion, 'excluded'), false);
});

test('publicTenderDocumentProjection never exposes extracted_text or internal storage fields for any doc', () => {
  for (const projected of PROJECTED_DOCS) {
    assert.equal(Object.prototype.hasOwnProperty.call(projected, 'extracted_text'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(projected, 'storage_path'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(projected, 'source_url'), false);
    assert.equal(JSON.stringify(projected).includes('should-not-leak'), false);
  }
});

test('all three current documents remain workset candidates after projection', () => {
  const candidates = currentAgt002GovernedWorksetDocuments(PROJECTED_DOCS);
  assert.deepEqual(
    candidates.map(d => d.id).sort(),
    [PLIEGO_DOC.id, HEADINGS_DOC.id, PHOTO_DOC.id].sort(),
  );
});

test('buildAgt002RecommendedWorksetSelection preselects exactly the pliego and headings doc, official/reason contract, never the photo', () => {
  const preselection = buildAgt002RecommendedWorksetSelection(PROJECTED_DOCS);

  assert.deepEqual(preselection.map(m => m.document_version_id), [PLIEGO_DOC.id, HEADINGS_DOC.id]);
  assert.equal(preselection.some(m => m.document_version_id === PHOTO_DOC.id), false, 'the photo must never be preselected');

  for (const [member, sourceDoc] of [
    [preselection[0], PLIEGO_DOC],
    [preselection[1], HEADINGS_DOC],
  ]) {
    assert.equal(member.source_classification, 'official');
    assert.equal(member.inclusion_reason, `Preseleccionado por Vig-IA: ${sourceDoc.analysis_suggestion.reason}`);
    assert.deepEqual(Object.keys(member).sort(), ['document_version_id', 'inclusion_reason', 'source_classification']);
  }
});

test('the photo remains a manually selectable current candidate despite not being preselected', () => {
  const candidates = currentAgt002GovernedWorksetDocuments(PROJECTED_DOCS);
  assert.ok(candidates.some(d => d.id === PHOTO_DOC.id), 'the photo must still be listed as a selectable candidate');
  assert.equal(projectedPhoto.analysis_suggestion.recommended, false);
});

// --- Freezing the Vig-IA preselection (pliego + headings doc), backed by real evidence rows. -----
function evidenceRowFor(doc) {
  return {
    document_version_id: doc.id,
    opportunity_id: doc.opportunity_id,
    tender_id: doc.tender_id,
    extraction_id: doc.extraction_id,
    content_hash: doc.content_hash,
    extraction_text_hash: doc.extraction_text_hash,
    current: true,
    extraction_status: 'ok',
  };
}

const preselection = buildAgt002RecommendedWorksetSelection(PROJECTED_DOCS);
const preselectionEvidenceRows = [evidenceRowFor(PLIEGO_DOC), evidenceRowFor(HEADINGS_DOC)];

test('freezeAgt002WorksetEvidence freezes exactly the two Vig-IA preselected docs, never the photo', () => {
  const frozen = freezeAgt002WorksetEvidence({
    opportunityId: OPPORTUNITY_ID,
    tenderId: TENDER_ID,
    requestedMembers: preselection,
    evidenceRows: preselectionEvidenceRows,
  });

  assert.deepEqual(
    frozen.members.map(m => m.document_version_id).sort(),
    [PLIEGO_DOC.id, HEADINGS_DOC.id].sort(),
  );
  assert.equal(frozen.members.some(m => m.document_version_id === PHOTO_DOC.id), false);
  assert.match(frozen.selectionHash, /^[0-9a-f]{64}$/);
  assert.equal(frozen.opportunityId, OPPORTUNITY_ID);
  assert.equal(frozen.tenderId, TENDER_ID);
});

test('Licitaciones can still manually add the non-recommended photo to a frozen workset with an explicit inclusion_reason', () => {
  const manualPhotoMember = {
    document_version_id: PHOTO_DOC.id,
    source_classification: 'official',
    inclusion_reason: 'Incluido manualmente por Licitaciones: soporte fotográfico del predio requerido para la visita técnica.',
  };
  const requestedMembersWithPhoto = [...preselection, manualPhotoMember];
  const evidenceRowsWithPhoto = [...preselectionEvidenceRows, evidenceRowFor(PHOTO_DOC)];

  const frozenWithPhoto = freezeAgt002WorksetEvidence({
    opportunityId: OPPORTUNITY_ID,
    tenderId: TENDER_ID,
    requestedMembers: requestedMembersWithPhoto,
    evidenceRows: evidenceRowsWithPhoto,
  });

  assert.deepEqual(
    frozenWithPhoto.members.map(m => m.document_version_id).sort(),
    [PLIEGO_DOC.id, HEADINGS_DOC.id, PHOTO_DOC.id].sort(),
  );
  assert.match(frozenWithPhoto.selectionHash, /^[0-9a-f]{64}$/);
});
