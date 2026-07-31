function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} debe ser texto no vacío.`);
  return value.trim();
}

function adaptDocument(record, index, { opportunityId, snapshotId }) {
  const label = `documents[${index}]`;
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${label} debe ser un objeto.`);
  const recordOpportunityId = requireText(record.opportunity_id, `${label}.opportunity_id`);
  if (recordOpportunityId !== opportunityId) throw new Error(`${label}.opportunity_id no coincide con la oportunidad.`);
  const version = record.version;
  if (!Number.isInteger(version) || version <= 0) throw new Error(`${label}.version debe ser un entero mayor que cero.`);
  const contentHash = requireText(record.content_hash, `${label}.content_hash`).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error(`${label}.content_hash debe ser SHA-256 hexadecimal.`);
  if (typeof record.current !== 'boolean') throw new Error(`${label}.current debe ser booleano.`);
  if (typeof record.extracted_text !== 'string') throw new Error(`${label}.extracted_text debe ser texto.`);

  return {
    document_id: requireText(record.source_document_id, `${label}.source_document_id`),
    document_version_id: requireText(record.id, `${label}.id`),
    opportunity_id: recordOpportunityId,
    snapshot_id: snapshotId,
    document_type: requireText(record.document_type, `${label}.document_type`),
    name: requireText(record.name, `${label}.name`),
    version,
    content_hash: contentHash,
    current: record.current,
    extracted_text: record.extracted_text,
  };
}

export function adaptAgt002RetrievalDocuments(records, { opportunityId, snapshotId }) {
  if (!Array.isArray(records)) throw new Error('documents debe ser una lista.');
  const normalizedOpportunityId = requireText(opportunityId, 'opportunityId');
  const normalizedSnapshotId = requireText(snapshotId, 'snapshotId');
  return records.map((record, index) => adaptDocument(record, index, {
    opportunityId: normalizedOpportunityId,
    snapshotId: normalizedSnapshotId,
  }));
}
