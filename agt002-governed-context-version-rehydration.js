function invalid(message) {
  const error = new Error(message);
  error.code = 'AGT002_CONTEXT_VERSION_READ_INVALID';
  return error;
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Reads EXACTLY the one immutable psi_agt002_context_versions row this job's contextVersionId
// identifies — by primary key plus opportunity/tender/snapshot scope, never by ordering or
// "latest" — and maps it onto the narrow shape the executor (agt002-reanalysis-executor.js)
// already cross-checks byte-for-byte against the job's own frozen identity (content-hash
// recomputation/comparison and contextV2Sections completeness happen there, not here).
export async function resolveAgt002GovernedContextVersionForExecution({
  database, contextVersionId, opportunityId, tenderId, snapshotId,
}) {
  if (!isNonBlankString(contextVersionId)) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: missing contextVersionId');
  if (!isNonBlankString(opportunityId)) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: missing opportunityId');
  if (!isNonBlankString(tenderId)) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: missing tenderId');
  if (!isNonBlankString(snapshotId)) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: missing snapshotId');

  const { data: row, error } = await database
    .from('psi_agt002_context_versions')
    .select('id,opportunity_id,tender_id,snapshot_id,context,context_hash')
    .eq('id', contextVersionId)
    .eq('opportunity_id', opportunityId)
    .eq('tender_id', tenderId)
    .eq('snapshot_id', snapshotId)
    .maybeSingle();

  if (error) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: context version read failed');
  if (!isObject(row)) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: context version row not found');
  if (row.id !== contextVersionId) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: context version id mismatch');
  if (row.opportunity_id !== opportunityId) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: context version opportunity_id mismatch');
  if (row.tender_id !== tenderId) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: context version tender_id mismatch');
  if (row.snapshot_id !== snapshotId) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: context version snapshot_id mismatch');
  if (!isObject(row.context)) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: context version context blob missing or malformed');
  if (!isNonBlankString(row.context_hash)) throw invalid('AGT002_CONTEXT_VERSION_READ_INVALID: context version context_hash missing or malformed');

  return Object.freeze({
    opportunity_id: row.opportunity_id,
    tender_id: row.tender_id,
    snapshot_id: row.snapshot_id,
    context: row.context,
    content_hash: row.context_hash,
  });
}
