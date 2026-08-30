// AGT-002 durable persistence retry frontier.
//
// Scope, strictly: given a persistence failure that ALREADY happened, decide (a) which CLOSED,
// sanitized subcode names it and (b) whether it is one of a tight allowlist of truly transient
// database/network frontiers worth re-attempting IN MEMORY against the exact same, already
// validated envelope. This module never touches the engine, the bridge, the provider, a prompt,
// a document, an envelope or any payload: its only input is an Error's STRUCTURAL metadata
// (agt002-preview-persistence.js's `rpc_sqlstate`, or a Node/undici transport `code`), never its
// `.message`, and its only output is a member of the closed catalogs below.
//
// Why the allowlist is stated as SQLSTATEs and transport codes rather than "not a validation
// error": fail-closed. Anything this module does not explicitly name — an unknown SQLSTATE, a
// future PostgREST code, a semantic/constraint/idempotency rejection, or an error carrying no
// structural metadata at all (which is exactly what every pre-RPC JS validation throw in
// agt002-preview-persistence.js looks like) — is NOT retryable. Silence means "do not retry".
//
// Retry safety depends on the RPC itself, not on this module: both
// psi_record_agt002_canonical_analysis_run and psi_record_tender_analysis_run short-circuit on an
// already-recorded p_idempotency_key and return the existing run instead of writing a second one
// (see supabase/migrations/067_agt002_integral_v3_persistence.sql). A re-attempt under the SAME
// recomputed idempotency key is therefore either a rollback replay or an idempotent read — never
// a duplicate canonical run.

/**
 * Closed, sanitized persistence subcodes. These are the ONLY values that may ever be persisted in
 * a durable attempt row or emitted to an observability sink for a persistence failure — never a
 * raw DB message, never `details`/`hint`, never a payload. Lowercase snake_case so they satisfy
 * agt002-analysis-observability.js's validation-code shape as well.
 */
export const AGT002_PERSISTENCE_SUBCODES = Object.freeze({
  STATEMENT_TIMEOUT: 'persistence_statement_timeout',
  LOCK_TIMEOUT: 'persistence_lock_timeout',
  SERIALIZATION_FAILURE: 'persistence_serialization_failure',
  DEADLOCK_DETECTED: 'persistence_deadlock_detected',
  CONNECTION_FAILURE: 'persistence_connection_failure',
  INSUFFICIENT_RESOURCES: 'persistence_insufficient_resources',
  NETWORK_FAILURE: 'persistence_network_failure',
  IDEMPOTENCY_CONFLICT: 'persistence_idempotency_conflict',
  CONSTRAINT_VIOLATION: 'persistence_constraint_violation',
  INVALID_INPUT: 'persistence_invalid_input',
  REFERENCE_NOT_FOUND: 'persistence_reference_not_found',
  PERMISSION_DENIED: 'persistence_permission_denied',
  // An RPC really did reject, with a SQLSTATE-shaped code this module deliberately does not name.
  SQL_ERROR: 'persistence_sql_error',
  // No structural metadata at all: a pre-RPC JS validation throw, or any other non-RPC failure.
  UNCLASSIFIED: 'persistence_unclassified',
});

export const AGT002_PERSISTENCE_SUBCODE_VALUES = Object.freeze(Object.values(AGT002_PERSISTENCE_SUBCODES));
const AGT002_PERSISTENCE_SUBCODE_SET = new Set(AGT002_PERSISTENCE_SUBCODE_VALUES);

// SQLSTATE -> subcode. Exact codes only; there is deliberately no prefix/class fallback, so a
// code this table does not list resolves to SQL_ERROR and is never retried.
const SQLSTATE_SUBCODES = Object.freeze({
  '57014': AGT002_PERSISTENCE_SUBCODES.STATEMENT_TIMEOUT, // query_canceled (statement_timeout)
  '55P03': AGT002_PERSISTENCE_SUBCODES.LOCK_TIMEOUT, // lock_not_available (lock_timeout)
  '40001': AGT002_PERSISTENCE_SUBCODES.SERIALIZATION_FAILURE,
  '40P01': AGT002_PERSISTENCE_SUBCODES.DEADLOCK_DETECTED,
  '08000': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE,
  '08001': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE,
  '08003': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE,
  '08004': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE,
  '08006': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE,
  '08007': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE,
  '08P01': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE,
  '57P01': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE, // admin_shutdown
  '57P02': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE, // crash_shutdown
  '57P03': AGT002_PERSISTENCE_SUBCODES.CONNECTION_FAILURE, // cannot_connect_now
  '53300': AGT002_PERSISTENCE_SUBCODES.INSUFFICIENT_RESOURCES, // too_many_connections
  '23505': AGT002_PERSISTENCE_SUBCODES.IDEMPOTENCY_CONFLICT,
  '23503': AGT002_PERSISTENCE_SUBCODES.CONSTRAINT_VIOLATION,
  '23502': AGT002_PERSISTENCE_SUBCODES.CONSTRAINT_VIOLATION,
  '23514': AGT002_PERSISTENCE_SUBCODES.CONSTRAINT_VIOLATION,
  '22023': AGT002_PERSISTENCE_SUBCODES.INVALID_INPUT,
  P0002: AGT002_PERSISTENCE_SUBCODES.REFERENCE_NOT_FOUND,
  '42501': AGT002_PERSISTENCE_SUBCODES.PERMISSION_DENIED,
});

/**
 * The ONLY SQLSTATEs a persistence attempt is ever re-attempted for. Every one of them aborts its
 * transaction server-side (or never opened one), so the reserved idempotency key is left unwritten
 * and a replay recomputes to exactly the same identity.
 *
 * Deliberately absent: 40003 (statement_completion_unknown). It is genuinely ambiguous about
 * whether the statement committed, and this module refuses to retry on an ambiguity even though
 * the RPC's own idempotency short-circuit would tolerate it — unknown means do not retry.
 */
export const AGT002_RETRYABLE_PERSISTENCE_SQLSTATES = Object.freeze([
  '57014', '55P03', '40001', '40P01',
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
  '57P01', '57P02', '57P03', '53300',
]);
const RETRYABLE_SQLSTATE_SET = new Set(AGT002_RETRYABLE_PERSISTENCE_SQLSTATES);

/**
 * Transport-level codes (Node syscall names and undici's own) that mean the HTTP call to PostgREST
 * never completed. Read from `error.code` or `error.cause.code` — the shape Node's fetch uses for
 * a "fetch failed" TypeError. ENOTFOUND is deliberately absent: a permanently wrong host must fail
 * closed, not spin.
 */
export const AGT002_RETRYABLE_PERSISTENCE_TRANSPORT_CODES = Object.freeze([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
const RETRYABLE_TRANSPORT_CODE_SET = new Set(AGT002_RETRYABLE_PERSISTENCE_TRANSPORT_CODES);

/** Only a member of the closed catalog survives; anything else collapses to null. */
export function safeAgt002PersistenceSubcode(subcode) {
  return typeof subcode === 'string' && AGT002_PERSISTENCE_SUBCODE_SET.has(subcode) ? subcode : null;
}

/**
 * Classifies an already-thrown persistence error from its STRUCTURAL metadata only.
 *
 * SQLSTATE is read exclusively from `rpc_sqlstate` — a property only
 * agt002-preview-persistence.js's unwrapRpc ever sets, and only from a real Supabase/PostgREST
 * error object. It is never read from `.code`, so an engine/provider error, a hand-built Error, or
 * any other code-carrying object can never be mistaken for a transient database frontier.
 *
 * @param {unknown} error
 * @returns {{subcode: string, sqlstate: (string|null), retryable: boolean}} `subcode` is always a
 *   closed catalog member; `sqlstate` is the raw five-to-ten character SQLSTATE-shaped code when
 *   one was present (safe: it is a fixed ANSI/PostgreSQL category, never message text).
 */
export function classifyAgt002PersistenceError(error) {
  const sqlstate = typeof error?.rpc_sqlstate === 'string' ? error.rpc_sqlstate : null;
  if (sqlstate) {
    return Object.freeze({
      // Own properties only: a SQLSTATE-shaped string like 'toString' or 'valueOf' must resolve to
      // SQL_ERROR, never to something inherited from Object.prototype.
      subcode: Object.hasOwn(SQLSTATE_SUBCODES, sqlstate) ? SQLSTATE_SUBCODES[sqlstate] : AGT002_PERSISTENCE_SUBCODES.SQL_ERROR,
      sqlstate,
      retryable: RETRYABLE_SQLSTATE_SET.has(sqlstate),
    });
  }
  const transportCode = typeof error?.code === 'string' ? error.code
    : typeof error?.cause?.code === 'string' ? error.cause.code
      : null;
  if (transportCode && RETRYABLE_TRANSPORT_CODE_SET.has(transportCode)) {
    return Object.freeze({ subcode: AGT002_PERSISTENCE_SUBCODES.NETWORK_FAILURE, sqlstate: null, retryable: true });
  }
  return Object.freeze({ subcode: AGT002_PERSISTENCE_SUBCODES.UNCLASSIFIED, sqlstate: null, retryable: false });
}

/**
 * Defaults sized against the durable job's own lease budget. agt002-reanalysis-input.js funds a
 * claim of `2*ceil(timeout_ms/1000) + 30` seconds; the trailing 30s is the executor's entire
 * post-bridge buffer, which already has to cover persistence, the durable attempt write, the claim
 * release and the queue transition. ONE extra persistence attempt is therefore the whole retry
 * budget: it recovers the single-blip frontier without ever being able to spend the buffer twice
 * over. `deadlineAt`, when a caller supplies one, is the hard lease guard on top of that.
 */
export const AGT002_PERSISTENCE_RETRY_DEFAULTS = Object.freeze({
  maxAttempts: 2,
  baseDelayMs: 250,
  maxDelayMs: 1000,
  budgetMs: 6000,
});

// Hard ceilings no caller/config can raise. A misconfigured override must never be able to turn a
// bounded in-lease retry into an unbounded one.
const MAX_ALLOWED_ATTEMPTS = 3;
const MAX_ALLOWED_DELAY_MS = 2000;
const MAX_ALLOWED_BUDGET_MS = 15_000;

/** Out-of-range and non-integer alike fall back to the DEFAULT, never to the ceiling: an override
 * asking for more than the frontier allows is a config error, and quietly granting it the maximum
 * would be the least safe reading of it. */
function boundedInteger(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/**
 * Normalizes caller overrides into a frozen, bounded policy. Never throws and never trusts an
 * override: any missing, non-integer or out-of-range field degrades to its safe default rather
 * than failing the run or widening the frontier.
 */
export function resolveAgt002PersistenceRetryPolicy(overrides = null) {
  const source = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
  const baseDelayMs = boundedInteger(source.baseDelayMs, AGT002_PERSISTENCE_RETRY_DEFAULTS.baseDelayMs, 0, MAX_ALLOWED_DELAY_MS);
  const maxDelayMs = boundedInteger(source.maxDelayMs, AGT002_PERSISTENCE_RETRY_DEFAULTS.maxDelayMs, baseDelayMs, MAX_ALLOWED_DELAY_MS);
  return Object.freeze({
    maxAttempts: boundedInteger(source.maxAttempts, AGT002_PERSISTENCE_RETRY_DEFAULTS.maxAttempts, 1, MAX_ALLOWED_ATTEMPTS),
    baseDelayMs,
    maxDelayMs: Math.max(baseDelayMs, maxDelayMs),
    budgetMs: boundedInteger(source.budgetMs, AGT002_PERSISTENCE_RETRY_DEFAULTS.budgetMs, 0, MAX_ALLOWED_BUDGET_MS),
    // Absolute epoch ms after which no further attempt may START. Supplied by a caller that knows
    // the real lease (agt002-reanalysis-executor.js); null for callers that do not.
    deadlineAt: Number.isFinite(source.deadlineAt) ? source.deadlineAt : null,
  });
}

/** Exponential backoff for retry #`retryIndex` (0-based), clamped by the resolved policy. */
export function agt002PersistenceRetryDelayMs(retryIndex, policy) {
  const index = Number.isInteger(retryIndex) && retryIndex >= 0 ? retryIndex : 0;
  const raw = policy.baseDelayMs * (2 ** Math.min(index, 10));
  return Math.min(policy.maxDelayMs, raw);
}

/**
 * The single decision point. Every condition must hold; the default answer is no.
 *
 * @param {{attempt:number, retryable:boolean, policy:object, elapsedMs:number, delayMs:number,
 *   now:number}} input `attempt` is the 1-based number of attempts already made, `elapsedMs` is
 *   the time spent inside the retry window so far (measured from the FIRST failure, not from the
 *   first attempt's start, so a slow first attempt cannot consume the retry budget by itself).
 */
export function shouldRetryAgt002Persistence({ attempt, retryable, policy, elapsedMs, delayMs, now } = {}) {
  if (retryable !== true) return false;
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= policy.maxAttempts) return false;
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(delayMs)) return false;
  // Hard exclusive boundary, same as the deadline check below: a re-attempt that would START
  // exactly AT budget exhaustion is still disallowed, not just one that would exceed it.
  if (elapsedMs + delayMs >= policy.budgetMs) return false;
  if (policy.deadlineAt !== null && (!Number.isFinite(now) || now + delayMs >= policy.deadlineAt)) return false;
  return true;
}

/** Default backoff sleep; injectable so tests never spend real wall clock. */
export function agt002PersistenceRetrySleep(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}
