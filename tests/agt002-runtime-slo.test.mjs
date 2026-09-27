import assert from 'node:assert/strict';
import {
  AGT002_RUNTIME_SLO_SCHEMA_VERSION,
  AGT002_RUNTIME_SLO_FAILURE_CLASSES,
  AGT002_RUNTIME_SLO_ATTEMPT_KINDS,
  AGT002_RUNTIME_SLO_MIN_NEW_PREANALYSIS_ATTEMPTS,
  AGT002_RUNTIME_SLO_MIN_AVAILABILITY,
  AGT002_RUNTIME_SLO_EXTENDED_WINDOW_DAYS,
  normalizeAgt002RuntimeSloAttempt,
  computeAgt002RuntimeSloReport,
} from '../agt002-runtime-slo.js';

// Pure module coverage: no fs/network/SQL, no schema/API/production wiring, no DANE or
// AGT-003 concerns. All fixtures are synthetic (`synthetic-` id prefixes). `now` is always
// injected so the report is deterministic and never reads the real clock.

// --- Closed catalogs -------------------------------------------------------------------

assert.deepEqual(AGT002_RUNTIME_SLO_FAILURE_CLASSES, [
  'provider_error', 'invalid_output', 'timeout', 'stale_input', 'transport', 'validation', 'persistence',
]);
assert.equal(Object.isFrozen(AGT002_RUNTIME_SLO_FAILURE_CLASSES), true);
assert.deepEqual([...AGT002_RUNTIME_SLO_ATTEMPT_KINDS].sort(), ['new_preanalysis', 'reanalysis']);
assert.equal(Object.isFrozen(AGT002_RUNTIME_SLO_ATTEMPT_KINDS), true);
assert.equal(AGT002_RUNTIME_SLO_MIN_NEW_PREANALYSIS_ATTEMPTS, 100);
assert.equal(AGT002_RUNTIME_SLO_MIN_AVAILABILITY, 0.95);

// --- Fixture helpers ---------------------------------------------------------------------

const NOW = '2026-09-27T12:00:00Z';
const NOW_MS = Date.parse(NOW);

function dayOffset(offsetDays) {
  const date = new Date(NOW_MS);
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return `${date.toISOString().slice(0, 10)}T00:00:00Z`;
}

let idCounter = 0;
function makeAttempt(overrides = {}) {
  idCounter += 1;
  return {
    attempt_id: `synthetic-attempt-${idCounter}`,
    kind: 'new_preanalysis',
    occurred_at_utc: dayOffset(0),
    outcome: 'success',
    failure_class: null,
    eligible: true,
    durable: true,
    provenance_recorded: true,
    opportunity_hidden: false,
    ...overrides,
  };
}

function healthyNewPreanalysisBatch(count, overrides = {}) {
  return Array.from({ length: count }, () => makeAttempt({ kind: 'new_preanalysis', ...overrides }));
}

// --- normalizeAgt002RuntimeSloAttempt: structural fail-closed normalization -------------

// 1. Structurally valid success attempt passes through unchanged.
const validSuccess = makeAttempt();
const normalizedSuccess = normalizeAgt002RuntimeSloAttempt(validSuccess);
assert.equal(normalizedSuccess.valid, true);
assert.deepEqual(normalizedSuccess.errors, []);
assert.equal(normalizedSuccess.attempt_id, validSuccess.attempt_id);
assert.equal(normalizedSuccess.outcome, 'success');
assert.equal(normalizedSuccess.failure_class, null);
assert.equal(Object.isFrozen(normalizedSuccess), true);

// 2. Structurally valid failure attempt with a closed-set failure_class passes through.
const validFailure = makeAttempt({ outcome: 'failure', failure_class: 'timeout', eligible: true });
const normalizedFailure = normalizeAgt002RuntimeSloAttempt(validFailure);
assert.equal(normalizedFailure.valid, true);
assert.equal(normalizedFailure.failure_class, 'timeout');

// 3. Fail-closed forcing: every structural defect below must normalize to the same
// conservative shape — never a success, never durable, never with recorded provenance,
// never claiming an opportunity was safely shown, and always classified as `validation`.
function assertFailClosed(normalized, { keepsId = true } = {}) {
  assert.equal(normalized.valid, false);
  assert.ok(normalized.errors.length > 0);
  assert.equal(normalized.kind, null);
  assert.equal(normalized.occurred_at_utc, null);
  assert.equal(normalized.outcome, 'failure');
  assert.equal(normalized.failure_class, 'validation');
  assert.equal(normalized.eligible, true);
  assert.equal(normalized.durable, false);
  assert.equal(normalized.provenance_recorded, false);
  assert.equal(normalized.opportunity_hidden, true);
  if (!keepsId) assert.equal(normalized.attempt_id, null);
}

assertFailClosed(normalizeAgt002RuntimeSloAttempt(null), { keepsId: false });
assertFailClosed(normalizeAgt002RuntimeSloAttempt('not-an-object'), { keepsId: false });
assertFailClosed(normalizeAgt002RuntimeSloAttempt(['array', 'not', 'object']), { keepsId: false });

const { attempt_id: _missing, ...missingId } = makeAttempt();
assertFailClosed(normalizeAgt002RuntimeSloAttempt(missingId), { keepsId: false });

const withExtraProperty = { ...makeAttempt(), unexpected_field: 'nope' };
const extraNormalized = normalizeAgt002RuntimeSloAttempt(withExtraProperty);
assertFailClosed(extraNormalized);
assert.equal(extraNormalized.attempt_id, withExtraProperty.attempt_id);
assert.ok(extraNormalized.errors.includes('attempt.additional_property'));

const invalidKind = makeAttempt({ kind: 'legacy_scan' });
assert.ok(normalizeAgt002RuntimeSloAttempt(invalidKind).errors.includes('attempt.invalid_kind'));
assertFailClosed(normalizeAgt002RuntimeSloAttempt(invalidKind));

const badTimestampFormat = makeAttempt({ occurred_at_utc: '2026-09-27' });
assert.ok(normalizeAgt002RuntimeSloAttempt(badTimestampFormat).errors.includes('attempt.invalid_timestamp'));

const badTimestampCalendar = makeAttempt({ occurred_at_utc: '2026-02-30T00:00:00Z' });
assert.ok(normalizeAgt002RuntimeSloAttempt(badTimestampCalendar).errors.includes('attempt.invalid_timestamp'));

const invalidOutcome = makeAttempt({ outcome: 'partial' });
assertFailClosed(normalizeAgt002RuntimeSloAttempt(invalidOutcome));

const successWithFailureClass = makeAttempt({ outcome: 'success', failure_class: 'timeout' });
assert.ok(normalizeAgt002RuntimeSloAttempt(successWithFailureClass).errors.includes('attempt.failure_class_must_be_null'));

const failureWithNullClass = makeAttempt({ outcome: 'failure', failure_class: null });
assert.ok(normalizeAgt002RuntimeSloAttempt(failureWithNullClass).errors.includes('attempt.invalid_failure_class'));

const failureWithOpenClass = makeAttempt({ outcome: 'failure', failure_class: 'network_flaky' });
assert.ok(normalizeAgt002RuntimeSloAttempt(failureWithOpenClass).errors.includes('attempt.invalid_failure_class'));

for (const field of ['eligible', 'durable', 'provenance_recorded', 'opportunity_hidden']) {
  const bad = makeAttempt({ [field]: 'yes' });
  const result = normalizeAgt002RuntimeSloAttempt(bad);
  assert.ok(result.errors.some((error) => error.startsWith('attempt.invalid_')), `field ${field} should be flagged`);
  assertFailClosed(result);
}

// --- computeAgt002RuntimeSloReport: input guards ----------------------------------------

assert.throws(() => computeAgt002RuntimeSloReport({ attempts: 'nope', now: NOW }), TypeError);
assert.throws(() => computeAgt002RuntimeSloReport({ attempts: [], now: 'not-a-timestamp' }), TypeError);
assert.throws(() => computeAgt002RuntimeSloReport({ attempts: [], now: undefined }), TypeError);

// --- computeAgt002RuntimeSloReport: duplicate attempt_id fails closed -------------------
// A duplicate attempt_id anywhere in the input must throw, even when the duplicates span
// different kinds/segments or land in different time windows — never silently accepted.

const dupId = 'synthetic-attempt-duplicate';
assert.throws(
  () => computeAgt002RuntimeSloReport({
    attempts: [makeAttempt({ attempt_id: dupId }), makeAttempt({ attempt_id: dupId })],
    now: NOW,
  }),
  TypeError,
);

// Duplicate across kinds (new_preanalysis vs reanalysis) still fails closed.
assert.throws(
  () => computeAgt002RuntimeSloReport({
    attempts: [
      makeAttempt({ attempt_id: dupId, kind: 'new_preanalysis' }),
      makeAttempt({ attempt_id: dupId, kind: 'reanalysis' }),
    ],
    now: NOW,
  }),
  TypeError,
);

// Duplicate across windows (14-day vs 30-day-only) still fails closed.
assert.throws(
  () => computeAgt002RuntimeSloReport({
    attempts: [
      makeAttempt({ attempt_id: dupId, occurred_at_utc: dayOffset(0) }),
      makeAttempt({ attempt_id: dupId, occurred_at_utc: dayOffset(20) }),
    ],
    now: NOW,
  }),
  TypeError,
);

// A large otherwise-healthy batch with exactly one duplicated id anywhere in it must still
// fail closed rather than being outvoted by the healthy majority.
const batch99 = healthyNewPreanalysisBatch(99);
const dupWithinBatch = makeAttempt({ attempt_id: batch99[0].attempt_id });
assert.throws(
  () => computeAgt002RuntimeSloReport({ attempts: [...batch99, dupWithinBatch], now: NOW }),
  TypeError,
);

// Structurally invalid records with a valid (non-empty-string) attempt_id are still subject
// to the duplicate check even though they'd otherwise be forced into a failure record.
const invalidWithDupId = { ...makeAttempt({ attempt_id: dupId }), kind: 'legacy_scan' };
assert.throws(
  () => computeAgt002RuntimeSloReport({
    attempts: [makeAttempt({ attempt_id: dupId }), invalidWithDupId],
    now: NOW,
  }),
  TypeError,
);

// Non-string/empty attempt_id values are not comparable identities and must not spuriously
// trigger the duplicate guard (their own structural invalidity is handled separately).
const { attempt_id: _missingA, ...missingIdA } = makeAttempt();
const { attempt_id: _missingB, ...missingIdB } = makeAttempt();
assert.doesNotThrow(() => computeAgt002RuntimeSloReport({ attempts: [missingIdA, missingIdB], now: NOW }));

// --- Report shape: no acceptance marker beyond accepted/blockers ------------------------

const emptyReport = computeAgt002RuntimeSloReport({ attempts: [], now: NOW });
assert.deepEqual(Object.keys(emptyReport).sort(), [
  'accepted', 'blockers', 'future_dated_attempts', 'new_preanalysis', 'now',
  'reanalysis', 'schema_version', 'structurally_invalid_attempts', 'window_days',
].sort());
assert.equal(emptyReport.schema_version, AGT002_RUNTIME_SLO_SCHEMA_VERSION);
assert.equal(emptyReport.accepted, false);
assert.ok(emptyReport.blockers.length > 0);
assert.equal(Object.isFrozen(emptyReport), true);
assert.equal(Object.isFrozen(emptyReport.blockers), true);
assert.equal(Object.isFrozen(emptyReport.new_preanalysis), true);

// --- Insufficient data: fewer than 100 new_preanalysis attempts even after extension ----

const insufficient = computeAgt002RuntimeSloReport({ attempts: healthyNewPreanalysisBatch(40), now: NOW });
assert.equal(insufficient.accepted, false);
assert.equal(insufficient.window_days, AGT002_RUNTIME_SLO_EXTENDED_WINDOW_DAYS);
assert.ok(insufficient.blockers.some((b) => b.includes('insufficient new_preanalysis attempts')));

// --- Healthy baseline: 100 successful, eligible, durable, provenance-recorded attempts --
// for both new_preanalysis and reanalysis (reanalysis must clear the same sample bar).

const healthy = computeAgt002RuntimeSloReport({
  attempts: [...healthyNewPreanalysisBatch(100), ...healthyNewPreanalysisBatch(100, { kind: 'reanalysis' })],
  now: NOW,
});
assert.equal(healthy.window_days, 14);
assert.equal(healthy.new_preanalysis.total_attempts, 100);
assert.equal(healthy.new_preanalysis.availability, 1);
assert.equal(healthy.new_preanalysis.failures_classified_rate, 1);
assert.equal(healthy.new_preanalysis.durable_with_provenance_rate, 1);
assert.equal(healthy.new_preanalysis.hidden_opportunities, 0);
assert.deepEqual(healthy.blockers, []);
assert.equal(healthy.accepted, true);
assert.equal(healthy.reanalysis.total_attempts, 100);
assert.equal(healthy.reanalysis.failures_classified_rate, 1);
assert.equal(healthy.reanalysis.durable_with_provenance_rate, 1);

// --- Reanalysis must clear the same plan §9.3 sample gate as new_preanalysis: zero or
// insufficient reanalysis volume blocks acceptance with an explicit blocker and is never a
// vacuous pass, even when new_preanalysis is otherwise fully healthy. ---

const zeroReanalysis = computeAgt002RuntimeSloReport({ attempts: healthyNewPreanalysisBatch(100), now: NOW });
assert.equal(zeroReanalysis.reanalysis.total_attempts, 0);
assert.equal(zeroReanalysis.accepted, false);
assert.ok(zeroReanalysis.blockers.some((b) => b.includes('insufficient reanalysis attempts: 0 < 100')));

const fewReanalysis = computeAgt002RuntimeSloReport({
  attempts: [...healthyNewPreanalysisBatch(100), ...healthyNewPreanalysisBatch(40, { kind: 'reanalysis' })],
  now: NOW,
});
assert.equal(fewReanalysis.accepted, false);
assert.ok(fewReanalysis.blockers.some((b) => b.includes('insufficient reanalysis attempts: 40 < 100')));

// Reanalysis also benefits from the 14-day -> 30-day window extension, same as new_preanalysis.
const reanalysisRecent = healthyNewPreanalysisBatch(60, { kind: 'reanalysis' });
const reanalysisOlder = Array.from({ length: 50 }, () => makeAttempt({ kind: 'reanalysis', occurred_at_utc: dayOffset(20) }));
const reanalysisExtended = computeAgt002RuntimeSloReport({
  attempts: [...healthyNewPreanalysisBatch(100), ...reanalysisRecent, ...reanalysisOlder],
  now: NOW,
});
assert.equal(reanalysisExtended.window_days, 30);
assert.equal(reanalysisExtended.reanalysis.total_attempts, 110);
assert.equal(reanalysisExtended.accepted, true);

// --- Availability threshold: exactly 95% passes, 94% fails ------------------------------

function batchWithFailureRate(successCount, failureCount) {
  const successes = healthyNewPreanalysisBatch(successCount);
  const failures = Array.from({ length: failureCount }, () => makeAttempt({
    kind: 'new_preanalysis', outcome: 'failure', failure_class: 'provider_error',
  }));
  return [...successes, ...failures];
}

const at95 = computeAgt002RuntimeSloReport({
  attempts: [...batchWithFailureRate(95, 5), ...healthyNewPreanalysisBatch(100, { kind: 'reanalysis' })],
  now: NOW,
});
assert.equal(at95.new_preanalysis.availability, 0.95);
assert.equal(at95.accepted, true);

const at94 = computeAgt002RuntimeSloReport({ attempts: batchWithFailureRate(94, 6), now: NOW });
assert.ok(at94.new_preanalysis.availability < 0.95);
assert.equal(at94.accepted, false);
assert.ok(at94.blockers.some((b) => b.includes('availability below')));

// --- Ineligible attempts are excluded from the availability denominator ----------------

const withIneligible = [
  ...healthyNewPreanalysisBatch(100),
  ...Array.from({ length: 20 }, () => makeAttempt({
    kind: 'new_preanalysis', outcome: 'failure', failure_class: 'stale_input', eligible: false,
  })),
];
const ineligibleReport = computeAgt002RuntimeSloReport({ attempts: withIneligible, now: NOW });
assert.equal(ineligibleReport.new_preanalysis.eligible_attempts, 100);
assert.equal(ineligibleReport.new_preanalysis.availability, 1);
assert.equal(ineligibleReport.new_preanalysis.total_attempts, 120);
// Ineligible failures still count toward the classification/durability/hidden invariants.
assert.equal(ineligibleReport.new_preanalysis.failures, 20);
assert.equal(ineligibleReport.new_preanalysis.failures_classified_rate, 1);

// --- Window extension: <100 within 14 days but >=100 within 30 days --------------------

const recent = healthyNewPreanalysisBatch(60); // day offset 0, inside 14-day window
const older = Array.from({ length: 50 }, () => makeAttempt({
  kind: 'new_preanalysis', occurred_at_utc: dayOffset(20),
})); // inside 30-day window, outside 14-day window
const extended = computeAgt002RuntimeSloReport({
  attempts: [...recent, ...older, ...healthyNewPreanalysisBatch(100, { kind: 'reanalysis' })],
  now: NOW,
});
assert.equal(extended.window_days, 30);
assert.equal(extended.new_preanalysis.total_attempts, 110);
assert.equal(extended.accepted, true);

// --- Window boundaries: day 13 included in 14-day window, day 14 excluded --------------

const boundaryIncluded = makeAttempt({ occurred_at_utc: dayOffset(13) });
const boundaryExcluded = makeAttempt({ occurred_at_utc: dayOffset(14) });
const boundaryReanalysis = healthyNewPreanalysisBatch(100, { kind: 'reanalysis' });
const boundaryBatch = [...healthyNewPreanalysisBatch(99), boundaryIncluded, ...boundaryReanalysis];
const boundaryReport = computeAgt002RuntimeSloReport({ attempts: boundaryBatch, now: NOW });
assert.equal(boundaryReport.window_days, 14);
assert.equal(boundaryReport.new_preanalysis.total_attempts, 100);

const excludedBatch = [...healthyNewPreanalysisBatch(99), boundaryExcluded, ...boundaryReanalysis];
const excludedReport = computeAgt002RuntimeSloReport({ attempts: excludedBatch, now: NOW });
// day-14 attempt does not count toward the 14-day window, so only 99 remain there and the
// report must extend to the 30-day window (where the day-14 attempt is included).
assert.equal(excludedReport.window_days, 30);
assert.equal(excludedReport.new_preanalysis.total_attempts, 100);

// --- Structurally invalid attempts always block acceptance, even in an otherwise healthy set

const { attempt_id: _dropId, ...brokenAttempt } = makeAttempt({ kind: 'new_preanalysis' });
const withBroken = computeAgt002RuntimeSloReport({ attempts: [...healthyNewPreanalysisBatch(100), brokenAttempt], now: NOW });
assert.equal(withBroken.structurally_invalid_attempts, 1);
assert.equal(withBroken.accepted, false);
assert.ok(withBroken.blockers.some((b) => b.includes('failed structural normalization')));
// The broken record cannot be attributed to a kind, so it never inflates new_preanalysis volume.
assert.equal(withBroken.new_preanalysis.total_attempts, 100);

// --- Future-dated attempts are flagged and excluded from window accounting -------------

const futureAttempt = makeAttempt({ kind: 'new_preanalysis', occurred_at_utc: '2026-09-28T00:00:00Z' });
const withFuture = computeAgt002RuntimeSloReport({ attempts: [...healthyNewPreanalysisBatch(100), futureAttempt], now: NOW });
assert.equal(withFuture.future_dated_attempts, 1);
assert.equal(withFuture.accepted, false);
assert.ok(withFuture.blockers.some((b) => b.includes('after the injected now')));
assert.equal(withFuture.new_preanalysis.total_attempts, 100);

// --- 100% durable state + provenance requirement ---------------------------------------

const notDurable = makeAttempt({ kind: 'new_preanalysis', durable: false });
const withNotDurable = computeAgt002RuntimeSloReport({ attempts: [...healthyNewPreanalysisBatch(99), notDurable], now: NOW });
assert.ok(withNotDurable.new_preanalysis.durable_with_provenance_rate < 1);
assert.equal(withNotDurable.accepted, false);
assert.ok(withNotDurable.blockers.some((b) => b.includes('not 100% durable with provenance')));

const noProvenance = makeAttempt({ kind: 'new_preanalysis', provenance_recorded: false });
const withNoProvenance = computeAgt002RuntimeSloReport({ attempts: [...healthyNewPreanalysisBatch(99), noProvenance], now: NOW });
assert.equal(withNoProvenance.accepted, false);
assert.ok(withNoProvenance.blockers.some((b) => b.includes('not 100% durable with provenance')));

// --- Zero opportunities hidden due to AI failure ----------------------------------------

const hidingFailure = makeAttempt({
  kind: 'new_preanalysis', outcome: 'failure', failure_class: 'invalid_output', opportunity_hidden: true,
});
const withHidden = computeAgt002RuntimeSloReport({ attempts: [...healthyNewPreanalysisBatch(99), hidingFailure], now: NOW });
assert.equal(withHidden.new_preanalysis.hidden_opportunities, 1);
assert.equal(withHidden.accepted, false);
assert.ok(withHidden.blockers.some((b) => b.includes('hid 1 opportunity(ies) due to AI failure')));

// --- Reanalysis is tracked and gated separately from new_preanalysis -------------------

const reanalysisNotDurable = Array.from({ length: 5 }, () => makeAttempt({ kind: 'reanalysis', durable: false }));
const separated = computeAgt002RuntimeSloReport({
  attempts: [
    ...healthyNewPreanalysisBatch(100),
    ...healthyNewPreanalysisBatch(95, { kind: 'reanalysis' }),
    ...reanalysisNotDurable,
  ],
  now: NOW,
});
// new_preanalysis stays fully healthy; the reanalysis defect never leaks into its stats.
assert.equal(separated.new_preanalysis.total_attempts, 100);
assert.equal(separated.new_preanalysis.durable_with_provenance_rate, 1);
assert.equal(separated.reanalysis.total_attempts, 100);
assert.ok(separated.reanalysis.durable_with_provenance_rate < 1);
assert.equal(separated.accepted, false);
assert.ok(separated.blockers.some((b) => b.includes('reanalysis attempts are not 100% durable with provenance')));
// Reanalysis volume never counts toward (or substitutes for) the new_preanalysis minimum.
const reanalysisOnly = computeAgt002RuntimeSloReport({
  attempts: Array.from({ length: 200 }, () => makeAttempt({ kind: 'reanalysis' })),
  now: NOW,
});
assert.equal(reanalysisOnly.new_preanalysis.total_attempts, 0);
assert.equal(reanalysisOnly.accepted, false);
assert.ok(reanalysisOnly.blockers.some((b) => b.includes('insufficient new_preanalysis attempts')));

// --- Purity: same input twice yields deep-equal output, input is never mutated ---------

const pureInput = healthyNewPreanalysisBatch(100).map((attempt) => Object.freeze({ ...attempt }));
const frozenPureInput = Object.freeze([...pureInput]);
const firstRun = computeAgt002RuntimeSloReport({ attempts: frozenPureInput, now: NOW });
const secondRun = computeAgt002RuntimeSloReport({ attempts: frozenPureInput, now: NOW });
assert.deepEqual(firstRun, secondRun);
assert.equal(frozenPureInput.length, 100);
