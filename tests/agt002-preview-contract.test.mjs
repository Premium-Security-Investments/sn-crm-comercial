import { strict as assert } from 'node:assert';
import {
  AGT002_PREVIEW_OUTPUT_JSON_SCHEMA,
  AGT002_PREVIEW_RECOMMENDATIONS,
  AGT002_PREVIEW_SCHEMA_VERSION,
  collectAgt002PreviewEvidenceIds,
  validateAgt002PreviewModelOutput,
} from '../agt002-preview-contract.js';
import { buildAgt002PreviewInput } from '../agt002-preview-input.js';

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
  assert.equal(schema.properties.human_review_required.const, true);
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

console.log('AGT-002 Preview strict output contract passed');
