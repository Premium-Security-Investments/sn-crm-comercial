import { strict as assert } from 'node:assert';
import {
  buildAgt002IntegralAnalysisV3OutputJsonSchema,
  validateAgt002PreviewModelOutputV3,
} from '../agt002-preview-contract.js';
import { AGT002_INTEGRAL_V3_POLICY } from '../agt002-preview-engine.js';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from '../agt002-integral-analysis-v3.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN } from '../agt002-evidence-state-manifest.js';

// Phase 5 remediation (v3_model_output_shape_mismatch).
//
// The corrected canary fit the window but the model turn returned an integral_analysis carrying
// server-owned keys beyond analysis_units. Three independent authorities must AGREE that those keys
// can only come from the server, never the model:
//   1. the closed wire schema (buildAgt002IntegralAnalysisV3OutputJsonSchema) offers no slot for them;
//   2. the strengthened AGT002_INTEGRAL_V3_POLICY explicitly forbids the model from writing them;
//   3. the runtime validator (validateAgt002PreviewModelOutputV3) rejects them fail-closed with
//      v3_model_output_shape_mismatch even when they carry the correct governed values.
// This test pins that agreement so schema, policy and validator can never drift apart.

// The exact server-owned keys the model must never write, at the two levels they live:
//   integral_analysis.{contract_version, coverage}      — assembled from validationContext
//   analysis_units[tender_requirement].{category, evidence_state} — assembled per requirement
const SERVER_OWNED_INTEGRAL_KEYS = ['contract_version', 'coverage'];
const SERVER_OWNED_TENDER_UNIT_FIELDS = ['category', 'evidence_state'];

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
    evidenceStateManifest: [
      { requirement_id: 'REQ-1', evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN, rule_id: 'no_governed_evidence_class_link', provenance: null },
    ],
  };
}

// Model-facing shape only: category/evidence_state are left null on the tender_requirement unit
// (server-owned), and neither contract_version nor coverage is present (server-owned).
function buildMinimalV3IntegralAnalysis() {
  return {
    analysis_units: [{
      unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: 'REQ-1', category: null, sequence: 1,
      title: 'Requisito sintético', assessment_mode: 'assessed',
      conclusion: { status: 'human_validation_required', summary: 'Sin evidencia gobernada; requiere validación humana.', confidence: 'medium' },
      blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
      evidence_state: null,
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

// ---------------------------------------------------------------------------
// 1. The closed wire schema offers no slot for any server-owned key.
// ---------------------------------------------------------------------------
{
  const schema = buildAgt002IntegralAnalysisV3OutputJsonSchema(buildV3ValidationContext());
  const integralAnalysis = schema.properties.integral_analysis;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['integral_analysis']);
  assert.equal(integralAnalysis.additionalProperties, false);
  assert.deepEqual(integralAnalysis.required, ['analysis_units']);
  assert.deepEqual(Object.keys(integralAnalysis.properties), ['analysis_units']);
  for (const key of SERVER_OWNED_INTEGRAL_KEYS) {
    assert.equal(Object.hasOwn(integralAnalysis.properties, key), false, `wire schema must not offer integral_analysis.${key}`);
  }
  // In a governed manifest context every model unit is a tender_requirement. Strategic units are
  // outside this request, so the wire schema can mechanically force the two server-owned fields to
  // null instead of exposing a strategic/object branch that the provider may choose incorrectly.
  const unitSchema = integralAnalysis.properties.analysis_units.items;
  assert.deepEqual(unitSchema.properties.unit_kind, { type: 'string', enum: ['tender_requirement'] });
  assert.deepEqual(unitSchema.properties.requirement_id, { type: 'string', enum: ['REQ-1'] });
  assert.deepEqual(unitSchema.properties.category, { type: 'null' });
  assert.deepEqual(unitSchema.properties.evidence_state, { type: 'null' });
  assert.deepEqual(
    unitSchema.properties.legal_assessment.properties.status.enum,
    ['not_applicable', 'not_verified'],
  );
}

// ---------------------------------------------------------------------------
// 2. The policy text and the schema AGREE: every server-owned key the schema omits is a key the
//    policy explicitly forbids the model from writing, and the policy states the exact nested shape.
// ---------------------------------------------------------------------------
{
  // The policy names the exact two-level shape the schema encodes.
  assert.match(AGT002_INTEGRAL_V3_POLICY, /integral_analysis[^.]*analysis_units/i, 'policy must state the { integral_analysis: { analysis_units } } shape');
  assert.match(AGT002_INTEGRAL_V3_POLICY, /ninguna otra clave|sólo contiene la clave integral_analysis/i, 'policy must forbid extra keys');
  // Every server-owned integral key the schema omits is explicitly named as forbidden/server-owned.
  for (const key of SERVER_OWNED_INTEGRAL_KEYS) {
    assert.match(AGT002_INTEGRAL_V3_POLICY, new RegExp(key), `policy must name the server-owned key ${key}`);
  }
  // The per-tender_requirement server-owned fields are addressed too (kept null for the server).
  for (const field of SERVER_OWNED_TENDER_UNIT_FIELDS) {
    assert.match(AGT002_INTEGRAL_V3_POLICY, new RegExp(field), `policy must name the server-owned field ${field}`);
  }
  // The forbiddance is explicit, not incidental.
  assert.match(AGT002_INTEGRAL_V3_POLICY, /nunca los incluyas dentro de integral_analysis|jamás se aceptan de tu respuesta/i, 'policy must explicitly forbid model-written server-owned keys');
}

// ---------------------------------------------------------------------------
// 3. The validator makes the server-owned keys impossible from the model turn — but assembles them
//    itself. A well-formed turn is accepted and the server fills contract_version/coverage/category/
//    evidence_state; a turn that smuggles any of them is rejected v3_model_output_shape_mismatch.
// ---------------------------------------------------------------------------
{
  const ctx = buildV3ValidationContext();

  // Happy path: the strengthened contract still accepts a valid model turn, and the SERVER supplies
  // every server-owned key (proving they are possible — only from the server, never the model).
  const accepted = validateAgt002PreviewModelOutputV3({ integral_analysis: buildMinimalV3IntegralAnalysis() }, ctx);
  assert.equal(accepted.contract_version, AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION);
  assert.ok(accepted.coverage && typeof accepted.coverage === 'object');
  assert.equal(accepted.analysis_units[0].category, 'discard');
  assert.deepEqual(accepted.analysis_units[0].evidence_state, AGT002_EVIDENCE_STATE_SAFE_UNKNOWN);

  // A model turn that adds contract_version or coverage inside integral_analysis — even carrying the
  // exact CORRECT governed value — is rejected. Well-formed forgery is still forgery.
  const correctCoverage = accepted.coverage;
  const smuggledValueByKey = {
    contract_version: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    coverage: correctCoverage,
  };
  for (const key of SERVER_OWNED_INTEGRAL_KEYS) {
    const integralAnalysis = { ...buildMinimalV3IntegralAnalysis(), [key]: smuggledValueByKey[key] };
    assert.throws(
      () => validateAgt002PreviewModelOutputV3({ integral_analysis: integralAnalysis }, ctx),
      (error) => {
        assert.equal(error.code, 'v3_model_output_shape_mismatch', `smuggled integral_analysis.${key} must be rejected with v3_model_output_shape_mismatch`);
        return true;
      },
      `integral_analysis.${key} must be impossible from the model turn`,
    );
  }

  // A tender_requirement unit that writes its own governed category or evidence_state (instead of
  // null) is rejected the same way — the server owns both per requirement.
  {
    const withCategory = buildMinimalV3IntegralAnalysis();
    withCategory.analysis_units[0].category = 'discard';
    assert.throws(
      () => validateAgt002PreviewModelOutputV3({ integral_analysis: withCategory }, ctx),
      (error) => { assert.equal(error.code, 'v3_model_output_shape_mismatch'); return true; },
      'a tender_requirement unit must not write a governed category',
    );
  }
  {
    const withEvidenceState = buildMinimalV3IntegralAnalysis();
    withEvidenceState.analysis_units[0].evidence_state = AGT002_EVIDENCE_STATE_SAFE_UNKNOWN;
    assert.throws(
      () => validateAgt002PreviewModelOutputV3({ integral_analysis: withEvidenceState }, ctx),
      (error) => { assert.equal(error.code, 'v3_model_output_shape_mismatch'); return true; },
      'a tender_requirement unit must not write a governed evidence_state',
    );
  }
}

console.log('agt002-v3-policy-schema-agreement.test.mjs OK');
