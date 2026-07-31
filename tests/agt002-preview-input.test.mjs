import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  AGT002_MAX_DOCUMENTS,
  AGT002_MAX_DOCUMENT_CHARS,
  AGT002_MAX_TOTAL_DOCUMENT_CHARS,
  AGT002_RETRIEVAL_MAX_CHUNKS,
  AGT002_RETRIEVAL_MAX_CHARS,
  AGT002_RETRIEVAL_MAX_TOKENS,
  buildAgt002PreviewInput,
} from '../agt002-preview-input.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';

const longText = 'A'.repeat(4000);
const documents = Array.from({ length: 13 }, (_, index) => ({
  id: `doc-${String(index + 1).padStart(2, '0')}`,
  name: index === 0 ? 'Pliego contacto juan@example.com.pdf' : `Documento ${index + 1}.pdf`,
  document_type: index % 2 ? 'anexo_tecnico' : 'pliego',
  extracted_text: index === 0
    ? `Contacto: juan@example.com, teléfono +57 300 123 4567, cédula 1.234.567.890. Authorization: Bearer super-secret-token. ${longText}`
    : `${longText}${index}`,
  storage_path: `private/${index}/secret.pdf`,
  source_url: `https://example.test/file?token=signed-secret-${index}`,
}));
const original = structuredClone(documents);
const deepAnalysis = {
  version: '1.0',
  matrix: {
    legal: [{ id: 'legal', evidence: [{ document_id: 'doc-01', excerpt: 'juan@example.com exige póliza.' }] }],
    financial: [],
    technical: [],
  },
  coverage: { total: 1, confirmed: 0 },
  blockers: ['Validar cédula 1.234.567.890'],
  questions: [],
  unverified: [],
  strengths: [],
  weaknesses: [],
  unverifiable_documents: [],
  next_action: 'Contactar +57 300 123 4567',
};
const companyProfile = {
  working_capital: 600000000,
  guarantee_capacity_pct: 20,
  rup_expires_at: '2026-12-31',
  microsoft_email: 'directora@example.com',
  private_notes: 'Bearer profile-secret',
  storage_path: 'company/private/rup.pdf',
};

const input = buildAgt002PreviewInput({
  opportunity: { id: 'opp-1', company_name: 'Entidad de prueba', title: 'Vigilancia', source_url: 'https://secret.test?token=x' },
  documents,
  companyProfile,
  deepAnalysis,
  snapshotId: 'snapshot-1',
});

assert.equal(AGT002_MAX_DOCUMENTS, 12);
assert.equal(AGT002_MAX_DOCUMENT_CHARS, 3000);
assert.equal(AGT002_MAX_TOTAL_DOCUMENT_CHARS, 36000);
assert.equal(input.snapshot_id, 'snapshot-1');
assert.equal(input.documents.length, 12);
assert.deepEqual(input.documents.map(document => document.document_id), documents.slice(0, 12).map(document => document.id));
assert.ok(input.documents.every(document => document.excerpt.length <= AGT002_MAX_DOCUMENT_CHARS));
assert.ok(input.documents.reduce((sum, document) => sum + document.excerpt.length, 0) <= AGT002_MAX_TOTAL_DOCUMENT_CHARS);
assert.ok(input.documents.every(document => document.trust === 'untrusted_document_excerpt'));
assert.ok(input.documents.every(document => document.evidence_id === `document:${document.document_id}`));

assert.deepEqual(input.company_profile, {
  working_capital: 600000000,
  guarantee_capacity_pct: 20,
  rup_expires_at: '2026-12-31',
});
assert.deepEqual(input.opportunity, { id: 'opp-1', company_name: 'Entidad de prueba', title: 'Vigilancia' });
assert.ok(!Object.hasOwn(input, 'storage_path'));

const serialized = JSON.stringify(input);
for (const secret of [
  'juan@example.com', 'directora@example.com', '+57 300 123 4567', '1.234.567.890',
  'super-secret-token', 'profile-secret', 'signed-secret', 'private/0/secret.pdf', 'company/private/rup.pdf',
]) {
  assert.ok(!serialized.includes(secret), `input must redact or exclude ${secret}`);
}
assert.match(serialized, /\[REDACTED_EMAIL\]/);
assert.match(serialized, /\[REDACTED_PHONE\]/);
assert.match(serialized, /\[REDACTED_ID\]/);
assert.match(serialized, /\[REDACTED_SECRET\]/);
assert.deepEqual(documents, original, 'input preparation must not mutate source documents');

const reversed = buildAgt002PreviewInput({
  opportunity: { title: 'Vigilancia', company_name: 'Entidad de prueba', id: 'opp-1' },
  documents: [...documents].reverse(),
  companyProfile: { rup_expires_at: '2026-12-31', guarantee_capacity_pct: 20, working_capital: 600000000 },
  deepAnalysis,
  snapshotId: 'snapshot-1',
});
assert.deepEqual(reversed, input, 'input must be deterministic across document and object key order');

assert.throws(
  () => buildAgt002PreviewInput({ opportunity: {}, documents: [{ name: 'sin-id' }], companyProfile: {}, deepAnalysis: {}, snapshotId: 'snapshot-1' }),
  /identificador estable/i,
);
assert.throws(
  () => buildAgt002PreviewInput({ opportunity: {}, documents: [], companyProfile: {}, deepAnalysis: {}, snapshotId: '' }),
  /snapshot/i,
);

// --- AGT002_CONTEXT_V2: structured opportunity/company context replaces the partial
// opportunity object and misaligned company fields, behind an explicit flag; the v1 path
// above stays byte-for-byte the same for rollback until production verification. ---

const contextV2Sections = {
  ...buildAgt002OpportunityContextV2({
    opportunity: { id: 'opp-1', owner_id: 'owner-1', owner_name: 'Ana', updated_at: '2026-07-29T10:00:00.000Z' },
    tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', source: 'SECOP II', updated_at: '2026-07-29T10:00:00.000Z' },
  }),
  company_dossier: buildAgt002CompanyDossier({
    profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-29T10:00:00.000Z' },
    documents: [],
  }),
};

const v2Input = buildAgt002PreviewInput({
  documents,
  deepAnalysis,
  snapshotId: 'snapshot-1',
  contextV2: true,
  contextV2Sections,
});

assert.equal(v2Input.context_version, 2);
assert.deepEqual(v2Input.opportunity, contextV2Sections.opportunity);
assert.deepEqual(v2Input.company_dossier, contextV2Sections.company_dossier);
assert.deepEqual(v2Input.commercial_context, contextV2Sections.commercial_context);
assert.deepEqual(v2Input.human_evidence, []);
assert.ok(Object.hasOwn(v2Input, 'objective_validations'), 'context v2 always carries deterministic objective validations');
assert.equal(Object.hasOwn(v2Input, 'deep_analysis'), false, 'context v2 never carries the legacy deep_analysis/recommendation blob');
assert.equal(Object.hasOwn(v2Input, 'company_profile'), false, 'context v2 replaces the legacy misaligned company_profile fields');
assert.equal(v2Input.documents.length, documents.length > AGT002_MAX_DOCUMENTS ? AGT002_MAX_DOCUMENTS : documents.length);

// Even when canonicalOnly is explicitly false, context v2 still forces objective_validations
// over deep_analysis — the two flags are independent and v2 always wins on this choice.
const v2WithCanonicalOnlyFalse = buildAgt002PreviewInput({
  documents, deepAnalysis, snapshotId: 'snapshot-1', canonicalOnly: false, contextV2: true, contextV2Sections,
});
assert.equal(Object.hasOwn(v2WithCanonicalOnlyFalse, 'deep_analysis'), false);

// Flag off (default false) must reproduce the exact v1 shape even when contextV2Sections is supplied,
// so a caller that always loads context v2 sections cannot accidentally leak it without the flag.
const v1WithSectionsIgnored = buildAgt002PreviewInput({
  opportunity: { id: 'opp-1', company_name: 'Entidad de prueba', title: 'Vigilancia' },
  documents, companyProfile: {}, deepAnalysis, snapshotId: 'snapshot-1', contextV2Sections,
});
assert.equal(Object.hasOwn(v1WithSectionsIgnored, 'context_version'), false);
assert.equal(Object.hasOwn(v1WithSectionsIgnored, 'company_dossier'), false);

// Fail-closed: requesting context v2 without valid sections must throw rather than silently
// degrade to an incomplete or empty structured context.
assert.throws(
  () => buildAgt002PreviewInput({ documents, deepAnalysis, snapshotId: 'snapshot-1', contextV2: true }),
  /context.*v2|contexto/i,
);
assert.throws(
  () => buildAgt002PreviewInput({ documents, deepAnalysis, snapshotId: 'snapshot-1', contextV2: true, contextV2Sections: { opportunity: contextV2Sections.opportunity } }),
  /context.*v2|contexto/i,
);

// --- AGT002_DOCUMENT_RETRIEVAL: a closed evidence packet from buildAgt002DocumentRetrieval
// (Task 26) replaces the arbitrary document-prefix truncation, behind a server-side flag
// that requires context v2. The flag-off path above stays byte-identical (rollback). ---

function hash(text) { return createHash('sha256').update(text).digest('hex'); }

assert.equal(AGT002_RETRIEVAL_MAX_CHUNKS, 40);
assert.equal(AGT002_RETRIEVAL_MAX_CHARS, 40000);
assert.equal(AGT002_RETRIEVAL_MAX_TOKENS, 12000);

// Fail-closed: documentRetrieval requires contextV2; a caller cannot request retrieval
// against the legacy v1 shape.
assert.throws(
  () => buildAgt002PreviewInput({ documents: [], deepAnalysis: {}, snapshotId: 'snapshot-1', documentRetrieval: true, contextV2: false }),
  /AGT002_CONTEXT_V2|contexto v2/i,
);

// Fail-closed: no structured requirement is derivable from deepAnalysis.matrix -> explicit
// error, never a silent fallback to an arbitrary prefix.
assert.throws(
  () => buildAgt002PreviewInput({
    documents: [], deepAnalysis: { matrix: { legal: [], financial: [], technical: [] } },
    snapshotId: 'snapshot-1', contextV2: true, contextV2Sections, documentRetrieval: true,
  }),
  /requisito/i,
);

// 14-document representative scenario: 13 imported documents (one illegible/blank) plus one
// document that never imported (external gap, doc-14), five requirements spanning the three
// fronts, and an addendum superseding two base plazo mentions.
const retrievalDocs = [];
retrievalDocs.push({ document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Doc 1.pdf', version: 1, content_hash: hash('doc-01'), current: true, extracted_text: 'El objeto del contrato es la vigilancia física armada las veinticuatro horas en las instalaciones del cliente.' });
retrievalDocs.push({ document_id: 'doc-02', document_version_id: 'ver-02', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Doc 2.pdf', version: 1, content_hash: hash('doc-02'), current: true, extracted_text: 'El plazo de ejecución del contrato es de doce meses contados a partir del acta de inicio.' });
retrievalDocs.push({ document_id: 'doc-03', document_version_id: 'ver-03', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'estudios_previos', name: 'Doc 3.pdf', version: 1, content_hash: hash('doc-03'), current: true, extracted_text: 'El presupuesto oficial estimado para este proceso es de mil millones de pesos.' });
retrievalDocs.push({ document_id: 'doc-04', document_version_id: 'ver-04', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'anexo_tecnico', name: 'Doc 4.pdf', version: 1, content_hash: hash('doc-04'), current: true, extracted_text: 'Se requieren equipos de comunicación radio digital troncalizado para todo el personal de vigilancia.' });
retrievalDocs.push({ document_id: 'doc-05', document_version_id: 'ver-05', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'formatos', name: 'Doc 5.pdf', version: 1, content_hash: hash('doc-05'), current: true, extracted_text: 'El proponente debe diligenciar el formato de experiencia específica en seguridad privada.' });
retrievalDocs.push({ document_id: 'doc-06', document_version_id: 'ver-06', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'otro', name: 'Doc 6.pdf', version: 1, content_hash: hash('doc-06'), current: true, extracted_text: 'Documento informativo general sin relación directa con los requisitos técnicos evaluados.' });
retrievalDocs.push({ document_id: 'doc-07', document_version_id: 'ver-07', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Doc 7.pdf', version: 1, content_hash: hash('doc-07'), current: true, extracted_text: 'El servicio de vigilancia armada debe prestarse con personal certificado por la Supervigilancia.' });
retrievalDocs.push({ document_id: 'doc-08', document_version_id: 'ver-08', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'anexo_tecnico', name: 'Doc 8.pdf', version: 1, content_hash: hash('doc-08'), current: true, extracted_text: 'Los equipos de comunicación radio deben contar con cobertura en toda el área operativa.' });
retrievalDocs.push({ document_id: 'doc-09', document_version_id: 'ver-09', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'estudios_previos', name: 'Doc 9.pdf', version: 1, content_hash: hash('doc-09'), current: true, extracted_text: 'El presupuesto oficial fue calculado con base en el estudio de mercado de vigilancia armada.' });
retrievalDocs.push({ document_id: 'doc-10', document_version_id: 'ver-10', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'formatos', name: 'Doc 10.pdf', version: 1, content_hash: hash('doc-10'), current: true, extracted_text: 'El formato de experiencia debe incluir certificaciones vigentes de la empresa proponente.' });
retrievalDocs.push({ document_id: 'doc-11', document_version_id: 'ver-11', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'otro', name: 'Doc 11.pdf', version: 1, content_hash: hash('doc-11'), current: true, extracted_text: '   ' });
retrievalDocs.push({ document_id: 'doc-12', document_version_id: 'ver-12', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'adenda', name: 'Adenda 1.pdf', version: 1, content_hash: hash('doc-12'), current: true, extracted_text: 'La presente adenda modifica el plazo de ejecución del contrato, ampliándolo a dieciocho meses.' });
retrievalDocs.push({ document_id: 'doc-13', document_version_id: 'ver-13', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Doc 13.pdf', version: 1, content_hash: hash('doc-13'), current: true, extracted_text: 'El plazo de ejecución podrá prorrogarse previa autorización del supervisor del contrato.' });
assert.equal(retrievalDocs.length, 13);
const retrievalDocumentGaps = [{ document_id: 'doc-14', reason: 'failed_terminal' }];

const retrievalDeepAnalysis = {
  version: '1.0',
  matrix: {
    legal: [
      {
        id: 'req-vigilancia', front: 'legal', label: 'Vigilancia armada',
        evidence: [
          { document_id: 'ver-01', document_name: 'Doc 1.pdf', document_type: 'pliego', excerpt: 'vigilancia física armada' },
          { document_id: 'ver-07', document_name: 'Doc 7.pdf', document_type: 'pliego', excerpt: 'servicio de vigilancia armada' },
        ],
      },
      {
        id: 'req-plazo', front: 'legal', label: 'Plazo de ejecución',
        evidence: [
          { document_id: 'ver-02', document_name: 'Doc 2.pdf', document_type: 'pliego', excerpt: 'plazo de ejecución doce meses' },
          { document_id: 'ver-12', document_name: 'Adenda 1.pdf', document_type: 'adenda', excerpt: 'modifica el plazo' },
          { document_id: 'ver-13', document_name: 'Doc 13.pdf', document_type: 'pliego', excerpt: 'plazo podrá prorrogarse' },
        ],
      },
    ],
    financial: [
      {
        id: 'req-presupuesto', front: 'financial', label: 'Presupuesto millones',
        evidence: [
          { document_id: 'ver-03', document_name: 'Doc 3.pdf', document_type: 'estudios_previos', excerpt: 'presupuesto oficial' },
          { document_id: 'ver-09', document_name: 'Doc 9.pdf', document_type: 'estudios_previos', excerpt: 'presupuesto oficial calculado' },
        ],
      },
    ],
    technical: [
      {
        id: 'req-equipos', front: 'technical', label: 'Equipos comunicación radio',
        evidence: [
          { document_id: 'ver-04', document_name: 'Doc 4.pdf', document_type: 'anexo_tecnico', excerpt: 'equipos de comunicación radio' },
          { document_id: 'ver-08', document_name: 'Doc 8.pdf', document_type: 'anexo_tecnico', excerpt: 'equipos de comunicación radio deben' },
        ],
      },
      {
        id: 'req-experiencia', front: 'technical', label: 'Formato experiencia',
        evidence: [
          { document_id: 'ver-05', document_name: 'Doc 5.pdf', document_type: 'formatos', excerpt: 'formato de experiencia' },
          { document_id: 'ver-10', document_name: 'Doc 10.pdf', document_type: 'formatos', excerpt: 'formato de experiencia debe incluir' },
          { document_id: 'ver-99', document_name: 'Doc perdido.pdf', document_type: 'formatos', excerpt: 'referencia a documento no resuelto' },
        ],
      },
    ],
  },
};

const retrievalInput = buildAgt002PreviewInput({
  documents: retrievalDocs,
  documentGaps: retrievalDocumentGaps,
  deepAnalysis: retrievalDeepAnalysis,
  snapshotId: 'snap-manizales',
  contextV2: true,
  contextV2Sections,
  documentRetrieval: true,
});

assert.equal(retrievalInput.snapshot_id, 'snap-manizales');
assert.ok(retrievalInput.document_evidence, 'flag on must attach the closed retrieval package');
assert.equal(retrievalInput.document_evidence.snapshot_id, 'snap-manizales');
assert.equal(
  Object.hasOwn(retrievalInput, 'documents'),
  false,
  'retrieval mode must send chunk text only once inside document_evidence',
);

const evidence = retrievalInput.document_evidence;
assert.ok(evidence.budget.chunks_used <= evidence.budget.max_chunks);
assert.ok(evidence.budget.chars_used <= evidence.budget.max_chars);
assert.ok(evidence.budget.tokens_used <= evidence.budget.max_tokens);
assert.equal(evidence.budget.max_chunks, AGT002_RETRIEVAL_MAX_CHUNKS);
assert.equal(evidence.budget.max_chars, AGT002_RETRIEVAL_MAX_CHARS);
assert.equal(evidence.budget.max_tokens, AGT002_RETRIEVAL_MAX_TOKENS);
assert.equal(evidence.budget.chunks_remaining, evidence.budget.max_chunks - evidence.budget.chunks_used);
assert.equal(evidence.budget.chars_remaining, evidence.budget.max_chars - evidence.budget.chars_used);
assert.equal(evidence.budget.tokens_remaining, evidence.budget.max_tokens - evidence.budget.tokens_used);

assert.equal(evidence.coverage_manifest.by_requirement.length, 5);
assert.deepEqual(evidence.coverage_manifest.by_requirement.map(r => r.requirement_id), ['req-equipos', 'req-experiencia', 'req-plazo', 'req-presupuesto', 'req-vigilancia']);

assert.ok(Array.isArray(evidence.selected_chunks) && evidence.selected_chunks.length > 0);
assert.ok(Array.isArray(evidence.omitted_chunks));
assert.equal(evidence.material_omissions, true, 'gaps (blank doc, never-imported doc) must surface material omissions');

const gapOmissions = evidence.omitted_chunks.filter(o => o.reason === 'gap_unavailable');
assert.deepEqual(gapOmissions.map(o => o.document_id).sort(), ['doc-11', 'doc-14']);

const addendumSelected = evidence.selected_chunks.find(c => c.document_id === 'doc-12');
assert.ok(addendumSelected, 'the relevant addendum must be selected for the plazo requirement');
assert.equal(addendumSelected.precedence, 'addendum');
assert.equal(addendumSelected.superseded_by_addendum, false);
// With the generous server-side budget, both the addendum and the base plazo mentions fit:
// the base stays selected (citable) but its precedence/state marks it as historically
// superseded, exactly like Task 26's "generous budget" case — history is preserved, not erased.
const supersededBaseSelected = evidence.selected_chunks.filter(c => (c.document_id === 'doc-02' || c.document_id === 'doc-13') && c.superseded_by_addendum === true);
assert.equal(supersededBaseSelected.length, 2, 'the superseded base plazo evidence must remain selected/citable with its historical state preserved');

// citation_allowlist is derived exactly from the retrieval package, no more and no fewer.
assert.deepEqual([...evidence.citation_allowlist].sort(), evidence.citation_allowlist);
assert.deepEqual(evidence.citation_allowlist, evidence.selected_chunks.map(c => c.evidence_ref).sort());

// No omitted/unavailable chunk ever leaks into the citable set.
const omittedRefs = new Set(evidence.omitted_chunks.map(o => o.evidence_ref).filter(Boolean));
for (const ref of evidence.citation_allowlist) assert.ok(!omittedRefs.has(ref));

// No chunk is ever truncated: selected chunks carry complete, non-empty text exactly once.
assert.ok(evidence.selected_chunks.every(chunk => typeof chunk.text === 'string' && chunk.text.length > 0));

// Never a GO/NO-GO decision or vector-model infra leaking through this module.
assert.equal(Object.prototype.hasOwnProperty.call(evidence, 'decision'), false);
assert.equal(Object.prototype.hasOwnProperty.call(evidence, 'recommendation'), false);

// The self-contained requirement provenance manifest (Task E4): every requirement keeps its
// id/front/label plus resolved document version+hash sources, deduped/sorted deterministically.
// An evidence document_id absent from the retrieved documents (ver-99) never invents a source:
// it surfaces as an explicit unresolved_sources entry instead.
assert.equal(evidence.requirement_manifest_version, '1.0');
assert.deepEqual(
  evidence.requirement_manifest.map(r => r.requirement_id),
  ['req-equipos', 'req-experiencia', 'req-plazo', 'req-presupuesto', 'req-vigilancia'],
);
const reqExperiencia = evidence.requirement_manifest.find(r => r.requirement_id === 'req-experiencia');
assert.equal(reqExperiencia.front, 'technical');
assert.equal(reqExperiencia.label, 'Formato experiencia');
assert.deepEqual(reqExperiencia.sources.map(s => s.document_version_id), ['ver-05', 'ver-10']);
assert.ok(reqExperiencia.sources.every(s => /^[0-9a-f]{64}$/.test(s.content_hash)));
assert.deepEqual(reqExperiencia.unresolved_sources, [{ document_id: 'ver-99', reason: 'document_identity_not_resolved' }]);
const reqPlazo = evidence.requirement_manifest.find(r => r.requirement_id === 'req-plazo');
assert.deepEqual(reqPlazo.sources.map(s => s.document_version_id), ['ver-02', 'ver-12', 'ver-13']);
assert.deepEqual(reqPlazo.unresolved_sources, []);
assert.doesNotMatch(
  JSON.stringify(evidence.requirement_manifest),
  /formato de experiencia debe incluir|modifica el plazo/i,
  'requirement_manifest must never carry evidence excerpt/chunk text',
);

// Deterministic regardless of document input order.
const retrievalInputReversed = buildAgt002PreviewInput({
  documents: [...retrievalDocs].reverse(),
  documentGaps: retrievalDocumentGaps,
  deepAnalysis: retrievalDeepAnalysis,
  snapshotId: 'snap-manizales',
  contextV2: true,
  contextV2Sections,
  documentRetrieval: true,
});
assert.deepEqual(retrievalInputReversed, retrievalInput, 'document input order must not change the retrieval result');

// Rejects an incomplete/malformed evidence source: an unknown document key fails closed
// through the same closed chunk contract Task 26 already enforces.
assert.throws(
  () => buildAgt002PreviewInput({
    documents: [{ ...retrievalDocs[0], unexpected_field: 'x' }],
    deepAnalysis: retrievalDeepAnalysis,
    snapshotId: 'snap-manizales',
    contextV2: true,
    contextV2Sections,
    documentRetrieval: true,
  }),
  /clave|permitida|desconocida/i,
);

// Flag off (default): even when documents/deepAnalysis are already retrieval-shaped, the
// contextV2 output keeps the legacy prepareDocuments shape and never attaches document_evidence,
// preserving byte-identical rollback behavior.
const rollbackInput = buildAgt002PreviewInput({
  documents: retrievalDocs,
  deepAnalysis: retrievalDeepAnalysis,
  snapshotId: 'snap-manizales',
  contextV2: true,
  contextV2Sections,
});
assert.equal(Object.hasOwn(rollbackInput, 'document_evidence'), false);
assert.ok(rollbackInput.documents.every(document => document.evidence_id.startsWith('document:')));

// --- Contexto confirmado: buildTenderDocumentAnalysis returns a legacy visual array at
// .matrix (category/status/detail rows for the UI) and the real deterministic v1.0 matrix
// nested at .deep_analysis.matrix. Retrieval off must reproduce the exact legacy behavior
// against this production wrapper shape (byte-identical, no document_evidence, top-level
// .matrix objective_validations lookup unchanged). Retrieval on must resolve the correct
// nested matrix for both document_evidence.requirement_manifest and objective_validations. ---
{
  const productionDoc = [{
    document_id: 'doc-prod', document_version_id: 'ver-prod', opportunity_id: 'opp-1', snapshot_id: null,
    document_type: 'pliego', name: 'Prod.pdf', version: 1, content_hash: hash('doc-prod'), current: true,
    extracted_text: 'El proponente debe aportar póliza de cumplimiento vigente equivalente al diez por ciento.',
  }];
  const productionDeepAnalysis = {
    matrix: [{ category: 'Jurídico', status: 'Cumplimiento por validar', detail: 'x' }],
    deep_analysis: {
      version: '1.0',
      matrix: {
        legal: [{
          id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento', status: 'confirmed', confidence: 'high',
          values: [{ kind: 'percentage', raw: '10%', normalized: '10%' }],
          evidence: [{ document_id: 'ver-prod', document_name: 'Prod.pdf', document_type: 'pliego', excerpt: 'diez por ciento' }],
        }],
        financial: [],
        technical: [],
      },
      unverifiable_documents: [],
    },
  };

  const legacyOutput = buildAgt002PreviewInput({
    documents: productionDoc, deepAnalysis: productionDeepAnalysis, snapshotId: 'snap-prod',
    contextV2: true, contextV2Sections,
  });
  assert.equal(Object.hasOwn(legacyOutput, 'document_evidence'), false, 'retrieval off must never attach document_evidence');
  assert.deepEqual(
    legacyOutput.objective_validations.extracted_values, [],
    'retrieval off must preserve the legacy (top-level matrix) objective_validations lookup exactly, unchanged even against the production wrapper shape',
  );

  const retrievalOutput = buildAgt002PreviewInput({
    documents: productionDoc, deepAnalysis: productionDeepAnalysis, snapshotId: 'snap-prod',
    contextV2: true, contextV2Sections, documentRetrieval: true,
  });
  assert.ok(retrievalOutput.document_evidence, 'retrieval on must attach document_evidence');
  assert.equal(retrievalOutput.document_evidence.requirement_manifest_version, '1.0');
  assert.deepEqual(retrievalOutput.document_evidence.requirement_manifest, [{
    requirement_id: 'legal-guarantee-policy', front: 'legal', label: 'Póliza de cumplimiento',
    sources: [{ document_id: 'doc-prod', document_version_id: 'ver-prod', content_hash: hash('doc-prod') }],
    unresolved_sources: [],
  }]);
  assert.equal(
    retrievalOutput.objective_validations.extracted_values.length, 1,
    'retrieval on must resolve the correct nested deep_analysis.matrix for objective_validations too',
  );
  assert.deepEqual(retrievalOutput.objective_validations.extracted_values[0], {
    requirement_id: 'legal-guarantee-policy', front: 'legal', kind: 'percentage', raw: '10%', normalized: '10%',
    evidence_refs: ['document:ver-prod'],
  });
}

// --- An evidence document_id that never resolves to a retrieved document version+hash is a
// material omission of provenance, never a silent drop: it must force material_omissions=true
// (even when chunk-level retrieval coverage is otherwise unaffected) and its reason must stay
// visible inside requirement_manifest[].unresolved_sources. ---
{
  const soloDoc = [{
    document_id: 'doc-solo', document_version_id: 'ver-solo', opportunity_id: 'opp-1', snapshot_id: null,
    document_type: 'pliego', name: 'Solo.pdf', version: 1, content_hash: hash('doc-solo'), current: true,
    extracted_text: 'El proponente debe aportar garantía de seriedad de la oferta vigente.',
  }];
  const soloDeepAnalysis = {
    matrix: {
      legal: [{
        id: 'req-garantia', front: 'legal', label: 'Garantía de seriedad',
        evidence: [
          { document_id: 'ver-solo', document_name: 'Solo.pdf', document_type: 'pliego', excerpt: 'garantía de seriedad' },
          { document_id: 'ver-inexistente', document_name: 'Doc perdido.pdf', document_type: 'pliego', excerpt: 'referencia perdida' },
        ],
      }],
      financial: [],
      technical: [],
    },
  };
  const soloInput = buildAgt002PreviewInput({
    documents: soloDoc, deepAnalysis: soloDeepAnalysis, snapshotId: 'snap-solo',
    contextV2: true, contextV2Sections, documentRetrieval: true,
  });
  const soloEvidence = soloInput.document_evidence;
  const [reqGarantia] = soloEvidence.requirement_manifest;
  assert.deepEqual(reqGarantia.unresolved_sources, [{ document_id: 'ver-inexistente', reason: 'document_identity_not_resolved' }]);
  assert.equal(soloEvidence.material_omissions, true, 'an unresolved provenance source must force material_omissions=true');
}

// --- Fail-closed: every evidence document_id fails to resolve anywhere in the matrix -> the
// whole call must throw rather than persist a manifest with zero real provenance. ---
assert.throws(
  () => buildAgt002PreviewInput({
    documents: [{
      document_id: 'doc-x', document_version_id: 'ver-x', opportunity_id: 'opp-1', snapshot_id: null,
      document_type: 'pliego', name: 'X.pdf', version: 1, content_hash: hash('doc-x'), current: true,
      extracted_text: 'Contenido sin relación con ningún requisito de este caso de prueba.',
    }],
    deepAnalysis: { matrix: { legal: [{ id: 'req-x', front: 'legal', label: 'contenido relacion', evidence: [{ document_id: 'ver-unresolvable' }] }], financial: [], technical: [] } },
    snapshotId: 'snap-failclosed',
    contextV2: true,
    contextV2Sections,
    documentRetrieval: true,
  }),
  /procedencia|resuelt/i,
);

console.log('AGT-002 preview input minimization and redaction passed');
