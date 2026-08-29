import { isAgt002PreviewReasoningEffort } from './agt002-preview-reasoning-effort.js';

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
const MAX_VALIDATION_CODE_LENGTH = 64;

// Matches long opaque-looking tokens (API keys, bearer tokens, hashes) so a
// raw error message that happens to embed one never reaches a log sink.
const OPAQUE_TOKEN_PATTERN = /[A-Za-z0-9_\-]{24,}/g;

// AGT-002 Preview (E5): the four points in agt002-preview-engine.js where a model output is
// rejected before it can ever reach a caller. Exported so the engine is the only place that
// picks a stage literal, never a free-form string from elsewhere.
export const AGT002_OUTPUT_REJECTION_STAGES = Object.freeze({
  CONTENT_EXTRACTION: 'content_extraction',
  JSON_PARSE: 'json_parse',
  SEMANTIC_VALIDATION: 'semantic_validation',
  USAGE: 'usage',
  ENVELOPE: 'envelope',
});

// Closed execution stages for the authenticated canonical preview route. These
// labels describe control-flow boundaries only; they never contain document,
// prompt, policy, provider-response, or free-form error content.
export const AGT002_CANONICAL_PREVIEW_STAGES = Object.freeze({
  RUNTIME_CONFIG: 'runtime_config',
  LEGAL_CORPUS: 'legal_corpus',
  CONTEXT_VERSION: 'context_version',
  CLAIM: 'claim',
  GOVERNANCE: 'governance',
  RUNTIME_CREATION: 'runtime_creation',
  ENGINE_ANALYSIS: 'engine_analysis',
  PERSISTENCE: 'persistence',
});

// Closed frontier catalog for AGT-002 post-bridge observability (reanalyzeAgt002AfterHumanAnswer
// and any equivalent post-bridge caller): every point after a bridge call resolves where the
// outcome can be attributed unambiguously. Owned here (not in agt002-post-bridge-observability.js)
// so it sits alongside AGT002_OUTPUT_REJECTION_STAGES/AGT002_CANONICAL_PREVIEW_STAGES as one
// single source of truth for closed stage literals; agt002-post-bridge-observability.js re-exports
// it for callers that only need the post-bridge slice.
export const AGT002_POST_BRIDGE_STAGES = Object.freeze({
  TRANSPORT: 'transport',
  RESPONSE_RECEIVED: 'response_received',
  CONTENT_EXTRACTION: 'content_extraction',
  JSON_PARSE: 'json_parse',
  MODEL_OUTPUT_VALIDATION: 'model_output_validation',
  ENVELOPE_BUILD: 'envelope_build',
  INTEGRAL_V3_VALIDATION: 'integral_v3_validation',
  PERSISTENCE: 'persistence',
  ATTEMPT_UPDATE: 'attempt_update',
  RESPONSE_SERIALIZATION: 'response_serialization',
  UNEXPECTED: 'unexpected',
});

// Closed sanitary error codes for the same post-bridge frontier — never a raw upstream
// message/code, always one of these. Each stage above has at least one dedicated code.
export const AGT002_POST_BRIDGE_ERROR_CODES = Object.freeze({
  TRANSPORT_ERROR: 'AGT002_TRANSPORT_ERROR',
  PROVIDER_ERROR: 'AGT002_PROVIDER_ERROR',
  CONTENT_EXTRACTION_FAILED: 'AGT002_CONTENT_EXTRACTION_FAILED',
  JSON_PARSE_FAILED: 'AGT002_JSON_PARSE_FAILED',
  MODEL_OUTPUT_INVALID: 'AGT002_MODEL_OUTPUT_INVALID',
  ENVELOPE_INVALID: 'AGT002_ENVELOPE_INVALID',
  INTEGRAL_V3_INVALID: 'AGT002_INTEGRAL_V3_INVALID',
  PERSISTENCE_FAILED: 'AGT002_PERSISTENCE_FAILED',
  ATTEMPT_UPDATE_FAILED: 'AGT002_ATTEMPT_UPDATE_FAILED',
  RESPONSE_SERIALIZATION_FAILED: 'AGT002_RESPONSE_SERIALIZATION_FAILED',
  UNEXPECTED_ERROR: 'AGT002_UNEXPECTED_ERROR',
});

const CONTENT_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const VALIDATION_CODE_PATTERN = /^[a-z0-9_]+$/;

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
  // AGT-002 Preview (E5): a model output was rejected. Deliberately excludes error_code /
  // error_message (or any content/prompt-shaped field) — the point of this event is to make a
  // rejection diagnosable from *structure* (stage, a closed validation_code, a content hash/size,
  // token counts) without ever needing, and therefore never risking, the raw content or the
  // validator's own message text.
  output_rejected: Object.freeze([
    'stage', 'validation_code', 'content_sha256', 'content_bytes', 'snapshot_id', 'input_tokens', 'output_tokens', 'effort',
  ]),
  canonical_preview_unavailable: Object.freeze([
    'correlation_id', 'stage', 'error_code', 'bridge_invocation_started', 'duration_ms',
    'opportunity_id', 'tender_id', 'snapshot_id',
  ]),
  // AGT-002 post-bridge observability (reanalyzeAgt002AfterHumanAnswer and any equivalent
  // post-human-answer caller): the single outcome event runAgt002PostBridgeAnalysis emits per
  // run, whether it completes or ends unavailable. `stage`/`error_code` are restricted below to
  // AGT002_POST_BRIDGE_STAGES/AGT002_POST_BRIDGE_ERROR_CODES members only — never prompt, raw
  // model output, documents/evidence, headers, secrets, a stack, or an arbitrary message.
  reanalysis_post_bridge_outcome: Object.freeze([
    'correlation_id', 'stage', 'error_code', 'bridge_invocation_started', 'bridge_response_received',
    'context_version_id', 'opportunity_id', 'tender_id', 'snapshot_id', 'duration_ms',
  ]),
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

/** Only a short lowercase/underscore classification code survives; anything else collapses to a fixed fallback. */
export function boundAgt002ValidationCode(code) {
  const text = typeof code === 'string' ? code.trim() : '';
  const safe = VALIDATION_CODE_PATTERN.test(text) ? text : 'unknown_validation_code';
  return safe.slice(0, MAX_VALIDATION_CODE_LENGTH);
}

const AGT002_CANONICAL_PREVIEW_STAGE_VALUES = new Set(Object.values(AGT002_CANONICAL_PREVIEW_STAGES));
const AGT002_POST_BRIDGE_STAGE_VALUES = new Set(Object.values(AGT002_POST_BRIDGE_STAGES));
const AGT002_POST_BRIDGE_ERROR_CODE_VALUES = new Set(Object.values(AGT002_POST_BRIDGE_ERROR_CODES));

function sanitizeAgt002FieldValue(eventType, key, value) {
  if (value === null || value === undefined) return undefined;
  if (eventType === 'canonical_preview_unavailable' && key === 'stage') {
    return AGT002_CANONICAL_PREVIEW_STAGE_VALUES.has(value) ? value : undefined;
  }
  // Closed twice over for this event: only a real AGT002_POST_BRIDGE_STAGES/ERROR_CODES member
  // ever survives — a mismatched or unrecognized value collapses to the safe unexpected members
  // rather than being dropped, so a bug upstream can never silently produce a stage-less event.
  if (eventType === 'reanalysis_post_bridge_outcome' && key === 'stage') {
    return AGT002_POST_BRIDGE_STAGE_VALUES.has(value) ? value : AGT002_POST_BRIDGE_STAGES.UNEXPECTED;
  }
  if (eventType === 'reanalysis_post_bridge_outcome' && key === 'error_code') {
    return AGT002_POST_BRIDGE_ERROR_CODE_VALUES.has(value) ? value : AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR;
  }
  if (key === 'error_message') return boundAgt002ErrorMessage(value);
  if (key === 'error_code') return boundAgt002ErrorCode(value);
  if (key === 'validation_code') return boundAgt002ValidationCode(value);
  // Closed allowlist, never free text: only a real AGT-002 reasoning-effort level survives.
  if (key === 'effort') return isAgt002PreviewReasoningEffort(value) ? value : undefined;
  // content_sha256 is only ever a digest this codebase computed itself (never a raw string
  // handed through as-is): anything that is not already a well-formed 64-hex digest is dropped
  // rather than forwarded, so a coding mistake elsewhere can never smuggle raw content through
  // this field.
  if (key === 'content_sha256') return typeof value === 'string' && CONTENT_SHA256_PATTERN.test(value) ? value : undefined;
  if (key === 'input_tokens' || key === 'output_tokens' || key === 'content_bytes') {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
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
      const value = sanitizeAgt002FieldValue(eventType, key, fields[key]);
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
