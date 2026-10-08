import { buildAgt002IncrementalAnalysisInput, validateAgt002IncrementalDeltaManifest } from './agt002-incremental-analysis-input.js';
import { dispatchAgt002IncrementalChangeSet } from './agt002-incremental-reanalysis-triggers.js';

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} es obligatorio para el despacho incremental.`);
  return value;
}

/**
 * Seals the event-to-job boundary without inheriting the full-document reanalysis input.
 * All reads are server-owned callbacks; no client-supplied document list can reach the queue.
 */
export async function dispatchAgt002IncrementalAnalysis(database, {
  manifest,
  snapshotId,
  actorProfileId,
  loadChangedEvidence,
  loadPriorFindings,
  enqueueIncrementalJob,
  wakeWorker = null,
}) {
  const frozenManifest = validateAgt002IncrementalDeltaManifest(manifest);
  if (typeof snapshotId !== 'string' || !snapshotId.trim()) throw new Error('El snapshot incremental es obligatorio.');
  if (typeof actorProfileId !== 'string' || !actorProfileId.trim()) throw new Error('El actor de despacho incremental es obligatorio.');
  const changedEvidence = await requiredFunction(loadChangedEvidence, 'El resolvedor de evidencia cambiada')(frozenManifest);
  const priorFindings = await requiredFunction(loadPriorFindings, 'El resolvedor de hallazgos previos')(frozenManifest);
  const incrementalInput = buildAgt002IncrementalAnalysisInput({
    manifest: frozenManifest,
    changedEvidence,
    priorFindings,
    snapshotId,
  });
  const queued = await requiredFunction(enqueueIncrementalJob, 'El encolador incremental')({
    manifest: frozenManifest,
    incrementalInput,
    snapshotId,
    actorProfileId,
  });
  if (typeof queued?.job_id !== 'string' || !queued.job_id.trim()) {
    throw new Error('El despacho incremental no obtuvo un job durable nuevo o existente.');
  }
  const linked = await dispatchAgt002IncrementalChangeSet(database, {
    changeSetId: frozenManifest.change_set_id,
    jobId: queued.job_id,
    manifestHash: frozenManifest.manifest_hash,
  });
  let workerWake = { status: 'disabled' };
  if (wakeWorker != null) {
    try {
      workerWake = await requiredFunction(wakeWorker, 'El despertador dirigido por evento')({
        jobId: queued.job_id,
        changeSetId: frozenManifest.change_set_id,
      });
    } catch {
      // The durable job and set link already committed. A transport wake failure must not
      // undo or duplicate either; the single conditional daily recovery wake owns recovery.
      workerWake = { status: 'failed' };
    }
  }
  return Object.freeze({
    status: linked.status === 'existing' ? 'existing' : 'dispatched',
    change_set_id: frozenManifest.change_set_id,
    job_id: queued.job_id,
    worker_wake: workerWake?.status || 'unknown',
  });
}

export function projectAgt002PriorFindings(result) {
  const candidates = Array.isArray(result?.findings)
    ? result.findings
    : Array.isArray(result?.integral_analysis?.findings)
      ? result.integral_analysis.findings
      : Array.isArray(result?.integral_analysis?.analysis_units)
        ? result.integral_analysis.analysis_units
      : [];
  return candidates.map((finding, index) => ({
    ...finding,
    finding_ref: String(finding?.finding_ref || finding?.id || finding?.finding_id || finding?.claim_id
      || finding?.unit_id || finding?.requirement_id || `prior-finding-${index + 1}`),
  }));
}
