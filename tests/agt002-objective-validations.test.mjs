import assert from 'node:assert/strict';
import { buildAgt002ObjectiveValidations, validateAgt002ObjectiveValidations } from '../agt002-objective-validations.js';
import { buildAgt002PreviewInput } from '../agt002-preview-input.js';

const deepAnalysis = {
  recommendation: 'GO',
  go_no_go: 'GO',
  commercial_fit: { score: 99 },
  legal_conclusion: 'cumple',
  next_action: 'presentar oferta',
  matrix: {
    legal: [{
      id: 'legal-guarantee-policy', front: 'legal',
      values: [{ kind: 'percentage', raw: '20 %', normalized: '20 %' }, { kind: 'duration', raw: '12 meses', normalized: '12 meses' }],
      evidence: [{ document_id: 'doc-1', excerpt: 'dato' }],
    }],
    financial: [{
      id: 'financial-working-capital', front: 'financial',
      values: [{ kind: 'money', raw: '$ 600.000.000', normalized: '$ 600.000.000' }],
      evidence: [{ document_id: 'doc-2', excerpt: 'dato' }],
    }],
    technical: [],
  },
  unverifiable_documents: [{ document_id: 'doc-3', name: 'Anexo vacío.pdf', secret: 'ignore' }],
};

const validations = buildAgt002ObjectiveValidations(deepAnalysis);
assert.deepEqual(Object.keys(validations).sort(), ['extracted_values', 'integrity_checks', 'schema_version', 'unverifiable_documents']);
assert.deepEqual(validations.extracted_values.map(item => item.kind), ['money', 'duration', 'percentage']);
assert.ok(validations.extracted_values.every(item => item.evidence_refs.every(ref => /^document:/.test(ref))));
assert.deepEqual(validations.unverifiable_documents, [{ document_id: 'doc-3', name: 'Anexo vacío.pdf' }]);
assert.equal(validateAgt002ObjectiveValidations(validations), validations);

for (const forbidden of ['recommendation', 'go_no_go', 'commercial_fit', 'legal_conclusion', 'next_action', 'strengths', 'weaknesses', 'blockers', 'questions']) {
  assert.equal(JSON.stringify(validations).includes(forbidden), false, `${forbidden} must never enter objective validations`);
}
assert.throws(() => validateAgt002ObjectiveValidations({ ...validations, recommendation: 'GO' }), /clave.*no permitida/i);
assert.throws(() => validateAgt002ObjectiveValidations({ ...validations, extracted_values: [{ ...validations.extracted_values[0], next_action: 'x' }] }), /clave.*no permitida/i);

const canonicalInput = buildAgt002PreviewInput({
  opportunity: { id: 'opp-1' }, documents: [{ id: 'doc-1', extracted_text: 'Póliza 20 % por 12 meses' }],
  deepAnalysis, snapshotId: 'snap-1', canonicalOnly: true,
});
assert.ok(Object.hasOwn(canonicalInput, 'objective_validations'));
assert.equal(Object.hasOwn(canonicalInput, 'deep_analysis'), false);

const rollbackInput = buildAgt002PreviewInput({
  opportunity: { id: 'opp-1' }, documents: [{ id: 'doc-1', extracted_text: 'Póliza 20 % por 12 meses' }],
  deepAnalysis, snapshotId: 'snap-1', canonicalOnly: false,
});
assert.ok(Object.hasOwn(rollbackInput, 'deep_analysis'));
assert.equal(Object.hasOwn(rollbackInput, 'objective_validations'), false);

console.log('AGT-002 objective validation contract passed');
