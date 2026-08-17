// Deterministic v2 compatibility projection for the AGT-002 integral analysis v3
// contract. Pure function: given an already-validated `integral_analysis` payload (see
// agt002-integral-analysis-v3.js), derive the legacy v2 result shape
// (recommendation/summary/strengths/weaknesses/blockers/questions/unverified/
// next_action/human_review_required) that existing v2 consumers already understand.
// The model never produces any of these fields for v3; this module is the ONLY place
// that derives them, exclusively from validated v3 fields — never from free model
// prose, and never introducing an evidence reference the source unit did not carry.
//
// Design: docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-design.md, sections 9-10.

const HUMAN_REVIEW_FALLBACK_TEXT = 'Revisión humana final requerida antes de continuar con la oportunidad.';

function isMissingEvidenceCritical(unit) {
  return unit.missing_evidence.some(item => item.critical === true);
}

function isUnresolvedBlocker(unit) {
  return unit.blocking.effect === 'blocker' && unit.closure.status !== 'evidence_satisfied';
}

function isMaterialLegalUncertainty(unit) {
  return unit.legal_assessment.status === 'not_verified' && unit.legal_assessment.human_legal_review_required === true;
}

function isEscalationCritical(unit) {
  return unit.escalation.level === 'committee' || unit.escalation.level === 'management';
}

// design section 10: the set of units counted toward `critical_open_count` must be
// exactly the set of units the projection marks `critical: true` in `questions`.
function isCriticalOpenUnit(unit) {
  return isMissingEvidenceCritical(unit)
    || isUnresolvedBlocker(unit)
    || unit.commercial_impact.level === 'critical'
    || isEscalationCritical(unit)
    || isMaterialLegalUncertainty(unit);
}

function hasMaterialUnknownAxis(unit) {
  return unit.evidence_state.validity === 'unknown' || unit.evidence_state.applicability === 'unknown';
}

function isBlockerUnit(unit) {
  return unit.blocking.effect === 'blocker'
    || (unit.conclusion.status === 'gap_evidenced' && ['critical', 'high'].includes(unit.commercial_impact.level));
}

function isQuestionUnit(unit) {
  return isCriticalOpenUnit(unit)
    || unit.missing_evidence.length > 0
    || hasMaterialUnknownAxis(unit)
    || unit.actions.some(action => action.action_type === 'human_decision')
    || unit.conclusion.status === 'human_validation_required';
}

function isUnverifiedUnit(unit) {
  return unit.assessment_mode === 'abstained'
    || unit.evidence_state.review !== 'reviewed'
    || unit.evidence_state.validity === 'unknown'
    || unit.evidence_state.applicability === 'unknown'
    || unit.legal_assessment.status === 'not_verified';
}

function isStrengthUnit(unit) {
  return unit.conclusion.status === 'supported_with_evidence'
    && unit.evidence_state.validity !== 'unknown'
    && unit.evidence_state.applicability !== 'unknown'
    && ['low', 'medium'].includes(unit.commercial_impact.level);
}

function isWeaknessUnit(unit) {
  return ['partially_supported', 'gap_evidenced'].includes(unit.conclusion.status)
    || unit.blocking.effect === 'conditional'
    || ['high', 'critical'].includes(unit.commercial_impact.level);
}

function refIds(unit) {
  return unit.evidence_refs.map(ref => ref.ref);
}

function toFinding(unit, suffix, { critical = false } = {}) {
  return {
    id: `${unit.unit_id}::${suffix}`,
    text: unit.conclusion.summary,
    critical,
    evidence_refs: refIds(unit),
  };
}

const CATEGORY_ORDER = ['discard', 'habilitating', 'technical', 'financial_execution', 'strategic'];

function buildSummary(units, coverage) {
  const counts = Object.fromEntries(CATEGORY_ORDER.map(category => [category, 0]));
  for (const unit of units) counts[unit.category] += 1;
  const blockerIds = units.filter(isBlockerUnit).map(unit => unit.unit_id);
  const criticalIds = units.filter(isCriticalOpenUnit).map(unit => unit.unit_id);
  const unverifiedIds = units.filter(isUnverifiedUnit).map(unit => unit.unit_id);
  return [
    `Cobertura: ${coverage.analyzed_requirement_ids.length}/${coverage.expected_requirement_ids.length} requisitos gobernados.`,
    `Unidades por categoría: descarte=${counts.discard}, habilitantes=${counts.habilitating}, técnico=${counts.technical}, financiero_ejecucion=${counts.financial_execution}, estratégico=${counts.strategic}.`,
    `Bloqueadores: ${blockerIds.length}${blockerIds.length ? ` (${blockerIds.join(', ')})` : ''}.`,
    `Preguntas críticas: ${criticalIds.length}${criticalIds.length ? ` (${criticalIds.join(', ')})` : ''}.`,
    `Sin verificar: ${unverifiedIds.length}${unverifiedIds.length ? ` (${unverifiedIds.join(', ')})` : ''}.`,
  ].join(' ');
}

// design section 9.6: ordered next_action stages, most urgent first. Each stage returns
// the first unit (in v3 sequence order) matching its predicate that also carries at
// least one action; the action's own summary becomes next_action verbatim.
const NEXT_ACTION_STAGES = [
  unit => (unit.blocking.effect === 'blocker' && unit.blocking.curability === 'not_curable') || isEscalationCritical(unit),
  unit => unit.blocking.effect === 'blocker',
  unit => isMissingEvidenceCritical(unit),
  unit => unit.legal_assessment.status === 'not_verified',
  unit => unit.category === 'technical' || unit.category === 'financial_execution',
  unit => unit.category === 'strategic',
];

function deriveNextAction(units) {
  for (const matchesStage of NEXT_ACTION_STAGES) {
    for (const unit of units) {
      if (matchesStage(unit) && unit.actions.length > 0) return unit.actions[0].summary;
    }
  }
  return HUMAN_REVIEW_FALLBACK_TEXT;
}

// design section 9.8.
function deriveRecommendation(units, coverage) {
  if (units.some(unit => unit.blocking.effect === 'blocker' && unit.blocking.curability === 'not_curable')) {
    return 'do_not_advance';
  }
  if (units.some(unit => unit.blocking.effect === 'blocker') || units.some(isMissingEvidenceCritical)) {
    return 'pause';
  }
  if (
    coverage.material_omissions === true
    || units.some(unit => unit.blocking.effect === 'conditional')
    || units.some(unit => unit.actions.length > 0)
    || units.some(isUnverifiedUnit)
  ) {
    return 'advance_conditionally';
  }
  return 'advance';
}

/**
 * Derives the deterministic v2 projection from an already-validated v3
 * `integral_analysis` payload. Pure and side-effect free: reads only `coverage` and
 * `analysis_units` from its argument (any other key present — e.g. a stray legacy
 * field on a hand-built or corrupted object — is never read, so it cannot leak into
 * the output), and same input always yields byte-identical output regardless of
 * incidental top-level key order.
 */
export function projectAgt002IntegralV3ToV2(integralAnalysis) {
  const { coverage, analysis_units: units } = integralAnalysis;

  // The full open-question surface: one finding per question unit, each carrying its own
  // `critical` flag (design section 10 ties `critical: true` to `isCriticalOpenUnit`).
  const questions = units.filter(isQuestionUnit).map(unit => toFinding(unit, 'question', { critical: isCriticalOpenUnit(unit) }));

  return {
    recommendation: deriveRecommendation(units, coverage),
    summary: buildSummary(units, coverage),
    strengths: units.filter(isStrengthUnit).map(unit => toFinding(unit, 'strength')),
    weaknesses: units.filter(isWeaknessUnit).map(unit => toFinding(unit, 'weakness')),
    blockers: units.filter(isBlockerUnit).map(unit => toFinding(unit, 'blocker')),
    questions,
    // `critical_questions` is a DERIVED SUBSET of `questions` (never a replacement): exactly the
    // findings whose unit is critical-open, so the same finding objects also remain in the full
    // `questions` list above. This gives a human a material-exception shortlist without hiding the
    // complete set. In a fully-abstained governed run no unit is critical-open, so this is honestly
    // empty while `questions` still lists one entry per requirement.
    critical_questions: questions.filter(finding => finding.critical === true),
    unverified: units.filter(isUnverifiedUnit).map(unit => toFinding(unit, 'unverified')),
    next_action: deriveNextAction(units),
    human_review_required: true,
  };
}

/** design section 10: unique units counted as critical-open, from v3 fields only. */
export function computeAgt002IntegralV3CriticalOpenCount(integralAnalysis) {
  return integralAnalysis.analysis_units.filter(isCriticalOpenUnit).length;
}
