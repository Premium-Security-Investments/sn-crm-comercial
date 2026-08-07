import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from '../../agt002-integral-analysis-v3.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../../agt002-company-evidence-classes.js';

// Fully synthetic AGT-002 integral v3 case (Task 9 of the implementation plan): one
// requirement per formal category plus a strategic consideration, exercising every
// required scenario from the plan's Step 1 — a discard cause, a habilitating item with
// unknown applicability (forcing abstention), a technical partial, a financial/execution
// gap, a strategic consideration, an expired-adjacent legal citation requiring human
// review, and a material missing evidence item. Nothing here represents a real
// expediente or real legal/company data.

export function buildAgt002V3SyntheticValidationContext() {
  return {
    requirementManifestVersion: 'agt002-deep-analysis-v1',
    requirementManifest: [
      { requirement_id: 'REQ-DISCARD', category: 'discard' },
      { requirement_id: 'REQ-HAB', category: 'habilitating' },
      { requirement_id: 'REQ-TECH', category: 'technical' },
      { requirement_id: 'REQ-FIN', category: 'financial_execution' },
    ],
    companyEvidenceManifestVersion: 'agt002-company-evidence-classes-v1',
    companyEvidenceClassIds: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
    legalCorpusVersionId: null,
    allowlist: {
      tender_document: ['TD-DISCARD', 'TD-HAB', 'TD-TECH', 'TD-FIN'],
      company_evidence: ['rup'],
      legal_corpus: [],
      human_evidence: ['HE-STRAT'],
      objective_validation: [],
    },
    materialOmissionsObserved: false,
    // Governed evidence-state map (agt002-evidence-state-manifest.js's contract): the
    // ONLY source of truth for each tender_requirement unit's evidence_state below, one
    // entry per requirement_id, hand-authored here exactly like requirementManifest and
    // allowlist already are. This is NOT what a real run assembles: the real
    // buildAgt002EvidenceStateManifest() always writes evidence_state.compliance as
    // "unknown" — there is no write path yet for a governed compliance determination
    // (see that module's header comment) — so a real run can only ever abstain
    // (conclusion "human_validation_required"/"insufficient_evidence", never a material
    // status). The material compliance values below (e.g.
    // "supported_pending_human_review") are purely hypothetical, chosen only to exercise
    // this validator's structural and cross-axis invariants end to end; they are
    // unreachable through the actually wired engine today (see the real
    // engine→same-version-adapter→persistence regression in
    // tests/agt002-preview-engine.test.mjs for the abstention-only path).
    evidenceStateManifest: [
      {
        requirement_id: 'REQ-DISCARD',
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
        rule_id: 'synthetic_fixture', provenance: null,
      },
      {
        requirement_id: 'REQ-HAB',
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'unknown', compliance: 'unknown' },
        rule_id: 'synthetic_fixture', provenance: null,
      },
      {
        requirement_id: 'REQ-TECH',
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'unknown', applicability: 'applicable', compliance: 'partially_supported_pending_human_review' },
        rule_id: 'synthetic_fixture', provenance: null,
      },
      {
        requirement_id: 'REQ-FIN',
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
        rule_id: 'synthetic_fixture', provenance: null,
      },
    ],
  };
}

export function buildAgt002V3SyntheticIntegralAnalysis() {
  return {
    contract_version: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    coverage: {
      manifest_version: 'agt002-deep-analysis-v1',
      expected_requirement_ids: ['REQ-DISCARD', 'REQ-HAB', 'REQ-TECH', 'REQ-FIN'],
      analyzed_requirement_ids: ['REQ-DISCARD', 'REQ-HAB', 'REQ-TECH', 'REQ-FIN'],
      material_omissions: false,
      omission_reasons: [],
      company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
      company_evidence_class_ids: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
      legal_corpus_version_id: null,
    },
    analysis_units: [
      // 1. Discard: no disqualifying cause evidenced.
      {
        unit_id: 'UNIT-DISCARD', unit_kind: 'tender_requirement', requirement_id: 'REQ-DISCARD', category: 'discard', sequence: 1,
        title: 'Verificación de causal de descarte', assessment_mode: 'assessed',
        conclusion: { status: 'supported_with_evidence', summary: 'Sin causal de rechazo evidenciada.', confidence: 'high' },
        blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto bloqueante evidenciado.' },
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
        evidence_refs: [{ ref: 'TD-DISCARD', source_type: 'tender_document', purpose: 'requirement_basis' }],
        missing_evidence: [], commercial_impact: { level: 'low', summary: 'Sin impacto comercial adverso.', dimension: 'eligibility' },
        legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
        actions: [], milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
        closure: { status: 'human_confirmation_required', condition: 'Persona confirma ausencia de causal.', evidence_required: ['tender_document'] },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar ausencia de causal de descarte.' },
      },
      // 2. Habilitating: presence known but applicability unknown -> must abstain
      // (compliance stays unknown, conclusion is human_validation_required — never a
      // favorable claim while applicability is unknown).
      {
        unit_id: 'UNIT-HAB', unit_kind: 'tender_requirement', requirement_id: 'REQ-HAB', category: 'habilitating', sequence: 2,
        title: 'Licencia habilitante con aplicabilidad incierta', assessment_mode: 'assessed',
        conclusion: { status: 'human_validation_required', summary: 'Aplicabilidad territorial no verificable con la evidencia disponible.', confidence: 'medium' },
        blocking: { effect: 'conditional', curability: 'undetermined', reason: 'Depende de validar aplicabilidad.' },
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'unknown', compliance: 'unknown' },
        evidence_refs: [{ ref: 'TD-HAB', source_type: 'tender_document', purpose: 'requirement_basis' }],
        missing_evidence: [], commercial_impact: { level: 'medium', summary: 'Riesgo de elegibilidad si no aplica.', dimension: 'eligibility' },
        legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
        actions: [{
          action_id: 'ACT-HAB', action_type: 'validate_applicability', summary: 'Validar aplicabilidad territorial de la licencia.',
          basis_unit_id: 'UNIT-HAB', suggested_role: 'legal', priority: 'medium', external_side_effect: false,
        }],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica definida.' },
        closure: { status: 'open', condition: 'Aplicabilidad territorial validada.', evidence_required: ['tender_document'] },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar aplicabilidad territorial.' },
      },
      // 3. Technical: partially supported, with a material missing evidence item
      // (critical), and legal_assessment not_verified requiring human review.
      {
        unit_id: 'UNIT-TECH', unit_kind: 'tender_requirement', requirement_id: 'REQ-TECH', category: 'technical', sequence: 3,
        title: 'Requisito técnico con faltante crítico', assessment_mode: 'assessed',
        conclusion: { status: 'partially_supported', summary: 'Falta constancia de vigencia técnica.', confidence: 'medium' },
        blocking: { effect: 'conditional', curability: 'curable', reason: 'Requiere subsanar constancia faltante.' },
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'unknown', applicability: 'applicable', compliance: 'partially_supported_pending_human_review' },
        evidence_refs: [{ ref: 'TD-TECH', source_type: 'tender_document', purpose: 'requirement_basis' }],
        missing_evidence: [{
          missing_id: 'MISS-TECH', evidence_class_id: null, needed_source_type: 'tender_document',
          reason: 'Falta constancia de vigencia del documento técnico.', critical: true,
        }],
        commercial_impact: { level: 'high', summary: 'Riesgo de competitividad.', dimension: 'competitiveness' },
        legal_assessment: { status: 'not_verified', basis_refs: [], summary: 'Fundamento jurídico del requisito no verificado.', human_legal_review_required: true },
        actions: [{
          action_id: 'ACT-TECH', action_type: 'obtain_evidence', summary: 'Solicitar constancia de vigencia del documento técnico.',
          basis_unit_id: 'UNIT-TECH', suggested_role: 'technical', priority: 'high', external_side_effect: false,
        }],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
        escalation: { required: true, level: 'role_review', reason: 'Incertidumbre jurídica no verificada.' },
        closure: { status: 'open', condition: 'Constancia de vigencia presentada y revisada.', evidence_required: ['tender_document'] },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar vigencia del documento técnico.' },
      },
      // 4. Financial/execution: gap evidenced, non-curable blocker (supported by tender
      // document evidence), forcing recommendation=do_not_advance downstream.
      {
        unit_id: 'UNIT-FIN', unit_kind: 'tender_requirement', requirement_id: 'REQ-FIN', category: 'financial_execution', sequence: 4,
        title: 'Brecha financiera no subsanable', assessment_mode: 'assessed',
        conclusion: { status: 'gap_evidenced', summary: 'Brecha financiera evidenciada frente al requisito del pliego.', confidence: 'high' },
        blocking: { effect: 'blocker', curability: 'not_curable', reason: 'Brecha financiera estructural evidenciada en el pliego.' },
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
        evidence_refs: [{ ref: 'TD-FIN', source_type: 'tender_document', purpose: 'gap_basis' }],
        missing_evidence: [], commercial_impact: { level: 'critical', summary: 'Brecha financiera afecta la capacidad de ejecución.', dimension: 'financial_exposure' },
        legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico.', human_legal_review_required: false },
        actions: [{
          action_id: 'ACT-FIN', action_type: 'human_decision', summary: 'Persona autorizada decide continuidad ante brecha financiera no subsanable.',
          basis_unit_id: 'UNIT-FIN', suggested_role: 'authorized_human', priority: 'critical', external_side_effect: false,
        }],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
        escalation: { required: true, level: 'management', reason: 'Bloqueo no subsanable con exposición crítica.' },
        closure: { status: 'human_confirmation_required', condition: 'Persona autorizada confirma decisión final.', evidence_required: ['tender_document'] },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar decisión final sobre la brecha financiera.' },
      },
      // 5. Strategic consideration (optional, design section 8): never a blocker by
      // itself, always pending human validation.
      {
        unit_id: 'UNIT-STRAT', unit_kind: 'strategic_consideration', requirement_id: null, category: 'strategic', sequence: 5,
        title: 'Consideración estratégica sintética', assessment_mode: 'assessed',
        conclusion: { status: 'human_validation_required', summary: 'Oportunidad de posicionamiento sujeta a validación humana.', confidence: 'medium' },
        blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto bloqueante por sí misma.' },
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'not_applicable', applicability: 'applicable', compliance: 'unknown' },
        evidence_refs: [{ ref: 'HE-STRAT', source_type: 'human_evidence', purpose: 'commercial_context' }],
        missing_evidence: [], commercial_impact: { level: 'medium', summary: 'Mejora la posición competitiva relativa.', dimension: 'strategic_fit' },
        legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
        actions: [], milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
        closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida el encaje estratégico.', evidence_required: ['human_evidence'] },
        human_validation: { required: true, status: 'pending', reason: 'Validar relevancia estratégica.' },
      },
    ],
  };
}
