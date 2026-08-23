function normalizedId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

// psi_tender_document_import_items.status (migration 032) is a closed set:
// 'pending' | 'processing' | 'imported' | 'unchanged' | 'failed_retryable' | 'failed_terminal'.
// ONLY the two success states below mean "this source document really reached the snapshot".
// Everything else — still queued, mid-flight, retryable failure, terminal failure, and any
// unknown/missing value — is an unresolved source for the current inventory. Filtering on
// 'failed_terminal' alone silently converted an import that never finished into "nothing is
// missing", which is what let expedient_coverage.status reach 'complete' for a partially
// imported expediente.
const RESOLVED_IMPORT_STATES = new Set(['imported', 'unchanged']);
// Known non-success states keep their exact state as the gap reason (so 'failed_terminal'
// stays byte-identical to what the inventory recorded before). Anything outside the closed
// set — including null/missing — collapses to one fixed, deterministic unknown reason
// instead of copying an unrecognized value through as if it were governed vocabulary.
const UNRESOLVED_IMPORT_STATES = new Set(['pending', 'processing', 'failed_retryable', 'failed_terminal']);
const UNKNOWN_IMPORT_STATE_REASON = 'unknown_import_state';

/** Fail-closed: only an explicitly resolved (imported/unchanged) row is not a gap. */
export function agt002ImportItemGapReason(status) {
  const state = normalizedId(status);
  if (state && RESOLVED_IMPORT_STATES.has(state)) return null;
  return state && UNRESOLVED_IMPORT_STATES.has(state) ? state : UNKNOWN_IMPORT_STATE_REASON;
}

// psi_tender_document_import_items.source_document_id is declared not-null/non-blank at the
// schema level, but this loader is the last fail-closed gate before an unresolved item can
// vanish from the inventory — it must not silently trust that invariant. A row that reaches
// here with no usable source_document_id still names a real database row (its own primary
// key), so that key becomes the gap's document_id: real identity, never invented text, and
// never able to pass as an actual source document, since a gap can only ever be
// 'unresolved_visible' and therefore can never anchor a requirement citation.
const MISSING_SOURCE_DOCUMENT_ID_PREFIX = 'agt002-missing-source-document:';
const MISSING_SOURCE_DOCUMENT_ID_FALLBACK = `${MISSING_SOURCE_DOCUMENT_ID_PREFIX}unknown`;

function gapDocumentId(item) {
  const sourceDocumentId = normalizedId(item?.source_document_id);
  if (sourceDocumentId) return sourceDocumentId;
  const itemId = normalizedId(item?.id);
  return itemId ? `${MISSING_SOURCE_DOCUMENT_ID_PREFIX}${itemId}` : MISSING_SOURCE_DOCUMENT_ID_FALLBACK;
}

/**
 * Loads durable document gaps for the processing job that produced a snapshot.
 * An explicit jobId wins on the initial processing route; reanalysis routes resolve
 * the newest job for the immutable snapshot. Historical failures from other snapshots
 * are never mixed into the current inventory.
 *
 * Every row for the job is read and classified here rather than filtered in SQL: a NULL,
 * empty or future status value must become a visible gap, and an `.eq`/`.in` predicate
 * would drop exactly those rows instead.
 */
export async function loadAgt002TenderRequirementDocumentGaps(database, { snapshotId, jobId = null } = {}) {
  let resolvedJobId = normalizedId(jobId);
  if (!resolvedJobId) {
    const normalizedSnapshotId = normalizedId(snapshotId);
    if (!normalizedSnapshotId) return [];
    const jobResponse = await database.from('psi_tender_processing_jobs')
      .select('id')
      .eq('snapshot_id', normalizedSnapshotId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (jobResponse.error) throw jobResponse.error;
    resolvedJobId = normalizedId(jobResponse.data?.id);
  }
  if (!resolvedJobId) return [];

  const gapResponse = await database.from('psi_tender_document_import_items')
    .select('id,source_document_id,name,status')
    .eq('job_id', resolvedJobId);
  if (gapResponse.error) throw gapResponse.error;

  const gaps = (gapResponse.data || [])
    .map(item => {
      const reason = agt002ImportItemGapReason(item?.status);
      if (reason === null) return null;
      return {
        document_id: gapDocumentId(item),
        name: normalizedId(item?.name),
        document_type: null,
        reason,
      };
    })
    .filter(gap => gap != null);

  // Two distinct job-item rows can resolve to the identical (document_id, reason) pair — e.g.
  // the same source_document_id imported under two different `source` connectors and both
  // still unresolved with the same status. The inventory builder treats a duplicate
  // (document_id, reason) pair as corrupt input and refuses to run, so it is collapsed here.
  // Sorting before dedup makes which physical row "wins" a function of the data, never of
  // unspecified database row order.
  const seen = new Set();
  return gaps
    .sort((left, right) => (
      left.document_id.localeCompare(right.document_id)
      || left.reason.localeCompare(right.reason)
      || String(left.name).localeCompare(String(right.name))
    ))
    .filter(gap => {
      const key = `${gap.document_id}\0${gap.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
