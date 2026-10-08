// AGT-003 — capacidad `agt003.weekly_digest` (contrato agt003-weekly-digest-v1): correo semanal del CRM comercial.
//
// El CRM CONSTRUYE los correos; Hermes sólo los ENVÍA tal cual desde el buzón del dueño (ver
// ops/agt003-weekly-digest/HERMES-DELIVERY-CONTRACT.md). Este módulo es puro: sin red, sin base de datos, sin reloj
// implícito, sin IA y sin acciones externas. Recibe filas ya leídas y devuelve un "outbox" auditable.
//
// Reglas (decisiones del dueño, 2026-10-07):
//   Destinatarios (recipients-v1)
//     - Un correo personal a cada perfil activo, humano (identity_type <> 'agent'), con role = 'comercial' y correo.
//     - Se excluye por REGLA, no por nombre: el comercial cuya área comercial es sólo licitaciones, es decir, que tiene
//       asignaciones en psi_profile_area_assignments con area_code = 'comercial' y TODAS con subarea_code =
//       'licitaciones'. Su trabajo es de AGT-002 (licitaciones públicas), no del pipeline comercial privado.
//     - Quien no es comercial (admin, gerencia, director) no recibe correo personal aunque tenga oportunidades.
//     - El gerente comercial (config.managerEmail, validado contra un perfil activo humano) recibe el resumen del
//       equipo y va en copia (CC) de cada correo personal. Nadie más recibe copia.
//   Semana: lunes a domingo en hora de Bogotá. "La semana pasada" = el lunes–domingo anterior a la semana de `now`
//     (cifras de seguimientos y decisiones). "Para esta semana" = lunes–domingo de la semana de `now`.
//   Estado, pendientes, agenda y último ingreso: buildCommercialBehavior() de commercial-behavior.js (behavior-v1),
//     calculado a `now`. Las cifras de la semana pasada salen de la MISMA regla, evaluada al domingo de esa semana con
//     sólo los registros anteriores al lunes actual (así no se reimplementa qué cuenta como seguimiento o decisión).
//   Por decidir: pendingDecisions() de opportunity-decision-rules.js. "Estancadas grandes" del equipo = pendientes de
//     decidir ordenadas por valor.
//   Meta del mes: monthlyGoalCompliance() de commercial-behavior.js (el helper puro equivalente del Dashboard vive en
//     commercial-dashboard-model.ts, que es TypeScript y no se puede importar desde Node sin compilar).
//   Sin cartera (Juan, 2026-10-08): quien queda "al día" sólo porque no tiene oportunidades activas se muestra como
//     "Sin cartera" (no como "Al día"), para no confundir al gerente.
//   Premio (Juan, 2026-10-08): la ficha de cada comercial en el resumen del gerente muestra perfiles completos (8/8,
//     profileCompleteness de client-profile.js) sobre sus oportunidades activas y análisis profundos ganados en el mes
//     (psi_agt003_lead_analyses completados por el comercial desde el inicio del mes de Bogotá).
//   Sólo oportunidades comerciales privadas de AGT-003 (commercial-scope.js). Nunca se lee ni se muestra el texto de
//   los seguimientos (notas), ni observaciones, ni ids internos en el contenido.

import { createHash } from 'node:crypto';
import { profileCompleteness } from './client-profile.js';
import { isAgt003CommercialOpportunity } from './commercial-scope.js';
import { bogotaDay, isOutOfActivePipeline, isTerminalStage, pendingDecisions } from './opportunity-decision-rules.js';
import { BEHAVIOR_RULES, bogotaDaysSince, bogotaMonth, bogotaWeekStart, buildCommercialBehavior, monthlyGoalCompliance } from './commercial-behavior.js';

export const WEEKLY_DIGEST_CONTRACT = 'agt003-weekly-digest-v1';
export const WEEKLY_DIGEST_CAPABILITY = 'agt003.weekly_digest';
export const WEEKLY_DIGEST_RECIPIENT_RULES = Object.freeze({
  version: 'recipients-v1',
  role: 'comercial',
  excludeCommercialSubareaOnly: 'licitaciones',
});
export const WEEKLY_DIGEST_DEFAULTS = Object.freeze({
  managerEmail: 'directorfisica@seguridadnacional.co',
  appUrl: 'https://seguridad-nacional-crm.vercel.app',
  previewTo: 'juanbotero@premiumsecurity.ai',
  sender: 'juanbotero@premiumsecurity.ai',
  // Cómo saluda Juan al gerente por defecto (tres palabras en el nombre no permiten deducir "Luis Fernando").
  managerGreeting: 'Luis Fernando',
});
export const WEEKLY_DIGEST_MODES = Object.freeze(['preview', 'live']);
const LIST_LIMIT = 5;
const DAY_MS = 86_400_000;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const STATUS_LABEL = { inactivo: 'Inactivo', atrasado: 'Atrasado', al_dia: 'Al día', sin_cartera: 'Sin cartera' };
const STATUS_COLOR = { inactivo: '#b42318', atrasado: '#b54708', al_dia: '#067647', sin_cartera: '#475467' };
const STATUS_BG = { inactivo: '#fef3f2', atrasado: '#fffaeb', al_dia: '#ecfdf3', sin_cartera: '#f2f4f7' };
const NO_PORTFOLIO_REASON = 'No tiene oportunidades activas asignadas en el CRM.';
const list = value => (Array.isArray(value) ? value : []);

export class WeeklyDigestValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WeeklyDigestValidationError';
    this.code = code;
  }
}
const invalid = (code, message) => { throw new WeeklyDigestValidationError(code, message); };

export function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}
const normalizeEmail = value => String(value || '').trim().toLowerCase();

// ---------- fechas (Bogotá, UTC-5 sin horario de verano) ----------

const dayNumber = day => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const dayFromNumber = n => new Date(n * DAY_MS).toISOString().slice(0, 10);
const addDays = (day, days) => dayFromNumber(dayNumber(day) + days);
/** Instante UTC del inicio (00:00 Bogotá) de un día YYYY-MM-DD. */
const bogotaMidnightIso = day => `${day}T05:00:00.000Z`;

/** Semanas del correo: la pasada (cifras) y la actual ("para esta semana"), lunes a domingo en Bogotá. */
export function digestWeeks(now) {
  const thisStart = bogotaWeekStart(now);
  const lastStart = addDays(thisStart, -7);
  return {
    timezone: 'America/Bogota',
    last_week_start: lastStart,
    last_week_end: addDays(thisStart, -1),
    this_week_start: thisStart,
    this_week_end: addDays(thisStart, 6),
  };
}

function parts(day) {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() };
}
/** "28 de septiembre al 4 de octubre" o "5 al 11 de octubre". */
export function formatDayRange(start, end) {
  const a = parts(start);
  const b = parts(end);
  if (a.m === b.m && a.y === b.y) return `${a.d} al ${b.d} de ${MONTHS[b.m - 1]}`;
  if (a.y === b.y) return `${a.d} de ${MONTHS[a.m - 1]} al ${b.d} de ${MONTHS[b.m - 1]}`;
  return `${a.d} de ${MONTHS[a.m - 1]} de ${a.y} al ${b.d} de ${MONTHS[b.m - 1]} de ${b.y}`;
}
const formatLongDay = day => { const p = parts(day); return `${WEEKDAYS[p.weekday]} ${p.d} de ${MONTHS[p.m - 1]}`; };
const formatShortDay = day => { const p = parts(day); return `${p.d} de ${MONTHS[p.m - 1]}`; };

function formatSince(instant, now) {
  if (!instant) return 'sin registro';
  const day = bogotaDay(instant);
  const days = bogotaDaysSince(instant, now);
  if (!day || days === null) return 'sin registro';
  if (days === 0) return `${formatShortDay(day)} (hoy)`;
  return `${formatShortDay(day)} (hace ${days} ${days === 1 ? 'día' : 'días'})`;
}

function formatDaysWithoutFollowUp(opportunity, now) {
  const days = bogotaDaysSince(opportunity.last_interaction_at || null, now);
  if (days === null) return 'sin seguimientos registrados';
  if (days === 0) return 'con seguimiento hoy';
  return `${days} ${days === 1 ? 'día' : 'días'} sin seguimiento`;
}

/** $ con puntos de miles (formato colombiano), determinístico (no depende de ICU). */
export function formatCop(value) {
  const n = Math.round(Number(value || 0));
  if (!Number.isFinite(n) || n <= 0) return 'sin valor';
  return `$${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** "Al día" sin oportunidades activas no es estar al día: es no tener cartera. */
export function withPortfolioStatus(row) {
  if (row?.status === 'al_dia' && Number(row.activeOpportunities || 0) === 0) {
    return { ...row, status: 'sin_cartera', reason: NO_PORTFOLIO_REASON };
  }
  return row;
}

/** Perfiles completos (8/8) sobre las oportunidades activas de un comercial y análisis ganados en el mes. */
export function premiumStats({ ownerId, opportunities = [], leadAnalyses = [], now }) {
  const active = list(opportunities).filter(o => o.owner_id === ownerId && !isTerminalStage(o.stage_code) && !isOutOfActivePipeline(o, now));
  const complete = active.filter(o => profileCompleteness(o).complete).length;
  const monthStart = `${bogotaMonth(now)}-01`;
  const won = list(leadAnalyses).filter(a => a?.actor_id === ownerId && a.status === 'completed'
    && bogotaDay(a.created_at) >= monthStart && Date.parse(a.created_at) <= now.getTime()).length;
  return { active: active.length, complete, won };
}

// ---------- texto ----------

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Nombre para saludar: el primero; con cuatro palabras o más (dos nombres y dos apellidos), los dos primeros. */
export function greetingName(fullName) {
  const words = clean(fullName).split(' ').filter(Boolean);
  if (!words.length) return '';
  return words.length >= 4 ? `${words[0]} ${words[1]}` : words[0];
}

function opportunityPlace(o) {
  return clean(o.quote_city) || clean(o.regional_nombre) || '';
}
function opportunityLabel(o) {
  const client = clean(o.company_name) || 'Cliente sin nombre';
  const place = opportunityPlace(o);
  return place ? `${client} (${place})` : client;
}

// ---------- reglas de destinatarios ----------

const isHuman = p => p?.identity_type !== 'agent';

/** El comercial cuya área comercial es sólo licitaciones (todas sus asignaciones comerciales en esa subárea). */
export function isCommercialTendersOnly(profileId, areaAssignments, rules = WEEKLY_DIGEST_RECIPIENT_RULES) {
  const commercial = list(areaAssignments).filter(a => a?.profile_id === profileId && a.area_code === 'comercial');
  return commercial.length > 0 && commercial.every(a => a.subarea_code === rules.excludeCommercialSubareaOnly);
}

/** Aplica recipients-v1. Devuelve { included, excluded } con el motivo de cada exclusión (para auditoría). */
export function selectDigestRecipients({ profiles = [], areaAssignments = [], rules = WEEKLY_DIGEST_RECIPIENT_RULES } = {}) {
  const included = [];
  const excluded = [];
  for (const p of list(profiles)) {
    if (!p?.id || p.active === false || !isHuman(p) || p.role !== rules.role) continue;
    if (isCommercialTendersOnly(p.id, areaAssignments, rules)) {
      excluded.push({ profile_id: p.id, name: clean(p.full_name), reason: 'area_comercial_solo_licitaciones' });
      continue;
    }
    included.push(p);
  }
  included.sort((a, b) => clean(a.full_name).localeCompare(clean(b.full_name), 'es') || String(a.id).localeCompare(String(b.id)));
  return { included, excluded };
}

// ---------- configuración ----------

export function resolveDigestConfig(config = {}) {
  const resolved = {
    managerEmail: normalizeEmail(config.managerEmail || WEEKLY_DIGEST_DEFAULTS.managerEmail),
    appUrl: String(config.appUrl || WEEKLY_DIGEST_DEFAULTS.appUrl).trim().replace(/\/+$/, ''),
    previewTo: normalizeEmail(config.previewTo || WEEKLY_DIGEST_DEFAULTS.previewTo),
    sender: normalizeEmail(config.sender || WEEKLY_DIGEST_DEFAULTS.sender),
    managerGreeting: '',
  };
  // El saludo por defecto sólo aplica al gerente por defecto; con otro gerente se deduce del nombre.
  resolved.managerGreeting = clean(config.managerGreeting)
    || (resolved.managerEmail === WEEKLY_DIGEST_DEFAULTS.managerEmail ? WEEKLY_DIGEST_DEFAULTS.managerGreeting : '');
  if (!isValidEmail(resolved.managerEmail)) invalid('bad_manager_email', `Correo del gerente comercial inválido: ${resolved.managerEmail}`);
  if (!isValidEmail(resolved.previewTo)) invalid('bad_preview_email', `Correo de prueba inválido: ${resolved.previewTo}`);
  if (!isValidEmail(resolved.sender)) invalid('bad_sender_email', `Correo remitente inválido: ${resolved.sender}`);
  if (!/^https:\/\/[^\s"'<>]+$/.test(resolved.appUrl)) invalid('bad_app_url', `URL del CRM inválida (debe ser https): ${resolved.appUrl}`);
  return resolved;
}

export function messageId({ mode, weekStart, kind, recipient }) {
  return createHash('sha256').update([WEEKLY_DIGEST_CONTRACT, mode, weekStart, kind, recipient].join('|')).digest('hex');
}

// ---------- HTML seguro para correo (estilos en línea, tablas, sin recursos externos) ----------

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const P = `${FONT}font-size:15px;line-height:22px;color:#1d2939;margin:0 0 14px 0;`;
const H2 = `${FONT}font-size:17px;line-height:24px;color:#101828;font-weight:bold;margin:22px 0 8px 0;`;
const MUTED = `${FONT}font-size:13px;line-height:19px;color:#667085;`;

function htmlDocument(title, inner) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f2f4f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f4f7;">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e4e7ec;">
<tr><td style="padding:24px 24px 8px 24px;">
${inner}
</td></tr></table>
</td></tr></table>
</body></html>
`;
}

function htmlBanner(text) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;"><tr><td style="${FONT}font-size:14px;line-height:20px;color:#7a2e0e;background-color:#fef0c7;border:1px solid #fec84b;padding:10px 12px;"><strong>${escapeHtml(text)}</strong></td></tr></table>`;
}

function htmlButton(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 22px 0;"><tr><td align="center" bgcolor="#1d4ed8" style="background-color:#1d4ed8;border-radius:6px;"><a href="${escapeHtml(href)}" target="_blank" style="${FONT}display:inline-block;padding:12px 22px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></td></tr></table>
<p style="${MUTED}margin:0 0 14px 0;">Si el botón no abre, copie este enlace: <a href="${escapeHtml(href)}" style="color:#1d4ed8;">${escapeHtml(href)}</a></p>`;
}

function htmlStatus(status, reason) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0;"><tr><td style="${FONT}font-size:15px;line-height:22px;color:${STATUS_COLOR[status]};background-color:${STATUS_BG[status]};padding:10px 12px;border-left:4px solid ${STATUS_COLOR[status]};"><strong>${escapeHtml(STATUS_LABEL[status])}</strong> — ${escapeHtml(reason)}</td></tr></table>`;
}

/** Tabla de filas [col1, col2, ...]; la primera fila es el encabezado. Todo el texto se escapa. */
function htmlTable(rows) {
  const [head, ...body] = rows;
  const th = head.map(cell => `<th align="left" style="${FONT}font-size:13px;line-height:18px;color:#475467;background-color:#f9fafb;border-bottom:1px solid #e4e7ec;padding:8px 8px;">${escapeHtml(cell)}</th>`).join('');
  const tr = body.map(row => `<tr>${row.map(cell => `<td valign="top" style="${FONT}font-size:14px;line-height:20px;color:#1d2939;border-bottom:1px solid #f2f4f7;padding:8px 8px;">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('\n');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 14px 0;">
<tr>${th}</tr>
${tr}
</table>`;
}

/** Tabla de dos columnas etiqueta/valor (la ficha de cada comercial en el resumen del gerente). */
function htmlKeyValue(title, status, pairs) {
  const rows = pairs.map(([k, v]) => `<tr><td width="45%" style="${FONT}font-size:14px;line-height:20px;color:#475467;border-top:1px solid #f2f4f7;padding:6px 10px;">${escapeHtml(k)}</td><td style="${FONT}font-size:14px;line-height:20px;color:#101828;border-top:1px solid #f2f4f7;padding:6px 10px;">${escapeHtml(v)}</td></tr>`).join('\n');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e4e7ec;border-collapse:collapse;margin:0 0 14px 0;">
<tr><td colspan="2" style="${FONT}font-size:15px;line-height:22px;color:#101828;background-color:${STATUS_BG[status]};padding:8px 10px;border-left:4px solid ${STATUS_COLOR[status]};"><strong>${escapeHtml(title)}</strong> · <span style="color:${STATUS_COLOR[status]};font-weight:bold;">${escapeHtml(STATUS_LABEL[status])}</span></td></tr>
${rows}
</table>`;
}

const FOOTER = 'Este resumen lo genera el CRM con lo que usted registró. Si algo no cuadra, actualícelo en el CRM.';
const MANAGER_FOOTER = 'Este resumen lo genera el CRM con lo que el equipo registró. Si algo no cuadra, pídale al comercial que lo actualice en el CRM.';

function previewBannerText(realTo, realCc) {
  const cc = realCc.length ? `con copia a ${realCc.join(', ')}` : 'sin copia';
  return `Prueba: en el envío real este correo iría a ${realTo.join(', ')} ${cc}.`;
}

// ---------- contenido ----------

function salespersonContent({ person, row, lastWeekRow, week, now, opportunities, goals, config }) {
  const name = greetingName(person.full_name) || clean(person.full_name);
  const own = opportunities.filter(o => o.owner_id === person.id);
  const pending = pendingDecisions(own, now)
    .slice()
    .sort((a, b) => Number(b.offer_value || 0) - Number(a.offer_value || 0) || String(a.last_interaction_at || '').localeCompare(String(b.last_interaction_at || '')) || String(a.id).localeCompare(String(b.id)));
  const thisWeek = own
    .filter(o => !isTerminalStage(o.stage_code) && !isOutOfActivePipeline(o, now) && o.next_action_at)
    .map(o => ({ o, day: bogotaDay(o.next_action_at) }))
    .filter(({ day }) => day && day >= week.this_week_start && day <= week.this_week_end)
    .sort((a, b) => a.day.localeCompare(b.day) || String(a.o.next_action_at).localeCompare(String(b.o.next_action_at)) || String(a.o.id).localeCompare(String(b.o.id)));
  const goal = monthlyGoalCompliance({ opportunities: own, goals, month: bogotaMonth(now), ownerId: person.id });
  const monthName = MONTHS[Number(bogotaMonth(now).slice(5, 7)) - 1];
  const lastRange = formatDayRange(week.last_week_start, week.last_week_end);
  const subject = `Su semana en el CRM — ${name} (semana del ${lastRange})`;
  const followUps = lastWeekRow?.followUpsWeek ?? 0;
  const decisions = lastWeekRow?.decisionsWeek ?? 0;
  const lastWeekText = `La semana pasada (del ${lastRange}) registró ${followUps} ${followUps === 1 ? 'seguimiento' : 'seguimientos'} y tomó ${decisions} ${decisions === 1 ? 'decisión' : 'decisiones'}.`;
  const pendingTitle = pending.length
    ? `Tiene ${pending.length} ${pending.length === 1 ? 'oportunidad' : 'oportunidades'} por decidir`
    : 'No tiene oportunidades por decidir';
  const pendingIntro = pending.length
    ? 'Son oportunidades sin próxima gestión o con la gestión vencida. Decida qué sigue con cada una en Mi día.'
    : 'Todas sus oportunidades tienen una próxima gestión vigente. Gracias por mantenerlas al día.';
  const pendingRows = pending.slice(0, LIST_LIMIT).map(o => [opportunityLabel(o), formatCop(o.offer_value), formatDaysWithoutFollowUp(o, now)]);
  const pendingMore = pending.length > LIST_LIMIT ? `Y ${pending.length - LIST_LIMIT} más en Mi día.` : '';
  const weekRange = formatDayRange(week.this_week_start, week.this_week_end);
  const weekRows = thisWeek.slice(0, LIST_LIMIT).map(({ o, day }) => [formatLongDay(day), opportunityLabel(o), formatCop(o.offer_value)]);
  const weekMore = thisWeek.length > LIST_LIMIT ? `Y ${thisWeek.length - LIST_LIMIT} más en Mi día.` : '';
  const weekEmpty = 'No tiene gestiones agendadas para esta semana. Si tiene algo pendiente con un cliente, agéndelo en Mi día.';
  const goalText = goal.budget > 0
    ? `Meta de ${monthName}: lleva ${formatCop(goal.approved).replace('sin valor', '$0')} en ventas aprobadas de ${formatCop(goal.budget)} (${goal.pct}%).`
    : '';
  const myDay = `${config.appUrl}/#/home`;

  const text = [
    `Hola ${name},`,
    '',
    'Este es su resumen de la semana en el CRM.',
    '',
    `Su estado hoy: ${STATUS_LABEL[row.status]}. ${row.reason}`,
    '',
    lastWeekText,
    '',
    `${pendingTitle}.`,
    pendingIntro,
    ...pendingRows.map(([label, value, days], i) => `  ${i + 1}. ${label} — ${value} — ${days}`),
    ...(pendingMore ? [pendingMore] : []),
    '',
    `Para esta semana (del ${weekRange}):`,
    ...(weekRows.length ? weekRows.map(([day, label, value]) => `  - ${day}: ${label} — ${value}`) : [weekEmpty]),
    ...(weekMore ? [weekMore] : []),
    ...(goalText ? ['', goalText] : []),
    '',
    `Abra Mi día aquí: ${myDay}`,
    '',
    'Un saludo,',
    'Juan',
    '',
    '—',
    FOOTER,
  ].join('\n');

  const html = [
    `<p style="${P}">Hola ${escapeHtml(name)},</p>`,
    `<p style="${P}">Este es su resumen de la semana en el CRM.</p>`,
    htmlStatus(row.status, row.reason),
    `<p style="${P}">${escapeHtml(lastWeekText)}</p>`,
    `<p style="${H2}">${escapeHtml(pendingTitle)}</p>`,
    `<p style="${P}">${escapeHtml(pendingIntro)}</p>`,
    pendingRows.length ? htmlTable([['Cliente', 'Valor', 'Seguimiento'], ...pendingRows]) : '',
    pendingMore ? `<p style="${P}">${escapeHtml(pendingMore)}</p>` : '',
    `<p style="${H2}">Para esta semana <span style="font-weight:normal;color:#667085;">(del ${escapeHtml(weekRange)})</span></p>`,
    weekRows.length ? htmlTable([['Día', 'Cliente', 'Valor'], ...weekRows]) : `<p style="${P}">${escapeHtml(weekEmpty)}</p>`,
    weekMore ? `<p style="${P}">${escapeHtml(weekMore)}</p>` : '',
    goalText ? `<p style="${P}">${escapeHtml(goalText)}</p>` : '',
    htmlButton('Abrir Mi día', myDay),
    `<p style="${P}">Un saludo,<br>Juan</p>`,
    `<p style="${MUTED}border-top:1px solid #e4e7ec;padding-top:12px;margin:18px 0 8px 0;">${escapeHtml(FOOTER)}</p>`,
  ].filter(Boolean).join('\n');

  return { subject, text, html };
}

function managerContent({ manager, team, week, now, opportunities, leadAnalyses, ownerNames, config }) {
  const name = config.managerGreeting || greetingName(manager.full_name) || clean(manager.full_name);
  const lastRange = formatDayRange(week.last_week_start, week.last_week_end);
  const subject = `Resumen comercial de la semana (${lastRange})`;
  const groups = { al_dia: [], atrasado: [], inactivo: [], sin_cartera: [] };
  for (const t of team) groups[t.row.status].push(clean(t.row.name));
  const headline = [
    ['al_dia', 'Al día'], ['atrasado', 'Atrasados'], ['inactivo', 'Inactivos'], ['sin_cartera', 'Sin cartera'],
  ].filter(([status]) => status !== 'sin_cartera' || groups[status].length)
    .map(([status, label]) => `${label}: ${groups[status].length}${groups[status].length ? ` (${groups[status].join(', ')})` : ''}`);
  const stalled = pendingDecisions(opportunities, now)
    .slice()
    .sort((a, b) => Number(b.offer_value || 0) - Number(a.offer_value || 0) || String(a.last_interaction_at || '').localeCompare(String(b.last_interaction_at || '')) || String(a.id).localeCompare(String(b.id)))
    .slice(0, LIST_LIMIT)
    .map(o => [opportunityLabel(o), ownerNames.get(o.owner_id) || 'Sin responsable', formatCop(o.offer_value), formatDaysWithoutFollowUp(o, now)]);
  const cards = team.map(({ row, lastWeekRow }) => {
    const premium = premiumStats({ ownerId: row.profileId, opportunities, leadAnalyses, now });
    return {
    title: clean(row.name),
    status: row.status,
    pairs: [
      ['Motivo', row.reason],
      ['Último seguimiento', formatSince(row.lastFollowUpAt, now)],
      ['Seguimientos semana pasada', String(lastWeekRow?.followUpsWeek ?? 0)],
      ['Decisiones semana pasada', String(lastWeekRow?.decisionsWeek ?? 0)],
      ['Pendientes de decidir', String(row.pendingDecisions)],
      ['Agenda al día', row.agendaPct === null ? 'sin oportunidades activas' : `${row.agendaPct}%`],
      ['Último ingreso al CRM', formatSince(row.lastSeenAt, now)],
      ['Perfiles de cliente completos', premium.active ? `${premium.complete} de ${premium.active}` : 'sin oportunidades activas'],
      ['Análisis profundos ganados este mes', String(premium.won)],
    ],
    };
  });
  const dashboard = `${config.appUrl}/#/dashboard2`;
  const intro = `Así le fue al equipo comercial la semana del ${lastRange}. Primero van quienes necesitan ayuda.`;
  const stalledIntro = `Las oportunidades más grandes del equipo que están por decidir (hasta ${LIST_LIMIT}), es decir, sin próxima gestión o con la gestión vencida:`;
  const stalledEmpty = 'No hay oportunidades por decidir en el equipo.';

  const text = [
    `Hola ${name},`,
    '',
    intro,
    '',
    ...headline,
    '',
    ...cards.flatMap(card => [`${card.title}`, ...card.pairs.map(([k, v]) => `  ${k}: ${v}`), '']),
    'Oportunidades grandes por decidir',
    ...(stalled.length ? [stalledIntro, ...stalled.map(([label, owner, value, days], i) => `  ${i + 1}. ${label} — ${owner} — ${value} — ${days}`)] : [stalledEmpty]),
    '',
    `Abra el Dashboard aquí: ${dashboard}`,
    '',
    'Un saludo,',
    'Juan',
    '',
    '—',
    MANAGER_FOOTER,
  ].join('\n');

  const html = [
    `<p style="${P}">Hola ${escapeHtml(name)},</p>`,
    `<p style="${P}">${escapeHtml(intro)}</p>`,
    `<p style="${P}">${headline.map(escapeHtml).join('<br>')}</p>`,
    `<p style="${H2}">Cada comercial</p>`,
    ...cards.map(card => htmlKeyValue(card.title, card.status, card.pairs)),
    `<p style="${H2}">Oportunidades grandes por decidir</p>`,
    stalled.length ? `<p style="${P}">${escapeHtml(stalledIntro)}</p>${htmlTable([['Cliente', 'Comercial', 'Valor', 'Seguimiento'], ...stalled])}` : `<p style="${P}">${escapeHtml(stalledEmpty)}</p>`,
    htmlButton('Abrir el Dashboard', dashboard),
    `<p style="${P}">Un saludo,<br>Juan</p>`,
    `<p style="${MUTED}border-top:1px solid #e4e7ec;padding-top:12px;margin:18px 0 8px 0;">${escapeHtml(MANAGER_FOOTER)}</p>`,
  ].join('\n');

  return { subject, text, html };
}

function finalizeMessage({ kind, mode, week, profile, realTo, realCc, content, config }) {
  const preview = mode === 'preview';
  const to = preview ? [config.previewTo] : realTo;
  const cc = preview ? [] : realCc;
  const banner = preview ? previewBannerText(realTo, realCc) : '';
  const subject = preview ? `[PRUEBA] ${content.subject}` : content.subject;
  const text = preview ? `${banner}\n\n${content.text}` : content.text;
  const inner = preview ? `${htmlBanner(banner)}\n${content.html}` : content.html;
  return {
    id: messageId({ mode, weekStart: week.this_week_start, kind, recipient: profile.id }),
    kind,
    to,
    cc,
    subject,
    text: `${text}\n`,
    html: htmlDocument(subject, inner),
    recipient_profile_id: profile.id,
    real_to: realTo,
    real_cc: realCc,
  };
}

/**
 * Construye el outbox semanal. Puro y determinístico: misma entrada → misma salida.
 * Lanza WeeklyDigestValidationError si falta el gerente, no hay destinatarios o algún correo es inválido.
 */
export function buildWeeklyDigest({
  profiles = [],
  areaAssignments = [],
  opportunities = [],
  interactions = [],
  decisions = [],
  lastSeen = [],
  goals = [],
  leadAnalyses = [],
  now,
  config = {},
  mode = 'preview',
  sample = null,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) invalid('bad_now', 'Falta la hora de generación (now).');
  if (!WEEKLY_DIGEST_MODES.includes(mode)) invalid('bad_mode', `Modo no reconocido: ${mode}. Use preview o live.`);
  if (sample !== null && sample !== undefined) {
    if (mode !== 'preview') invalid('sample_in_live', 'La muestra (--sample) sólo existe en modo preview: el envío real nunca es parcial.');
    if (!Number.isInteger(sample) || sample < 1) invalid('bad_sample', 'La muestra debe ser un entero mayor o igual a 1.');
  }
  const cfg = resolveDigestConfig(config);
  const week = digestWeeks(now);

  const manager = list(profiles).find(p => p?.active !== false && isHuman(p) && normalizeEmail(p.microsoft_email) === cfg.managerEmail);
  if (!manager) invalid('manager_not_found', `No hay un perfil activo y humano con el correo del gerente comercial (${cfg.managerEmail}).`);

  const { included: salespeople, excluded } = selectDigestRecipients({ profiles, areaAssignments });
  if (!salespeople.length) invalid('no_recipients', 'No hay comerciales activos a quienes enviar el resumen.');
  const badEmails = salespeople.filter(p => !isValidEmail(normalizeEmail(p.microsoft_email))).map(p => clean(p.full_name) || p.id);
  if (badEmails.length) invalid('bad_recipient_email', `Comerciales sin correo válido: ${badEmails.join(', ')}`);

  const teamIds = new Set(salespeople.map(p => p.id));
  const commercial = list(opportunities).filter(o => isAgt003CommercialOpportunity(o) && teamIds.has(o.owner_id));
  const behaviorPeople = salespeople.map(p => ({ id: p.id, full_name: clean(p.full_name), role: p.role }));
  const current = buildCommercialBehavior({ salespeople: behaviorPeople, opportunities: commercial, interactions, decisionLogs: decisions, lastSeen, goals, now });
  // Semana pasada con la misma regla: evaluada al domingo (mediodía Bogotá) con sólo lo registrado antes de este lunes.
  const thisWeekStartIso = bogotaMidnightIso(week.this_week_start);
  const before = row => Date.parse(row?.created_at) < Date.parse(thisWeekStartIso);
  const lastWeek = buildCommercialBehavior({
    salespeople: behaviorPeople,
    opportunities: commercial,
    interactions: list(interactions).filter(before),
    decisionLogs: list(decisions).filter(before),
    lastSeen: [],
    goals,
    now: new Date(`${week.last_week_end}T17:00:00.000Z`),
  });
  const currentRows = current.rows.map(withPortfolioStatus);
  const rowById = new Map(currentRows.map(r => [r.profileId, r]));
  const lastById = new Map(lastWeek.rows.map(r => [r.profileId, r]));
  const ownerNames = new Map(salespeople.map(p => [p.id, clean(p.full_name)]));

  const managerEmail = cfg.managerEmail;
  let personal = salespeople;
  if (mode === 'preview' && sample) {
    // Muestra determinística: primero quien tiene más oportunidades activas (el ejemplo más completo), luego por nombre.
    personal = salespeople.slice().sort((a, b) => (rowById.get(b.id)?.activeOpportunities || 0) - (rowById.get(a.id)?.activeOpportunities || 0)
      || clean(a.full_name).localeCompare(clean(b.full_name), 'es') || String(a.id).localeCompare(String(b.id))).slice(0, sample);
  }
  const messages = personal.map(person => {
    const realTo = [normalizeEmail(person.microsoft_email)];
    const realCc = realTo.includes(managerEmail) ? [] : [managerEmail];
    const content = salespersonContent({ person, row: rowById.get(person.id), lastWeekRow: lastById.get(person.id), week, now, opportunities: commercial, goals, config: cfg });
    return finalizeMessage({ kind: 'salesperson', mode, week, profile: person, realTo, realCc, content, config: cfg });
  });
  const team = currentRows.map(row => ({ row, lastWeekRow: lastById.get(row.profileId) }));
  const managerMsg = managerContent({ manager, team, week, now, opportunities: commercial, leadAnalyses, ownerNames, config: cfg });
  messages.push(finalizeMessage({ kind: 'manager', mode, week, profile: manager, realTo: [managerEmail], realCc: [], content: managerMsg, config: cfg }));

  for (const m of messages) {
    for (const address of [...m.to, ...m.cc, ...m.real_to, ...m.real_cc]) {
      if (!isValidEmail(address)) invalid('bad_email', `Correo inválido en el outbox: ${address}`);
    }
  }

  const generatedAt = now.toISOString();
  const runId = `${week.this_week_start}-${mode}-${generatedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
  return {
    contract: WEEKLY_DIGEST_CONTRACT,
    capability: WEEKLY_DIGEST_CAPABILITY,
    agent: 'AGT-003',
    run_id: runId,
    generated_at: generatedAt,
    generated_day_bogota: bogotaDay(now),
    mode,
    sample: mode === 'preview' && sample ? sample : null,
    sender: cfg.sender,
    week,
    rules: { recipients: WEEKLY_DIGEST_RECIPIENT_RULES.version, behavior: BEHAVIOR_RULES.version },
    manager_profile_id: manager.id,
    excluded_recipients: excluded,
    messages,
  };
}
