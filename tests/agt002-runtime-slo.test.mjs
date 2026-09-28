import assert from 'node:assert/strict';
import {
  AGT002_F1_PILOT_SCHEMA_VERSION,
  AGT002_F1_PILOT_FAILURE_CLASSES,
  AGT002_F1_PILOT_RECORD_STATUSES,
  AGT002_F1_PILOT_TARGET_OPPORTUNITIES,
  AGT002_F1_PILOT_ANALYSIS_KINDS,
  normalizeAgt002F1PilotRecord,
  computeAgt002F1PilotReport,
} from '../agt002-runtime-slo.js';

// Pure module coverage: no fs/network/SQL, no schema/API/production wiring, no DANE concerns.
// All fixtures are synthetic (`synthetic-` id prefixes). `now`/`pilot_started_at` are always
// injected so the report is deterministic and never reads the real clock. This is the F1 pilot
// v2 (10 opportunities), not the old rolling-window SLO: no windows, no availability SLO.

// --- Closed catalogs / target ------------------------------------------------------------

assert.deepEqual(AGT002_F1_PILOT_FAILURE_CLASSES, [
  'provider_error', 'invalid_output', 'timeout', 'stale_input', 'transport', 'validation', 'persistence',
]);
assert.equal(Object.isFrozen(AGT002_F1_PILOT_FAILURE_CLASSES), true);
assert.deepEqual([...AGT002_F1_PILOT_RECORD_STATUSES].sort(), ['completed', 'failed', 'pending']);
assert.equal(Object.isFrozen(AGT002_F1_PILOT_RECORD_STATUSES), true);
// The pilot targets 10 opportunities, never the old 100-attempt SLO minimum.
assert.equal(AGT002_F1_PILOT_TARGET_OPPORTUNITIES, 10);
assert.deepEqual([...AGT002_F1_PILOT_ANALYSIS_KINDS].sort(), [
  'initial_opportunity_analysis', 'radar_preanalysis', 'reanalysis',
]);
assert.equal(Object.isFrozen(AGT002_F1_PILOT_ANALYSIS_KINDS), true);

// --- Fixture helpers ---------------------------------------------------------------------

const PILOT_STARTED_AT = '2026-09-01T00:00:00Z';
const NOW = '2026-09-27T12:00:00Z';
const NOW_MS = Date.parse(NOW);

function hourOffset(offsetHours) {
  return new Date(NOW_MS - offsetHours * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

let idCounter = 0;
let tenderCounter = 0;
function nextTenderId() {
  tenderCounter += 1;
  return `synthetic-tender-${tenderCounter}`;
}

function makeRecord(overrides = {}) {
  idCounter += 1;
  return {
    record_id: `synthetic-record-${idCounter}`,
    tender_id: `synthetic-tender-shared`,
    opportunity_id: `synthetic-opportunity-shared`,
    occurred_at_utc: hourOffset(0),
    analysis_kind: 'initial_opportunity_analysis',
    production: true,
    real_data: true,
    human_converted: true,
    conversion_completed: true,
    initial_opportunity_analysis_at: hourOffset(1),
    converted_at_utc: hourOffset(2),
    analysis_attempt_id: `synthetic-attempt-${idCounter}`,
    analysis_attempt_number: 1,
    idempotency_key: `synthetic-idem-${idCounter}`,
    status: 'completed',
    failure_class: null,
    durable: true,
    provenance_recorded: true,
    visible: true,
    human_reviewed: true,
    ...overrides,
  };
}

// A distinct, healthy, first-attempt-completed opportunity (one record, one tender_id).
function healthyOpportunity(overrides = {}) {
  const tenderId = nextTenderId();
  return makeRecord({
    tender_id: tenderId,
    opportunity_id: `${tenderId}-opportunity`,
    ...overrides,
  });
}

function healthyOpportunities(count, overrides = {}) {
  return Array.from({ length: count }, () => healthyOpportunity(overrides));
}

// --- normalizeAgt002F1PilotRecord: structural fail-closed normalization ------------------

const validRecord = healthyOpportunity();
const normalizedValid = normalizeAgt002F1PilotRecord(validRecord);
assert.equal(normalizedValid.valid, true);
assert.deepEqual(normalizedValid.errors, []);
assert.equal(normalizedValid.tender_id, validRecord.tender_id);
assert.equal(normalizedValid.status, 'completed');
assert.equal(normalizedValid.failure_class, null);
assert.equal(Object.isFrozen(normalizedValid), true);

const validFailure = healthyOpportunity({ status: 'failed', failure_class: 'timeout' });
const normalizedFailure = normalizeAgt002F1PilotRecord(validFailure);
assert.equal(normalizedFailure.valid, true);
assert.equal(normalizedFailure.failure_class, 'timeout');

function assertFailClosed(normalized, { keepsId = true } = {}) {
  assert.equal(normalized.valid, false);
  assert.ok(normalized.errors.length > 0);
  assert.equal(normalized.tender_id, null);
  assert.equal(normalized.opportunity_id, null);
  assert.equal(normalized.occurred_at_utc, null);
  assert.equal(normalized.analysis_kind, null);
  assert.equal(normalized.production, false);
  assert.equal(normalized.real_data, false);
  assert.equal(normalized.human_converted, false);
  assert.equal(normalized.conversion_completed, false);
  assert.equal(normalized.converted_at_utc, null);
  assert.equal(normalized.analysis_attempt_id, null);
  assert.equal(normalized.analysis_attempt_number, null);
  assert.equal(normalized.idempotency_key, null);
  assert.equal(normalized.status, 'failed');
  assert.equal(normalized.failure_class, 'validation');
  assert.equal(normalized.durable, false);
  assert.equal(normalized.provenance_recorded, false);
  assert.equal(normalized.visible, false);
  assert.equal(normalized.human_reviewed, false);
  if (!keepsId) assert.equal(normalized.record_id, null);
}

assertFailClosed(normalizeAgt002F1PilotRecord(null), { keepsId: false });
assertFailClosed(normalizeAgt002F1PilotRecord('not-an-object'), { keepsId: false });
assertFailClosed(normalizeAgt002F1PilotRecord(['array']), { keepsId: false });

const { record_id: _missingId, ...missingId } = healthyOpportunity();
assertFailClosed(normalizeAgt002F1PilotRecord(missingId), { keepsId: false });

const withExtraProperty = { ...healthyOpportunity(), unexpected_field: 'nope' };
const extraNormalized = normalizeAgt002F1PilotRecord(withExtraProperty);
assertFailClosed(extraNormalized);
assert.equal(extraNormalized.record_id, withExtraProperty.record_id);
assert.ok(extraNormalized.errors.includes('record.additional_property'));

const invalidStatus = healthyOpportunity({ status: 'in_review' });
assert.ok(normalizeAgt002F1PilotRecord(invalidStatus).errors.includes('record.invalid_status'));

const successWithFailureClass = healthyOpportunity({ status: 'completed', failure_class: 'timeout' });
assert.ok(normalizeAgt002F1PilotRecord(successWithFailureClass).errors.includes('record.failure_class_must_be_null'));

const failedWithNullClass = healthyOpportunity({ status: 'failed', failure_class: null });
assert.ok(normalizeAgt002F1PilotRecord(failedWithNullClass).errors.includes('record.invalid_failure_class'));

const failedWithOpenClass = healthyOpportunity({ status: 'failed', failure_class: 'network_flaky' });
assert.ok(normalizeAgt002F1PilotRecord(failedWithOpenClass).errors.includes('record.invalid_failure_class'));

for (const field of ['production', 'real_data', 'human_converted', 'conversion_completed', 'durable', 'provenance_recorded', 'visible', 'human_reviewed']) {
  const bad = healthyOpportunity({ [field]: 'yes' });
  const result = normalizeAgt002F1PilotRecord(bad);
  assert.ok(result.errors.some((error) => error.startsWith('record.invalid_')), `field ${field} should be flagged`);
  assertFailClosed(result);
}

// --- Defecto 1: `analysis_kind` obligatorio; sólo initial_opportunity_analysis es elegible ---

const invalidAnalysisKind = healthyOpportunity({ analysis_kind: 'unknown_kind' });
assert.ok(normalizeAgt002F1PilotRecord(invalidAnalysisKind).errors.includes('record.invalid_analysis_kind'));

const missingAnalysisKind = { ...healthyOpportunity() };
delete missingAnalysisKind.analysis_kind;
assertFailClosed(normalizeAgt002F1PilotRecord(missingAnalysisKind));

// reanalysis / radar_preanalysis are structurally valid — just never eligible.
const reanalysisNormalized = normalizeAgt002F1PilotRecord(healthyOpportunity({ analysis_kind: 'reanalysis' }));
assert.equal(reanalysisNormalized.valid, true);
assert.deepEqual(reanalysisNormalized.errors, []);

const radarPreanalysisNormalized = normalizeAgt002F1PilotRecord(healthyOpportunity({ analysis_kind: 'radar_preanalysis' }));
assert.equal(radarPreanalysisNormalized.valid, true);
assert.deepEqual(radarPreanalysisNormalized.errors, []);

function exclusionBatch(overrides) {
  return [...healthyOpportunities(9), healthyOpportunity(overrides)];
}

const excludedByReanalysis = computeAgt002F1PilotReport({
  records: exclusionBatch({ analysis_kind: 'reanalysis' }), pilot_started_at: PILOT_STARTED_AT, now: NOW,
});
assert.equal(excludedByReanalysis.structurally_invalid_records, 0);
assert.equal(excludedByReanalysis.selected_opportunities, 9);
assert.equal(excludedByReanalysis.ineligible_records, 1);

const excludedByRadarPreanalysis = computeAgt002F1PilotReport({
  records: exclusionBatch({ analysis_kind: 'radar_preanalysis' }), pilot_started_at: PILOT_STARTED_AT, now: NOW,
});
assert.equal(excludedByRadarPreanalysis.structurally_invalid_records, 0);
assert.equal(excludedByRadarPreanalysis.selected_opportunities, 9);
assert.equal(excludedByRadarPreanalysis.ineligible_records, 1);

// --- Defecto 2: `converted_at_utc` (no initial_opportunity_analysis_at) rige elegibilidad ---
// y el orden de selección de las primeras 10 oportunidades. ------------------------------

const missingConvertedAt = { ...healthyOpportunity() };
delete missingConvertedAt.converted_at_utc;
assertFailClosed(normalizeAgt002F1PilotRecord(missingConvertedAt));

const badConvertedAt = healthyOpportunity({ converted_at_utc: 'not-a-date' });
assert.ok(normalizeAgt002F1PilotRecord(badConvertedAt).errors.includes('record.invalid_converted_at'));

// converted_at_utc before pilot start excludes the record even though
// initial_opportunity_analysis_at is well after pilot start.
const excludedByConvertedBeforePilot = computeAgt002F1PilotReport({
  records: exclusionBatch({ converted_at_utc: '2026-08-25T00:00:00Z', initial_opportunity_analysis_at: hourOffset(1) }),
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(excludedByConvertedBeforePilot.selected_opportunities, 9);
assert.equal(excludedByConvertedBeforePilot.ineligible_records, 1);

// converted_at_utc exactly at pilot start is eligible (inclusive boundary).
const atPilotStartViaConverted = computeAgt002F1PilotReport({
  records: [...healthyOpportunities(9), healthyOpportunity({ converted_at_utc: PILOT_STARTED_AT, initial_opportunity_analysis_at: hourOffset(1) })],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(atPilotStartViaConverted.selected_opportunities, 10);

// Selection order of the first 10 uses converted_at_utc, not occurred_at_utc. All 11 records
// share the same occurred_at_utc, so only converted_at_utc can determine which one is excess.
const orderTenderIds = [];
const orderRecords = Array.from({ length: 11 }, (_, i) => {
  const tenderId = nextTenderId();
  orderTenderIds.push(tenderId);
  return makeRecord({
    tender_id: tenderId,
    opportunity_id: `${tenderId}-opp`,
    occurred_at_utc: hourOffset(0),
    converted_at_utc: hourOffset(1 + i), // first created has the latest converted_at_utc
  });
});
const orderReport = computeAgt002F1PilotReport({ records: orderRecords, pilot_started_at: PILOT_STARTED_AT, now: NOW });
assert.equal(orderReport.selected_opportunities, 10);
assert.equal(orderReport.excess_eligible_opportunities, 1);
const orderSelectedTenderIds = orderReport.opportunities.map((o) => o.tender_id);
// First-created tender has the latest converted_at_utc, so it is the excess one.
assert.ok(!orderSelectedTenderIds.includes(orderTenderIds[0]));
// Last-created tender has the earliest converted_at_utc, so it is selected.
assert.ok(orderSelectedTenderIds.includes(orderTenderIds[10]));

// --- computeAgt002F1PilotReport: input guards --------------------------------------------

assert.throws(() => computeAgt002F1PilotReport({ records: 'nope', pilot_started_at: PILOT_STARTED_AT, now: NOW }), TypeError);
assert.throws(() => computeAgt002F1PilotReport({ records: [], pilot_started_at: 'not-a-timestamp', now: NOW }), TypeError);
assert.throws(() => computeAgt002F1PilotReport({ records: [], pilot_started_at: PILOT_STARTED_AT, now: 'nope' }), TypeError);
assert.throws(() => computeAgt002F1PilotReport({ records: [], pilot_started_at: NOW, now: PILOT_STARTED_AT }), TypeError);

// --- Duplicate record_id fails closed -----------------------------------------------------

const dupId = 'synthetic-record-duplicate';
assert.throws(
  () => computeAgt002F1PilotReport({
    records: [healthyOpportunity({ record_id: dupId }), healthyOpportunity({ record_id: dupId })],
    pilot_started_at: PILOT_STARTED_AT,
    now: NOW,
  }),
  TypeError,
);

// --- "conflicto": opportunity_id/tender_id conflicts block computation outright ----------

const tenderA = nextTenderId();
assert.throws(
  () => computeAgt002F1PilotReport({
    records: [
      makeRecord({ tender_id: tenderA, opportunity_id: 'opportunity-1' }),
      makeRecord({ tender_id: tenderA, opportunity_id: 'opportunity-2' }),
    ],
    pilot_started_at: PILOT_STARTED_AT,
    now: NOW,
  }),
  TypeError,
);

const sharedOpportunity = 'opportunity-shared-conflict';
assert.throws(
  () => computeAgt002F1PilotReport({
    records: [
      makeRecord({ tender_id: nextTenderId(), opportunity_id: sharedOpportunity }),
      makeRecord({ tender_id: nextTenderId(), opportunity_id: sharedOpportunity }),
    ],
    pilot_started_at: PILOT_STARTED_AT,
    now: NOW,
  }),
  TypeError,
);

// A retry of the same tender_id/opportunity_id pair is not a conflict.
assert.doesNotThrow(() => {
  const tenderId = nextTenderId();
  return computeAgt002F1PilotReport({
    records: [
      makeRecord({
        tender_id: tenderId, opportunity_id: `${tenderId}-opp`,
        status: 'failed', failure_class: 'timeout', occurred_at_utc: hourOffset(2),
        analysis_attempt_number: 1, idempotency_key: `${tenderId}-idem-1`,
      }),
      makeRecord({
        tender_id: tenderId, opportunity_id: `${tenderId}-opp`,
        status: 'completed', occurred_at_utc: hourOffset(1),
        analysis_attempt_number: 2, idempotency_key: `${tenderId}-idem-2`,
      }),
    ],
    pilot_started_at: PILOT_STARTED_AT,
    now: NOW,
  });
});

// --- Defecto 3: analysis_attempt_id / analysis_attempt_number / idempotency_key ----------

const missingAttemptId = healthyOpportunity({ analysis_attempt_id: '' });
assert.ok(normalizeAgt002F1PilotRecord(missingAttemptId).errors.includes('record.invalid_analysis_attempt_id'));

const zeroAttemptNumber = healthyOpportunity({ analysis_attempt_number: 0 });
assert.ok(normalizeAgt002F1PilotRecord(zeroAttemptNumber).errors.includes('record.invalid_analysis_attempt_number'));

const fractionalAttemptNumber = healthyOpportunity({ analysis_attempt_number: 1.5 });
assert.ok(normalizeAgt002F1PilotRecord(fractionalAttemptNumber).errors.includes('record.invalid_analysis_attempt_number'));

const missingIdempotencyKey = healthyOpportunity({ idempotency_key: '' });
assert.ok(normalizeAgt002F1PilotRecord(missingIdempotencyKey).errors.includes('record.invalid_idempotency_key'));

// A duplicate analysis_attempt_number within the same tender_id blocks computation outright.
const dupAttemptTenderId = nextTenderId();
assert.throws(
  () => computeAgt002F1PilotReport({
    records: [
      makeRecord({ tender_id: dupAttemptTenderId, opportunity_id: `${dupAttemptTenderId}-opp`, analysis_attempt_number: 1, idempotency_key: 'dup-attempt-idem-a' }),
      makeRecord({ tender_id: dupAttemptTenderId, opportunity_id: `${dupAttemptTenderId}-opp`, analysis_attempt_number: 1, idempotency_key: 'dup-attempt-idem-b' }),
    ],
    pilot_started_at: PILOT_STARTED_AT,
    now: NOW,
  }),
  TypeError,
);

// A conflicting idempotency_key (same key claiming two different attempt_number) within the
// same tender_id blocks computation outright.
const conflictingKeyTenderId = nextTenderId();
assert.throws(
  () => computeAgt002F1PilotReport({
    records: [
      makeRecord({ tender_id: conflictingKeyTenderId, opportunity_id: `${conflictingKeyTenderId}-opp`, analysis_attempt_number: 1, idempotency_key: 'shared-idem' }),
      makeRecord({ tender_id: conflictingKeyTenderId, opportunity_id: `${conflictingKeyTenderId}-opp`, analysis_attempt_number: 2, idempotency_key: 'shared-idem' }),
    ],
    pilot_started_at: PILOT_STARTED_AT,
    now: NOW,
  }),
  TypeError,
);

// Retries of the same tender_id are ordered by analysis_attempt_number, not occurred_at_utc:
// here attempt_number 1 occurs chronologically *after* attempt_number 2, but the outcome must
// still follow attempt_number order.
const attemptOrderTenderId = nextTenderId();
const attemptOrderReport = computeAgt002F1PilotReport({
  records: [
    ...healthyOpportunities(9),
    makeRecord({
      tender_id: attemptOrderTenderId, opportunity_id: `${attemptOrderTenderId}-opp`,
      analysis_attempt_number: 1, idempotency_key: `${attemptOrderTenderId}-idem-1`,
      status: 'failed', failure_class: 'timeout',
      occurred_at_utc: hourOffset(1), initial_opportunity_analysis_at: hourOffset(5), converted_at_utc: hourOffset(7),
    }),
    makeRecord({
      tender_id: attemptOrderTenderId, opportunity_id: `${attemptOrderTenderId}-opp`,
      analysis_attempt_number: 2, idempotency_key: `${attemptOrderTenderId}-idem-2`,
      status: 'completed',
      occurred_at_utc: hourOffset(3), initial_opportunity_analysis_at: hourOffset(6), converted_at_utc: hourOffset(7),
    }),
  ],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
const attemptOrderOpportunity = attemptOrderReport.opportunities.find((o) => o.tender_id === attemptOrderTenderId);
assert.equal(attemptOrderOpportunity.first_attempt_success, false);
assert.equal(attemptOrderOpportunity.status, 'completed');
assert.equal(attemptOrderOpportunity.latency_seconds, 2 * 3600);

// --- Report shape --------------------------------------------------------------------------

const emptyReport = computeAgt002F1PilotReport({ records: [], pilot_started_at: PILOT_STARTED_AT, now: NOW });
assert.equal(emptyReport.schema_version, AGT002_F1_PILOT_SCHEMA_VERSION);
assert.equal(emptyReport.target, 10);
assert.equal(emptyReport.selected_opportunities, 0);
assert.equal(emptyReport.target_reached, false);
assert.equal(emptyReport.accepted, false);
assert.ok(emptyReport.blockers.some((b) => b.includes('0/10')));
assert.equal(Object.isFrozen(emptyReport), true);
assert.equal(Object.isFrozen(emptyReport.blockers), true);
assert.equal(Object.isFrozen(emptyReport.opportunities), true);

// --- "9/10": target not reached ------------------------------------------------------------

const nineOfTen = computeAgt002F1PilotReport({
  records: healthyOpportunities(9),
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(nineOfTen.selected_opportunities, 9);
assert.equal(nineOfTen.target_reached, false);
assert.equal(nineOfTen.accepted, false);
assert.ok(nineOfTen.blockers.some((b) => b.includes('9/10')));

// --- "10/10": target reached and pilot fully healthy → accepted -----------------------------
// Also proves "no 100": a batch of exactly 10 (not 100) is sufficient.

const tenOfTen = computeAgt002F1PilotReport({
  records: healthyOpportunities(10),
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(tenOfTen.selected_opportunities, 10);
assert.equal(tenOfTen.target_reached, true);
assert.equal(tenOfTen.terminal_opportunities, 10);
assert.equal(tenOfTen.completed_opportunities, 10);
assert.equal(tenOfTen.pending_opportunities, 0);
assert.equal(tenOfTen.durable_with_provenance_rate, 1);
assert.equal(tenOfTen.visible_rate, 1);
assert.equal(tenOfTen.human_reviewed_rate, 1);
assert.deepEqual(tenOfTen.blockers, []);
assert.equal(tenOfTen.accepted, true);

// Eleventh distinct opportunity beyond the target does not inflate the pilot or get selected.
const elevenEligible = computeAgt002F1PilotReport({
  records: healthyOpportunities(11),
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(elevenEligible.selected_opportunities, 10);
assert.equal(elevenEligible.excess_eligible_opportunities, 1);
assert.equal(elevenEligible.accepted, true);

// --- Defecto 6: excess_eligible_opportunities cuenta tender_id únicos, no records --------
// An 11th, unselected tender_id with two eligible attempts must count as 1 excess
// opportunity, not 2 excess records.

const excessTenderId = nextTenderId();
const excessRecordsReport = computeAgt002F1PilotReport({
  records: [
    ...healthyOpportunities(10),
    makeRecord({
      tender_id: excessTenderId, opportunity_id: `${excessTenderId}-opp`,
      analysis_attempt_number: 1, idempotency_key: `${excessTenderId}-idem-1`,
      status: 'failed', failure_class: 'timeout',
      occurred_at_utc: hourOffset(0), initial_opportunity_analysis_at: hourOffset(0), converted_at_utc: hourOffset(0),
    }),
    makeRecord({
      tender_id: excessTenderId, opportunity_id: `${excessTenderId}-opp`,
      analysis_attempt_number: 2, idempotency_key: `${excessTenderId}-idem-2`,
      status: 'completed',
      occurred_at_utc: hourOffset(0), initial_opportunity_analysis_at: hourOffset(0), converted_at_utc: hourOffset(0),
    }),
  ],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(excessRecordsReport.selected_opportunities, 10);
assert.equal(excessRecordsReport.excess_eligible_opportunities, 1);

// --- "retry": a retry of an already-selected tender never consumes a new slot and never ----
// inflates counts; it does feed failure/retry metrics and defeats first-attempt success.

const retryTenderId = nextTenderId();
const retryOpportunity = `${retryTenderId}-opp`;
const retryRecords = [
  makeRecord({
    tender_id: retryTenderId, opportunity_id: retryOpportunity,
    analysis_attempt_number: 1, idempotency_key: `${retryTenderId}-idem-1`,
    status: 'failed', failure_class: 'provider_error',
    occurred_at_utc: hourOffset(3), initial_opportunity_analysis_at: hourOffset(4), converted_at_utc: hourOffset(5),
  }),
  makeRecord({
    tender_id: retryTenderId, opportunity_id: retryOpportunity,
    analysis_attempt_number: 2, idempotency_key: `${retryTenderId}-idem-2`,
    status: 'completed',
    occurred_at_utc: hourOffset(1), initial_opportunity_analysis_at: hourOffset(4), converted_at_utc: hourOffset(5),
  }),
];
const withRetry = computeAgt002F1PilotReport({
  records: [...retryRecords, ...healthyOpportunities(9)],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(withRetry.selected_opportunities, 10); // retry tender + 9 healthy, not 11
assert.equal(withRetry.retries_total, 1);
assert.equal(withRetry.failures_total, 1);
assert.equal(withRetry.failures_classified_rate, 1);
const retryOpportunityReport = withRetry.opportunities.find((o) => o.tender_id === retryTenderId);
assert.equal(retryOpportunityReport.attempts, 2);
assert.equal(retryOpportunityReport.retries, 1);
assert.equal(retryOpportunityReport.status, 'completed');
assert.equal(retryOpportunityReport.first_attempt_success, false);
assert.equal(withRetry.accepted, true);

// --- "primer intento" (first attempt): completed on the very first try, no retry needed ----

const firstAttemptOnly = computeAgt002F1PilotReport({
  records: healthyOpportunities(10),
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(firstAttemptOnly.first_attempt_success_count, 10);
assert.equal(firstAttemptOnly.first_attempt_success_rate, 1);
for (const opportunity of firstAttemptOnly.opportunities) assert.equal(opportunity.first_attempt_success, true);

const mixedFirstAttempt = computeAgt002F1PilotReport({
  records: [...retryRecords, ...healthyOpportunities(9)],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(mixedFirstAttempt.first_attempt_success_count, 9);
assert.equal(mixedFirstAttempt.first_attempt_success_rate, 9 / 10);

// --- Defecto 4: first_attempt_success_rate usa las 10 oportunidades seleccionadas como -----
// denominador, incluyendo terminal failed y pending (no sólo las completadas). -------------

const mixedCohort = [
  ...healthyOpportunities(6),
  ...Array.from({ length: 2 }, () => healthyOpportunity({ status: 'failed', failure_class: 'timeout' })),
  ...Array.from({ length: 2 }, () => healthyOpportunity({ status: 'pending', failure_class: null, durable: false, human_reviewed: false })),
];
const mixedCohortReport = computeAgt002F1PilotReport({ records: mixedCohort, pilot_started_at: PILOT_STARTED_AT, now: NOW });
assert.equal(mixedCohortReport.selected_opportunities, 10);
assert.equal(mixedCohortReport.first_attempt_success_count, 6);
assert.equal(mixedCohortReport.first_attempt_success_rate, 0.6);

// --- "exclusiones": each eligibility condition independently excludes a record -------------

const excludedByProduction = computeAgt002F1PilotReport({
  records: exclusionBatch({ production: false }), pilot_started_at: PILOT_STARTED_AT, now: NOW,
});
assert.equal(excludedByProduction.selected_opportunities, 9);
assert.equal(excludedByProduction.ineligible_records, 1);

const excludedByRealData = computeAgt002F1PilotReport({
  records: exclusionBatch({ real_data: false }), pilot_started_at: PILOT_STARTED_AT, now: NOW,
});
assert.equal(excludedByRealData.selected_opportunities, 9);
assert.equal(excludedByRealData.ineligible_records, 1);

const excludedByHumanConverted = computeAgt002F1PilotReport({
  records: exclusionBatch({ human_converted: false }), pilot_started_at: PILOT_STARTED_AT, now: NOW,
});
assert.equal(excludedByHumanConverted.selected_opportunities, 9);
assert.equal(excludedByHumanConverted.ineligible_records, 1);

const excludedByConversion = computeAgt002F1PilotReport({
  records: exclusionBatch({ conversion_completed: false }), pilot_started_at: PILOT_STARTED_AT, now: NOW,
});
assert.equal(excludedByConversion.selected_opportunities, 9);
assert.equal(excludedByConversion.ineligible_records, 1);

// --- "fallos": a terminal failed opportunity is classified and does not block acceptance ---
// as long as every other pilot invariant holds.

const withTerminalFailure = computeAgt002F1PilotReport({
  records: [
    ...healthyOpportunities(9),
    healthyOpportunity({ status: 'failed', failure_class: 'invalid_output' }),
  ],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(withTerminalFailure.failed_opportunities, 1);
assert.equal(withTerminalFailure.completed_opportunities, 9);
assert.equal(withTerminalFailure.failures_total, 1);
assert.equal(withTerminalFailure.failures_classified_rate, 1);
assert.equal(withTerminalFailure.terminal_opportunities, 10);
assert.equal(withTerminalFailure.accepted, true);

// --- "pending": a non-terminal opportunity blocks acceptance even at 10/10 selected --------

const withPending = computeAgt002F1PilotReport({
  records: [...healthyOpportunities(9), healthyOpportunity({ status: 'pending', failure_class: null, durable: false, human_reviewed: false })],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(withPending.selected_opportunities, 10);
assert.equal(withPending.pending_opportunities, 1);
assert.equal(withPending.terminal_opportunities, 9);
assert.equal(withPending.accepted, false);
assert.ok(withPending.blockers.some((b) => b.includes('pending')));
const pendingOpportunityReport = withPending.opportunities.find((o) => o.status === 'pending');
assert.equal(pendingOpportunityReport.durable, false);
assert.equal(pendingOpportunityReport.human_reviewed, false);

// --- "oculta" (hidden): a terminal opportunity that is not visible blocks acceptance -------

const withHidden = computeAgt002F1PilotReport({
  records: [...healthyOpportunities(9), healthyOpportunity({ visible: false })],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(withHidden.hidden_count, 1);
assert.ok(withHidden.visible_rate < 1);
assert.equal(withHidden.accepted, false);
assert.ok(withHidden.blockers.some((b) => b.includes('not visible')));

// --- "revisión": a terminal opportunity missing human review blocks acceptance -------------

const withoutReview = computeAgt002F1PilotReport({
  records: [...healthyOpportunities(9), healthyOpportunity({ human_reviewed: false })],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.ok(withoutReview.human_reviewed_rate < 1);
assert.equal(withoutReview.accepted, false);
assert.ok(withoutReview.blockers.some((b) => b.includes('human reviewed')));

// Durable/provenance is also required on the terminal record.
const notDurable = computeAgt002F1PilotReport({
  records: [...healthyOpportunities(9), healthyOpportunity({ durable: false })],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.ok(notDurable.durable_with_provenance_rate < 1);
assert.equal(notDurable.accepted, false);
assert.ok(notDurable.blockers.some((b) => b.includes('durable with provenance')));

// --- "timestamps": malformed timestamps fail closed; future-dated records are excluded ----

const badOccurredFormat = healthyOpportunity({ occurred_at_utc: '2026-09-27' });
assert.ok(normalizeAgt002F1PilotRecord(badOccurredFormat).errors.includes('record.invalid_occurred_at'));

const badOccurredCalendar = healthyOpportunity({ occurred_at_utc: '2026-02-30T00:00:00Z' });
assert.ok(normalizeAgt002F1PilotRecord(badOccurredCalendar).errors.includes('record.invalid_occurred_at'));

const badInitialAnalysis = healthyOpportunity({ initial_opportunity_analysis_at: 'not-a-date' });
assert.ok(normalizeAgt002F1PilotRecord(badInitialAnalysis).errors.includes('record.invalid_initial_opportunity_analysis_at'));

const withStructurallyInvalid = computeAgt002F1PilotReport({
  records: [...healthyOpportunities(9), { ...healthyOpportunity(), occurred_at_utc: 'not-a-date' }],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(withStructurallyInvalid.structurally_invalid_records, 1);
assert.equal(withStructurallyInvalid.selected_opportunities, 9);
assert.equal(withStructurallyInvalid.accepted, false);
assert.ok(withStructurallyInvalid.blockers.some((b) => b.includes('failed structural normalization')));

const futureRecord = healthyOpportunity({ occurred_at_utc: '2026-09-28T00:00:00Z' });
const withFuture = computeAgt002F1PilotReport({
  records: [...healthyOpportunities(9), futureRecord],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
assert.equal(withFuture.future_dated_records, 1);
assert.equal(withFuture.selected_opportunities, 9);
assert.equal(withFuture.accepted, false);
assert.ok(withFuture.blockers.some((b) => b.includes('after the injected now')));

// --- Defecto 5: analysis start/terminal timestamps no anteriores a converted_at; ----------
// latencia negativa bloquea el cómputo. ----------------------------------------------------

const occurredBeforeConverted = healthyOpportunity({ occurred_at_utc: hourOffset(3), converted_at_utc: hourOffset(1) });
assert.ok(normalizeAgt002F1PilotRecord(occurredBeforeConverted).errors.includes('record.occurred_before_converted'));

const analysisStartBeforeConverted = healthyOpportunity({ initial_opportunity_analysis_at: hourOffset(3), converted_at_utc: hourOffset(1) });
assert.ok(normalizeAgt002F1PilotRecord(analysisStartBeforeConverted).errors.includes('record.analysis_start_before_converted'));

const negLatencyTenderId = nextTenderId();
const negLatencyRecords = [
  makeRecord({
    tender_id: negLatencyTenderId, opportunity_id: `${negLatencyTenderId}-opp`,
    analysis_attempt_number: 1, idempotency_key: `${negLatencyTenderId}-idem-1`,
    status: 'failed', failure_class: 'timeout',
    occurred_at_utc: hourOffset(1), initial_opportunity_analysis_at: hourOffset(1), converted_at_utc: hourOffset(6),
  }),
  makeRecord({
    tender_id: negLatencyTenderId, opportunity_id: `${negLatencyTenderId}-opp`,
    analysis_attempt_number: 2, idempotency_key: `${negLatencyTenderId}-idem-2`,
    status: 'completed',
    // This attempt terminates *before* the first attempt even started: negative latency.
    occurred_at_utc: hourOffset(2), initial_opportunity_analysis_at: hourOffset(2), converted_at_utc: hourOffset(6),
  }),
];
assert.throws(
  () => computeAgt002F1PilotReport({ records: negLatencyRecords, pilot_started_at: PILOT_STARTED_AT, now: NOW }),
  TypeError,
);

// --- P1: tender-level fields (production, real_data, human_converted, conversion_completed,
// analysis_kind, converted_at_utc) must be consistent across every attempt of a tender_id -----
// before eligibility is even computed. A mismatch fails closed with a TypeError and never
// reaches report computation. -------------------------------------------------------------

function twoAttemptsOf(tenderId, firstOverrides, secondOverrides) {
  return [
    makeRecord({
      tender_id: tenderId, opportunity_id: `${tenderId}-opp`,
      analysis_attempt_number: 1, idempotency_key: `${tenderId}-idem-1`,
      status: 'failed', failure_class: 'timeout',
      occurred_at_utc: hourOffset(3), initial_opportunity_analysis_at: hourOffset(4), converted_at_utc: hourOffset(5),
      ...firstOverrides,
    }),
    makeRecord({
      tender_id: tenderId, opportunity_id: `${tenderId}-opp`,
      analysis_attempt_number: 2, idempotency_key: `${tenderId}-idem-2`,
      status: 'completed',
      occurred_at_utc: hourOffset(1), initial_opportunity_analysis_at: hourOffset(4), converted_at_utc: hourOffset(5),
      ...secondOverrides,
    }),
  ];
}

function assertTenderConsistencyBlocks(inconsistentField, firstOverrides, secondOverrides) {
  const tenderId = nextTenderId();
  assert.throws(
    () => computeAgt002F1PilotReport({
      records: [...twoAttemptsOf(tenderId, firstOverrides, secondOverrides), ...healthyOpportunities(9)],
      pilot_started_at: PILOT_STARTED_AT,
      now: NOW,
    }),
    TypeError,
    `inconsistent ${inconsistentField} across attempts should block computation`,
  );
}

assertTenderConsistencyBlocks('production', { production: true }, { production: false });
assertTenderConsistencyBlocks('real_data', { real_data: true }, { real_data: false });
assertTenderConsistencyBlocks('human_converted', { human_converted: true }, { human_converted: false });
assertTenderConsistencyBlocks('conversion_completed', { conversion_completed: true }, { conversion_completed: false });
assertTenderConsistencyBlocks('converted_at_utc', { converted_at_utc: hourOffset(5) }, { converted_at_utc: hourOffset(6) });

// A retry silently reclassified from `initial_opportunity_analysis` to `reanalysis` (or vice
// versa) is exactly the corrupted-data case this guard exists to catch.
assertTenderConsistencyBlocks(
  'analysis_kind',
  { analysis_kind: 'initial_opportunity_analysis' },
  { analysis_kind: 'reanalysis' },
);

// Consistent tender-level fields across retries never block computation.
assert.doesNotThrow(() => {
  const tenderId = nextTenderId();
  return computeAgt002F1PilotReport({
    records: [...twoAttemptsOf(tenderId, {}, {}), ...healthyOpportunities(9)],
    pilot_started_at: PILOT_STARTED_AT,
    now: NOW,
  });
});

// --- P2: any terminal attempt (completed or failed) must not occur before the first
// attempt's initial_opportunity_analysis_at; pending is not terminal and is exempt. ---------

// A terminal *failed* attempt with a negative elapsed time blocks computation, exactly like a
// terminal completed attempt does — the previous guard only looked at latency_seconds, which
// is null for failed attempts, so this case slipped through unvalidated.
const negLatencyFailedTenderId = nextTenderId();
const negLatencyFailedRecords = [
  makeRecord({
    tender_id: negLatencyFailedTenderId, opportunity_id: `${negLatencyFailedTenderId}-opp`,
    analysis_attempt_number: 1, idempotency_key: `${negLatencyFailedTenderId}-idem-1`,
    status: 'failed', failure_class: 'timeout',
    occurred_at_utc: hourOffset(1), initial_opportunity_analysis_at: hourOffset(1), converted_at_utc: hourOffset(6),
  }),
  makeRecord({
    tender_id: negLatencyFailedTenderId, opportunity_id: `${negLatencyFailedTenderId}-opp`,
    analysis_attempt_number: 2, idempotency_key: `${negLatencyFailedTenderId}-idem-2`,
    status: 'failed', failure_class: 'provider_error',
    // Terminates before the first attempt even started: negative elapsed time.
    occurred_at_utc: hourOffset(2), initial_opportunity_analysis_at: hourOffset(2), converted_at_utc: hourOffset(6),
  }),
];
assert.throws(
  () => computeAgt002F1PilotReport({ records: negLatencyFailedRecords, pilot_started_at: PILOT_STARTED_AT, now: NOW }),
  TypeError,
);

// A *pending* last attempt is not terminal: even if its occurred_at_utc predates the first
// attempt's initial_opportunity_analysis_at, it contributes no latency and does not block.
const pendingNoLatencyTenderId = nextTenderId();
const pendingNoLatencyRecords = [
  makeRecord({
    tender_id: pendingNoLatencyTenderId, opportunity_id: `${pendingNoLatencyTenderId}-opp`,
    analysis_attempt_number: 1, idempotency_key: `${pendingNoLatencyTenderId}-idem-1`,
    status: 'failed', failure_class: 'timeout',
    occurred_at_utc: hourOffset(1), initial_opportunity_analysis_at: hourOffset(1), converted_at_utc: hourOffset(6),
  }),
  makeRecord({
    tender_id: pendingNoLatencyTenderId, opportunity_id: `${pendingNoLatencyTenderId}-opp`,
    analysis_attempt_number: 2, idempotency_key: `${pendingNoLatencyTenderId}-idem-2`,
    status: 'pending', failure_class: null, durable: false, human_reviewed: false,
    // Predates the first attempt's initial_opportunity_analysis_at, but pending is not
    // terminal, so this must not block computation and must not report a latency.
    occurred_at_utc: hourOffset(2), initial_opportunity_analysis_at: hourOffset(2), converted_at_utc: hourOffset(6),
  }),
];
const pendingNoLatencyReport = computeAgt002F1PilotReport({
  records: [...pendingNoLatencyRecords, ...healthyOpportunities(9)],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
const pendingNoLatencyOpportunity = pendingNoLatencyReport.opportunities.find((o) => o.tender_id === pendingNoLatencyTenderId);
assert.equal(pendingNoLatencyOpportunity.status, 'pending');
assert.equal(pendingNoLatencyOpportunity.latency_seconds, null);

// A terminal *failed* opportunity (no completed attempt at all) never contributes to
// average_latency_seconds — only completed opportunities do.
const failedTerminalOnlyTenderId = nextTenderId();
const failedTerminalOnlyReport = computeAgt002F1PilotReport({
  records: [
    ...healthyOpportunities(9),
    healthyOpportunity({ tender_id: failedTerminalOnlyTenderId, opportunity_id: `${failedTerminalOnlyTenderId}-opp`, status: 'failed', failure_class: 'timeout' }),
  ],
  pilot_started_at: PILOT_STARTED_AT,
  now: NOW,
});
const failedTerminalOnlyOpportunity = failedTerminalOnlyReport.opportunities.find((o) => o.tender_id === failedTerminalOnlyTenderId);
assert.equal(failedTerminalOnlyOpportunity.status, 'failed');
assert.equal(failedTerminalOnlyOpportunity.latency_seconds, null);
// Each healthy opportunity has a 1-hour latency (occurred_at_utc is 1h after
// initial_opportunity_analysis_at); the failed opportunity must not dilute or skip that average.
assert.equal(failedTerminalOnlyReport.average_latency_seconds, 3600);

// --- Purity: same input twice yields deep-equal output, input is never mutated ------------

const pureInput = healthyOpportunities(10).map((record) => Object.freeze({ ...record }));
const frozenPureInput = Object.freeze([...pureInput]);
const firstRun = computeAgt002F1PilotReport({ records: frozenPureInput, pilot_started_at: PILOT_STARTED_AT, now: NOW });
const secondRun = computeAgt002F1PilotReport({ records: frozenPureInput, pilot_started_at: PILOT_STARTED_AT, now: NOW });
assert.deepEqual(firstRun, secondRun);
assert.equal(frozenPureInput.length, 10);
