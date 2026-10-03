// Test-only fixture builders for the AGT-002 P0-01 `pre_go_analysis.v1` schema
// (schemas/agt002/pre_go_analysis.v1.schema.json). These builders produce plain
// JSON-serializable objects that are valid against the immutable schema; tests
// mutate structuredClone()'d copies to exercise negative paths. This file is
// fixture data for tests only — it is NOT the validator/builder implementation
// (`agt002-pre-go-analysis-v1.js`), which does not exist yet (RED phase).

export const T0 = '2026-09-01T00:00:00Z';
export const CUTOFF_AT = '2026-08-25T00:00:00Z';
export const RUN_ID_SEED = 10;

export function nthUuid(n) {
  const suffix = String(n).padStart(12, '0').slice(-12);
  return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`;
}

export function nthHash(n) {
  const suffix = String(n).padStart(4, '0').slice(-4);
  return `${'a'.repeat(60)}${suffix}`;
}

export const RUN_ID = nthUuid(RUN_ID_SEED);

export function buildMemberRef(n, overrides = {}) {
  return {
    member_id: nthUuid(100 + n),
    document_id: nthUuid(200 + n),
    content_hash: nthHash(300 + n),
    extraction_hash: nthHash(400 + n),
    vitality: 'V1_VITAL',
    review_depth: 'FULL',
    batch_index: 0,
    ...overrides,
  };
}

export function buildEvidencePackage(overrides = {}) {
  const memberRefs = overrides.member_refs || [buildMemberRef(1)];
  return {
    package_id: nthUuid(1),
    package_hash: nthHash(1),
    snapshot_id: nthUuid(2),
    document_manifest_hash: nthHash(2),
    semantic_manifest_hash: nthHash(3),
    member_count: memberRefs.length,
    mandatory_member_count: memberRefs.length,
    batch_count: 1,
    batch_size: memberRefs.length,
    inventory_cutoff_at: CUTOFF_AT,
    ...overrides,
    member_refs: memberRefs,
  };
}

export function buildSourceRef(member, overrides = {}) {
  return {
    source_type: 'OFFICIAL_PROCESS_DOCUMENT',
    source_id: `SRC-${member.document_id}`,
    source_hash: member.content_hash,
    document_id: member.document_id,
    chunk_id: null,
    unit_hash: null,
    locator: 'pliego.pdf#p1',
    retrieved_at: CUTOFF_AT,
    officiality_status: 'VERIFIED_OFFICIAL',
    ...overrides,
  };
}

export function buildCalculation(overrides = {}) {
  return {
    formula_id: 'formula-working-capital',
    formula_version: '1.0.0',
    expression: 'a - b',
    inputs: [
      { name: 'a', value: 100, unit: 'COP', source_claim_id: 'CLM-CALC-INPUT-A' },
    ],
    result: 100,
    unit: 'COP',
    rounding_rule: 'HALF_UP',
    ...overrides,
  };
}

export function buildCitedFactClaim(claimId, member, overrides = {}) {
  return {
    claim_id: claimId,
    claim_type: 'cited_fact',
    display_text: `Cited fact for ${claimId}`,
    materiality: 'MATERIAL',
    publish: true,
    evidence_status: 'SUPPORTED',
    source_refs: [buildSourceRef(member)],
    calculation: null,
    inference_basis: null,
    decision_ref: null,
    created_by: 'AGT-002',
    created_at: T0,
    ...overrides,
  };
}

export function buildCalculationClaim(claimId, member, overrides = {}) {
  return {
    claim_id: claimId,
    claim_type: 'reproducible_calculation',
    display_text: `Calculation for ${claimId}`,
    materiality: 'SUPPORTING',
    publish: true,
    evidence_status: 'SUPPORTED',
    source_refs: [buildSourceRef(member)],
    calculation: buildCalculation(),
    inference_basis: null,
    decision_ref: null,
    created_by: 'AGT-002',
    created_at: T0,
    ...overrides,
  };
}

export function buildInferenceClaim(claimId, overrides = {}) {
  return {
    claim_id: claimId,
    claim_type: 'marked_inference',
    display_text: `Inference for ${claimId}`,
    materiality: 'SUPPORTING',
    publish: true,
    evidence_status: 'INFERRED',
    source_refs: [],
    calculation: null,
    inference_basis: 'Inferred from the absence of a contrary clause in the current rules.',
    decision_ref: null,
    created_by: 'AGT-002',
    created_at: T0,
    ...overrides,
  };
}

export function buildEvidenceAbsentClaim(claimId, overrides = {}) {
  return {
    claim_id: claimId,
    claim_type: 'evidence_absent',
    display_text: `No evidence found for ${claimId}`,
    materiality: 'SUPPORTING',
    publish: true,
    evidence_status: 'ABSENT',
    source_refs: [],
    calculation: null,
    inference_basis: null,
    decision_ref: null,
    created_by: 'AGT-002',
    created_at: T0,
    ...overrides,
  };
}

export function buildContradictionClaim(claimId, memberA, memberB, overrides = {}) {
  return {
    claim_id: claimId,
    claim_type: 'contradiction',
    display_text: `Contradiction for ${claimId}`,
    materiality: 'MATERIAL',
    publish: true,
    evidence_status: 'CONTRADICTED',
    source_refs: [buildSourceRef(memberA), buildSourceRef(memberB)],
    calculation: null,
    inference_basis: null,
    decision_ref: null,
    created_by: 'AGT-002',
    created_at: T0,
    ...overrides,
  };
}

export function buildHumanDecisionClaim(claimId, decisionRef, overrides = {}) {
  return {
    claim_id: claimId,
    claim_type: 'human_decision',
    display_text: `Human decision for ${claimId}`,
    materiality: 'MATERIAL',
    publish: true,
    evidence_status: 'SUPPORTED',
    source_refs: [],
    calculation: null,
    inference_basis: null,
    decision_ref: decisionRef,
    created_by: 'HUMAN',
    created_at: T0,
    ...overrides,
  };
}

export const COVERAGE_BLOCKS = Object.freeze([
  'CURRENT_RULES',
  'TECHNICAL_OPERATIONAL_SCOPE',
  'LEGAL_ELIGIBILITY',
  'EXPERIENCE_FINANCIAL_CAPACITY',
  'ECONOMIC_VIABILITY',
  'CONTRACT_RISK',
  'TIMELINE_FEASIBILITY',
]);

function buildCoverageEntry(block, overrides = {}) {
  return {
    block,
    status: 'COVERED',
    critical: false,
    document_ids: [],
    claim_ids: [],
    gap_reason: null,
    reincorporation_condition: null,
    ...overrides,
  };
}

export function buildCoverage(overridesByBlock = {}) {
  return COVERAGE_BLOCKS.map((block) => buildCoverageEntry(block, overridesByBlock[block] || {}));
}

function buildCheck(n, overrides = {}) {
  const num = String(n).padStart(2, '0');
  return {
    catalog_version: 'methodology-v1.1-checks-v1',
    check_id: `CHECK-${num}`,
    catalog_number: n,
    modality: 'AUTOMATED',
    roles: ['AGT-002'],
    applicability: 'APPLICABLE',
    applicability_reason: null,
    evidence_claim_ids: [],
    execution_status: 'EXECUTED',
    result: 'PASS',
    calculation_claim_id: null,
    executed_at: T0,
    ...overrides,
  };
}

export function buildChecks(overridesByNumber = {}) {
  return Array.from({ length: 22 }, (_, i) => buildCheck(i + 1, overridesByNumber[i + 1] || {}));
}

export function buildRecommendation(overrides = {}) {
  return {
    kind: 'CONTINUE_RECOMMENDED',
    label: 'Continue',
    basis_claim_ids: [],
    blocker_finding_ids: [],
    condition_open_item_ids: [],
    confidence: 'HIGH',
    limitations: [],
    ...overrides,
  };
}

export function buildPresentationReadinessNotStarted(overrides = {}) {
  return {
    status: 'NOT_STARTED',
    control_c_status: 'NOT_STARTED',
    control_c_receipt_id: null,
    g3_gate: null,
    blocker_ids: [],
    last_checked_at: null,
    ...overrides,
  };
}

export function buildG3Gate(outcome, overrides = {}) {
  return {
    gate_id: nthUuid(950),
    outcome,
    actor_id: nthUuid(951),
    authority_role: 'G3_AUTHORITY',
    issued_at: T0,
    expires_at: null,
    receipt_id: nthUuid(952),
    ...overrides,
  };
}

export function buildHumanDecision(overrides = {}) {
  return {
    decision_id: nthUuid(960),
    decision: 'CONTINUE',
    decision_status: 'ACTIVE',
    invalidation_event_id: null,
    actor_id: nthUuid(961),
    authority_role: 'DECISION_AUTHORITY',
    decided_at: T0,
    analysis_run_id: RUN_ID,
    analysis_version: 1,
    justification: 'Human reviewed the published analysis and decided to continue.',
    condition_ids: [],
    ...overrides,
  };
}

function buildRenderEntry(projectionType, runId, aggregateVersion, packageHash, cutoffAt, materialClaimIds, overrides = {}) {
  return {
    analysis_run_id: runId,
    aggregate_version: aggregateVersion,
    projection_type: projectionType,
    template_version: 'tmpl-v1',
    package_hash: packageHash,
    cutoff_at: cutoffAt,
    material_claim_ids: materialClaimIds,
    semantic_content_hash: nthHash(900),
    rendered_artifact_hash: nthHash(901),
    rendered_at: T0,
    render_status: 'GENERATED',
    parity_receipt_id: nthUuid(900),
    ...overrides,
  };
}

export function buildRenderManifest(runId, aggregateVersion, packageHash, cutoffAt, materialClaimIds) {
  return [
    buildRenderEntry('CRM', runId, aggregateVersion, packageHash, cutoffAt, materialClaimIds),
    buildRenderEntry('INTERNAL_MATRIX', runId, aggregateVersion, packageHash, cutoffAt, materialClaimIds),
    buildRenderEntry('PDF', runId, aggregateVersion, packageHash, cutoffAt, materialClaimIds),
  ];
}

// Baseline ANALYSIS_PUBLISHED / INITIAL / g1_scope A document. Company fit is
// NOT_AUTHORIZED (scope A never evaluates company fit) and the recommendation
// kind is restricted to the scope-A-permitted set.
export function buildBaselineScopeA(overrides = {}) {
  const member = buildMemberRef(1);
  const evidencePackage = buildEvidencePackage({ member_refs: [member] });
  const claims = [buildCitedFactClaim('CLM-001', member)];
  const checks = buildChecks();
  const coverage = buildCoverage();
  const recommendation = buildRecommendation({
    kind: 'HOLD_RECOMMENDED',
    basis_claim_ids: ['CLM-001'],
    confidence: 'MEDIUM',
  });
  const renderManifest = buildRenderManifest(RUN_ID, 1, evidencePackage.package_hash, evidencePackage.inventory_cutoff_at, ['CLM-001']);

  return {
    meta: {
      schema_version: 'pre_go_analysis.v1',
      aggregate_version: 1,
      aggregate_stage: 'ANALYSIS_PUBLISHED',
      analysis_core_hash: nthHash(5),
      analysis_run_id: RUN_ID,
      analysis_kind: 'INITIAL',
      analysis_version: 1,
      source_analysis_run_id: null,
      legacy_lineage_refs: [],
      opportunity_id: nthUuid(20),
      tender_id: nthUuid(21),
      package_id: evidencePackage.package_id,
      package_hash: evidencePackage.package_hash,
      snapshot_id: evidencePackage.snapshot_id,
      g1_authorization_id: nthUuid(22),
      g1_scope: 'A',
      policy_version: 'policy-v1',
      check_catalog_version: 'methodology-v1.1-checks-v1',
      executor_version: 'executor-v1',
      model_profile_id: 'model-v1',
      cutoff_at: evidencePackage.inventory_cutoff_at,
      created_at: T0,
      completed_at: T0,
      process_deadlines: [],
    },
    evidence_package: evidencePackage,
    claims,
    process_analysis: {
      status: 'COMPLETE',
      summary_claim_ids: ['CLM-001'],
      process_identity_claim_ids: [],
      technical_scope_claim_ids: [],
      legal_claim_ids: [],
      economic_claim_ids: [],
      contract_risk_claim_ids: [],
      timeline_claim_ids: [],
      market_claim_ids: [],
      observation_candidate_ids: [],
    },
    company_fit: {
      status: 'NOT_AUTHORIZED',
      profile_snapshot_id: null,
      profile_snapshot_hash: null,
      overall_label: 'NOT_AUTHORIZED',
      requirement_ids: [],
      limitation_claim_ids: [],
    },
    requirements: [],
    findings: [],
    checks,
    contradictions: [],
    coverage,
    recommendation,
    open_items: [],
    human_decision: null,
    presentation_readiness: buildPresentationReadinessNotStarted(),
    render_manifest: renderManifest,
    ...overrides,
  };
}

// Baseline ANALYSIS_PUBLISHED / INITIAL / g1_scope A_PLUS_B document. Company
// fit is EVALUATED with a profile snapshot.
export function buildBaselineScopeAPlusB(overrides = {}) {
  const base = buildBaselineScopeA();
  return {
    ...base,
    meta: { ...base.meta, g1_scope: 'A_PLUS_B' },
    company_fit: {
      status: 'EVALUATED',
      profile_snapshot_id: nthUuid(30),
      profile_snapshot_hash: nthHash(30),
      overall_label: 'PARTIAL_NOT_READY',
      requirement_ids: [],
      limitation_claim_ids: [],
    },
    ...overrides,
  };
}

// A REANALYSIS run of scope A_PLUS_B, still at ANALYSIS_PUBLISHED (aggregate
// version 1) but analysis_version 2 with a source_analysis_run_id.
export function buildReanalysisScopeAPlusB(overrides = {}) {
  const base = buildBaselineScopeAPlusB();
  return {
    ...base,
    meta: {
      ...base.meta,
      analysis_kind: 'REANALYSIS',
      analysis_version: 2,
      source_analysis_run_id: nthUuid(11),
    },
    ...overrides,
  };
}

function withStageAndDecision(base, { aggregateStage, aggregateVersion, humanDecision, presentationReadiness }) {
  const materialClaimIds = base.render_manifest[0].material_claim_ids;
  return {
    ...base,
    meta: { ...base.meta, aggregate_stage: aggregateStage, aggregate_version: aggregateVersion },
    human_decision: humanDecision,
    presentation_readiness: presentationReadiness,
    render_manifest: buildRenderManifest(
      base.meta.analysis_run_id, aggregateVersion, base.meta.package_hash, base.meta.cutoff_at, materialClaimIds,
    ),
  };
}

// G2_RECORDED, decision CONTINUE, presentation IN_PREPARATION.
export function buildG2RecordedInPreparation(overrides = {}) {
  const base = buildBaselineScopeAPlusB();
  const doc = withStageAndDecision(base, {
    aggregateStage: 'G2_RECORDED',
    aggregateVersion: 2,
    humanDecision: buildHumanDecision({ decision: 'CONTINUE', decision_status: 'ACTIVE', invalidation_event_id: null }),
    presentationReadiness: {
      status: 'IN_PREPARATION',
      control_c_status: 'IN_PROGRESS',
      control_c_receipt_id: null,
      g3_gate: null,
      blocker_ids: [],
      last_checked_at: T0,
    },
  });
  return { ...doc, ...overrides };
}

// G2_RECORDED, decision CONTINUE_CONDITIONAL, presentation IN_PREPARATION_WITH_CONDITIONS.
export function buildG2RecordedInPreparationWithConditions(overrides = {}) {
  const base = buildBaselineScopeAPlusB();
  const doc = withStageAndDecision(base, {
    aggregateStage: 'G2_RECORDED',
    aggregateVersion: 2,
    humanDecision: buildHumanDecision({ decision: 'CONTINUE_CONDITIONAL', decision_status: 'ACTIVE', invalidation_event_id: null }),
    presentationReadiness: {
      status: 'IN_PREPARATION_WITH_CONDITIONS',
      control_c_status: 'IN_PROGRESS',
      control_c_receipt_id: null,
      g3_gate: null,
      blocker_ids: [],
      last_checked_at: T0,
    },
  });
  return { ...doc, ...overrides };
}

// DECISION_INVALIDATED, presentation still NOT_STARTED.
export function buildDecisionInvalidated(overrides = {}) {
  const base = buildBaselineScopeAPlusB();
  const doc = withStageAndDecision(base, {
    aggregateStage: 'DECISION_INVALIDATED',
    aggregateVersion: 3,
    humanDecision: buildHumanDecision({
      decision: 'CONTINUE', decision_status: 'INVALIDATED', invalidation_event_id: nthUuid(970),
    }),
    presentationReadiness: buildPresentationReadinessNotStarted(),
  });
  return { ...doc, ...overrides };
}

// PRESENTATION_STATUS_CHANGED / READY_FOR_G3.
export function buildPresentationReadyForG3(overrides = {}) {
  const base = buildBaselineScopeAPlusB();
  const doc = withStageAndDecision(base, {
    aggregateStage: 'PRESENTATION_STATUS_CHANGED',
    aggregateVersion: 3,
    humanDecision: buildHumanDecision({ decision: 'CONTINUE', decision_status: 'ACTIVE', invalidation_event_id: null }),
    presentationReadiness: {
      status: 'READY_FOR_G3',
      control_c_status: 'READY',
      control_c_receipt_id: nthUuid(980),
      g3_gate: null,
      blocker_ids: [],
      last_checked_at: T0,
    },
  });
  return { ...doc, ...overrides };
}

// PRESENTATION_STATUS_CHANGED / SUBMISSION_AUTHORIZED.
export function buildSubmissionAuthorized(overrides = {}) {
  const base = buildBaselineScopeAPlusB();
  const doc = withStageAndDecision(base, {
    aggregateStage: 'PRESENTATION_STATUS_CHANGED',
    aggregateVersion: 4,
    humanDecision: buildHumanDecision({ decision: 'CONTINUE', decision_status: 'ACTIVE', invalidation_event_id: null }),
    presentationReadiness: {
      status: 'SUBMISSION_AUTHORIZED',
      control_c_status: 'READY',
      control_c_receipt_id: nthUuid(981),
      g3_gate: buildG3Gate('AUTHORIZED'),
      blocker_ids: [],
      last_checked_at: T0,
    },
  });
  return { ...doc, ...overrides };
}

// PRESENTATION_STATUS_CHANGED / SUBMISSION_BLOCKED (branch 1 of the oneOf).
export function buildSubmissionBlockedViaPresentationChange(overrides = {}) {
  const base = buildBaselineScopeAPlusB();
  const doc = withStageAndDecision(base, {
    aggregateStage: 'PRESENTATION_STATUS_CHANGED',
    aggregateVersion: 4,
    humanDecision: buildHumanDecision({ decision: 'CONTINUE', decision_status: 'ACTIVE', invalidation_event_id: null }),
    presentationReadiness: {
      status: 'SUBMISSION_BLOCKED',
      control_c_status: 'BLOCKED',
      control_c_receipt_id: nthUuid(982),
      g3_gate: buildG3Gate('BLOCKED'),
      blocker_ids: ['OI-BLOCKER-0001'],
      last_checked_at: T0,
    },
  });
  doc.open_items = [{
    open_item_id: 'OI-BLOCKER-0001',
    kind: 'CONDITION',
    description: 'Outstanding condition blocking submission.',
    critical: true,
    owner_role: null,
    due_at: null,
    status: 'OPEN',
    claim_ids: [],
  }];
  return { ...doc, ...overrides };
}

// DECISION_INVALIDATED / SUBMISSION_BLOCKED (branch 2 of the oneOf).
export function buildSubmissionBlockedViaDecisionInvalidated(overrides = {}) {
  const base = buildBaselineScopeAPlusB();
  const doc = withStageAndDecision(base, {
    aggregateStage: 'DECISION_INVALIDATED',
    aggregateVersion: 5,
    humanDecision: buildHumanDecision({
      decision: 'CONTINUE', decision_status: 'INVALIDATED', invalidation_event_id: nthUuid(971),
    }),
    presentationReadiness: {
      status: 'SUBMISSION_BLOCKED',
      control_c_status: 'SUPERSEDED',
      control_c_receipt_id: nthUuid(983),
      g3_gate: buildG3Gate('REVOKED'),
      blocker_ids: ['OI-BLOCKER-0002'],
      last_checked_at: T0,
    },
  });
  doc.open_items = [{
    open_item_id: 'OI-BLOCKER-0002',
    kind: 'CONDITION',
    description: 'Outstanding condition blocking submission.',
    critical: true,
    owner_role: null,
    due_at: null,
    status: 'OPEN',
    claim_ids: [],
  }];
  return { ...doc, ...overrides };
}
