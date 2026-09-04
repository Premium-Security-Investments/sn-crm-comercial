// AGT-002 post-bridge observability + durable attempt lifecycle.
//
// Scope (GREEN, strictly): classify WHERE a post-human-answer AGT-002 reanalysis stopped —
// never WHY the historical incident happened, and never a fix to parsing/schema/envelope/
// persistence logic itself. The real bridge_success event this was built against (correlation_id
// a23833ff-3672-4ca5-9c5d-084627b430e7, code OK, latency_ms 62336, non-empty response, followed
// by an unavailable result with analysis_run_id null) has NOT been reproduced mechanically by
// this module or its tests: they only prove the classification/persistence FRONTIER is now
// correct, not that any particular historical cause is now understood or fixed.
//
// Design: runAgt002PostBridgeAnalysis is a thin orchestrator around the REAL engine
// (agt002-preview-engine.js) and REAL persistence (agt002-preview-persistence.js). The engine —
// and therefore the bridge and the provider — is invoked EXACTLY ONCE, always: `engine.analyze`
// sits outside every loop in this module and its result is produced before any persistence attempt
// exists. The one bounded exception to "never retries" is PERSISTENCE, and only against the tight
// transient allowlist in agt002-persistence-retry.js: the same, already-validated envelope object
// is handed to registerAgt002PreviewAnalysis again, in memory, within the caller's lease budget.
// It never falls back to a second engine/client. The only two boundaries a caller
// supplies are the already-constructed `engine` (whose own client boundary is out of this
// module's control) and the Supabase-shaped `database`. Stage/error_code are always drawn from
// the closed catalogs in agt002-analysis-observability.js — re-exported here — and the single
// `reanalysis_post_bridge_outcome` observability event is the only thing ever emitted, using
// only structural metadata (never prompt, raw model output, documents/evidence, headers,
// secrets, a stack, or an arbitrary message).
import {
  AGT002_POST_BRIDGE_STAGES,
  AGT002_POST_BRIDGE_ERROR_CODES,
  AGT002_OUTPUT_REJECTION_STAGES,
  createAgt002AnalysisObservability,
} from './agt002-analysis-observability.js';
import {
  appendAgt002AnalysisAttempt,
  registerAgt002PreviewAnalysis,
  releaseAgt002PreviewClaim,
  renewAgt002PreviewClaim,
} from './agt002-preview-persistence.js';
import { AGT002_V3_SAFE_VALIDATION_CODES } from './agt002-preview-engine.js';
import {
  agt002PersistenceRetryDelayMs,
  agt002PersistenceRetrySleep,
  classifyAgt002PersistenceError,
  resolveAgt002PersistenceRetryPolicy,
  safeAgt002PersistenceSubcode,
  shouldRetryAgt002Persistence,
} from './agt002-persistence-retry.js';

const AGT002_V3_SAFE_VALIDATION_CODE_SET = new Set(AGT002_V3_SAFE_VALIDATION_CODES);

export { AGT002_POST_BRIDGE_STAGES, AGT002_POST_BRIDGE_ERROR_CODES };

// Real bridge client codes (agt002-preview-codex-client.js) that mean "the bridge call itself
// never produced a usable response" (timeout/cancel/malformed transport shape/session). This is
// a CLOSED set, not a prefix match: AGT002_CODEX_PROVIDER_ERROR shares the same prefix but means
// the provider itself reported a failure, and must classify as PROVIDER_ERROR, not TRANSPORT_ERROR.
// Any code not in this set — known-provider or unknown/future — also falls through to
// PROVIDER_ERROR, never TRANSPORT_ERROR, so an unrecognized code can never be mistaken for "the
// bridge itself is unreachable".
// Closed set of the two fenced-lease codes this codebase mints for a heartbeat that found the lease
// already gone: agt002-preview-persistence.js's renewAgt002PreviewClaim and
// agt002-reanalysis-jobs.js's renewAgt002ReanalysisJobLease. Both travel as a plain `.code` on an
// otherwise untagged Error, and agt002-preview-engine.js's own safe wrapper deliberately preserves
// exactly that `.code` (never the message). Recognizing them here is what lets a lost lease be
// attributed to the lease frontier instead of falling through to the telemetry heuristic below.
export const AGT002_LEASE_LOST_CODES = Object.freeze([
  'AGT002_PREVIEW_LEASE_LOST',
  'AGT002_REANALYSIS_LEASE_LOST',
]);
const AGT002_LEASE_LOST_CODE_SET = new Set(AGT002_LEASE_LOST_CODES);

/** True only for the closed lease codes above — never a prefix/substring match on an arbitrary code. */
export function isAgt002LeaseLostError(error) {
  return typeof error?.code === 'string' && AGT002_LEASE_LOST_CODE_SET.has(error.code);
}

const TRANSPORT_CODES = new Set([
  'AGT002_CODEX_TIMEOUT',
  'AGT002_CODEX_TRANSPORT_ERROR',
  'AGT002_CODEX_CANCELLED',
  'AGT002_CODEX_LOGIN_REQUIRED',
  'AGT002_CODEX_ACCOUNT_INVALID',
  'AGT002_CODEX_INVALID_RESPONSE',
]);

// The RPC names the injected `persistAnalysis` seam (default: agt002-preview-persistence.js's
// registerAgt002PreviewAnalysis) can call — the two depending on canonicalOnly, plus the atomic
// durable-batched finalizer — tracked (never re-implemented) purely to tell "the RPC was
// attempted and it rejected" (persistence) apart from "the envelope failed its own shape check
// before any RPC" (envelope_build).
const RUN_PERSISTENCE_RPC_NAMES = new Set([
  'psi_record_agt002_canonical_analysis_run',
  'psi_record_tender_analysis_run',
  'psi_finalize_agt002_durable_batched_analysis',
]);

// Fixed, generic, identity-stable messages — one per closed code, never the real error text —
// for the durable psi_agt002_analysis_attempt_events row. The RPC has no dedicated stage
// column (psi_append_agt002_analysis_attempt(uuid,uuid,uuid,text,text,text,text,text,text,uuid)
// only carries p_error_code/p_error_message), so the stage lives inside the closed error_code.
const AGT002_POST_BRIDGE_ATTEMPT_ERROR_MESSAGES = Object.freeze({
  [AGT002_POST_BRIDGE_ERROR_CODES.TRANSPORT_ERROR]: 'Vig-IA no completó el análisis: el puente no respondió.',
  [AGT002_POST_BRIDGE_ERROR_CODES.PROVIDER_ERROR]: 'Vig-IA no completó el análisis: el proveedor reportó un error.',
  [AGT002_POST_BRIDGE_ERROR_CODES.CONTENT_EXTRACTION_FAILED]: 'Vig-IA no completó el análisis: la respuesta no tenía contenido utilizable.',
  [AGT002_POST_BRIDGE_ERROR_CODES.JSON_PARSE_FAILED]: 'Vig-IA no completó el análisis: la respuesta no es JSON válido.',
  [AGT002_POST_BRIDGE_ERROR_CODES.MODEL_OUTPUT_INVALID]: 'Vig-IA no completó el análisis: la salida no superó la validación.',
  [AGT002_POST_BRIDGE_ERROR_CODES.ENVELOPE_INVALID]: 'Vig-IA no completó el análisis: el resultado ensamblado no es válido.',
  [AGT002_POST_BRIDGE_ERROR_CODES.INTEGRAL_V3_INVALID]: 'Vig-IA no completó el análisis: la salida integral v3 no superó la validación.',
  [AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST]: 'Vig-IA no completó el análisis: la reserva del trabajo se perdió antes de continuar.',
  [AGT002_POST_BRIDGE_ERROR_CODES.PERSISTENCE_FAILED]: 'Vig-IA no completó el análisis: la persistencia rechazó el resultado.',
  [AGT002_POST_BRIDGE_ERROR_CODES.ATTEMPT_UPDATE_FAILED]: 'Vig-IA no completó el análisis: no fue posible registrar el intento.',
  [AGT002_POST_BRIDGE_ERROR_CODES.RESPONSE_SERIALIZATION_FAILED]: 'Vig-IA no completó el análisis: no fue posible preparar la respuesta.',
  [AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR]: 'Vig-IA no completó el análisis por un error inesperado.',
});

/**
 * Re-gates an engine safe error's attached `.code` against the SAME closed engine allowlist
 * (AGT002_V3_SAFE_VALIDATION_CODES) before it can ever influence a durable row. The engine already
 * only attaches an allowlisted code, but this module refuses to trust that: anything that is not a
 * current allowlist member — a raw validator/model string, a future/unknown code, a non-string —
 * collapses to null here, so it can never be persisted or leaked. Defense in depth, not redundancy.
 */
function safeAgt002V3ValidationSubcode(error) {
  const code = error?.code;
  return typeof code === 'string' && AGT002_V3_SAFE_VALIDATION_CODE_SET.has(code) ? code : null;
}

/**
 * Builds the durable psi_agt002_analysis_attempt_events error_message. Base is always the fixed,
 * generic, identity-stable message for the closed errorCode (never raw text). An allowlisted
 * closed subcode is appended ONLY for the one failure family it belongs to and ONLY when present —
 * so the exact governed invariant (V3) or SQLSTATE category (persistence) is diagnosable from the
 * durable row while the fixed generic public message is preserved verbatim and unknown/hostile
 * values never reach the column.
 */
function agt002PostBridgeAttemptErrorMessage(errorCode, { validationSubcode = null, persistenceSubcode = null } = {}) {
  const base = AGT002_POST_BRIDGE_ATTEMPT_ERROR_MESSAGES[errorCode]
    || AGT002_POST_BRIDGE_ATTEMPT_ERROR_MESSAGES[AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR];
  if (errorCode === AGT002_POST_BRIDGE_ERROR_CODES.INTEGRAL_V3_INVALID && validationSubcode) {
    return `${base} [${validationSubcode}]`;
  }
  // Re-gated against the closed persistence catalog for exactly the same reason
  // safeAgt002V3ValidationSubcode re-gates the engine's: the durable column must be unreachable
  // from any raw DB string, however it got attached upstream.
  if (errorCode === AGT002_POST_BRIDGE_ERROR_CODES.PERSISTENCE_FAILED) {
    const safe = safeAgt002PersistenceSubcode(persistenceSubcode);
    if (safe) return `${base} [${safe}]`;
  }
  return base;
}

/**
 * Pure closed-catalog classifier: every call site in this module (and any future caller, e.g.
 * server/index.js's response-shaping step) hands it a structural `phase` — never raw content —
 * and gets back exactly one {stage, error_code} pair, always drawn from
 * AGT002_POST_BRIDGE_STAGES/AGT002_POST_BRIDGE_ERROR_CODES. An unrecognized phase (a call site
 * this classifier does not know about) always resolves to UNEXPECTED — fail-closed, never a
 * free-form string built from the error itself.
 */
export function classifyAgt002PostBridgeFailure({ phase, error, integralContractV3 = false } = {}) {
  switch (phase) {
    case 'transport': {
      const code = typeof error?.code === 'string' ? error.code : '';
      const isTransport = TRANSPORT_CODES.has(code);
      return Object.freeze({
        stage: AGT002_POST_BRIDGE_STAGES.TRANSPORT,
        error_code: isTransport ? AGT002_POST_BRIDGE_ERROR_CODES.TRANSPORT_ERROR : AGT002_POST_BRIDGE_ERROR_CODES.PROVIDER_ERROR,
      });
    }
    // A fenced heartbeat tried to renew the preview claim. Only the exact codes in
    // AGT002_LEASE_LOST_CODES mean the lease was already gone — the guarded operation (the
    // canonical persistence RPC) was therefore never attempted, so THAT case is neither a
    // transport failure, nor a persistence rejection, nor an unknown internal error. Any other
    // renewal failure (an un-coded or unknown-coded DB RPC/transport error, an invalid response,
    // invalid params — renewAgt002PreviewClaim can throw all of these) is not positive evidence of
    // a lost lease, so it falls through to PERSISTENCE/PERSISTENCE_FAILED instead: the renewal
    // itself is a database persistence-layer operation, even though the canonical run persistence
    // RPC was never reached.
    case 'lease_renewal':
      return isAgt002LeaseLostError(error)
        ? Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.LEASE_RENEWAL, error_code: AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST })
        : Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.PERSISTENCE, error_code: AGT002_POST_BRIDGE_ERROR_CODES.PERSISTENCE_FAILED });
    case 'content_extraction':
      return Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.CONTENT_EXTRACTION, error_code: AGT002_POST_BRIDGE_ERROR_CODES.CONTENT_EXTRACTION_FAILED });
    case 'json_parse':
      return Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.JSON_PARSE, error_code: AGT002_POST_BRIDGE_ERROR_CODES.JSON_PARSE_FAILED });
    case 'model_output_validation':
      return integralContractV3
        ? Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.INTEGRAL_V3_VALIDATION, error_code: AGT002_POST_BRIDGE_ERROR_CODES.INTEGRAL_V3_INVALID })
        : Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.MODEL_OUTPUT_VALIDATION, error_code: AGT002_POST_BRIDGE_ERROR_CODES.MODEL_OUTPUT_INVALID });
    case 'envelope_build':
      return Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.ENVELOPE_BUILD, error_code: AGT002_POST_BRIDGE_ERROR_CODES.ENVELOPE_INVALID });
    case 'persistence':
      return Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.PERSISTENCE, error_code: AGT002_POST_BRIDGE_ERROR_CODES.PERSISTENCE_FAILED });
    case 'attempt_update':
      return Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.ATTEMPT_UPDATE, error_code: AGT002_POST_BRIDGE_ERROR_CODES.ATTEMPT_UPDATE_FAILED });
    case 'response_serialization':
      return Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.RESPONSE_SERIALIZATION, error_code: AGT002_POST_BRIDGE_ERROR_CODES.RESPONSE_SERIALIZATION_FAILED });
    default:
      return Object.freeze({ stage: AGT002_POST_BRIDGE_STAGES.UNEXPECTED, error_code: AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR });
  }
}

// Maps the closed AGT002_OUTPUT_REJECTION_STAGES metadata agt002-preview-engine.js now attaches
// to its own SAFE_INVALID rejections (added as metadata-only properties; the engine's public
// `.message` contract is unchanged) onto this module's phase vocabulary. An untagged rejection
// is transport/provider only when telemetry proves the bridge invocation started and no response
// was received. Untagged failures before invocation or after a received response are unexpected.
function classifyEnginePhase(error, {
  bridgeInvocationStarted = false, bridgeResponseReceived = false,
  bridgeInvocationCount = null, bridgeResponseCount = null,
} = {}) {
  const stage = error?.stage;
  if (stage === AGT002_OUTPUT_REJECTION_STAGES.CONTENT_EXTRACTION) return 'content_extraction';
  if (stage === AGT002_OUTPUT_REJECTION_STAGES.JSON_PARSE) return 'json_parse';
  if (stage === AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION || stage === AGT002_OUTPUT_REJECTION_STAGES.USAGE) return 'model_output_validation';
  if (stage === AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE) return 'envelope_build';
  // A closed lease code is positive, unambiguous evidence of WHERE the run stopped, and it beats
  // every telemetry heuristic below: the heartbeat runs before the operation it guards, so nothing
  // about the bridge, the answer or the database is implied by it.
  if (isAgt002LeaseLostError(error)) return 'lease_renewal';
  // Multi-turn attribution. `bridgeResponseReceived` is a LATCHED, run-level boolean: on the V7/V8
  // discovered-frontier path the semantic-discovery stage takes N provider turns before the
  // analysis turn, so after the first batch answers it is permanently true and can no longer tell
  // "the bridge answered THIS call" from "the bridge answered SOME earlier call". The counters say
  // what the booleans cannot: a call is outstanding only while an invocation has started and its
  // response has not arrived. With no counters supplied (every pre-existing caller) the original
  // boolean rule is used verbatim, so single-turn behaviour is byte-identical.
  if (Number.isInteger(bridgeInvocationCount) && Number.isInteger(bridgeResponseCount)) {
    return bridgeInvocationCount > bridgeResponseCount ? 'transport' : 'unexpected';
  }
  if (bridgeResponseReceived) return 'unexpected';
  return bridgeInvocationStarted ? 'transport' : 'unexpected';
}

/** Observes (never re-implements) whether registerAgt002PreviewAnalysis actually reached the
 * RPC, without changing any of its real persistence/validation behavior. */
function wrapDatabaseForRunRpcTracking(database, onRunRpcAttempted) {
  return {
    ...database,
    rpc: (name, params) => {
      if (RUN_PERSISTENCE_RPC_NAMES.has(name)) onRunRpcAttempted();
      return database.rpc(name, params);
    },
  };
}

/** Best-effort durable write: never throws, never turns a real outcome into a different one. A
 * failure here is itself classified (closed code only) and logged with no raw error text. */
async function safeAppendAttempt(database, params) {
  try {
    await appendAgt002AnalysisAttempt(database, params);
  } catch (error) {
    const { error_code } = classifyAgt002PostBridgeFailure({ phase: 'attempt_update', error });
    console.warn('agt002_post_bridge_attempt_write_failed', { event: 'agt002_post_bridge_attempt_write_failed', error_code });
  }
}

/**
 * Runs one AGT-002 post-bridge analysis attempt end to end: queued -> running -> completed |
 * unavailable, persisted durably via the existing psi_agt002_analysis_attempt_events
 * infrastructure, with exactly one closed-catalog observability event and exactly one claim
 * release — regardless of outcome, and regardless of whether observability/attempt-write
 * themselves fail. `engine.analyze` is called exactly once, unconditionally — a persistence retry
 * re-uses the envelope that single call already produced and can never reach back to it. Zero
 * fallback: no second engine/client is ever constructed or reached for.
 *
 * @param {object} database Supabase-shaped `.rpc()` client (real or a verifiable double).
 * @param {{opportunityId:string, tenderId:string, snapshotId:string, contextVersionId:string,
 *   attemptKey:string, correlationId:string, claimId:?string, idempotencyKey:?string,
 *   canonicalOnly?:boolean}} context
 * @param {{engine:{analyze:Function}, observability?:{record:Function}, analysisContext:object,
 *   bridgeTelemetry?:{invocationStarted?:boolean, responseReceived?:boolean},
 *   integralContractV3?:boolean, presentAnalysis?:Function,
 *   persistenceRetry?:{maxAttempts?:number, baseDelayMs?:number, maxDelayMs?:number,
 *     budgetMs?:number, deadlineAt?:number, now?:Function, sleep?:Function},
 *   persistAnalysis?:Function}} deps `persistAnalysis` is the injectable persistence seam
 *   (same signature as registerAgt002PreviewAnalysis: `(trackedDatabase, persistenceParams) =>
 *   Promise<{run_id}>`), defaulting to registerAgt002PreviewAnalysis so every existing caller is
 *   byte-identical.
 */
export async function runAgt002PostBridgeAnalysis(database, context = {}, deps = {}) {
  const {
    opportunityId, tenderId, snapshotId, contextVersionId, attemptKey,
    correlationId, claimId, idempotencyKey, canonicalOnly = true,
    requireTenderRequirementInventory = true,
    // F3: the run-binding company evidence identity, handed down verbatim (never re-derived
    // here) from the caller's already-loaded governance — forwarded as-is to persistence.
    evidenceIdentity = null,
    // Deterministic stage-boundary heartbeat: when supplied alongside claimId/idempotencyKey, the
    // SAME preview claim this run holds is renewed exactly once, immediately before the canonical
    // persistence RPC is attempted, fenced by both tokens. `null` (every caller that predates this
    // field) keeps this frontier byte-identical to before: no renewal, no behaviour change.
    leaseSeconds = null,
  } = context;
  const {
    engine, observability = createAgt002AnalysisObservability(), analysisContext,
    bridgeTelemetry, integralContractV3 = false, presentAnalysis,
    // Bounded in-memory persistence retry knobs; every field is optional and independently
    // clamped by resolveAgt002PersistenceRetryPolicy. A caller that knows the real claim/queue
    // lease (agt002-reanalysis-executor.js) supplies `deadlineAt` so no re-attempt can ever start
    // outside that lease. `now`/`sleep` exist so tests never spend real wall clock.
    persistenceRetry = null,
    // Injectable persistence seam: every existing caller (which never supplies this) gets exactly
    // registerAgt002PreviewAnalysis, so this default is byte-identical to before it existed.
    persistAnalysis = registerAgt002PreviewAnalysis,
  } = deps;
  const nowMs = typeof persistenceRetry?.now === 'function' ? persistenceRetry.now : Date.now;
  const sleepMs = typeof persistenceRetry?.sleep === 'function' ? persistenceRetry.sleep : agt002PersistenceRetrySleep;
  // Read fresh every time, never cached before engine.analyze() runs: `bridgeTelemetry` is a
  // mutable object the caller's own client wrapper flips to true only once the bridge call has
  // actually resolved, so reading it too early would always observe `false`.
  const readBridgeResponseReceived = () => bridgeTelemetry?.responseReceived === true;

  const startedAt = Date.now();
  const attemptBase = { snapshot_id: snapshotId, opportunity_id: opportunityId, tender_id: tenderId, attempt_key: attemptKey };

  await safeAppendAttempt(database, { ...attemptBase, state: 'queued' });
  await safeAppendAttempt(database, { ...attemptBase, state: 'running' });

  // Two distinct outcomes, deliberately not conflated:
  // - `runPersisted`/`analysisRunId`: whether a real AGT-002 run now durably exists. Once true,
  //   it stays true even if presentation later fails — the run is real and is never undone.
  // - `status`: what this call reports back to its caller (and, downstream, to the human) —
  //   'completed' only once the run is BOTH persisted AND safely presentable.
  // The durable attempt event tracks the former (`attemptState`), never the latter, because
  // psi_agt002_analysis_attempt_events enforces "completed => analysis_run_id set, no error"
  // and "not completed => no analysis_run_id" at the DB level (see
  // psi_append_agt002_analysis_attempt / its check constraint) — a completed run can never be
  // recorded as 'unavailable', and an unavailable attempt can never carry a run id.
  let runPersisted = false;
  let analysisRunId = null;
  let status = 'unavailable';
  let stage = AGT002_POST_BRIDGE_STAGES.UNEXPECTED;
  let errorCode = AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR;
  // The closed, allowlisted V3 invariant subcode the engine attaches to a v3 semantic-validation
  // safe error (null for every other failure). Captured here so the durable attempt event can
  // attribute an INTEGRAL_V3_INVALID failure to the exact invariant; re-gated against the engine
  // allowlist so a hostile/unknown value can never reach the durable row.
  let validationSubcode = null;
  // The closed AGT002_PERSISTENCE_SUBCODES member naming the SQLSTATE/transport CATEGORY of the
  // last persistence failure (null for every other failure, and cleared once a run persists).
  // Never the raw DB message, details or hint — those never leave the thrown Error's `.message`.
  let persistenceSubcode = null;
  // How many times the ALREADY-VALIDATED envelope was handed to persistence. Always 1 unless a
  // truly transient frontier was re-attempted; the engine/provider is invoked exactly once
  // regardless, because `envelope` below is produced before this counter ever moves.
  let persistenceAttempts = 0;

  let envelope = null;
  let engineFailed = false;
  try {
    envelope = await engine.analyze(analysisContext, { idempotencyKey });
  } catch (error) {
    engineFailed = true;
    const classification = classifyAgt002PostBridgeFailure({
      phase: classifyEnginePhase(error, {
        bridgeInvocationStarted: bridgeTelemetry?.invocationStarted === true,
        bridgeResponseReceived: readBridgeResponseReceived(),
        // Read fresh here for the same reason the booleans are: the caller's client wrapper
        // increments them as turns actually start/resolve. Absent (a caller that only keeps the
        // two booleans) they stay null and classifyEnginePhase falls back to the boolean rule.
        bridgeInvocationCount: Number.isInteger(bridgeTelemetry?.invocationCount) ? bridgeTelemetry.invocationCount : null,
        bridgeResponseCount: Number.isInteger(bridgeTelemetry?.responseCount) ? bridgeTelemetry.responseCount : null,
      }), error, integralContractV3,
    });
    stage = classification.stage;
    errorCode = classification.error_code;
    validationSubcode = safeAgt002V3ValidationSubcode(error);
  }

  let registeredRun = null;
  // Persistence is its own stage boundary: the SAME claim this run holds is renewed exactly once,
  // immediately before the canonical persistence RPC is even attempted — never on a timer, never
  // per retry attempt — fenced by both idempotencyKey and claimId. A lost lease means another
  // worker may already own this reservation, so persistence must never be attempted against it;
  // the claim is still released exactly once below, in the existing best-effort release.
  const hasFencedLease = Boolean(claimId) && Boolean(idempotencyKey) && Number.isInteger(leaseSeconds) && leaseSeconds > 0;
  let renewalFailed = false;
  if (!engineFailed && hasFencedLease) {
    try {
      await renewAgt002PreviewClaim(database, { idempotencyKey, claimId, leaseSeconds });
    } catch (error) {
      renewalFailed = true;
      // Whatever the cause, the fenced renewal itself failed, so the canonical run RPC must never
      // be attempted against a claim that may no longer be held — see the `!renewalFailed` gate
      // below, which skips persistence regardless of which failure this turns out to be. Only the exact
      // AGT002_LEASE_LOST_CODES mean the lease was actually confirmed gone; any other renewal
      // failure (un-coded/unknown-coded DB RPC or transport error, invalid response, invalid
      // params) is classified PERSISTENCE/PERSISTENCE_FAILED instead — never lease_lost, and never
      // left to fall through to provider_error. `persistence_subcode` stays null either way: this
      // never reached the canonical run RPC that subcode is derived from.
      const classification = classifyAgt002PostBridgeFailure({ phase: 'lease_renewal', error, integralContractV3 });
      stage = classification.stage;
      errorCode = classification.error_code;
    }
  }
  if (!engineFailed && !renewalFailed) {
    // The SAME already-validated envelope object for every attempt, built exactly once above.
    // Nothing in here can reach the engine, the bridge or the provider: `engine` is only read for
    // its already-computed `manifestScope`.
    const persistenceParams = {
      opportunity_id: opportunityId, tender_id: tenderId, snapshot_id: snapshotId,
      envelope, canonicalOnly, context_version_id: contextVersionId,
      // Phase 4: the server-owned expected manifest scope comes from the engine that produced
      // this envelope (deriveAgt002ManizalesManifestScope of the selected pilot manifest), never
      // from a request body — so persistence can deep-compare it before the RPC. Null for a
      // non-manifest run, leaving persistence's scope check inert.
      expectedManifestScope: engine?.manifestScope ?? null,
      expectedIdempotencyKey: context.expectedIdempotencyKey,
      requireTenderRequirementInventory,
      // The independent source text a model-proposed label must be literally anchored in, taken
      // from the very same (frozen, for the durable worker) analysis context this run's engine
      // analysed — never from the envelope it produced. Persistence re-derives the anchoring and
      // refuses the run without it; the text itself is never persisted.
      semanticSourceDocuments: analysisContext?.documents ?? null,
      evidenceIdentity,
    };
    const retryPolicy = resolveAgt002PersistenceRetryPolicy(persistenceRetry);
    // Retry window is measured from the FIRST failure, never from the first attempt's start: a
    // slow first attempt (the observed frontier took ~19s end to end) must not consume the budget
    // that exists to fund the re-attempt.
    let retryWindowStartedAt = null;
    for (;;) {
      persistenceAttempts += 1;
      let runRpcAttempted = false;
      const trackedDatabase = wrapDatabaseForRunRpcTracking(database, () => { runRpcAttempted = true; });
      try {
        registeredRun = await persistAnalysis(trackedDatabase, persistenceParams);
        runPersisted = true;
        analysisRunId = registeredRun?.run_id ?? null;
        persistenceSubcode = null;
        break;
      } catch (error) {
        const classification = classifyAgt002PostBridgeFailure({
          phase: runRpcAttempted ? 'persistence' : 'envelope_build', error, integralContractV3,
        });
        stage = classification.stage;
        errorCode = classification.error_code;
        // Only a failure that actually REACHED the run RPC can be a transient database frontier.
        // A rejection raised before the RPC is this module's own deterministic envelope/semantic
        // validation: re-running it would reject identically, so it is never retried and never
        // even classified as a persistence subcode.
        const persistence = runRpcAttempted
          ? classifyAgt002PersistenceError(error)
          : { subcode: null, retryable: false };
        persistenceSubcode = persistence.subcode;
        if (retryWindowStartedAt === null) retryWindowStartedAt = nowMs();
        const delayMs = agt002PersistenceRetryDelayMs(persistenceAttempts - 1, retryPolicy);
        if (!shouldRetryAgt002Persistence({
          attempt: persistenceAttempts, retryable: persistence.retryable, policy: retryPolicy,
          elapsedMs: nowMs() - retryWindowStartedAt, delayMs, now: nowMs(),
        })) break;
        try {
          observability.record('retry_scheduled', {
            tender_id: tenderId, stage: AGT002_POST_BRIDGE_STAGES.PERSISTENCE,
            attempt_count: persistenceAttempts, persistence_subcode: persistence.subcode,
          });
        } catch {
          // A broken observability sink must never change whether the retry happens.
        }
        await sleepMs(delayMs);
        // Fail-closed post-sleep gate: `sleepMs` can overrun its requested delay (an event-loop
        // pause, GC, a slow fake clock in a test), so the pre-sleep budget/deadline check above is
        // stale by the time we get here. Re-run the SAME decision point with the delay already
        // spent (delayMs: 0) against a freshly read clock — if the deadline or retry-window budget
        // is now exhausted, stop with the persistence failure already classified above rather than
        // starting another persistence RPC.
        if (!shouldRetryAgt002Persistence({
          attempt: persistenceAttempts, retryable: true, policy: retryPolicy,
          elapsedMs: nowMs() - retryWindowStartedAt, delayMs: 0, now: nowMs(),
        })) break;
      }
    }
  }

  // Response shaping is its own frontier, deliberately AFTER the run is already durable: a
  // caller-supplied presenter (e.g. presentCurrentTenderAnalysis) turning the persisted run
  // into a public payload can still fail on its own terms. That never un-persists the run and
  // never fabricates one — it only means this call cannot safely hand back a presentable
  // result, so `status` degrades to 'unavailable' while `analysisRunId`/`runPersisted` stay
  // exactly what they already were.
  let presented = null;
  if (runPersisted) {
    if (typeof presentAnalysis === 'function') {
      try {
        presented = presentAnalysis(registeredRun);
        status = 'completed';
        stage = AGT002_POST_BRIDGE_STAGES.RESPONSE_RECEIVED;
        errorCode = null;
      } catch (error) {
        const classification = classifyAgt002PostBridgeFailure({ phase: 'response_serialization', error, integralContractV3 });
        stage = classification.stage;
        errorCode = classification.error_code;
      }
    } else {
      status = 'completed';
      stage = AGT002_POST_BRIDGE_STAGES.RESPONSE_RECEIVED;
      errorCode = null;
    }
  }

  // Durable attempt lifecycle mirrors `runPersisted`, not `status` — see the comment above.
  const attemptState = runPersisted ? 'completed' : 'unavailable';
  await safeAppendAttempt(database, {
    ...attemptBase,
    state: attemptState,
    ...(attemptState === 'unavailable' ? {
      error_code: errorCode,
      error_message: agt002PostBridgeAttemptErrorMessage(errorCode, { validationSubcode, persistenceSubcode }),
    } : {}),
    ...(attemptState === 'completed' ? { analysis_run_id: analysisRunId } : {}),
  });

  try {
    observability.record('reanalysis_post_bridge_outcome', {
      correlation_id: correlationId,
      stage,
      error_code: status === 'unavailable' ? errorCode : null,
      // Only ever set for a real persistence rejection, and only as a closed catalog member.
      persistence_subcode: errorCode === AGT002_POST_BRIDGE_ERROR_CODES.PERSISTENCE_FAILED
        ? safeAgt002PersistenceSubcode(persistenceSubcode)
        : null,
      persistence_attempts: persistenceAttempts,
      bridge_invocation_started: bridgeTelemetry?.invocationStarted === true,
      bridge_response_received: readBridgeResponseReceived(),
      context_version_id: contextVersionId,
      opportunity_id: opportunityId,
      tender_id: tenderId,
      snapshot_id: snapshotId,
      duration_ms: Date.now() - startedAt,
    });
  } catch {
    // A broken observability sink must never affect the real outcome computed above.
  }

  try {
    if (claimId && idempotencyKey) await releaseAgt002PreviewClaim(database, { idempotencyKey, claimId });
  } catch {
    // Best-effort: the claim is already time-bounded server-side (lease expiry); a release
    // failure here must not flip the outcome this function already determined.
  }

  // `presented` is only non-null once `status === 'completed'`: whatever presentAnalysis
  // returned (e.g. presentCurrentTenderAnalysis's public analysis payload) for the caller to
  // forward as-is — this module never re-shapes or inspects it.
  return {
    status, analysis_run_id: analysisRunId, context_version_id: contextVersionId,
    correlation_id: correlationId, presented,
    error_code: status === 'unavailable' ? errorCode : null,
  };
}
