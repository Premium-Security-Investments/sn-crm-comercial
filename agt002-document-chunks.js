import { createHash } from 'node:crypto';

export const AGT002_CHUNK_MAX_CHARS = 1800;
export const AGT002_CHUNK_OVERLAP_CHARS = 200;
const ILLEGIBLE_LETTER_RATIO = 0.15;
const ADDENDUM_DOCUMENT_TYPE = 'adenda';

const DOCUMENT_KEYS = [
  'document_id', 'document_version_id', 'opportunity_id', 'snapshot_id',
  'document_type', 'name', 'version', 'content_hash', 'current', 'extracted_text',
];

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} debe ser texto no vacío.`);
  return value.trim();
}

function validateDocument(raw, index) {
  const label = `documents[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} debe ser un objeto.`);
  const unknown = Object.keys(raw).filter(key => !DOCUMENT_KEYS.includes(key));
  if (unknown.length) throw new Error(`${label} contiene una clave no permitida o desconocida: ${unknown.sort().join(', ')}.`);

  const documentId = requireNonEmptyString(raw.document_id, `${label}.document_id`);
  const documentVersionId = requireNonEmptyString(raw.document_version_id, `${label}.document_version_id`);
  const opportunityId = requireNonEmptyString(raw.opportunity_id, `${label}.opportunity_id`);
  const documentType = requireNonEmptyString(raw.document_type, `${label}.document_type`);
  const name = requireNonEmptyString(raw.name, `${label}.name`);

  if (raw.snapshot_id != null && (typeof raw.snapshot_id !== 'string' || !raw.snapshot_id.trim())) {
    throw new Error(`${label}.snapshot_id debe ser texto no vacío o null.`);
  }
  if (!Number.isInteger(raw.version) || raw.version <= 0) {
    throw new Error(`${label}.version debe ser un entero mayor que cero.`);
  }
  if (typeof raw.content_hash !== 'string' || !/^[0-9a-f]{64}$/.test(raw.content_hash)) {
    throw new Error(`${label}.content_hash debe ser SHA-256 hexadecimal en minúscula.`);
  }
  if (typeof raw.current !== 'boolean') {
    throw new Error(`${label}.current debe ser booleano.`);
  }
  if (typeof raw.extracted_text !== 'string') {
    throw new Error(`${label}.extracted_text debe ser texto.`);
  }

  return {
    documentId, documentVersionId, opportunityId,
    snapshotId: raw.snapshot_id ?? null,
    documentType, name,
    version: raw.version,
    contentHash: raw.content_hash,
    current: raw.current,
    extractedText: raw.extracted_text,
  };
}

function classifyIllegibility(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return 'empty_document';
  const nonWhitespace = trimmed.replace(/\s+/g, '');
  if (!nonWhitespace.length) return 'empty_document';
  const letters = nonWhitespace.match(/[\p{L}\p{N}]/gu) || [];
  if (letters.length / nonWhitespace.length < ILLEGIBLE_LETTER_RATIO) return 'illegible_document';
  return null;
}

function normalizeSectionText(text) {
  return text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function windowSection(text, max, overlap) {
  if (text.length <= max) return [text];
  const windows = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + max, text.length);
    windows.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return windows;
}

function chunkHash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function buildChunksForDocument(doc) {
  const pages = doc.extractedText.split('\f');
  const chunks = [];
  pages.forEach((pageText, pageIndex) => {
    const page = pageIndex + 1;
    const sections = pageText.split(/\n\s*\n+/).map(normalizeSectionText).filter(Boolean);
    sections.forEach((sectionText, sectionIndex) => {
      const section = sectionIndex + 1;
      const windows = windowSection(sectionText, AGT002_CHUNK_MAX_CHARS, AGT002_CHUNK_OVERLAP_CHARS);
      windows.forEach((text, chunkIndex) => {
        const chunkId = `chunk:${doc.documentVersionId}:p${page}:s${section}:c${chunkIndex}`;
        chunks.push({
          chunk_id: chunkId,
          evidence_ref: `evidence:${chunkId}`,
          document_id: doc.documentId,
          document_version_id: doc.documentVersionId,
          opportunity_id: doc.opportunityId,
          snapshot_id: doc.snapshotId,
          document_type: doc.documentType,
          name: doc.name,
          version: doc.version,
          content_hash: doc.contentHash,
          current: doc.current,
          page,
          section,
          chunk_index: chunkIndex,
          text,
          char_count: text.length,
          chunk_hash: chunkHash(text),
        });
      });
    });
  });
  return chunks;
}

function applyPrecedence(items, hasAddendum) {
  return items.map(item => (item.document_type === ADDENDUM_DOCUMENT_TYPE
    ? { ...item, precedence: 'addendum', superseded_by_addendum: false }
    : { ...item, precedence: 'base', superseded_by_addendum: hasAddendum }));
}

export function buildAgt002DocumentChunks(documents) {
  if (!Array.isArray(documents)) throw new Error('documents debe ser una lista.');

  const seenVersions = new Map();
  const uniqueDocs = [];
  documents.forEach((raw, index) => {
    const doc = validateDocument(raw, index);
    const seen = seenVersions.get(doc.documentVersionId);
    if (seen) {
      if (seen.contentHash !== doc.contentHash) {
        throw new Error(`Violación de integridad: document_version_id ${doc.documentVersionId} tiene content_hash distinto entre entradas.`);
      }
      return;
    }
    seenVersions.set(doc.documentVersionId, doc);
    uniqueDocs.push(doc);
  });

  const hasAddendum = uniqueDocs.some(doc => doc.documentType === ADDENDUM_DOCUMENT_TYPE);

  const chunks = [];
  const gaps = [];
  for (const doc of uniqueDocs) {
    const reason = classifyIllegibility(doc.extractedText);
    if (reason) {
      gaps.push({
        gap_id: `gap:${doc.documentVersionId}`,
        document_id: doc.documentId,
        document_version_id: doc.documentVersionId,
        opportunity_id: doc.opportunityId,
        snapshot_id: doc.snapshotId,
        document_type: doc.documentType,
        name: doc.name,
        version: doc.version,
        content_hash: doc.contentHash,
        current: doc.current,
        reason,
      });
      continue;
    }
    const docChunks = buildChunksForDocument(doc);
    if (!docChunks.length) {
      gaps.push({
        gap_id: `gap:${doc.documentVersionId}`,
        document_id: doc.documentId,
        document_version_id: doc.documentVersionId,
        opportunity_id: doc.opportunityId,
        snapshot_id: doc.snapshotId,
        document_type: doc.documentType,
        name: doc.name,
        version: doc.version,
        content_hash: doc.contentHash,
        current: doc.current,
        reason: 'empty_document',
      });
      continue;
    }
    chunks.push(...docChunks);
  }

  const sortKey = item => `${item.document_id}:${String(item.page ?? 0).padStart(8, '0')}:${String(item.section ?? 0).padStart(8, '0')}:${String(item.chunk_index ?? 0).padStart(8, '0')}`;

  return {
    chunks: applyPrecedence(chunks, hasAddendum).sort((left, right) => sortKey(left).localeCompare(sortKey(right))),
    gaps: applyPrecedence(gaps, hasAddendum).sort((left, right) => left.document_id.localeCompare(right.document_id)),
  };
}
