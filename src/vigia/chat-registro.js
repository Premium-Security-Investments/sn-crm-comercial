// AGT-003 — Chat de registro con Vig-IA en Mi día (capacidad agt003.chat-registro; decisiones de Juan, 2026-10-15).
//
// Regla única para servidor y pantallas: qué puede proponer Vig-IA (contrato de salida cerrado), cómo se limpia esa
// propuesta antes de mostrarla y cómo se describe cada cambio en lenguaje común. Vig-IA SOLO propone: nada se guarda
// hasta que el comercial pulsa "Confirmar" (lo aplica el servidor con las mismas reglas del formulario).

import { REGIONAL_OPTIONS } from '../regional-options.js';

export const CHAT_REGISTRO_CAPABILITY_ID = 'agt003.chat-registro';
export const CHAT_REGISTRO_CONTRACT_VERSION = '1.0';
export const CHAT_REGISTRO_DEFAULT_DAILY_MAX = 100;
export const CHAT_MESSAGE_MAX_CHARS = 2000;
export const CHAT_MAX_ACTIONS = 12;
/** Ventanas de fechas: un seguimiento hecho (hasta 30 días atrás) y un próximo seguimiento (hasta 90 días adelante). */
export const CHAT_PAST_DAYS = 30;
export const CHAT_NEXT_MAX_DAYS = 90;

export const CHAT_ACTION_TYPES = Object.freeze(['registrar_seguimiento', 'proximo_seguimiento', 'actualizar_datos', 'crear_oportunidad', 'mover_etapa']);
/**
 * Decisiones de etapa que el chat puede PROPONER (Juan, 2026-10-23): avanzar —incluido ganar, que es avanzar a
 * `aprobado`— y perder con motivo. Congelar y descartar siguen siendo del botón "Decidir" de la ficha: son decisiones
 * de cartera, no el relato de lo que pasó con el cliente.
 */
export const CHAT_STAGE_DECISIONS = Object.freeze(['avanzar', 'perder']);
/** La nota de una decisión es obligatoria y la base exige al menos 5 caracteres (`psi_record_opportunity_decision`). */
export const CHAT_DECISION_NOTE_MIN = 5;
const DECISION_LABEL = Object.freeze({ avanzar: 'Avanza', perder: 'Perdida' });
export const CHAT_CHANNELS = Object.freeze(['llamada', 'whatsapp', 'correo', 'reunion', 'nota']);
const CHANNEL_LABEL = Object.freeze({ llamada: 'Llamada', whatsapp: 'WhatsApp', correo: 'Correo', reunion: 'Reunión', nota: 'Nota' });

/** Datos de la ficha que Vig-IA puede proponer cambiar (nunca etapa, valor, dueño ni decisiones). */
export const CHAT_DATA_FIELDS = Object.freeze({
  economic_sector: { label: 'Sector', max: 120 },
  quote_city: { label: 'Ciudad', max: 80 },
  decision_maker_name: { label: 'Nombre del decisor', max: 120 },
  decision_maker_title: { label: 'Cargo del decisor', max: 120 },
  decision_maker_email: { label: 'Correo del decisor', max: 160 },
  decision_maker_phone: { label: 'Teléfono del decisor', max: 40 },
  decision_maker_linkedin: { label: 'LinkedIn del decisor', max: 300 },
  company_website: { label: 'Página web', max: 300 },
  company_nit: { label: 'NIT', max: 30 },
  current_security_provider: { label: 'Proveedor actual', max: 160 },
  current_contract_end_date: { label: 'Vence el contrato actual', max: 10 },
});
const NEW_OPPORTUNITY_FIELDS = Object.freeze(['company_name', 'service_type_code', 'regional_nombre', ...Object.keys(CHAT_DATA_FIELDS)]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REF = /^o\d{1,4}$/;
const str = (max) => ({ type: 'string', minLength: 1, maxLength: max });
const dataProperties = () => Object.fromEntries([
  ...Object.entries(CHAT_DATA_FIELDS).map(([key, field]) => [key, str(field.max)]),
  ['current_security_provider_none', { type: 'boolean' }],
]);

/**
 * Contrato de salida (JSON Schema cerrado). Los servicios y las regionales van como listas cerradas para que Vig-IA no
 * invente valores.
 */
export function chatRegistroOutputSchema(serviceCodes = [], { stageCodes = [], lossReasonCodes = [] } = {}) {
  const services = [...new Set(serviceCodes.filter(code => typeof code === 'string' && code && code !== 'licitacion_publica'))];
  const stages = [...new Set((stageCodes || []).filter(code => typeof code === 'string' && code))];
  const reasons = [...new Set((lossReasonCodes || []).filter(code => typeof code === 'string' && code))];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['respuesta', 'acciones'],
    properties: {
      respuesta: str(1200),
      acciones: {
        type: 'array',
        maxItems: CHAT_MAX_ACTIONS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['tipo'],
          properties: {
            tipo: { type: 'string', enum: [...CHAT_ACTION_TYPES] },
            ref: { type: 'string', pattern: '^o[0-9]{1,4}$' },
            canal: { type: 'string', enum: [...CHAT_CHANNELS] },
            fecha: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
            nota: str(1500),
            proxima_fecha: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
            decision: { type: 'string', enum: [...CHAT_STAGE_DECISIONS] },
            etapa: stages.length ? { type: 'string', enum: stages } : str(60),
            motivo: reasons.length ? { type: 'string', enum: reasons } : str(60),
            competidor: str(120),
            datos: { type: 'object', additionalProperties: false, properties: dataProperties() },
            nueva: {
              type: 'object',
              additionalProperties: false,
              required: ['company_name', 'service_type_code', 'regional_nombre'],
              properties: {
                company_name: str(200),
                service_type_code: services.length ? { type: 'string', enum: services } : str(60),
                regional_nombre: { type: 'string', enum: [...REGIONAL_OPTIONS] },
                ...dataProperties(),
              },
            },
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fechas

export function addDays(isoDay, days) {
  const date = new Date(`${isoDay}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isRealDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export function weekdayName(isoDay) {
  return WEEKDAYS[new Date(`${isoDay}T12:00:00Z`).getUTCDay()];
}

/** Calendario corto (hoy y los próximos 14 días) para que Vig-IA convierta "el martes" en una fecha exacta. */
export function chatCalendar(today, days = 14) {
  return Array.from({ length: days + 1 }, (_, index) => {
    const day = addDays(today, index);
    return `${day} ${weekdayName(day)}${index === 0 ? ' (hoy)' : index === 1 ? ' (mañana)' : ''}`;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Limpieza de la propuesta

function fail(code) {
  const error = new Error('La respuesta de Vig-IA no tiene la estructura esperada.');
  error.code = code;
  return error;
}

const text = (value, max) => {
  const clean = typeof value === 'string' ? value.trim().replace(/[ \t]+/g, ' ') : '';
  return clean ? clean.slice(0, max) : null;
};
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function cleanData(raw, { avisos, label }) {
  if (!isPlain(raw)) return {};
  const out = {};
  for (const [key, field] of Object.entries(CHAT_DATA_FIELDS)) {
    const value = text(raw[key], field.max);
    if (!value) continue;
    if (key === 'current_contract_end_date' && !isRealDate(value)) { avisos.push(`No entendí la fecha de vencimiento del contrato de ${label}.`); continue; }
    if (key === 'decision_maker_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { avisos.push(`El correo del decisor de ${label} no parece válido; no lo incluí.`); continue; }
    out[key] = value;
  }
  if (raw.current_security_provider_none === true) {
    out.current_security_provider_none = true;
    delete out.current_security_provider;
    delete out.current_contract_end_date;
  }
  return out;
}

/**
 * Valida y limpia la salida de Vig-IA. Una acción inválida se descarta (con aviso), no tumba la respuesta. Devuelve
 * `{ respuesta, acciones, avisos }`. `refs`: Map ref → { label, stageCode, stageOrder } de las oportunidades que se le
 * mostraron. `stages`: el pipeline completo (`{ code, name, stage_order, is_terminal }`); `lossReasons`: los motivos
 * de pérdida activos (`{ code, name }`). Las dos listas llegan de la base: aquí nunca se escribe una etapa ni un
 * motivo que no exista.
 */
export function normalizeChatOutput(raw, { refs = new Map(), today, serviceCodes = [], stages = [], lossReasons = [] } = {}) {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { throw fail('AGT003_CHAT_INVALID_JSON'); } })() : raw;
  if (!isPlain(value)) throw fail('AGT003_CHAT_INVALID_SHAPE');
  const respuesta = text(value.respuesta, 1200);
  if (!respuesta) throw fail('AGT003_CHAT_INVALID_SHAPE');
  if (!ISO_DATE.test(String(today || ''))) throw new Error('Falta la fecha de hoy.');
  const services = new Set(serviceCodes);
  const stageByCode = new Map((stages || []).filter(stage => stage?.code).map(stage => [stage.code, stage]));
  const reasonByCode = new Map((lossReasons || []).filter(reason => reason?.code).map(reason => [reason.code, reason]));
  const avisos = [];
  const acciones = [];
  const byKey = new Map();
  const minPast = addDays(today, -CHAT_PAST_DAYS);
  const maxNext = addDays(today, CHAT_NEXT_MAX_DAYS);
  const nextOk = day => isRealDate(day) && day >= today && day <= maxNext;
  const pastOk = day => isRealDate(day) && day >= minPast && day <= today;
  const list = Array.isArray(value.acciones) ? value.acciones.slice(0, CHAT_MAX_ACTIONS) : [];
  const addNext = (ref, day, label) => {
    if (!nextOk(day)) { avisos.push(`La próxima fecha de ${label} debe estar entre hoy y los próximos ${CHAT_NEXT_MAX_DAYS} días.`); return; }
    const key = `next:${ref}`;
    if (byKey.has(key)) byKey.get(key).fecha = day;
    else { const action = { tipo: 'proximo_seguimiento', ref, fecha: day }; byKey.set(key, action); acciones.push(action); }
  };

  for (const item of list) {
    if (!isPlain(item) || !CHAT_ACTION_TYPES.includes(item.tipo)) continue;
    if (item.tipo === 'crear_oportunidad') {
      const nueva = isPlain(item.nueva) ? item.nueva : {};
      const company = text(nueva.company_name, 200);
      if (!company) continue;
      if (!services.has(nueva.service_type_code) || nueva.service_type_code === 'licitacion_publica') { avisos.push(`Para crear ${company} falta el servicio de interés.`); continue; }
      if (!REGIONAL_OPTIONS.includes(nueva.regional_nombre)) { avisos.push(`Para crear ${company} falta la regional.`); continue; }
      const action = {
        tipo: 'crear_oportunidad',
        nueva: { company_name: company, service_type_code: nueva.service_type_code, regional_nombre: nueva.regional_nombre, ...cleanData(nueva, { avisos, label: company }) },
      };
      const nota = text(item.nota, 1500);
      if (nota) {
        action.nota = nota;
        action.canal = CHAT_CHANNELS.includes(item.canal) ? item.canal : 'nota';
        action.fecha = pastOk(item.fecha) ? item.fecha : today;
      }
      if (item.proxima_fecha) {
        if (nextOk(item.proxima_fecha)) action.proxima_fecha = item.proxima_fecha;
        else avisos.push(`La próxima fecha de ${company} debe estar entre hoy y los próximos ${CHAT_NEXT_MAX_DAYS} días.`);
      }
      acciones.push(action);
      continue;
    }
    if (!REF.test(String(item.ref || '')) || !refs.has(item.ref)) continue;
    const label = refs.get(item.ref)?.label || 'el cliente';
    if (item.tipo === 'registrar_seguimiento') {
      const nota = text(item.nota, 1500);
      if (!nota) continue;
      const fecha = item.fecha && pastOk(item.fecha) ? item.fecha : today;
      if (item.fecha && !pastOk(item.fecha)) avisos.push(`El seguimiento de ${label} quedó con fecha de hoy (la fecha indicada no era válida).`);
      acciones.push({ tipo: 'registrar_seguimiento', ref: item.ref, canal: CHAT_CHANNELS.includes(item.canal) ? item.canal : 'nota', fecha, nota });
      // El modelo a veces trae la próxima fecha dentro del seguimiento: se vuelve su propia acción.
      if (item.proxima_fecha) addNext(item.ref, item.proxima_fecha, label);
    } else if (item.tipo === 'proximo_seguimiento') {
      addNext(item.ref, item.fecha || item.proxima_fecha, label);
    } else if (item.tipo === 'mover_etapa') {
      // Las reglas son las del botón "Decidir" de la ficha, y la base las vuelve a validar de forma atómica en
      // `psi_record_opportunity_decision`: aquí se filtra lo que no tiene sentido proponerle al comercial, no se
      // sustituye esa validación.
      const target = refs.get(item.ref) || {};
      const decision = CHAT_STAGE_DECISIONS.includes(item.decision) ? item.decision : null;
      if (!decision) { avisos.push(`No entendí qué decisión tomar con ${label}.`); continue; }
      const nota = text(item.nota, 1500);
      if (!nota || nota.length < CHAT_DECISION_NOTE_MIN) { avisos.push(`Para mover la etapa de ${label} necesito que me cuente en una frase qué pasó.`); continue; }
      const key = `stage:${item.ref}`;
      if (byKey.has(key)) { avisos.push(`Dejé una sola decisión para ${label}.`); continue; }
      const action = { tipo: 'mover_etapa', ref: item.ref, decision, nota };
      if (decision === 'avanzar') {
        const stage = stageByCode.get(item.etapa);
        if (!stage || stage.code === 'descartado' || stage.code === 'perdido') { avisos.push(`No reconocí la etapa a la que quiere mover ${label}.`); continue; }
        const currentOrder = Number(target.stageOrder ?? 0);
        if (Number(stage.stage_order) <= currentOrder) { avisos.push(`${label} ya está en ${target.stageName || 'su etapa'} o más adelante: la etapa sólo avanza.`); continue; }
        action.etapa = stage.code;
        action.etapa_nombre = stage.name || stage.code;
        if (!stage.is_terminal) {
          const day = nextOk(item.proxima_fecha) ? item.proxima_fecha : (nextOk(item.fecha) ? item.fecha : null);
          if (!day) { avisos.push(`Para avanzar ${label} a ${action.etapa_nombre} falta la próxima gestión: una oportunidad abierta no puede quedar sin fecha.`); continue; }
          action.proxima_fecha = day;
        }
      } else {
        const reason = reasonByCode.get(item.motivo);
        if (!reason) { avisos.push(`Para registrar la pérdida de ${label} falta el motivo.`); continue; }
        action.motivo = reason.code;
        action.motivo_nombre = reason.name || reason.code;
        const competidor = text(item.competidor, 120);
        if (competidor) action.competidor = competidor;
      }
      byKey.set(key, action);
      acciones.push(action);
    } else if (item.tipo === 'actualizar_datos') {
      const datos = cleanData(item.datos, { avisos, label });
      if (!Object.keys(datos).length) continue;
      const key = `data:${item.ref}`;
      if (byKey.has(key)) Object.assign(byKey.get(key).datos, datos);
      else { const action = { tipo: 'actualizar_datos', ref: item.ref, datos }; byKey.set(key, action); acciones.push(action); }
    }
  }
  // La decisión va al final de la propuesta y se aplica de última: el seguimiento y los datos del cliente tienen que
  // quedar registrados ANTES de que la oportunidad se cierre, no después.
  const moves = acciones.filter(action => action.tipo === 'mover_etapa');
  const ordered = moves.length ? [...acciones.filter(action => action.tipo !== 'mover_etapa'), ...moves] : acciones;
  // Una decisión que cierra la oportunidad (ganada o perdida) manda sobre cualquier próxima fecha de ese mismo
  // cliente: la base la borra, así que proponerla sería prometer algo que no va a quedar.
  const closing = new Set(moves.filter(action => action.decision === 'perder' || !action.proxima_fecha).map(action => action.ref));
  const final = closing.size
    ? ordered.filter(action => !(action.tipo === 'proximo_seguimiento' && closing.has(action.ref)))
    : ordered;
  return { respuesta, acciones: final, avisos };
}

// ---------------------------------------------------------------------------------------------------------------------
// Descripción en lenguaje común (pantallas)

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function humanDay(isoDay) {
  if (!isRealDate(isoDay)) return String(isoDay || '');
  const [, month, day] = isoDay.split('-').map(Number);
  return `${weekdayName(isoDay)} ${day} ${MONTHS[month - 1]}`;
}

function describeData(datos) {
  const parts = [];
  for (const [key, value] of Object.entries(datos || {})) {
    if (key === 'current_security_provider_none') { if (value === true) parts.push('Proveedor actual: No tiene'); continue; }
    const field = CHAT_DATA_FIELDS[key];
    if (!field || key === 'company_name' || key === 'service_type_code' || key === 'regional_nombre') continue;
    parts.push(`${field.label}: ${key === 'current_contract_end_date' ? humanDay(value) : value}`);
  }
  return parts;
}

/**
 * Líneas para mostrar una acción. `labelFor(ref)` devuelve el nombre del cliente; `serviceName(code)` el del servicio.
 * Devuelve `{ cliente, lineas: string[] }`.
 */
export function describeChatAction(action, { labelFor = () => 'Cliente', serviceName = code => code } = {}) {
  if (action.tipo === 'crear_oportunidad') {
    const n = action.nueva || {};
    const lineas = [`Cliente nuevo · ${serviceName(n.service_type_code)} · ${n.regional_nombre}`, ...describeData(n)];
    if (action.nota) lineas.push(`${CHANNEL_LABEL[action.canal] || 'Nota'} del ${humanDay(action.fecha)}: ${action.nota}`);
    if (action.proxima_fecha) lineas.push(`Próximo seguimiento: ${humanDay(action.proxima_fecha)}`);
    return { cliente: n.company_name, lineas };
  }
  const cliente = labelFor(action.ref);
  if (action.tipo === 'registrar_seguimiento') return { cliente, lineas: [`${CHANNEL_LABEL[action.canal] || 'Nota'} del ${humanDay(action.fecha)}: ${action.nota}`] };
  if (action.tipo === 'proximo_seguimiento') return { cliente, lineas: [`Próximo seguimiento: ${humanDay(action.fecha)}`] };
  if (action.tipo === 'mover_etapa') {
    const lineas = [];
    if (action.decision === 'avanzar') {
      lineas.push(`${DECISION_LABEL.avanzar} a ${action.etapa_nombre || action.etapa}`);
      if (action.proxima_fecha) lineas.push(`Próximo seguimiento: ${humanDay(action.proxima_fecha)}`);
      else lineas.push('Queda cerrada, sin próxima gestión');
    } else {
      lineas.push(`${DECISION_LABEL.perder} · Motivo: ${action.motivo_nombre || action.motivo}`);
      if (action.competidor) lineas.push(`Frente a: ${action.competidor}`);
    }
    lineas.push(`Qué pasó: ${action.nota}`);
    return { cliente, lineas };
  }
  return { cliente, lineas: describeData(action.datos) };
}

export { NEW_OPPORTUNITY_FIELDS };
