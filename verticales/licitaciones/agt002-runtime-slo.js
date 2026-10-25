// AGT-002 F1 pilot report (v2, 10-opportunity pilot). Pure function module — no IO/fs/net/SQL,
// no schema/API surface, no production wiring. Computes an honest pilot completion report for
// AI opportunity-analysis records with `now` injected by the caller so results are deterministic
// and testable. This replaces the earlier rolling-window SLO report: there are no time windows
// and no availability SLO here, only a fixed target of the first 10 eligible opportunities since
// the pilot started. Scope is intentionally narrow: this file does not touch DANE concerns.

export const AGT002_F1_PILOT_SCHEMA_VERSION = 'agt002-f1-pilot-v2';

// Closed catalog: exactly these seven failure classes, no others are ever emitted.
export const AGT002_F1_PILOT_FAILURE_CLASSES = Object.freeze([
  'provider_error', 'invalid_output', 'timeout', 'stale_input', 'transport', 'validation', 'persistence',
]);

export const AGT002_F1_PILOT_RECORD_STATUSES = Object.freeze(['completed', 'failed', 'pending']);

export const AGT002_F1_PILOT_TARGET_OPPORTUNITIES = 10;

// Closed catalog: only `initial_opportunity_analysis` is eligible for the pilot cohort.
// `reanalysis` and `radar_preanalysis` are structurally valid analysis kinds, but never eligible.
export const AGT002_F1_PILOT_ANALYSIS_KINDS = Object.freeze([
  'initial_opportunity_analysis', 'reanalysis', 'radar_preanalysis',
]);

const RAW_RECORD_KEYS = Object.freeze([
  'record_id', 'tender_id', 'opportunity_id', 'occurred_at_utc',
  'analysis_kind',
  'production', 'real_data', 'human_converted', 'conversion_completed',
  'initial_opportunity_analysis_at', 'converted_at_utc',
  'analysis_attempt_id', 'analysis_attempt_number', 'idempotency_key',
  'status', 'failure_class', 'durable', 'provenance_recorded', 'visible', 'human_reviewed',
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

// Structural-only checks: shape, types, enum membership, and the status/failure_class
// coherence pair. Nothing here interprets eligibility or pilot-membership.
function structuralErrors(raw) {
  const errors = [];
  const push = (reason) => { if (!errors.includes(reason)) errors.push(reason); };
  if (!isPlainObject(raw)) { push('record.not_object'); return errors; }

  const keySet = new Set(RAW_RECORD_KEYS);
  for (const key of Object.keys(raw)) if (!keySet.has(key)) push('record.additional_property');
  for (const key of RAW_RECORD_KEYS) if (!(key in raw)) push('record.missing_property');

  if (!isNonEmptyString(raw.record_id)) push('record.invalid_id');
  if (!isNonEmptyString(raw.tender_id)) push('record.invalid_tender_id');
  if (!isNonEmptyString(raw.opportunity_id)) push('record.invalid_opportunity_id');
  if (!isValidTimestamp(raw.occurred_at_utc)) push('record.invalid_occurred_at');
  if (!AGT002_F1_PILOT_ANALYSIS_KINDS.includes(raw.analysis_kind)) push('record.invalid_analysis_kind');
  if (!isValidTimestamp(raw.initial_opportunity_analysis_at)) push('record.invalid_initial_opportunity_analysis_at');
  if (!isValidTimestamp(raw.converted_at_utc)) push('record.invalid_converted_at');

  if (isValidTimestamp(raw.converted_at_utc) && isValidTimestamp(raw.occurred_at_utc)
    && Date.parse(raw.occurred_at_utc) < Date.parse(raw.converted_at_utc)) {
    push('record.occurred_before_converted');
  }
  if (isValidTimestamp(raw.converted_at_utc) && isValidTimestamp(raw.initial_opportunity_analysis_at)
    && Date.parse(raw.initial_opportunity_analysis_at) < Date.parse(raw.converted_at_utc)) {
    push('record.analysis_start_before_converted');
  }

  if (!isNonEmptyString(raw.analysis_attempt_id)) push('record.invalid_analysis_attempt_id');
  if (!(Number.isInteger(raw.analysis_attempt_number) && raw.analysis_attempt_number >= 1)) {
    push('record.invalid_analysis_attempt_number');
  }
  if (!isNonEmptyString(raw.idempotency_key)) push('record.invalid_idempotency_key');

  if (!isBoolean(raw.production)) push('record.invalid_production');
  if (!isBoolean(raw.real_data)) push('record.invalid_real_data');
  if (!isBoolean(raw.human_converted)) push('record.invalid_human_converted');
  if (!isBoolean(raw.conversion_completed)) push('record.invalid_conversion_completed');

  if (!AGT002_F1_PILOT_RECORD_STATUSES.includes(raw.status)) {
    push('record.invalid_status');
  } else if (raw.status === 'failed') {
    if (!AGT002_F1_PILOT_FAILURE_CLASSES.includes(raw.failure_class)) push('record.invalid_failure_class');
  } else if (raw.failure_class !== null) {
    push('record.failure_class_must_be_null');
  }

  if (!isBoolean(raw.durable)) push('record.invalid_durable');
  if (!isBoolean(raw.provenance_recorded)) push('record.invalid_provenance_recorded');
  if (!isBoolean(raw.visible)) push('record.invalid_visible');
  if (!isBoolean(raw.human_reviewed)) push('record.invalid_human_reviewed');
  return errors;
}

// Fail-closed normalization: a structurally valid record passes through untouched; any
// structural defect is forced into a conservative failure record that can never be mistaken
// for eligible/completed, can never be silently dropped from classification, and can never
// claim durable/provenance/visibility/review guarantees it did not earn.
export function normalizeAgt002F1PilotRecord(raw) {
  const errors = structuralErrors(raw);
  if (errors.length === 0) {
    return Object.freeze({
      valid: true,
      errors: Object.freeze([]),
      record_id: raw.record_id,
      tender_id: raw.tender_id,
      opportunity_id: raw.opportunity_id,
      occurred_at_utc: raw.occurred_at_utc,
      analysis_kind: raw.analysis_kind,
      production: raw.production,
      real_data: raw.real_data,
      human_converted: raw.human_converted,
      conversion_completed: raw.conversion_completed,
      initial_opportunity_analysis_at: raw.initial_opportunity_analysis_at,
      converted_at_utc: raw.converted_at_utc,
      analysis_attempt_id: raw.analysis_attempt_id,
      analysis_attempt_number: raw.analysis_attempt_number,
      idempotency_key: raw.idempotency_key,
      status: raw.status,
      failure_class: raw.failure_class,
      durable: raw.durable,
      provenance_recorded: raw.provenance_recorded,
      visible: raw.visible,
      human_reviewed: raw.human_reviewed,
    });
  }
  const salvageId = isPlainObject(raw) && isNonEmptyString(raw.record_id) ? raw.record_id : null;
  return Object.freeze({
    valid: false,
    errors: Object.freeze(errors),
    record_id: salvageId,
    tender_id: null,
    opportunity_id: null,
    occurred_at_utc: null,
    analysis_kind: null,
    production: false,
    real_data: false,
    human_converted: false,
    conversion_completed: false,
    initial_opportunity_analysis_at: null,
    converted_at_utc: null,
    analysis_attempt_id: null,
    analysis_attempt_number: null,
    idempotency_key: null,
    status: 'failed',
    failure_class: 'validation',
    durable: false,
    provenance_recorded: false,
    visible: false,
    human_reviewed: false,
  });
}

// Fail-closed identity guard: a record_id must uniquely identify one record across the entire
// input. A duplicate signals corrupted or replayed input, so it blocks computation outright.
function findDuplicateRecordIds(rawRecords) {
  const seen = new Set();
  const duplicates = new Set();
  for (const raw of rawRecords) {
    if (!isPlainObject(raw) || !isNonEmptyString(raw.record_id)) continue;
    if (seen.has(raw.record_id)) duplicates.add(raw.record_id);
    else seen.add(raw.record_id);
  }
  return [...duplicates];
}

// Fail-closed identity guard: tender_id <-> opportunity_id must be a stable one-to-one mapping.
// A tender_id pointing at more than one opportunity_id (or vice versa) signals corrupted or
// cross-wired input, so it blocks computation outright rather than being silently absorbed.
function findOpportunityConflicts(rawRecords) {
  const tenderToOpportunities = new Map();
  const opportunityToTenders = new Map();
  for (const raw of rawRecords) {
    if (!isPlainObject(raw) || !isNonEmptyString(raw.tender_id) || !isNonEmptyString(raw.opportunity_id)) continue;
    if (!tenderToOpportunities.has(raw.tender_id)) tenderToOpportunities.set(raw.tender_id, new Set());
    tenderToOpportunities.get(raw.tender_id).add(raw.opportunity_id);
    if (!opportunityToTenders.has(raw.opportunity_id)) opportunityToTenders.set(raw.opportunity_id, new Set());
    opportunityToTenders.get(raw.opportunity_id).add(raw.tender_id);
  }
  const conflicts = [];
  for (const [tenderId, opportunityIds] of tenderToOpportunities) {
    if (opportunityIds.size > 1) {
      conflicts.push(`tender_id ${tenderId} maps to multiple opportunity_id: ${[...opportunityIds].sort().join(', ')}`);
    }
  }
  for (const [opportunityId, tenderIds] of opportunityToTenders) {
    if (tenderIds.size > 1) {
      conflicts.push(`opportunity_id ${opportunityId} maps to multiple tender_id: ${[...tenderIds].sort().join(', ')}`);
    }
  }
  return conflicts.sort();
}

// Fail-closed identity guard: within a tender_id, analysis_attempt_number must uniquely
// identify one attempt, and idempotency_key must uniquely identify one attempt_number. Either
// violation signals a corrupted or misfired retry, so it blocks computation outright.
function findAttemptConflicts(rawRecords) {
  const attemptNumberCounts = new Map();
  const idempotencyKeyAttempts = new Map();
  for (const raw of rawRecords) {
    if (!isPlainObject(raw) || !isNonEmptyString(raw.tender_id)) continue;
    if (!Number.isInteger(raw.analysis_attempt_number) || raw.analysis_attempt_number < 1) continue;
    if (!isNonEmptyString(raw.idempotency_key)) continue;

    if (!attemptNumberCounts.has(raw.tender_id)) attemptNumberCounts.set(raw.tender_id, new Map());
    const counts = attemptNumberCounts.get(raw.tender_id);
    counts.set(raw.analysis_attempt_number, (counts.get(raw.analysis_attempt_number) || 0) + 1);

    if (!idempotencyKeyAttempts.has(raw.tender_id)) idempotencyKeyAttempts.set(raw.tender_id, new Map());
    const keyMap = idempotencyKeyAttempts.get(raw.tender_id);
    if (!keyMap.has(raw.idempotency_key)) keyMap.set(raw.idempotency_key, new Set());
    keyMap.get(raw.idempotency_key).add(raw.analysis_attempt_number);
  }

  const conflicts = [];
  for (const [tenderId, counts] of attemptNumberCounts) {
    for (const [attemptNumber, count] of counts) {
      if (count > 1) conflicts.push(`tender_id ${tenderId} has duplicate analysis_attempt_number ${attemptNumber}`);
    }
  }
  for (const [tenderId, keyMap] of idempotencyKeyAttempts) {
    for (const [idempotencyKey, attemptNumbers] of keyMap) {
      if (attemptNumbers.size > 1) {
        conflicts.push(`tender_id ${tenderId} idempotency_key ${idempotencyKey} maps to multiple analysis_attempt_number: ${[...attemptNumbers].sort((a, b) => a - b).join(', ')}`);
      }
    }
  }
  return conflicts.sort();
}

// Fields that describe the opportunity/tender as a whole, not a single attempt: every attempt
// of the same tender_id must agree on them. Disagreement signals corrupted or cross-wired
// attempt data (e.g. a retry silently reclassified as a `reanalysis`), so it is fail-closed.
const TENDER_CONSISTENCY_FIELDS = Object.freeze([
  'production', 'real_data', 'human_converted', 'conversion_completed', 'analysis_kind', 'converted_at_utc',
]);

// Fail-closed identity guard: within a tender_id, the tender-level fields must be identical
// across every attempt. A mismatch blocks computation outright rather than being silently
// resolved by picking one attempt's value over another's.
function findTenderConsistencyConflicts(structurallyValidRecords) {
  const byTender = new Map();
  for (const record of structurallyValidRecords) {
    if (!byTender.has(record.tender_id)) byTender.set(record.tender_id, []);
    byTender.get(record.tender_id).push(record);
  }
  const conflicts = [];
  for (const [tenderId, attempts] of byTender) {
    if (attempts.length < 2) continue;
    for (const field of TENDER_CONSISTENCY_FIELDS) {
      const values = new Set(attempts.map((attempt) => attempt[field]));
      if (values.size > 1) {
        conflicts.push(`tender_id ${tenderId} has inconsistent ${field} across attempts`);
      }
    }
  }
  return conflicts.sort();
}

function byConvertedThenId(a, b) {
  const diff = Date.parse(a.converted_at_utc) - Date.parse(b.converted_at_utc);
  if (diff !== 0) return diff;
  if (a.record_id < b.record_id) return -1;
  if (a.record_id > b.record_id) return 1;
  return 0;
}

function byAttemptNumber(a, b) { return a.analysis_attempt_number - b.analysis_attempt_number; }

// Computes the F1 pilot report for a fixed `now`. `accepted` is always derived from `blockers`
// (never hardcoded true) and the report never carries any other acceptance-shaped marker —
// callers must read `accepted`/`blockers`.
export function computeAgt002F1PilotReport({ records, pilot_started_at, now } = {}) {
  if (!Array.isArray(records)) throw new TypeError('AGT002_F1_PILOT_INVALID_INPUT: records must be an array');
  if (!isValidTimestamp(pilot_started_at)) {
    throw new TypeError('AGT002_F1_PILOT_INVALID_INPUT: pilot_started_at must be an RFC3339 UTC timestamp');
  }
  if (!isValidTimestamp(now)) throw new TypeError('AGT002_F1_PILOT_INVALID_INPUT: now must be an RFC3339 UTC timestamp');
  if (Date.parse(now) < Date.parse(pilot_started_at)) {
    throw new TypeError('AGT002_F1_PILOT_INVALID_INPUT: now must not be before pilot_started_at');
  }

  const duplicateRecordIds = findDuplicateRecordIds(records);
  if (duplicateRecordIds.length > 0) {
    throw new TypeError(`AGT002_F1_PILOT_INVALID_INPUT: duplicate record_id(s) detected: ${duplicateRecordIds.sort().join(', ')}`);
  }

  const conflicts = findOpportunityConflicts(records);
  if (conflicts.length > 0) {
    throw new TypeError(`AGT002_F1_PILOT_INVALID_INPUT: opportunity_id/tender_id conflict(s) detected: ${conflicts.join('; ')}`);
  }

  const attemptConflicts = findAttemptConflicts(records);
  if (attemptConflicts.length > 0) {
    throw new TypeError(`AGT002_F1_PILOT_INVALID_INPUT: analysis attempt conflict(s) detected: ${attemptConflicts.join('; ')}`);
  }

  const target = AGT002_F1_PILOT_TARGET_OPPORTUNITIES;
  const nowInstant = Date.parse(now);
  const pilotStartInstant = Date.parse(pilot_started_at);
  const normalized = records.map(normalizeAgt002F1PilotRecord);

  const structurallyInvalid = normalized.filter((record) => !record.valid);
  const structurallyValid = normalized.filter((record) => record.valid);

  const tenderConsistencyConflicts = findTenderConsistencyConflicts(structurallyValid);
  if (tenderConsistencyConflicts.length > 0) {
    throw new TypeError(`AGT002_F1_PILOT_INVALID_INPUT: tender consistency conflict(s) detected: ${tenderConsistencyConflicts.join('; ')}`);
  }

  const futureDated = structurallyValid.filter((record) => Date.parse(record.occurred_at_utc) > nowInstant);
  const nonFuture = structurallyValid.filter((record) => Date.parse(record.occurred_at_utc) <= nowInstant);

  function isEligible(record) {
    return record.production === true
      && record.real_data === true
      && record.human_converted === true
      && record.conversion_completed === true
      && record.analysis_kind === 'initial_opportunity_analysis'
      && Date.parse(record.converted_at_utc) >= pilotStartInstant;
  }

  const eligible = nonFuture.filter(isEligible);
  const ineligible = nonFuture.filter((record) => !isEligible(record));

  const sortedEligible = [...eligible].sort(byConvertedThenId);
  const seenTenders = new Set();
  const firstSeenOrder = [];
  for (const record of sortedEligible) {
    if (!seenTenders.has(record.tender_id)) {
      seenTenders.add(record.tender_id);
      firstSeenOrder.push(record.tender_id);
    }
  }
  // Retries of an already-selected tender never consume a new slot: the pilot targets the
  // first 10 unique tender_id, not the first 10 records.
  const selectedTenderIds = firstSeenOrder.slice(0, target);
  const selectedSet = new Set(selectedTenderIds);
  const cohortRecords = eligible.filter((record) => selectedSet.has(record.tender_id));
  const uniqueEligibleTenderIds = new Set(eligible.map((record) => record.tender_id));
  const excessEligibleOpportunities = uniqueEligibleTenderIds.size - selectedTenderIds.length;

  const byTender = new Map();
  for (const tenderId of selectedTenderIds) byTender.set(tenderId, []);
  for (const record of cohortRecords) byTender.get(record.tender_id).push(record);
  for (const attempts of byTender.values()) attempts.sort(byAttemptNumber);

  const opportunities = selectedTenderIds.map((tenderId) => {
    const attempts = byTender.get(tenderId);
    const firstAttempt = attempts[0];
    const lastAttempt = attempts[attempts.length - 1];
    const isTerminal = lastAttempt.status === 'completed' || lastAttempt.status === 'failed';
    const failures = attempts.filter((attempt) => attempt.status === 'failed').length;
    const failuresClassified = attempts.filter((attempt) => attempt.status === 'failed'
      && AGT002_F1_PILOT_FAILURE_CLASSES.includes(attempt.failure_class)).length;
    const firstAttemptSuccess = firstAttempt.status === 'completed';
    const latencySeconds = isTerminal && lastAttempt.status === 'completed'
      ? (Date.parse(lastAttempt.occurred_at_utc) - Date.parse(firstAttempt.initial_opportunity_analysis_at)) / 1000
      : null;
    return Object.freeze({
      tender_id: tenderId,
      opportunity_id: firstAttempt.opportunity_id,
      attempts: attempts.length,
      retries: attempts.length - 1,
      status: isTerminal ? lastAttempt.status : 'pending',
      first_attempt_success: firstAttemptSuccess,
      latency_seconds: latencySeconds,
      failures,
      failures_classified: failuresClassified,
      durable: isTerminal ? lastAttempt.durable : false,
      provenance_recorded: isTerminal ? lastAttempt.provenance_recorded : false,
      visible: isTerminal ? lastAttempt.visible : false,
      human_reviewed: isTerminal ? lastAttempt.human_reviewed : false,
    });
  });

  // Fail-closed guard: a terminal attempt (completed or failed — pending is not terminal and
  // contributes no latency) occurring before the analysis it concludes started signals
  // corrupted or cross-wired attempt data, so it blocks computation outright regardless of
  // whether the terminal attempt succeeded or failed.
  const negativeLatencyTenderIds = selectedTenderIds.filter((tenderId) => {
    const attempts = byTender.get(tenderId);
    const firstAttempt = attempts[0];
    const lastAttempt = attempts[attempts.length - 1];
    if (lastAttempt.status !== 'completed' && lastAttempt.status !== 'failed') return false;
    const elapsedSeconds = (Date.parse(lastAttempt.occurred_at_utc) - Date.parse(firstAttempt.initial_opportunity_analysis_at)) / 1000;
    return elapsedSeconds < 0;
  });
  if (negativeLatencyTenderIds.length > 0) {
    throw new TypeError(`AGT002_F1_PILOT_INVALID_INPUT: negative latency detected for tender_id(s): ${negativeLatencyTenderIds.sort().join(', ')}`);
  }

  const terminalOpportunities = opportunities.filter((o) => o.status === 'completed' || o.status === 'failed');
  const pendingOpportunities = opportunities.filter((o) => o.status === 'pending');
  const completedOpportunities = opportunities.filter((o) => o.status === 'completed');
  const failedOpportunities = opportunities.filter((o) => o.status === 'failed');

  // Denominator is always the selected cohort (up to 10 opportunities), including terminal
  // failed and pending ones — never just the completed subset.
  const firstAttemptSuccessCount = opportunities.filter((o) => o.first_attempt_success).length;
  const firstAttemptSuccessRate = opportunities.length
    ? firstAttemptSuccessCount / opportunities.length
    : null;

  const latencies = completedOpportunities.map((o) => o.latency_seconds).filter((value) => value !== null);
  const averageLatencySeconds = latencies.length
    ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    : null;

  const retriesTotal = opportunities.reduce((sum, o) => sum + o.retries, 0);
  const failuresTotal = opportunities.reduce((sum, o) => sum + o.failures, 0);
  const classifiedFailuresTotal = opportunities.reduce((sum, o) => sum + o.failures_classified, 0);
  const failuresClassifiedRate = failuresTotal ? classifiedFailuresTotal / failuresTotal : 1;

  const durableWithProvenanceCount = terminalOpportunities.filter((o) => o.durable && o.provenance_recorded).length;
  const durableWithProvenanceRate = terminalOpportunities.length
    ? durableWithProvenanceCount / terminalOpportunities.length
    : 1;

  const visibleCount = terminalOpportunities.filter((o) => o.visible).length;
  const visibleRate = terminalOpportunities.length ? visibleCount / terminalOpportunities.length : 1;
  const hiddenCount = terminalOpportunities.length - visibleCount;

  const humanReviewedCount = terminalOpportunities.filter((o) => o.human_reviewed).length;
  const humanReviewedRate = terminalOpportunities.length ? humanReviewedCount / terminalOpportunities.length : 1;

  const blockers = [];
  if (structurallyInvalid.length > 0) blockers.push(`${structurallyInvalid.length} record(s) failed structural normalization`);
  if (futureDated.length > 0) blockers.push(`${futureDated.length} record(s) have occurred_at_utc after the injected now`);

  if (selectedTenderIds.length < target) {
    blockers.push(`pilot has not reached the target of ${target} opportunities: ${selectedTenderIds.length}/${target} selected`);
  } else {
    if (pendingOpportunities.length > 0) {
      blockers.push(`${pendingOpportunities.length} opportunity(ies) still pending, pilot is not fully terminal`);
    }
    if (durableWithProvenanceRate < 1) blockers.push('pilot opportunities are not 100% durable with provenance');
    if (visibleRate < 1) blockers.push(`${hiddenCount} opportunity(ies) are not visible`);
    if (humanReviewedRate < 1) blockers.push('pilot opportunities are not 100% human reviewed');
    if (failuresClassifiedRate < 1) blockers.push('pilot failures are not 100% classified');
  }

  const accepted = blockers.length === 0;

  return Object.freeze({
    schema_version: AGT002_F1_PILOT_SCHEMA_VERSION,
    pilot_started_at,
    now,
    target,
    selected_opportunities: selectedTenderIds.length,
    target_reached: selectedTenderIds.length === target,
    structurally_invalid_records: structurallyInvalid.length,
    future_dated_records: futureDated.length,
    ineligible_records: ineligible.length,
    excess_eligible_opportunities: excessEligibleOpportunities,
    opportunities: Object.freeze(opportunities),
    terminal_opportunities: terminalOpportunities.length,
    pending_opportunities: pendingOpportunities.length,
    completed_opportunities: completedOpportunities.length,
    failed_opportunities: failedOpportunities.length,
    first_attempt_success_count: firstAttemptSuccessCount,
    first_attempt_success_rate: firstAttemptSuccessRate,
    average_latency_seconds: averageLatencySeconds,
    retries_total: retriesTotal,
    failures_total: failuresTotal,
    failures_classified_rate: failuresClassifiedRate,
    durable_with_provenance_rate: durableWithProvenanceRate,
    visible_rate: visibleRate,
    hidden_count: hiddenCount,
    human_reviewed_rate: humanReviewedRate,
    accepted,
    blockers: Object.freeze(blockers),
  });
}
