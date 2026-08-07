import { strict as assert } from 'node:assert';
import {
  AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
  validateAgt002IntegralAnalysisV3,
} from '../agt002-integral-analysis-v3.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN } from '../agt002-evidence-state-manifest.js';

// ---------------------------------------------------------------------------
// Synthetic fixture: one requirement per formal category (discard, habilitating,
// technical, financial_execution) plus one strategic consideration. Every value
// below is synthetic test data; nothing here represents a real expediente.
// ---------------------------------------------------------------------------

function buildValidationContext() {
  return {
    requirementManifestVersion: 'agt002-deep-analysis-v1',
    requirementManifest: [
      { requirement_id: 'REQ-DISCARD-1', category: 'discard' },
      { requirement_id: 'REQ-HAB-1', category: 'habilitating' },
      { requirement_id: 'REQ-TECH-1', category: 'technical' },
      { requirement_id: 'REQ-FIN-1', category: 'financial_execution' },
    ],
    companyEvidenceManifestVersion: 'agt002-company-evidence-classes-v1',
    companyEvidenceClassIds: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
    legalCorpusVersionId: 'legal-corpus-v1',
    allowlist: {
      tender_document: ['TD-DISCARD-1', 'TD-HAB-1', 'TD-TECH-1', 'TD-FIN-1'],
      company_evidence: ['rup', 'rut'],
      legal_corpus: ['LC-1'],
      human_evidence: ['HE-1'],
      objective_validation: ['OV-1'],
    },
    materialOmissionsObserved: false,
    // Governed evidence-state map: the ONLY source of truth for evidence_state per
    // requirement_id. In real runs this is assembled by
    // buildAgt002EvidenceStateManifest() (agt002-evidence-state-manifest.js) from
    // governed company-evidence-class data; here it is hand-authored to match the
    // fixture units below, exactly like requirementManifest/allowlist already are —
    // this is still the governed side of the contract, never something the model
    // supplies or that this validator derives from the payload itself.
    evidenceStateManifest: [
      {
        requirement_id: 'REQ-DISCARD-1',
        evidence_state: {
          presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable',
          compliance: 'supported_pending_human_review',
        },
        rule_id: 'synthetic_test_fixture',
        provenance: null,
      },
      {
        requirement_id: 'REQ-HAB-1',
        evidence_state: {
          presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable',
          compliance: 'supported_pending_human_review',
        },
        rule_id: 'synthetic_test_fixture',
        provenance: null,
      },
      {
        requirement_id: 'REQ-TECH-1',
        evidence_state: {
          presence: 'present', review: 'reviewed', validity: 'unknown', applicability: 'applicable',
          compliance: 'partially_supported_pending_human_review',
        },
        rule_id: 'synthetic_test_fixture',
        provenance: null,
      },
      {
        requirement_id: 'REQ-FIN-1',
        evidence_state: {
          presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable',
          compliance: 'gap_evidenced_pending_human_review',
        },
        rule_id: 'synthetic_test_fixture',
        provenance: null,
      },
    ],
  };
}

function buildValidIntegralAnalysis() {
  return {
    contract_version: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    coverage: {
      manifest_version: 'agt002-deep-analysis-v1',
      expected_requirement_ids: ['REQ-DISCARD-1', 'REQ-HAB-1', 'REQ-TECH-1', 'REQ-FIN-1'],
      analyzed_requirement_ids: ['REQ-DISCARD-1', 'REQ-HAB-1', 'REQ-TECH-1', 'REQ-FIN-1'],
      material_omissions: false,
      omission_reasons: [],
      company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
      company_evidence_class_ids: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
      legal_corpus_version_id: 'legal-corpus-v1',
    },
    analysis_units: [
      {
        unit_id: 'UNIT-REQ-DISCARD-1',
        unit_kind: 'tender_requirement',
        requirement_id: 'REQ-DISCARD-1',
        category: 'discard',
        sequence: 1,
        title: 'Verificación de causal de descarte',
        assessment_mode: 'assessed',
        conclusion: {
          status: 'supported_with_evidence',
          summary: 'Sin causal de rechazo evidenciada en el pliego revisado.',
          confidence: 'high',
        },
        blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto bloqueante evidenciado.' },
        evidence_state: {
          presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable',
          compliance: 'supported_pending_human_review',
        },
        evidence_refs: [{ ref: 'TD-DISCARD-1', source_type: 'tender_document', purpose: 'requirement_basis' }],
        missing_evidence: [],
        commercial_impact: { level: 'low', summary: 'Sin impacto comercial adverso evidenciado.', dimension: 'eligibility' },
        legal_assessment: {
          status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico para esta causal.',
          human_legal_review_required: false,
        },
        actions: [],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
        closure: {
          status: 'human_confirmation_required',
          condition: 'Persona autorizada confirma ausencia de causal de rechazo.',
          evidence_required: ['tender_document'],
        },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar ausencia de causal de descarte.' },
      },
      {
        unit_id: 'UNIT-REQ-HAB-1',
        unit_kind: 'tender_requirement',
        requirement_id: 'REQ-HAB-1',
        category: 'habilitating',
        sequence: 2,
        title: 'Licencia habilitante',
        assessment_mode: 'assessed',
        conclusion: {
          status: 'supported_with_evidence',
          summary: 'Evidencia vigente sustenta el requisito habilitante.',
          confidence: 'medium',
        },
        blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Requisito habilitante sustentado.' },
        evidence_state: {
          presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable',
          compliance: 'supported_pending_human_review',
        },
        evidence_refs: [
          { ref: 'TD-HAB-1', source_type: 'tender_document', purpose: 'requirement_basis' },
          { ref: 'rup', source_type: 'company_evidence', purpose: 'company_capacity' },
        ],
        missing_evidence: [],
        commercial_impact: { level: 'medium', summary: 'Habilita la participación en el proceso.', dimension: 'eligibility' },
        legal_assessment: {
          status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico.',
          human_legal_review_required: false,
        },
        actions: [],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
        closure: {
          status: 'evidence_satisfied',
          condition: 'Evidencia vigente y revisada sustenta el requisito habilitante.',
          evidence_required: ['tender_document'],
        },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar habilitación definitiva.' },
      },
      {
        unit_id: 'UNIT-REQ-TECH-1',
        unit_kind: 'tender_requirement',
        requirement_id: 'REQ-TECH-1',
        category: 'technical',
        sequence: 3,
        title: 'Vigencia de documento técnico',
        assessment_mode: 'assessed',
        conclusion: {
          status: 'partially_supported',
          summary: 'Vigencia del documento técnico no verificable con la evidencia disponible.',
          confidence: 'medium',
        },
        blocking: { effect: 'conditional', curability: 'curable', reason: 'Requiere verificar vigencia del documento técnico.' },
        evidence_state: {
          presence: 'present', review: 'reviewed', validity: 'unknown', applicability: 'applicable',
          compliance: 'partially_supported_pending_human_review',
        },
        evidence_refs: [{ ref: 'TD-TECH-1', source_type: 'tender_document', purpose: 'requirement_basis' }],
        missing_evidence: [{
          missing_id: 'MISS-TECH-1', evidence_class_id: null, needed_source_type: 'tender_document',
          reason: 'Falta constancia de vigencia del documento técnico.', critical: false,
        }],
        commercial_impact: { level: 'medium', summary: 'Riesgo de competitividad si no se verifica la vigencia.', dimension: 'competitiveness' },
        legal_assessment: {
          status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico.',
          human_legal_review_required: false,
        },
        actions: [{
          action_id: 'ACT-TECH-1', action_type: 'verify_validity', summary: 'Verificar vigencia del documento técnico presentado.',
          basis_unit_id: 'UNIT-REQ-TECH-1', suggested_role: 'technical', priority: 'medium', external_side_effect: false,
        }],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
        closure: {
          status: 'open', condition: 'Verificación de vigencia documental completada.', evidence_required: ['tender_document'],
        },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar vigencia del documento técnico.' },
      },
      {
        unit_id: 'UNIT-REQ-FIN-1',
        unit_kind: 'tender_requirement',
        requirement_id: 'REQ-FIN-1',
        category: 'financial_execution',
        sequence: 4,
        title: 'Brecha financiera evidenciada',
        assessment_mode: 'assessed',
        conclusion: {
          status: 'gap_evidenced',
          summary: 'Brecha financiera evidenciada frente al requisito del pliego.',
          confidence: 'high',
        },
        blocking: { effect: 'blocker', curability: 'curable', reason: 'Brecha financiera evidenciada en el pliego.' },
        evidence_state: {
          presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable',
          compliance: 'gap_evidenced_pending_human_review',
        },
        evidence_refs: [{ ref: 'TD-FIN-1', source_type: 'tender_document', purpose: 'gap_basis' }],
        missing_evidence: [],
        commercial_impact: { level: 'high', summary: 'Brecha financiera afecta la capacidad de ejecución.', dimension: 'financial_exposure' },
        legal_assessment: {
          status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico.',
          human_legal_review_required: false,
        },
        actions: [{
          action_id: 'ACT-FIN-1', action_type: 'remediate_gap', summary: 'Subsanar brecha financiera evidenciada antes del cierre.',
          basis_unit_id: 'UNIT-REQ-FIN-1', suggested_role: 'financial', priority: 'high', external_side_effect: false,
        }],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
        closure: {
          status: 'open', condition: 'Evidencia de subsanación de la brecha financiera presentada y revisada.',
          evidence_required: ['tender_document'],
        },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar subsanación de la brecha financiera.' },
      },
      {
        unit_id: 'UNIT-STRAT-1',
        unit_kind: 'strategic_consideration',
        requirement_id: null,
        category: 'strategic',
        sequence: 5,
        title: 'Consideración estratégica sintética',
        assessment_mode: 'assessed',
        conclusion: {
          status: 'human_validation_required',
          summary: 'Oportunidad de posicionamiento competitivo sujeta a validación humana.',
          confidence: 'medium',
        },
        blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Consideración estratégica sin efecto bloqueante por sí misma.' },
        evidence_state: {
          presence: 'present', review: 'reviewed', validity: 'not_applicable', applicability: 'applicable', compliance: 'unknown',
        },
        evidence_refs: [{ ref: 'HE-1', source_type: 'human_evidence', purpose: 'commercial_context' }],
        missing_evidence: [],
        commercial_impact: { level: 'medium', summary: 'Mejora la posición competitiva relativa de la propuesta.', dimension: 'strategic_fit' },
        legal_assessment: {
          status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico para esta consideración.',
          human_legal_review_required: false,
        },
        actions: [],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
        closure: {
          status: 'human_confirmation_required', condition: 'Persona autorizada valida el encaje estratégico.',
          evidence_required: ['human_evidence'],
        },
        human_validation: { required: true, status: 'pending', reason: 'Validar relevancia estratégica.' },
      },
    ],
  };
}

function buildFixture() {
  return { integralAnalysis: buildValidIntegralAnalysis(), validationContext: buildValidationContext() };
}

function expectRejects(mutate, pattern) {
  const { integralAnalysis, validationContext } = buildFixture();
  const mutated = mutate(integralAnalysis) || integralAnalysis;
  assert.throws(() => validateAgt002IntegralAnalysisV3(mutated, validationContext), pattern);
}

function run() {
  // ---------------------------------------------------------------------
  // Task 2 — Step 1: minimal valid fixture
  // ---------------------------------------------------------------------
  {
    const { integralAnalysis, validationContext } = buildFixture();
    const result = validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext);
    assert.equal(result, integralAnalysis, 'debe devolver el mismo objeto validado, sin normalizar');
    assert.equal(result.contract_version, 'agt002-integral-analysis-v3');
    assert.equal(result.analysis_units.length, 5);
  }

  // ---------------------------------------------------------------------
  // Task 2 — Step 2: closed shape and ordering
  // ---------------------------------------------------------------------

  // Unknown key at top level.
  expectRejects((ia) => { ia.extra_top_level_key = 'x'; }, /clave|key/i);

  // Unknown key inside coverage.
  expectRejects((ia) => { ia.coverage.extra = 'x'; }, /clave|key/i);

  // coverage.analyzed_requirement_ids must equal expected_requirement_ids exactly, in
  // order — not merely be a duplicate-free subset of the governed manifest (a partial or
  // reordered list must never pass as full coverage).
  expectRejects((ia) => { ia.coverage.analyzed_requirement_ids = ia.coverage.analyzed_requirement_ids.slice(0, -1); }, /analyzed_requirement_ids/i);
  expectRejects((ia) => {
    const [first, second, ...rest] = ia.coverage.analyzed_requirement_ids;
    ia.coverage.analyzed_requirement_ids = [second, first, ...rest];
  }, /analyzed_requirement_ids/i);

  // Unknown key inside a nested unit object (evidence_state).
  expectRejects((ia) => { ia.analysis_units[0].evidence_state.extra = 'x'; }, /clave|key/i);

  // Unknown key inside an array item (evidence_refs entry).
  expectRejects((ia) => { ia.analysis_units[0].evidence_refs[0].extra = 'x'; }, /clave|key/i);

  // Unknown enum value.
  expectRejects((ia) => { ia.analysis_units[0].category = 'bogus_category'; }, /categor/i);
  expectRejects((ia) => { ia.analysis_units[0].conclusion.status = 'bogus_status'; }, /estado|status/i);
  expectRejects((ia) => { ia.analysis_units[0].evidence_refs[0].source_type = 'bogus_source'; }, /source_type|fuente/i);

  // Duplicate unit_id.
  expectRejects((ia) => { ia.analysis_units[1].unit_id = ia.analysis_units[0].unit_id; }, /unit_id/i);

  // Duplicate requirement_id (category adjusted so the per-unit manifest-category check
  // passes and the duplicate is caught by ordering/coverage validation instead).
  expectRejects((ia) => {
    ia.analysis_units[1].requirement_id = 'REQ-DISCARD-1';
    ia.analysis_units[1].category = 'discard';
  }, /requirement_id/i);

  // Duplicate evidence ref (ref, purpose) within the same unit.
  expectRejects((ia) => {
    ia.analysis_units[0].evidence_refs.push({ ...ia.analysis_units[0].evidence_refs[0] });
  }, /evidence_refs|referencia/i);

  // Duplicate missing_id within the same unit.
  expectRejects((ia) => {
    ia.analysis_units[2].missing_evidence.push({ ...ia.analysis_units[2].missing_evidence[0] });
  }, /missing_id|faltante/i);

  // Non-increasing sequence.
  expectRejects((ia) => { ia.analysis_units[1].sequence = 1; }, /sequence|secuencia/i);
  expectRejects((ia) => { ia.analysis_units[2].sequence = ia.analysis_units[1].sequence; }, /sequence|secuencia/i);

  // Category order violation (technical unit placed before habilitating).
  expectRejects((ia) => {
    ia.analysis_units[1].category = 'technical';
    ia.analysis_units[2].category = 'habilitating';
  }, /categor/i);

  // Strategic consideration with a non-null requirement_id.
  expectRejects((ia) => { ia.analysis_units[4].requirement_id = 'REQ-DISCARD-1'; }, /requirement_id/i);

  // Formal requirement without an allowlisted requirement_id.
  expectRejects((ia) => { ia.analysis_units[0].requirement_id = 'REQ-NOT-IN-MANIFEST'; }, /requirement_id|manifiesto/i);

  // Formal requirement categorized strategic.
  expectRejects((ia) => { ia.analysis_units[0].category = 'strategic'; }, /categor/i);

  // Any unit missing commercial_impact.
  expectRejects((ia) => { delete ia.analysis_units[0].commercial_impact; }, /commercial_impact|clave/i);

  // Any unit missing legal_assessment.
  expectRejects((ia) => { delete ia.analysis_units[0].legal_assessment; }, /legal_assessment|clave/i);

  // Abstained unit still requires commercial_impact and legal_assessment (shape, not omission).
  expectRejects((ia) => {
    ia.analysis_units[2].assessment_mode = 'abstained';
    ia.analysis_units[2].conclusion.status = 'insufficient_evidence';
    ia.analysis_units[2].conclusion.confidence = 'unavailable';
    delete ia.analysis_units[2].commercial_impact;
  }, /commercial_impact|clave/i);

  // ---------------------------------------------------------------------
  // Task 3 — Step 1: evidence or abstention
  // ---------------------------------------------------------------------

  // Material compliance without an allowlisted relevant citation.
  expectRejects((ia) => { ia.analysis_units[0].evidence_refs = []; }, /evidence_refs|cita|evidencia/i);

  // Source type / purpose mismatch (legal_basis must cite legal_corpus).
  expectRejects((ia) => {
    ia.analysis_units[0].evidence_refs[0] = { ref: 'TD-DISCARD-1', source_type: 'tender_document', purpose: 'legal_basis' };
  }, /purpose|source_type|fuente/i);

  // insufficient_evidence without abstention and a missing-evidence item.
  expectRejects((ia) => {
    ia.analysis_units[2].conclusion.status = 'insufficient_evidence';
  }, /insufficient_evidence|abstained|abstenci/i);
  expectRejects((ia) => {
    ia.analysis_units[2].conclusion.status = 'insufficient_evidence';
    ia.analysis_units[2].assessment_mode = 'abstained';
    ia.analysis_units[2].conclusion.confidence = 'unavailable';
    ia.analysis_units[2].missing_evidence = [];
  }, /missing_evidence|faltante/i);

  // Abstention with high confidence.
  expectRejects((ia) => {
    ia.analysis_units[2].assessment_mode = 'abstained';
    ia.analysis_units[2].conclusion.status = 'insufficient_evidence';
    ia.analysis_units[2].conclusion.confidence = 'high';
  }, /confidence|abstained|abstenci/i);

  // False complete coverage when input reports material omissions.
  {
    const { integralAnalysis, validationContext } = buildFixture();
    validationContext.materialOmissionsObserved = true;
    assert.throws(
      () => validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext),
      /material_omissions|omisi/i,
    );
  }

  // Assessed unit whose required evidence was materially omitted (all units must abstain).
  {
    const { integralAnalysis, validationContext } = buildFixture();
    validationContext.materialOmissionsObserved = true;
    integralAnalysis.coverage.material_omissions = true;
    integralAnalysis.coverage.omission_reasons = ['Retrieval budget exhausted before completing review.'];
    assert.throws(
      () => validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext),
      /abstained|abstenci/i,
    );
  }

  // ---------------------------------------------------------------------
  // Task 3 — Step 2: independent axes
  // ---------------------------------------------------------------------

  // Reviewed evidence when absent.
  expectRejects((ia) => {
    ia.analysis_units[0].evidence_state.presence = 'absent';
    ia.analysis_units[0].evidence_state.review = 'reviewed';
  }, /presence|review|revisi/i);

  // Valid/expired evidence when absent.
  expectRejects((ia) => {
    ia.analysis_units[0].evidence_state.presence = 'absent';
    ia.analysis_units[0].evidence_state.validity = 'valid';
  }, /presence|validity|vigenc/i);

  // Compliance when not reviewed.
  expectRejects((ia) => {
    ia.analysis_units[0].evidence_state.review = 'not_reviewed';
  }, /review|revisi|compliance|cumplim/i);

  // Material compliance with expired validity.
  expectRejects((ia) => {
    ia.analysis_units[0].evidence_state.validity = 'expired';
  }, /validity|vigenc/i);

  // Material compliance with unknown applicability.
  expectRejects((ia) => {
    ia.analysis_units[0].evidence_state.applicability = 'unknown';
  }, /applicability|aplicabilidad/i);

  // Presence alone never mutates the other independent axes: two otherwise-identical
  // valid units differing only in presence-compatible state both validate independently.
  {
    const { integralAnalysis, validationContext } = buildFixture();
    const before = JSON.parse(JSON.stringify(integralAnalysis));
    validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext);
    assert.deepEqual(integralAnalysis, before, 'la validación no debe mutar el payload');
  }

  // ---------------------------------------------------------------------
  // Governed origin of the five axes (audit P0 "cumplimiento inferido por presencia"):
  // evidence_state is never free model output. It must equal, per requirement_id, the
  // governed map supplied via validationContext.evidenceStateManifest — never something
  // the payload asserts on its own, even when the asserted value is itself individually
  // well-formed (closed enum, cross-axis-invariant-consistent).
  // ---------------------------------------------------------------------

  // validationContext without a governed evidence-state map is rejected outright — the
  // engine must fail closed rather than let evidence_state through unchecked.
  {
    const { integralAnalysis, validationContext } = buildFixture();
    delete validationContext.evidenceStateManifest;
    assert.throws(
      () => validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext),
      /evidenceStateManifest/,
    );
  }

  // A governed map that does not cover every requirement_id in the manifest 1:1 (missing
  // an entry, or carrying one outside the manifest) is rejected — partial governance is
  // not governance.
  {
    const { integralAnalysis, validationContext } = buildFixture();
    validationContext.evidenceStateManifest = validationContext.evidenceStateManifest.slice(1);
    assert.throws(
      () => validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext),
      /evidenceStateManifest/,
    );
  }
  {
    const { integralAnalysis, validationContext } = buildFixture();
    validationContext.evidenceStateManifest.push({
      requirement_id: 'REQ-NOT-IN-MANIFEST', evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN, rule_id: 'x', provenance: null,
    });
    assert.throws(
      () => validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext),
      /evidenceStateManifest/,
    );
  }

  // A model-asserted evidence_state that is individually well-formed (passes every enum
  // and cross-axis-invariant check on its own) but does NOT match the governed map for
  // its requirement_id must still be rejected: review "partially_reviewed" instead of the
  // governed "reviewed" violates no existing invariant, yet must be rejected because it
  // does not come from governed state.
  expectRejects((ia) => {
    ia.analysis_units[0].evidence_state.review = 'partially_reviewed';
  }, /mapa gobernado|governed/i);

  // Same for a mismatched presence that is still internally consistent (e.g. claiming
  // "unknown" instead of the governed "present"). conclusion.status is switched to
  // "human_validation_required" (confidence "medium", evidence_refs kept non-empty) so
  // the fully-"unknown" evidence_state stays individually well-formed under the P0
  // material<->compliance correspondence invariant too — isolating the governed-map
  // mismatch this test targets, rather than that unrelated invariant.
  expectRejects((ia) => {
    ia.analysis_units[0].conclusion.status = 'human_validation_required';
    ia.analysis_units[0].conclusion.confidence = 'medium';
    ia.analysis_units[0].evidence_state.presence = 'unknown';
    ia.analysis_units[0].evidence_state.review = 'not_reviewed';
    ia.analysis_units[0].evidence_state.validity = 'unknown';
    ia.analysis_units[0].evidence_state.applicability = 'unknown';
    ia.analysis_units[0].evidence_state.compliance = 'unknown';
  }, /mapa gobernado|governed/i);

  // Absence of governed signal produces exactly the safe-unknown state — never partially
  // mutated, and no other axis is inferred from presence. A requirement with no governed
  // entry override (the builder's default) must have its unit emit precisely
  // AGT002_EVIDENCE_STATE_SAFE_UNKNOWN to validate; anything else is rejected. Since
  // compliance is "unknown" in the safe-unknown state, conclusion.status must be
  // downgraded from "supported_with_evidence" to "human_validation_required" (P0: a
  // material conclusion can never coexist with compliance "unknown") — evidence_refs and
  // confidence stay coherent with that (P1: at least one reference, no "high" confidence).
  {
    const { integralAnalysis, validationContext } = buildFixture();
    validationContext.evidenceStateManifest = validationContext.evidenceStateManifest.map(entry => (
      entry.requirement_id === 'REQ-DISCARD-1'
        ? { requirement_id: entry.requirement_id, evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN, rule_id: 'no_governed_evidence_class_link', provenance: null }
        : entry
    ));
    integralAnalysis.analysis_units[0].evidence_state = { ...AGT002_EVIDENCE_STATE_SAFE_UNKNOWN };
    integralAnalysis.analysis_units[0].conclusion.status = 'human_validation_required';
    integralAnalysis.analysis_units[0].conclusion.confidence = 'medium';
    // Every other axis on every other unit is untouched by this change (proving presence
    // on unit 0 never leaks into unit 1's own governed evidence_state).
    const result = validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext);
    assert.deepEqual(result.analysis_units[0].evidence_state, AGT002_EVIDENCE_STATE_SAFE_UNKNOWN);
    assert.deepEqual(result.analysis_units[1].evidence_state, {
      presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review',
    });
  }

  // A strategic_consideration unit (requirement_id null) has no governed per-requirement
  // entry to match against — it is not covered by this governance layer and keeps only
  // the pre-existing closed-enum/cross-axis-invariant checks, so a well-formed but
  // ungoverned evidence_state there still passes.
  {
    const { integralAnalysis, validationContext } = buildFixture();
    const strategicUnit = integralAnalysis.analysis_units.find(unit => unit.unit_kind === 'strategic_consideration');
    strategicUnit.evidence_state = { presence: 'absent', review: 'not_reviewed', validity: 'unknown', applicability: 'unknown', compliance: 'unknown' };
    const result = validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext);
    assert.equal(result.analysis_units.find(unit => unit.unit_kind === 'strategic_consideration').evidence_state.presence, 'absent');
  }

  // ---------------------------------------------------------------------
  // Task 3 — Step 3: legal/operational controls
  // ---------------------------------------------------------------------

  // Non-curable blocker without tender/legal support (gap_basis kept via human_evidence
  // so only the curability/support invariant is exercised, not the gap_basis-ref one).
  expectRejects((ia) => {
    ia.analysis_units[3].blocking.curability = 'not_curable';
    ia.analysis_units[3].evidence_refs = [{ ref: 'HE-1', source_type: 'human_evidence', purpose: 'gap_basis' }];
  }, /not_curable|subsanab|soporte/i);

  // Verified milestone without date/source.
  expectRejects((ia) => {
    ia.analysis_units[0].milestone = {
      status: 'verified', type: 'submission_deadline', at: null, source_ref: null, summary: 'Fecha límite.',
    };
  }, /milestone|hito|source_ref|fecha/i);

  // Missing escalation for a defined critical condition (critical commercial impact).
  expectRejects((ia) => {
    ia.analysis_units[3].commercial_impact.level = 'critical';
    ia.analysis_units[3].escalation = { required: false, level: 'none', reason: 'Sin escalamiento.' };
  }, /escalation|escalamiento/i);

  // escalation.required: false must pair with level: none.
  expectRejects((ia) => {
    ia.analysis_units[0].escalation = { required: false, level: 'committee', reason: 'x' };
  }, /escalation|escalamiento|level/i);

  // Human validation other than {required:true, status:"pending"}.
  expectRejects((ia) => { ia.analysis_units[0].human_validation.required = false; }, /human_validation/i);
  expectRejects((ia) => { ia.analysis_units[0].human_validation.status = 'confirmed'; }, /human_validation|status/i);

  // Definitive model-produced states are structurally impossible (closed enum).
  expectRejects((ia) => { ia.analysis_units[0].conclusion.status = 'compliant'; }, /status|estado/i);
  expectRejects((ia) => { ia.analysis_units[0].evidence_state.compliance = 'approved'; }, /compliance|cumplim/i);

  // ---------------------------------------------------------------------
  // P0 (independent review): a material conclusion (supported_with_evidence /
  // partially_supported / gap_evidenced) must correspond EXACTLY to a non-"unknown"
  // evidence_state.compliance — never "unknown", and never a mismatched
  // pending_human_review value. Both the governed context and the payload are mutated
  // together so the governed-map-match check (already covered above) is not what
  // trips these — only the new material<->compliance correspondence invariant is.
  // ---------------------------------------------------------------------

  // Material conclusion.status "supported_with_evidence" cannot coexist with
  // evidence_state.compliance "unknown".
  {
    const { integralAnalysis, validationContext } = buildFixture();
    const governed = validationContext.evidenceStateManifest.find(e => e.requirement_id === 'REQ-DISCARD-1');
    governed.evidence_state = { ...governed.evidence_state, compliance: 'unknown' };
    integralAnalysis.analysis_units[0].evidence_state = { ...integralAnalysis.analysis_units[0].evidence_state, compliance: 'unknown' };
    assert.throws(
      () => validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext),
      /compliance/i,
    );
  }

  // Material conclusion.status "supported_with_evidence" cannot pair with the WRONG
  // pending_human_review compliance value (must be exactly "supported_pending_human_review",
  // not e.g. "gap_evidenced_pending_human_review").
  {
    const { integralAnalysis, validationContext } = buildFixture();
    const governed = validationContext.evidenceStateManifest.find(e => e.requirement_id === 'REQ-DISCARD-1');
    governed.evidence_state = { ...governed.evidence_state, compliance: 'gap_evidenced_pending_human_review' };
    integralAnalysis.analysis_units[0].evidence_state = { ...integralAnalysis.analysis_units[0].evidence_state, compliance: 'gap_evidenced_pending_human_review' };
    assert.throws(
      () => validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext),
      /compliance/i,
    );
  }

  // Same correspondence for "partially_supported" -> "partially_supported_pending_human_review".
  {
    const { integralAnalysis, validationContext } = buildFixture();
    const governed = validationContext.evidenceStateManifest.find(e => e.requirement_id === 'REQ-TECH-1');
    governed.evidence_state = { ...governed.evidence_state, compliance: 'unknown' };
    integralAnalysis.analysis_units[2].evidence_state = { ...integralAnalysis.analysis_units[2].evidence_state, compliance: 'unknown' };
    assert.throws(
      () => validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext),
      /compliance/i,
    );
  }

  // Same correspondence for "gap_evidenced" -> "gap_evidenced_pending_human_review".
  {
    const { integralAnalysis, validationContext } = buildFixture();
    const governed = validationContext.evidenceStateManifest.find(e => e.requirement_id === 'REQ-FIN-1');
    governed.evidence_state = { ...governed.evidence_state, compliance: 'supported_pending_human_review' };
    integralAnalysis.analysis_units[3].evidence_state = { ...integralAnalysis.analysis_units[3].evidence_state, compliance: 'supported_pending_human_review' };
    assert.throws(
      () => validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext),
      /compliance/i,
    );
  }

  // ---------------------------------------------------------------------
  // P1 (independent review): conclusion.status "human_validation_required" can never
  // use confidence "high", and outside abstention it must carry at least one evidence
  // reference — it cannot float free of both evidence and abstention.
  // ---------------------------------------------------------------------

  // human_validation_required with confidence "high" is rejected regardless of
  // assessment_mode.
  expectRejects((ia) => {
    ia.analysis_units[4].conclusion.confidence = 'high';
  }, /human_validation_required|confidence/i);

  // human_validation_required in assessment_mode "assessed" without any evidence_refs
  // is rejected — sustento or explicit abstention, never neither.
  expectRejects((ia) => {
    ia.analysis_units[4].evidence_refs = [];
  }, /human_validation_required|evidenc|referencia/i);

  // Coherent counterpart: human_validation_required WITH abstention (no evidence,
  // confidence "unavailable") remains accepted — abstention is the honest escape hatch
  // when there is no evidence at all.
  {
    const { integralAnalysis, validationContext } = buildFixture();
    const unit = integralAnalysis.analysis_units[4];
    unit.assessment_mode = 'abstained';
    unit.conclusion.confidence = 'unavailable';
    unit.evidence_refs = [];
    const result = validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext);
    assert.equal(result.analysis_units[4].conclusion.status, 'human_validation_required');
  }

  // Action basis_unit_id must match its containing unit.
  expectRejects((ia) => { ia.analysis_units[2].actions[0].basis_unit_id = 'UNIT-REQ-FIN-1'; }, /basis_unit_id/i);

  // external_side_effect must always be false.
  expectRejects((ia) => { ia.analysis_units[2].actions[0].external_side_effect = true; }, /external_side_effect/i);

  // The AI action catalog has no autonomous decision or execution verbs. GO/NO-GO,
  // approval, signature, sending and submission remain outside this closed contract;
  // even a human_decision entry is only a pending, side-effect-free handoff.
  for (const prohibitedActionType of ['go', 'no_go', 'approve', 'sign', 'send', 'submit']) {
    expectRejects((ia) => {
      ia.analysis_units[2].actions[0].action_type = prohibitedActionType;
    }, /action_type|valor permitido/i);
  }
  {
    const { integralAnalysis, validationContext } = buildFixture();
    integralAnalysis.analysis_units[2].actions[0] = {
      ...integralAnalysis.analysis_units[2].actions[0],
      action_type: 'human_decision', suggested_role: 'authorized_human', external_side_effect: false,
    };
    const result = validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext);
    assert.equal(result.analysis_units[2].actions[0].external_side_effect, false);
    assert.equal(result.analysis_units[2].human_validation.status, 'pending');
  }

  // Raw evidence/excerpt content and prohibited sensitive keys are rejected.
  expectRejects((ia) => { ia.analysis_units[0].evidence_refs[0].excerpt = 'texto crudo del documento'; }, /clave|sensible|key/i);
  expectRejects((ia) => { ia.analysis_units[0].conclusion.person_name = 'Jane Doe'; }, /clave|sensible|key/i);

  // closure.status: evidence_satisfied requires allowlisted evidence. Uses the strategic
  // unit (non-material conclusion.status) so only the closure invariant is exercised.
  // assessment_mode is switched to "abstained" (confidence "unavailable") so the empty
  // evidence_refs stays coherent with the P1 human_validation_required rule (abstention
  // is the honest escape hatch for no evidence) and only the closure invariant fires.
  expectRejects((ia) => {
    ia.analysis_units[4].assessment_mode = 'abstained';
    ia.analysis_units[4].conclusion.confidence = 'unavailable';
    ia.analysis_units[4].closure.status = 'evidence_satisfied';
    ia.analysis_units[4].evidence_refs = [];
  }, /evidence_satisfied|closure|cierre/i);

  console.log('agt002-integral-analysis-v3 structural contract passed');
}

run();
