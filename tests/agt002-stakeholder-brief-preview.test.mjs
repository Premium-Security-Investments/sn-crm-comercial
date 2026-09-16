// AGT-002 stakeholder-brief PREVIEW adapter — RED spec only, no production file exists yet.
//
// `buildAgt002StakeholderBriefPreview` wraps the existing, already-governed
// `buildAgt002StakeholderBrief` projector (agt002-stakeholder-brief.js) behind a feature
// flag and a *self-contained* governed source: a single canonical AGT-002 envelope
// (schema_version/agent_id/status + a governed `integral_analysis` block of V3 units),
// instead of a caller-supplied `validationContext`. The adapter derives BOTH the V3 unit
// lineage and the citation allowlist from the envelope itself — callers pass a plain
// `governedInput` (the same shape `buildAgt002StakeholderBrief` already accepts, plus
// `requirementManifest`) and MUST NOT be able to inject or override `allowlist` or
// `integralAnalysisUnits`, since those are exactly the governed invariants this adapter
// exists to protect.
//
// Assumed contract (this file DEFINES it — no implementation exists):
//   buildAgt002StakeholderBriefPreview({ enabled, opportunityId, envelope, governedInput })
//     -> { status: 'disabled' | 'unavailable' | 'available', stakeholder_brief, missing_inputs }
//   - enabled === false short-circuits to { status: 'disabled', stakeholder_brief: null,
//     missing_inputs: [] } before anything else is inspected, even if envelope/governedInput
//     are malformed.
//   - enabled === true with an incomplete governedInput returns status 'unavailable',
//     stakeholder_brief: null, and missing_inputs naming every absent brief block.
//   - enabled === true with a complete, lineage-consistent governedInput returns status
//     'available' and a full five-block stakeholder_brief.
//   - The opportunity boundary is server-owned: the caller passes `opportunityId` explicitly
//     (the envelope itself carries no opportunity field), and it is compared against
//     `governedInput.opportunityId`.
//   - Lineage/citation violations between governedInput and the envelope throw.
//
// All ids, entities, amounts and dates below are fabricated for this test only.

import { strict as assert } from 'node:assert';
import { buildAgt002StakeholderBriefPreview } from '../agt002-stakeholder-brief-preview.js';
import { AGT002_STAKEHOLDER_BRIEF_MODALITY } from '../agt002-stakeholder-brief.js';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from '../agt002-integral-analysis-v3.js';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_OPPORTUNITY_ID = '22222222-2222-4222-8222-222222222222';

const V3_UNIT_LEGAL = 'V3-UNIT-LEGAL-1';
const V3_UNIT_FIN = 'V3-UNIT-FIN-1';
const V3_UNIT_TECH = 'V3-UNIT-TECH-1';
const V3_UNIT_EXP = 'V3-UNIT-EXP-1';
const V3_UNIT_SCORE = 'V3-UNIT-SCORE-1';

const BRIEF_BLOCK_NAMES = [
  'process_summary', 'timeline', 'questionnaire_cross_check', 'requirements_checklist', 'treatment_plan',
];

function ref(refId, sourceType) { return { ref: refId, source_type: sourceType }; }
function documentedFact(value, sourceRefs) {
  return { status: 'documented', value, conflicting_values: [], source_refs: sourceRefs };
}
function pendingFact() { return { status: 'pending', value: null, conflicting_values: [], source_refs: [] }; }

// [requirement_id, unit_id, checklist category, V3 category, evidence ref this unit owns]
const UNIT_SPECS = [
  ['REQ-LEGAL-1', V3_UNIT_LEGAL, 'legal', 'habilitating', ref('LC-1', 'legal_corpus')],
  ['REQ-FIN-1', V3_UNIT_FIN, 'financial', 'financial_execution', ref('TD-PLIEGO-1', 'tender_document')],
  ['REQ-TECH-1', V3_UNIT_TECH, 'technical', 'technical', ref('TD-PLIEGO-1', 'tender_document')],
  ['REQ-EXP-1', V3_UNIT_EXP, 'experience', 'technical', ref('rup', 'company_evidence')],
  ['REQ-SCORE-1', V3_UNIT_SCORE, 'scoring', 'discard', ref('TD-PLIEGO-1', 'tender_document')],
];

function buildEnvelope() {
  return {
    schema_version: '3.0.0',
    agent_id: 'AGT-002',
    status: 'completed',
    integral_analysis: {
      contract_version: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
      analysis_units: UNIT_SPECS.map(([requirementId, unitId, , category, evidenceRef]) => ({
        unit_id: unitId,
        unit_kind: 'tender_requirement',
        requirement_id: requirementId,
        category,
        evidence_refs: unitId === V3_UNIT_LEGAL
          ? [evidenceRef, ref('QA-1', 'human_evidence')]
          : [evidenceRef],
      })),
    },
  };
}

function buildRequirementManifest() {
  return UNIT_SPECS.map(([requirementId, unitId, category]) => (
    { requirement_id: requirementId, category, source_unit_id: unitId }
  ));
}

function buildProcessSummary() {
  return {
    entity: documentedFact('Entidad Contratante Sintética S.A.S. (dato de prueba)', [ref('TD-PLIEGO-1', 'tender_document')]),
    modality: AGT002_STAKEHOLDER_BRIEF_MODALITY,
    process_number: documentedFact('LP-SINT-2026-001', [ref('TD-PLIEGO-1', 'tender_document')]),
    object: documentedFact('Objeto sintético de prueba (ficticio, no real).', [ref('TD-PLIEGO-1', 'tender_document')]),
    official_budget: documentedFact(500000000, [ref('TD-PLIEGO-1', 'tender_document')]),
    execution_term: documentedFact('6 meses (dato sintético).', [ref('TD-PLIEGO-1', 'tender_document')]),
    contractual_validity: pendingFact(),
  };
}

function buildTimelineEntries() {
  return [
    {
      milestone_id: 'MS-CIERRE', label: 'Cierre del proceso', status: 'documented',
      documented_at: '2026-10-01T17:00:00.000Z', conflicting_values: [],
      source_refs: [ref('TD-PLIEGO-1', 'tender_document')], note: null,
    },
  ];
}

function buildQuestionnaireCrossCheckEntries() {
  return [
    {
      question_id: 'Q-1', question_summary: '¿Aplica experiencia específica en el objeto?',
      questionnaire_ref: ref('QA-1', 'human_evidence'), document_ref: ref('TD-PLIEGO-1', 'tender_document'),
      match_status: 'consistent', contradiction_detail: null,
    },
  ];
}

function buildRequirementsChecklistItems() {
  return UNIT_SPECS.map(([requirementId, unitId, category, , evidenceRef]) => ({
    requirement_id: requirementId,
    category,
    source_unit_id: unitId,
    document: 'Documento sintético asociado (dato de prueba).',
    accreditation_method: 'Documento original o copia auténtica anexo a la propuesta (dato sintético).',
    citation: evidenceRef,
    validity: 'valid',
    status: 'complete',
    owner: 'legal',
    missing_evidence: [],
  }));
}

function buildTreatmentPlanActions() {
  return [
    {
      action_id: 'ACT-1', summary: 'Confirmar con el cliente la fecha vigente de audiencia de aclaraciones.',
      basis_ref: 'MS-CIERRE', suggested_role: 'commercial', priority: 'high', external_side_effect: false,
    },
  ];
}

function buildGovernedInput(overrides = {}) {
  return {
    opportunityId: OPPORTUNITY_ID,
    requirementManifest: buildRequirementManifest(),
    processSummary: buildProcessSummary(),
    timelineEntries: buildTimelineEntries(),
    questionnaireCrossCheckEntries: buildQuestionnaireCrossCheckEntries(),
    requirementsChecklistItems: buildRequirementsChecklistItems(),
    treatmentPlanActions: buildTreatmentPlanActions(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1) disabled short-circuits, even with malformed everything-else.
// ---------------------------------------------------------------------------
assert.deepEqual(
  buildAgt002StakeholderBriefPreview({
    enabled: false, opportunityId: OPPORTUNITY_ID, envelope: { nonsense: true }, governedInput: { also: 'garbage' },
  }),
  { status: 'disabled', stakeholder_brief: null, missing_inputs: [] },
);
// Even the server-owned opportunityId is not required to short-circuit when disabled.
assert.deepEqual(
  buildAgt002StakeholderBriefPreview({ enabled: false }),
  { status: 'disabled', stakeholder_brief: null, missing_inputs: [] },
);

// ---------------------------------------------------------------------------
// 2) enabled + missing governedInput -> unavailable, all five blocks reported missing.
// ---------------------------------------------------------------------------
{
  const result = buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: buildEnvelope(),
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.stakeholder_brief, null);
  assert.deepEqual([...result.missing_inputs].sort(), [...BRIEF_BLOCK_NAMES].sort());
}
{
  const result = buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: buildEnvelope(), governedInput: {},
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.stakeholder_brief, null);
  assert.deepEqual([...result.missing_inputs].sort(), [...BRIEF_BLOCK_NAMES].sort());
}

// ---------------------------------------------------------------------------
// 3) enabled + complete -> available, full brief, closed human-review/action gates.
// ---------------------------------------------------------------------------
{
  const result = buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: buildEnvelope(), governedInput: buildGovernedInput(),
  });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.missing_inputs, []);
  const brief = result.stakeholder_brief;
  assert.ok(brief);
  for (const key of BRIEF_BLOCK_NAMES) assert.ok(brief[key], `missing block ${key}`);
  assert.equal(brief.human_review_required, true);
  assert.equal(brief.treatment_plan.human_approval.required, true);
  assert.equal(brief.treatment_plan.human_approval.status, 'pending');
  for (const action of brief.treatment_plan.actions) assert.equal(action.external_side_effect, false);
}

// ---------------------------------------------------------------------------
// 3b) an optional strategic_consideration unit alongside the formal tender_requirement
// units (requirement_id null, category strategic, a valid evidence ref it owns) does not
// block availability: complete, lineage-consistent governedInput -> status 'available'.
// ---------------------------------------------------------------------------
{
  const envelopeWithStrategicUnit = buildEnvelope();
  envelopeWithStrategicUnit.integral_analysis.analysis_units.push({
    unit_id: 'V3-UNIT-STRAT-1',
    unit_kind: 'strategic_consideration',
    requirement_id: null,
    category: 'strategic',
    evidence_refs: [ref('STRAT-1', 'company_evidence')],
  });
  const result = buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: envelopeWithStrategicUnit, governedInput: buildGovernedInput(),
  });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.missing_inputs, []);
}

// ---------------------------------------------------------------------------
// 4) deterministic, and neither input is mutated.
// ---------------------------------------------------------------------------
{
  const envelope = buildEnvelope();
  const governedInput = buildGovernedInput();
  const envelopeSnapshot = structuredClone(envelope);
  const governedInputSnapshot = structuredClone(governedInput);
  const first = buildAgt002StakeholderBriefPreview({ enabled: true, opportunityId: OPPORTUNITY_ID, envelope, governedInput });
  const second = buildAgt002StakeholderBriefPreview({ enabled: true, opportunityId: OPPORTUNITY_ID, envelope, governedInput });
  assert.deepEqual(first, second);
  assert.deepEqual(envelope, envelopeSnapshot);
  assert.deepEqual(governedInput, governedInputSnapshot);
}

// ---------------------------------------------------------------------------
// 5) governed-lineage violations throw rather than silently degrading.
// ---------------------------------------------------------------------------

// Non-V3 integral_analysis contract_version.
{
  const badEnvelope = structuredClone(buildEnvelope());
  badEnvelope.integral_analysis.contract_version = 'agt002-integral-analysis-v2';
  assert.throws(() => buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: badEnvelope, governedInput: buildGovernedInput(),
  }), /contract_version|integral-analysis-v3/i);
}

// Non-V3 envelope schema_version.
{
  const badEnvelope = structuredClone(buildEnvelope());
  badEnvelope.schema_version = '2.0.0';
  assert.throws(() => buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: badEnvelope, governedInput: buildGovernedInput(),
  }), /schema_version/i);
}

// governedInput.opportunityId disagrees with the server-owned opportunityId argument
// (the envelope itself carries no opportunity field — the boundary is enforced solely
// against the explicit, caller-supplied opportunityId).
assert.throws(() => buildAgt002StakeholderBriefPreview({
  enabled: true,
  opportunityId: OPPORTUNITY_ID,
  envelope: buildEnvelope(),
  governedInput: buildGovernedInput({ opportunityId: OTHER_OPPORTUNITY_ID }),
}), /opportunity/i);

// requirementManifest.requirement_id disagrees with its envelope source unit's requirement_id.
{
  const manifest = buildRequirementManifest();
  manifest[0] = { ...manifest[0], requirement_id: 'REQ-LEGAL-MISMATCH' };
  assert.throws(() => buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: buildEnvelope(),
    governedInput: buildGovernedInput({ requirementManifest: manifest }),
  }), /requirement_id/i);
}

// requirementManifest points at a source_unit_id absent from the envelope.
{
  const manifest = buildRequirementManifest();
  manifest[0] = { ...manifest[0], source_unit_id: 'V3-UNIT-DOES-NOT-EXIST' };
  assert.throws(() => buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: buildEnvelope(),
    governedInput: buildGovernedInput({ requirementManifest: manifest }),
  }), /source_unit_id/i);
}

// Checklist citation is a real, globally-allowlisted ref (TD-PLIEGO-1) but belongs to a
// *different* unit than the checklist item's own source_unit_id (V3_UNIT_LEGAL only owns
// LC-1) — a global-allowlist-only check would wrongly accept this cross-unit citation.
{
  const items = buildRequirementsChecklistItems();
  items[0] = { ...items[0], citation: ref('TD-PLIEGO-1', 'tender_document') };
  assert.throws(() => buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: buildEnvelope(),
    governedInput: buildGovernedInput({ requirementsChecklistItems: items }),
  }), /citation|evidence_refs/i);
}

// Envelope's first canonical analysis unit has an empty requirement_id.
{
  const badEnvelope = structuredClone(buildEnvelope());
  badEnvelope.integral_analysis.analysis_units[0].requirement_id = '';
  assert.throws(() => buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: badEnvelope, governedInput: buildGovernedInput(),
  }), /envelope.*requirement_id.*inválido/i);
}

// ---------------------------------------------------------------------------
// governedInput never carries `allowlist` / `integralAnalysisUnits` — both are derived
// solely from the envelope. Even a caller that sneaks them in must have them ignored.
// ---------------------------------------------------------------------------
{
  const governedInput = buildGovernedInput();
  assert.ok(!('allowlist' in governedInput));
  assert.ok(!('integralAnalysisUnits' in governedInput));

  const sneaky = buildGovernedInput({
    allowlist: { tender_document: ['NOT-A-REAL-REF'] },
    integralAnalysisUnits: [{ unit_id: 'FAKE', requirement_id: 'FAKE', category: 'discard', evidence_refs: [] }],
  });
  const result = buildAgt002StakeholderBriefPreview({
    enabled: true, opportunityId: OPPORTUNITY_ID, envelope: buildEnvelope(), governedInput: sneaky,
  });
  assert.equal(result.status, 'available');
}

console.log('agt002-stakeholder-brief-preview.test.mjs OK');
