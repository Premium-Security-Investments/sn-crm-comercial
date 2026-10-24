// AGT-003 — formulario de cierre de un negocio nuevo, formato GGC-FO-001 (Juan, 2026-10-23).
//
// Regla única para el servidor y las pantallas: qué pide el formulario, qué se autocompleta con lo que el CRM ya
// sabe, cuándo está completo y cuánto vale. Módulo puro: sin red, sin base, sin reloj implícito, y no altera lo que
// recibe.
//
// Decisiones del dueño, 2026-10-23:
//   · El formulario vive en el CRM y deja de viajar por correo en un Word.
//   · Se autocompleta con la oportunidad; el comercial llena el resto, y puede hacerlo dictándole al chat.
//   · **Sólo se puede marcar el negocio como ganado cuando el formulario está completo.** Esa es la razón de ser de
//     `closureFormCompleteness()`: la puerta de las decisiones la consulta antes de dejar avanzar a `aprobado`.
//   · La entrega a las demás áreas será por Avancys cuando esa conexión exista. Este módulo no la supone.
//
// El dinero se CALCULA y nunca se guarda sumado. El ejemplar real que se revisó traía subtotal 38.616.999, IVA
// 283.560 y TOTAL 15.207.760: 23,7 millones de diferencia, en el documento con el que operaciones monta los puestos
// y facturación factura. Con el cálculo aquí, ese error no se puede repetir.
//
// Los campos viven en un solo catálogo (`CLOSURE_FORM_FIELDS`) y no repartidos por la pantalla: el formato ya va en
// su versión 18, así que cambiar una etiqueta, volver opcional un campo o agregar uno a la lista se hace en un solo
// lugar. Un campo verdaderamente nuevo sigue necesitando su migración: eso no se puede esconder.

export const CLOSURE_FORM_FORMAT = 'GGC-FO-001';
export const CLOSURE_FORM_VERSION = 18;
/** El IVA del 19 % va sobre el AIU, no sobre el valor del servicio. */
export const CLOSURE_FORM_IVA_RATE = 0.19;

const TEXT = 'texto';
const EMAIL = 'correo';
const DATE = 'fecha';
const YES_NO = 'si_no';
const OPTION = 'opcion';

/**
 * Catálogo del formulario. `required` puede ser `true` o una función del formulario (el estrato sólo se exige en
 * residencial). `auto` marca lo que el CRM autocompleta: el comercial puede corregirlo, pero no tiene que escribirlo.
 */
export const CLOSURE_FORM_FIELDS = Object.freeze([
  { key: 'authorized_by_name', label: 'Nombre de quien autorizó el servicio', kind: TEXT, max: 160, required: true, auto: true },
  { key: 'authorized_by_title', label: 'Cargo de quien autorizó', kind: TEXT, max: 120, required: true, auto: true },
  { key: 'contracting_company_name', label: 'Razón social para contratar', kind: TEXT, max: 200, required: true, auto: true },
  { key: 'contracting_company_nit', label: 'NIT para contratar', kind: TEXT, max: 30, required: true, auto: true },
  { key: 'billing_company_name', label: 'Razón social para facturar', kind: TEXT, max: 200, required: true, auto: true },
  { key: 'billing_company_nit', label: 'NIT para facturar', kind: TEXT, max: 30, required: true, auto: true },
  { key: 'establishment_name', label: 'Nombre del establecimiento', kind: TEXT, max: 200, required: true },
  { key: 'sector', label: 'Sector al que pertenece', kind: OPTION, options: ['comercial', 'industrial', 'financiero', 'salud', 'educacion', 'residencial'], required: true, auto: true },
  { key: 'residential_stratum', label: 'Estrato', kind: TEXT, max: 10, required: form => form?.sector === 'residencial' },
  { key: 'ciiu_code', label: 'Código CIIU', kind: TEXT, max: 20, required: true },
  { key: 'contact_email', label: 'Correo electrónico de contacto', kind: EMAIL, max: 160, required: true, auto: true },
  { key: 'contact_phones', label: 'Teléfonos fijos y celular', kind: TEXT, max: 120, required: true, auto: true },
  { key: 'legal_rep_name', label: 'Representante legal', kind: TEXT, max: 160, required: true },
  { key: 'legal_rep_id_number', label: 'Cédula del representante legal', kind: TEXT, max: 30, required: true },
  // En el ejemplar real venía vacío: se pide, no se exige.
  { key: 'legal_rep_id_issued_at', label: 'Cédula expedida en', kind: TEXT, max: 120, required: false },
  { key: 'withholding_agent', label: 'Agente de retención', kind: YES_NO, required: true },
  { key: 'tax_regime', label: 'Régimen', kind: OPTION, options: ['simplificado', 'comun'], required: true },
  { key: 'large_taxpayer', label: 'Gran contribuyente', kind: YES_NO, required: true },
  { key: 'contract_mail_address', label: 'Dirección de envío de contrato y factura', kind: TEXT, max: 400, required: true },
  { key: 'einvoice_email', label: 'Correo de facturación electrónica', kind: EMAIL, max: 160, required: true },
  { key: 'payment_contact_name', label: 'Encargado de pago', kind: TEXT, max: 160, required: true },
  { key: 'payment_contact_title', label: 'Cargo del encargado de pago', kind: TEXT, max: 120, required: true },
  { key: 'payment_terms', label: 'Forma de pago', kind: TEXT, max: 160, required: true },
  { key: 'operational_supervisor', label: 'Interventor operativo del contrato', kind: TEXT, max: 160, required: true },
  { key: 'service_start_date', label: 'Fecha de inicio del servicio', kind: DATE, required: true },
  { key: 'service_end_date', label: 'Fecha de terminación del servicio', kind: DATE, required: true },
  { key: 'visit_officer_name', label: 'Funcionario que realizó la visita', kind: TEXT, max: 160, required: true },
  { key: 'service_mode', label: 'Modalidad del servicio', kind: OPTION, options: ['fija', 'movil'], required: true },
  { key: 'complementary_notes', label: 'Aspectos complementarios al servicio', kind: TEXT, max: 2000, required: false },
  { key: 'loaned_equipment_notes', label: 'Equipos en comodato', kind: TEXT, max: 2000, required: false },
  // Queda opcional a propósito: no se conoce la política de AIU de facturación, y poner 0 en silencio sería inventar
  // una base gravable. Si falta, el formulario y su exportación lo dicen ("sin registrar") en vez de calcular un IVA
  // de cero como si fuera un dato.
  { key: 'aiu_value', label: 'AIU informativo', kind: 'dinero', required: false },
]);

const FIELD_BY_KEY = new Map(CLOSURE_FORM_FIELDS.map(field => [field.key, field]));
export const CLOSURE_FORM_FIELD_KEYS = Object.freeze(CLOSURE_FORM_FIELDS.map(field => field.key));

/** Lo que pide cada puesto para contar como completo. `armed` no entra: un booleano siempre tiene valor. */
export const CLOSURE_FORM_POST_REQUIRED = Object.freeze(['description', 'shift_start', 'shift_end', 'guards_required', 'monthly_value']);
const POST_LABEL = Object.freeze({
  description: 'qué se vigila',
  shift_start: 'hora de inicio',
  shift_end: 'hora de fin',
  guards_required: 'número de vigilantes',
  monthly_value: 'valor mensual',
});

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (value, max) => {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text ? text.slice(0, max || 400) : null;
};
const isFilled = value => value !== null && value !== undefined && value !== '' && !(typeof value === 'string' && !value.trim());

function isRequired(field, form) {
  return typeof field.required === 'function' ? Boolean(field.required(form)) : Boolean(field.required);
}

/**
 * Lo que el CRM ya sabe del negocio, listo para la cabecera. El comercial puede corregir cualquiera de estos
 * valores: se autocompletan para que no los escriba, no para imponerlos.
 *
 * El sector del CRM es texto libre (`economic_sector`), así que sólo se autocompleta cuando coincide con una de las
 * opciones del formato; si no, se deja vacío en vez de forzar una equivalencia inventada.
 */
export function autofillClosureForm(opportunity = {}) {
  const sectorField = FIELD_BY_KEY.get('sector');
  const sectorRaw = clean(opportunity.economic_sector, 60)?.toLowerCase().replace(/ó/g, 'o') || null;
  const sector = sectorRaw && sectorField.options.includes(sectorRaw) ? sectorRaw : null;
  const company = clean(opportunity.company_name, 200);
  const nit = clean(opportunity.company_nit, 30);
  return {
    authorized_by_name: clean(opportunity.decision_maker_name, 160),
    authorized_by_title: clean(opportunity.decision_maker_title, 120),
    contracting_company_name: company,
    contracting_company_nit: nit,
    // Facturar y contratar suelen ser la misma empresa: se propone igual y el comercial lo cambia si no lo es.
    billing_company_name: company,
    billing_company_nit: nit,
    sector,
    contact_email: clean(opportunity.decision_maker_email, 160),
    contact_phones: clean(opportunity.decision_maker_phone, 120),
  };
}

/** Las direcciones de prestación que se pueden proponer de entrada: la ciudad de la cotización, sin dirección. */
export function autofillClosureSites(opportunity = {}) {
  const city = clean(opportunity.quote_city, 80);
  return city ? [{ city, address: null, phone: clean(opportunity.decision_maker_phone, 120), contact_name: clean(opportunity.decision_maker_name, 160), position: 1 }] : [];
}

/** Un valor numérico seguro, o null. Nunca NaN, nunca negativo por descuido. */
function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Subtotal, IVA y total, calculados. `subtotal` es la suma de los valores mensuales de los puestos; el IVA es el
 * 19 % del AIU; el total es subtotal + IVA. Si el AIU no está registrado, `iva` es `null` —no cero— y el total
 * queda sin IVA, con `aiuMissing` en true para que la pantalla y la exportación lo digan.
 */
export function closureFormMoney({ posts = [], aiuValue = null } = {}) {
  const values = (Array.isArray(posts) ? posts : []).map(post => money(post?.monthly_value)).filter(value => value !== null);
  const subtotal = values.reduce((total, value) => total + value, 0);
  const aiu = money(aiuValue);
  const iva = aiu === null ? null : Math.round(aiu * CLOSURE_FORM_IVA_RATE);
  return {
    subtotal: Math.round(subtotal),
    aiu: aiu === null ? null : Math.round(aiu),
    iva,
    total: Math.round(subtotal) + (iva || 0),
    aiuMissing: aiu === null,
    ivaRate: CLOSURE_FORM_IVA_RATE,
    posts: values.length,
  };
}

/** Días completos entre dos días ISO, o null. Sirve para la duración del contrato, que el Word pedía a mano. */
export function closureFormDurationDays(startDay, endDay) {
  if (!ISO_DATE.test(String(startDay || '')) || !ISO_DATE.test(String(endDay || ''))) return null;
  const start = Date.parse(`${startDay}T12:00:00Z`);
  const end = Date.parse(`${endDay}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 86_400_000);
}

function fieldProblem(field, form) {
  const value = form?.[field.key];
  if (!isFilled(value)) return isRequired(field, form) ? `Falta ${field.label.toLowerCase()}.` : null;
  if (field.kind === EMAIL && !EMAIL_RE.test(String(value).trim())) return `El ${field.label.toLowerCase()} no parece un correo válido.`;
  if (field.kind === DATE && !ISO_DATE.test(String(value).slice(0, 10))) return `La ${field.label.toLowerCase()} no es una fecha válida.`;
  if (field.kind === OPTION && !field.options.includes(String(value))) return `${field.label} tiene un valor que el formato no reconoce.`;
  if (field.kind === YES_NO && typeof value !== 'boolean') return `${field.label} debe quedar en sí o no.`;
  return null;
}

/**
 * ¿Está completo el formulario? Devuelve `{ complete, missing, filled, required }`, donde `missing` son frases en
 * lenguaje común, listas para mostrarle al comercial: esto es lo que lee cuando intenta ganar el negocio y no puede.
 *
 * Exige, además de los campos obligatorios: al menos una dirección de prestación y al menos un puesto con sus datos,
 * porque un cierre sin puestos no es un cierre — es la parte que operaciones necesita para montar el servicio.
 */
export function closureFormCompleteness({ form = {}, sites = [], posts = [] } = {}) {
  const missing = [];
  let required = 0;
  let filled = 0;
  for (const field of CLOSURE_FORM_FIELDS) {
    if (isRequired(field, form)) {
      required += 1;
      if (isFilled(form?.[field.key])) filled += 1;
    }
    const problem = fieldProblem(field, form);
    if (problem) missing.push(problem);
  }

  const siteList = Array.isArray(sites) ? sites : [];
  if (!siteList.length) missing.push('Falta la dirección donde se presta el servicio.');
  siteList.forEach((site, index) => {
    if (!isFilled(site?.address) || !isFilled(site?.city)) missing.push(`La dirección de prestación ${index + 1} necesita dirección y ciudad.`);
  });

  const postList = Array.isArray(posts) ? posts : [];
  if (!postList.length) missing.push('Falta al menos un puesto: qué se vigila, en qué horario, con cuántos vigilantes y por cuánto.');
  postList.forEach((post, index) => {
    const faltan = CLOSURE_FORM_POST_REQUIRED.filter(key => !isFilled(post?.[key])).map(key => POST_LABEL[key]);
    if (faltan.length) missing.push(`Al puesto ${index + 1} le falta ${faltan.join(', ')}.`);
    else if (money(post.monthly_value) === null) missing.push(`El valor mensual del puesto ${index + 1} no es un número válido.`);
    else if (!Number.isInteger(Number(post.guards_required)) || Number(post.guards_required) < 1) missing.push(`El número de vigilantes del puesto ${index + 1} no es válido.`);
  });

  return { complete: missing.length === 0, missing, filled, required };
}

/**
 * La puerta: ¿se puede marcar ganado este negocio? Decisión de Juan del 2026-10-23 — no, mientras el formulario de
 * cierre no esté completo. Devuelve `{ ok }` o `{ ok: false, code, message, missing }`, con un mensaje que explica
 * qué falta en vez de un "no se puede" a secas.
 */
export function closureFormWinVerdict({ form = null, sites = [], posts = [] } = {}) {
  if (!form) {
    return {
      ok: false,
      code: 'AGT003_CLOSURE_FORM_MISSING',
      message: 'Para ganar el negocio falta el formulario de cierre. Ábralo en la oportunidad y complételo; lo que el CRM ya sabe viene puesto.',
      missing: ['El formulario de cierre no se ha empezado.'],
    };
  }
  const { complete, missing } = closureFormCompleteness({ form, sites, posts });
  if (complete) return { ok: true };
  const detail = missing.slice(0, 3).join(' ');
  const more = missing.length > 3 ? ` Y ${missing.length - 3} ${missing.length - 3 === 1 ? 'dato' : 'datos'} más.` : '';
  return {
    ok: false,
    code: 'AGT003_CLOSURE_FORM_INCOMPLETE',
    message: `Para ganar el negocio falta completar el formulario de cierre. ${detail}${more}`,
    missing,
  };
}
