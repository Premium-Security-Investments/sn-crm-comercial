// Safe, structured operational metrics for the AGT-002 / Vig-IA durable
// pipeline (conversion -> job -> claim -> snapshot -> agent -> run). Every
// event type below has a closed field allowlist: only fields in that list are
// ever emitted, and only after being sanitized (scalars only, bounded
// length). This is the single choke point new instrumentation must go
// through, so no call site can accidentally leak document/chunk text, full
// prompts or model responses, credentials, connection strings, auth headers,
// or unbounded error text.
const MAX_STRING_LENGTH = 200;
const MAX_ERROR_MESSAGE_LENGTH = 160;
const MAX_ERROR_CODE_LENGTH = 64;

// Matches long opaque-looking tokens (API keys, bearer tokens, hashes) so a
// raw error message that happens to embed one never reaches a log sink.
const OPAQUE_TOKEN_PATTERN = /[A-Za-z0-9_\-]{24,}/g;

export const AGT002_OBSERVABILITY_EVENT_FIELDS = Object.freeze({
  conversion_dispatched: Object.freeze([
    'job_id', 'tender_id', 'opportunity_id', 'dispatch_status', 'worker_status', 'error_code', 'duration_ms',
  ]),
  job_created: Object.freeze(['job_id', 'tender_id', 'opportunity_id', 'status']),
  job_claimed: Object.freeze(['job_id', 'tender_id', 'opportunity_id', 'pipeline_status', 'current_step', 'attempt_count']),
  first_claim_latency: Object.freeze(['job_id', 'tender_id', 'latency_ms']),
  lease_claimed: Object.freeze(['job_id', 'tender_id']),
  lease_renewed: Object.freeze(['job_id', 'tender_id']),
  lease_released: Object.freeze(['job_id', 'tender_id']),
  lease_expired: Object.freeze(['job_id', 'tender_id']),
  snapshot_published: Object.freeze(['job_id', 'tender_id', 'opportunity_id', 'snapshot_id']),
  document_coverage: Object.freeze([
    'job_id', 'tender_id', 'opportunity_id', 'snapshot_id', 'documents_total', 'chunks_total', 'gaps_total',
  ]),
  model_invocation_started: Object.freeze(['job_id', 'tender_id', 'opportunity_id']),
  model_invocation_completed: Object.freeze(['job_id', 'tender_id', 'opportunity_id', 'analysis_run_id', 'duration_ms']),
  model_unavailable: Object.freeze(['job_id', 'tender_id', 'opportunity_id', 'reason']),
  canonical_run_recorded: Object.freeze(['job_id', 'tender_id', 'opportunity_id', 'analysis_run_id', 'reused']),
  reanalysis_triggered: Object.freeze(['opportunity_id', 'tender_id', 'analysis_run_id', 'context_version_id', 'status']),
  retry_scheduled: Object.freeze(['job_id', 'tender_id', 'stage', 'attempt_count', 'count', 'reason']),
  outcome_recorded: Object.freeze(['job_id', 'tender_id', 'stage', 'outcome', 'error_code', 'error_message']),
  stage_duration: Object.freeze(['job_id', 'tender_id', 'stage', 'outcome', 'duration_ms']),
});

export const AGT002_OBSERVABILITY_EVENT_TYPES = Object.freeze(Object.keys(AGT002_OBSERVABILITY_EVENT_FIELDS));

/** First line only (drops stack traces), opaque tokens redacted, hard length cap. */
export function boundAgt002ErrorMessage(message) {
  const text = typeof message === 'string' ? message : '';
  const firstLine = text.split('\n')[0];
  const redacted = firstLine.replace(OPAQUE_TOKEN_PATTERN, '[redactado]');
  return redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

/** Only a short uppercase/underscore category code survives; anything else collapses to a fixed fallback. */
export function boundAgt002ErrorCode(code) {
  const text = typeof code === 'string' ? code.trim() : '';
  const safe = /^[A-Z0-9_]+$/.test(text) ? text : 'UNKNOWN_ERROR';
  return safe.slice(0, MAX_ERROR_CODE_LENGTH);
}

/** Bounded {error_code, error_message} pair, safe to attach to any event. */
export function toBoundedAgt002Error(error) {
  return {
    error_code: boundAgt002ErrorCode(error?.code),
    error_message: boundAgt002ErrorMessage(error?.message),
  };
}

function sanitizeAgt002FieldValue(key, value) {
  if (value === null || value === undefined) return undefined;
  if (key === 'error_message') return boundAgt002ErrorMessage(value);
  if (key === 'error_code') return boundAgt002ErrorCode(value);
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  // Objects, arrays, functions, symbols, etc. are never safe to forward
  // (they are exactly how document text or full payloads would leak in).
  return undefined;
}

function defaultAgt002ObservabilityEmit(record) {
  console.warn(record.event, record);
}

/**
 * Creates the one recorder every AGT-002 pipeline call site should use to
 * report structured, safe metrics. `emit` defaults to console.warn (matching
 * this codebase's existing structured-log convention); tests inject a spy.
 */
export function createAgt002AnalysisObservability({ emit = defaultAgt002ObservabilityEmit, now = () => Date.now() } = {}) {
  function record(eventType, fields = {}) {
    const allowlist = AGT002_OBSERVABILITY_EVENT_FIELDS[eventType];
    if (!allowlist) throw new Error(`agt002-analysis-observability: unknown event type "${eventType}"`);
    const safeRecord = { event: eventType, at: now() };
    for (const key of allowlist) {
      const value = sanitizeAgt002FieldValue(key, fields[key]);
      if (value !== undefined) safeRecord[key] = value;
    }
    emit(safeRecord);
    return safeRecord;
  }

  return Object.freeze({ record, now, eventTypes: AGT002_OBSERVABILITY_EVENT_TYPES });
}

/** Elapsed-time helper for per-stage duration metrics; independent from any single event's own `now`. */
export function startAgt002StageTimer(now = () => Date.now()) {
  const startedAt = now();
  return { elapsedMs: () => Math.max(0, now() - startedAt) };
}
