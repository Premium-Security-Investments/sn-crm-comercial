import { createHash } from 'node:crypto';
import { canonicalizeTenderDocuments } from './tender-document-canonicalizer.js';

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES = 10 * 1024 * 1024;

function isHtmlInterstitial(buffer) {
  const prefix = buffer.subarray(0, 4096).toString('utf8').trimStart().toLowerCase();
  return prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.includes('<html ');
}

function pathSegment(value, fallback = 'document') {
  const normalized = String(value ?? '').trim()
    .replace(/\.{2,}/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

export function normalizeTenderSourceDocumentId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error('El documento oficial no tiene identidad de origen.');
  return normalized;
}

export function tenderDocumentContentHash(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha256').update(buffer).digest('hex');
}

// --- Identidad canónica de contenido ----------------------------------------
// El hash de los BYTES identifica el archivo; en un paquete comprimido no
// identifica el CONTENIDO. Los bytes de un ZIP incluyen el envoltorio —marca de
// tiempo por entrada, orden de escritura, nivel de compresión, comentario del
// paquete—, que la entidad regenera cada vez que reempaqueta sus formatos aunque
// no toque un solo documento interno. Versionar por esos bytes convertía cada
// reempaquetado en una versión nueva, una subida nueva y un snapshot nuevo de un
// expediente que no había cambiado.
//
// La identidad canónica se deriva de la procedencia por entrada que el extractor
// ya calcula (tender-document-text-extraction.js): nombre de entrada, veredicto y
// hash del texto realmente extraído. Es estable frente al envoltorio y sensible al
// contenido — y también a la COBERTURA, porque una entrada que pasa de legible a
// ilegible cambia la identidad, que es justo lo que impide que un paquete con
// huecos reutilice la identidad del paquete íntegro.
//
// Cierre seguro: sin procedencia por entrada (documento no comprimido, extractor
// legado que devuelve un string, o ZIP ilegible a nivel de paquete) no hay
// contenido del que derivar nada y se conserva la identidad por bytes de siempre.
// Eso mantiene intactos los datos históricos: una fila antigua identificada por
// bytes se sigue reconociendo mientras la fuente devuelva esos mismos bytes.
const TENDER_ARCHIVE_EXTRACTION_PARSER = 'zip-archive';
const TENDER_ARCHIVE_CONTENT_IDENTITY_VERSION = 'tender-archive-content-identity@1';

function archiveEntryProvenance(extraction) {
  if (!extraction || typeof extraction !== 'object') return null;
  if (extraction.parser !== TENDER_ARCHIVE_EXTRACTION_PARSER) return null;
  const entries = extraction.metadata?.entries;
  return Array.isArray(entries) && entries.length ? entries : null;
}

export function tenderDocumentCanonicalContentHash(byteHash, extraction) {
  const entries = archiveEntryProvenance(extraction);
  if (!entries) return byteHash;
  const canonical = entries
    .map(entry => ({
      entry_name: String(entry?.entry_name ?? ''),
      status: String(entry?.status ?? ''),
      gap_reason: entry?.gap_reason == null ? null : String(entry.gap_reason),
      text_hash: String(entry?.text_hash ?? ''),
    }))
    // Orden propio, independiente del que traiga el paquete o el lector.
    .sort((left, right) => (left.entry_name < right.entry_name ? -1 : left.entry_name > right.entry_name ? 1 : 0));
  return createHash('sha256')
    .update(JSON.stringify({ v: TENDER_ARCHIVE_CONTENT_IDENTITY_VERSION, entries: canonical }))
    .digest('hex');
}

export function tenderDocumentVersionPath({ opportunityId, sourceDocumentId, contentHash, name }) {
  return `tender-documents/${pathSegment(opportunityId, 'opportunity')}/${pathSegment(normalizeTenderSourceDocumentId(sourceDocumentId))}/${contentHash}-${pathSegment(name)}`;
}

export async function refreshOfficialTenderDocument({
  opportunityId,
  source,
  document,
  currentVersion,
  download,
  cleanName = value => String(value || ''),
  extractText,
  ensureStorage,
  upload,
  recordVersion,
  recordExtraction,
}) {
  const sourceDocumentId = normalizeTenderSourceDocumentId(document.source_document_id);
  const buffer = await download(document);
  if (!buffer?.length) throw new Error(`Archivo vacío: ${document.name}`);
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    const error = new Error(`Archivo supera 50MB: ${document.name}`);
    error.code = 'TENDER_DOC_SIZE_EXCEEDED';
    throw error;
  }
  const name = cleanName(document.name);
  if (isHtmlInterstitial(buffer)) {
    const error = new Error(`La fuente oficial devolvió HTML en lugar del documento: ${name}`);
    error.code = 'TENDER_DOC_SOURCE_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  const unchanged = () => ({ status: 'unchanged', source_document_id: sourceDocumentId });
  const byteHash = tenderDocumentContentHash(buffer);
  // Bytes idénticos ⇒ contenido idéntico: no hace falta reextraer para saberlo.
  // Este atajo es también el que reconoce una versión histórica identificada por
  // bytes, y el que evita reextraer todo documento no comprimido.
  if (currentVersion?.content_hash === byteHash && !currentVersion?.needs_extraction) return unchanged();
  const extractionResult = await extractText(buffer, name, document.mime_type || '');
  const typedExtraction = extractionResult && typeof extractionResult === 'object' ? extractionResult : null;
  const isGap = typedExtraction?.status === 'gap';
  const extractedText = typeof extractionResult === 'string'
    ? extractionResult
    : typedExtraction?.status === 'ok'
      ? typedExtraction.text
      : null;
  if (!isGap && !String(extractedText || '').trim()) {
    const error = new Error(`No fue posible extraer texto verificable: ${name}`);
    error.code = 'TENDER_DOC_EMPTY_TEXT';
    throw error;
  }
  if (isGap && !recordExtraction) {
    const error = new Error(`La extracción gap requiere persistencia tipada: ${name}`);
    error.code = 'TENDER_DOC_GAP_PERSISTENCE_REQUIRED';
    throw error;
  }
  if (extractedText !== null && Buffer.byteLength(extractedText, 'utf8') > MAX_EXTRACTED_TEXT_BYTES) throw new Error(`El texto extraído supera 10MB: ${name}`);
  // Identidad del contenido, no del envoltorio. Un paquete reempaquetado sin
  // cambios internos vuelve aquí con la misma identidad: no se versiona, no se
  // vuelve a subir y la ruta de almacenamiento tampoco se duplica.
  const contentHash = tenderDocumentCanonicalContentHash(byteHash, typedExtraction);
  if (currentVersion?.content_hash === contentHash && !currentVersion?.needs_extraction) return unchanged();
  const storagePath = tenderDocumentVersionPath({ opportunityId, sourceDocumentId, contentHash, name });
  await ensureStorage();
  await upload(storagePath, buffer, document.mime_type || 'application/octet-stream');
  const recorded = await recordVersion({
    ...document,
    source,
    source_document_id: sourceDocumentId,
    name,
    content_hash: contentHash,
    storage_path: storagePath,
    size_bytes: buffer.length,
    extracted_text: extractedText,
  });
  if (recordExtraction && typedExtraction) {
    await recordExtraction({ extraction: typedExtraction, version: recorded });
  }
  const status = recorded?.status === 'unchanged' ? 'unchanged' : (currentVersion ? 'updated' : 'new');
  return { status, source_document_id: sourceDocumentId, version: recorded, extraction_status: typedExtraction?.status || 'legacy' };
}

export async function refreshTenderDocumentBatch(documents, refreshOne) {
  const results = [];
  for (const document of documents || []) {
    try {
      results.push(await refreshOne(document));
    } catch (error) {
      results.push({
        status: 'failed',
        source_document_id: String(document?.source_document_id || '').trim(),
        error: `${document?.errorPrefix || 'Documento'}: ${error?.message || error}`,
      });
    }
  }
  return results;
}

export async function runOptionalTenderAnalysis({ analyze, loadCurrentDocuments, generate }) {
  if (analyze !== true) return false;
  const documents = await loadCurrentDocuments();
  if (!documents.length) return false;
  await generate(documents);
  return true;
}

export function mergeTenderDocumentRecords(typedDocuments = [], legacyDocuments = []) {
  const typedSourceIds = new Set(typedDocuments.map(document => String(document.source_document_id || '').trim()).filter(Boolean));
  const merged = [...typedDocuments, ...legacyDocuments.filter(document => {
    const sourceDocumentId = String(document.source_document_id || '').trim();
    return !sourceDocumentId || !typedSourceIds.has(sourceDocumentId);
  })];
  return canonicalizeTenderDocuments(merged);
}

// Deterministic, immutable-field-only fallback identifier for official documents that
// have no stable id from their source (e.g. SECOP's id_documento, or ESU's
// /procesos/descargar/<id> URL segment). Prefers the document's filename -- stable
// across refreshes -- over its download URL, which may carry a rotating/expiring
// token; hashing the URL alone would mint a new id (and a new "current" duplicate)
// every time that token rotated even though the file itself never changed. Never
// falls back to a clock or randomness: with no stable field available, callers must
// treat the document as unidentifiable rather than mint a non-deterministic id.
export function deterministicDocumentFallbackId({ name, url } = {}) {
  const seed = String(name ?? '').trim() || String(url ?? '').trim();
  if (!seed) throw new Error('El documento no tiene identidad estable (sin nombre ni URL) para derivar un identificador.');
  return createHash('sha256').update(seed).digest('hex');
}

export function summarizeTenderDocumentRefresh(results = []) {
  const count = status => results.filter(result => result?.status === status).length;
  return {
    new_count: count('new'),
    updated_count: count('updated'),
    unchanged_count: count('unchanged'),
    failed_count: count('failed'),
  };
}
