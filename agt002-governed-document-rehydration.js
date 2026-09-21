const HEX64 = /^[0-9a-f]{64}$/;

function invalid(message) {
  const error = new Error(message);
  error.code = 'AGT002_GOVERNED_DOCUMENT_INVALID';
  return error;
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHex64(value) {
  return typeof value === 'string' && HEX64.test(value);
}

// Reads EXACTLY the one immutable document version row and EXACTLY the one 'ok' extraction row a
// frozen governed_workset_members entry identifies — by primary key plus tenant/tender scope,
// never by ordering or "latest" — and maps them onto the narrow 5-field shape the executor
// (agt002-reanalysis-executor.js) already cross-checks byte-for-byte against the frozen member.
// Text hash recomputation/validation happens there, not here.
export async function resolveAgt002GovernedDocumentForExecution(database, args) {
  const { opportunityId, tenderId, documentVersionId, member } = args || {};

  if (!isNonBlankString(opportunityId)) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: missing opportunityId');
  if (!isNonBlankString(tenderId)) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: missing tenderId');
  if (!isNonBlankString(documentVersionId)) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: missing documentVersionId');
  if (!member || typeof member !== 'object') throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: missing member');
  if (!isNonBlankString(member.extraction_id)) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: missing member.extraction_id');

  const { data: versionRow, error: versionError } = await database
    .from('psi_tender_document_versions')
    .select('id,content_hash')
    .eq('id', documentVersionId)
    .eq('opportunity_id', opportunityId)
    .eq('tender_id', tenderId)
    .maybeSingle();

  if (versionError) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: document version read failed');
  if (!versionRow) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: document version row not found');
  if (versionRow.id !== documentVersionId) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: document version id mismatch');
  if (!isHex64(versionRow.content_hash)) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: document version content_hash malformed');

  const { data: extractionRow, error: extractionError } = await database
    .from('psi_tender_document_extractions')
    .select('id,document_version_id,text_hash,extracted_text')
    .eq('id', member.extraction_id)
    .eq('document_version_id', documentVersionId)
    .eq('opportunity_id', opportunityId)
    .eq('tender_id', tenderId)
    .eq('status', 'ok')
    .maybeSingle();

  if (extractionError) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: extraction read failed');
  if (!extractionRow) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: extraction row not found');
  if (extractionRow.id !== member.extraction_id) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: extraction id mismatch');
  if (extractionRow.document_version_id !== documentVersionId) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: extraction document_version_id mismatch');
  if (!isHex64(extractionRow.text_hash)) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: extraction text_hash malformed');
  if (!isNonBlankString(extractionRow.extracted_text)) throw invalid('AGT002_GOVERNED_DOCUMENT_INVALID: extraction extracted_text blank');

  return {
    document_version_id: versionRow.id,
    content_hash: versionRow.content_hash,
    extraction_id: extractionRow.id,
    extraction_text_hash: extractionRow.text_hash,
    text: extractionRow.extracted_text,
  };
}
