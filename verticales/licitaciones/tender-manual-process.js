// AGT-002 — un proceso que NO está en SECOP, creado a mano (Juan, 2026-10-29: "hay procesos que no están en SECOP y
// aparecen en otras plataformas; hay que poder crearlos a mano y darles el mismo seguimiento").
//
// Todo el seguimiento de Licitaciones cuelga de una fila de `psi_public_tenders` ligada a la oportunidad por
// `converted_opportunity_id`: de ahí leen el expediente, la Mesa con Vig-IA, el botón de analizar
// (`agt002-manual-reanalysis.js`), la carga manual de documentos (`getTenderIdForOpportunity`) y el acta de cierre.
// Crear un proceso a mano no es, entonces, una oportunidad sin licitación: es la misma pareja licitación +
// oportunidad que produce el Radar, sólo que los datos los declara una persona y no una fuente oficial.
//
// De ahí las dos marcas que este módulo calcula y nadie más debe inventar:
//
//   - `stable_key` con prefijo `manual-`: ninguna corrida del Radar puede pisar la fila (sus llaves son el sha1 de
//     la fuente oficial), y dos registros del mismo proceso chocan contra el índice único en vez de duplicarse.
//   - `external_source` `licitacion_manual:<llave>`: el índice parcial de la 018 reserva `secop_radar:%` para el
//     Radar, así que el manual necesita su propio espacio de nombres y su propio índice único (migración 165).
//
// La fecha de cierre viaja dos veces a propósito: `deadline_at` para las consultas y `raw.deadline` como fecha de
// calendario exacta, que es la autoridad de `resolveCanonicalTenderDeadline` y evita que el reloj se corra un día al
// pasar de medianoche UTC a America/Bogota.
//
// Módulo puro: sin red, sin base de datos, sin express.

import { createHash } from 'node:crypto';

export const TENDER_MANUAL_PROCESS_STABLE_KEY_PREFIX = 'manual-';
export const TENDER_MANUAL_PROCESS_EXTERNAL_SOURCE_PREFIX = 'licitacion_manual:';
/** Sección del Radar: lo que una persona registró a mano ya pasó su filtro, así que entra como `hacer`. */
export const TENDER_MANUAL_PROCESS_SECTION = 'hacer';

const MAX_LENGTHS = Object.freeze({
  source: 80,
  entity: 300,
  title: 600,
  description: 4000,
  ref: 200,
  url: 600,
  city: 160,
  dept: 160,
});

function manualProcessError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeKeyPart(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function requiredText(value, label, max) {
  const text = String(value ?? '').trim();
  if (!text) throw manualProcessError(`Debe indicar ${label}.`);
  if (text.length > max) throw manualProcessError(`${label.charAt(0).toUpperCase()}${label.slice(1)} no puede superar ${max} caracteres.`);
  return text;
}

function optionalText(value, label, max) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > max) throw manualProcessError(`${label.charAt(0).toUpperCase()}${label.slice(1)} no puede superar ${max} caracteres.`);
  return text;
}

export function isManualProcessCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Enlace de la plataforma donde vive el proceso. Sólo http(s) con host: nunca `javascript:` ni una ruta relativa. */
function optionalLink(value) {
  const text = optionalText(value, 'el enlace del proceso', MAX_LENGTHS.url);
  if (!text) return null;
  let parsed;
  try { parsed = new URL(text); } catch { throw manualProcessError('El enlace del proceso no es una dirección válida.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw manualProcessError('El enlace del proceso debe empezar por http:// o https://.');
  if (!parsed.hostname) throw manualProcessError('El enlace del proceso no es una dirección válida.');
  return parsed.toString();
}

/**
 * El valor en pesos, tal como lo escribe una persona: `1.200.000.000` y `1 200 000 000` son el mismo número. Los
 * puntos, las comas y los espacios son separadores de miles y se descartan; un valor de licitación no tiene centavos.
 */
function optionalMoney(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const digits = text.replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(digits)) throw manualProcessError('El valor del proceso no es válido: escriba sólo números.');
  const amount = Number(digits);
  if (!Number.isFinite(amount)) throw manualProcessError('El valor del proceso no es válido: escriba sólo números.');
  return amount;
}

/**
 * Identidad del proceso: plataforma, entidad, referencia y objeto. Sin referencia manda el objeto, que es lo único
 * que siempre hay. Dos registros del mismo proceso producen la misma llave y el segundo choca con el índice único.
 */
export function manualTenderStableKey({ source, entity, ref, title } = {}) {
  const base = [source, ref, entity, title].map(normalizeKeyPart).join('|');
  return `${TENDER_MANUAL_PROCESS_STABLE_KEY_PREFIX}${createHash('sha1').update(base).digest('hex').slice(0, 20)}`;
}

export function manualTenderExternalSource(stableKey) {
  return `${TENDER_MANUAL_PROCESS_EXTERNAL_SOURCE_PREFIX}${stableKey}`;
}

export function isManualTenderStableKey(value) {
  return String(value ?? '').startsWith(TENDER_MANUAL_PROCESS_STABLE_KEY_PREFIX);
}

export function isManualTenderExternalSource(value) {
  return String(value ?? '').startsWith(TENDER_MANUAL_PROCESS_EXTERNAL_SOURCE_PREFIX);
}

/** Las observaciones de la oportunidad, con el mismo orden que las del Radar y la marca de quién lo registró. */
export function manualTenderProcessNotes(fields) {
  return [
    `Origen: ${fields.source} / creado a mano en el CRM`,
    `Referencia: ${fields.ref || '—'}`,
    `Objeto: ${fields.title}`,
    `Entidad: ${fields.entity}`,
    `Ubicación: ${fields.city || fields.dept || '—'}`,
    fields.closeDate ? `Cierre declarado: ${fields.closeDate}` : 'Cierre declarado: sin fecha',
    fields.url ? `Link fuente: ${fields.url}` : '',
    fields.description ? `Notas: ${fields.description}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Lo que una persona declara al crear el proceso, ya validado y listo para la RPC. Nada se adivina: la plataforma, la
 * entidad y el objeto son obligatorios porque sin ellos el proceso no se puede ni nombrar; la fecha de cierre es
 * opcional porque inventarla corrompería el reloj, y sin ella el proceso simplemente no tiene vencimiento todavía.
 */
export function normalizeManualTenderProcessInput(input = {}) {
  const source = requiredText(input.source ?? input.plataforma, 'la plataforma donde está el proceso', MAX_LENGTHS.source);
  const entity = requiredText(input.entity ?? input.entidad, 'la entidad', MAX_LENGTHS.entity);
  const title = requiredText(input.title ?? input.objeto, 'el objeto del proceso', MAX_LENGTHS.title);
  const ref = optionalText(input.ref ?? input.referencia, 'la referencia', MAX_LENGTHS.ref);
  const description = optionalText(input.description ?? input.notas, 'las notas', MAX_LENGTHS.description);
  const city = optionalText(input.city ?? input.ciudad, 'la ciudad', MAX_LENGTHS.city);
  const dept = optionalText(input.dept ?? input.departamento, 'el departamento', MAX_LENGTHS.dept);
  const url = optionalLink(input.url ?? input.enlace);
  const value = optionalMoney(input.value ?? input.valor);
  const closeDateInput = String(input.close_date ?? input.deadline ?? input.fecha_cierre ?? '').trim();
  if (closeDateInput && !isManualProcessCalendarDate(closeDateInput)) {
    throw manualProcessError('La fecha de cierre debe ser una fecha de calendario (AAAA-MM-DD).');
  }
  const closeDate = closeDateInput || null;
  const stableKey = manualTenderStableKey({ source, entity, ref, title });
  const fields = { source, entity, title, ref, description, city, dept, url, value, closeDate };
  return Object.freeze({
    ...fields,
    stableKey,
    externalSource: manualTenderExternalSource(stableKey),
    section: TENDER_MANUAL_PROCESS_SECTION,
    // Medianoche UTC de la fecha declarada; `raw.deadline` conserva la fecha de calendario exacta, que es la que
    // manda en `resolveCanonicalTenderDeadline` y la que el Radar y el fit muestran.
    deadlineAt: closeDate ? `${closeDate}T00:00:00.000Z` : null,
    observaciones: manualTenderProcessNotes(fields),
    raw: Object.freeze({
      manual_entry: true,
      platform: source,
      ...(closeDate ? { deadline: closeDate } : {}),
      ...(url ? { url } : {}),
    }),
  });
}
