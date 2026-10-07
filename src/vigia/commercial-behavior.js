// CRM comercial — comportamiento de cada comercial para el director comercial ("¿Quién necesita ayuda?").
//
// Regla única y pura (sin red, sin base de datos, sin reloj implícito): la usan el endpoint
// GET /api/vigia/commercial-behavior y, más adelante, el correo semanal y AGT-001. Recibe filas ya leídas y devuelve
// una fila por comercial con lo que hizo (seguimientos y decisiones), lo que le falta (pendientes de decidir, agenda) y
// un estado explicable en una frase.
//
// Qué cuenta:
//   - Seguimientos: interacciones de tipo llamada/correo/reunión/WhatsApp/nota escritas por el comercial
//     (psi_sales_interactions.created_by) sobre oportunidades comerciales de AGT-003. Las licitaciones públicas
//     (AGT-002) no cuentan. Se mide por created_at: cuándo lo registró en el CRM, no la fecha que dice que ocurrió.
//   - Decisiones: auditoría field_name = 'decision' registrada por el comercial (changed_by).
//   - Pendientes de decidir: pendingDecisions() de opportunity-decision-rules.js sobre sus oportunidades.
//   - % agenda al día: de sus oportunidades comerciales activas, las que tienen próxima gestión hoy o después.
//   - Último ingreso al CRM: psi_profile_last_seen (una marca por día de Bogotá al abrir el CRM). NUNCA se usa
//     auth.users.last_sign_in_at: las sesiones persisten semanas y ese dato queda viejo aunque la persona entre a diario.
//   - Meta %: ventas aprobadas del mes (Bogotá) contra el presupuesto del mes en psi_sales_goals.
//   - La semana empieza el lunes, en hora de Bogotá.
//
// Estado (en este orden):
//   inactivo  sin seguimientos y sin ingresar al CRM en los últimos `inactiveDays` días. Si no hay registro de ingreso
//             (null) el ingreso es desconocido y NO se marca inactivo por eso.
//   atrasado  tiene oportunidades pendientes de decidir o su agenda al día está por debajo de `agendaOkPct`.
//   al_dia    todo lo demás.
//
// Nunca devuelve el texto de las interacciones (notas): sólo conteos y fechas.

import { isAgt003CommercialOpportunity } from './commercial-scope.js';
import { bogotaDay, FOLLOW_UP_TYPES, isOutOfActivePipeline, isTerminalStage, pendingDecisions } from './opportunity-decision-rules.js';

export const BEHAVIOR_RULES = Object.freeze({ inactiveDays: 7, agendaOkPct: 70, version: 'behavior-v1' });
export const BEHAVIOR_FOLLOW_UP_TYPES = FOLLOW_UP_TYPES;
export const BEHAVIOR_STATUS_ORDER = Object.freeze(['inactivo', 'atrasado', 'al_dia']);

const DAY_MS = 86_400_000;
const list = value => (Array.isArray(value) ? value : []);

function dayNumber(day) {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/** Días calendario (Bogotá) entre un instante y `now`; null si no hay instante válido. */
export function bogotaDaysSince(value, now = new Date()) {
  if (!value) return null;
  const from = bogotaDay(value);
  const to = bogotaDay(now);
  if (!from || !to) return null;
  return Math.max(0, dayNumber(to) - dayNumber(from));
}

/** Lunes (YYYY-MM-DD, Bogotá) de la semana de `now`. */
export function bogotaWeekStart(now = new Date()) {
  const today = bogotaDay(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const offset = (weekday + 6) % 7;
  return new Date((dayNumber(today) - offset) * DAY_MS).toISOString().slice(0, 10);
}

/** Mes (YYYY-MM, Bogotá) de `now`. */
export function bogotaMonth(now = new Date()) {
  return String(bogotaDay(now) || '').slice(0, 7);
}

function latest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Cumplimiento del mes: ventas aprobadas (approved_at, o updated_at si falta) contra presupuesto del mes.
 * Sin `ownerId` es el total del equipo y sólo cuenta a quien tiene meta ese mes (las ventas de quien no tiene meta no
 * inflan el cumplimiento). Devuelve { approved, budget, pct } con pct null cuando no hay presupuesto cargado.
 */
export function monthlyGoalCompliance({ opportunities = [], goals = [], month, ownerId = null } = {}) {
  const monthGoals = list(goals).filter(g => String(g?.period_month || '').slice(0, 7) === month && (!ownerId || g.user_id === ownerId));
  const ownersWithGoal = new Set(monthGoals.map(g => g.user_id));
  const approved = list(opportunities)
    .filter(o => isAgt003CommercialOpportunity(o) && o.stage_code === 'aprobado' && (ownerId ? o.owner_id === ownerId : ownersWithGoal.has(o.owner_id)))
    .filter(o => String(bogotaDay(o.approved_at || o.updated_at || '') || '').slice(0, 7) === month)
    .reduce((sum, o) => sum + Number(o.offer_value || 0), 0);
  const budget = monthGoals
    .reduce((sum, g) => sum + Number(g.sales_budget || 0), 0);
  return { approved, budget, pct: budget > 0 ? Math.round((approved / budget) * 100) : null };
}

function statusFor(row, rules) {
  const followUpStale = row.daysSinceFollowUp === null || row.daysSinceFollowUp >= rules.inactiveDays;
  const seenKnown = row.daysSinceSeen !== null;
  const seenStale = seenKnown && row.daysSinceSeen >= rules.inactiveDays;
  if (followUpStale && seenStale) {
    return { status: 'inactivo', reason: `Sin seguimientos ni ingresos al CRM en ${rules.inactiveDays} días o más.` };
  }
  const reasons = [];
  if (row.pendingDecisions > 0) reasons.push(`${row.pendingDecisions} ${row.pendingDecisions === 1 ? 'oportunidad pendiente' : 'oportunidades pendientes'} de decidir`);
  if (row.agendaPct !== null && row.agendaPct < rules.agendaOkPct) reasons.push(`agenda al día en ${row.agendaPct}% (mínimo ${rules.agendaOkPct}%)`);
  if (reasons.length) {
    const text = reasons.join(' y ');
    return { status: 'atrasado', reason: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
  }
  const seenNote = seenKnown ? '' : ' Aún no hay registro de su último ingreso al CRM.';
  return { status: 'al_dia', reason: `Sin pendientes de decidir y agenda al día.${seenNote}` };
}

function compareRows(a, b) {
  const order = BEHAVIOR_STATUS_ORDER.indexOf(a.status) - BEHAVIOR_STATUS_ORDER.indexOf(b.status);
  if (order) return order;
  if (b.pendingDecisions !== a.pendingDecisions) return b.pendingDecisions - a.pendingDecisions;
  return String(a.name).localeCompare(String(b.name), 'es');
}

/**
 * Construye la tabla de comportamiento.
 * @param {object} input
 * @param {Array<{id: string, full_name?: string, role?: string}>} input.salespeople  comerciales en el alcance de quien
 *   consulta. Quien no tiene rol comercial (p. ej. un admin con oportunidades propias) sólo aparece si tiene al menos una
 *   oportunidad comercial activa.
 * @param {Array<object>} input.opportunities  oportunidades de esos comerciales (incluidas cerradas), con
 *   id, owner_id, service_type_code, stage_code, next_action_at, frozen_until, delete_requested_at, offer_value, approved_at.
 * @param {Array<{opportunity_id: string, created_by: string, interaction_type: string, created_at: string}>} input.interactions
 * @param {Array<{opportunity_id: string, changed_by: string, created_at: string, field_name?: string}>} input.decisionLogs
 * @param {Array<{profile_id: string, last_seen_at: string}>} input.lastSeen
 * @param {Array<{user_id: string, period_month: string, sales_budget: number}>} input.goals
 * @param {Date} input.now
 */
export function buildCommercialBehavior({ salespeople = [], opportunities = [], interactions = [], decisionLogs = [], lastSeen = [], goals = [], now = new Date(), rules = BEHAVIOR_RULES } = {}) {
  const today = bogotaDay(now);
  const weekStart = bogotaWeekStart(now);
  const since30 = new Date((dayNumber(today) - 29) * DAY_MS).toISOString().slice(0, 10);
  const month = bogotaMonth(now);
  const commercialById = new Map(list(opportunities).filter(isAgt003CommercialOpportunity).map(o => [o.id, o]));
  const followUpTypes = new Set(BEHAVIOR_FOLLOW_UP_TYPES);
  const seenByProfile = new Map(list(lastSeen).map(row => [row.profile_id, row.last_seen_at || null]));

  const rows = list(salespeople).filter(person => person?.id).map(person => {
    const own = [...commercialById.values()].filter(o => o.owner_id === person.id);
    const active = own.filter(o => !isTerminalStage(o.stage_code) && !isOutOfActivePipeline(o, now));
    const pending = pendingDecisions(own, now).length;
    const followUps = list(interactions).filter(i => i?.created_by === person.id && followUpTypes.has(i.interaction_type) && commercialById.has(i.opportunity_id));
    const followUpDays = followUps.map(i => bogotaDay(i.created_at)).filter(Boolean);
    const decisions = list(decisionLogs).filter(d => d?.changed_by === person.id && (d.field_name === undefined || d.field_name === 'decision') && commercialById.has(d.opportunity_id));
    const lastFollowUpAt = followUps.reduce((acc, i) => latest(acc, i.created_at), null);
    const lastSeenAt = seenByProfile.get(person.id) || null;
    const row = {
      profileId: person.id,
      name: person.full_name || 'Sin nombre',
      lastFollowUpAt,
      daysSinceFollowUp: bogotaDaysSince(lastFollowUpAt, now),
      followUpsWeek: followUpDays.filter(day => day >= weekStart).length,
      followUps30d: followUpDays.filter(day => day >= since30).length,
      decisionsWeek: decisions.map(d => bogotaDay(d.created_at)).filter(day => day && day >= weekStart).length,
      pendingDecisions: pending,
      activeOpportunities: active.length,
      agendaPct: active.length ? Math.round(((active.length - pendingDecisions(active, now).length) / active.length) * 100) : null,
      lastSeenAt,
      daysSinceSeen: bogotaDaysSince(lastSeenAt, now),
      goalPct: monthlyGoalCompliance({ opportunities: own, goals, month, ownerId: person.id }).pct,
    };
    return { ...row, role: person.role, ...statusFor(row, rules) };
  })
    .filter(row => row.role === undefined || row.role === 'comercial' || row.activeOpportunities > 0)
    .map(({ role: _role, ...row }) => row)
    .sort(compareRows);

  return { rules, weekStart, month, generatedAt: now.toISOString(), rows };
}
