function parseLegacyNotes(notes) {
  if (notes && typeof notes === 'object' && !Array.isArray(notes)) return notes;
  try { return JSON.parse(String(notes || '{}')); } catch { return null; }
}

function exclusion(interaction, document, reason) {
  return {
    interaction_id: interaction?.id || null,
    document_id: document?.id || null,
    name: document?.name || null,
    reason,
  };
}

export function planAerocivilBackfill({ interactions, expectedCount = 40 } = {}) {
  const ready = [];
  const excluded = [];
  const identities = new Set();
  let found = 0;

  for (const interaction of interactions || []) {
    const payload = parseLegacyNotes(interaction?.notes);
    if (payload?.kind !== 'tender_document_upload' || !Array.isArray(payload.documents)) continue;
    for (const document of payload.documents) {
      found += 1;
      const storagePath = String(document?.storage_path || document?.path || '').trim();
      const size = Number(document?.size ?? document?.size_bytes);
      const mimeType = String(document?.mime_type || '').trim().toLowerCase();
      const extractedText = String(document?.extracted_text || '').trim();
      const source = String(document?.source || payload.source || '').trim();
      const contentHash = String(document?.content_hash || document?.sha256 || '').trim();
      const legacyId = String(document?.id || '').trim();
      const explicitSourceDocumentId = String(document?.source_document_id || '').trim();
      const identitySeed = contentHash || legacyId;
      const sourceDocumentId = explicitSourceDocumentId || (identitySeed ? `legacy:${identitySeed}` : '');

      let reason = null;
      if (!storagePath) reason = 'missing_storage_path';
      else if (!Number.isFinite(size) || size <= 0) reason = 'invalid_size';
      else if (!mimeType) reason = 'missing_mime_type';
      else if (!extractedText) reason = 'empty_text';
      else if (!source) reason = 'missing_source';
      else if (!sourceDocumentId) reason = 'missing_identity';
      else if (identities.has(`${source.toLowerCase()}:${sourceDocumentId}`)) reason = 'duplicate_identity';

      if (reason) {
        excluded.push(exclusion(interaction, document, reason));
        continue;
      }
      identities.add(`${source.toLowerCase()}:${sourceDocumentId}`);
      ready.push({
        interaction_id: interaction?.id || null,
        legacy_document_id: legacyId || null,
        name: String(document?.name || sourceDocumentId).trim(),
        storage_path: storagePath,
        size_bytes: size,
        mime_type: mimeType,
        content_hash: contentHash || null,
        extracted_text: extractedText,
        source,
        source_url: String(document?.source_url || payload.source_url || '').trim() || null,
        source_document_id: sourceDocumentId,
      });
    }
  }

  return { ready, excluded, expected: expectedCount, found };
}
