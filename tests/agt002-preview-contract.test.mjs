import { strict as assert } from 'node:assert';
import {
  AGT002_LEGAL_FINDING_CLASSIFICATIONS,
  AGT002_LEGAL_HUMAN_REVIEW_STATEMENT,
  AGT002_PREVIEW_OUTPUT_JSON_SCHEMA,
  AGT002_PREVIEW_RECOMMENDATIONS,
  AGT002_PREVIEW_SCHEMA_VERSION,
  AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION,
  buildAgt002PreviewOutputJsonSchema,
  buildAgt002IntegralAnalysisV3OutputJsonSchema,
  collectAgt002PreviewEvidenceIds,
  collectAgt002PreviewLegalCitationIds,
  completeAgt002PreviewLegalAbstention,
  validateAgt002PreviewModelOutput,
  validateAgt002PreviewModelOutputV3,
  validateAgt002PreviewModelOutputByVersion,
} from '../agt002-preview-contract.js';
import { buildAgt002PreviewInput } from '../agt002-preview-input.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { retrieveAgt002LegalEvidence } from '../agt002-legal-retrieval.js';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from '../agt002-integral-analysis-v3.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN } from '../agt002-evidence-state-manifest.js';

assert.equal(AGT002_PREVIEW_SCHEMA_VERSION, '2.0-preview.1');
assert.deepEqual([...AGT002_PREVIEW_RECOMMENDATIONS].sort(), ['advance', 'advance_conditionally', 'do_not_advance', 'pause']);

// The wire-level outputSchema handed to turn/start must itself be closed and
// consistent with the runtime validator above: this is the model-side constraint,
// validateAgt002PreviewModelOutput remains the authoritative server-side check.
{
  const schema = AGT002_PREVIEW_OUTPUT_JSON_SCHEMA;
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.slice().sort(), ['blockers', 'human_review_required', 'next_action', 'questions', 'recommendation', 'strengths', 'summary', 'unverified', 'weaknesses'].sort());
  assert.deepEqual(schema.properties.recommendation.enum.slice().sort(), [...AGT002_PREVIEW_RECOMMENDATIONS].sort());
  // Regression: the real Codex App Server rejects a bare `const` keyword with
  // `invalid_json_schema` — every const node must also declare its `type`.
  assert.deepEqual(schema.properties.human_review_required, { type: 'boolean', const: true });
  for (const field of ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']) {
    const itemSchema = schema.properties[field].items;
    assert.equal(schema.properties[field].type, 'array');
    assert.equal(itemSchema.type, 'object');
    assert.equal(itemSchema.additionalProperties, false);
    assert.deepEqual(itemSchema.required, ['id', 'text', 'critical', 'evidence_refs']);
  }
}

const previewInput = buildAgt002PreviewInput({
  opportunity: { id: 'opp-1', company_name: 'Entidad', title: 'Vigilancia' },
  documents: [
    { id: 'doc-01', name: 'Pliego', document_type: 'pliego', extracted_text: 'Requiere póliza vigente.' },
    { id: 'doc-02', name: 'Anexo', document_type: 'anexo_tecnico', extracted_text: 'Requiere CCTV.' },
  ],
  companyProfile: {},
  deepAnalysis: {},
  snapshotId: 'snapshot-1',
});

const allowedEvidenceIds = collectAgt002PreviewEvidenceIds(previewInput);
assert.deepEqual(allowedEvidenceIds, ['document:doc-01', 'document:doc-02'], 'evidence ids must be derived from the sent input, sorted and deduped');

function finding(overrides = {}) {
  return { id: 'f-1', text: 'Falta póliza vigente.', critical: true, evidence_refs: ['document:doc-01'], ...overrides };
}
function baseOutput(overrides = {}) {
  return {
    recommendation: 'pause',
    summary: 'Falta confirmar póliza.',
    strengths: [],
    weaknesses: [finding()],
    blockers: [],
    questions: [],
    unverified: [],
    next_action: 'Solicitar póliza vigente.',
    human_review_required: true,
    ...overrides,
  };
}

const validated = validateAgt002PreviewModelOutput(baseOutput(), { allowedEvidenceIds });
assert.deepEqual(validated, baseOutput());

// Closed shape: unknown keys are rejected (defends against the model trying to smuggle
// a GO/NO GO field or any extra instruction-shaped content).
assert.throws(() => validateAgt002PreviewModelOutput({ ...baseOutput(), decision: 'go' }, { allowedEvidenceIds }), /cerrad|inesperad/i);
assert.throws(() => validateAgt002PreviewModelOutput({ ...baseOutput(), go_no_go: 'go' }, { allowedEvidenceIds }), /cerrad|inesperad/i);
for (const key of ['recommendation', 'summary', 'strengths', 'weaknesses', 'blockers', 'questions', 'unverified', 'next_action', 'human_review_required']) {
  const { [key]: _drop, ...missing } = baseOutput();
  assert.throws(() => validateAgt002PreviewModelOutput(missing, { allowedEvidenceIds }), new RegExp(key.replace(/_/g, '.'), 'i'));
}

assert.throws(() => validateAgt002PreviewModelOutput(baseOutput({ recommendation: 'go' }), { allowedEvidenceIds }), /recomendaci/i);
assert.throws(() => validateAgt002PreviewModelOutput(baseOutput({ recommendation: 'no_go' }), { allowedEvidenceIds }), /recomendaci/i);
assert.throws(() => validateAgt002PreviewModelOutput(baseOutput({ human_review_required: false }), { allowedEvidenceIds }), /revisión humana/i);
assert.throws(() => validateAgt002PreviewModelOutput(baseOutput({ summary: '' }), { allowedEvidenceIds }), /resumen|summary/i);
assert.throws(() => validateAgt002PreviewModelOutput(baseOutput({ next_action: '   ' }), { allowedEvidenceIds }), /siguiente acción|next_action/i);
assert.throws(() => validateAgt002PreviewModelOutput(baseOutput({ weaknesses: {} }), { allowedEvidenceIds }), /weaknesses/i);
assert.throws(() => validateAgt002PreviewModelOutput(baseOutput({ weaknesses: [{ id: 'f-1' }] }), { allowedEvidenceIds }), /hallazgo/i);
assert.throws(() => validateAgt002PreviewModelOutput(baseOutput({ weaknesses: [finding({ evidence_refs: 'document:doc-01' })] }), { allowedEvidenceIds }), /hallazgo/i);

// Citation discipline: an evidence_id not present in the exact input sent to the model
// must be rejected fail-closed, even if it looks plausible (hallucination / injected citation).
assert.throws(
  () => validateAgt002PreviewModelOutput(baseOutput({ weaknesses: [finding({ evidence_refs: ['document:doc-99'] })] }), { allowedEvidenceIds }),
  /cita|evidence/i,
);
assert.throws(
  () => validateAgt002PreviewModelOutput(baseOutput({ blockers: [finding({ id: 'f-2', evidence_refs: ['document:doc-01', 'document:doc-99'] })] }), { allowedEvidenceIds }),
  /cita|evidence/i,
);
assert.throws(
  () => validateAgt002PreviewModelOutput(baseOutput({ blockers: [finding({ id: 'f-2', evidence_refs: [] })] }), { allowedEvidenceIds }),
  /cita|evidence/i,
  'every persisted finding must cite at least one evidence_id from the exact input',
);

for (const bad of [null, undefined, [], 'not-an-object', 42]) {
  assert.throws(() => validateAgt002PreviewModelOutput(bad, { allowedEvidenceIds }), /estructura|objeto/i);
}

// Context v2 (AGT002_CONTEXT_V2): structured opportunity/company evidence must enter the
// same closed evidence-id universe the model output is validated against, so a finding can
// cite company_dossier or opportunity evidence exactly like a document excerpt.
{
  const contextV2Sections = {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-07-29T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-07-29T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-29T10:00:00.000Z' },
      documents: [],
    }),
  };
  const contextV2Input = buildAgt002PreviewInput({
    documents: [{ id: 'doc-01', name: 'Pliego', document_type: 'pliego', extracted_text: 'Requiere póliza vigente.' }],
    deepAnalysis: {},
    snapshotId: 'snapshot-1',
    contextV2: true,
    contextV2Sections,
  });
  assert.equal(contextV2Input.context_version, 2);
  assert.equal(Object.hasOwn(contextV2Input, 'deep_analysis'), false);

  const contextV2EvidenceIds = collectAgt002PreviewEvidenceIds(contextV2Input);
  assert.ok(contextV2EvidenceIds.includes('document:doc-01'));
  assert.ok(contextV2EvidenceIds.includes(contextV2Input.opportunity.tender_id.source.reference));
  assert.ok(contextV2EvidenceIds.includes(contextV2Input.company_dossier.legal_name.source.reference));

  const finding = { id: 'f-1', text: 'La razón social coincide con el expediente.', critical: false, evidence_refs: [contextV2Input.company_dossier.legal_name.source.reference] };
  const output = validateAgt002PreviewModelOutput({
    recommendation: 'pause', summary: 'Resumen.', strengths: [finding], weaknesses: [], blockers: [], questions: [], unverified: [],
    next_action: 'Revisar.', human_review_required: true,
  }, { allowedEvidenceIds: contextV2EvidenceIds });
  assert.deepEqual(output.strengths, [finding]);
}

// AGT002_DOCUMENT_RETRIEVAL: when the previewInput carries a closed document_evidence
// package (Task 26/27), collectAgt002PreviewEvidenceIds must derive the citable set
// EXACTLY from document_evidence.citation_allowlist — never by re-walking `documents` —
// so an omitted/non-allowlisted chunk can never become citable even if it still appears
// somewhere else in the payload, and validation of the model output rejects it.
{
  const allowedRef = 'evidence:chunk:ver-a:p1:s1:c0';
  const omittedRef = 'evidence:chunk:ver-b:p1:s1:c0';
  const mockPreviewInput = {
    schema_version: '1.0',
    snapshot_id: 'snap-1',
    context_version: 2,
    documents: [
      { document_id: 'doc-a', evidence_id: allowedRef, name: 'Doc A', document_type: 'pliego', trust: 'untrusted_document_excerpt', excerpt: 'Contenido A.' },
      // Simulated corruption/stale reference: this evidence_id is not in citation_allowlist
      // and must never leak into the citable set through the documents array.
      { document_id: 'doc-b', evidence_id: omittedRef, name: 'Doc B', document_type: 'pliego', trust: 'untrusted_document_excerpt', excerpt: 'Contenido B.' },
    ],
    document_evidence: {
      snapshot_id: 'snap-1',
      budget: { max_chunks: 40, max_chars: 40000, max_tokens: 12000, chunks_used: 1, chars_used: 12, tokens_used: 3, chunks_remaining: 39, chars_remaining: 39988, tokens_remaining: 11997 },
      selected_chunks: [{ evidence_ref: allowedRef, chunk_id: 'chunk:ver-a:p1:s1:c0', document_id: 'doc-a' }],
      citation_allowlist: [allowedRef],
      coverage_manifest: { by_document: [], by_document_type: [], by_requirement: [] },
      omitted_chunks: [{ evidence_ref: omittedRef, chunk_id: 'chunk:ver-b:p1:s1:c0', document_id: 'doc-b', document_type: 'pliego', requirement_id: 'req-a', reason: 'lower_relevance' }],
      material_omissions: true,
    },
  };

  const ids = collectAgt002PreviewEvidenceIds(mockPreviewInput);
  assert.deepEqual(ids, [allowedRef], 'evidence ids must come exactly from document_evidence.citation_allowlist, not from documents');
  assert.ok(!ids.includes(omittedRef));

  const allowedFinding = { id: 'f-1', text: 'Cumple.', critical: false, evidence_refs: [allowedRef] };
  const validated = validateAgt002PreviewModelOutput({
    recommendation: 'pause', summary: 'Resumen.', strengths: [allowedFinding], weaknesses: [], blockers: [], questions: [], unverified: [],
    next_action: 'Revisar.', human_review_required: true,
  }, { allowedEvidenceIds: ids });
  assert.deepEqual(validated.strengths, [allowedFinding]);

  const omittedFinding = { id: 'f-2', text: 'No debería citarse.', critical: false, evidence_refs: [omittedRef] };
  assert.throws(
    () => validateAgt002PreviewModelOutput({
      recommendation: 'pause', summary: 'Resumen.', strengths: [omittedFinding], weaknesses: [], blockers: [], questions: [], unverified: [],
      next_action: 'Revisar.', human_review_required: true,
    }, { allowedEvidenceIds: ids }),
    /cita|evidence/i,
    'a chunk present in omitted_chunks but absent from citation_allowlist must never be citable',
  );
}

// End-to-end through buildAgt002PreviewInput with documentRetrieval enabled: the closed
// evidence-id universe still combines the document retrieval allowlist with context v2 /
// human evidence references, exactly like the plain contextV2 case above.
{
  const contextV2Sections = {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-07-29T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-07-29T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-29T10:00:00.000Z' },
      documents: [],
    }),
  };
  const retrievalInput = buildAgt002PreviewInput({
    documents: [
      { document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64), current: true, extracted_text: 'Requiere póliza vigente de cumplimiento.' },
    ],
    deepAnalysis: {
      matrix: {
        legal: [{
          id: 'req-poliza', front: 'legal', label: 'Póliza vigente',
          evidence: [{ document_id: 'ver-01', document_name: 'Pliego', document_type: 'pliego', excerpt: 'póliza vigente' }],
        }],
        financial: [],
        technical: [],
      },
    },
    snapshotId: 'snapshot-1',
    contextV2: true,
    contextV2Sections,
    documentRetrieval: true,
  });

  const retrievalEvidenceIds = collectAgt002PreviewEvidenceIds(retrievalInput);
  assert.ok(retrievalInput.document_evidence.citation_allowlist.length > 0);
  // Document evidence ids come from the closed retrieval package...
  for (const ref of retrievalInput.document_evidence.citation_allowlist) assert.ok(retrievalEvidenceIds.includes(ref));
  // ...combined with (not replaced by) context v2 opportunity/company_dossier references.
  assert.ok(retrievalEvidenceIds.includes(retrievalInput.opportunity.tender_id.source.reference));
  assert.ok(retrievalEvidenceIds.includes(retrievalInput.company_dossier.legal_name.source.reference));
  // Retrieval mode carries no duplicate legacy documents array; the allowlist is the sole
  // document evidence universe.
  assert.equal(Object.hasOwn(retrievalInput, 'documents'), false);
}

// --- AGT002_LEGAL_CORPUS: legal evidence and abstention grounded in the versioned official
// corpus (Task29-32), behind an explicit flag that requires AGT002_CONTEXT_V2. Flag off must
// keep the exact contract above byte-identical (rollback). ---

function makeLegalSource(overrides = {}) {
  return {
    source_id: 'decreto-356-1994-art-4',
    norm_type: 'decreto_ley',
    norm_number: '356',
    year: 1994,
    article_or_section: 'Artículo 4',
    current_text: 'Texto vigente de prueba sobre campo de aplicación de vigilancia y seguridad privada.',
    issuing_authority: 'Presidencia de la República',
    issued_at: '1994-02-11',
    effective_from: '1994-02-11',
    effective_to: null,
    modifications: [],
    official_url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=1341',
    topic: ['vigilancia y seguridad privada'],
    sector: ['vigilancia y seguridad privada'],
    verified_at: '2026-01-01',
    corpus_version: 'legal-corpus-test-v1',
    verification_status: 'verified',
    validity_status: 'confirmed',
    applicability_status: 'applicable',
    ...overrides,
  };
}

const eligibleLegalSource = makeLegalSource();
const uncertainLegalSource = makeLegalSource({
  source_id: 'ley-1150-2007-art-2',
  norm_number: '1150',
  year: 2007,
  article_or_section: 'Artículo 2',
  issuing_authority: 'Congreso de la República',
  issued_at: '2007-07-16',
  effective_from: null,
  official_url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=7654321',
  validity_status: 'uncertain',
});

const legalQueryBase = {
  corpus_version: 'legal-corpus-test-v1',
  as_of: '2026-01-01',
  sector: ['vigilancia y seguridad privada'],
  topics: ['vigilancia y seguridad privada'],
};

function makeLegalPackage(sources) {
  return retrieveAgt002LegalEvidence({
    corpus: { corpus_version: 'legal-corpus-test-v1', sources },
    ...legalQueryBase,
  });
}

function makeLegalContextV2Sections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-07-29T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-07-29T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-29T10:00:00.000Z' },
      documents: [],
    }),
  };
}

const legalDeepAnalysis = { matrix: { legal: [{ id: 'req-vigilancia', front: 'legal', label: 'Vigilancia armada' }], financial: [], technical: [] } };

// buildAgt002PreviewOutputJsonSchema: legacy constant is preserved untouched; the closed
// builder only extends the schema when legalCorpus is explicitly requested.
{
  assert.deepEqual(buildAgt002PreviewOutputJsonSchema({ legalCorpus: false }), AGT002_PREVIEW_OUTPUT_JSON_SCHEMA);
  assert.deepEqual(buildAgt002PreviewOutputJsonSchema(), AGT002_PREVIEW_OUTPUT_JSON_SCHEMA);

  const legalSchema = buildAgt002PreviewOutputJsonSchema({ legalCorpus: true });
  assert.equal(legalSchema.type, 'object');
  assert.equal(legalSchema.additionalProperties, false);
  assert.ok(legalSchema.required.includes('legal_findings'));
  assert.deepEqual(legalSchema.required.slice().sort(), [...AGT002_PREVIEW_OUTPUT_JSON_SCHEMA.required, 'legal_findings'].sort());
  const legalFindingItemSchema = legalSchema.properties.legal_findings.items;
  assert.equal(legalSchema.properties.legal_findings.type, 'array');
  assert.equal(legalFindingItemSchema.type, 'object');
  assert.equal(legalFindingItemSchema.additionalProperties, false);
  assert.deepEqual(legalFindingItemSchema.required.slice().sort(), ['classification', 'evidence_refs', 'legal_citation_ids', 'text'].sort());
  assert.deepEqual(legalFindingItemSchema.properties.classification.enum.slice().sort(), [...AGT002_LEGAL_FINDING_CLASSIFICATIONS].sort());

  // AGT002_PREVIEW_OUTPUT_JSON_SCHEMA itself must remain byte-identical (no in-place mutation).
  assert.equal(Object.hasOwn(AGT002_PREVIEW_OUTPUT_JSON_SCHEMA.properties, 'legal_findings'), false);
}

// The live Codex provider rejects oneOf/anyOf in this outputSchema path. Keep the model-side
// schema closed and dynamically enum-constrained, with all per-classification semantics
// enforced by validateAgt002PreviewModelOutput and deterministic abstention completion.
{
  const legalSchema = buildAgt002PreviewOutputJsonSchema({ legalCorpus: true });
  const itemSchema = legalSchema.properties.legal_findings.items;
  assert.equal(Object.hasOwn(itemSchema, 'oneOf'), false);
  assert.equal(Object.hasOwn(itemSchema, 'anyOf'), false);
  assert.deepEqual(itemSchema.properties.classification.enum, AGT002_LEGAL_FINDING_CLASSIFICATIONS);
  const constrained = buildAgt002PreviewOutputJsonSchema({
    legalCorpus: true, allowedEvidenceIds: ['document:doc-01'], allowedLegalCitationIds: ['citation:x:v1'],
  });
  const constrainedItemSchema = constrained.properties.legal_findings.items;
  assert.deepEqual(constrainedItemSchema.properties.evidence_refs.items.enum, ['document:doc-01']);
  assert.deepEqual(constrainedItemSchema.properties.legal_citation_ids.items.enum, ['citation:x:v1']);
}

assert.deepEqual([...AGT002_LEGAL_FINDING_CLASSIFICATIONS].sort(), [
  'company_evidence', 'human_legal_review', 'inference', 'legal_obligation', 'tender_requirement',
].sort());
assert.equal(AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, 'No verificado jurídicamente; requiere revisión humana');

// buildAgt002PreviewInput fail-closed guards for AGT002_LEGAL_CORPUS.
{
  const contextV2Sections = makeLegalContextV2Sections();
  const legalPackage = makeLegalPackage([eligibleLegalSource, uncertainLegalSource]);

  assert.throws(
    () => buildAgt002PreviewInput({
      documents: [], deepAnalysis: {}, snapshotId: 'snapshot-1', contextV2: false, legalCorpus: true, legalEvidencePackage: legalPackage,
    }),
    /AGT002_CONTEXT_V2|contexto v2/i,
    'legalCorpus requires contextV2, mirroring documentRetrieval',
  );

  assert.throws(
    () => buildAgt002PreviewInput({
      documents: [], deepAnalysis: {}, snapshotId: 'snapshot-1', contextV2: true, contextV2Sections, legalCorpus: true,
    }),
    /paquete de recuperación jurídica|legal/i,
    'legalCorpus without an explicit legalEvidencePackage must fail closed',
  );

  // Flag off (default): a caller that always builds a legal package must not leak it without the flag.
  const flagOffInput = buildAgt002PreviewInput({
    documents: [], deepAnalysis: {}, snapshotId: 'snapshot-1', contextV2: true, contextV2Sections, legalEvidencePackage: legalPackage,
  });
  assert.equal(Object.hasOwn(flagOffInput, 'legal_evidence'), false);
}

// Malformed/tampered legal evidence packages must fail closed: no invented field survives.
{
  const contextV2Sections = makeLegalContextV2Sections();
  const legalPackage = makeLegalPackage([eligibleLegalSource, uncertainLegalSource]);

  assert.throws(
    () => buildAgt002PreviewInput({
      documents: [], deepAnalysis: {}, snapshotId: 'snapshot-1', contextV2: true, contextV2Sections,
      legalCorpus: true, legalEvidencePackage: { ...legalPackage, extra_field: 'invented' },
    }),
    /clave|cerrad|desconocid/i,
  );

  assert.throws(
    () => buildAgt002PreviewInput({
      documents: [], deepAnalysis: {}, snapshotId: 'snapshot-1', contextV2: true, contextV2Sections,
      legalCorpus: true, legalEvidencePackage: { ...legalPackage, allowed_citation_ids: [...legalPackage.allowed_citation_ids, 'citation:invented:legal-corpus-test-v1'] },
    }),
    /allowed_citation_ids|allowlist/i,
    'a tampered/widened allowlist must be rejected, never trusted verbatim',
  );

  const tamperedStatement = {
    ...legalPackage,
    human_legal_review_items: legalPackage.human_legal_review_items.map(item => ({ ...item, statement: 'Texto alterado.' })),
  };
  assert.throws(
    () => buildAgt002PreviewInput({
      documents: [], deepAnalysis: {}, snapshotId: 'snapshot-1', contextV2: true, contextV2Sections,
      legalCorpus: true, legalEvidencePackage: tamperedStatement,
    }),
    /No verificado jurídicamente/,
    'the exact abstention statement must be enforced when ingesting the package, not only when rendered',
  );

  const tamperedUrl = {
    ...legalPackage,
    verified_legal_evidence: legalPackage.verified_legal_evidence.map(item => ({
      ...item,
      citation: { ...item.citation, official_url: 'https://not-an-official-host.example/norma' },
    })),
  };
  assert.throws(
    () => buildAgt002PreviewInput({
      documents: [], deepAnalysis: {}, snapshotId: 'snapshot-1', contextV2: true, contextV2Sections,
      legalCorpus: true, legalEvidencePackage: tamperedUrl,
    }),
    /HTTPS|oficial/i,
  );
}

// GREEN shape: a valid Task32 package produces a closed legal_evidence section with an
// allowlist that never mixes with document evidence ids.
let legalPreviewInput;
let legalEvidenceIds;
{
  const contextV2Sections = makeLegalContextV2Sections();
  const legalPackage = makeLegalPackage([eligibleLegalSource, uncertainLegalSource]);

  legalPreviewInput = buildAgt002PreviewInput({
    documents: [{ id: 'doc-01', name: 'Pliego', document_type: 'pliego', extracted_text: 'Vigilancia armada requerida.' }],
    deepAnalysis: legalDeepAnalysis,
    snapshotId: 'snapshot-1',
    contextV2: true,
    contextV2Sections,
    legalCorpus: true,
    legalEvidencePackage: legalPackage,
  });

  assert.ok(legalPreviewInput.legal_evidence, 'flag on must attach the closed legal evidence package');
  assert.equal(legalPreviewInput.legal_evidence.corpus_version, 'legal-corpus-test-v1');
  assert.equal(legalPreviewInput.legal_evidence.as_of, '2026-01-01');
  assert.equal(legalPreviewInput.legal_evidence.verified_legal_evidence.length, 1);
  assert.equal(legalPreviewInput.legal_evidence.verified_legal_evidence[0].source_id, 'decreto-356-1994-art-4');
  assert.equal(legalPreviewInput.legal_evidence.human_legal_review_items.length, 1);
  assert.equal(legalPreviewInput.legal_evidence.human_legal_review_items[0].source_id, 'ley-1150-2007-art-2');
  assert.equal(legalPreviewInput.legal_evidence.human_legal_review_items[0].statement, AGT002_LEGAL_HUMAN_REVIEW_STATEMENT);
  assert.equal(legalPreviewInput.legal_evidence.abstention_state, 'grounded');
  assert.deepEqual(legalPreviewInput.legal_evidence.citation_allowlist, ['citation:decreto-356-1994-art-4:legal-corpus-test-v1']);

  legalEvidenceIds = collectAgt002PreviewLegalCitationIds(legalPreviewInput);
  assert.deepEqual(legalEvidenceIds.verified, ['citation:decreto-356-1994-art-4:legal-corpus-test-v1']);
  assert.deepEqual(legalEvidenceIds.all, [
    'citation:decreto-356-1994-art-4:legal-corpus-test-v1',
    'citation:ley-1150-2007-art-2:legal-corpus-test-v1',
  ]);

  // Legal citation ids must never leak into (or be derivable from) the documentary evidence
  // allowlist: the two universes never mix.
  const documentEvidenceIds = collectAgt002PreviewEvidenceIds(legalPreviewInput);
  for (const legalId of legalEvidenceIds.all) assert.ok(!documentEvidenceIds.includes(legalId));
}

// Abstention: no eligible source at all must never produce a verified legal_obligation and
// must expose abstention_state = 'abstained'.
{
  const contextV2Sections = makeLegalContextV2Sections();
  const abstainedPackage = makeLegalPackage([uncertainLegalSource]);
  const abstainedInput = buildAgt002PreviewInput({
    documents: [], deepAnalysis: legalDeepAnalysis, snapshotId: 'snapshot-1', contextV2: true, contextV2Sections,
    legalCorpus: true, legalEvidencePackage: abstainedPackage,
  });
  assert.equal(abstainedInput.legal_evidence.abstention_state, 'abstained');
  assert.deepEqual(abstainedInput.legal_evidence.citation_allowlist, []);

  const legalCitationIds = collectAgt002PreviewLegalCitationIds(abstainedInput);
  assert.deepEqual(legalCitationIds.verified, []);

  const documentEvidenceIds = collectAgt002PreviewEvidenceIds(abstainedInput);
  assert.throws(
    () => validateAgt002PreviewModelOutput({
      recommendation: 'pause', summary: 'Resumen.', strengths: [], weaknesses: [], blockers: [], questions: [], unverified: [],
      next_action: 'Revisar.', human_review_required: true,
      legal_findings: [{ classification: 'legal_obligation', text: 'Obligación inventada.', evidence_refs: [], legal_citation_ids: ['citation:ley-1150-2007-art-2:legal-corpus-test-v1'] }],
    }, { allowedEvidenceIds: documentEvidenceIds, legalCorpus: true, legalCitationIds }),
    /allowlist|verificad|elegible/i,
    'without any eligible source, output must abstain rather than invent a verified obligation',
  );
}

// validateAgt002PreviewModelOutput: five closed classes, citation discipline, and the exact
// abstention statement — flag off keeps the legacy contract untouched.
{
  const legalCitationIds = collectAgt002PreviewLegalCitationIds(legalPreviewInput);
  const allowedEvidenceIds = collectAgt002PreviewEvidenceIds(legalPreviewInput);

  function legalOutput(overrides = {}) {
    return {
      recommendation: 'pause',
      summary: 'Resumen.',
      strengths: [],
      weaknesses: [],
      blockers: [],
      questions: [],
      unverified: [],
      next_action: 'Revisar.',
      human_review_required: true,
      legal_findings: [
        { classification: 'tender_requirement', text: 'El pliego exige vigilancia armada.', evidence_refs: ['document:doc-01'], legal_citation_ids: [] },
        { classification: 'legal_obligation', text: 'La actividad de vigilancia armada requiere licencia de Supervigilancia.', evidence_refs: [], legal_citation_ids: ['citation:decreto-356-1994-art-4:legal-corpus-test-v1'] },
        { classification: 'company_evidence', text: 'La empresa reporta licencia vigente.', evidence_refs: ['document:doc-01'], legal_citation_ids: [] },
        { classification: 'inference', text: 'Es razonable esperar que la licencia cubra el objeto contractual.', evidence_refs: ['document:doc-01'], legal_citation_ids: [] },
        { classification: 'human_legal_review', text: AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, evidence_refs: [], legal_citation_ids: ['citation:ley-1150-2007-art-2:legal-corpus-test-v1'] },
      ],
      ...overrides,
    };
  }

  // Flag off: legacy contract is untouched, and a legal_findings key is rejected as unexpected
  // (defends against silently carrying legal content when the flag is off).
  assert.throws(
    () => validateAgt002PreviewModelOutput(legalOutput(), { allowedEvidenceIds }),
    /cerrad|inesperad/i,
  );

  // Flag on: five well-formed classes validate together.
  const validated = validateAgt002PreviewModelOutput(legalOutput(), { allowedEvidenceIds, legalCorpus: true, legalCitationIds });
  assert.equal(validated.legal_findings.length, 5);

  // Flag on but legal_findings missing entirely: fails closed like any other required key.
  {
    const { legal_findings: _drop, ...missing } = legalOutput();
    assert.throws(
      () => validateAgt002PreviewModelOutput(missing, { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
      /legal_findings/i,
    );
  }

  // Claim sin cita: legal_obligation with no legal_citation_ids must be rejected.
  assert.throws(
    () => validateAgt002PreviewModelOutput(legalOutput({
      legal_findings: [{ classification: 'legal_obligation', text: 'Obligación sin cita.', evidence_refs: [], legal_citation_ids: [] }],
    }), { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
    /citation|cita/i,
  );

  // Unknown citation: an invented/unrecognized citation id must be rejected.
  assert.throws(
    () => validateAgt002PreviewModelOutput(legalOutput({
      legal_findings: [{ classification: 'legal_obligation', text: 'Obligación con cita falsa.', evidence_refs: [], legal_citation_ids: ['citation:inventada:legal-corpus-test-v1'] }],
    }), { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
    /cita|citation/i,
  );

  // A legal_obligation may only cite the verified allowlist, never an uncertain/human-review-only citation.
  assert.throws(
    () => validateAgt002PreviewModelOutput(legalOutput({
      legal_findings: [{ classification: 'legal_obligation', text: 'Obligación mal fundada.', evidence_refs: [], legal_citation_ids: ['citation:ley-1150-2007-art-2:legal-corpus-test-v1'] }],
    }), { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
    /verificad|elegible|allowlist/i,
  );

  // Uncertain exact warning: human_legal_review must render the exact fixed statement.
  assert.throws(
    () => validateAgt002PreviewModelOutput(legalOutput({
      legal_findings: [{ classification: 'human_legal_review', text: 'Podría no estar vigente.', evidence_refs: [], legal_citation_ids: ['citation:ley-1150-2007-art-2:legal-corpus-test-v1'] }],
    }), { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
    /No verificado jurídicamente/,
  );

  // tender_requirement / company_evidence / inference must never carry legal_citation_ids
  // (never renamed as law) and must cite documentary/contextual evidence when asserting facts.
  for (const classification of ['tender_requirement', 'company_evidence', 'inference']) {
    assert.throws(
      () => validateAgt002PreviewModelOutput(legalOutput({
        legal_findings: [{ classification, text: 'Hecho con cita jurídica indebida.', evidence_refs: ['document:doc-01'], legal_citation_ids: ['citation:decreto-356-1994-art-4:legal-corpus-test-v1'] }],
      }), { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
      /no puede citar identificadores jurídicos|derecho/i,
      `${classification} must never be renamed as law`,
    );
    assert.throws(
      () => validateAgt002PreviewModelOutput(legalOutput({
        legal_findings: [{ classification, text: 'Hecho sin evidencia.', evidence_refs: [], legal_citation_ids: [] }],
      }), { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
      /evidence/i,
      `${classification} must cite at least one evidence_ref`,
    );
  }

  // A citation-shaped value must never validate as a documentary evidence_ref (no field mixing).
  assert.throws(
    () => validateAgt002PreviewModelOutput(legalOutput({
      legal_findings: [{ classification: 'company_evidence', text: 'Evidencia con cita legal mezclada.', evidence_refs: ['citation:decreto-356-1994-art-4:legal-corpus-test-v1'], legal_citation_ids: [] }],
    }), { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
    /cita|evidence/i,
  );

  // legal_obligation must never carry documentary evidence_refs either.
  assert.throws(
    () => validateAgt002PreviewModelOutput(legalOutput({
      legal_findings: [{ classification: 'legal_obligation', text: 'Obligación mezclada.', evidence_refs: ['document:doc-01'], legal_citation_ids: ['citation:decreto-356-1994-art-4:legal-corpus-test-v1'] }],
    }), { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
    /evidence_refs/i,
  );

  // Unknown classification is rejected (closed enum only; never a decision/approval-shaped label).
  assert.throws(
    () => validateAgt002PreviewModelOutput(legalOutput({
      legal_findings: [{ classification: 'go_no_go', text: 'x', evidence_refs: [], legal_citation_ids: [] }],
    }), { allowedEvidenceIds, legalCorpus: true, legalCitationIds }),
    /hallazgo|clasificaci/i,
  );
}

// completeAgt002PreviewLegalAbstention (E5 follow-up): deterministically fills in whichever
// required human-review citations the model omitted, without ever touching any other finding.
{
  const requiredHumanReviewCitationIds = ['citation:b:v1', 'citation:a:v1'];

  // Empty legal_findings: a single canonical finding covering every required id is appended.
  {
    const value = { legal_findings: [] };
    const completed = completeAgt002PreviewLegalAbstention(value, { requiredHumanReviewCitationIds });
    assert.equal(completed.legal_findings.length, 1);
    assert.deepEqual(completed.legal_findings[0], {
      classification: 'human_legal_review', text: AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, evidence_refs: [],
      legal_citation_ids: ['citation:a:v1', 'citation:b:v1'],
    });
  }

  // Partial coverage: the model's own finding is left byte-for-byte untouched; only the
  // missing citation is appended as a second finding.
  {
    const modelFinding = { classification: 'human_legal_review', text: AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, evidence_refs: [], legal_citation_ids: ['citation:a:v1'] };
    const otherFinding = { classification: 'tender_requirement', text: 'x', evidence_refs: ['document:doc-01'], legal_citation_ids: [] };
    const value = { legal_findings: [otherFinding, modelFinding] };
    const completed = completeAgt002PreviewLegalAbstention(value, { requiredHumanReviewCitationIds });
    assert.equal(completed.legal_findings.length, 3);
    assert.equal(completed.legal_findings[0], otherFinding, 'non-human_legal_review findings must be untouched (same reference)');
    assert.equal(completed.legal_findings[1], modelFinding, 'a partially-correct human_legal_review finding must be untouched (same reference)');
    assert.deepEqual(completed.legal_findings[2], {
      classification: 'human_legal_review', text: AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, evidence_refs: [], legal_citation_ids: ['citation:b:v1'],
    });
  }

  // Full coverage already: value is returned unchanged (no redundant finding appended).
  {
    const modelFinding = { classification: 'human_legal_review', text: AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, evidence_refs: [], legal_citation_ids: [...requiredHumanReviewCitationIds] };
    const value = { legal_findings: [modelFinding] };
    const completed = completeAgt002PreviewLegalAbstention(value, { requiredHumanReviewCitationIds });
    assert.equal(completed, value, 'nothing missing must return the exact same object, not a copy');
  }

  // No deterministic required ids at all: nothing to complete, value returned unchanged.
  {
    const value = { legal_findings: [] };
    assert.equal(completeAgt002PreviewLegalAbstention(value, { requiredHumanReviewCitationIds: [] }), value);
    assert.equal(completeAgt002PreviewLegalAbstention(value), value);
  }

  // Non-legal / malformed shapes pass through unchanged rather than throwing — this function
  // only ever runs on a value that already passed a first structural validation pass.
  assert.equal(completeAgt002PreviewLegalAbstention(null, { requiredHumanReviewCitationIds }), null);
  assert.equal(completeAgt002PreviewLegalAbstention({ recommendation: 'pause' }, { requiredHumanReviewCitationIds }).legal_findings, undefined);

  // Never touches claims/obligations/facts, only ever appends a human_legal_review finding.
  {
    const obligationFinding = { classification: 'legal_obligation', text: 'x', evidence_refs: [], legal_citation_ids: ['citation:verified:v1'] };
    const value = { legal_findings: [obligationFinding] };
    const completed = completeAgt002PreviewLegalAbstention(value, { requiredHumanReviewCitationIds });
    assert.equal(completed.legal_findings[0], obligationFinding);
    assert.equal(completed.legal_findings[1].classification, 'human_legal_review');
  }
}

// ---------------------------------------------------------------------------
// Task 5: v3 provider output schema + explicit version-dispatched validation.
// ---------------------------------------------------------------------------

function buildV3ValidationContext() {
  return {
    requirementManifestVersion: 'agt002-deep-analysis-v1',
    requirementManifest: [{ requirement_id: 'REQ-1', category: 'discard' }],
    companyEvidenceManifestVersion: 'agt002-company-evidence-classes-v1',
    companyEvidenceClassIds: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
    legalCorpusVersionId: null,
    allowlist: {
      tender_document: ['TD-1'], company_evidence: [], legal_corpus: [], human_evidence: [], objective_validation: [],
    },
    materialOmissionsObserved: false,
    // No governed evidence-class link is curated for REQ-1 in this fixture, so the
    // governed map (agt002-evidence-state-manifest.js's default) is the safe-unknown
    // state — matched below in buildMinimalV3IntegralAnalysis's evidence_state.
    evidenceStateManifest: [
      { requirement_id: 'REQ-1', evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN, rule_id: 'no_governed_evidence_class_link', provenance: null },
    ],
  };
}

function buildMinimalV3IntegralAnalysis() {
  return {
    contract_version: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    coverage: {
      manifest_version: 'agt002-deep-analysis-v1',
      expected_requirement_ids: ['REQ-1'],
      analyzed_requirement_ids: ['REQ-1'],
      material_omissions: false,
      omission_reasons: [],
      company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
      company_evidence_class_ids: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
      legal_corpus_version_id: null,
    },
    analysis_units: [{
      unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: 'REQ-1', category: 'discard', sequence: 1,
      title: 'Requisito sintético', assessment_mode: 'assessed',
      conclusion: { status: 'supported_with_evidence', summary: 'Sin causal evidenciada.', confidence: 'high' },
      blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
      evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN,
      evidence_refs: [{ ref: 'TD-1', source_type: 'tender_document', purpose: 'requirement_basis' }],
      missing_evidence: [],
      commercial_impact: { level: 'low', summary: 'Sin impacto.', dimension: 'eligibility' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
      actions: [],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
      closure: { status: 'human_confirmation_required', condition: 'Persona confirma.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar.' },
    }],
  };
}

// The v3 output schema handed to the model exposes ONLY `integral_analysis` — no
// run/snapshot/coverage/usage/legacy v2 keys are ever offered as a slot the model could
// fill in.
{
  assert.equal(AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION, '3.0.0');
  const schema = buildAgt002IntegralAnalysisV3OutputJsonSchema();
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['integral_analysis']);
  assert.deepEqual(Object.keys(schema.properties), ['integral_analysis']);
}

// The runtime v3 validator accepts a well-formed turn and rejects any attempt to smuggle
// governed fields (run identity, coverage, usage, legacy v2 keys) onto the model turn.
{
  const ctx = buildV3ValidationContext();
  const value = { integral_analysis: buildMinimalV3IntegralAnalysis() };
  const result = validateAgt002PreviewModelOutputV3(value, ctx);
  assert.equal(result.contract_version, AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION);

  for (const forged of [
    { integral_analysis: buildMinimalV3IntegralAnalysis(), run_id: '11111111-1111-4111-8111-111111111111' },
    { integral_analysis: buildMinimalV3IntegralAnalysis(), usage: { provider: 'x' } },
    { integral_analysis: buildMinimalV3IntegralAnalysis(), evidence_coverage: {} },
    { integral_analysis: buildMinimalV3IntegralAnalysis(), recommendation: 'advance' },
    { recommendation: 'advance', summary: 'x', strengths: [], weaknesses: [], blockers: [], questions: [], unverified: [], next_action: 'x', human_review_required: true },
  ]) {
    assert.throws(() => validateAgt002PreviewModelOutputV3(forged, ctx), /integral_analysis/i);
  }
}

// Explicit version dispatch, never duck typing: the SERVER-configured version selects the
// validator; the payload's own shape never decides which path runs.
{
  const ctx = buildV3ValidationContext();
  const v3Value = { integral_analysis: buildMinimalV3IntegralAnalysis() };
  const dispatched = validateAgt002PreviewModelOutputByVersion('v3', v3Value, { v3ValidationContext: ctx });
  assert.equal(dispatched.contract_version, AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION);

  // v2 dispatch remains byte-for-byte behavior compatible with calling the v2 validator directly.
  const legacyValue = {
    recommendation: 'advance', summary: 'Resumen', strengths: [], weaknesses: [], blockers: [], questions: [], unverified: [],
    next_action: 'Siguiente acción', human_review_required: true,
  };
  const directResult = validateAgt002PreviewModelOutput(legacyValue, {});
  const dispatchedV2Result = validateAgt002PreviewModelOutputByVersion('v2', legacyValue, {});
  assert.deepEqual(dispatchedV2Result, directResult);

  // Unknown/unsupported version fails closed rather than defaulting to either validator.
  assert.throws(() => validateAgt002PreviewModelOutputByVersion('v1', legacyValue, {}), /versión|version/i);
  assert.throws(() => validateAgt002PreviewModelOutputByVersion(undefined, legacyValue, {}), /versión|version/i);
}

console.log('AGT-002 Preview strict output contract passed');
