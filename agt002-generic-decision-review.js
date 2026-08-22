// Generic read-side decision projection for operational AGT-002 runs.
//
// This module never decides GO/NO-GO and never trusts a model-supplied `decision_review`.
// It only projects an already persisted, canonical/current/completed integral-analysis-v3
// into the human-facing decision-review shape. Potential blockers remain questions until a
// person confirms them; therefore this generic path never self-creates a confirmed blocker.

export const AGT002_GENERIC_DECISION_REVIEW_ARTIFACT_TYPE = 'agt002_generic_decision_review';
export const AGT002_GENERIC_DECISION_REVIEW_CONTRACT_VERSION = 'agt002-generic-decision-review@1';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function sameUniqueOrder(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function structurallyEligibleIntegralAnalysis(integralAnalysis) {
  if (!integralAnalysis || typeof integralAnalysis !== 'object' || Array.isArray(integralAnalysis)) return false;
  if (integralAnalysis.contract_version !== 'agt002-integral-analysis-v3') return false;
  if (!integralAnalysis.coverage || !nonEmptyArray(integralAnalysis.analysis_units)) return false;

  const units = integralAnalysis.analysis_units;
  const requirementIds = units.map(unit => unit?.requirement_id);
  if (requirementIds.some(id => !nonEmptyString(id)) || new Set(requirementIds).size !== requirementIds.length) return false;
  if (!sameUniqueOrder(integralAnalysis.coverage.analyzed_requirement_ids, requirementIds)) return false;
  if (!sameUniqueOrder(integralAnalysis.coverage.expected_requirement_ids, requirementIds)) return false;

  return units.every((unit, index) => (
    unit
    && typeof unit === 'object'
    && nonEmptyString(unit.unit_id)
    && nonEmptyString(unit.requirement_id)
    && nonEmptyString(unit.title)
    && unit.sequence === index + 1
    && nonEmptyString(unit.conclusion?.status)
    && nonEmptyString(unit.conclusion?.summary)
    && nonEmptyString(unit.blocking?.effect)
    && nonEmptyString(unit.blocking?.reason)
    && Array.isArray(unit.evidence_refs)
    && Array.isArray(unit.missing_evidence)
    && Array.isArray(unit.actions)
    && nonEmptyString(unit.closure?.status)
    && typeof unit.human_validation?.required === 'boolean'
  ));
}

function eligibleCurrentAnalysis(currentAnalysis, result) {
  return Boolean(
    currentAnalysis
    && currentAnalysis.producer === 'AGT-002'
    && currentAnalysis.method === 'agent_ai'
    && currentAnalysis.status === 'completed'
    && currentAnalysis.canonical === true
    && currentAnalysis.current === true
    && nonEmptyString(currentAnalysis.run_id)
    && nonEmptyString(currentAnalysis.opportunity_id)
    && nonEmptyString(currentAnalysis.snapshot_id)
    && structurallyEligibleIntegralAnalysis(result?.integral_analysis)
  );
}

function criticalMissingReasons(unit) {
  return unit.missing_evidence
    .filter(item => item?.critical === true && nonEmptyString(item.reason))
    .map(item => item.reason.trim());
}

function firstActionSummary(unit) {
  const prioritized = [...unit.actions].sort((left, right) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return (rank[left?.priority] ?? 4) - (rank[right?.priority] ?? 4);
  });
  return prioritized.find(action => nonEmptyString(action?.summary))?.summary?.trim() || null;
}

function unitNeedsHumanDecision(unit) {
  return unit.assessment_mode === 'abstained'
    || unit.human_validation.required === true
    || unit.blocking.effect === 'blocker'
    || unit.blocking.effect === 'conditional'
    || unit.blocking.effect === 'undetermined'
    || criticalMissingReasons(unit).length > 0
    || unit.closure.status === 'human_confirmation_required';
}

function unitIsNotApplicable(unit) {
  return unit.evidence_state?.applicability === 'not_applicable'
    && unit.blocking.effect === 'non_blocking'
    && unit.human_validation.required === false;
}

function unitIsSupported(unit) {
  return unit.conclusion.status === 'supported_with_evidence'
    && unit.evidence_state?.compliance === 'supported_pending_human_review'
    && unit.blocking.effect === 'non_blocking'
    && unit.human_validation.required === false
    && unit.missing_evidence.length === 0
    && unit.closure.status === 'evidence_satisfied';
}

function reviewedStatusForUnit(unit) {
  if (unitIsNotApplicable(unit)) return 'not_applicable';
  if (unitNeedsHumanDecision(unit)) return 'decision_question';
  if (unitIsSupported(unit)) return 'supported';
  return 'preparation';
}

function presentationForUnit(unit, reviewedStatus) {
  if (reviewedStatus === 'not_applicable') return undefined;

  const missingReasons = criticalMissingReasons(unit);
  const actionRequired = firstActionSummary(unit)
    || (nonEmptyString(unit.closure?.condition) ? unit.closure.condition.trim() : null)
    || (nonEmptyString(unit.human_validation?.reason) ? unit.human_validation.reason.trim() : null)
    || 'Revisar esta condición con la persona responsable antes de tomar la decisión.';

  if (reviewedStatus === 'decision_question') {
    return Object.freeze({
      title: unit.title.trim(),
      summary: unit.conclusion.summary.trim(),
      missing: missingReasons.length > 0
        ? missingReasons.join(' ')
        : unit.blocking.reason.trim(),
      action_required: actionRequired,
    });
  }
  if (reviewedStatus === 'supported') {
    return Object.freeze({
      title: unit.title.trim(),
      summary: unit.conclusion.summary.trim(),
    });
  }
  return Object.freeze({
    title: unit.title.trim(),
    summary: unit.conclusion.summary.trim(),
    action_required: actionRequired,
  });
}

function findingForUnit(unit) {
  const reviewedStatus = reviewedStatusForUnit(unit);
  const presentation = presentationForUnit(unit, reviewedStatus);
  return Object.freeze({
    id: `generic-review-${unit.unit_id}`,
    requirement_id: unit.requirement_id,
    label: unit.title.trim(),
    reviewed_status: reviewedStatus,
    rationale: unit.blocking.reason.trim(),
    evidence_refs: Object.freeze([Object.freeze({
      type: 'manifest_requirement',
      requirement_id: unit.requirement_id,
    })]),
    ...(presentation ? { presentation } : {}),
  });
}

function recommendationForBuckets(byStatus) {
  if (byStatus.decision_question.length > 0) return 'pause';
  if (byStatus.preparation.length > 0) return 'advance_conditionally';
  return 'advance';
}

export function deriveAgt002GenericDecisionReview(currentAnalysis, result) {
  if (!eligibleCurrentAnalysis(currentAnalysis, result)) return null;

  const byStatus = {
    supported: [],
    preparation: [],
    not_applicable: [],
    decision_question: [],
    blocker: [],
  };
  for (const unit of result.integral_analysis.analysis_units) {
    const finding = findingForUnit(unit);
    byStatus[finding.reviewed_status].push(finding);
  }

  const freezeBucket = key => Object.freeze(byStatus[key]);
  return Object.freeze({
    artifact_type: AGT002_GENERIC_DECISION_REVIEW_ARTIFACT_TYPE,
    contract_version: AGT002_GENERIC_DECISION_REVIEW_CONTRACT_VERSION,
    opportunity_id: currentAnalysis.opportunity_id,
    human_approval_required: true,
    decision_status: 'pending_human_decision',
    decision_ready: byStatus.decision_question.length === 0,
    routing_action: 'flag_for_responsible_person',
    external_communications_allowed: false,
    evidence_requests_allowed: true,
    review_findings: Object.freeze([]),
    exercise_mode: Object.freeze({ active: false, bypassed_requirement_ids: Object.freeze([]) }),
    recommendation: recommendationForBuckets(byStatus),
    blockers: freezeBucket('blocker'),
    decision_questions: freezeBucket('decision_question'),
    supported: freezeBucket('supported'),
    preparation: freezeBucket('preparation'),
    not_applicable: freezeBucket('not_applicable'),
    counts: Object.freeze({
      supported: byStatus.supported.length,
      preparation: byStatus.preparation.length,
      not_applicable: byStatus.not_applicable.length,
      decision_questions: byStatus.decision_question.length,
      blockers: 0,
    }),
  });
}
