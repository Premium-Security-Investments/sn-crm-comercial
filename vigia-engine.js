const DAY_MS = 86_400_000;

export const VIGIA_CONFIG = Object.freeze({
  version: 'gate0-v1.0',
  sourceId: 'CRM-F1',
  staleWarningDays: 14,
  staleCriticalDays: 30,
  closeSoonDays: 14,
  highValueCop: 75_000_000,
  highScore: 60,
  mediumScore: 30,
  terminalStages: Object.freeze(['aprobado', 'descartado', 'perdido']),
  criticalStages: Object.freeze(['sustentacion', 'negociacion']),
});

const REGION_ALIASES = Object.freeze({
  bogota: 'Bogotá',
  'distrito capital de bogota': 'Bogotá',
  medellin: 'Medellín',
  antioquia: 'Antioquia',
  'eje cafetero': 'Eje Cafetero',
  risaralda: 'Risaralda',
  'valle del cauca': 'Valle del Cauca',
});

function normalizedKey(value) {
  return String(value || '').trim().replace(/[.]+$/, '').replace(/\s+/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function normalizeVigiaRegion(value) {
  const key = normalizedKey(value);
  if (!key) return null;
  if (REGION_ALIASES[key]) return REGION_ALIASES[key];
  return key.split(' ').map((part, index) => index > 0 && ['de', 'del', 'la', 'las', 'los', 'y', 'el'].includes(part)
    ? part
    : part.charAt(0).toLocaleUpperCase('es-CO') + part.slice(1)).join(' ');
}

function dateState(value) {
  if (value === null || value === undefined || value === '') return { date: null, missing: true, invalid: false };
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? { date: null, missing: false, invalid: true } : { date, missing: false, invalid: false };
}

function validDate(value) {
  return dateState(value).date;
}

const BOGOTA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
});
// `expected_close_date` es una columna `date` de Postgres: un día calendario literal, sin instante
// que convertir. `new Date('2026-09-02')` la ancla en medianoche UTC, y formatear esa medianoche en
// America/Bogota (UTC-5) la retrocede a las 19:00 del día anterior — Un valor date-only nunca debe
// pasar por el formateador de zona horaria; se extrae directo de los dígitos, igual que `parseDateOnly`
// en `src/dateOnly.ts`. Los demás campos (`next_action_at`, `last_interaction_at`, etc.) sí son
// timestamptz reales y sí deben anclarse a Bogotá como instantes.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayStart(value) {
  if (typeof value === 'string') {
    const match = DATE_ONLY.exec(value.trim());
    if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const date = validDate(value) || new Date();
  const [y, m, d] = BOGOTA_DATE.format(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(earlier, later) {
  return Math.max(0, Math.floor((dayStart(later) - dayStart(earlier)) / DAY_MS));
}

function activityEvidence(row) {
  const invalidFields = [];
  for (const [field, value] of [['last_interaction_at', row.last_interaction_at], ['updated_at', row.updated_at], ['created_at', row.created_at]]) {
    const state = dateState(value);
    if (state.invalid) invalidFields.push(field);
    if (state.date) return { activity_at: value, activity_basis: field, invalid_fields: invalidFields };
  }
  return { activity_at: null, activity_basis: 'missing', invalid_fields: invalidFields };
}

function levelFor(score) {
  if (score >= VIGIA_CONFIG.highScore) return 'alto';
  if (score >= VIGIA_CONFIG.mediumScore) return 'medio';
  if (score > 0) return 'bajo';
  return 'sin_prioridad';
}

function recommendationFor(signals) {
  const codes = new Set(signals.map(signal => signal.code));
  if (codes.has('next_action_overdue')) return 'Revisar la gestión vencida y validar el siguiente paso.';
  if (codes.has('missing_next_action')) return 'Programar la próxima gestión con validación del responsable.';
  if (codes.has('close_overdue')) return 'Revisar la fecha esperada de cierre y el bloqueo comercial.';
  if (codes.has('stalled_critical')) return 'Validar el bloqueo de la oportunidad estancada.';
  if (codes.has('value_missing') || codes.has('regional_missing')) return 'Completar los datos faltantes antes de la siguiente revisión.';
  return 'Revisar la prioridad con el responsable comercial.';
}

export function prioritizeVigiaOpportunities(rows, options = {}) {
  const now = validDate(options.now) || new Date();
  const priorities = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (VIGIA_CONFIG.terminalStages.includes(row.stage_code)) continue;
    const signals = [];
    const activity = activityEvidence(row);
    const inactiveDays = activity.activity_at ? daysBetween(activity.activity_at, now) : null;
    const nextActionState = dateState(row.next_action_at);
    const expectedCloseState = dateState(row.expected_close_date);
    const nextAction = nextActionState.date;
    const expectedClose = expectedCloseState.date;
    const today = dayStart(now);

    if (nextActionState.invalid) signals.push({ code: 'invalid_next_action', label: 'Próxima acción inválida', points: 0, evidence: 'La fecha de próxima gestión tiene un formato inválido y requiere corrección.' });
    else if (nextActionState.missing) signals.push({ code: 'missing_next_action', label: 'Sin próxima acción', points: 25, evidence: 'No existe fecha de próxima gestión.' });
    else if (dayStart(nextAction) < today) signals.push({ code: 'next_action_overdue', label: 'Gestión vencida', points: 30, evidence: `Próxima gestión vencida: ${row.next_action_at}.` });

    if (activity.invalid_fields.length) signals.push({ code: 'invalid_activity', label: 'Fecha de actividad inválida', points: 0, evidence: `Campos inválidos: ${activity.invalid_fields.join(', ')}.` });

    if (inactiveDays !== null && inactiveDays >= VIGIA_CONFIG.staleCriticalDays) signals.push({ code: 'stalled_critical', label: 'Estancamiento crítico', points: 30, evidence: `${inactiveDays} días sin actividad registrada.` });
    else if (inactiveDays !== null && inactiveDays >= VIGIA_CONFIG.staleWarningDays) signals.push({ code: 'stalled_warning', label: 'Estancamiento preventivo', points: 15, evidence: `${inactiveDays} días sin actividad registrada.` });

    if (VIGIA_CONFIG.criticalStages.includes(row.stage_code)) signals.push({ code: 'critical_stage', label: 'Etapa crítica', points: 15, evidence: `Etapa actual: ${row.stage_name || row.stage_code}.` });

    if (expectedCloseState.invalid) signals.push({ code: 'invalid_expected_close', label: 'Cierre esperado inválido', points: 0, evidence: 'La fecha esperada de cierre tiene un formato inválido y requiere corrección.' });
    else if (expectedClose && dayStart(row.expected_close_date) < today) signals.push({ code: 'close_overdue', label: 'Cierre esperado vencido', points: 25, evidence: `Cierre esperado vencido: ${row.expected_close_date}.` });
    else if (expectedClose) {
      const closeDays = Math.floor((dayStart(row.expected_close_date) - today) / DAY_MS);
      if (closeDays >= 0 && closeDays <= VIGIA_CONFIG.closeSoonDays) signals.push({ code: 'close_soon', label: 'Cierre cercano', points: 10, evidence: `Cierre esperado en ${closeDays} día(s).` });
    }

    const offerValue = Number(row.offer_value || 0);
    if (offerValue >= VIGIA_CONFIG.highValueCop) signals.push({ code: 'high_value', label: 'Alto valor', points: 15, evidence: `Valor registrado: ${offerValue} COP.` });
    else if (!(offerValue > 0)) signals.push({ code: 'value_missing', label: 'Valor no registrado', points: 10, evidence: 'La oportunidad no tiene valor positivo registrado.' });

    const regional = normalizeVigiaRegion(row.regional_nombre);
    if (!regional) signals.push({ code: 'regional_missing', label: 'Regional pendiente', points: 5, evidence: 'La oportunidad no tiene regional registrada.' });

    const score = signals.reduce((sum, signal) => sum + signal.points, 0);
    if (score === 0) continue;
    priorities.push({
      ...row,
      regional_nombre: regional,
      score,
      level: levelFor(score),
      signal_codes: signals.map(signal => signal.code),
      signals,
      recommendation: recommendationFor(signals),
      explanation: 'Requiere validación humana; no ejecuta acciones.',
      evidence: { ...activity, inactive_days: inactiveDays, next_action_at: nextAction ? row.next_action_at : null, expected_close_date: expectedClose ? row.expected_close_date : null },
      source: { id: VIGIA_CONFIG.sourceId, label: 'CRM comercial', as_of: validDate(row.updated_at) ? row.updated_at : activity.activity_at || null },
    });
  }
  return priorities.sort((a, b) => b.score - a.score || Number(b.offer_value || 0) - Number(a.offer_value || 0) || String(a.id).localeCompare(String(b.id)));
}
