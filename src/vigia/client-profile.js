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
    current_contract_end_date: none ? null : normalizeDate(body.current_contract_end_date),
  };
}

const filled = value => typeof value === 'string' ? value.trim().length > 0 : Boolean(value);

/** Puntos que cuentan para "perfil completo" (NIT y vencimiento del contrato no cuentan). */
export const PROFILE_CHECKS = Object.freeze([
  { key: 'economic_sector', label: 'Sector', done: o => filled(o.economic_sector) },
  { key: 'company_website', label: 'Página web', done: o => filled(o.company_website) },
  { key: 'decision_maker_name', label: 'Nombre del decisor', done: o => filled(o.decision_maker_name) },
  { key: 'decision_maker_title', label: 'Cargo del decisor', done: o => filled(o.decision_maker_title) },
  { key: 'decision_maker_email', label: 'Correo del decisor', done: o => filled(o.decision_maker_email) },
  { key: 'decision_maker_phone', label: 'Teléfono del decisor', done: o => filled(o.decision_maker_phone) },
  { key: 'decision_maker_linkedin', label: 'LinkedIn del decisor', done: o => filled(o.decision_maker_linkedin) },
  { key: 'current_security_provider', label: 'Proveedor actual (o "No tiene")', done: o => filled(o.current_security_provider) || o.current_security_provider_none === true },
]);

export function profileCompleteness(opportunity = {}) {
  const missing = PROFILE_CHECKS.filter(check => !check.done(opportunity)).map(check => check.label);
  const total = PROFILE_CHECKS.length;
  const done = total - missing.length;
  return { done, total, pct: Math.round((done / total) * 100), complete: missing.length === 0, missing };
}
