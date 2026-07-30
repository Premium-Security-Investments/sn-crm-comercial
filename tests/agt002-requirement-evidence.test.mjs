import { strict as assert } from 'node:assert';
import {
  AGT002_REQUIREMENT_EVIDENCE_STATUSES,
  buildAgt002RequirementEvidenceCrosswalk,
} from '../agt002-requirement-evidence.js';
import {
  collectAgt002PreviewEvidenceIds,
  validateAgt002RequirementEvidenceCrosswalk,
} from '../agt002-preview-contract.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';

assert.deepEqual([...AGT002_REQUIREMENT_EVIDENCE_STATUSES].sort(), [
  'cumplido_con_evidencia', 'cumplimiento_parcial', 'no_cumplido', 'requiere_validacion_humana', 'sin_evidencia_suficiente',
].sort());

const profile = {
  legal_name: 'Seguridad Nacional Ltda.',
  nit: 'NIT 900123456-7',
  rup_status: 'Vigente y en firme',
  rup_updated_at: '2026-06-01',
  rup_unspsc_codes: '92121504',
  authorized_services: 'Vigilancia fija y móvil',
  supervigilancia_license: 'Resolución 1234 de 2026',
  financial_capacity: 'Índice de liquidez 2.1',
  organizational_capacity: 'Rentabilidad patrimonio 0.18',
  experience_summary: 'Contratos de vigilancia privada',
  certifications: 'ISO 9001; ISO 45001',
  disqualifications_notes: null,
  updated_at: '2026-07-29T16:00:00.000Z',
};
const documents = [{
  id: '11111111-1111-4111-8111-111111111111', document_type: 'rup', display_name: 'RUP 2026',
  issued_at: '2026-06-01', expires_at: '2027-04-30', version: 2, content_hash: 'a'.repeat(64),
  current: true, updated_at: '2026-07-29T16:30:00.000Z',
}];
const dossier = buildAgt002CompanyDossier({ profile, documents });
// recurring_documents is the only company-dossier field with status verified (§agt002-company-dossier).
assert.equal(dossier.recurring_documents.status, 'verified');
assert.equal(dossier.licenses.status, 'reported');
// restrictions stays not_verified with this fixture -> exercises the gap path.
assert.equal(dossier.restrictions.status, 'not_verified');

const requirements = [
  // verified dossier evidence + requirement judged satisfied -> cumplido_con_evidencia, citation required.
  { requirement_id: 'req-license', front: 'legal', dossier_field: 'recurring_documents', requirement_status: 'met' },
  // reported (not independently verified) evidence + satisfied -> cumplimiento_parcial, citation required.
  { requirement_id: 'req-financial', front: 'financial', dossier_field: 'financial_capacity', requirement_status: 'met' },
  // evidence present but requirement judged not satisfied -> no_cumplido.
  { requirement_id: 'req-certifications', front: 'technical', dossier_field: 'certifications', requirement_status: 'not_met' },
  // dossier field explicitly not_verified -> sin_evidencia_suficiente, no citation.
  { requirement_id: 'req-restrictions', front: 'legal', dossier_field: 'restrictions', requirement_status: 'unknown' },
  // no dossier_field mapping at all -> requiere_validacion_humana, no citation (no automatic textual equivalence).
  { requirement_id: 'req-unmapped', front: 'technical', requirement_status: 'unknown' },
  // dossier_field mapping to a key that doesn't exist in the dossier -> requiere_validacion_humana.
  { requirement_id: 'req-missing-field', front: 'legal', dossier_field: 'not_a_real_field', requirement_status: 'met' },
];

const crosswalk = buildAgt002RequirementEvidenceCrosswalk({ requirements, companyDossier: dossier });

const byId = Object.fromEntries(crosswalk.map(item => [item.requirement_id, item]));
assert.equal(byId['req-license'].status, 'cumplido_con_evidencia');
assert.deepEqual(byId['req-license'].evidence_refs, [dossier.recurring_documents.source.reference]);
assert.equal(byId['req-financial'].status, 'cumplimiento_parcial');
assert.deepEqual(byId['req-financial'].evidence_refs, [dossier.financial_capacity.source.reference]);
assert.equal(byId['req-certifications'].status, 'no_cumplido');
assert.equal(byId['req-restrictions'].status, 'sin_evidencia_suficiente');
assert.deepEqual(byId['req-restrictions'].evidence_refs, []);
assert.equal(byId['req-unmapped'].status, 'requiere_validacion_humana');
assert.deepEqual(byId['req-unmapped'].evidence_refs, []);
assert.equal(byId['req-missing-field'].status, 'requiere_validacion_humana');
assert.deepEqual(byId['req-missing-field'].evidence_refs, []);

// Deterministic ordering regardless of input order.
const reversed = buildAgt002RequirementEvidenceCrosswalk({ requirements: [...requirements].reverse(), companyDossier: dossier });
assert.deepEqual(reversed, crosswalk);

// Closed input shape: unknown keys, missing requirement_id, invalid front are rejected.
assert.throws(() => buildAgt002RequirementEvidenceCrosswalk({ requirements: [{ front: 'legal', requirement_status: 'met' }], companyDossier: dossier }), /requirement_id/);
assert.throws(() => buildAgt002RequirementEvidenceCrosswalk({ requirements: [{ requirement_id: 'x', front: 'other', requirement_status: 'met' }], companyDossier: dossier }), /front/i);
assert.throws(() => buildAgt002RequirementEvidenceCrosswalk({ requirements: [{ requirement_id: 'x', front: 'legal', requirement_status: 'not-a-status' }], companyDossier: dossier }), /requirement_status/i);
assert.throws(() => buildAgt002RequirementEvidenceCrosswalk({ requirements: [{ requirement_id: 'x', front: 'legal', requirement_status: 'met', extra: 1 }], companyDossier: dossier }), /clave|key/i);

// --- preview-contract.js: closed output section + citation discipline ---

const previewInputLike = { documents: [], opportunity: {}, company_dossier: dossier, commercial_context: {} };
const allowedEvidenceIds = collectAgt002PreviewEvidenceIds(previewInputLike);
assert.ok(allowedEvidenceIds.includes(dossier.licenses.source.reference), 'company_dossier evidence must enter the closed evidence-id universe');
assert.ok(allowedEvidenceIds.includes(dossier.financial_capacity.source.reference));

assert.equal(validateAgt002RequirementEvidenceCrosswalk(crosswalk, { allowedEvidenceIds }), crosswalk);

// Every positive classification must cite evidence present in the closed set (fail-closed on hallucinated ids).
assert.throws(
  () => validateAgt002RequirementEvidenceCrosswalk(
    [{ requirement_id: 'req-x', front: 'legal', status: 'cumplido_con_evidencia', evidence_refs: [], rationale: 'x' }],
    { allowedEvidenceIds },
  ),
  /evidence|cita/i,
);
assert.throws(
  () => validateAgt002RequirementEvidenceCrosswalk(
    [{ requirement_id: 'req-x', front: 'legal', status: 'cumplido_con_evidencia', evidence_refs: ['not-sent:evidence'], rationale: 'x' }],
    { allowedEvidenceIds },
  ),
  /evidence|cita/i,
);
// A non-positive status is allowed to have zero citations.
assert.equal(
  validateAgt002RequirementEvidenceCrosswalk(
    [{ requirement_id: 'req-x', front: 'legal', status: 'requiere_validacion_humana', evidence_refs: [], rationale: 'x' }],
    { allowedEvidenceIds },
  ).length,
  1,
);
// Unknown/invalid status, unexpected keys, and duplicate requirement_id are rejected (closed shape).
assert.throws(() => validateAgt002RequirementEvidenceCrosswalk([{ requirement_id: 'req-x', front: 'legal', status: 'go', evidence_refs: [], rationale: 'x' }], { allowedEvidenceIds }), /estructura|status/i);
assert.throws(() => validateAgt002RequirementEvidenceCrosswalk([{ requirement_id: 'req-x', front: 'legal', status: 'no_cumplido', evidence_refs: [], rationale: 'x', decision: 'go' }], { allowedEvidenceIds }), /estructura/i);
assert.throws(() => validateAgt002RequirementEvidenceCrosswalk([
  { requirement_id: 'req-x', front: 'legal', status: 'no_cumplido', evidence_refs: [], rationale: 'x' },
  { requirement_id: 'req-x', front: 'legal', status: 'no_cumplido', evidence_refs: [], rationale: 'x' },
], { allowedEvidenceIds }), /duplicad/i);
assert.throws(() => validateAgt002RequirementEvidenceCrosswalk('not-an-array', { allowedEvidenceIds }), /lista|array/i);

// The crosswalk never carries a GO/NO-GO decision field.
assert.ok(crosswalk.every(item => !Object.hasOwn(item, 'decision') && !Object.hasOwn(item, 'go_no_go')));

console.log('AGT-002 requirement-evidence crosswalk passed');
