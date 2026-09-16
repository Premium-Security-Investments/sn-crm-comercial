// AGT-002 stakeholder-brief projector for Licitaciones, hardening/spec-alignment pass over
// the existing module `agt002-stakeholder-brief.js`.
//
// This file DEFINES the closed contract the projector must satisfy, including invariants
// the current implementation does not yet enforce (governed V3 lineage, general-fact
// objects instead of hallucinable scalars, and a handful of closed review gaps). No
// production file is modified alongside this test.
//
// Contract shape modeled after the two closest existing governed AGT-002 artifacts:
//   - agt002-integral-analysis-v3.js (closed key sets, allowlisted source refs, fail-closed
//     governed invariants, `external_side_effect` always false, bounded text/arrays,
//     `human_validation`-style gates) — this file additionally requires the stakeholder
//     brief to be an explicitly lineage-checked PROJECTION of governed V3 analysis units,
//     never a parallel free-standing envelope.
//   - agt002-governance-draft-proposal.js (build+validate pair, `human_approval_required`
//     literal true, DRAFT-only status, exhaustive coverage, no raw document text)
//
// The projector is PURE: given a model-shaped `input` and a governed `validationContext`
// (the opportunity's allowlisted source refs, requirement manifest and governed V3 unit
// lineage), it returns a closed, five-block stakeholder brief for a Licitación. It performs
// no I/O: no Radar write, no CRM write, no network call, no filesystem access — and nothing
// in its output can be mistaken for an executed action, since every action in the treatment
// plan is contractually pinned to `external_side_effect: false` and every human-approval
// gate is contractually pinned to `required: true` / `status: 'pending'`.
//
// Synthetic fixtures only: every id, entity name, amount and date below is fabricated for
// this test and does not correspond to any real licitación, empresa or persona.

import { strict as assert } from 'node:assert';
import {
  AGT002_STAKEHOLDER_BRIEF_CONTRACT_VERSION,
  AGT002_STAKEHOLDER_BRIEF_MODALITY,
  AGT002_STAKEHOLDER_BRIEF_TIMELINE_STATUSES,
  AGT002_STAKEHOLDER_BRIEF_MATCH_STATUSES,
  AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_CATEGORIES,
  AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_STATUSES,
  AGT002_STAKEHOLDER_BRIEF_VALIDITY_STATES,
  validateAgt002StakeholderBrief,
  buildAgt002StakeholderBrief,
} from '../agt002-stakeholder-brief.js';
import * as Agt002StakeholderBrief from '../agt002-stakeholder-brief.js';
// Real governed V3 constants — the stakeholder brief's lineage checks (Case 12) must be
// pinned to these, never to a parallel/duplicated enum of its own.
import {
  AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
  AGT002_INTEGRAL_CATEGORIES,
  AGT002_INTEGRAL_SOURCE_TYPES,
  AGT002_INTEGRAL_SUGGESTED_ROLES,
  AGT002_INTEGRAL_ACTION_PRIORITIES,
  AGT002_INTEGRAL_VALIDITY_STATES,
} from '../agt002-integral-analysis-v3.js';

// ---------------------------------------------------------------------------
// Synthetic fixture: one governed opportunity, one requirement per checklist category
// (legal, financial, technical, experience, scoring), a controlled timeline with all
// three statuses (documented/pending/conflicting), a questionnaire cross-check with one
// consistent and one contradictory entry, and a governed manifest of V3 analysis units
// each checklist requirement traces back to. Nothing here represents a real expediente.
// ---------------------------------------------------------------------------

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_OPPORTUNITY_ID = '22222222-2222-4222-8222-222222222222';

const V3_UNIT_LEGAL = 'V3-UNIT-LEGAL-1';
const V3_UNIT_FIN = 'V3-UNIT-FIN-1';
const V3_UNIT_TECH = 'V3-UNIT-TECH-1';
const V3_UNIT_EXP = 'V3-UNIT-EXP-1';
const V3_UNIT_SCORE = 'V3-UNIT-SCORE-1';

function ref(refId, sourceType) {
  return { ref: refId, source_type: sourceType };
}

// Governed fact-object helpers (requirement: "general facts without hallucination").
// Shape is exactly {status, value, conflicting_values, source_refs}, one of
// documented/pending/conflicting.
function fact(status, value, conflictingValues, sourceRefs) {
  return { status, value, conflicting_values: conflictingValues, source_refs: sourceRefs };
}
function documentedFact(value, sourceRefs) {
  return fact('documented', value, [], sourceRefs);
}
function pendingFact() {
  return fact('pending', null, [], []);
}
function conflictingFact(conflictingValues) {
  return fact('conflicting', null, conflictingValues, []);
}

// A governed manifest of V3 unit summaries {unit_id, category, evidence_refs} — the MVP
// lineage anchor, deliberately far smaller than a full agt002-integral-analysis-v3 fixture
// (requirement: "without copying the giant V3 fixture"). category/source_type values are
// drawn from the real, imported V3 enums.
function buildIntegralAnalysisUnits() {
  return [
    { unit_id: V3_UNIT_LEGAL, category: 'habilitating', evidence_refs: [ref('LC-1', 'legal_corpus')] },
    { unit_id: V3_UNIT_FIN, category: 'financial_execution', evidence_refs: [ref('TD-PLIEGO-1', 'tender_document')] },
    { unit_id: V3_UNIT_TECH, category: 'technical', evidence_refs: [ref('TD-PLIEGO-1', 'tender_document')] },
    { unit_id: V3_UNIT_EXP, category: 'technical', evidence_refs: [ref('rup', 'company_evidence')] },
    { unit_id: V3_UNIT_SCORE, category: 'discard', evidence_refs: [ref('TD-PLIEGO-1', 'tender_document')] },
  ];
}

function buildValidationContext() {
  return {
    opportunityId: OPPORTUNITY_ID,
    integralAnalysisContractVersion: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    integralAnalysisUnits: buildIntegralAnalysisUnits(),
    requirementManifest: [
      { requirement_id: 'REQ-LEGAL-1', category: 'legal', source_unit_id: V3_UNIT_LEGAL },
      { requirement_id: 'REQ-FIN-1', category: 'financial', source_unit_id: V3_UNIT_FIN },
      { requirement_id: 'REQ-TECH-1', category: 'technical', source_unit_id: V3_UNIT_TECH },
      { requirement_id: 'REQ-EXP-1', category: 'experience', source_unit_id: V3_UNIT_EXP },
      { requirement_id: 'REQ-SCORE-1', category: 'scoring', source_unit_id: V3_UNIT_SCORE },
    ],
    allowlist: {
      tender_document: ['TD-PLIEGO-1', 'TD-ADENDA-1', 'TD-ANEXO-1'],
      human_evidence: ['QA-1', 'QA-2'],
      legal_corpus: ['LC-1'],
      company_evidence: ['rup'],
      objective_validation: ['OV-1'],
    },
  };
}

function buildValidProcessSummary() {
  return {
    entity: documentedFact('Entidad Contratante Sintética S.A.S. (dato de prueba)', [ref('TD-PLIEGO-1', 'tender_document')]),
    modality: AGT002_STAKEHOLDER_BRIEF_MODALITY,
    process_number: documentedFact('LP-SINT-2026-001', [ref('TD-PLIEGO-1', 'tender_document')]),
    object: documentedFact(
      'Objeto sintético de prueba: adquisición de equipos de cómputo (ficticio, no real).',
      [ref('TD-PLIEGO-1', 'tender_document')],
    ),
    official_budget: documentedFact(500000000, [ref('TD-PLIEGO-1', 'tender_document')]),
    execution_term: documentedFact(
      '6 meses contados a partir del acta de inicio (dato sintético).',
      [ref('TD-PLIEGO-1', 'tender_document')],
    ),
    // Deliberately "pending": proves an undocumented general fact survives validation
    // untouched (Case 13) rather than being forced into a fabricated value.
    contractual_validity: pendingFact(),
  };
}

function buildValidTimeline() {
  return {
    entries: [
      {
        milestone_id: 'MS-CIERRE', label: 'Cierre del proceso', status: 'documented',
        documented_at: '2026-10-01T17:00:00.000Z', conflicting_values: [],
        source_refs: [ref('TD-PLIEGO-1', 'tender_document')], note: null,
      },
      {
        milestone_id: 'MS-VISITA', label: 'Visita técnica voluntaria', status: 'pending',
        documented_at: null, conflicting_values: [], source_refs: [],
        note: 'Aún no documentada en el pliego revisado.',
      },
      {
        milestone_id: 'MS-AUDIENCIA', label: 'Audiencia de aclaraciones', status: 'conflicting',
        documented_at: null,
        conflicting_values: [
          { value: '2026-09-20T14:00:00.000Z', source_ref: ref('TD-PLIEGO-1', 'tender_document') },
          { value: '2026-09-22T14:00:00.000Z', source_ref: ref('TD-ADENDA-1', 'tender_document') },
        ],
        source_refs: [], note: 'Pliego y adenda declaran fechas distintas; no resuelto automáticamente.',
      },
    ],
  };
}

function buildValidQuestionnaireCrossCheck() {
  return {
    entries: [
      {
        question_id: 'Q-1', question_summary: '¿El proponente debe acreditar experiencia específica en el objeto?',
        questionnaire_ref: ref('QA-1', 'human_evidence'), document_ref: ref('TD-PLIEGO-1', 'tender_document'),
        match_status: 'consistent', contradiction_detail: null,
      },
      {
        question_id: 'Q-2', question_summary: '¿El plazo de ejecución es de 6 meses?',
        questionnaire_ref: ref('QA-2', 'human_evidence'), document_ref: ref('TD-ADENDA-1', 'tender_document'),
        match_status: 'contradictory',
        contradiction_detail: 'El cuestionario respondido indica 6 meses; la adenda 1 modificó el plazo a 8 meses.',
      },
    ],
  };
}

function buildValidRequirementsChecklist() {
  const base = [
    ['REQ-LEGAL-1', 'legal', 'Certificado de existencia y representación legal', V3_UNIT_LEGAL, ref('LC-1', 'legal_corpus')],
    ['REQ-FIN-1', 'financial', 'Estados financieros certificados', V3_UNIT_FIN, ref('TD-PLIEGO-1', 'tender_document')],
    ['REQ-TECH-1', 'technical', 'Ficha técnica del equipo ofertado', V3_UNIT_TECH, ref('TD-PLIEGO-1', 'tender_document')],
    ['REQ-EXP-1', 'experience', 'Certificaciones de experiencia específica', V3_UNIT_EXP, ref('rup', 'company_evidence')],
    ['REQ-SCORE-1', 'scoring', 'Documento de oferta económica para puntaje', V3_UNIT_SCORE, ref('TD-PLIEGO-1', 'tender_document')],
  ];
  return {
    items: base.map(([requirementId, category, document, sourceUnitId, citation]) => ({
      requirement_id: requirementId,
      category,
      // Lineage back to the governed V3 unit this checklist item was projected from
      // (requirement: "explicitly lineage-checked projection of governed V3 units").
      source_unit_id: sourceUnitId,
      document,
      accreditation_method: 'Documento original o copia auténtica anexo a la propuesta (dato sintético).',
      citation,
      validity: 'valid',
      status: 'complete',
      owner: 'legal',
      missing_evidence: [],
    })),
  };
}

function buildValidTreatmentPlan() {
  return {
    actions: [
      {
        action_id: 'ACT-1', summary: 'Confirmar con el cliente la fecha vigente de audiencia de aclaraciones.',
        basis_ref: 'MS-AUDIENCIA', suggested_role: 'commercial', priority: 'high', external_side_effect: false,
      },
    ],
    human_approval: { required: true, status: 'pending', approver: null, approved_at: null },
  };
}

function buildValidStakeholderBrief() {
  return {
    contract_version: AGT002_STAKEHOLDER_BRIEF_CONTRACT_VERSION,
    opportunity_id: OPPORTUNITY_ID,
    human_review_required: true,
    process_summary: buildValidProcessSummary(),
    timeline: buildValidTimeline(),
    questionnaire_cross_check: buildValidQuestionnaireCrossCheck(),
    requirements_checklist: buildValidRequirementsChecklist(),
    treatment_plan: buildValidTreatmentPlan(),
  };
}

function buildFixture() {
  return { brief: buildValidStakeholderBrief(), validationContext: buildValidationContext() };
}

function expectRejects(mutate, pattern, message) {
  const { brief, validationContext } = buildFixture();
  const mutated = mutate(brief, validationContext) || brief;
  assert.throws(() => validateAgt002StakeholderBrief(mutated, validationContext), pattern, message);
}

// Same as expectRejects, but mutates the governed validationContext instead of the brief
// itself — used for lineage checks rooted in the governed side of the contract (Case 12).
function expectRejectsContext(mutate, pattern, message) {
  const { brief, validationContext } = buildFixture();
  mutate(validationContext);
  assert.throws(() => validateAgt002StakeholderBrief(brief, validationContext), pattern, message);
}

function run() {
  // ---------------------------------------------------------------------
  // Case 1 — baseline valid fixture round-trips and exposes exactly five blocks
  // (requirement: "exactly five blocks").
  // ---------------------------------------------------------------------
  {
    const { brief, validationContext } = buildFixture();
    const result = validateAgt002StakeholderBrief(brief, validationContext);
    assert.equal(result, brief, 'must return the same object, unmutated/unnormalized');
    const blockKeys = ['process_summary', 'timeline', 'questionnaire_cross_check', 'requirements_checklist', 'treatment_plan'];
    for (const key of blockKeys) assert.ok(Object.hasOwn(result, key), `missing block: ${key}`);
    assert.equal(Object.keys(result).filter(key => blockKeys.includes(key)).length, 5, 'must expose exactly five blocks');
  }

  // ---------------------------------------------------------------------
  // Case 2 — governance: human_review_required must always be true
  // (requirement: "human_review_required === true").
  // ---------------------------------------------------------------------
  expectRejects(brief => { brief.human_review_required = false; }, /human_review_required/i);
  expectRejects(brief => { delete brief.human_review_required; }, /human_review_required|claves/i);

  // ---------------------------------------------------------------------
  // Case 3 — closed top-level contract: no field can carry a Radar/CRM persistence
  // marker (requirement: "no Radar/CRM persistence").
  // ---------------------------------------------------------------------
  expectRejects(brief => { brief.radar_sync_id = 'RADAR-1'; }, /claves|keys|unexpected/i);
  expectRejects(brief => { brief.crm_id = 'CRM-1'; }, /claves|keys|unexpected/i);
  expectRejects(brief => { brief.persisted = true; }, /claves|keys|unexpected/i);

  // Closed export surface: guards against a future persistence-shaped export (e.g.
  // `persistToRadar`, `syncToCrm`, `saveStakeholderBrief`) slipping in un-reviewed. This
  // module must only ever export pure build/validate functions and closed enums/constants.
  {
    const exportNames = Object.keys(Agt002StakeholderBrief);
    const suspicious = exportNames.filter(name => /persist|radar|crm|save|write|sync|send|fetch|execute/i.test(name));
    assert.deepEqual(suspicious, [], `stakeholder-brief module must not export persistence/side-effecting symbols, found: ${suspicious.join(', ')}`);
  }

  // ---------------------------------------------------------------------
  // Case 4 — contract_version must match exactly.
  // ---------------------------------------------------------------------
  expectRejects(brief => { brief.contract_version = 'agt002-stakeholder-brief-v0'; }, /contract_version/i);

  // ---------------------------------------------------------------------
  // Case 5 — fail closed on mixed opportunity IDs: the brief's declared opportunity_id
  // must match the governed validationContext.opportunityId
  // (requirement: "fail closed on mixed opportunity IDs").
  // ---------------------------------------------------------------------
  expectRejects(brief => { brief.opportunity_id = OTHER_OPPORTUNITY_ID; }, /opportunity_id/i);

  // ---------------------------------------------------------------------
  // Case 6 — process_summary block: exactly the seven governed fields, nothing more,
  // nothing less (requirement: process summary field list).
  // ---------------------------------------------------------------------
  {
    const requiredFields = ['entity', 'modality', 'process_number', 'object', 'official_budget', 'execution_term', 'contractual_validity'];
    for (const field of requiredFields) {
      expectRejects(brief => { delete brief.process_summary[field]; }, /process_summary/i, `missing process_summary.${field} must fail`);
    }
    expectRejects(brief => { brief.process_summary.extra_field = 'not allowed'; }, /process_summary|claves/i);
  }
  // modality is scoped to Licitaciones only (requirement: "for Licitaciones") — the one
  // process_summary field that stays a fixed literal, never a governed fact object.
  expectRejects(brief => { brief.process_summary.modality = 'minima_cuantia'; }, /modality|modalidad/i);
  // official_budget, inside its governed fact object, must still type-check as a positive
  // number when status is "documented".
  expectRejects(brief => { brief.process_summary.official_budget.value = '500000000'; }, /official_budget|presupuesto|number|número/i);
  expectRejects(brief => { brief.process_summary.official_budget.value = -1; }, /official_budget|presupuesto|positive|positivo/i);

  // ---------------------------------------------------------------------
  // Case 7 — controlled timeline: status must be one of documented/pending/conflicting
  // (requirement: "controlled timeline with documented/pending/conflicting and source refs").
  // ---------------------------------------------------------------------
  assert.deepEqual([...AGT002_STAKEHOLDER_BRIEF_TIMELINE_STATUSES].sort(), ['conflicting', 'documented', 'pending']);
  expectRejects(brief => { brief.timeline.entries[0].status = 'confirmed'; }, /status|timeline/i);

  // documented requires a non-empty, allowlisted source_refs and a non-null documented_at.
  expectRejects(brief => { brief.timeline.entries[0].source_refs = []; }, /source_refs|documented/i);
  expectRejects(brief => { brief.timeline.entries[0].documented_at = null; }, /documented_at|documented/i);
  // pending must not smuggle in a documented_at or source_refs.
  expectRejects(brief => { brief.timeline.entries[1].documented_at = '2026-01-01T00:00:00.000Z'; }, /pending|documented_at/i);
  expectRejects(brief => { brief.timeline.entries[1].source_refs = [ref('TD-PLIEGO-1', 'tender_document')]; }, /pending|source_refs/i);
  // conflicting requires at least two DISTINCT conflicting_values, each with its own
  // source_ref — a conflict can never be silently collapsed to one value
  // (requirement: "contradictions remain explicit").
  expectRejects(brief => { brief.timeline.entries[2].conflicting_values = [brief.timeline.entries[2].conflicting_values[0]]; }, /conflicting/i);
  expectRejects(brief => {
    const [firstValue] = brief.timeline.entries[2].conflicting_values;
    brief.timeline.entries[2].conflicting_values = [firstValue, { ...firstValue }];
  }, /conflicting|distinct|duplicad/i);
  // every source_ref anywhere in the timeline must be allowlisted
  // (requirement: "fail closed on ... non-allowlisted source refs").
  expectRejects(brief => { brief.timeline.entries[0].source_refs = [ref('TD-DOES-NOT-EXIST', 'tender_document')]; }, /allowlist|permitid/i);
  expectRejects(brief => {
    brief.timeline.entries[2].conflicting_values[1].source_ref = ref('TD-DOES-NOT-EXIST', 'tender_document');
  }, /allowlist|permitid/i);

  // Contradictions remain explicit after validation: both conflicting values survive,
  // unmodified and undeduplicated.
  {
    const { brief, validationContext } = buildFixture();
    const result = validateAgt002StakeholderBrief(brief, validationContext);
    const conflictingEntry = result.timeline.entries.find(entry => entry.status === 'conflicting');
    assert.equal(conflictingEntry.conflicting_values.length, 2, 'both conflicting dates must be preserved, not collapsed');
    assert.notEqual(conflictingEntry.conflicting_values[0].value, conflictingEntry.conflicting_values[1].value);
  }

  // ---------------------------------------------------------------------
  // Case 8 — questionnaire/document cross-check: match_status closed enum, and a
  // contradictory finding must always carry an explicit, non-null contradiction_detail
  // (requirement: "questionnaire/document cross-check preserving contradictions").
  // ---------------------------------------------------------------------
  assert.deepEqual([...AGT002_STAKEHOLDER_BRIEF_MATCH_STATUSES].sort(), ['consistent', 'contradictory', 'unverifiable']);
  expectRejects(brief => { brief.questionnaire_cross_check.entries[1].contradiction_detail = null; }, /contradiction_detail|contradictor/i);
  expectRejects(brief => { brief.questionnaire_cross_check.entries[0].contradiction_detail = 'should stay null when consistent'; }, /contradiction_detail|consistent/i);
  expectRejects(brief => { brief.questionnaire_cross_check.entries[0].match_status = 'agreed'; }, /match_status/i);
  expectRejects(brief => { brief.questionnaire_cross_check.entries[0].questionnaire_ref = ref('QA-DOES-NOT-EXIST', 'human_evidence'); }, /allowlist|permitid/i);
  expectRejects(brief => { brief.questionnaire_cross_check.entries[0].document_ref = ref('TD-DOES-NOT-EXIST', 'tender_document'); }, /allowlist|permitid/i);

  // A contradiction, once recorded, survives validation untouched.
  {
    const { brief, validationContext } = buildFixture();
    const result = validateAgt002StakeholderBrief(brief, validationContext);
    const contradictory = result.questionnaire_cross_check.entries.find(entry => entry.match_status === 'contradictory');
    assert.ok(contradictory, 'a contradictory cross-check entry must be preserved');
    assert.ok(typeof contradictory.contradiction_detail === 'string' && contradictory.contradiction_detail.length > 0);
  }

  // ---------------------------------------------------------------------
  // Case 9 — requirements checklist spans exactly legal/financial/technical/experience/
  // scoring, each item carrying document, accreditation_method, an exact citation/source
  // ref, validity, status, owner and missing_evidence
  // (requirement: "requirements checklist across legal/financial/technical/experience/
  // scoring ... document, accreditation method, exact citation/source ref, validity,
  // status, owner, missing evidence").
  // ---------------------------------------------------------------------
  assert.deepEqual(
    [...AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_CATEGORIES].sort(),
    ['experience', 'financial', 'legal', 'scoring', 'technical'],
  );
  assert.deepEqual([...AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_STATUSES].sort(), ['complete', 'gap', 'pending']);
  assert.deepEqual([...AGT002_STAKEHOLDER_BRIEF_VALIDITY_STATES].sort(), ['expired', 'not_applicable', 'unknown', 'valid']);
  // enum-drift guard: the stakeholder brief's validity enum must be the exact same
  // governed reference as V3's, not a parallel array that happens to match today
  // (requirement: "governed V3 lineage", enum-drift review finding).
  assert.strictEqual(
    AGT002_STAKEHOLDER_BRIEF_VALIDITY_STATES,
    AGT002_INTEGRAL_VALIDITY_STATES,
    'AGT002_STAKEHOLDER_BRIEF_VALIDITY_STATES must be the same object reference as the governed V3 enum, not a parallel copy',
  );
  {
    const { brief, validationContext } = buildFixture();
    const result = validateAgt002StakeholderBrief(brief, validationContext);
    const categoriesPresent = new Set(result.requirements_checklist.items.map(item => item.category));
    for (const category of AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_CATEGORIES) {
      assert.ok(categoriesPresent.has(category), `requirements_checklist must cover category "${category}"`);
    }
  }
  expectRejects(brief => { brief.requirements_checklist.items[0].category = 'commercial'; }, /category/i);
  // missing citation/source ref must fail closed
  // (requirement: "fail closed on ... missing citation, source ref").
  expectRejects(brief => { brief.requirements_checklist.items[0].citation = null; }, /citation|source_ref/i);
  expectRejects(brief => { delete brief.requirements_checklist.items[0].citation; }, /citation|claves/i);
  expectRejects(brief => { brief.requirements_checklist.items[0].citation = ref('TD-DOES-NOT-EXIST', 'tender_document'); }, /allowlist|permitid/i);
  // requirement_id must be governed and its category must match the governed manifest —
  // this is also where a cross-opportunity requirement_id would be caught.
  expectRejects(brief => { brief.requirements_checklist.items[0].requirement_id = 'REQ-FROM-ANOTHER-OPPORTUNITY'; }, /requirement_id|manifiesto|manifest/i);
  expectRejects(brief => { brief.requirements_checklist.items[0].category = 'financial'; }, /category/i, 'category must match the governed manifest category for that requirement_id');
  // status/missing_evidence correspondence: a "gap" must document at least one missing
  // evidence entry, and a non-"gap" item must not carry any.
  expectRejects(brief => { brief.requirements_checklist.items[0].status = 'gap'; }, /missing_evidence|gap/i);
  expectRejects(brief => { brief.requirements_checklist.items[0].missing_evidence = ['MISS-1']; }, /missing_evidence|complete/i);

  // ---------------------------------------------------------------------
  // Case 10 — treatment/update plan: mandatory human approval, never auto-approved
  // (requirement: "treatment/update plan with mandatory human approval").
  // ---------------------------------------------------------------------
  expectRejects(brief => { brief.treatment_plan.human_approval.required = false; }, /human_approval/i);
  expectRejects(brief => { brief.treatment_plan.human_approval.status = 'approved'; }, /human_approval|status/i);
  expectRejects(brief => { brief.treatment_plan.human_approval.approver = 'someone'; }, /human_approval|approver/i);
  expectRejects(brief => { brief.treatment_plan.human_approval.approved_at = '2026-01-01T00:00:00.000Z'; }, /human_approval|approved_at/i);

  // No external action executed, ever — the projector can propose an action but can
  // never mark it as already executed / carrying a live side effect
  // (requirement: "no external action executed" / "fail closed on ... executable external
  // action").
  expectRejects(brief => { brief.treatment_plan.actions[0].external_side_effect = true; }, /external_side_effect/i);
  expectRejects(brief => { brief.treatment_plan.actions[0].executed = true; }, /claves|executed|unexpected/i);
  expectRejects(brief => { brief.treatment_plan.actions[0].basis_ref = 'MS-DOES-NOT-EXIST'; }, /basis_ref/i);

  // ---------------------------------------------------------------------
  // Case 11 — purity: build/validate perform no I/O, are synchronous, deterministic and
  // never mutate their input (requirement: "pure ... projector").
  // ---------------------------------------------------------------------
  {
    const { brief, validationContext } = buildFixture();
    const before = JSON.parse(JSON.stringify(brief));
    const result = validateAgt002StakeholderBrief(brief, validationContext);
    assert.equal(result instanceof Promise, false, 'validate must be synchronous, never async/I/O-shaped');
    assert.deepEqual(brief, before, 'validation must never mutate the input payload');
  }
  {
    const { validationContext } = buildFixture();
    const paramsA = {
      opportunityId: OPPORTUNITY_ID,
      processSummary: buildValidProcessSummary(),
      timelineEntries: buildValidTimeline().entries,
      questionnaireCrossCheckEntries: buildValidQuestionnaireCrossCheck().entries,
      requirementsChecklistItems: buildValidRequirementsChecklist().items,
      treatmentPlanActions: buildValidTreatmentPlan().actions,
    };
    const paramsB = JSON.parse(JSON.stringify(paramsA));
    const resultA = buildAgt002StakeholderBrief(paramsA, validationContext);
    const resultB = buildAgt002StakeholderBrief(paramsB, validationContext);
    assert.deepEqual(resultA, resultB, 'build must be deterministic given the same input (no clock/random)');
    assert.equal(resultA.human_review_required, true);
    assert.equal(resultA.treatment_plan.human_approval.required, true);
    assert.equal(resultA.treatment_plan.human_approval.status, 'pending');
  }

  // ---------------------------------------------------------------------
  // Case 12 — governed V3 lineage (requirement: "governed V3 lineage"). The brief is an
  // explicitly lineage-checked projection of governed V3 analysis units, not a parallel
  // free-standing envelope: validationContext carries the real exported V3 contract
  // version and a governed manifest of V3 unit summaries {unit_id, category,
  // evidence_refs}; every requirementManifest entry and every requirements_checklist item
  // trace back to one of those units via source_unit_id, and every citation must be one
  // of that unit's own governed evidence_refs.
  // ---------------------------------------------------------------------
  assert.equal(AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION, 'agt002-integral-analysis-v3');
  for (const category of ['habilitating', 'financial_execution', 'technical', 'discard']) {
    assert.ok(AGT002_INTEGRAL_CATEGORIES.includes(category), `${category} must be a real V3 category`);
  }
  for (const sourceType of ['tender_document', 'legal_corpus', 'company_evidence']) {
    assert.ok(AGT002_INTEGRAL_SOURCE_TYPES.includes(sourceType), `${sourceType} must be a real V3 source_type`);
  }

  // wrong V3 contract version lineage must fail closed.
  expectRejectsContext(ctx => { ctx.integralAnalysisContractVersion = 'agt002-integral-analysis-v2'; }, /integralAnalysisContractVersion|contract_version|v3/i);

  // an integralAnalysisUnits entry using a category outside the real, closed V3 enum must
  // fail closed (requirement: "V3 category outside the real enum").
  expectRejectsContext(ctx => { ctx.integralAnalysisUnits[0].category = 'commercial'; }, /category|enum|permitido/i);

  // a requirementManifest entry pointing at a source_unit_id absent from
  // integralAnalysisUnits must fail closed (unknown source_unit_id).
  expectRejectsContext(ctx => { ctx.requirementManifest[0].source_unit_id = 'V3-UNIT-DOES-NOT-EXIST'; }, /source_unit_id|unit/i);

  // a requirements_checklist item's source_unit_id must exactly match the governed
  // requirementManifest entry for that requirement_id (mismatched source_unit_id).
  expectRejects(brief => { brief.requirements_checklist.items[0].source_unit_id = V3_UNIT_FIN; }, /source_unit_id|manifest|manifiesto/i);

  // a citation must be one of the governed V3 unit's OWN evidence_refs — an otherwise
  // globally-allowlisted reference that simply belongs to a different unit must still
  // fail closed (requirement: "citation not present on that source unit").
  expectRejects(brief => { brief.requirements_checklist.items[0].citation = ref('TD-ADENDA-1', 'tender_document'); }, /evidence_refs|citation|unit/i);

  // ---------------------------------------------------------------------
  // Case 13 — general facts without hallucination (requirement: "general facts without
  // hallucination"). Every process_summary field except the fixed `modality` literal is a
  // governed fact object {status, value, conflicting_values, source_refs}, status in
  // documented/pending/conflicting.
  // ---------------------------------------------------------------------
  const GENERAL_FACT_FIELDS = ['entity', 'process_number', 'object', 'official_budget', 'execution_term', 'contractual_validity'];

  // a bare scalar where a governed fact object belongs must fail closed — the model can
  // never smuggle an un-sourced value past the fact wrapper.
  expectRejects(brief => { brief.process_summary.official_budget = 500000000; }, /official_budget|status|value/i);
  expectRejects(brief => { brief.process_summary.entity = 'Entidad sin envoltura gobernada'; }, /entity|status|value/i);

  // each governed fact object is itself closed: exactly status/value/conflicting_values/
  // source_refs, nothing more, nothing less.
  for (const field of GENERAL_FACT_FIELDS) {
    expectRejects(brief => { brief.process_summary[field].extra_key = 'no permitido'; }, new RegExp(`${field}|claves|unexpected`, 'i'), `${field} fact object must be closed`);
    expectRejects(brief => { delete brief.process_summary[field].status; }, new RegExp(`${field}|status|claves`, 'i'), `${field} fact object must require status`);
    expectRejects(brief => { brief.process_summary[field].status = 'confirmed'; }, new RegExp(`${field}|status`, 'i'), `${field} fact object status must be a closed enum`);
  }

  // documented: correctly typed non-empty value, empty conflicting_values, >=1
  // allowlisted source_refs.
  expectRejects(brief => { brief.process_summary.entity.value = ''; }, /entity|value|vacío|empty/i);
  expectRejects(brief => {
    brief.process_summary.entity.conflicting_values = [{ value: 'x', source_ref: ref('TD-PLIEGO-1', 'tender_document') }];
  }, /documented|conflicting_values/i);
  expectRejects(brief => { brief.process_summary.entity.source_refs = []; }, /entity|source_refs|documented/i);
  expectRejects(brief => { brief.process_summary.entity.source_refs = [ref('TD-DOES-NOT-EXIST', 'tender_document')]; }, /allowlist|permitid/i);

  // pending: value null, conflicting_values/source_refs both empty — never smuggling a
  // value or citation while claiming to be undocumented.
  expectRejects(brief => { brief.process_summary.contractual_validity.value = 'texto no permitido en pending'; }, /pending|value/i);
  expectRejects(brief => { brief.process_summary.contractual_validity.source_refs = [ref('TD-PLIEGO-1', 'tender_document')]; }, /pending|source_refs/i);

  // conflicting: value null, source_refs empty (refs live per-value, not on the fact
  // object itself), >=2 distinct typed values, each with its own allowlisted source_ref.
  expectRejects(brief => {
    brief.process_summary.official_budget = fact('conflicting', 500000000, [
      { value: 500000000, source_ref: ref('TD-PLIEGO-1', 'tender_document') },
      { value: 520000000, source_ref: ref('TD-ADENDA-1', 'tender_document') },
    ], []);
  }, /conflicting|value/i, 'conflicting fact must not also carry a top-level value');
  expectRejects(brief => {
    brief.process_summary.official_budget = conflictingFact([
      { value: 500000000, source_ref: ref('TD-PLIEGO-1', 'tender_document') },
    ]);
  }, /conflicting|distinct|distintos/i, 'a single conflicting_values entry must fail closed');
  expectRejects(brief => {
    brief.process_summary.official_budget = conflictingFact([
      { value: 500000000, source_ref: ref('TD-PLIEGO-1', 'tender_document') },
      { value: 500000000, source_ref: ref('TD-ADENDA-1', 'tender_document') },
    ]);
  }, /conflicting|distinct|distintos|duplicad/i, 'duplicate conflicting_values entries must fail closed');
  expectRejects(brief => {
    brief.process_summary.official_budget = conflictingFact([
      { value: 500000000, source_ref: ref('TD-PLIEGO-1', 'tender_document') },
      { value: 520000000, source_ref: ref('TD-DOES-NOT-EXIST', 'tender_document') },
    ]);
  }, /allowlist|permitid/i);

  // malformed non-array refs/conflicts must fail closed, never be silently coerced.
  expectRejects(brief => { brief.process_summary.entity.source_refs = 'TD-PLIEGO-1'; }, /source_refs|array|arreglo/i);
  expectRejects(brief => { brief.process_summary.official_budget.conflicting_values = 'not-an-array'; }, /conflicting_values|array|arreglo/i);

  // success: a pending contractual_validity survives validation completely untouched.
  {
    const { brief, validationContext } = buildFixture();
    const result = validateAgt002StakeholderBrief(brief, validationContext);
    assert.deepEqual(result.process_summary.contractual_validity, pendingFact());
  }

  // success: a conflicting official_budget with two distinct governed values survives
  // validation with both values intact, undeduplicated. Amounts are synthetic test
  // numbers fabricated for this fixture, not live tender IDs or real budgets.
  {
    const { brief, validationContext } = buildFixture();
    brief.process_summary.official_budget = conflictingFact([
      { value: 33145173223, source_ref: ref('TD-PLIEGO-1', 'tender_document') },
      { value: 70152980291, source_ref: ref('TD-ADENDA-1', 'tender_document') },
    ]);
    const result = validateAgt002StakeholderBrief(brief, validationContext);
    const conflictingValues = result.process_summary.official_budget.conflicting_values;
    assert.equal(conflictingValues.length, 2, 'both budget values must be preserved, not collapsed');
    assert.notEqual(conflictingValues[0].value, conflictingValues[1].value);
    assert.deepEqual(conflictingValues.map(entry => entry.value).sort((a, b) => a - b), [33145173223, 70152980291]);
  }

  // ---------------------------------------------------------------------
  // Case 14 — closing known review gaps (requirement: "close review gaps"): malformed
  // non-array fields silently treated as "empty" instead of rejected, duplicate
  // questionnaire ids, free-form treatment enums, and missing size bounds.
  // ---------------------------------------------------------------------

  // a non-array conflicting_values must fail closed, not be silently treated as "no
  // conflicting values" (entry 0 is "documented").
  expectRejects(brief => { brief.timeline.entries[0].conflicting_values = 'not-an-array'; }, /conflicting_values|array|arreglo/i);
  // a non-array source_refs must fail closed, not be silently treated as "no source refs"
  // (entry 1 is "pending").
  expectRejects(brief => { brief.timeline.entries[1].source_refs = 'not-an-array'; }, /source_refs|array|arreglo/i);

  // duplicate questionnaire question_id must fail closed.
  expectRejects(brief => {
    brief.questionnaire_cross_check.entries[1].question_id = brief.questionnaire_cross_check.entries[0].question_id;
  }, /question_id|duplicad|duplicate/i);

  // treatment_plan.actions.suggested_role/priority must use the imported closed V3
  // enums, never a free-form string.
  assert.ok(AGT002_INTEGRAL_SUGGESTED_ROLES.includes('commercial'), 'fixture suggested_role must be a real V3 role');
  assert.ok(AGT002_INTEGRAL_ACTION_PRIORITIES.includes('high'), 'fixture priority must be a real V3 priority');
  expectRejects(brief => { brief.treatment_plan.actions[0].suggested_role = 'not-a-real-role'; }, /suggested_role/i);
  expectRejects(brief => { brief.treatment_plan.actions[0].priority = 'not-a-real-priority'; }, /priority/i);

  // free text is bounded, exactly like the sibling V3 contract (TEXT_MAX_LENGTH=600) — a
  // 601-character summary must fail closed.
  expectRejects(brief => { brief.treatment_plan.actions[0].summary = 'x'.repeat(601); }, /summary|acotad|bounded|600/i);

  // arrays are bounded, exactly like the sibling V3 contract (ARRAY_MAX_ITEMS=30) — a
  // 31st action must fail closed.
  expectRejects(brief => {
    const extraActions = Array.from({ length: 30 }, (_, index) => ({
      action_id: `ACT-EXTRA-${index}`,
      summary: 'Acción sintética adicional de prueba (dato sintético).',
      basis_ref: 'MS-CIERRE',
      suggested_role: 'commercial',
      priority: 'low',
      external_side_effect: false,
    }));
    brief.treatment_plan.actions = [...brief.treatment_plan.actions, ...extraActions];
  }, /acotad|bounded|máx|30/i);

  // ---------------------------------------------------------------------
  // Case 15 — build anti-aliasing (requirement: "no aliasing of caller input"): mutating
  // the caller's nested input AFTER build() must never change the already-returned brief.
  // ---------------------------------------------------------------------
  {
    const { validationContext } = buildFixture();
    const timelineEntries = buildValidTimeline().entries;
    const params = {
      opportunityId: OPPORTUNITY_ID,
      processSummary: buildValidProcessSummary(),
      timelineEntries,
      questionnaireCrossCheckEntries: buildValidQuestionnaireCrossCheck().entries,
      requirementsChecklistItems: buildValidRequirementsChecklist().items,
      treatmentPlanActions: buildValidTreatmentPlan().actions,
    };
    const result = buildAgt002StakeholderBrief(params, validationContext);
    const before = JSON.parse(JSON.stringify(result));
    // Mutate nested caller input AFTER build — a compliant build() must have defensively
    // deep-copied every nested level, not just shallow-copied each top-level array entry.
    timelineEntries[0].source_refs.push(ref('TD-ANEXO-1', 'tender_document'));
    assert.deepEqual(result, before, 'build() must not alias nested caller input; mutating it after build must not change the returned brief');
  }

  // ---------------------------------------------------------------------
  // Case 16 — requirements_checklist coverage must be exhaustive over the governed
  // requirementManifest, not merely "at least one item per presentation category"
  // (requirement: "full manifest coverage", not category-set coverage). A second legal
  // requirement is added to the governed manifest with its own matching governed V3 unit
  // and unique allowlisted evidence ref, but the checklist is deliberately left with only
  // the original REQ-LEGAL-1 item, silently omitting REQ-LEGAL-2. The manifest/context
  // mutation itself is otherwise fully valid (real category, real source_unit_id, real
  // allowlisted evidence ref) so this failure exposes coverage omission specifically, not
  // some unrelated lineage break.
  // ---------------------------------------------------------------------
  expectRejectsContext(ctx => {
    const V3_UNIT_LEGAL_2 = 'V3-UNIT-LEGAL-2';
    ctx.allowlist = { ...ctx.allowlist, legal_corpus: [...ctx.allowlist.legal_corpus, 'LC-2'] };
    ctx.integralAnalysisUnits = [
      ...ctx.integralAnalysisUnits,
      { unit_id: V3_UNIT_LEGAL_2, category: 'habilitating', evidence_refs: [ref('LC-2', 'legal_corpus')] },
    ];
    ctx.requirementManifest = [
      ...ctx.requirementManifest,
      { requirement_id: 'REQ-LEGAL-2', category: 'legal', source_unit_id: V3_UNIT_LEGAL_2 },
    ];
  }, /coverage|manifest|requirement/i, 'requirements_checklist must cover every requirementManifest entry, not just one item per category');

  // ---------------------------------------------------------------------
  // Case 17 — process_summary general-fact source_refs are bounded by the same global
  // ARRAY_MAX_ITEMS=30 cap as every other array in this contract (TDD RED second-review
  // fix #1). All 31 refs are individually allowlisted (the context allowlist is extended
  // to cover every one of them), so the only possible cause of rejection is the size
  // bound itself, not allowlisting.
  // ---------------------------------------------------------------------
  expectRejects((brief, validationContext) => {
    const extraRefs = Array.from({ length: 31 }, (_, index) => `TD-EXTRA-${index}`);
    validationContext.allowlist.tender_document = [...validationContext.allowlist.tender_document, ...extraRefs];
    brief.process_summary.entity = documentedFact(
      'Entidad sintética con demasiadas referencias (dato de prueba).',
      extraRefs.map(refId => ref(refId, 'tender_document')),
    );
  }, /acotad|bounded|máx|30/i, 'a documented fact with 31 allowlisted source_refs must fail closed on the size bound alone');

  // ---------------------------------------------------------------------
  // Case 18 — the same global size cap applies to conflicting_values on a process_summary
  // general fact (TDD RED second-review fix #2): 31 distinct, individually valid and
  // individually allowlisted conflicting values must still fail closed on the size bound.
  // ---------------------------------------------------------------------
  expectRejects((brief, validationContext) => {
    const extraRefs = Array.from({ length: 31 }, (_, index) => `TD-CONFLICT-${index}`);
    validationContext.allowlist.tender_document = [...validationContext.allowlist.tender_document, ...extraRefs];
    brief.process_summary.official_budget = conflictingFact(
      extraRefs.map((refId, index) => ({ value: 500000000 + index, source_ref: ref(refId, 'tender_document') })),
    );
  }, /acotad|bounded|máx|30/i, 'a conflicting fact with 31 distinct allowlisted conflicting_values must fail closed on the size bound alone');

  // ---------------------------------------------------------------------
  // Case 19 — requirements_checklist.items[].owner must be drawn from the real, imported
  // AGT002_INTEGRAL_SUGGESTED_ROLES enum, never an arbitrary free-form string (TDD RED
  // second-review fix #3).
  // ---------------------------------------------------------------------
  assert.ok(!AGT002_INTEGRAL_SUGGESTED_ROLES.includes('not-a-real-role'), 'sanity: fixture-invalid owner must not already be a real V3 role');
  expectRejects(brief => { brief.requirements_checklist.items[0].owner = 'not-a-real-role'; }, /owner/i, 'requirements_checklist item owner must be one of the real, imported V3 suggested roles');

  // ---------------------------------------------------------------------
  // Case 20 — timeline documented_at must be a strict, canonical UTC ISO-8601
  // timestamp: a calendar-impossible date such as 2026-02-30 must fail closed even
  // though Date.parse silently rolls it forward to a valid date (March) instead of
  // returning NaN (release-gate finding: "strict canonical UTC ISO-8601").
  // ---------------------------------------------------------------------
  expectRejects(brief => {
    brief.timeline.entries[0].documented_at = '2026-02-30T00:00:00.000Z';
  }, /documented_at/i, 'a calendar-impossible documented_at must fail closed even though Date.parse rolls it forward');

  // ---------------------------------------------------------------------
  // Case 21 — requirements_checklist validity/status contradiction: expired
  // evidence can never be recorded as a complete requirement (release-gate finding:
  // "expired evidence cannot be complete").
  // ---------------------------------------------------------------------
  expectRejects(brief => {
    brief.requirements_checklist.items[0].validity = 'expired';
    brief.requirements_checklist.items[0].status = 'complete';
  }, /validity|expired|status/i, 'validity "expired" combined with status "complete" must fail closed');

  // ---------------------------------------------------------------------
  // Case 22 — every free-declared id (milestone_id, question_id, action_id) is bounded
  // by the same sibling V3 discipline ID_MAX_LENGTH=120 (release-gate finding: three
  // distinct assertions, one per field). A length-121 id must fail closed.
  // ---------------------------------------------------------------------
  const ID_MAX_LENGTH = 120;
  expectRejects(brief => {
    brief.timeline.entries[0].milestone_id = 'M'.repeat(ID_MAX_LENGTH + 1);
  }, /milestone_id|acotad|bounded|120/i, 'a 121-character milestone_id must fail closed on the ID size bound');
  expectRejects(brief => {
    brief.questionnaire_cross_check.entries[0].question_id = 'Q'.repeat(ID_MAX_LENGTH + 1);
  }, /question_id|acotad|bounded|120/i, 'a 121-character question_id must fail closed on the ID size bound');
  expectRejects(brief => {
    brief.treatment_plan.actions[0].action_id = 'A'.repeat(ID_MAX_LENGTH + 1);
  }, /action_id|acotad|bounded|120/i, 'a 121-character action_id must fail closed on the ID size bound');

  // ---------------------------------------------------------------------
  // Case 23 — timeline conflicting_values[*].value must receive the same strict,
  // canonical UTC ISO-8601 validation as documented_at: a calendar-impossible
  // candidate date such as 2026-02-30 must fail closed even though Date.parse
  // silently rolls it forward to a valid date (March) instead of returning NaN
  // (release-gate finding: alternate candidate dates get the same strict canonical
  // UTC ISO-8601 check as documented_at, not merely bounded-text validation).
  // ---------------------------------------------------------------------
  expectRejects(brief => {
    brief.timeline.entries[2].conflicting_values[0].value = '2026-02-30T00:00:00.000Z';
  }, /conflicting_values.*value|conflicting.*fecha|conflicting.*date/i, 'a calendar-impossible conflicting_values[*].value must fail closed even though Date.parse rolls it forward');

  console.log('agt002-stakeholder-brief contract cases defined (governed V3 lineage, general-fact objects, review-gap closures)');
}

run();
