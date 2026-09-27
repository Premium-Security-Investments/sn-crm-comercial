// AGT-002 runtime SLO report. Pure function module — no IO/fs/red/SQL, no schema/API
// surface, no production wiring. Computes an honest availability report for AI attempt
// records with `now` injected by the caller so results are deterministic and testable.
// Scope is intentionally narrow: this file does not touch DANE or AGT-003 concerns.

export const AGT002_RUNTIME_SLO_SCHEMA_VERSION = 'agt002-runtime-slo-v1';

// Closed catalog: exactly these seven failure classes, no others are ever emitted.
export const AGT002_RUNTIME_SLO_FAILURE_CLASSES = Object.freeze([
  'provider_error', 'invalid_output', 'timeout', 'stale_input', 'transport', 'validation', 'persistence',
]);

export const AGT002_RUNTIME_SLO_ATTEMPT_KINDS = Object.freeze(['new_preanalysis', 'reanalysis']);

export const AGT002_RUNTIME_SLO_MIN_NEW_PREANALYSIS_ATTEMPTS = 100;
export const AGT002_RUNTIME_SLO_MIN_AVAILABILITY = 0.95;
export const AGT002_RUNTIME_SLO_PRIMARY_WINDOW_DAYS = 14;
export const AGT002_RUNTIME_SLO_EXTENDED_WINDOW_DAYS = 30;

const RAW_ATTEMPT_KEYS = Object.freeze([
  'attempt_id', 'kind', 'occurred_at_utc', 'outcome', 'failure_class',
  'eligible', 'durable', 'provenance_recorded', 'opportunity_hidden',
]);

const RFC3339_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function isBoolean(value) { return typeof value === 'boolean'; }

function isLeapYear(year) { return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0; }
function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function timestampFormatValid(value) { return typeof value === 'string' && RFC3339_UTC_RE.test(value); }
function timestampCalendarValid(value) {
  const match = RFC3339_UTC_RE.exec(value);
  if (!match) return false;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr); const month = Number(monthStr); const day = Number(dayStr);
  const hour = Number(hourStr); const minute = Number(minuteStr); const second = Number(secondStr);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return true;
}
function isValidTimestamp(value) { return timestampFormatValid(value) && timestampCalendarValid(value); }
function calendarDayNumber(value) {
  const match = RFC3339_UTC_RE.exec(value);
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

// Structural-only checks: shape, types, enum membership, and the outcome/failure_class
// coherence pair. Nothing here interprets business meaning beyond the declared fields.
function structuralErrors(raw) {
  const errors = [];
  const push = (reason) => { if (!errors.includes(reason)) errors.push(reason); };
  if (!isPlainObject(raw)) { push('attempt.not_object'); return errors; }

  const keySet = new Set(RAW_ATTEMPT_KEYS);
  for (const key of Object.keys(raw)) if (!keySet.has(key)) push('attempt.additional_property');
  for (const key of RAW_ATTEMPT_KEYS) if (!(key in raw)) push('attempt.missing_property');

  if (!isNonEmptyString(raw.attempt_id)) push('attempt.invalid_id');
  if (!AGT002_RUNTIME_SLO_ATTEMPT_KINDS.includes(raw.kind)) push('attempt.invalid_kind');
  if (!isValidTimestamp(raw.occurred_at_utc)) push('attempt.invalid_timestamp');

  if (raw.outcome !== 'success' && raw.outcome !== 'failure') {
    push('attempt.invalid_outcome');
  } else if (raw.outcome === 'success') {
    if (raw.failure_class !== null) push('attempt.failure_class_must_be_null');
  } else if (!AGT002_RUNTIME_SLO_FAILURE_CLASSES.includes(raw.failure_class)) {
    push('attempt.invalid_failure_class');
  }

  if (!isBoolean(raw.eligible)) push('attempt.invalid_eligible');
  if (!isBoolean(raw.durable)) push('attempt.invalid_durable');
  if (!isBoolean(raw.provenance_recorded)) push('attempt.invalid_provenance_recorded');
  if (!isBoolean(raw.opportunity_hidden)) push('attempt.invalid_opportunity_hidden');
  return errors;
}

// Fail-closed normalization: a structurally valid record passes through untouched; any
// structural defect is forced into a conservative failure record that can never be mistaken
// for a success, can never be silently dropped from classification, and can never claim
// durable/provenance/visibility guarantees it did not earn.
export function normalizeAgt002RuntimeSloAttempt(raw) {
  const errors = structuralErrors(raw);
  if (errors.length === 0) {
    return Object.freeze({
      valid: true,
      errors: Object.freeze([]),
      attempt_id: raw.attempt_id,
      kind: raw.kind,
      occurred_at_utc: raw.occurred_at_utc,
      outcome: raw.outcome,
      failure_class: raw.failure_class,
      eligible: raw.eligible,
      durable: raw.durable,
      provenance_recorded: raw.provenance_recorded,
      opportunity_hidden: raw.opportunity_hidden,
    });
  }
  const salvageId = isPlainObject(raw) && isNonEmptyString(raw.attempt_id) ? raw.attempt_id : null;
  return Object.freeze({
    valid: false,
    errors: Object.freeze(errors),
    attempt_id: salvageId,
    kind: null,
    occurred_at_utc: null,
    outcome: 'failure',
    failure_class: 'validation',
    eligible: true,
    durable: false,
    provenance_recorded: false,
    opportunity_hidden: true,
  });
}

// Fail-closed identity guard: an attempt_id must uniquely identify one attempt across the
// entire input, independent of kind/segment/window. A duplicate signals corrupted or
// replayed input, so it blocks computation outright rather than being silently absorbed.
function findDuplicateAttemptIds(rawAttempts) {
  const seen = new Set();
  const duplicates = new Set();
  for (const raw of rawAttempts) {
    if (!isPlainObject(raw) || !isNonEmptyString(raw.attempt_id)) continue;
    if (seen.has(raw.attempt_id)) duplicates.add(raw.attempt_id);
    else seen.add(raw.attempt_id);
  }
  return [...duplicates];
}

function summarizeSegment(list) {
  const eligible = list.filter((attempt) => attempt.eligible);
  const successful = eligible.filter((attempt) => attempt.outcome === 'success');
  const failures = list.filter((attempt) => attempt.outcome === 'failure');
  const classifiedFailures = failures.filter((attempt) => AGT002_RUNTIME_SLO_FAILURE_CLASSES.includes(attempt.failure_class));
  const durableWithProvenance = list.filter((attempt) => attempt.durable && attempt.provenance_recorded);
  const hiddenOpportunities = failures.filter((attempt) => attempt.opportunity_hidden);
  return Object.freeze({
    total_attempts: list.length,
    eligible_attempts: eligible.length,
    successful_attempts: successful.length,
    availability: eligible.length ? successful.length / eligible.length : null,
    failures: failures.length,
    failures_classified: classifiedFailures.length,
    failures_classified_rate: failures.length ? classifiedFailures.length / failures.length : 1,
    durable_with_provenance: durableWithProvenance.length,
    durable_with_provenance_rate: list.length ? durableWithProvenance.length / list.length : 1,
    hidden_opportunities: hiddenOpportunities.length,
  });
}

// Computes the SLO report for a fixed `now`. `accepted` is always derived from `blockers`
// (never hardcoded true) and the report never carries any other acceptance-shaped marker —
// callers must read `accepted`/`blockers`, there is no separate "certified" style field.
export function computeAgt002RuntimeSloReport({ attempts, now } = {}) {
  if (!Array.isArray(attempts)) throw new TypeError('AGT002_RUNTIME_SLO_INVALID_INPUT: attempts must be an array');
  if (!isValidTimestamp(now)) throw new TypeError('AGT002_RUNTIME_SLO_INVALID_INPUT: now must be an RFC3339 UTC timestamp');

  const duplicateAttemptIds = findDuplicateAttemptIds(attempts);
  if (duplicateAttemptIds.length > 0) {
    throw new TypeError(`AGT002_RUNTIME_SLO_INVALID_INPUT: duplicate attempt_id(s) detected: ${duplicateAttemptIds.sort().join(', ')}`);
  }

  const nowInstant = Date.parse(now);
  const nowDay = calendarDayNumber(now);
  const normalized = attempts.map(normalizeAgt002RuntimeSloAttempt);

  const structurallyInvalid = normalized.filter((attempt) => !attempt.valid);
  const structurallyValid = normalized.filter((attempt) => attempt.valid);
  const futureDated = structurallyValid.filter((attempt) => Date.parse(attempt.occurred_at_utc) > nowInstant);
  const windowCandidates = structurallyValid.filter((attempt) => Date.parse(attempt.occurred_at_utc) <= nowInstant);

  function inWindow(attempt, days) {
    const day = calendarDayNumber(attempt.occurred_at_utc);
    return day > nowDay - days && day <= nowDay;
  }

  function eligibleCountForKind(list, kind) {
    return list.filter((attempt) => attempt.kind === kind && attempt.eligible).length;
  }

  const window14 = windowCandidates.filter((attempt) => inWindow(attempt, AGT002_RUNTIME_SLO_PRIMARY_WINDOW_DAYS));
  const eligible14NewPreanalysis = eligibleCountForKind(window14, 'new_preanalysis');
  const eligible14Reanalysis = eligibleCountForKind(window14, 'reanalysis');

  // Plan §9.3 sample criterion applies symmetrically to both attempt kinds: 14-day window
  // with >=100 eligible attempts, otherwise extend to 30 days. If either kind is short at
  // 14 days, the whole report extends so neither segment is judged on a starved sample.
  let windowDays = AGT002_RUNTIME_SLO_PRIMARY_WINDOW_DAYS;
  let windowAttempts = window14;
  if (
    eligible14NewPreanalysis < AGT002_RUNTIME_SLO_MIN_NEW_PREANALYSIS_ATTEMPTS ||
    eligible14Reanalysis < AGT002_RUNTIME_SLO_MIN_NEW_PREANALYSIS_ATTEMPTS
  ) {
    windowDays = AGT002_RUNTIME_SLO_EXTENDED_WINDOW_DAYS;
    windowAttempts = windowCandidates.filter((attempt) => inWindow(attempt, AGT002_RUNTIME_SLO_EXTENDED_WINDOW_DAYS));
  }

  const newPreanalysis = summarizeSegment(windowAttempts.filter((attempt) => attempt.kind === 'new_preanalysis'));
  const reanalysis = summarizeSegment(windowAttempts.filter((attempt) => attempt.kind === 'reanalysis'));

  const blockers = [];
  if (structurallyInvalid.length > 0) blockers.push(`${structurallyInvalid.length} attempt record(s) failed structural normalization`);
  if (futureDated.length > 0) blockers.push(`${futureDated.length} attempt record(s) have occurred_at_utc after the injected now`);

  if (newPreanalysis.eligible_attempts < AGT002_RUNTIME_SLO_MIN_NEW_PREANALYSIS_ATTEMPTS) {
    blockers.push(`insufficient new_preanalysis attempts: ${newPreanalysis.eligible_attempts} < ${AGT002_RUNTIME_SLO_MIN_NEW_PREANALYSIS_ATTEMPTS} within ${windowDays}-day window`);
  } else {
    if (newPreanalysis.availability === null || newPreanalysis.availability < AGT002_RUNTIME_SLO_MIN_AVAILABILITY) {
      blockers.push(`new_preanalysis availability below ${AGT002_RUNTIME_SLO_MIN_AVAILABILITY} threshold`);
    }
    if (newPreanalysis.failures_classified_rate < 1) blockers.push('new_preanalysis failures are not 100% classified');
    if (newPreanalysis.durable_with_provenance_rate < 1) blockers.push('new_preanalysis attempts are not 100% durable with provenance');
    if (newPreanalysis.hidden_opportunities > 0) blockers.push(`new_preanalysis hid ${newPreanalysis.hidden_opportunities} opportunity(ies) due to AI failure`);
  }

  // Same sample criterion as new_preanalysis (plan §9.3): a starved or empty reanalysis
  // sample blocks acceptance with an explicit reason rather than vacuously passing because
  // there was nothing to fail.
  if (reanalysis.eligible_attempts < AGT002_RUNTIME_SLO_MIN_NEW_PREANALYSIS_ATTEMPTS) {
    blockers.push(`insufficient reanalysis attempts: ${reanalysis.eligible_attempts} < ${AGT002_RUNTIME_SLO_MIN_NEW_PREANALYSIS_ATTEMPTS} within ${windowDays}-day window`);
  } else {
    if (reanalysis.failures_classified_rate < 1) blockers.push('reanalysis failures are not 100% classified');
    if (reanalysis.durable_with_provenance_rate < 1) blockers.push('reanalysis attempts are not 100% durable with provenance');
    if (reanalysis.hidden_opportunities > 0) blockers.push(`reanalysis hid ${reanalysis.hidden_opportunities} opportunity(ies) due to AI failure`);
  }

  const accepted = blockers.length === 0;

  return Object.freeze({
    schema_version: AGT002_RUNTIME_SLO_SCHEMA_VERSION,
    now,
    window_days: windowDays,
    structurally_invalid_attempts: structurallyInvalid.length,
    future_dated_attempts: futureDated.length,
    new_preanalysis: newPreanalysis,
    reanalysis,
    accepted,
    blockers: Object.freeze(blockers),
  });
}
