// AGT-002 — el origen del documento: QUIÉN lo produjo (pendiente de Juan, 2026-10-22).
//
// Es ortogonal a `document_type`, que dice QUÉ es. Un `pliego` puede venir de la entidad o ser un borrador
// nuestro; una `respuesta a observaciones` es de la entidad aunque responda a un tercero. Confundirlos es lo que
// hizo que `OBSERVACIONES AL PROYECTO DE PLIEGOS PEREIRA ADMINISTRATIVO.docx.pdf` —carta de otra empresa— quedara
// tipificada `pliego` y marcada como oficial verificada: el nombre del archivo traía la palabra.
//
// Este módulo es el único lugar donde el origen se traduce a las dos decisiones que hoy se asumen:
//
//   1. `source_classification` del paquete de evidencia, que el constructor del agregado convierte en
//      `source_type` / `officiality_status`. Hoy TODO documento admitido entra como `official`.
//   2. Si una carga manual rompe el silencio de la entidad para la verificación de frescura. Hoy ninguna lo
//      hace, ni siquiera un documento de la entidad bajado del módulo de mensajes de SECOP II y subido a mano.
//
// Módulo puro: sin red, sin base de datos.

/** Lo que una persona declara al cargar. El mismo vocabulario que acepta la migración 150. */
export const TENDER_DOCUMENT_ORIGINS = Object.freeze({
  entidad: 'De la entidad',
  tercero: 'De un tercero',
  propio: 'Nuestro',
  borrador: 'Borrador',
});

export const TENDER_DOCUMENT_ORIGIN_VALUES = Object.freeze(Object.keys(TENDER_DOCUMENT_ORIGINS));

/**
 * Origen → clase de fuente del paquete de evidencia.
 *
 * `null` (sin declarar) NO está aquí a propósito: lo resuelve `tenderDocumentSourceClassification` hacia
 * `third_party`, que es el lado seguro. Falla hacia "esto no es una regla del proceso", nunca hacia "esto es
 * el pliego".
 */
const CLASSIFICATION_BY_ORIGIN = Object.freeze({
  entidad: 'official',
  tercero: 'third_party',
  propio: 'internal',
  borrador: 'draft',
});

/** Normaliza lo que venga del cliente o de la base; cualquier cosa que no sea del vocabulario es `null`. */
export function normalizeTenderDocumentOrigin(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return TENDER_DOCUMENT_ORIGIN_VALUES.includes(text) ? text : null;
}

/**
 * La clase con la que el documento entra al paquete de evidencia.
 *
 * Sin origen declarado devuelve `third_party`: antes de este módulo la respuesta era `official` para todo, que
 * es como una carta de un competidor terminaba con el peso del pliego de la entidad.
 */
export function tenderDocumentSourceClassification(origin) {
  return CLASSIFICATION_BY_ORIGIN[normalizeTenderDocumentOrigin(origin)] ?? 'third_party';
}

/**
 * ¿Este documento es una publicación de la ENTIDAD, para efectos de la verificación de frescura?
 *
 * Dos caminos, y el segundo es el que faltaba:
 *   * vino por un portal oficial (SECOP II, ESU): el origen no se declara, se sabe de dónde se bajó;
 *   * lo cargó una persona Y declaró que es de la entidad.
 *
 * Una carga sin declarar no cuenta, igual que antes: el silencio de la entidad no se rompe por una suposición.
 * `isOfficialSource` es `agt002IsOfficialDocumentSource`, que se pasa inyectado para no cruzar los módulos.
 */
export function tenderDocumentBreaksEntitySilence({ source, origin } = {}, isOfficialSource) {
  if (typeof isOfficialSource === 'function' && isOfficialSource(source)) return true;
  return normalizeTenderDocumentOrigin(origin) === 'entidad';
}

/**
 * Lo que la pantalla propone al cargar, para que la persona corrija en vez de llenar desde cero. SÓLO se
 * propone para lo que viene de un portal oficial, donde no es una adivinanza. Para una carga manual devuelve
 * `null`: adivinar el origen por el nombre del archivo es exactamente el defecto que esto corrige.
 */
export function suggestTenderDocumentOrigin({ source } = {}, isOfficialSource) {
  if (typeof isOfficialSource === 'function' && isOfficialSource(source)) return 'entidad';
  return null;
}
