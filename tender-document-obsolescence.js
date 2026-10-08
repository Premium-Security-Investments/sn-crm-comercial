// AGT-002 — documentos que una fase nueva de SECOP vuelve obsoletos (decisión del dueño 2026-10-08).
//
// Cuando llegan documentos nuevos de un proceso convertido, algunos de los vigentes dejan de servir para el análisis y
// pasan a HISTORIAL (current = false; nada se borra):
//   · el proyecto de pliego, cuando llega el pliego definitivo;
//   · el anexo técnico del borrador, cuando llega el definitivo (mismo anexo);
//   · los formatos (oferta económica, factores de calidad, anexos editables), cuando llega su versión nueva.
// Nunca se archivan: estudios previos, análisis del sector, CDP y aprobaciones de Hacienda o vigencias futuras, avisos,
// respuestas a observaciones, adendas ni resoluciones. Si hay duda, NO se archiva y se dice en el aviso.
//
// Módulo puro: sólo nombres de archivo, sin red ni base de datos.

function normalize(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\.(pdf|docx?|xlsx?|zip|rar|7z|odt|ods|txt|csv)$/i, '')
    .replace(/[º°]/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function extensionOf(name) {
  return (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
}

const NEVER_ARCHIVE = /\b(estudios? previos?|analisis (del|de) sector|estudio (del|de) sector|cdp|certificado de disponibilidad|disponibilidad presupuestal|vigencias? futuras?|hacienda|aprobacion|aviso|respuestas?|observaciones|adendas?|resolucion|concepto|radicado|oficio|solicitud)\b/;
const DRAFT_PLIEGO = /\b(proyecto|borrador|pre) ?(de )?pliego|\bprepliego\b/;
const PLIEGO = /\bpliegos?\b/;
const TECHNICAL_ANNEX = /\b(anexos? (no |n )?\d* ?tecnicos?|ficha tecnica|especificaciones tecnicas)\b/;
const FORMAT = /\b(formatos?|oferta economica|propuesta economica|factores? (de )?(calidad|ponderacion|puntaje)|anexos? editables?)\b/;
const EDITABLE = new Set(['doc', 'docx', 'xls', 'xlsx', 'odt', 'ods', 'zip']);
const VERSION_WORDS = new Set(['definitivo', 'definitiva', 'definitivos', 'definitivas', 'final', 'vf', 'consolidado', 'consolidada',
  'actualizado', 'actualizada', 'ajustado', 'ajustada', 'modificado', 'modificada', 'nuevo', 'nueva', 'version', 'limpio', 'en',
  'firmado', 'firmada', 'suscrito', 'suscrita', 'rev', 'adenda', 'no', 'n', 'nro', 'lp', 'sa', 'cm', 'proceso', 'vigilancia',
  'seguridad', 'privada', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'para', 'al', 'a', 'con']);

/**
 * Tipo del documento para estas reglas. Un documento que LLEGA puede ser la versión consolidada de otro ("Anexo N°. 4
 * Oferta Economica Consolidado Adenda 03.xlsx"): para él no cuentan las palabras "adenda"/"consolidado". Un documento
 * vigente que es una adenda nunca se archiva.
 */
export function tenderDocumentObsolescenceKind(name, { incoming = false } = {}) {
  let text = normalize(name);
  if (incoming) text = text.replace(/\badendas?(?: (?:no|n|nro))?(?: \d+)?\b/g, ' ').replace(/\bconsolidad[oa]\b/g, ' ').replace(/\s+/g, ' ').trim();
  // Primero los protegidos: "Respuesta a observaciones al proyecto de pliego", "Aviso de convocatoria y proyecto de
  // pliego" o "Estudio previo y proyecto de pliego" nunca se archivan.
  if (NEVER_ARCHIVE.test(text)) return 'protected';
  if (DRAFT_PLIEGO.test(text)) return 'draft_pliego';
  if (PLIEGO.test(text)) return 'pliego';
  if (TECHNICAL_ANNEX.test(text)) return 'technical_annex';
  if (FORMAT.test(text) || (/\banexos?\b/.test(text) && EDITABLE.has(extensionOf(name)))) return 'format';
  return 'other';
}

/**
 * Familia: el nombre sin palabras de versión, referencias del proceso, fechas ni números sueltos, pero con el número de
 * anexo o formato ("anexo 4"). "Anexo N° 4. Oferta Económica.xlsx" y "Anexo N°. 4 Oferta Economica Consolidado Adenda
 * 03.xlsx" son la misma familia; "3. ANEXO TECNICO VIGILANCIA 2026 (1).pdf" y "3. ANEXO TECNICO DEFINITIVO VIGILANCIA
 * 2026.pdf" también.
 */
export function tenderDocumentFamilyKey(name) {
  const text = normalize(name).replace(/\b(anexos?|formatos?)\s+(?:(?:no|n|nro)\s+)?(\d{1,2})\b/g, '$1 #$2');
  return text.split(' ')
    .filter(token => token && (token.startsWith('#') || !/\d/.test(token)) && !VERSION_WORDS.has(token))
    .map(token => token.replace(/^#/, ''))
    .join(' ').replace(/\b(anexo|formato)s\b/g, '$1').trim();
}

const words = key => new Set(key.split(' ').filter(word => word.length > 2));
function overlaps(a, b) {
  const left = words(a); const right = words(b);
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared >= 2 || (shared >= 1 && Math.min(left.size, right.size) <= 1);
}

/**
 * Decide qué documentos vigentes pasan a historial por la llegada de `incomingNames`.
 * `currentNames`: nombres vigentes ANTES de la llegada (no incluye los nuevos).
 * Devuelve `{ archive: [{ name, reason, replacedBy }], doubts: [{ name, candidate, reason }] }`.
 */
export function planObsoleteTenderDocuments({ currentNames = [], incomingNames = [] } = {}) {
  const incoming = incomingNames.map(name => ({ name, kind: tenderDocumentObsolescenceKind(name, { incoming: true }), family: tenderDocumentFamilyKey(name) }));
  const incomingSet = new Set(incomingNames.map(normalize));
  const archive = [];
  const doubts = [];
  const definitivePliego = incoming.find(doc => doc.kind === 'pliego');
  for (const name of currentNames) {
    if (incomingSet.has(normalize(name))) continue; // mismo nombre: lo reemplaza la versión nueva (identidad por nombre).
    const kind = tenderDocumentObsolescenceKind(name);
    const family = tenderDocumentFamilyKey(name);
    if (kind === 'draft_pliego') {
      if (definitivePliego) archive.push({ name, reason: 'proyecto_de_pliego', replacedBy: definitivePliego.name });
      continue;
    }
    if (kind === 'pliego') {
      const newer = incoming.find(doc => doc.kind === 'pliego' && doc.family === family);
      if (newer) doubts.push({ name, candidate: newer.name, reason: 'pliego_definitivo_reemplazado' });
      continue;
    }
    if (kind !== 'technical_annex' && kind !== 'format') continue;
    const same = incoming.find(doc => doc.kind === kind && doc.family === family && family);
    if (same) {
      archive.push({ name, reason: kind === 'technical_annex' ? 'anexo_tecnico_del_borrador' : 'formato_con_version_nueva', replacedBy: same.name });
      continue;
    }
    const similar = incoming.find(doc => (doc.kind === kind || doc.kind === 'technical_annex' || doc.kind === 'format') && overlaps(doc.family, family));
    if (similar) doubts.push({ name, candidate: similar.name, reason: 'posible_version_nueva' });
  }
  return { archive, doubts };
}
