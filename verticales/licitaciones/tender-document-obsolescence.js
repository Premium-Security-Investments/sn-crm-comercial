// AGT-002 — documentos que una fase nueva de SECOP vuelve obsoletos (decisión del dueño 2026-10-08).
//
// Cuando llegan documentos nuevos de un proceso convertido, algunos de los vigentes dejan de servir para el análisis y
// pasan a HISTORIAL (current = false; nada se borra):
//   · el proyecto de pliego, cuando llega el pliego definitivo;
//   · el anexo técnico del borrador, cuando llega el definitivo (mismo anexo);
//   · los formatos (oferta económica, factores de calidad, anexos editables), cuando llega su versión nueva.
//   · cualquier documento cuando llega su versión marcada "Definitivo/Definitiva" de la misma familia (2026-10-20).
//   · el pliego o formato cuando la Entidad publica la versión con la adenda incorporada: «INCLUYE ADENDA PLIEGO…» reemplaza
//     a «PLIEGO…» (Pereira, 2026-11-24: Vig-IA leyó los dos y calculó la garantía con el presupuesto viejo).
// Nunca se archivan, salvo por esa versión definitiva explícita: estudios previos, análisis del sector, CDP y
// aprobaciones de Hacienda o vigencias futuras, avisos, respuestas a observaciones, adendas ni resoluciones (estos
// cinco últimos, nunca). Si hay duda, NO se archiva y se dice en el aviso.
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
// Versión definitiva explícita: "2. Estudios Previos Definitivo.pdf" reemplaza a "4. Estudios Previos.pdf" de la misma
// familia, aunque los estudios previos estén protegidos (Juan, 2026-10-20: en Cali quedaron vigentes a la vez el
// presupuesto viejo y el definitivo, con cifras que se contradicen). Nunca para adendas, respuestas, avisos,
// resoluciones ni documentos presupuestales: no tienen versión "definitiva" de sí mismos.
const DEFINITIVE = /\b(definitiv[oa]s?|final)\b/;
const NO_DEFINITIVE_REPLACEMENT = /\b(adendas?|respuestas?|observaciones|aviso|resolucion|radicado|oficio|solicitud|cdp|certificado de disponibilidad|disponibilidad presupuestal|vigencias? futuras?)\b/;
const DRAFT_PLIEGO = /\b(proyecto|borrador|pre) ?(de )?pliego|\bprepliego\b/;
const PLIEGO = /\bpliegos?\b/;
const TECHNICAL_ANNEX = /\b(anexos? (no |n )?\d* ?tecnicos?|ficha tecnica|especificaciones tecnicas)\b/;
const FORMAT = /\b(formatos?|oferta economica|propuesta economica|factores? (de )?(calidad|ponderacion|puntaje)|anexos? editables?)\b/;
const EDITABLE = new Set(['doc', 'docx', 'xls', 'xlsx', 'odt', 'ods', 'zip']);
const VERSION_WORDS = new Set(['definitivo', 'definitiva', 'definitivos', 'definitivas', 'final', 'vf', 'consolidado', 'consolidada',
  'actualizado', 'actualizada', 'ajustado', 'ajustada', 'modificado', 'modificada', 'nuevo', 'nueva', 'version', 'limpio', 'en',
  'firmado', 'firmada', 'suscrito', 'suscrita', 'rev', 'adenda', 'no', 'n', 'nro', 'lp', 'sa', 'cm', 'proceso', 'vigilancia',
  'seguridad', 'privada', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'para', 'al', 'a', 'con', 'incluye']);

// «INCLUYE ADENDA …» / «… con adenda incorporada»: la Entidad publica el mismo documento con la adenda ya aplicada.
const INCORPORATED_ADENDA = /\b(incluye adendas?|con adendas? incorporadas?|adendas? incorporadas?)\b/;
/** ¿El nombre dice que es el documento con la adenda ya incorporada (no la adenda suelta)? */
export function isIncorporatedAdendaVersion(name) {
  return INCORPORATED_ADENDA.test(normalize(name));
}

// Versión ajustada (DEAJ LP-07-2026, 2026-11-25): la Entidad republica «Pliego … Ajustado LP-07-2026 23112026.pdf»,
// «Anexo ANS … Ajustado 23112026.pdf» o «Estudio de Mercado … - ajustado adenda.xlsx» sin decir «incluye adenda», y los
// del 11-nov quedaban vigentes al lado. Marca de versión: ajustado, corregido, actualizado, adenda, o una fecha en el nombre.
const REVISION_MARK = /\b(ajustad[oa]s?|corregid[oa]s?|actualizad[oa]s?|adendas?|incluye adendas?)\b/;
/** Fecha escrita en el nombre («23112026», «11-11-26», «FINAL11-11-2026», «11.11.26») como AAAA-MM-DD, o null. */
export function dateInDocumentName(name) {
  const text = String(name || '').toLowerCase();
  let m = /(?:^|[^\d])(\d{2})(\d{2})(20\d{2})(?!\d)/.exec(text);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /(?:^|[^\d])(\d{1,2})[-_. ](\d{1,2})[-_. ](\d{2}|20\d{2})(?!\d)/.exec(text);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}
/** ¿El nombre se presenta como versión revisada de otro (marca de versión o fecha)? */
export function isRevisedVersion(name) {
  return REVISION_MARK.test(normalize(name)) || Boolean(dateInDocumentName(name));
}
const FILE_GROUP = ext => (['xls', 'xlsx', 'ods', 'csv'].includes(ext) ? 'hoja' : ['doc', 'docx', 'odt'].includes(ext) ? 'texto' : ext);
const sameFileGroup = (a, b) => FILE_GROUP(extensionOf(a)) === FILE_GROUP(extensionOf(b));
const COMPATIBLE = new Set(['other', 'technical_annex', 'format']);
/** Mismo documento con otro nombre: dos o más palabras en común y al menos el 60 % de las del nombre más corto. */
function strongFamilyMatch(a, b) {
  // Números de anexo o formato distintos («formato 1» frente a «formato 2») son documentos distintos.
  const numbers = key => String(key || '').split(' ').filter(word => /^\d+$/.test(word)).sort().join(',');
  if (numbers(a) !== numbers(b)) return false;
  const left = String(a || '').split(' ').filter(word => word.length > 1);
  const right = new Set(String(b || '').split(' ').filter(word => word.length > 1));
  if (left.length < 2 || right.size < 2) return false;
  const shared = left.filter(word => right.has(word)).length;
  return shared >= 2 && shared / Math.min(left.length, right.size) >= 0.6;
}
/** Número de ítem al inicio del nombre («27. Formato …», «17 Formato …»): números distintos son documentos distintos. */
function leadingItemNumber(name) {
  const m = /^\s*(\d{1,3})\s*[-.)_ ]/.exec(String(name || ''));
  return m ? Number(m[1]) : null;
}
function differentItemNumbers(a, b) {
  const left = leadingItemNumber(a); const right = leadingItemNumber(b);
  return left !== null && right !== null && left !== right;
}
const sharedWords = (a, b) => { const right = new Set(String(b || '').split(' ').filter(word => word.length > 1)); return String(a || '').split(' ').filter(word => word.length > 1 && right.has(word)).length; };
/** Lo que le sobra al nombre del vigente no identifica otro documento («presupuesto oficial» sí lo identifica: Cali). */
function extraWordsAreNotIdentifying(currentFamily, incomingFamily) {
  const incomingWords = new Set(String(incomingFamily || '').split(' '));
  return String(currentFamily || '').split(' ').filter(word => word && !incomingWords.has(word))
    .every(word => word.length <= 4 || NON_IDENTIFYING.has(word) || /ajust|correg|actualiz/.test(word));
}
/** La llegada es una versión revisada del vigente: misma clase de archivo, familia fuerte y no es de fecha anterior. */
function revisedReplacement(doc, name, kind, family) {
  if (!isRevisedVersion(doc.name) || !sameFileGroup(doc.name, name) || differentItemNumbers(doc.name, name)) return false;
  if (!(doc.kind === kind || (COMPATIBLE.has(doc.kind) && COMPATIBLE.has(kind)))) return false;
  if (!strongFamilyMatch(doc.family, family) || !extraWordsAreNotIdentifying(family, doc.family)) return false;
  const incomingDate = dateInDocumentName(doc.name);
  const currentDate = dateInDocumentName(name);
  return !(incomingDate && currentDate && incomingDate < currentDate);
}

/**
 * Tipo del documento para estas reglas. Un documento que LLEGA puede ser la versión consolidada de otro ("Anexo N°. 4
 * Oferta Economica Consolidado Adenda 03.xlsx"): para él no cuentan las palabras "adenda"/"consolidado". Un documento
 * vigente que es una adenda nunca se archiva.
 */
export function tenderDocumentObsolescenceKind(name, { incoming = false } = {}) {
  let text = normalize(name);
  if (incoming) text = text.replace(/\bincluye\b|\bincorporadas?\b/g, ' ').replace(/\badendas?(?: (?:no|n|nro))?(?: \d+)?\b/g, ' ').replace(/\bconsolidad[oa]\b/g, ' ').replace(/\s+/g, ' ').trim();
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
const sameExtension = (a, b) => extensionOf(a) === extensionOf(b);
// Lo que puede sobrar en el nombre del vigente sin que sea otro documento: códigos cortos del proceso (FGN, REC, IPSE,
// LP…) y palabras de alcance o de borrador. «Presupuesto oficial» sí identifica otro documento (Cali, 2026-10-20: el
// «Formulario 1 … de Presupuesto Oficial (Oferta económica)» frente a «Formulario 1 Oferta económica Definitivo» queda
// como duda, decisión de Juan).
const NON_IDENTIFYING = new Set(['regional', 'seccional', 'proyecto', 'borrador', 'preliminar', 'inicial', 'version', 'v1', 'v2']);
/** ¿Todas las palabras (dos o más) de `inner` están en `outer`, y lo que sobra en `outer` no identifica otro documento? */
function familyContains(outer, inner) {
  const words = String(outer || '').split(' ').filter(Boolean);
  const needed = String(inner || '').split(' ').filter(Boolean);
  if (needed.length < 2 || !needed.every(word => words.includes(word))) return false;
  return words.filter(word => !needed.includes(word)).every(word => word.length <= 4 || NON_IDENTIFYING.has(word));
}

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
      // Un pliego sólo reemplaza a otro cuando dice que trae la adenda incorporada o que es la versión ajustada (con
      // fecha posterior); si no, queda como duda.
      // Para un pliego no basta «adenda» o «consolidado» (DANE: el consolidado frente al definitivo es duda): debe decir
      // «ajustado», «corregido» o «actualizado» y traer una fecha posterior a la del vigente.
      const revised = incoming.find(doc => doc.kind === 'pliego' && revisedReplacement(doc, name, kind, family)
        && /\b(ajustad[oa]s?|corregid[oa]s?|actualizad[oa]s?)\b/.test(normalize(doc.name))
        && dateInDocumentName(doc.name) && dateInDocumentName(name) && dateInDocumentName(doc.name) > dateInDocumentName(name));
      if (newer && isIncorporatedAdendaVersion(newer.name)) archive.push({ name, reason: 'pliego_con_adenda_incorporada', replacedBy: newer.name });
      else if (revised) archive.push({ name, reason: 'version_ajustada', replacedBy: revised.name });
      else if (newer) doubts.push({ name, candidate: newer.name, reason: 'pliego_definitivo_reemplazado' });
      continue;
    }
    const plain = normalize(name);
    if (family && family.split(' ').length >= 2 && !DEFINITIVE.test(plain) && !NO_DEFINITIVE_REPLACEMENT.test(plain)) {
      // F9 (auditoría Fiscalía, 2026-11-05): «Estudio Previo Eje Cafetero final» no reemplazaba a «ESTUDIO PREVIO REGIONAL
      // EJE CAFETERO», ni «ANEXOS Y FORMATOS DEFINITIVOS.zip» a «ANEXOS Y FORMATOS FGN-REC-IPSE-0058-2026.zip»: el
      // definitivo suele llamarse más corto. Cuenta como la misma familia si TODAS sus palabras (dos o más) están en el
      // nombre del vigente y es el mismo tipo de archivo; así un zip definitivo no saca de vigentes formatos sueltos.
      const definitive = incoming.find(doc => DEFINITIVE.test(normalize(doc.name)) && doc.family
        && (doc.family === family || (sameExtension(doc.name, name) && familyContains(family, doc.family))));
      if (definitive && (kind === 'protected' || kind === 'other' || definitive.family !== family)) {
        archive.push({ name, reason: 'version_definitiva', replacedBy: definitive.name });
        continue;
      }
    }
    if (kind !== 'technical_annex' && kind !== 'format') {
      const revised = kind !== 'protected' && incoming.find(doc => revisedReplacement(doc, name, kind, family));
      if (revised) archive.push({ name, reason: 'version_ajustada', replacedBy: revised.name });
      continue;
    }
    const same = incoming.find(doc => doc.kind === kind && doc.family === family && family);
    if (same) {
      archive.push({ name, reason: kind === 'technical_annex' ? 'anexo_tecnico_del_borrador' : 'formato_con_version_nueva', replacedBy: same.name });
      continue;
    }
    // Un formato editable se reemplaza por el formato nuevo de la misma familia aunque cambie el nombre («Formato Propuesta
    // Económica -FINAL 11.11.26s» → «Formato Propuesta Económica - columnas ampliadas (Nota 6)», DEAJ 23-nov).
    const revised = incoming.find(doc => revisedReplacement(doc, name, kind, family));
    if (revised) {
      archive.push({ name, reason: 'version_ajustada', replacedBy: revised.name });
      continue;
    }
    const renamed = kind === 'format' && incoming.find(doc => doc.kind === 'format' && sameFileGroup(doc.name, name)
      && !differentItemNumbers(doc.name, name) && sharedWords(doc.family, family) >= 3
      && strongFamilyMatch(doc.family, family) && extraWordsAreNotIdentifying(family, doc.family));
    if (renamed) {
      archive.push({ name, reason: 'formato_con_version_nueva', replacedBy: renamed.name });
      continue;
    }
    const similar = incoming.find(doc => (doc.kind === kind || doc.kind === 'technical_annex' || doc.kind === 'format') && overlaps(doc.family, family));
    if (similar) doubts.push({ name, candidate: similar.name, reason: 'posible_version_nueva' });
  }
  return { archive, doubts };
}

/**
 * El mismo portafolio de SECOP II puede traer el proyecto y el definitivo juntos (Cali, 2026-10-20: 28-sep y 15-oct en
 * un solo portafolio, sin aviso nuevo). Con documentos de más de un día de carga, los del último día son los que
 * "llegan" y los anteriores los vigentes; con un solo día no hay nada que decidir.
 * `documents`: `[{ name, loadedAt }]` (fecha de carga de datos.gov.co).
 */
export function planSamePortfolioObsoleteTenderDocuments(documents = []) {
  const dayOf = document => String(document?.loadedAt || '').slice(0, 10);
  const days = [...new Set(documents.map(dayOf).filter(Boolean))].sort();
  if (days.length < 2) return { archive: [], doubts: [], incomingNames: [] };
  const latest = days.at(-1);
  const incomingNames = [...new Set(documents.filter(document => dayOf(document) === latest).map(document => document.name))];
  const incomingKeys = new Set(incomingNames.map(normalize));
  const currentNames = [...new Set(documents.filter(document => dayOf(document) !== latest).map(document => document.name))]
    .filter(name => !incomingKeys.has(normalize(name)));
  return { ...planObsoleteTenderDocuments({ currentNames, incomingNames }), incomingNames };
}
