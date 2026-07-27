// Sanitized structured logging, same pattern as agt002-hetzner-bridge-log.js:
// only an explicit whitelist of safe keys is ever emitted; anything else
// (documents, prompts, HMAC, tokens, extracted_text, raw provider result)
// is silently dropped rather than trusted to be safe.
const SAFE_KEYS = [
  'correlation_id', 'job_id', 'tender_id', 'code', 'status', 'current_step',
  'latency_ms', 'attempt_count',
  'documents_discovered', 'documents_processed', 'documents_imported', 'documents_unchanged', 'documents_failed',
];

export function logPipelineEvent(event, fields = {}) {
  const sanitized = { event };
  for (const key of SAFE_KEYS) {
    if (Object.hasOwn(fields, key)) sanitized[key] = fields[key];
  }
  console.log(JSON.stringify(sanitized));
}

const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

// Minimal metrics from spec §14: jobs by state/age, expired leases,
// AGT-002-vs-rules ratio, and analysis runs stale against current_snapshot_id.
export function deriveJobMetrics(jobs, now) {
  const byStatus = {};
  const activeJobs = [];
  let leaseExpiredCount = 0;
  let agt002RunCount = 0;
  let rulesRunCount = 0;
  let automaticRulesFallbackCount = 0;
  const staleAnalysisJobIds = [];

  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] || 0) + 1;

    if (job.lease_expires_at && new Date(job.lease_expires_at).getTime() < now) {
      leaseExpiredCount += 1;
    }

    if (job.analysis_producer === 'AGT-002') agt002RunCount += 1;
    else if (job.analysis_producer === 'siio_rules_v1' || job.analysis_producer === 'rules') rulesRunCount += 1;

    if (job.automatic && job.fallback_shown) automaticRulesFallbackCount += 1;

    if (job.analysis_run_snapshot_id && job.current_snapshot_id
      && job.analysis_run_snapshot_id !== job.current_snapshot_id) {
      staleAnalysisJobIds.push(job.id);
    }

    if (!TERMINAL_STATUSES.has(job.status)) {
      const createdAt = job.created_at ? new Date(job.created_at).getTime() : now;
      activeJobs.push({ id: job.id, status: job.status, age_ms: Math.max(0, now - createdAt) });
    }
  }

  return {
    by_status: byStatus,
    lease_expired_count: leaseExpiredCount,
    agt002_run_count: agt002RunCount,
    rules_run_count: rulesRunCount,
    automatic_rules_fallback_count: automaticRulesFallbackCount,
    stale_analysis_job_ids: staleAnalysisJobIds,
    active_jobs: activeJobs,
    total_jobs: jobs.length,
  };
}

// Alerts are only ever raised from explicit metrics/thresholds, never
// inferred: a caller must state expectingAgt002Runs/bridgeHealthy for those
// alerts to fire, rather than the module guessing what "healthy" means.
export function pipelineAlerts(metrics, thresholds = {}) {
  const alerts = [];

  const stalledAgeMs = thresholds.stalledJobAgeMs ?? Infinity;
  const stalled = (metrics.active_jobs || []).filter(job => job.age_ms > stalledAgeMs);
  if (stalled.length > 0) {
    alerts.push({ type: 'stalled_job', job_ids: stalled.map(job => job.id) });
  }

  const needsAttentionCount = metrics.by_status?.needs_attention || 0;
  if (needsAttentionCount > 0) {
    alerts.push({ type: 'needs_attention', count: needsAttentionCount });
  }

  if (thresholds.bridgeHealthy === false) {
    alerts.push({ type: 'bridge_unhealthy' });
  }

  if (thresholds.expectingAgt002Runs && (metrics.agt002_run_count || 0) === 0) {
    alerts.push({ type: 'zero_agt002_runs' });
  }

  if ((metrics.automatic_rules_fallback_count || 0) > 0) {
    alerts.push({ type: 'rules_fallback_in_auto', count: metrics.automatic_rules_fallback_count });
  }

  if ((metrics.stale_analysis_job_ids || []).length > 0) {
    alerts.push({ type: 'stale_analysis', job_ids: metrics.stale_analysis_job_ids });
  }

  return alerts;
}
