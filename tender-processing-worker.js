import { classifyPipelineError, computeBackoffMs } from './tender-pipeline-backoff.js';

function safeMessage(error) {
  return typeof error?.message === 'string' ? error.message : 'error desconocido';
}

// Batched, resumable durable pipeline worker. All dependencies are injected
// (no direct network/DB access) so a single runOnce() call advances exactly
// one phase of one claimed job, keeping each invocation within timeBudgetMs.
export function createTenderProcessingWorker(deps) {
  const {
    claimJob, updateJob, recordImportItem, appendEvent,
    revalidateOfficialStatus, discoverDocuments, importOneDocument,
    publishSnapshot, requestAgt002, now,
  } = deps;

  // batchSize defaults to 1: a single official-source document download can
  // take up to the pinned-fetch network timeout (safe-official-fetch.js:
  // 20s, more with redirects) and the per-batch loop below only checks the
  // time budget BETWEEN documents, never mid-download. Queuing more than one
  // document per invocation risks exceeding both timeBudgetMs and the
  // platform's hard request ceiling (vercel.json maxDuration=60s).
  async function runOnce({ batchSize = 1, timeBudgetMs = 90000 } = {}) {
    const claim = await claimJob();
    if (!claim || claim.status === 'empty') {
      return { status: 'empty' };
    }

    const { job_id: jobId, lease_id: leaseId, tender_id: tenderId, opportunity_id: opportunityId } = claim;
    const startedAt = now();

    // Spec §7.1: revalidate the official status before importing and before
    // analyzing. A single runOnce() call only ever advances one phase, so
    // checking unconditionally here covers both cases.
    const official = await revalidateOfficialStatus({ tenderId, opportunityId });
    if (official?.terminal) {
      await updateJob(jobId, leaseId, { status: 'cancelled', current_step: 'cancelled' });
      await appendEvent({
        tenderId, eventType: 'cancelled', actorKind: 'system',
        sourceRefType: 'job', sourceRefId: jobId,
      });
      return { status: 'cancelled', job_id: jobId };
    }

    const pipelineStatus = claim.status;

    if (pipelineStatus === 'queued' || pipelineStatus === 'discovering_documents') {
      const discovered = await discoverDocuments({ jobId, tenderId, opportunityId });
      await updateJob(jobId, leaseId, {
        status: 'importing_documents',
        current_step: 'documents',
        documents_discovered: discovered.length,
      });
      await appendEvent({
        tenderId, eventType: 'document_discovery_started', actorKind: 'system',
        sourceRefType: 'job', sourceRefId: jobId, metadata: { discovered: discovered.length },
      });
      return { status: 'discovered', job_id: jobId, discovered: discovered.length };
    }

    if (pipelineStatus === 'importing_documents' || pipelineStatus === 'retry_wait') {
      const allPending = claim.pending_documents || [];
      const batch = allPending.slice(0, batchSize);

      let imported = 0;
      let unchanged = 0;
      let failedTerminal = 0;
      let failedRetryable = 0;
      let processed = 0;
      let anyUsableText = false;
      let anyCriticalTerminalFailure = false;

      for (const doc of batch) {
        if (now() - startedAt >= timeBudgetMs) break;
        processed += 1;
        try {
          const result = await importOneDocument({ jobId, tenderId, opportunityId, document: doc });
          if (result.status === 'imported') imported += 1;
          else if (result.status === 'unchanged') unchanged += 1;
          if (result.hasText) anyUsableText = true;
          await recordImportItem({
            jobId, source: doc.source, sourceDocumentId: doc.sourceDocumentId,
            sourceUrl: doc.sourceUrl, name: doc.name, status: result.status,
            critical: doc.critical || false, documentVersionId: result.documentVersionId || null,
          });
        } catch (error) {
          const classification = classifyPipelineError(error);
          if (classification === 'retryable') {
            failedRetryable += 1;
            const nextAttemptAt = new Date(now() + computeBackoffMs({ attempt: (doc.attemptCount || 0) + 1 })).toISOString();
            await recordImportItem({
              jobId, source: doc.source, sourceDocumentId: doc.sourceDocumentId,
              sourceUrl: doc.sourceUrl, name: doc.name, status: 'failed_retryable',
              critical: doc.critical || false, lastErrorCode: error.code, lastErrorMessage: safeMessage(error),
              nextAttemptAt,
            });
          } else {
            failedTerminal += 1;
            if (doc.critical) anyCriticalTerminalFailure = true;
            await recordImportItem({
              jobId, source: doc.source, sourceDocumentId: doc.sourceDocumentId,
              sourceUrl: doc.sourceUrl, name: doc.name, status: 'failed_terminal',
              critical: doc.critical || false, lastErrorCode: error.code, lastErrorMessage: safeMessage(error),
            });
          }
        }
      }

      const failed = failedTerminal + failedRetryable;
      const remaining = Math.max(0, allPending.length - batch.length);
      const patch = {
        documents_processed: (claim.documents_processed || 0) + processed,
        documents_imported: (claim.documents_imported || 0) + imported,
        documents_unchanged: (claim.documents_unchanged || 0) + unchanged,
        documents_failed: (claim.documents_failed || 0) + failed,
      };

      // Retryable failures mean the batch isn't fully resolved yet: stay in
      // importing_documents rather than deciding usability prematurely.
      if (remaining > 0 || failedRetryable > 0) {
        patch.status = 'importing_documents';
        patch.current_step = 'documents';
        await updateJob(jobId, leaseId, patch);
        return { status: 'batch_processed', job_id: jobId, processed, remaining };
      }

      // Spec §7.1: usable when at least one current document has text and
      // no critical document failed terminally; otherwise needs_attention.
      const usable = anyUsableText && !anyCriticalTerminalFailure;
      patch.status = usable ? 'ready_for_snapshot' : 'needs_attention';
      patch.current_step = usable ? 'snapshot' : 'documents';
      await updateJob(jobId, leaseId, patch);

      await appendEvent({
        tenderId, eventType: usable ? 'document_import_completed' : 'document_import_failed',
        actorKind: 'system', sourceRefType: 'job', sourceRefId: jobId,
        metadata: { imported, unchanged, failed },
      });
      return { status: usable ? 'ready_for_snapshot' : 'needs_attention', job_id: jobId };
    }

    if (pipelineStatus === 'ready_for_snapshot') {
      const snapshot = await publishSnapshot({ jobId, tenderId, opportunityId });
      const nextStatus = claim.analysis_authorized_by ? 'waiting_agent_capacity' : 'awaiting_analysis_authorization';
      await updateJob(jobId, leaseId, {
        status: nextStatus,
        current_step: 'analysis',
        snapshot_id: snapshot.id,
      });
      await appendEvent({
        tenderId, eventType: 'snapshot_published', actorKind: 'system',
        sourceRefType: 'snapshot', sourceRefId: snapshot.id, singular: true,
      });
      return { status: 'snapshot_published', job_id: jobId, snapshot_id: snapshot.id };
    }

    if (pipelineStatus === 'waiting_agent_capacity' || pipelineStatus === 'analyzing') {
      const result = await requestAgt002({ jobId, tenderId, opportunityId, snapshotId: claim.snapshot_id });

      if (result.status === 'completed') {
        await updateJob(jobId, leaseId, {
          status: 'completed', current_step: 'done',
          analysis_run_id: result.analysisRunId,
          completed_at: new Date(now()).toISOString(),
        });
        await appendEvent({
          tenderId, eventType: 'analysis_completed', actorKind: 'agent',
          sourceRefType: 'analysis_run', sourceRefId: result.analysisRunId,
        });
        return { status: 'completed', job_id: jobId };
      }

      if (result.status === 'quota' || result.status === 'saturated' || result.status === 'busy') {
        await updateJob(jobId, leaseId, { status: 'waiting_agent_capacity', current_step: 'analysis' });
        return { status: 'waiting_agent_capacity', job_id: jobId, reason: result.status };
      }

      if (result.status === 'rules_fallback') {
        // No fallback silencioso: un preanálisis por reglas nunca completa el
        // paso AGT-002; el job permanece esperando capacidad real.
        await updateJob(jobId, leaseId, { status: 'waiting_agent_capacity', current_step: 'analysis' });
        await appendEvent({
          tenderId, eventType: 'analysis_rules_fallback_shown', actorKind: 'system',
          sourceRefType: 'job', sourceRefId: jobId,
        });
        return { status: 'waiting_agent_capacity', job_id: jobId, reason: 'rules_fallback' };
      }

      const classification = classifyPipelineError(result.error || {});
      if (classification === 'retryable') {
        await updateJob(jobId, leaseId, {
          status: 'waiting_agent_capacity', current_step: 'analysis',
          attempt_count: (claim.attempt_count || 0) + 1,
        });
        return { status: 'waiting_agent_capacity', job_id: jobId, reason: 'retry' };
      }

      await updateJob(jobId, leaseId, {
        status: 'needs_attention', current_step: 'analysis',
        last_error_code: result.error?.code || null,
        last_error_message: safeMessage(result.error || {}),
      });
      await appendEvent({
        tenderId, eventType: 'analysis_failed', actorKind: 'system',
        sourceRefType: 'job', sourceRefId: jobId,
      });
      return { status: 'needs_attention', job_id: jobId };
    }

    return { status: 'noop', job_id: jobId };
  }

  return { runOnce };
}
