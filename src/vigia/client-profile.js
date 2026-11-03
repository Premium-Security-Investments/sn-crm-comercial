// AGT-003 — Perfil del cliente en la ficha comercial (decisión de Juan, 2026-10-08).
//
// Regla única, usada por el servidor (validar y guardar) y por las pantallas (ficha, "perfil completo"):
// campos opcionales que le dan a la IA comercial y al comercial con qué trabajar. NIT y vencimiento del contrato
// actual son opcionales y NO cuentan para "perfil completo". El proveedor actual cuenta si se escribe su nombre o si
// se marca "No tiene" (seguridad propia o ninguna).

export const CLIENT_PROFILE_FIELDS = Object.freeze([
  'company_website', 'company_nit', 'decision_maker_title', 'decision_maker_linkedin',
  'current_security_provider', 'current_security_provider_none', 'current_contract_end_date',
]);

const text = (value, max) => {
  const clean = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return clean ? clean.slice(0, max) : null;
};

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function normalizeWebsite(value) {
  const raw = text(value, 300);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(withScheme); } catch { fail('La página web no es válida. Ejemplo: www.empresa.com'); }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) fail('La página web no es válida. Ejemplo: www.empresa.com');
  return url.toString();
}

export function normalizeLinkedin(value) {
  const raw = text(value, 300);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(withScheme); } catch { fail('El LinkedIn no es válido. Pegue el enlace del perfil (linkedin.com/in/...).'); }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) fail('El LinkedIn no es válido. Pegue el enlace del perfil (linkedin.com/in/...).');
  return url.toString();
}

function normalizeDate(value) {
  const raw = text(value, 10);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) fail('La fecha de vencimiento del contrato no es válida.');
  return raw;
}

/** ¿El cuerpo de la petición trae algún campo del perfil? (Otros flujos que no los envían no los tocan.) */
export function hasClientProfileFields(body) {
  return Boolean(body) && CLIENT_PROFILE_FIELDS.some(key => Object.prototype.hasOwnProperty.call(body, key));
}

/** Valida y normaliza los campos del perfil. Esquema cerrado: sólo se leen los campos conocidos. */
export function normalizeClientProfile(body = {}) {
  const none = body.current_security_provider_none === true || body.current_security_provider_none === 'true';
  return {
    company_website: normalizeWebsite(body.company_website),
    company_nit: text(body.company_nit, 30),
    decision_maker_title: text(body.decision_maker_title, 120),
    decision_maker_linkedin: normalizeLinkedin(body.decision_maker_linkedin),
    current_security_provider: none ? null : text(body.current_security_provider, 160),
    current_security_provider_none: none,
    // En una renovación el contrato que vence es el nuestro: la fecha se guarda aunque esté marcado "No tiene".
    current_contract_end_date: none && body.client_deal_type !== 'renovacion' ? null : normalizeDate(body.current_contract_end_date),
  };
}

/**
 * Cliente actual: ¿renovación o servicio nuevo? (Juan, 2026-11-03). Con un cliente que ya tenemos pasan dos cosas
 * distintas —se renueva el contrato que existe, o se le vende un servicio o solución nueva— y el CRM las revolvía.
 *
 * Va aparte de `CLIENT_PROFILE_FIELDS` (migración 173, no 113) y se lee y escribe con su propia tolerancia: si la
 * columna todavía no existe, el resto del perfil sigue funcionando.
 */
export const CLIENT_DEAL_FIELD = 'client_deal_type';
export const CLIENT_DEAL_TYPES = Object.freeze([['renovacion', 'Renovación'], ['servicio_nuevo', 'Servicio nuevo']]);

export function clientDealLabel(value) {
  return CLIENT_DEAL_TYPES.find(([code]) => code === value)?.[1] || null;
}

/**
 * Valida la clasificación contra el tipo de cliente que viene en la misma petición. Con Cliente Actual es
 * obligatoria, y en una renovación también la fecha en que vence el contrato: es lo que permite avisar a tiempo. Con
 * Cliente Nuevo queda en nulo.
 *
 * Devuelve `undefined` —no se valida ni se toca lo guardado— si la petición no trae los dos campos. El formulario
 * siempre los manda; el chat ("actualizar datos") reenvía el tipo de cliente que ya tiene la oportunidad y no conoce
 * este campo, y no puede quedar bloqueado por una clasificación que nadie le pidió.
 */
export function normalizeClientDeal(body = {}) {
  const has = key => Boolean(body) && Object.prototype.hasOwnProperty.call(body, key);
  if (!has('customer_segment') || !has(CLIENT_DEAL_FIELD)) return undefined;
  if (body.customer_segment !== 'cliente_actual') return { client_deal_type: null };
  const deal = typeof body.client_deal_type === 'string' ? body.client_deal_type : '';
  if (!deal) fail('Con un cliente actual, diga si es renovación del contrato o un servicio nuevo.');
  if (!CLIENT_DEAL_TYPES.some(([code]) => code === deal)) fail('Renovación o servicio nuevo: valor no válido.');
  if (deal === 'renovacion' && !normalizeDate(body.current_contract_end_date)) fail('En una renovación, diga cuándo vence el contrato actual.');
  return { client_deal_type: deal };
}

/**
 * Filtro "Tipo de cliente" de la lista de oportunidades y de Vig-IA: la misma regla en las dos pantallas.
 * "cliente_actual" solo trae todas las de cliente actual; "cliente_actual:<tipo>" una de las dos, y
 * "cliente_actual:sin_clasificar" las que todavía no lo dicen.
 */
export const CUSTOMER_SEGMENT_FILTER_OPTIONS = Object.freeze([
  ['cliente_nuevo', 'Cliente Nuevo'], ['cliente_actual', 'Cliente Actual (todas)'],
  ...CLIENT_DEAL_TYPES.map(([code, label]) => [`cliente_actual:${code}`, `Cliente Actual · ${label}`]),
  ['cliente_actual:sin_clasificar', 'Cliente Actual · Sin clasificar'],
]);

export function isCustomerSegmentFilter(value) {
  return CUSTOMER_SEGMENT_FILTER_OPTIONS.some(([code]) => code === value);
}

export function matchesCustomerSegmentFilter(row, filter) {
  if (!filter) return true;
  const [segment, deal] = String(filter).split(':');
  if (row?.customer_segment !== segment) return false;
  if (!deal) return true;
  return deal === 'sin_clasificar' ? !row?.client_deal_type : row?.client_deal_type === deal;
}

const filled = value => typeof value === 'string' ? value.trim().length > 0 : Boolean(value);

/**
 * Puntos del perfil (NIT y vencimiento del contrato no cuentan).
 *
 * `optional: true` significa que suma pero NO bloquea el premio del análisis profundo. Hoy sólo el LinkedIn del
 * decisor: decisión de Juan del 2026-10-22, porque hay contactos que simplemente no tienen LinkedIn y el comercial
 * se quedaba sin poder ganar el análisis por un dato que no existe.
 */
export const PROFILE_CHECKS = Object.freeze([
  { key: 'economic_sector', label: 'Sector', done: o => filled(o.economic_sector) },
  { key: 'company_website', label: 'Página web', done: o => filled(o.company_website) },
  { key: 'decision_maker_name', label: 'Nombre del decisor', done: o => filled(o.decision_maker_name) },
  { key: 'decision_maker_title', label: 'Cargo del decisor', done: o => filled(o.decision_maker_title) },
  { key: 'decision_maker_email', label: 'Correo del decisor', done: o => filled(o.decision_maker_email) },
  { key: 'decision_maker_phone', label: 'Teléfono del decisor', done: o => filled(o.decision_maker_phone) },
  { key: 'decision_maker_linkedin', label: 'LinkedIn del decisor', optional: true, done: o => filled(o.decision_maker_linkedin) },
  { key: 'current_security_provider', label: 'Proveedor actual (o "No tiene")', done: o => filled(o.current_security_provider) || o.current_security_provider_none === true },
]);

/**
 * `{ done, total, pct, complete, missing, suggested }` sobre los puntos OBLIGATORIOS. `suggested` son los opcionales
 * que faltan: se ofrecen, no se exigen, y nunca entran en `missing` para que nadie quede bloqueado por ellos.
 */
export function profileCompleteness(opportunity = {}) {
  const required = PROFILE_CHECKS.filter(check => !check.optional);
  const missing = required.filter(check => !check.done(opportunity)).map(check => check.label);
  const suggested = PROFILE_CHECKS.filter(check => check.optional && !check.done(opportunity)).map(check => check.label);
  const total = required.length;
  const done = total - missing.length;
  return { done, total, pct: Math.round((done / total) * 100), complete: missing.length === 0, missing, suggested };
}
