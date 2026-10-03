// AGT-002 P0-01 — TDD RED phase for the `pre_go_analysis.v1` validator/builder
// contract.
//
// The schema under test, schemas/agt002/pre_go_analysis.v1.schema.json, is the
// approved immutable artifact (SHA-256
// a53cac700826968ef4da71b3f4b6866db9553126078879540f6c2e28f6f9edf1) and MUST
// NOT be edited by this suite or by the future implementation.
//
// Loading this file throws (ERR_MODULE_NOT_FOUND) until a future step authors
// `agt002-pre-go-analysis-v1.js` at the repo root, exporting at least:
//   - validatePreGoAnalysisV1(value, context?) -> { ok, errors }, never throws
//     on a validation failure (only on a malformed call, e.g. a non-object
//     value, is a throw acceptable — every fixture below is always a plain
//     object).
//   - AGT002_PRE_GO_ANALYSIS_V1_ERROR_CODES: the closed, frozen array of every
//     error code the validator can emit.
// This is the intended external RED for this step. No implementation module,
// and no other fixture beyond tests/fixtures/agt002-pre-go-analysis-v1.mjs, is
// authored by this step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  validatePreGoAnalysisV1,
  AGT002_PRE_GO_ANALYSIS_V1_ERROR_CODES,
} from '../agt002-pre-go-analysis-v1.js';

import {
  T0,
  nthUuid,
  nthHash,
  buildMemberRef,
  buildSourceRef,
  buildCalculationClaim,
  buildInferenceClaim,
  buildEvidenceAbsentClaim,
  buildContradictionClaim,
  buildHumanDecisionClaim,
  COVERAGE_BLOCKS,
  buildHumanDecision,
  buildG3Gate,
  buildBaselineScopeA,
  buildBaselineScopeAPlusB,
  buildReanalysisScopeAPlusB,
  buildG2RecordedInPreparation,
  buildG2RecordedInPreparationWithConditions,
  buildDecisionInvalidated,
  buildPresentationReadyForG3,
  buildSubmissionAuthorized,
  buildSubmissionBlockedViaPresentationChange,
  buildSubmissionBlockedViaDecisionInvalidated,
} from './fixtures/agt002-pre-go-analysis-v1.mjs';

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'schemas',
  'agt002',
  'pre_go_analysis.v1.schema.json',
);
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

function clone(value) {
  return structuredClone(value);
}

function codesOf(errors) {
  return errors.map((e) => e.code);
}

function assertInvalid(value, expectedCodes = []) {
  const result = validatePreGoAnalysisV1(value);
  assert.equal(result.ok, false, 'expected validation to fail');
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, 'expected a non-empty errors array');
  assertClosedCodes(result.errors);
  const codes = codesOf(result.errors);
  for (const expected of expectedCodes) {
    assert.ok(codes.includes(expected), `expected error code "${expected}", got ${JSON.stringify(codes)}`);
  }
  return result;
}

function assertValid(value) {
  const result = validatePreGoAnalysisV1(value);
  assert.equal(result.ok, true, `expected validation to pass: ${JSON.stringify(result.errors)}`);
  assert.deepEqual(result.errors, []);
  return result;
}

function assertClosedCodes(errors) {
  const catalog = new Set(AGT002_PRE_GO_ANALYSIS_V1_ERROR_CODES);
  for (const error of errors) {
    assert.ok(typeof error.path === 'string', 'every error must carry a string path');
    assert.ok(typeof error.code === 'string', 'every error must carry a string code');
    assert.ok(catalog.has(error.code), `error code "${error.code}" is not part of the closed catalog`);
  }
}

// ---------------------------------------------------------------------------
// Group 1 — schema identity & Draft 2020-12 compilation
// ---------------------------------------------------------------------------

test('schema: pinned $id, $schema Draft 2020-12, and title', () => {
  assert.equal(SCHEMA.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(SCHEMA.$id, 'https://premiumsecurity.ai/schemas/agt002/pre_go_analysis.v1.schema.json');
  assert.equal(SCHEMA.title, 'AGT-002 pre_go_analysis.v1');
});

test('schema compiles: validator loads the immutable schema and evaluates an empty object without throwing', () => {
  const result = validatePreGoAnalysisV1({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assertClosedCodes(result.errors);
});

test('error codes catalog is exported frozen, non-empty, and duplicate-free', () => {
  assert.ok(Array.isArray(AGT002_PRE_GO_ANALYSIS_V1_ERROR_CODES));
  assert.ok(Object.isFrozen(AGT002_PRE_GO_ANALYSIS_V1_ERROR_CODES));
  assert.ok(AGT002_PRE_GO_ANALYSIS_V1_ERROR_CODES.length > 0);
  assert.equal(new Set(AGT002_PRE_GO_ANALYSIS_V1_ERROR_CODES).size, AGT002_PRE_GO_ANALYSIS_V1_ERROR_CODES.length);
});

// ---------------------------------------------------------------------------
// Group 2 — valid fixtures across scopes and lifecycle stages
// ---------------------------------------------------------------------------

test('valid fixture: ANALYSIS_PUBLISHED / INITIAL / scope A', () => {
  assertValid(buildBaselineScopeA());
});

test('valid fixture: ANALYSIS_PUBLISHED / INITIAL / scope A_PLUS_B', () => {
  assertValid(buildBaselineScopeAPlusB());
});

test('valid fixture: ANALYSIS_PUBLISHED / REANALYSIS / scope A_PLUS_B (analysis_version 2)', () => {
  assertValid(buildReanalysisScopeAPlusB());
});

test('valid fixture: G2_RECORDED / IN_PREPARATION / decision CONTINUE', () => {
  assertValid(buildG2RecordedInPreparation());
});

test('valid fixture: G2_RECORDED / IN_PREPARATION_WITH_CONDITIONS / decision CONTINUE_CONDITIONAL', () => {
  assertValid(buildG2RecordedInPreparationWithConditions());
});

test('valid fixture: DECISION_INVALIDATED / presentation NOT_STARTED', () => {
  assertValid(buildDecisionInvalidated());
});

test('valid fixture: PRESENTATION_STATUS_CHANGED / READY_FOR_G3', () => {
  assertValid(buildPresentationReadyForG3());
});

test('valid fixture: PRESENTATION_STATUS_CHANGED / SUBMISSION_AUTHORIZED', () => {
  assertValid(buildSubmissionAuthorized());
});

test('valid fixture: PRESENTATION_STATUS_CHANGED / SUBMISSION_BLOCKED (oneOf branch 1)', () => {
  assertValid(buildSubmissionBlockedViaPresentationChange());
});

test('valid fixture: DECISION_INVALIDATED / SUBMISSION_BLOCKED (oneOf branch 2)', () => {
  assertValid(buildSubmissionBlockedViaDecisionInvalidated());
});

// ---------------------------------------------------------------------------
// Group 3 — unknown properties rejected recursively
// ---------------------------------------------------------------------------

test('unknown properties: rejected at the document root', () => {
  const doc = clone(buildBaselineScopeA());
  doc.unexpected_root_field = 'nope';
  assertInvalid(doc, ['schema.additional_property']);
});

test('unknown properties: rejected inside meta', () => {
  const doc = clone(buildBaselineScopeA());
  doc.meta.unexpected = 'nope';
  assertInvalid(doc, ['schema.additional_property']);
});

test('unknown properties: rejected inside evidence_package and its member_refs items', () => {
  const doc = clone(buildBaselineScopeA());
  doc.evidence_package.unexpected = 'nope';
  assertInvalid(doc, ['schema.additional_property']);

  const doc2 = clone(buildBaselineScopeA());
  doc2.evidence_package.member_refs[0].unexpected = 'nope';
  assertInvalid(doc2, ['schema.additional_property']);
});

test('unknown properties: rejected inside a claim and inside a claim source_ref', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims[0].unexpected = 'nope';
  assertInvalid(doc, ['schema.additional_property']);

  const doc2 = clone(buildBaselineScopeA());
  doc2.claims[0].source_refs[0].unexpected = 'nope';
  assertInvalid(doc2, ['schema.additional_property']);
});

test('unknown properties: rejected inside a check, a coverage entry, and a render entry', () => {
  const doc = clone(buildBaselineScopeA());
  doc.checks[0].unexpected = 'nope';
  assertInvalid(doc, ['schema.additional_property']);

  const doc2 = clone(buildBaselineScopeA());
  doc2.coverage[0].unexpected = 'nope';
  assertInvalid(doc2, ['schema.additional_property']);

  const doc3 = clone(buildBaselineScopeA());
  doc3.render_manifest[0].unexpected = 'nope';
  assertInvalid(doc3, ['schema.additional_property']);
});

test('unknown properties: rejected inside human_decision and presentation_readiness', () => {
  const doc = clone(buildG2RecordedInPreparation());
  doc.human_decision.unexpected = 'nope';
  assertInvalid(doc, ['schema.additional_property']);

  const doc2 = clone(buildG2RecordedInPreparation());
  doc2.presentation_readiness.unexpected = 'nope';
  assertInvalid(doc2, ['schema.additional_property']);
});

// ---------------------------------------------------------------------------
// Group 4 — claim rules per claim_type
// ---------------------------------------------------------------------------

test('claim rule: cited_fact requires at least one source_ref', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims[0].source_refs = [];
  assertInvalid(doc, ['schema.min_items']);
});

test('claim rule: reproducible_calculation requires a calculation object and at least one source_ref', () => {
  const member = buildMemberRef(1);
  const doc = clone(buildBaselineScopeA());
  const calcClaim = buildCalculationClaim('CLM-CALC-001', member, { calculation: null, source_refs: [] });
  doc.claims.push(calcClaim);
  assertInvalid(doc);

  const doc2 = clone(buildBaselineScopeA());
  doc2.claims.push(buildCalculationClaim('CLM-CALC-002', member));
  assertValid(doc2);
});

test('claim rule: marked_inference requires non-empty inference_basis and evidence_status INFERRED', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims.push(buildInferenceClaim('CLM-INF-001', { inference_basis: null }));
  assertInvalid(doc);

  const doc2 = clone(buildBaselineScopeA());
  doc2.claims.push(buildInferenceClaim('CLM-INF-002', { evidence_status: 'SUPPORTED' }));
  assertInvalid(doc2, ['schema.const_mismatch']);

  const doc3 = clone(buildBaselineScopeA());
  doc3.claims.push(buildInferenceClaim('CLM-INF-003'));
  assertValid(doc3);
});

test('claim rule: evidence_absent requires evidence_status ABSENT', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims.push(buildEvidenceAbsentClaim('CLM-ABS-001', { evidence_status: 'SUPPORTED' }));
  assertInvalid(doc, ['schema.const_mismatch']);

  const doc2 = clone(buildBaselineScopeA());
  doc2.claims.push(buildEvidenceAbsentClaim('CLM-ABS-002'));
  assertValid(doc2);
});

test('claim rule: contradiction requires at least two source_refs and evidence_status CONTRADICTED', () => {
  const memberA = buildMemberRef(1);
  const memberB = buildMemberRef(2);
  const doc = clone(buildBaselineScopeA());
  doc.evidence_package.member_refs.push(memberB);
  doc.evidence_package.member_count = 2;
  doc.evidence_package.mandatory_member_count = 2;
  doc.claims.push(buildContradictionClaim('CLM-CONTRA-001', memberA, memberB, { source_refs: [buildSourceRef(memberA)] }));
  assertInvalid(doc, ['schema.min_items']);

  const doc2 = clone(doc);
  doc2.claims[doc2.claims.length - 1] = buildContradictionClaim('CLM-CONTRA-001', memberA, memberB);
  assertValid(doc2);
});

test('claim rule: human_decision claim requires decision_ref and created_by HUMAN', () => {
  const doc = clone(buildG2RecordedInPreparation());
  doc.claims.push(buildHumanDecisionClaim('CLM-HUMAN-001', null));
  assertInvalid(doc);

  const doc2 = clone(buildG2RecordedInPreparation());
  doc2.claims.push(buildHumanDecisionClaim('CLM-HUMAN-002', doc2.human_decision.decision_id, { created_by: 'AGT-002' }));
  assertInvalid(doc2, ['schema.const_mismatch']);

  const doc3 = clone(buildG2RecordedInPreparation());
  doc3.claims.push(buildHumanDecisionClaim('CLM-HUMAN-003', doc3.human_decision.decision_id));
  assertValid(doc3);
});

test('claim rule: claim_id not matching CLM- prefix pattern is rejected', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims[0].claim_id = 'BAD-001';
  doc.process_analysis.summary_claim_ids = ['BAD-001'];
  doc.recommendation.basis_claim_ids = ['BAD-001'];
  assertInvalid(doc, ['schema.pattern_mismatch']);
});

// ---------------------------------------------------------------------------
// Group 5 — INITIAL vs REANALYSIS source/version rules
// ---------------------------------------------------------------------------

test('analysis_kind INITIAL requires source_analysis_run_id null and analysis_version 1', () => {
  const doc = clone(buildBaselineScopeA());
  doc.meta.source_analysis_run_id = nthUuid(999);
  assertInvalid(doc);

  const doc2 = clone(buildBaselineScopeA());
  doc2.meta.analysis_version = 2;
  assertInvalid(doc2, ['schema.const_mismatch']);
});

test('analysis_kind REANALYSIS requires a uuid source_analysis_run_id and analysis_version >= 2', () => {
  const doc = clone(buildReanalysisScopeAPlusB());
  doc.meta.source_analysis_run_id = null;
  assertInvalid(doc);

  const doc2 = clone(buildReanalysisScopeAPlusB());
  doc2.meta.analysis_version = 1;
  assertInvalid(doc2, ['schema.minimum']);

  const doc3 = clone(buildReanalysisScopeAPlusB());
  doc3.meta.source_analysis_run_id = 'not-a-uuid';
  assertInvalid(doc3);
});

// ---------------------------------------------------------------------------
// Group 6 — exactly 22 checks, catalog_number uniqueness and coverage
// ---------------------------------------------------------------------------

test('checks: exactly 22 checks with catalog_number 1..22, each used exactly once', () => {
  const doc = clone(buildBaselineScopeA());
  doc.checks[0].catalog_number = doc.checks[1].catalog_number;
  assertInvalid(doc, ['checks.catalog_number_duplicate']);
});

test('checks: catalog_number 1..22 must all be present (none skipped)', () => {
  const doc = clone(buildBaselineScopeA());
  doc.checks[0].catalog_number = 2;
  assertInvalid(doc, ['checks.catalog_number_duplicate', 'checks.catalog_number_missing']);
});

test('checks: check_id numeric suffix must match catalog_number', () => {
  const doc = clone(buildBaselineScopeA());
  doc.checks[0].check_id = 'CHECK-02';
  assertInvalid(doc, ['checks.id_number_mismatch']);
});

test('checks: NOT_APPLICABLE check requires result NO_APLICA and a non-empty applicability_reason', () => {
  const doc = clone(buildBaselineScopeA());
  doc.checks[0].applicability = 'NOT_APPLICABLE';
  doc.checks[0].result = 'NO_APLICA';
  doc.checks[0].applicability_reason = 'Not applicable to this process.';
  assertValid(doc);
});

test('coverage: exactly the 7 distinct blocks, none duplicated or missing', () => {
  const doc = clone(buildBaselineScopeA());
  doc.coverage[0].block = doc.coverage[1].block;
  assertInvalid(doc, ['coverage.block_duplicate', 'coverage.block_missing']);
});

test('coverage: NOT_APPLICABLE_WITH_REASON requires a non-null gap_reason', () => {
  const doc = clone(buildBaselineScopeA());
  doc.coverage[0].status = 'NOT_APPLICABLE_WITH_REASON';
  doc.coverage[0].gap_reason = null;
  assertInvalid(doc, ['coverage.not_applicable_reason_missing']);

  const doc2 = clone(buildBaselineScopeA());
  doc2.coverage[0].status = 'NOT_APPLICABLE_WITH_REASON';
  doc2.coverage[0].gap_reason = 'Not part of this contracting modality.';
  assertValid(doc2);
});

// ---------------------------------------------------------------------------
// Group 7 — referenced IDs must exist
// ---------------------------------------------------------------------------

test('reference integrity: process_analysis / recommendation / coverage claim_ids must reference existing claims', () => {
  const doc = clone(buildBaselineScopeA());
  doc.recommendation.basis_claim_ids = ['CLM-DOES-NOT-EXIST'];
  assertInvalid(doc, ['reference.claim_id_not_found']);
});

test('reference integrity: company_fit.requirement_ids must reference existing requirements', () => {
  const doc = clone(buildBaselineScopeAPlusB());
  doc.company_fit.requirement_ids = ['REQ-DOES-NOT-EXIST'];
  assertInvalid(doc, ['reference.requirement_id_not_found']);
});

test('reference integrity: recommendation.blocker_finding_ids must reference existing findings', () => {
  const doc = clone(buildBaselineScopeA());
  doc.recommendation.blocker_finding_ids = ['FND-DOES-NOT-EXIST'];
  assertInvalid(doc, ['reference.finding_id_not_found']);
});

test('reference integrity: recommendation.condition_open_item_ids must reference existing open_items', () => {
  const doc = clone(buildBaselineScopeA());
  doc.recommendation.kind = 'CONTINUE_CONDITIONAL_RECOMMENDED';
  doc.recommendation.condition_open_item_ids = ['OI-DOES-NOT-EXIST'];
  assertInvalid(doc, ['reference.open_item_id_not_found']);
});

// ---------------------------------------------------------------------------
// Group 8 — source refs point to package members; hash/cutoff constraints
// ---------------------------------------------------------------------------

test('source_ref: document_id must reference an evidence_package member', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims[0].source_refs[0].document_id = nthUuid(12345);
  assertInvalid(doc, ['source_ref.member_not_found']);
});

test('source_ref: source_hash must match the referenced member content or extraction hash', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims[0].source_refs[0].source_hash = nthHash(99999);
  assertInvalid(doc, ['source_ref.hash_mismatch']);
});

test('source_ref: retrieved_at must not be after meta.cutoff_at', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims[0].source_refs[0].retrieved_at = '2099-01-01T00:00:00Z';
  assertInvalid(doc, ['source_ref.retrieved_after_cutoff']);
});

test('meta/evidence_package: package_id, package_hash, snapshot_id and cutoff_at must be consistent', () => {
  const doc = clone(buildBaselineScopeA());
  doc.meta.package_hash = nthHash(424242);
  assertInvalid(doc, ['meta.package_hash_mismatch']);

  const doc2 = clone(buildBaselineScopeA());
  doc2.meta.package_id = nthUuid(424242);
  assertInvalid(doc2, ['meta.package_id_mismatch']);

  const doc3 = clone(buildBaselineScopeA());
  doc3.meta.snapshot_id = nthUuid(424243);
  assertInvalid(doc3, ['meta.snapshot_id_mismatch']);

  const doc4 = clone(buildBaselineScopeA());
  doc4.meta.cutoff_at = '2020-01-01T00:00:00Z';
  assertInvalid(doc4, ['meta.cutoff_mismatch']);
});

// ---------------------------------------------------------------------------
// Group 9 — scope A cannot evaluate company fit; recommendation constrained
// ---------------------------------------------------------------------------

test('scope A: company_fit must be NOT_AUTHORIZED with null profile snapshot fields', () => {
  const doc = clone(buildBaselineScopeA());
  doc.company_fit.status = 'EVALUATED';
  doc.company_fit.overall_label = 'APTO';
  doc.company_fit.profile_snapshot_id = nthUuid(55);
  doc.company_fit.profile_snapshot_hash = nthHash(55);
  assertInvalid(doc, ['schema.const_mismatch']);
});

test('scope A: recommendation.kind is restricted to HOLD_RECOMMENDED / NO_GO_RECOMMENDED / INSUFFICIENT_INFORMATION', () => {
  const doc = clone(buildBaselineScopeA());
  doc.recommendation.kind = 'CONTINUE_RECOMMENDED';
  assertInvalid(doc, ['schema.enum_mismatch']);

  for (const kind of ['HOLD_RECOMMENDED', 'NO_GO_RECOMMENDED', 'INSUFFICIENT_INFORMATION']) {
    const valid = clone(buildBaselineScopeA());
    valid.recommendation.kind = kind;
    if (kind === 'NO_GO_RECOMMENDED') {
      valid.findings.push({
        finding_id: 'FND-001', severity: 'CRITICAL', category: 'legal', title: 'Blocking finding',
        claim_ids: ['CLM-001'], impact: 'Cannot participate.', blocker: true,
      });
      valid.recommendation.blocker_finding_ids = ['FND-001'];
    }
    assertValid(valid);
  }
});

// ---------------------------------------------------------------------------
// Group 10 — scope A_PLUS_B requires profile snapshot
// ---------------------------------------------------------------------------

test('scope A_PLUS_B: company_fit.status must be EVALUATED with non-null profile snapshot id/hash', () => {
  const doc = clone(buildBaselineScopeAPlusB());
  doc.company_fit.status = 'NOT_AUTHORIZED';
  doc.company_fit.profile_snapshot_id = null;
  doc.company_fit.profile_snapshot_hash = null;
  assertInvalid(doc, ['schema.const_mismatch']);

  const doc2 = clone(buildBaselineScopeAPlusB());
  doc2.company_fit.profile_snapshot_id = null;
  assertInvalid(doc2);
});

// ---------------------------------------------------------------------------
// Group 11 — ANALYSIS_PUBLISHED is aggregate_version 1 with null human_decision
// ---------------------------------------------------------------------------

test('ANALYSIS_PUBLISHED requires aggregate_version 1 and null human_decision', () => {
  const doc = clone(buildBaselineScopeA());
  doc.meta.aggregate_version = 2;
  assertInvalid(doc, ['schema.const_mismatch']);

  const doc2 = clone(buildBaselineScopeA());
  doc2.human_decision = buildHumanDecision();
  assertInvalid(doc2, ['schema.type_mismatch']);
});

// ---------------------------------------------------------------------------
// Group 12 — G2/invalidation/presentation aggregate_version and decision status
// ---------------------------------------------------------------------------

test('G2_RECORDED / DECISION_INVALIDATED / PRESENTATION_STATUS_CHANGED require aggregate_version >= 2 and a human_decision object', () => {
  const doc = clone(buildG2RecordedInPreparation());
  doc.meta.aggregate_version = 1;
  assertInvalid(doc, ['schema.minimum']);

  const doc2 = clone(buildG2RecordedInPreparation());
  doc2.human_decision = null;
  assertInvalid(doc2, ['schema.type_mismatch']);
});

test('G2_RECORDED and PRESENTATION_STATUS_CHANGED require decision_status ACTIVE and null invalidation_event_id', () => {
  const doc = clone(buildG2RecordedInPreparation());
  doc.human_decision.decision_status = 'INVALIDATED';
  doc.human_decision.invalidation_event_id = nthUuid(88);
  assertInvalid(doc, ['schema.const_mismatch']);
});

test('DECISION_INVALIDATED requires decision_status INVALIDATED and a uuid invalidation_event_id', () => {
  const doc = clone(buildDecisionInvalidated());
  doc.human_decision.decision_status = 'ACTIVE';
  doc.human_decision.invalidation_event_id = null;
  assertInvalid(doc, ['schema.const_mismatch']);
});

test('human_decision.analysis_run_id must match meta.analysis_run_id', () => {
  const doc = clone(buildG2RecordedInPreparation());
  doc.human_decision.analysis_run_id = nthUuid(77777);
  assertInvalid(doc, ['human_decision.analysis_run_id_mismatch']);
});

// ---------------------------------------------------------------------------
// Group 13 — three distinct renders, tied to run/version/package/cutoff and
// material claims
// ---------------------------------------------------------------------------

test('render_manifest: exactly one CRM, one INTERNAL_MATRIX and one PDF entry', () => {
  const doc = clone(buildBaselineScopeA());
  doc.render_manifest[2].projection_type = 'CRM';
  assertInvalid(doc);
});

test('render_manifest: every entry must share analysis_run_id, aggregate_version, package_hash and cutoff_at', () => {
  const doc = clone(buildBaselineScopeA());
  doc.render_manifest[0].analysis_run_id = nthUuid(6001);
  assertInvalid(doc, ['render.run_id_mismatch']);

  const doc2 = clone(buildBaselineScopeA());
  doc2.render_manifest[0].aggregate_version = 99;
  assertInvalid(doc2, ['render.version_mismatch']);

  const doc3 = clone(buildBaselineScopeA());
  doc3.render_manifest[0].package_hash = nthHash(6002);
  assertInvalid(doc3, ['render.package_hash_mismatch']);

  const doc4 = clone(buildBaselineScopeA());
  doc4.render_manifest[0].cutoff_at = '2099-01-01T00:00:00Z';
  assertInvalid(doc4, ['render.cutoff_mismatch']);
});

test('render_manifest: all three entries must carry the same material_claim_ids', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims.push(buildCalculationClaim('CLM-EXTRA-MATERIAL', buildMemberRef(1), { materiality: 'MATERIAL' }));
  doc.render_manifest[0].material_claim_ids = ['CLM-001', 'CLM-EXTRA-MATERIAL'];
  assertInvalid(doc, ['render.material_claim_ids_mismatch']);
});

test('render_manifest: material_claim_ids must reference existing claims marked MATERIAL', () => {
  const doc = clone(buildBaselineScopeA());
  doc.render_manifest[0].material_claim_ids = ['CLM-DOES-NOT-EXIST'];
  assertInvalid(doc, ['render.material_claim_not_found']);

  const member = buildMemberRef(1);
  const doc2 = clone(buildBaselineScopeA());
  doc2.claims.push(buildInferenceClaim('CLM-SUPPORTING-001', { materiality: 'SUPPORTING' }));
  doc2.render_manifest[0].material_claim_ids = ['CLM-SUPPORTING-001'];
  assertInvalid(doc2, ['render.material_claim_not_material']);
});

// ---------------------------------------------------------------------------
// Group 14 — Control C / G3 / presentation_readiness status & blocker semantics
// ---------------------------------------------------------------------------

test('presentation_readiness NOT_STARTED pins control_c_status NOT_STARTED and null receipt/gate', () => {
  const doc = clone(buildBaselineScopeA());
  doc.presentation_readiness.control_c_status = 'IN_PROGRESS';
  assertInvalid(doc, ['schema.const_mismatch']);
});

test('presentation_readiness READY_FOR_G3 pins control_c_status READY, a receipt id, null g3_gate and empty blocker_ids', () => {
  const doc = clone(buildPresentationReadyForG3());
  doc.presentation_readiness.blocker_ids = ['OI-SHOULD-NOT-BE-HERE'];
  assertInvalid(doc, ['schema.max_items']);
});

test('presentation_readiness SUBMISSION_AUTHORIZED requires g3_gate outcome AUTHORIZED', () => {
  const doc = clone(buildSubmissionAuthorized());
  doc.presentation_readiness.g3_gate = buildG3Gate('BLOCKED');
  assertInvalid(doc, ['schema.const_mismatch']);
});

test('presentation_readiness SUBMISSION_BLOCKED requires at least one blocker_id and a non-PASS g3_gate outcome', () => {
  const doc = clone(buildSubmissionBlockedViaPresentationChange());
  doc.presentation_readiness.blocker_ids = [];
  assertInvalid(doc, ['schema.min_items']);
});

test('presentation_readiness.blocker_ids must reference an existing finding or open_item', () => {
  const doc = clone(buildSubmissionBlockedViaPresentationChange());
  doc.presentation_readiness.blocker_ids = ['OI-DOES-NOT-EXIST-ANYWHERE'];
  assertInvalid(doc, ['presentation_readiness.blocker_id_not_found']);
});

// ---------------------------------------------------------------------------
// Group 15 — cross-field process/recommendation/conditions invariants
// ---------------------------------------------------------------------------

test('recommendation CONTINUE_CONDITIONAL_RECOMMENDED requires at least one condition_open_item_id', () => {
  const doc = clone(buildBaselineScopeAPlusB());
  doc.recommendation.kind = 'CONTINUE_CONDITIONAL_RECOMMENDED';
  doc.recommendation.condition_open_item_ids = [];
  assertInvalid(doc, ['recommendation.condition_open_items_required']);
});

test('recommendation NO_GO_RECOMMENDED requires at least one blocker_finding_id', () => {
  const doc = clone(buildBaselineScopeA());
  doc.recommendation.kind = 'NO_GO_RECOMMENDED';
  doc.recommendation.blocker_finding_ids = [];
  assertInvalid(doc, ['recommendation.blocker_findings_required']);
});

test('process_analysis WITHHELD_COVERAGE_GAP requires at least one NOT_COVERED or PARTIAL coverage entry', () => {
  const doc = clone(buildBaselineScopeA());
  doc.process_analysis.status = 'WITHHELD_COVERAGE_GAP';
  assertInvalid(doc, ['process_analysis.coverage_gap_required']);

  const doc2 = clone(doc);
  doc2.coverage[0].status = 'PARTIAL';
  doc2.coverage[0].gap_reason = 'Pending addendum clarification.';
  assertValid(doc2);
});

// ---------------------------------------------------------------------------
// Group 16 — idArray uniqueItems is enforced
// ---------------------------------------------------------------------------

test('idArray fields reject duplicate entries', () => {
  const doc = clone(buildBaselineScopeA());
  doc.meta.legacy_lineage_refs = [nthUuid(1), nthUuid(1)];
  assertInvalid(doc, ['schema.not_unique']);
});

// ---------------------------------------------------------------------------
// Group 17 — format and numeric-range keywords
// ---------------------------------------------------------------------------

test('timestamp fields reject a non-date-time string', () => {
  const doc = clone(buildBaselineScopeA());
  doc.meta.created_at = 'not-a-timestamp';
  assertInvalid(doc, ['schema.format_mismatch']);
});

test('nonEmptyText fields reject an over-long string', () => {
  const doc = clone(buildBaselineScopeA());
  doc.claims[0].display_text = 'x'.repeat(12001);
  assertInvalid(doc, ['schema.max_length']);
});

test('batch_size rejects a value above the schema maximum of 12', () => {
  const doc = clone(buildBaselineScopeA());
  doc.evidence_package.batch_size = 13;
  assertInvalid(doc, ['schema.maximum']);
});

test('a source_analysis_run_id that is neither null nor a valid uuid matches zero oneOf branches', () => {
  const doc = clone(buildReanalysisScopeAPlusB());
  doc.meta.source_analysis_run_id = 'not-a-uuid';
  assertInvalid(doc, ['schema.one_of_no_match']);
});

test('render_manifest: minContains/maxContains are enforced per projection_type independently of array length', () => {
  const doc = clone(buildBaselineScopeA());
  doc.render_manifest[2] = { ...doc.render_manifest[0] };
  assertInvalid(doc, ['schema.contains_not_met', 'schema.contains_too_many']);
});

// ---------------------------------------------------------------------------
// Group 18 — closed error codes and deterministic ordering
// ---------------------------------------------------------------------------

test('validator returns {ok, errors} and never throws on a structurally invalid plain object', () => {
  assert.doesNotThrow(() => validatePreGoAnalysisV1({ garbage: true }));
  assert.doesNotThrow(() => validatePreGoAnalysisV1(null));
  assert.doesNotThrow(() => validatePreGoAnalysisV1([]));
  assert.doesNotThrow(() => validatePreGoAnalysisV1('not-an-object'));
});

test('validator accepts an optional context argument without changing shape', () => {
  const result = validatePreGoAnalysisV1(buildBaselineScopeA(), { now: T0 });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ['errors', 'ok']);
});

test('errors are returned in a deterministic order across repeated calls', () => {
  const doc = clone(buildBaselineScopeA());
  delete doc.meta.opportunity_id;
  doc.claims = [];
  doc.recommendation.basis_claim_ids = ['CLM-DOES-NOT-EXIST'];

  const first = validatePreGoAnalysisV1(clone(doc));
  const second = validatePreGoAnalysisV1(clone(doc));
  assert.equal(first.ok, false);
  assert.deepEqual(first.errors, second.errors);
});

test('errors are ordered by path ascending, tie-broken by code ascending', () => {
  const doc = clone(buildBaselineScopeA());
  delete doc.meta.opportunity_id;
  delete doc.meta.tender_id;
  doc.evidence_package.member_refs[0].unexpected = 'nope';

  const { errors } = validatePreGoAnalysisV1(doc);
  assert.ok(errors.length >= 2);
  for (let i = 1; i < errors.length; i += 1) {
    const prev = errors[i - 1];
    const curr = errors[i];
    const inOrder = prev.path < curr.path || (prev.path === curr.path && prev.code <= curr.code);
    assert.ok(inOrder, `errors not ordered: ${JSON.stringify(prev)} before ${JSON.stringify(curr)}`);
  }
});

test('COVERAGE_BLOCKS fixture constant matches the 7 enum values declared in the immutable schema', () => {
  assert.deepEqual(
    [...COVERAGE_BLOCKS].sort(),
    [...SCHEMA.$defs.coverage.properties.block.enum].sort(),
  );
});
