import { createHash } from 'node:crypto';

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES = 10 * 1024 * 1024;

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
}) {
  const sourceDocumentId = normalizeTenderSourceDocumentId(document.source_document_id);
  const buffer = await download(document);
  if (!buffer?.length) throw new Error(`Archivo vacío: ${document.name}`);
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    const error = new Error(`Archivo supera 50MB: ${document.name}`);
    error.code = 'TENDER_DOC_SIZE_EXCEEDED';
    throw error;
  }
  const contentHash = tenderDocumentContentHash(buffer);
  if (currentVersion?.content_hash === contentHash) {
    return { status: 'unchanged', source_document_id: sourceDocumentId };
  }
  const name = cleanName(document.name);
  const extractedText = await extractText(buffer, name, document.mime_type || '');
  if (!String(extractedText || '').trim()) {
    const error = new Error(`No fue posible extraer texto verificable: ${name}`);
    error.code = 'TENDER_DOC_EMPTY_TEXT';
    throw error;
  }
  if (Buffer.byteLength(extractedText, 'utf8') > MAX_EXTRACTED_TEXT_BYTES) throw new Error(`El texto extraído supera 10MB: ${name}`);
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
  const status = recorded?.status === 'unchanged' ? 'unchanged' : (currentVersion ? 'updated' : 'new');
  return { status, source_document_id: sourceDocumentId, version: recorded };
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
  return [...typedDocuments, ...legacyDocuments.filter(document => {
    const sourceDocumentId = String(document.source_document_id || '').trim();
    return !sourceDocumentId || !typedSourceIds.has(sourceDocumentId);
  })];
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
