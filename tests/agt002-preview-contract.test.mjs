import { strict as assert } from 'node:assert';
import {
  AGT002_PREVIEW_OUTPUT_JSON_SCHEMA,
  AGT002_PREVIEW_RECOMMENDATIONS,
  AGT002_PREVIEW_SCHEMA_VERSION,
  collectAgt002PreviewEvidenceIds,
  validateAgt002PreviewModelOutput,
} from '../agt002-preview-contract.js';
import { buildAgt002PreviewInput } from '../agt002-preview-input.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';

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
    deepAnalysis: { matrix: { legal: [{ id: 'req-poliza', front: 'legal', label: 'Póliza vigente' }], financial: [], technical: [] } },
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

console.log('AGT-002 Preview strict output contract passed');
