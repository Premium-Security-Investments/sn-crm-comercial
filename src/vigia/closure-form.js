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
/**
 * El AIU es el 10 % del valor del servicio (Juan, 2026-10-24), y el IVA se calcula sobre ese 10 %. Por eso el AIU
 * dejó de ser una pregunta al comercial: se calcula. El ejemplar real del Word traía 1.492.420 de AIU sobre un
 * servicio de 38.616.998 —un 3,86 %— y un IVA de 283.560; con esta regla el AIU son 3.861.700 y el IVA 733.723. Es
 * decir: ese formulario se fue a facturación con la base gravable a menos de la mitad.
 */
export const CLOSURE_FORM_AIU_RATE = 0.10;
/**
 * En qué está expresado el valor que se escribe (Juan, 2026-10-25): **el total** en los proyectos y en las
 * licitaciones públicas, y **mensual** en todo lo demás — seguridad física, monitoreo, escoltas, portería virtual y
 * mantenimiento. Siempre **sin IVA**.
 *
 * Las licitaciones no pasan por este formulario (se cierran en Licitaciones y el endpoint las rechaza), pero la
 * regla queda escrita igual: el día que algo más lea esta función, la va a leer bien.
 *
 * Lo usan las etiquetas de la pantalla y el texto que se envía. Un valor mensual leído como total —o al revés— es un
 * error de dos órdenes de magnitud en el documento con el que facturación factura.
 */
const TOTAL_VALUE_SERVICES = Object.freeze({
  proyecto: 'Valor total del proyecto, sin IVA',
  licitacion_publica: 'Valor total del contrato, sin IVA',
});
export function closureFormValueBasis(serviceTypeCode = null) {
  const label = TOTAL_VALUE_SERVICES[String(serviceTypeCode || '')];
  return label
    ? { monthly: false, label, short: 'en total' }
    : { monthly: true, label: 'Valor mensual, sin IVA', short: 'al mes' };
}

/**
 * Secciones en el orden en que se llenan. Viven aquí y no en la pantalla por lo mismo que los campos: el formato va
 * en su versión 18, y mover un campo de sección no debería ser una pelea con el JSX.
 */
export const CLOSURE_FORM_SECTIONS = Object.freeze([
  { key: 'cliente', label: 'Cliente y contratación' },
  { key: 'tributario', label: 'Representante legal y datos tributarios' },
  { key: 'facturacion', label: 'Facturación y pago' },
  { key: 'servicio', label: 'El servicio vendido' },
]);

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
  { key: 'authorized_by_name', section: 'cliente', label: 'Nombre de quien autorizó el servicio', kind: TEXT, max: 160, required: true, auto: true },
  { key: 'authorized_by_title', section: 'cliente', label: 'Cargo de quien autorizó', kind: TEXT, max: 120, required: true, auto: true },
  { key: 'contracting_company_name', section: 'cliente', label: 'Razón social para contratar', kind: TEXT, max: 200, required: true, auto: true },
  { key: 'contracting_company_nit', section: 'cliente', label: 'NIT para contratar', kind: TEXT, max: 30, required: true, auto: true },
  { key: 'billing_company_name', section: 'facturacion', label: 'Razón social para facturar', kind: TEXT, max: 200, required: true, auto: true },
  { key: 'billing_company_nit', section: 'facturacion', label: 'NIT para facturar', kind: TEXT, max: 30, required: true, auto: true },
  { key: 'establishment_name', section: 'cliente', label: 'Nombre del establecimiento', kind: TEXT, max: 200, required: true },
  { key: 'sector', section: 'cliente', label: 'Sector al que pertenece', kind: OPTION, options: ['comercial', 'industrial', 'financiero', 'salud', 'educacion', 'residencial'], required: true, auto: true },
  { key: 'residential_stratum', section: 'cliente', label: 'Estrato', kind: TEXT, max: 10, required: form => form?.sector === 'residencial' },
  { key: 'ciiu_code', section: 'cliente', label: 'Código CIIU', kind: TEXT, max: 20, required: true },
  { key: 'contact_email', section: 'cliente', label: 'Correo electrónico de contacto', kind: EMAIL, max: 160, required: true, auto: true },
  { key: 'contact_phones', section: 'cliente', label: 'Teléfonos fijos y celular', kind: TEXT, max: 120, required: true, auto: true },
  { key: 'legal_rep_name', section: 'tributario', label: 'Representante legal', kind: TEXT, max: 160, required: true },
  { key: 'legal_rep_id_number', section: 'tributario', label: 'Cédula del representante legal', kind: TEXT, max: 30, required: true },
  // En el ejemplar real venía vacío: se pide, no se exige.
  { key: 'legal_rep_id_issued_at', section: 'tributario', label: 'Cédula expedida en', kind: TEXT, max: 120, required: false },
  { key: 'withholding_agent', section: 'tributario', label: 'Agente de retención', kind: YES_NO, required: true },
  { key: 'tax_regime', section: 'tributario', label: 'Régimen', kind: OPTION, options: ['simplificado', 'comun'], required: true },
  { key: 'large_taxpayer', section: 'tributario', label: 'Gran contribuyente', kind: YES_NO, required: true },
  { key: 'contract_mail_address', section: 'facturacion', label: 'Dirección de envío de contrato y factura', kind: TEXT, max: 400, required: true },
  { key: 'einvoice_email', section: 'facturacion', label: 'Correo de facturación electrónica', kind: EMAIL, max: 160, required: true },
  { key: 'payment_contact_name', section: 'facturacion', label: 'Encargado de pago', kind: TEXT, max: 160, required: true },
  { key: 'payment_contact_title', section: 'facturacion', label: 'Cargo del encargado de pago', kind: TEXT, max: 120, required: true },
  { key: 'payment_terms', section: 'facturacion', label: 'Forma de pago', kind: TEXT, max: 160, required: true },
  { key: 'operational_supervisor', section: 'servicio', label: 'Interventor operativo del contrato', kind: TEXT, max: 160, required: true },
  { key: 'service_start_date', section: 'servicio', label: 'Fecha de inicio del servicio', kind: DATE, required: true },
  { key: 'service_end_date', section: 'servicio', label: 'Fecha de terminación (último día de servicio)', kind: DATE, required: true },
  { key: 'visit_officer_name', section: 'servicio', label: 'Funcionario que realizó la visita', kind: TEXT, max: 160, required: true },
  { key: 'service_mode', section: 'servicio', label: 'Modalidad del servicio', kind: OPTION, options: ['fija', 'movil'], required: true },
  { key: 'complementary_notes', section: 'servicio', label: 'Aspectos complementarios al servicio', kind: TEXT, max: 2000, required: false },
  { key: 'loaned_equipment_notes', section: 'servicio', label: 'Equipos en comodato', kind: TEXT, max: 2000, required: false },
]);

const FIELD_BY_KEY = new Map(CLOSURE_FORM_FIELDS.map(field => [field.key, field]));
export const CLOSURE_FORM_FIELD_KEYS = Object.freeze(CLOSURE_FORM_FIELDS.map(field => field.key));

/** Lo que pide cada puesto para contar como completo. `armed` no entra: un booleano siempre tiene valor. */
export const CLOSURE_FORM_POST_REQUIRED = Object.freeze(['description', 'shift_start', 'shift_end', 'guards_required', 'service_value']);
const POST_LABEL = Object.freeze({
  description: 'qué se vigila',
  shift_start: 'hora de inicio',
  shift_end: 'hora de fin',
  guards_required: 'número de vigilantes',
  service_value: 'valor sin IVA',
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
 * Todo el dinero del formulario, calculado: nada de esto se escribe ni se guarda. `subtotal` es la suma de los
 * valores de los puestos (sin IVA); el AIU es el 10 % de ese subtotal; el IVA es el 19 % del AIU; el total es
 * subtotal + IVA.
 *
 * Que se calcule en un solo lugar es el punto: el ejemplar real del Word traía subtotal 38.616.999, IVA 283.560 y
 * TOTAL 15.207.760 —tres cifras que no cuadran entre sí—, y con esta regla ese contrato son 38.616.998 de servicio,
 * 3.861.700 de AIU, 733.723 de IVA y 39.350.721 en total.
 */
export function closureFormMoney({ posts = [] } = {}) {
  const values = (Array.isArray(posts) ? posts : []).map(post => money(post?.service_value)).filter(value => value !== null);
  const subtotal = Math.round(values.reduce((total, value) => total + value, 0));
  const aiu = Math.round(subtotal * CLOSURE_FORM_AIU_RATE);
  const iva = Math.round(aiu * CLOSURE_FORM_IVA_RATE);
  return {
    subtotal,
    aiu,
    iva,
    total: subtotal + iva,
    aiuRate: CLOSURE_FORM_AIU_RATE,
    ivaRate: CLOSURE_FORM_IVA_RATE,
    posts: values.length,
  };
}

/**
 * Días de servicio del contrato, o null. La fecha de terminación es **el último día de servicio** y
 * cuenta (decisión de Juan, 2026-10-24), así que octubre completo —del 1 al 31— son 31 días y no 30.
 *
 * El ejemplar real del Word decía 1.095 días para un inicio el 2026-10-01 y una terminación el
 * 2029-10-01, y eso no cuadra con ninguna convención: contando el último día son 1.097, y sin
 * contarlo 1.096. Era una suma a mano, y el error estaba además en la fecha: tres años de servicio
 * desde el 1 de octubre terminan el 30 de septiembre, no el 1 de octubre. Aquí hay una sola
 * definición y el número lo calcula el sistema.
 */
export function closureFormDurationDays(startDay, endDay) {
  if (!ISO_DATE.test(String(startDay || '')) || !ISO_DATE.test(String(endDay || ''))) return null;
  const start = Date.parse(`${startDay}T12:00:00Z`);
  const end = Date.parse(`${endDay}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
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
    else if (money(post.service_value) === null) missing.push(`El valor del puesto ${index + 1} no es un número válido.`);
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

// ---------------------------------------------------------------------------------------------------------------------
// Limpieza de lo que llega del formulario (pantalla o chat)

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Techos: un cierre con más de esto no es un cierre, es un error de pegado. */
export const CLOSURE_FORM_MAX_SITES = 20;
export const CLOSURE_FORM_MAX_POSTS = 30;

function cleanTime(value) {
  const text = typeof value === 'string' ? value.trim().slice(0, 5) : '';
  return TIME_RE.test(text) ? text : null;
}
function cleanDay(value) {
  const text = String(value ?? '').trim().slice(0, 10);
  return ISO_DATE.test(text) ? text : null;
}
function cleanInt(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  return rounded >= min && rounded <= max ? rounded : null;
}

/**
 * Convierte lo que llega de la pantalla (o del chat) en lo que se guarda: sólo las claves del catálogo, cada una
 * según su tipo, y las dos listas con su orden. Nada que no esté en el catálogo pasa, así que un campo inventado no
 * puede colarse hasta la base. Los avisos explican lo que se descartó, para no borrar en silencio lo que el comercial
 * escribió.
 */
export function cleanClosureFormInput(body = {}) {
  const raw = body && typeof body === 'object' ? body : {};
  const source = raw.form && typeof raw.form === 'object' ? raw.form : {};
  const avisos = [];
  const form = {};
  for (const field of CLOSURE_FORM_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field.key)) continue;
    const value = source[field.key];
    if (value === null || value === '' || value === undefined) { form[field.key] = null; continue; }
    if (field.kind === YES_NO) {
      form[field.key] = typeof value === 'boolean' ? value : null;
      if (typeof value !== 'boolean') avisos.push(`${field.label} quedó sin responder: se esperaba sí o no.`);
    } else if (field.kind === DATE) {
      form[field.key] = cleanDay(value);
      if (!form[field.key]) avisos.push(`${field.label} no es una fecha válida.`);
    } else if (field.kind === OPTION) {
      form[field.key] = field.options.includes(String(value)) ? String(value) : null;
      if (!form[field.key]) avisos.push(`${field.label} tiene un valor que el formato no reconoce.`);
    } else if (field.kind === 'dinero') {
      form[field.key] = money(value);
      if (form[field.key] === null) avisos.push(`${field.label} no es un valor válido.`);
    } else {
      form[field.key] = clean(value, field.max);
    }
  }

  const siteList = Array.isArray(raw.sites) ? raw.sites.slice(0, CLOSURE_FORM_MAX_SITES) : [];
  if (Array.isArray(raw.sites) && raw.sites.length > CLOSURE_FORM_MAX_SITES) avisos.push(`Dejé las primeras ${CLOSURE_FORM_MAX_SITES} direcciones de prestación.`);
  const sites = siteList.map((site, index) => ({
    address: clean(site?.address, 400),
    city: clean(site?.city, 80),
    phone: clean(site?.phone, 120),
    contact_name: clean(site?.contact_name, 160),
    position: index + 1,
  }));

  const postList = Array.isArray(raw.posts) ? raw.posts.slice(0, CLOSURE_FORM_MAX_POSTS) : [];
  if (Array.isArray(raw.posts) && raw.posts.length > CLOSURE_FORM_MAX_POSTS) avisos.push(`Dejé los primeros ${CLOSURE_FORM_MAX_POSTS} puestos.`);
  const posts = postList.map((post, index) => ({
    description: clean(post?.description, 500),
    shift_start: cleanTime(post?.shift_start),
    shift_end: cleanTime(post?.shift_end),
    days_per_month: post?.days_per_month === null || post?.days_per_month === undefined || post?.days_per_month === '' ? null : cleanInt(post.days_per_month, 1, 31),
    guards_required: cleanInt(post?.guards_required, 1, 50),
    armed: post?.armed === true,
    service_value: money(post?.service_value),
    notes: clean(post?.notes, 1000),
    position: index + 1,
  }));

  return { form, sites, posts, avisos };
}

/**
 * El catálogo como lo puede leer una pantalla: sin funciones, con `required` ya resuelto contra el formulario que se
 * está llenando (por eso el estrato aparece obligatorio sólo cuando el sector es residencial).
 */
export function closureFormCatalog(form = {}) {
  return CLOSURE_FORM_FIELDS.map(field => ({
    key: field.key,
    label: field.label,
    kind: field.kind,
    section: field.section,
    required: isRequired(field, form),
    auto: Boolean(field.auto),
    ...(field.options ? { options: [...field.options] } : {}),
    ...(field.max ? { max: field.max } : {}),
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// El formulario como texto

const MONEY_FORMAT = value => `$${Math.round(Number(value) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const YES_NO_LABEL = value => (value === true ? 'Sí' : value === false ? 'No' : 'sin registrar');
const SECTOR_LABEL = Object.freeze({ comercial: 'Comercial', industrial: 'Industrial', financiero: 'Financiero', salud: 'Salud', educacion: 'Educación', residencial: 'Residencial' });
const MODE_LABEL = Object.freeze({ fija: 'Fija', movil: 'Móvil' });
const REGIME_LABEL = Object.freeze({ simplificado: 'Simplificado', comun: 'Común' });

function fieldText(field, value) {
  if (value === null || value === undefined || value === '') return 'sin registrar';
  if (field.kind === YES_NO) return YES_NO_LABEL(value);
  if (field.kind === 'dinero') return MONEY_FORMAT(value);
  if (field.key === 'sector') return SECTOR_LABEL[String(value)] || String(value);
  if (field.key === 'service_mode') return MODE_LABEL[String(value)] || String(value);
  if (field.key === 'tax_regime') return REGIME_LABEL[String(value)] || String(value);
  return String(value);
}

/**
 * El formulario en texto plano, para copiarlo y enviarlo mientras la entrega a Avancys no exista. Es la misma
 * información que la pantalla, con las etiquetas del formato, y dice "sin registrar" donde falta algo en vez de
 * dejar un renglón en blanco que nadie sabe si es un dato vacío o un olvido.
 */
export function closureFormPlainText({ form = {}, sites = [], posts = [], company = null, serviceTypeCode = null } = {}) {
  const money = closureFormMoney({ posts });
  const basis = closureFormValueBasis(serviceTypeCode);
  const lines = [
    `${CLOSURE_FORM_FORMAT} — Nuevo puesto de vigilancia física (versión ${CLOSURE_FORM_VERSION})`,
    company ? `Cliente: ${company}` : null,
    '',
  ];
  for (const section of CLOSURE_FORM_SECTIONS) {
    const fields = CLOSURE_FORM_FIELDS.filter(field => field.section === section.key && isRequired(field, form) || (field.section === section.key && isFilled(form[field.key])));
    if (!fields.length) continue;
    lines.push(section.label.toUpperCase());
    for (const field of fields) lines.push(`  ${field.label}: ${fieldText(field, form[field.key])}`);
    lines.push('');
  }
  const duration = closureFormDurationDays(form.service_start_date, form.service_end_date);
  if (duration !== null) {
    // 30,44 y no 30: con 30 un contrato de tres años (1.096 días) salía de 37 meses.
    lines.push(`  Duración: ${duration} días (unos ${Math.round(duration / 30.44)} meses)`, '');
  }
  lines.push('DIRECCIONES DE PRESTACIÓN DEL SERVICIO');
  if (!sites.length) lines.push('  sin registrar');
  for (const site of sites) {
    lines.push(`  ${site.address || 'sin dirección'} · ${site.city || 'sin ciudad'}${site.phone ? ` · ${site.phone}` : ''}${site.contact_name ? ` · encargado: ${site.contact_name}` : ''}`);
  }
  lines.push('', 'PUESTOS');
  if (!posts.length) lines.push('  sin registrar');
  posts.forEach((post, index) => {
    const horario = post.shift_start && post.shift_end ? `${post.shift_start} a ${post.shift_end}` : 'sin horario';
    const dias = post.days_per_month ? `, ${post.days_per_month} días al mes` : '';
    lines.push(`  ${index + 1}. ${post.description || 'sin descripción'}`);
    lines.push(`     ${horario}${dias} · ${post.guards_required || 'sin'} vigilante(s) · ${post.armed ? 'con arma' : 'sin arma'} · ${MONEY_FORMAT(post.service_value)} ${basis.short}, sin IVA`);
    if (post.notes) lines.push(`     ${post.notes}`);
  });
  lines.push('');
  lines.push(`  Subtotal ${basis.monthly ? 'mensual' : 'del proyecto'}, sin IVA: ${MONEY_FORMAT(money.subtotal)}`);
  lines.push(`  AIU (10 %): ${MONEY_FORMAT(money.aiu)}`);
  lines.push(`  IVA 19 % sobre el AIU: ${MONEY_FORMAT(money.iva)}`);
  lines.push(`  Total: ${MONEY_FORMAT(money.total)}`);
  return lines.filter(line => line !== null).join('\n');
}
