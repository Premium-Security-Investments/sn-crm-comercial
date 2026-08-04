// Reusable dedup barrier for tender document records. Applied at the typed/legacy
// merge point and again anywhere documents are about to reach the UI, a snapshot, or
// analysis (chunking/retrieval), so duplicate "current" rows never surface twice.
//
// Identity precedence:
//   1. Equal content_hash is authoritative regardless of source id or filename.
//   2. If at least one side lacks a hash, normalized name + size is a strong fallback.
//   3. Two different valid hashes are authoritative evidence of different content,
//      even when filename and size happen to match.
//   4. Documents without either identity signal are preserved.
//
// Among duplicates, prefer typed over legacy, current over non-current, then newest
// version/created_at. A stable lexical key breaks complete ties independently of input
// or database row order.

function normalizedDocumentName(name) {
  return String(name ?? '').trim().toLowerCase().normalize('NFKC').replace(/\s+/g, ' ');
}

function documentSizeBytes(document) {
  const size = document?.size_bytes ?? document?.size;
  const numeric = Number(size);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function documentContentHash(document) {
  const hash = String(document?.content_hash ?? '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : '';
}

function documentFallbackKey(document) {
  const name = normalizedDocumentName(document?.name);
  const size = documentSizeBytes(document);
  return name && size != null ? `${name}\u0000${size}` : '';
}

function isTypedDocument(document) {
  return Number.isInteger(document?.version);
}

function documentRank(document) {
  return [
    isTypedDocument(document) ? 1 : 0,
    document?.current !== false ? 1 : 0,
    Number.isFinite(Number(document?.version)) ? Number(document.version) : 0,
    Date.parse(document?.created_at ?? document?.uploaded_at ?? '') || 0,
  ];
}

function stableDocumentKey(document) {
  return [
    document?.id,
    document?.source_document_id,
    document?.storage_path,
    normalizedDocumentName(document?.name),
    documentContentHash(document),
  ].map(value => String(value ?? '')).join('\u0000');
}

function isBetterDocument(candidate, incumbent) {
  const a = documentRank(candidate);
  const b = documentRank(incumbent);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return stableDocumentKey(candidate).localeCompare(stableDocumentKey(incumbent)) < 0;
}

function duplicateIndex(kept, candidate) {
  const candidateHash = documentContentHash(candidate);
  if (candidateHash) {
    const exactHashIndex = kept.findIndex(document => documentContentHash(document) === candidateHash);
    if (exactHashIndex >= 0) return exactHashIndex;
  }

  const fallbackKey = documentFallbackKey(candidate);
  if (!fallbackKey) return -1;
  const fallbackMatches = kept
    .map((document, index) => ({ document, index }))
    .filter(({ document }) => documentFallbackKey(document) === fallbackKey)
    .filter(({ document }) => {
      const existingHash = documentContentHash(document);
      return !candidateHash || !existingHash;
    });

  // A hashless record cannot be safely assigned when multiple same-name/size records
  // with different verified hashes already exist. Preserve it rather than guessing.
  return fallbackMatches.length === 1 ? fallbackMatches[0].index : -1;
}

export function canonicalizeTenderDocuments(documents = []) {
  const kept = [];
  for (const document of documents || []) {
    if (!document) continue;
    const existingIndex = duplicateIndex(kept, document);
    if (existingIndex < 0) {
      kept.push(document);
    } else if (isBetterDocument(document, kept[existingIndex])) {
      kept[existingIndex] = document;
    }
  }
  return kept;
}
