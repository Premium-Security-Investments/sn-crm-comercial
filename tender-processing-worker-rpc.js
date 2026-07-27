async function rpc(database, name, args) {
  const { data, error } = await database.rpc(name, args);
  if (error) throw error;
  return data;
}

/** Claims one job and augments the RPC's minimal payload with the fields the
 * durable worker (tender-processing-worker.js) needs but the claim RPC does
 * not return: authorization state, counters and pending import items. */
export async function claimTenderProcessingJob(database, { leaseSeconds = 90 } = {}) {
  const claim = await rpc(database, 'psi_claim_tender_processing_job', { p_lease_seconds: leaseSeconds });
  if (!claim || claim.status !== 'claimed') return null;

  const { data: job, error: jobError } = await database
    .from('psi_tender_processing_jobs')
    .select('requested_by,analysis_authorized_by,snapshot_id,documents_processed,documents_imported,documents_unchanged,documents_failed,attempt_count')
    .eq('id', claim.job_id)
    .single();
  if (jobError) throw jobError;

  const { data: pendingItems, error: itemsError } = await database
    .from('psi_tender_document_import_items')
    .select('source,source_document_id,source_url,name,critical,attempt_count')
    .eq('job_id', claim.job_id)
    .in('status', ['pending', 'failed_retryable'])
    .order('created_at', { ascending: true })
    .limit(50);
  if (itemsError) throw itemsError;

  return {
    job_id: claim.job_id,
    lease_id: claim.lease_id,
    tender_id: claim.tender_id,
    opportunity_id: claim.opportunity_id,
    current_step: claim.current_step,
    status: claim.pipeline_status,
    requested_by: job.requested_by,
    analysis_authorized_by: job.analysis_authorized_by,
    snapshot_id: job.snapshot_id,
    documents_processed: job.documents_processed,
    documents_imported: job.documents_imported,
    documents_unchanged: job.documents_unchanged,
    documents_failed: job.documents_failed,
    attempt_count: job.attempt_count,
    pending_documents: (pendingItems || []).map(item => ({
      source: item.source,
      sourceDocumentId: item.source_document_id,
      sourceUrl: item.source_url,
      name: item.name,
      critical: item.critical,
      attemptCount: item.attempt_count,
    })),
  };
}

export async function updateTenderProcessingJob(database, jobId, leaseId, patch) {
  return rpc(database, 'psi_update_tender_processing_job', { p_job_id: jobId, p_lease_id: leaseId, p_patch: patch });
}

export async function recordTenderImportItem(database, { jobId, source, sourceDocumentId, sourceUrl, name, status, critical, documentVersionId, lastErrorCode, lastErrorMessage }) {
  return rpc(database, 'psi_record_tender_import_item', {
    p_job_id: jobId,
    p_source: source,
    p_source_document_id: sourceDocumentId,
    p_source_url: sourceUrl || null,
    p_name: name,
    p_status: status,
    p_critical: !!critical,
    p_document_version_id: documentVersionId || null,
    p_last_error_code: lastErrorCode || null,
    p_last_error_message: lastErrorMessage || null,
  });
}

export async function appendTenderProcessingEvent(database, { tenderId, eventType, actorKind, createdBy = null, sourceRefType = null, sourceRefId = null, metadata = null, note = null, singular = false }) {
  return rpc(database, 'psi_append_tender_tracking_event', {
    p_tender_id: tenderId,
    p_event_type: eventType,
    p_actor_kind: actorKind,
    p_created_by: createdBy,
    p_source_ref_type: sourceRefType,
    p_source_ref_id: sourceRefId,
    p_metadata: metadata,
    p_note: note,
    p_singular: !!singular,
  });
}

export async function getTenderProcessingJobActor(database, jobId) {
  const { data, error } = await database
    .from('psi_tender_processing_jobs')
    .select('requested_by,analysis_authorized_by,tender_id,opportunity_id')
    .eq('id', jobId)
    .single();
  if (error) throw error;
  return data;
}
