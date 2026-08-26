import { createHash } from 'node:crypto';
import { isTenderTerminalStatus, normalizeTenderStatusText, tenderStatusSearchText } from './tender-source-status.js';
import {
  TENDER_DISQUALIFYING_TERMS,
  TENDER_NON_COMMERCIAL_ACT_TERMS,
  TENDER_NON_SECURITY_CONTEXT_TERMS,
} from './tender-relevance-terms.js';

export const AGT002_RADAR_GATE_POLICY_VERSION = 'agt002-radar-gate-policy-v1';
export const AGT002_RADAR_GATE_CONTEXT_VERSION = 'agt002-radar-context-v1';
export const AGT002_RADAR_GATE_RULE_IDS = Object.freeze([
  'estado_terminal',
  'fecha_vencida',
  'fecha_no_verificable',
  'contratacion_directa',
  'contexto_no_seguridad',
]);
export const AGT002_RADAR_SOURCE_ROW_FIELDS = Object.freeze([
  'id', 'stable_key', 'source', 'entity', 'entity_nit', 'dept', 'city', 'ref', 'process_id',
  'title', 'description', 'desc', 'value', 'status', 'category', 'modality',
  'published_at', 'published', 'deadline_at', 'deadline', 'url', 'raw',
]);

const BOGOTA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
});

function failInput() {
  const error = new Error('AGT002_RADAR_GATE_INPUT_INVALID');
  error.code = 'AGT002_RADAR_GATE_INPUT_INVALID';
  throw error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stableValue(value[key])]));
  }
  return value === undefined ? null : value;
}

export function computeAgt002RadarSourceRowHash(tenderRow) {
  if (!tenderRow || typeof tenderRow !== 'object' || Array.isArray(tenderRow)) failInput();
  const sourceProjection = Object.fromEntries(AGT002_RADAR_SOURCE_ROW_FIELDS.map(field => [field, tenderRow[field] ?? null]));
  return createHash('sha256').update(JSON.stringify(stableValue(sourceProjection))).digest('hex');
}

// Fecha calendario efectiva de la evaluación en America/Bogota, derivada del reloj inyectado.
// El veredicto `fecha_vencida` depende de este día, así que el día también es identidad: sin él,
// la misma fila producía dos veredictos distintos bajo la misma clave y el ledger append-only
// devolvía 23505 permanente al cruzar el cierre.
export function agt002RadarEvaluationDate(nowIso) {
  const now = new Date(nowIso);
  if (typeof nowIso !== 'string' || !nowIso.trim() || Number.isNaN(now.getTime())) failInput();
  return BOGOTA_DATE.format(now);
}

// `psi_public_tenders.deadline_at` es `timestamptz` (migración 005) y el día de evaluación es
// America/Bogota. Tomar el `YYYY-MM-DD` inicial del texto equivalía a leer el día en UTC, así que un
// cierre como `2026-08-26T04:30:00Z` —que en Bogotá ya es el 25— sobrevivía un día de más.
// Se conserva la semántica inclusiva de día calendario (no vence en el instante, vence al pasar el
// día): una fecha sin hora sigue siendo ese mismo día, y una marca de tiempo con zona explícita se
// normaliza al día calendario de Bogotá antes de comparar. Una marca sin zona no denota un instante,
// así que se lee como hora de pared de Bogotá, es decir su propio día. Cualquier sufijo que no sea una
// marca de tiempo parseable ya no se ignora: devuelve null y el gate emite `fecha_no_verificable`.
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?[ ]?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

function normalizedOffset(zone) {
  if (zone.toUpperCase() === 'Z') return 'Z';
  const digits = zone.slice(1).replace(':', '');
  const hours = digits.slice(0, 2);
  const minutes = digits.length > 2 ? digits.slice(2, 4) : '00';
  if (Number(hours) > 23 || Number(minutes) > 59) return null;
  return `${zone[0]}${hours}:${minutes}`;
}

function calendarDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = value.trim().match(TIMESTAMP_PATTERN);
  if (!match) return null;
  const [, y, m, d, hh, mi, ss, zone] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) return null;
  if (hh === undefined) return `${y}-${m}-${d}`;
  if (Number(hh) > 23 || Number(mi) > 59 || Number(ss ?? '0') > 59) return null;
  if (!zone) return `${y}-${m}-${d}`;
  const offset = normalizedOffset(zone);
  if (!offset) return null;
  const instant = new Date(`${y}-${m}-${d}T${hh}:${mi}:${ss ?? '00'}${offset}`);
  if (Number.isNaN(instant.getTime())) return null;
  return BOGOTA_DATE.format(instant);
}

function sourceText(row) {
  const values = [row.title, row.description, row.desc, row.entity, row.category];
  if (row.raw && typeof row.raw === 'object') values.push(...Object.values(row.raw).filter(value => typeof value === 'string'));
  return normalizeTenderStatusText(values.filter(Boolean).join(' '));
}

function modalityEvidence(row) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  const fields = [
    ['raw.modalidad_de_contratacion', raw.modalidad_de_contratacion],
    ['raw.modalidad_de_contrataci_n', raw.modalidad_de_contrataci_n],
    ['raw.tipo_de_proceso', raw.tipo_de_proceso],
    ['raw.modalidad', raw.modalidad],
    ['category', row.category],
  ];
  return fields.find(([, value]) => typeof value === 'string' && value.trim()) || null;
}

function reason(ruleId, field, observedValue, contextVersion) {
  const evidenceValue = observedValue === null
    ? '<null>'
    : observedValue === undefined
      ? '<undefined>'
      : String(observedValue).trim() || '<empty>';
  return {
    rule_id: ruleId,
    field,
    observed_value: evidenceValue,
    source: 'psi_public_tenders',
    policy_version: AGT002_RADAR_GATE_POLICY_VERSION,
    context_version: contextVersion,
  };
}

export function evaluateAgt002RadarGate(tenderRow, { nowIso, contextVersion = AGT002_RADAR_GATE_CONTEXT_VERSION } = {}) {
  if (!tenderRow || typeof tenderRow !== 'object' || Array.isArray(tenderRow) || !String(tenderRow.id || '').trim()) failInput();
  const now = new Date(nowIso);
  if (typeof nowIso !== 'string' || Number.isNaN(now.getTime()) || !String(contextVersion).trim()) failInput();
  const evaluationDate = agt002RadarEvaluationDate(nowIso);

  const reasonsByRule = new Map();
  const statusText = tenderStatusSearchText(tenderRow);
  if (isTenderTerminalStatus(statusText)) reasonsByRule.set('estado_terminal', reason('estado_terminal', 'status', statusText, contextVersion));

  const deadline = calendarDate(tenderRow.deadline_at);
  if (!deadline) {
    reasonsByRule.set('fecha_no_verificable', reason('fecha_no_verificable', 'deadline_at', tenderRow.deadline_at, contextVersion));
  } else if (deadline < evaluationDate) {
    reasonsByRule.set('fecha_vencida', reason('fecha_vencida', 'deadline_at', tenderRow.deadline_at, contextVersion));
  }

  const modality = modalityEvidence(tenderRow);
  if (modality && normalizeTenderStatusText(modality[1]).includes('contratacion directa')) {
    reasonsByRule.set('contratacion_directa', reason('contratacion_directa', modality[0], modality[1], contextVersion));
  }

  const text = sourceText(tenderRow);
  const contextTerm = [...TENDER_NON_SECURITY_CONTEXT_TERMS, ...TENDER_NON_COMMERCIAL_ACT_TERMS, ...TENDER_DISQUALIFYING_TERMS]
    .find(term => text.includes(normalizeTenderStatusText(term)));
  if (contextTerm) reasonsByRule.set('contexto_no_seguridad', reason('contexto_no_seguridad', 'tender_text', contextTerm, contextVersion));

  const ruleIds = AGT002_RADAR_GATE_RULE_IDS.filter(ruleId => reasonsByRule.has(ruleId));
  const reasons = ruleIds.map(ruleId => reasonsByRule.get(ruleId));
  const dataGaps = modality ? [] : [{
    gap_id: 'modalidad_no_reportada', field: 'raw.modalidad/category', source: 'psi_public_tenders',
    policy_version: AGT002_RADAR_GATE_POLICY_VERSION, context_version: contextVersion,
  }];
  const sourceRowHash = computeAgt002RadarSourceRowHash(tenderRow);
  const tenderId = String(tenderRow.id);
  const idempotencyKey = createHash('sha256')
    .update([tenderId, AGT002_RADAR_GATE_POLICY_VERSION, contextVersion, sourceRowHash, evaluationDate].join('|'))
    .digest('hex');

  return {
    tender_id: tenderId,
    stable_key: String(tenderRow.stable_key || ''),
    verdict: ruleIds.length ? 'eliminada' : 'sobreviviente',
    rule_ids: ruleIds,
    reasons,
    data_gaps: dataGaps,
    policy_version: AGT002_RADAR_GATE_POLICY_VERSION,
    context_version: contextVersion,
    source_row_hash: sourceRowHash,
    evaluation_date: evaluationDate,
    idempotency_key: idempotencyKey,
    evaluated_at: now.toISOString(),
  };
}
