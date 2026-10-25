// AGT-002 M1: contrato de fiabilidad del radar. Función pura de validación/promoción —
// sin IO/fs/red, sin mutación del bundle recibido. Ver plan FASE GREEN 1A.

export const AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION = 'agt002-m1-radar-reliability-v1';

export const AGT002_M1_RADAR_RELIABILITY_VERDICTS = Object.freeze(['VALID', 'UNVERIFIED', 'INVALID']);

const TERMS = Object.freeze([
  'schema', 'terminal_state', 'temporal_integrity', 'coverage', 'freshness', 'evidence', 'traceability',
]);

// Catálogo cerrado: cada razón tiene un término dueño y una severidad fija. Única fuente de
// verdad para AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG y para el mapeo razón -> severidad.
const REASON_DEFINITIONS = Object.freeze([
  ['schema.additional_property', 'schema', 'INVALID'],
  ['schema.missing_property', 'schema', 'INVALID'],
  ['schema.invalid_type', 'schema', 'INVALID'],
  ['schema.invalid_id', 'schema', 'INVALID'],
  ['schema.invalid_hash', 'schema', 'INVALID'],
  ['scan.status.invalid', 'terminal_state', 'INVALID'],
  ['scan.status.failed', 'terminal_state', 'INVALID'],
  ['scan.status.not_terminal', 'terminal_state', 'UNVERIFIED'],
  ['temporal.timestamp_format_invalid', 'temporal_integrity', 'INVALID'],
  ['temporal.timestamp_invalid', 'temporal_integrity', 'INVALID'],
  ['temporal.order_invalid', 'temporal_integrity', 'INVALID'],
  ['coverage.partial', 'coverage', 'UNVERIFIED'],
  ['coverage.first_page_claims_absence', 'coverage', 'INVALID'],
  ['coverage.pagination_invalid', 'coverage', 'INVALID'],
  ['freshness.stale', 'freshness', 'INVALID'],
  ['freshness.invalid', 'freshness', 'INVALID'],
  ['evidence.absent', 'evidence', 'UNVERIFIED'],
  ['evidence.duplicate_id', 'evidence', 'INVALID'],
  ['evidence.invalid_locator', 'evidence', 'INVALID'],
  ['traceability.source_persistence_mismatch', 'traceability', 'INVALID'],
  ['traceability.persistence_ui_mismatch', 'traceability', 'INVALID'],
]);

export const AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG = Object.freeze(
  REASON_DEFINITIONS.map(([reason]) => reason),
);

const REASON_SEVERITY = Object.freeze(
  Object.fromEntries(REASON_DEFINITIONS.map(([reason, , severity]) => [reason, severity])),
);

const TOP_LEVEL_KEYS = Object.freeze(['schema_version', 'run_id', 'scan', 'persistence', 'ui_projection', 'evidence', 'freshness']);
const SCAN_KEYS = Object.freeze(['status', 'started_at_utc', 'completed_at_utc', 'pagination', 'source_snapshot_hash', 'item_count']);
const PAGINATION_KEYS = Object.freeze(['pages_fetched', 'total_pages_declared', 'exhaustive', 'claims_absence']);
const PERSISTENCE_KEYS = Object.freeze(['persisted_count', 'persisted_snapshot_hash', 'persisted_at_utc']);
const UI_KEYS = Object.freeze(['rendered_count', 'rendered_snapshot_hash', 'rendered_at_utc']);
const EVIDENCE_ITEM_KEYS = Object.freeze(['evidence_id', 'kind', 'locator', 'captured_at_utc', 'content_sha256']);
const FRESHNESS_KEYS = Object.freeze(['now_utc', 'data_as_of_utc', 'max_staleness_calendar_days']);

const HASH64_RE = /^[0-9a-fA-F]{64}$/;
const LOCATOR_RE = /^(fixture|repo|evidence):\/\//;
const RFC3339_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function isNonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
function isInteger(value) { return Number.isInteger(value); }
function isBoolean(value) { return typeof value === 'boolean'; }
function isHash64(value) { return typeof value === 'string' && HASH64_RE.test(value); }
function timestampFormatValid(value) { return typeof value === 'string' && RFC3339_UTC_RE.test(value); }

function isLeapYear(year) { return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0; }
function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
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
function calendarDayNumber(value) {
  const match = RFC3339_UTC_RE.exec(value);
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function closedShape(value, keys, push) {
  const keySet = new Set(keys);
  for (const key of Object.keys(value)) if (!keySet.has(key)) push('schema.additional_property');
  for (const key of keys) if (!(key in value)) push('schema.missing_property');
}

function checkSchemaTerm(bundle) {
  if (!isPlainObject(bundle)) return ['schema.invalid_type'];
  const reasons = [];
  const push = (reason) => { if (!reasons.includes(reason)) reasons.push(reason); };

  closedShape(bundle, TOP_LEVEL_KEYS, push);
  if (bundle.schema_version !== AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION) push('schema.invalid_type');
  if (!isNonEmptyString(bundle.run_id)) push('schema.invalid_id');

  const scan = bundle.scan;
  if (isPlainObject(scan)) {
    closedShape(scan, SCAN_KEYS, push);
    if (!isNonEmptyString(scan.status)) push('schema.invalid_type');
    if (!isHash64(scan.source_snapshot_hash)) push('schema.invalid_hash');
    if (!isInteger(scan.item_count) || scan.item_count < 0) push('schema.invalid_type');
    const pagination = scan.pagination;
    if (isPlainObject(pagination)) {
      closedShape(pagination, PAGINATION_KEYS, push);
      if (!isInteger(pagination.pages_fetched) || pagination.pages_fetched < 0) push('schema.invalid_type');
      if (!isInteger(pagination.total_pages_declared) || pagination.total_pages_declared < 0) push('schema.invalid_type');
      if (!isBoolean(pagination.exhaustive)) push('schema.invalid_type');
      if (!isBoolean(pagination.claims_absence)) push('schema.invalid_type');
    } else push('schema.invalid_type');
  } else push('schema.invalid_type');

  const persistence = bundle.persistence;
  if (isPlainObject(persistence)) {
    closedShape(persistence, PERSISTENCE_KEYS, push);
    if (!isInteger(persistence.persisted_count) || persistence.persisted_count < 0) push('schema.invalid_type');
    if (!isHash64(persistence.persisted_snapshot_hash)) push('schema.invalid_hash');
  } else push('schema.invalid_type');

  const ui = bundle.ui_projection;
  if (isPlainObject(ui)) {
    closedShape(ui, UI_KEYS, push);
    if (!isInteger(ui.rendered_count) || ui.rendered_count < 0) push('schema.invalid_type');
    if (!isHash64(ui.rendered_snapshot_hash)) push('schema.invalid_hash');
  } else push('schema.invalid_type');

  if (Array.isArray(bundle.evidence)) {
    for (const item of bundle.evidence) {
      if (isPlainObject(item)) {
        closedShape(item, EVIDENCE_ITEM_KEYS, push);
        if (!isNonEmptyString(item.evidence_id)) push('schema.invalid_id');
        if (!isNonEmptyString(item.kind)) push('schema.invalid_type');
        if (!isHash64(item.content_sha256)) push('schema.invalid_hash');
      } else push('schema.invalid_type');
    }
  } else push('schema.invalid_type');

  const freshness = bundle.freshness;
  if (isPlainObject(freshness)) {
    closedShape(freshness, FRESHNESS_KEYS, push);
    if (!isInteger(freshness.max_staleness_calendar_days) || freshness.max_staleness_calendar_days < 0) push('schema.invalid_type');
  } else push('schema.invalid_type');

  return reasons;
}

function checkTerminalStateTerm(bundle) {
  const scan = isPlainObject(bundle) ? bundle.scan : null;
  if (!isPlainObject(scan)) return [];
  const status = scan.status;
  if (status === 'completed') return [];
  if (status === 'failed') return ['scan.status.failed'];
  if (status === 'running' || status === 'pending') return ['scan.status.not_terminal'];
  return ['scan.status.invalid'];
}

function collectTimestamps(bundle) {
  const list = [];
  const scan = bundle.scan; const persistence = bundle.persistence;
  const ui = bundle.ui_projection; const freshness = bundle.freshness;
  if (isPlainObject(scan)) list.push(scan.started_at_utc, scan.completed_at_utc);
  if (isPlainObject(persistence)) list.push(persistence.persisted_at_utc);
  if (isPlainObject(ui)) list.push(ui.rendered_at_utc);
  if (isPlainObject(freshness)) list.push(freshness.now_utc, freshness.data_as_of_utc);
  if (Array.isArray(bundle.evidence)) {
    for (const item of bundle.evidence) if (isPlainObject(item)) list.push(item.captured_at_utc);
  }
  return list.filter((value) => value !== undefined);
}

function checkTemporalIntegrityTerm(bundle) {
  if (!isPlainObject(bundle)) return [];
  const reasons = [];
  let hasFormatIssue = false; let hasCalendarIssue = false;
  for (const ts of collectTimestamps(bundle)) {
    if (!timestampFormatValid(ts)) { hasFormatIssue = true; continue; }
    if (!timestampCalendarValid(ts)) hasCalendarIssue = true;
  }
  if (hasFormatIssue) reasons.push('temporal.timestamp_format_invalid');
  if (hasCalendarIssue) reasons.push('temporal.timestamp_invalid');

  const scan = bundle.scan;
  if (
    isPlainObject(scan)
    && timestampFormatValid(scan.started_at_utc) && timestampCalendarValid(scan.started_at_utc)
    && timestampFormatValid(scan.completed_at_utc) && timestampCalendarValid(scan.completed_at_utc)
    && Date.parse(scan.completed_at_utc) < Date.parse(scan.started_at_utc)
  ) reasons.push('temporal.order_invalid');

  return reasons;
}

function checkCoverageTerm(bundle) {
  const scan = isPlainObject(bundle) ? bundle.scan : null;
  const pagination = isPlainObject(scan) ? scan.pagination : null;
  if (!isPlainObject(pagination)) return [];
  const { pages_fetched: fetched, total_pages_declared: declared, exhaustive, claims_absence: claimsAbsence } = pagination;
  if (!isInteger(fetched) || !isInteger(declared)) return [];
  if (fetched < 0 || declared < 0 || fetched > declared) return ['coverage.pagination_invalid'];
  const computedExhaustive = fetched === declared && fetched > 0;
  if (exhaustive !== computedExhaustive) return ['coverage.pagination_invalid'];
  if (exhaustive) return [];
  // Cobertura parcial: reclamar ausencia sobre datos incompletos es fail-closed (INVALID),
  // no reclamarla es simplemente no verificado (UNVERIFIED).
  return claimsAbsence ? ['coverage.first_page_claims_absence'] : ['coverage.partial'];
}

function checkFreshnessTerm(bundle) {
  const freshness = isPlainObject(bundle) ? bundle.freshness : null;
  if (!isPlainObject(freshness)) return [];
  const { now_utc: nowUtc, data_as_of_utc: dataAsOfUtc, max_staleness_calendar_days: maxDays } = freshness;
  if (!timestampFormatValid(nowUtc) || !timestampCalendarValid(nowUtc)) return [];
  if (!timestampFormatValid(dataAsOfUtc) || !timestampCalendarValid(dataAsOfUtc)) return [];
  if (!isInteger(maxDays) || maxDays < 0) return ['freshness.invalid'];
  // Frescura por días de calendario UTC (fecha, no duración/ms transcurridos).
  const diffDays = calendarDayNumber(nowUtc) - calendarDayNumber(dataAsOfUtc);
  if (diffDays < 0) return ['freshness.invalid'];
  if (diffDays > maxDays) return ['freshness.stale'];
  return [];
}

function checkEvidenceTerm(bundle) {
  const evidence = isPlainObject(bundle) ? bundle.evidence : null;
  if (!Array.isArray(evidence) || evidence.length === 0) return ['evidence.absent'];
  const seenIds = new Set();
  let duplicate = false; let invalidLocator = false;
  for (const item of evidence) {
    if (!isPlainObject(item)) continue;
    if (isNonEmptyString(item.evidence_id)) {
      if (seenIds.has(item.evidence_id)) duplicate = true;
      seenIds.add(item.evidence_id);
    }
    if (typeof item.locator !== 'string' || !LOCATOR_RE.test(item.locator)) invalidLocator = true;
  }
  const reasons = [];
  if (duplicate) reasons.push('evidence.duplicate_id');
  if (invalidLocator) reasons.push('evidence.invalid_locator');
  return reasons;
}

function checkTraceabilityTerm(bundle) {
  const scan = isPlainObject(bundle) ? bundle.scan : null;
  const persistence = isPlainObject(bundle) ? bundle.persistence : null;
  const ui = isPlainObject(bundle) ? bundle.ui_projection : null;
  if (!isPlainObject(scan) || !isPlainObject(persistence) || !isPlainObject(ui)) return [];
  // Cadena de custodia: se evalúa enlace por enlace y se detiene en el primer quiebre, porque
  // un enlace roto ya invalida cualquier comparación posterior sobre datos no confiables.
  const sourceToPersistence = scan.source_snapshot_hash === persistence.persisted_snapshot_hash
    && scan.item_count === persistence.persisted_count;
  if (!sourceToPersistence) return ['traceability.source_persistence_mismatch'];
  const persistenceToUi = persistence.persisted_snapshot_hash === ui.rendered_snapshot_hash
    && persistence.persisted_count === ui.rendered_count;
  if (!persistenceToUi) return ['traceability.persistence_ui_mismatch'];
  return [];
}

const TERM_CHECKERS = Object.freeze({
  schema: checkSchemaTerm,
  terminal_state: checkTerminalStateTerm,
  temporal_integrity: checkTemporalIntegrityTerm,
  coverage: checkCoverageTerm,
  freshness: checkFreshnessTerm,
  evidence: checkEvidenceTerm,
  traceability: checkTraceabilityTerm,
});

function dominantVerdict(severities) {
  if (severities.includes('INVALID')) return 'INVALID';
  if (severities.includes('UNVERIFIED')) return 'UNVERIFIED';
  return 'VALID';
}

export function validateAgt002M1RadarReliabilityBundle(bundle) {
  const perTermReasons = {};
  const orderedReasons = [];
  const seen = new Set();
  for (const term of TERMS) {
    const reasons = TERM_CHECKERS[term](bundle) || [];
    perTermReasons[term] = reasons;
    for (const reason of reasons) {
      if (!seen.has(reason)) { seen.add(reason); orderedReasons.push(reason); }
    }
  }

  const checkedTerms = TERMS.map((term) => {
    const reasons = perTermReasons[term];
    return Object.freeze({
      term,
      verdict: dominantVerdict(reasons.map((reason) => REASON_SEVERITY[reason])),
      reasons: Object.freeze([...reasons]),
    });
  });

  const verdict = dominantVerdict(orderedReasons.map((reason) => REASON_SEVERITY[reason]));
  return Object.freeze({
    verdict,
    promotable: verdict === 'VALID',
    reasons: Object.freeze(orderedReasons),
    checked_terms: Object.freeze(checkedTerms),
  });
}

export function resolveAgt002M1RadarReliabilityPromotion(bundle) {
  const result = validateAgt002M1RadarReliabilityBundle(bundle);
  return Object.freeze({
    promoted: result.verdict === 'VALID',
    verdict: result.verdict,
    reasons: result.reasons,
  });
}
