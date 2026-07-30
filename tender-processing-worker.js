import { classifyPipelineError, computeBackoffMs, MAX_ATTEMPTS } from './tender-pipeline-backoff.js';
import { createAgt002AnalysisObservability, toBoundedAgt002Error } from './agt002-analysis-observability.js';

function safeMessage(error) {
  return typeof error?.message === 'string' ? error.message : 'error desconocido';
}

// A lost/expired lease surfaces as a thrown error from psi_update_tender_processing_job
// (migration 034/049: "lease inválido para job %") once another claim has reclaimed the
// job after TTL expiry. There is no separate renew/expire RPC to hook, so this is the
// only point in the JS layer where an expired-and-recovered lease is observable.
function isLeaseConflictError(error) {
  return /lease/i.test(String(error?.message || ''));
}

// runOnce() result statuses after which the same job has no immediately
// claimable next phase, so the bounded drain loop (tender-processing-drain.js)
// must yield instead of calling runOnce() again:
//   - empty / noop        -> no work was available to advance.
//   - completed/cancelled -> terminal; the job left the claimable set.
//   - needs_attention     -> parked for a human; not claimable.
//   - waiting_agent_capacity -> analysis backoff. Its next attempt is gated by
//     next_attempt_at, and a shown rules preview keeps the job in this state
//     with no backoff, so re-claiming in a tight loop must be avoided.
// Continue statuses (discovered, batch_processed, ready_for_snapshot,
// snapshot_published) all leave the job in a claimable state (or naturally
// yield to 'empty' on the next claim), so the drain advances into them.
export const WORKER_YIELD_STATUSES = Object.freeze([
  'empty', 'noop', 'completed', 'cancelled', 'needs_attention', 'waiting_agent_capacity',
]);

const WORKER_YIELD_SET = new Set(WORKER_YIELD_STATUSES);

export function isWorkerYieldStatus(status) {
  return WORKER_YIELD_SET.has(status);
}

// Batched, resumable durable pipeline worker. All dependencies are injected
// (no direct network/DB access) so a single runOnce() call advances exactly
// one phase of one claimed job, keeping each invocation within timeBudgetMs.
export function createTenderProcessingWorker(deps) {
  const {
    claimJob, updateJob, recordImportItem, appendEvent,
    revalidateOfficialStatus, discoverDocuments, importOneDocument,
    chunkDocuments, publishSnapshot, requestAgt002, now,
    analysisConfig = Object.freeze({}),
    observability = createAgt002AnalysisObservability(),
  } = deps;

  // Reserved for phase-gated behavior. Keeping the injected configuration in
  // the worker contract now lets later phases branch without reading process
  // environment directly; with every flag off it is intentionally inert.
  void analysisConfig;

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

    observability.record('job_claimed', {
      job_id: jobId, tender_id: tenderId, opportunity_id: opportunityId,
      pipeline_status: claim.status, current_step: claim.current_step, attempt_count: claim.attempt_count,
    });
    observability.record('lease_claimed', { job_id: jobId, tender_id: tenderId });

    // Every durable-state write goes through this one wrapper so a released
    // lease (updateJob patch carries release_lease when TENDER_CONTINUOUS_DRAIN
    // is on) or an invalidated one (lost to TTL expiry + reclaim by another
    // worker) is observed exactly once, without changing the call's outcome:
    // the same result is returned, and the same error (if any) is rethrown.
    async function updateJobObserved(patch) {
      try {
        const result = await updateJob(jobId, leaseId, patch);
        if (result?.lease_released) observability.record('lease_released', { job_id: jobId, tender_id: tenderId });
        return result;
      } catch (error) {
        if (isLeaseConflictError(error)) observability.record('lease_expired', { job_id: jobId, tender_id: tenderId });
        throw error;
      }
    }

    function finishStage(stage, outcome, result) {
      observability.record('stage_duration', { job_id: jobId, tender_id: tenderId, stage, outcome, duration_ms: now() - startedAt });
      return result;
    }

    // Spec §7.1: revalidate the official status before importing and before
    // analyzing. A single runOnce() call only ever advances one phase, so
    // checking unconditionally here covers both cases.
    const official = await revalidateOfficialStatus({ tenderId, opportunityId });
    if (official?.terminal) {
      await updateJobObserved({ status: 'cancelled', current_step: 'cancelled' });
      await appendEvent({
        tenderId, eventType: 'cancelled', actorKind: 'system',
        sourceRefType: 'job', sourceRefId: jobId,
      });
      observability.record('outcome_recorded', { job_id: jobId, tender_id: tenderId, stage: 'revalidate', outcome: 'cancelled' });
      return finishStage('revalidate', 'cancelled', { status: 'cancelled', job_id: jobId });
    }

    const pipelineStatus = claim.status;

    if (pipelineStatus === 'queued' || pipelineStatus === 'discovering_documents') {
      const discovered = await discoverDocuments({ jobId, tenderId, opportunityId });
      await updateJobObserved({
        status: 'importing_documents',
        current_step: 'documents',
        documents_discovered: discovered.length,
      });
      await appendEvent({
        tenderId, eventType: 'document_discovery_started', actorKind: 'system',
        sourceRefType: 'job', sourceRefId: jobId, metadata: { discovered: discovered.length },
      });
      return finishStage('discover_documents', 'discovered', { status: 'discovered', job_id: jobId, discovered: discovered.length });
    }

    if (pipelineStatus === 'importing_documents' || pipelineStatus === 'retry_wait') {
      const allPending = claim.pending_documents || [];
      const batch = allPending.slice(0, batchSize);

      let imported = 0;
      let unchanged = 0;
      let failedTerminal = 0;
      let failedRetryable = 0;
      let processed = 0;
      let failedDelta = 0;
      let resolvedPriorFailures = 0;
      let earliestRetryAt = null;
      let anyUsableText = claim.any_usable_text === true;
      let anyCriticalTerminalFailure = claim.any_critical_terminal_failure === true;

      for (const doc of batch) {
        if (now() - startedAt >= timeBudgetMs) break;
        const priorAttempts = Number(doc.attemptCount || 0);
        if (priorAttempts === 0) processed += 1;
        try {
          const result = await importOneDocument({ jobId, tenderId, opportunityId, document: doc });
          if (result.status === 'imported') imported += 1;
          else if (result.status === 'unchanged') unchanged += 1;
          if (priorAttempts > 0) resolvedPriorFailures += 1;
          if (result.hasText) anyUsableText = true;
          await recordImportItem({
            jobId, source: doc.source, sourceDocumentId: doc.sourceDocumentId,
            sourceUrl: doc.sourceUrl, name: doc.name, status: result.status,
            critical: doc.critical || false, documentVersionId: result.documentVersionId || null,
          });
        } catch (error) {
          const classification = classifyPipelineError(error);
          const nextAttempt = priorAttempts + 1;
          if (priorAttempts === 0) failedDelta += 1;
          if (classification === 'retryable' && nextAttempt < MAX_ATTEMPTS) {
            failedRetryable += 1;
            const nextAttemptAt = new Date(now() + computeBackoffMs({ attempt: nextAttempt })).toISOString();
            if (!earliestRetryAt || nextAttemptAt < earliestRetryAt) earliestRetryAt = nextAttemptAt;
            await recordImportItem({
              jobId, source: doc.source, sourceDocumentId: doc.sourceDocumentId,
              sourceUrl: doc.sourceUrl, name: doc.name, status: 'failed_retryable',
              critical: doc.critical || false, lastErrorCode: error.code, lastErrorMessage: safeMessage(error),
              nextAttemptAt,
            });
          } else {
            failedTerminal += 1;
            if (doc.critical) anyCriticalTerminalFailure = true;
            const exhaustedCode = classification === 'retryable'
              ? `${error.code || 'TENDER_DOC_RETRY'}_MAX_ATTEMPTS`
              : error.code;
            await recordImportItem({
              jobId, source: doc.source, sourceDocumentId: doc.sourceDocumentId,
              sourceUrl: doc.sourceUrl, name: doc.name, status: 'failed_terminal',
              critical: doc.critical || false, lastErrorCode: exhaustedCode, lastErrorMessage: safeMessage(error),
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
        documents_failed: Math.max(0, (claim.documents_failed || 0) + failedDelta - resolvedPriorFailures),
        next_attempt_at: failedRetryable > 0 ? earliestRetryAt : null,
      };

      // Retryable failures mean the batch isn't fully resolved yet: stay in
      // importing_documents rather than deciding usability prematurely.
      if (remaining > 0 || failedRetryable > 0) {
        patch.status = 'importing_documents';
        patch.current_step = 'documents';
        await updateJobObserved(patch);
        if (failedRetryable > 0) {
          observability.record('retry_scheduled', { job_id: jobId, tender_id: tenderId, stage: 'import_documents', count: failedRetryable });
        }
        return finishStage('import_documents', 'batch_processed', { status: 'batch_processed', job_id: jobId, processed, remaining });
      }

      // Spec §7.1: usable when at least one current document has text and
      // no critical document failed terminally; otherwise needs_attention.
      const usable = anyUsableText && !anyCriticalTerminalFailure;
      patch.status = usable ? 'ready_for_snapshot' : 'needs_attention';
      patch.current_step = usable ? 'snapshot' : 'documents';
      await updateJobObserved(patch);

      await appendEvent({
        tenderId, eventType: usable ? 'document_import_completed' : 'document_import_failed',
        actorKind: 'system', sourceRefType: 'job', sourceRefId: jobId,
        metadata: { imported, unchanged, failed },
      });
      observability.record('outcome_recorded', {
        job_id: jobId, tender_id: tenderId, stage: 'import_documents',
        outcome: usable ? 'ready_for_snapshot' : 'needs_attention',
      });
      return finishStage('import_documents', usable ? 'ready_for_snapshot' : 'needs_attention', { status: usable ? 'ready_for_snapshot' : 'needs_attention', job_id: jobId });
    }

    if (pipelineStatus === 'ready_for_snapshot') {
      // publishSnapshot creates/registers the snapshot first, so chunkDocuments (when
      // wired) can link every chunk to a real snapshot_id. Chunking runs after that and
      // BEFORE the job is marked done or snapshot_published is emitted: if chunkDocuments
      // throws (e.g. a lost lease mid-persistence), updateJob/appendEvent below never run,
      // so the job stays claimable and a retry re-chunks safely (dedup is by chunk_id at
      // the RPC layer). chunkDocuments is optional so deployments that have not wired it
      // yet keep today's exact behavior (no direct DB/model access here either way: the
      // injected dependency owns any storage).
      const snapshot = await publishSnapshot({ jobId, tenderId, opportunityId });
      observability.record('snapshot_published', { job_id: jobId, tender_id: tenderId, opportunity_id: opportunityId, snapshot_id: snapshot.id });
      if (chunkDocuments) {
        const chunking = await chunkDocuments({ jobId, tenderId, opportunityId, snapshotId: snapshot.id });
        observability.record('document_coverage', {
          job_id: jobId, tender_id: tenderId, opportunity_id: opportunityId, snapshot_id: snapshot.id,
          documents_total: chunking.documents, chunks_total: chunking.chunks, gaps_total: chunking.gaps,
        });
        await appendEvent({
          tenderId, eventType: 'documents_chunked', actorKind: 'system',
          sourceRefType: 'job', sourceRefId: jobId,
          metadata: {
            documents: chunking.documents, chunks: chunking.chunks, gaps: chunking.gaps,
            gap_details: chunking.gapDetails || [],
          },
        });
      }
      const nextStatus = claim.analysis_authorized_by ? 'waiting_agent_capacity' : 'awaiting_analysis_authorization';
      await updateJobObserved({
        status: nextStatus,
        current_step: 'analysis',
        snapshot_id: snapshot.id,
      });
      await appendEvent({
        tenderId, eventType: 'snapshot_published', actorKind: 'system',
        sourceRefType: 'snapshot', sourceRefId: snapshot.id, singular: true,
      });
      return finishStage('publish_snapshot', 'snapshot_published', { status: 'snapshot_published', job_id: jobId, snapshot_id: snapshot.id });
    }

    if (pipelineStatus === 'waiting_agent_capacity' || pipelineStatus === 'analyzing') {
      observability.record('model_invocation_started', { job_id: jobId, tender_id: tenderId, opportunity_id: opportunityId });
      const modelStartedAt = now();
      const result = await requestAgt002({ jobId, tenderId, opportunityId, snapshotId: claim.snapshot_id });
      const modelDurationMs = now() - modelStartedAt;

      if (result.status === 'completed') {
        await updateJobObserved({
          status: 'completed', current_step: 'done',
          analysis_run_id: result.analysisRunId,
          completed_at: new Date(now()).toISOString(),
        });
        await appendEvent({
          tenderId, eventType: 'analysis_completed', actorKind: 'agent',
          sourceRefType: 'analysis_run', sourceRefId: result.analysisRunId,
        });
        observability.record('model_invocation_completed', {
          job_id: jobId, tender_id: tenderId, opportunity_id: opportunityId,
          analysis_run_id: result.analysisRunId, duration_ms: modelDurationMs,
        });
        observability.record('canonical_run_recorded', {
          job_id: jobId, tender_id: tenderId, opportunity_id: opportunityId, analysis_run_id: result.analysisRunId,
        });
        observability.record('outcome_recorded', { job_id: jobId, tender_id: tenderId, stage: 'request_agt002', outcome: 'completed' });
        return finishStage('request_agt002', 'completed', { status: 'completed', job_id: jobId });
      }

      if (result.status === 'quota' || result.status === 'saturated' || result.status === 'busy' || result.status === 'unavailable') {
        observability.record('model_unavailable', { job_id: jobId, tender_id: tenderId, opportunity_id: opportunityId, reason: result.status });
        const nextAttempt = (claim.attempt_count || 0) + 1;
        const errorCode = `AGT002_${result.status.toUpperCase()}`;
        if (nextAttempt >= MAX_ATTEMPTS) {
          await updateJobObserved({
            status: 'needs_attention', current_step: 'analysis', attempt_count: nextAttempt,
            next_attempt_at: null, last_error_code: `${errorCode}_MAX_ATTEMPTS`,
            last_error_message: `Capacidad AGT-002 no disponible tras ${nextAttempt} intentos`,
          });
          await appendEvent({
            tenderId, eventType: 'analysis_failed', actorKind: 'system',
            sourceRefType: 'job', sourceRefId: jobId,
          });
          observability.record('outcome_recorded', {
            job_id: jobId, tender_id: tenderId, stage: 'request_agt002', outcome: 'needs_attention',
            error_code: `${errorCode}_MAX_ATTEMPTS`,
          });
          return finishStage('request_agt002', 'needs_attention', { status: 'needs_attention', job_id: jobId, reason: result.status });
        }
        observability.record('retry_scheduled', {
          job_id: jobId, tender_id: tenderId, stage: 'request_agt002', attempt_count: nextAttempt, reason: result.status,
        });
        await updateJobObserved({
          status: 'waiting_agent_capacity', current_step: 'analysis', attempt_count: nextAttempt,
          next_attempt_at: new Date(now() + computeBackoffMs({ attempt: nextAttempt })).toISOString(),
        });
        return finishStage('request_agt002', 'waiting_agent_capacity', { status: 'waiting_agent_capacity', job_id: jobId, reason: result.status });
      }

      if (result.status === 'rules_fallback') {
        // No fallback silencioso: un preanálisis por reglas nunca completa el
        // paso AGT-002; el job permanece esperando capacidad real.
        observability.record('model_unavailable', { job_id: jobId, tender_id: tenderId, opportunity_id: opportunityId, reason: 'rules_fallback' });
        await updateJobObserved({ status: 'waiting_agent_capacity', current_step: 'analysis' });
        await appendEvent({
          tenderId, eventType: 'analysis_rules_fallback_shown', actorKind: 'system',
          sourceRefType: 'job', sourceRefId: jobId,
        });
        return finishStage('request_agt002', 'waiting_agent_capacity', { status: 'waiting_agent_capacity', job_id: jobId, reason: 'rules_fallback' });
      }

      const classification = classifyPipelineError(result.error || {});
      const bounded = toBoundedAgt002Error(result.error || {});
      if (classification === 'retryable') {
        const nextAttempt = (claim.attempt_count || 0) + 1;
        if (nextAttempt < MAX_ATTEMPTS) {
          observability.record('retry_scheduled', {
            job_id: jobId, tender_id: tenderId, stage: 'request_agt002', attempt_count: nextAttempt, reason: 'retryable_error',
          });
          await updateJobObserved({
            status: 'waiting_agent_capacity', current_step: 'analysis',
            attempt_count: nextAttempt,
            next_attempt_at: new Date(now() + computeBackoffMs({ attempt: nextAttempt })).toISOString(),
          });
          return finishStage('request_agt002', 'waiting_agent_capacity', { status: 'waiting_agent_capacity', job_id: jobId, reason: 'retry' });
        }

        await updateJobObserved({
          status: 'needs_attention', current_step: 'analysis', attempt_count: nextAttempt,
          next_attempt_at: null,
          last_error_code: `${result.error?.code || 'AGT002_RETRY'}_MAX_ATTEMPTS`,
          last_error_message: safeMessage(result.error || {}),
        });
        await appendEvent({
          tenderId, eventType: 'analysis_failed', actorKind: 'system',
          sourceRefType: 'job', sourceRefId: jobId,
        });
        observability.record('outcome_recorded', {
          job_id: jobId, tender_id: tenderId, stage: 'request_agt002', outcome: 'needs_attention', ...bounded,
        });
        return finishStage('request_agt002', 'needs_attention', { status: 'needs_attention', job_id: jobId });
      }

      await updateJobObserved({
        status: 'needs_attention', current_step: 'analysis',
        last_error_code: result.error?.code || null,
        last_error_message: safeMessage(result.error || {}),
      });
      await appendEvent({
        tenderId, eventType: 'analysis_failed', actorKind: 'system',
        sourceRefType: 'job', sourceRefId: jobId,
      });
      observability.record('outcome_recorded', {
        job_id: jobId, tender_id: tenderId, stage: 'request_agt002', outcome: 'needs_attention', ...bounded,
      });
      return finishStage('request_agt002', 'needs_attention', { status: 'needs_attention', job_id: jobId });
    }

    return finishStage('noop', 'noop', { status: 'noop', job_id: jobId });
  }

  return { runOnce };
}
