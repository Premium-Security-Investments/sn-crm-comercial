import { createHash } from 'node:crypto';

// Pure, server-only persistence/selection logic for migration 065
// (psi_tender_document_extractions). No DB/network access here: server/index.js and
// api/[...path].js own the actual RPC calls/queries and pass their results through
// these functions. Kept separate from tender-document-text-extraction.js (the parser)
// so the "what do we store, pick and expose" policy is independently testable and
// independently provable never to reach the browser (see the import-boundary test).

function nonEmptyString(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

/**
 * Normalizes a typed extraction result (tender-document-text-extraction.js's
 * extractTenderDocumentText output) into the exact params for the
 * psi_record_tender_document_extraction RPC (migration 065). Never persists a
 * fabricated success: an 'ok' extraction must carry real non-blank text with a
 * valid SHA-256 hash; a 'gap' extraction always carries null text/hash, zeroed
 * counts and a non-blank gap_reason.
 */
export function buildTenderDocumentExtractionRpcParams(extraction, { opportunityId, tenderId, documentVersionId, actorId }) {
  if (!extraction || typeof extraction !== 'object') throw new Error('El resultado de extracción es obligatorio.');
  if (!nonEmptyString(opportunityId) || !nonEmptyString(tenderId) || !nonEmptyString(documentVersionId) || !nonEmptyString(actorId)) {
    throw new Error('La oportunidad, licitación, versión documental y actor son obligatorios.');
  }
  if (extraction.status !== 'ok' && extraction.status !== 'gap') {
    throw new Error('El estado de la extracción debe ser ok o gap.');
  }
  const extractorVersion = nonEmptyString(extraction.extractor_version);
  const parser = nonEmptyString(extraction.parser);
  if (!extractorVersion || !parser) throw new Error('La versión del extractor y el parser son obligatorios.');
  const metadata = extraction.metadata && typeof extraction.metadata === 'object' && !Array.isArray(extraction.metadata)
    ? extraction.metadata
    : {};

  if (extraction.status === 'ok') {
    const text = typeof extraction.text === 'string' ? extraction.text : '';
    if (!text.trim()) throw new Error('Una extracción ok requiere texto no vacío.');
    const textHash = String(extraction.text_hash || '');
    if (!/^[0-9a-f]{64}$/.test(textHash)) throw new Error('El hash de texto debe ser SHA-256 hexadecimal en minúscula.');
    const computedTextHash = createHash('sha256').update(text, 'utf8').digest('hex');
    if (textHash !== computedTextHash) throw new Error('El hash de texto no coincide con el texto extraído.');
    return {
      p_opportunity_id: opportunityId, p_tender_id: tenderId, p_document_version_id: documentVersionId,
      p_extractor_version: extractorVersion, p_status: 'ok', p_parser: parser,
      p_extracted_text: text, p_text_hash: textHash,
      p_char_count: text.length, p_text_byte_count: Buffer.byteLength(text, 'utf8'),
      p_metadata: metadata, p_gap_reason: null, p_actor_id: actorId,
    };
  }

  const gapReason = nonEmptyString(extraction.metadata?.gap_reason);
  if (!gapReason) throw new Error('Una extracción gap requiere gap_reason.');
  return {
    p_opportunity_id: opportunityId, p_tender_id: tenderId, p_document_version_id: documentVersionId,
    p_extractor_version: extractorVersion, p_status: 'gap', p_parser: parser,
    p_extracted_text: null, p_text_hash: null, p_char_count: 0, p_text_byte_count: 0,
    p_metadata: metadata, p_gap_reason: gapReason, p_actor_id: actorId,
  };
}

function isWellFormedExtractionRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.status === 'ok') {
    return typeof row.extracted_text === 'string' && row.extracted_text.trim().length > 0
      && typeof row.text_hash === 'string' && /^[0-9a-f]{64}$/.test(row.text_hash)
      && row.text_hash === createHash('sha256').update(row.extracted_text, 'utf8').digest('hex')
      && Number.isInteger(row.char_count) && row.char_count > 0
      && row.char_count === row.extracted_text.length;
  }
  if (row.status === 'gap') return true;
  return false;
}

function extractionRank(row) {
  return row.status === 'ok' ? 1 : 0;
}

// Generación del extractor que produjo la fila, leída del sufijo `@<n>` de
// extractor_version (p. ej. 'tender-document-text-extraction@3').
//
// Esa versión se sube precisamente cuando cambia el texto/metadatos que el
// extractor produce para una MISMA entrada, así que es la única señal que dice
// qué filas quedaron obsoletas. Una versión ausente, deforme o legada vale 0: no
// puede ganarle a ninguna fila bien formada, pero tampoco rompe la comparación.
function extractorGeneration(row) {
  const match = /@(\d+)$/.exec(typeof row?.extractor_version === 'string' ? row.extractor_version : '');
  if (!match) return 0;
  const generation = Number(match[1]);
  return Number.isSafeInteger(generation) && generation > 0 ? generation : 0;
}

function isBetterExtractionRow(candidate, incumbent) {
  // La generación del extractor manda por encima del veredicto: un 'gap' del
  // extractor vigente describe el documento mejor que un 'ok' de un extractor
  // que ya sabemos que fabricaba texto para ese mismo input.
  const candidateGeneration = extractorGeneration(candidate);
  const incumbentGeneration = extractorGeneration(incumbent);
  if (candidateGeneration !== incumbentGeneration) return candidateGeneration > incumbentGeneration;
  const candidateRank = extractionRank(candidate);
  const incumbentRank = extractionRank(incumbent);
  if (candidateRank !== incumbentRank) return candidateRank > incumbentRank;
  const candidateTime = Date.parse(candidate.created_at || '') || 0;
  const incumbentTime = Date.parse(incumbent.created_at || '') || 0;
  if (candidateTime !== incumbentTime) return candidateTime > incumbentTime;
  return String(candidate.id ?? '') > String(incumbent.id ?? '');
}

/**
 * Deterministically chooses, per document_version_id, the extraction row that should
 * be treated as canonical for a document version.
 *
 * Precedence: newest extractor generation first, then 'ok' over 'gap', then created_at,
 * then a stable id tiebreak. Ordering by status before generation is what let a stale,
 * superficial extraction outlive its own replacement: the ZIP that an older extractor
 * resolved as 'ok' with placeholder text kept winning over the current extractor's row
 * that had already found the package's unreadable entries, so reprocessing wrote the
 * right answer and nobody ever read it. Within one generation the original semantics
 * are preserved exactly — an 'ok' still beats a later 'gap', which is the right call for
 * a retry after a transient failure.
 *
 * Malformed rows (claiming 'ok' without a trustworthy text/hash/char_count) are skipped
 * entirely — fail closed rather than trusting possibly-corrupt data — however new the
 * extractor that wrote them.
 */
export function selectCanonicalExtractionsByDocumentVersion(rows) {
  const byVersion = new Map();
  for (const row of rows || []) {
    if (!isWellFormedExtractionRow(row)) continue;
    const versionId = row.document_version_id;
    if (!versionId) continue;
    const incumbent = byVersion.get(versionId);
    if (!incumbent || isBetterExtractionRow(row, incumbent)) byVersion.set(versionId, row);
  }
  return byVersion;
}

/**
 * Merges the canonical extraction (if any) into a document record: an 'ok' extraction
 * replaces extracted_text outright (even when much larger than the legacy column); a
 * 'gap' extraction never fabricates text (fallback text is discarded, not merged in);
 * legacy fallback text is used only when no extraction row exists at all for this
 * document version.
 */
export function mergeCanonicalExtractionIntoDocument(document, extractionRow, legacyExtractedText) {
  const base = { ...document };
  if (!extractionRow) {
    return { ...base, extracted_text: legacyExtractedText ?? '', extraction_status: 'legacy' };
  }
  if (extractionRow.status === 'ok') {
    return {
      ...base,
      extracted_text: extractionRow.extracted_text,
      extraction_status: 'ok',
      extraction_version: extractionRow.extractor_version,
      extraction_parser: extractionRow.parser,
      extraction_char_count: extractionRow.char_count,
      extraction_text_hash: extractionRow.text_hash,
    };
  }
  return {
    ...base,
    extracted_text: '',
    extraction_status: 'gap',
    extraction_version: extractionRow.extractor_version,
    extraction_parser: extractionRow.parser,
    extraction_char_count: 0,
    extraction_text_hash: null,
    extraction_gap_reason: extractionRow.gap_reason ?? null,
  };
}

// Motivo cerrado de último recurso: una extracción persistida como 'gap' sin gap_reason
// legible sigue siendo un hueco, nunca un documento utilizable. Nunca se compone con
// datos del proceso.
const UNSPECIFIED_EXTRACTION_GAP_REASON = 'unspecified_extraction_gap';

/**
 * Deriva los huecos documentales tipados de documentos ya fusionados con su extracción
 * canónica (mergeCanonicalExtractionIntoDocument).
 *
 * Un documento vigente cuya extracción canónica quedó en 'gap' —el caso real: un ZIP
 * oficial con entradas ilegibles— está descargado, versionado y con su import item en
 * 'imported', pero no aporta texto analizable. Es un hueco del expediente y tiene que
 * viajar dentro del snapshot inmutable, no solo en un evento.
 *
 * Devuelve la forma cerrada que canoniza tender-document-gap-canonical.js: identidad,
 * tipo, nombre y motivo. Nunca el texto, la ruta de almacenamiento ni la URL firmada del
 * documento.
 */
export function deriveTenderDocumentExtractionGaps(documents) {
  return (documents || [])
    // Solo el expediente vigente: una versión superada ya no es un hueco de hoy.
    .filter(document => document?.current !== false && document?.extraction_status === 'gap')
    .map(document => ({
      // La identidad de origen es con la que se enumera en todas partes; el id de la
      // versión documental solo entra si la fila no tiene identidad de origen.
      document_id: nonEmptyString(document.source_document_id) || nonEmptyString(document.id),
      document_type: nonEmptyString(document.document_type),
      name: nonEmptyString(document.name),
      reason: nonEmptyString(document.extraction_gap_reason) || UNSPECIFIED_EXTRACTION_GAP_REASON,
    }));
}

// --- Proyección pública del expediente --------------------------------------
//
// Última barrera antes de que un registro documental llegue al navegador. Es una
// lista BLANCA a propósito: un registro documental llega aquí mezclado —fila
// tipada de psi_tender_document_versions más carga histórica libre de
// psi_sales_interactions.notes—, así que enumerar lo prohibido siempre dejaría
// pasar la próxima clave interna que alguien añadiera aguas arriba.
//
// Queda fuera, en particular:
//   * `storage_path`: ruta privada dentro del bucket. La interfaz no la usa.
//   * `source_url`: en SECOP es la URL de descarga del documento, y viaja con
//     token firmado. Publicarla sería un enlace directo que salta el control de
//     acceso del backend.
//   * `extracted_text` / `metadata` / `error`: contenido íntegro y crudo.
//   * `signed_url`: una URL firmada es una CAPACIDAD de descarga —quien la tiene
//     descarga el archivo sin volver a pasar por getAuthContext—, no un campo del
//     expediente. Listar N documentos acuñaba N capacidades de larga vigencia y
//     las dejaba en la caché del navegador, en el historial y en cualquier copia
//     del JSON. La descarga vive ahora en un endpoint autenticado propio.
//
// Lo único que sale hacia el navegador para descargar es `download_url`: una ruta
// SAME-ORIGIN calculada por el servidor (ver tenderDocumentDownloadUrl) que no
// concede nada por sí misma; la capacidad se emite dentro de esa petición, ya
// autenticada y autorizada, y solo para el documento pedido.
const PUBLIC_TENDER_DOCUMENT_FIELDS = Object.freeze([
  'id', 'name', 'size', 'size_bytes', 'mime_type', 'document_type', 'current',
  'uploaded_at', 'uploaded_by', 'interaction_id', 'auto_import',
  'opportunity_id', 'source', 'source_document_id', 'version', 'content_hash',
  'extraction_status', 'extraction_version', 'extraction_parser',
  'extraction_char_count', 'extraction_text_hash', 'extraction_gap_reason',
]);

const normalizeDocumentKey = key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

// Claves internas que tampoco pueden viajar ANIDADAS dentro de un valor público.
// Un documento histórico se serializó con la forma que tuviera el backend de
// entonces, así que la ruta o la URL con token pueden estar enterradas a
// cualquier profundidad bajo una clave que hoy sí es pública.
const INTERNAL_NESTED_DOCUMENT_KEYS = new Set([
  'storage_path', 'bucket', 'bucket_id', 'path', 'file_path', 'local_path',
  'object_key', 'key', 'url', 'source_url', 'download_url', 'raw_url', 'signed_url',
  'extracted_text', 'text', 'metadata', 'error', 'token', 'secret',
].map(normalizeDocumentKey));

// Claves que nunca se copian a un objeto nuevo: asignarlas alteraría el prototipo
// del resultado en vez de añadir un campo.
const UNSAFE_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Cota dura de profundidad: acota el trabajo por documento y hace que cualquier
// estructura cíclica termine, en lugar de colgar la respuesta.
const MAX_PROJECTION_DEPTH = 6;

function scrubInternalDocumentFields(value, depth = 0) {
  if (Array.isArray(value)) {
    return depth >= MAX_PROJECTION_DEPTH ? [] : value.map(item => scrubInternalDocumentFields(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;
  if (depth >= MAX_PROJECTION_DEPTH) return {};
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (UNSAFE_PROTOTYPE_KEYS.has(key)) continue;
    if (INTERNAL_NESTED_DOCUMENT_KEYS.has(normalizeDocumentKey(key))) continue;
    output[key] = scrubInternalDocumentFields(nested, depth + 1);
  }
  return output;
}

// Identificadores admisibles en una ruta de descarga. Cubre las dos identidades
// vigentes del expediente —el uuid de psi_tender_document_versions y el hash
// hexadecimal de las cargas históricas— y nada más: un id que no encaje aquí no
// produce ruta en vez de producir una ruta rara.
const TENDER_DOCUMENT_PATH_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function normalizedPathId(value) {
  const normalized = String(value ?? '').trim();
  return TENDER_DOCUMENT_PATH_ID_PATTERN.test(normalized) ? normalized : '';
}

/**
 * Ruta SAME-ORIGIN de descarga del documento, calculada SIEMPRE por el servidor a
 * partir de los identificadores del documento y de la oportunidad ya validados y
 * normalizados. Nunca se copia de un payload histórico, nunca lleva token y no
 * concede acceso por sí misma: el endpoint que la sirve vuelve a autenticar y a
 * autorizar la oportunidad. Sin identidad utilizable devuelve `null` en lugar de
 * inventar una ruta.
 */
export function tenderDocumentDownloadUrl({ opportunityId, documentId } = {}) {
  const opportunity = normalizedPathId(opportunityId);
  const document = normalizedPathId(documentId);
  if (!opportunity || !document) return null;
  return `/api/tender-documents/${encodeURIComponent(document)}/download?opportunity_id=${encodeURIComponent(opportunity)}`;
}

/**
 * Proyección segura de un registro documental hacia el navegador: conserva solo
 * los campos públicos que la interfaz consume y el resumen tipado y acotado de la
 * extracción (estado, versión del extractor, parser, conteo, hash, motivo del
 * hueco). Nunca el texto íntegro, los metadatos crudos, el error del parser, la
 * ruta de almacenamiento, una URL de origen con token ni una URL firmada.
 *
 * `opportunityId` lo aporta el llamador desde la oportunidad ya autorizada, no el
 * registro: es lo que hace que `download_url` sea siempre server-owned.
 */
export function publicTenderDocumentProjection(document = {}, { opportunityId } = {}) {
  const source = document && typeof document === 'object' && !Array.isArray(document) ? document : {};
  const projected = {};
  for (const field of PUBLIC_TENDER_DOCUMENT_FIELDS) {
    if (!Object.hasOwn(source, field)) continue;
    const value = source[field];
    if (value === undefined) continue;
    projected[field] = scrubInternalDocumentFields(value);
  }
  if (!projected.extraction_status) projected.extraction_status = 'legacy';
  // Se calcula al final y se asigna sobre el objeto ya proyectado: `download_url`
  // no está en la lista blanca y además se depura anidada, así que ningún valor
  // heredado del registro puede sobrevivir hasta aquí ni sobrescribir este.
  projected.download_url = tenderDocumentDownloadUrl({ opportunityId, documentId: source.id });
  return projected;
}
