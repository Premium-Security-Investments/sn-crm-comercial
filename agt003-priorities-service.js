import { VIGIA_CONFIG, prioritizeVigiaOpportunities } from './vigia-engine.js';

const OBJECT_PROTO = Object.prototype;
const ARRAY_PROTO = Array.prototype;
const objectKeys = Object.keys;
const reflectOwnKeys = Reflect.ownKeys;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const arrayIsArray = Array.isArray;
const arrayIncludes = Array.prototype.includes;
const arrayMap = Array.prototype.map;
const arrayFilter = Array.prototype.filter;
const arraySort = Array.prototype.sort;
const arrayEvery = Array.prototype.every;
const arrayAt = Array.prototype.at;
const structuredCloneSafe = globalThis.structuredClone;
const dateParse = Date.parse;
const dateToISOString = Date.prototype.toISOString;
const hasOwn = Object.hasOwn;

const PRIORITY_FIELDS = Object.freeze([
  'id', 'owner_id', 'owner_name', 'company_name', 'stage_code', 'stage_name',
  'service_type_code', 'service_type_name', 'regional_nombre', 'customer_segment',
  'offer_value', 'score', 'level', 'signal_codes', 'signals', 'recommendation',
  'explanation', 'evidence', 'source', 'stage_order', 'weighted_pipeline_value',
  'next_action_at', 'last_interaction_at', 'updated_at', 'created_at',
  'expected_close_date',
]);
const PRIORITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{4,127}$/;
const PRIORITY_LEVELS = new Set(['alto', 'medio', 'bajo']);
const ACTIVITY_BASES = new Set(['last_interaction_at', 'updated_at', 'created_at', 'missing']);

function deny(cause) {
  throw new Error('AGT-003 priorities denied', { cause });
}

function inspectPlainGraph(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) deny();
  seen.add(value);
  const prototype = getPrototypeOf(value);
  if (prototype !== OBJECT_PROTO && prototype !== ARRAY_PROTO) deny();
  const descriptors = getOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  for (const key of keys) {
    if (typeof key === 'symbol') deny();
    if (arrayIsArray(value) && key === 'length') continue;
    const descriptor = descriptors[key];
    if (!descriptor || !hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) deny();
    inspectPlainGraph(descriptor.value, seen);
  }
  seen.delete(value);
}

export function snapshotPlainInput(value) {
  try {
    inspectPlainGraph(value);
    const snapshot = structuredCloneSafe(value);
    inspectPlainGraph(snapshot);
    return snapshot;
  } catch (error) {
    deny(error);
  }
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function canonicalNow(options) {
  const safeOptions = snapshotPlainInput(options ?? {});
  if (objectKeys(safeOptions).some((key) => key !== 'now')) deny();
  const date = safeOptions.now === undefined ? new Date() : new Date(safeOptions.now);
  if (Number.isNaN(date.getTime())) deny();
  return dateToISOString.call(date);
}

function canonicalDateOrNull(value) {
  return typeof value === 'string' && !Number.isNaN(dateParse(value)) ? value : null;
}

function boundedString(value, maximum, minimum = 0) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function nullableBoundedString(value, maximum) {
  return value === null || boundedString(value, maximum);
}

function finiteNumber(value, minimum = -Infinity) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum;
}

function validateProjectedPriority(priority) {
  if (!PRIORITY_ID_PATTERN.test(priority.id)
    || !boundedString(priority.company_name, 500, 1)
    || !boundedString(priority.stage_code, 500, 1)
    || !boundedString(priority.stage_name, 500, 1)
    || !nullableBoundedString(priority.owner_id, 128)
    || !nullableBoundedString(priority.owner_name, 500)
    || !nullableBoundedString(priority.service_type_code, 500)
    || !nullableBoundedString(priority.service_type_name, 500)
    || !nullableBoundedString(priority.regional_nombre, 500)
    || !nullableBoundedString(priority.customer_segment, 500)
    || !finiteNumber(priority.offer_value, 0)
    || !finiteNumber(priority.weighted_pipeline_value, 0)
    || !finiteNumber(priority.stage_order)
    || !finiteNumber(priority.score, 1)
    || !PRIORITY_LEVELS.has(priority.level)
    || !arrayIsArray(priority.signal_codes)
    || priority.signal_codes.length < 1
    || !priority.signal_codes.every((code) => boundedString(code, 500, 1))
    || !arrayIsArray(priority.signals)
    || priority.signals.length < 1
    || priority.signals.length > 20
    || !priority.signals.every((signal) => boundedString(signal.code, 500, 1)
      && boundedString(signal.label, 500, 1)
      && finiteNumber(signal.points, 0)
      && boundedString(signal.evidence, 500, 1))
    || !boundedString(priority.recommendation, 500, 1)
    || priority.explanation !== 'Requiere validación humana; no ejecuta acciones.'
    || !ACTIVITY_BASES.has(priority.evidence.activity_basis)
    || !arrayIsArray(priority.evidence.invalid_fields)
    || priority.evidence.invalid_fields.length > 3
    || (priority.evidence.inactive_days !== null
      && (!Number.isInteger(priority.evidence.inactive_days) || priority.evidence.inactive_days < 0))
    || priority.source.id !== VIGIA_CONFIG.sourceId
    || priority.source.label !== 'CRM comercial') deny();
  return priority;
}

function projectPriority(priority) {
  const projected = {
    id: priority.id,
    owner_id: priority.owner_id ?? null,
    owner_name: priority.owner_name ?? null,
    company_name: priority.company_name,
    stage_code: priority.stage_code,
    stage_name: priority.stage_name,
    service_type_code: priority.service_type_code ?? null,
    service_type_name: priority.service_type_name ?? null,
    regional_nombre: priority.regional_nombre ?? null,
    customer_segment: priority.customer_segment ?? null,
    offer_value: Number(priority.offer_value || 0),
    score: priority.score,
    level: priority.level,
    signal_codes: priority.signal_codes.map((code) => code),
    signals: priority.signals.map((signal) => ({
      code: signal.code,
      label: signal.label,
      points: signal.points,
      evidence: signal.evidence,
    })),
    recommendation: priority.recommendation,
    explanation: priority.explanation,
    evidence: {
      activity_at: canonicalDateOrNull(priority.evidence.activity_at),
      activity_basis: priority.evidence.activity_basis,
      invalid_fields: priority.evidence.invalid_fields.map((field) => field),
      inactive_days: priority.evidence.inactive_days,
      next_action_at: canonicalDateOrNull(priority.evidence.next_action_at),
      expected_close_date: canonicalDateOrNull(priority.evidence.expected_close_date),
    },
    source: {
      id: priority.source.id,
      label: priority.source.label,
      as_of: canonicalDateOrNull(priority.source.as_of),
    },
    stage_order: Number(priority.stage_order || 0),
    weighted_pipeline_value: Number(priority.weighted_pipeline_value || 0),
    next_action_at: canonicalDateOrNull(priority.next_action_at),
    last_interaction_at: canonicalDateOrNull(priority.last_interaction_at),
    updated_at: canonicalDateOrNull(priority.updated_at),
    created_at: canonicalDateOrNull(priority.created_at),
    expected_close_date: canonicalDateOrNull(priority.expected_close_date),
  };
  if (objectKeys(projected).length !== PRIORITY_FIELDS.length) deny();
  return validateProjectedPriority(projected);
}

export function buildAgt003PrioritiesData(rows, options = {}) {
  try {
    if (Array.prototype.includes !== arrayIncludes
      || Array.prototype.map !== arrayMap
      || Array.prototype.filter !== arrayFilter
      || Array.prototype.sort !== arraySort
      || Array.prototype.every !== arrayEvery
      || Array.prototype.at !== arrayAt) deny();
    const scopedRows = snapshotPlainInput(rows);
    if (!arrayIsArray(scopedRows)) deny();
    const generatedAt = canonicalNow(options);
    const priorities = prioritizeVigiaOpportunities(scopedRows, { now: generatedAt }).map(projectPriority);
    const asOf = scopedRows
      .map((row) => canonicalDateOrNull(row.updated_at))
      .filter((value) => value !== null)
      .sort()
      .at(-1) ?? null;
    return deepFreeze({
      generated_at: generatedAt,
      source: { id: VIGIA_CONFIG.sourceId, label: 'CRM comercial', as_of: asOf },
      policy: { version: VIGIA_CONFIG.version, read_only: true, human_review_required: true },
      totals: {
        source_rows: scopedRows.length,
        visible_active: scopedRows.filter((row) => !VIGIA_CONFIG.terminalStages.includes(row.stage_code)).length,
        prioritized: priorities.length,
        high: priorities.filter((row) => row.level === 'alto').length,
        medium: priorities.filter((row) => row.level === 'medio').length,
        low: priorities.filter((row) => row.level === 'bajo').length,
      },
      priorities,
    });
  } catch (error) {
    if (error?.message === 'AGT-003 priorities denied') throw error;
    deny(error);
  }
}
