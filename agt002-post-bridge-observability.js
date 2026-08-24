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
// (agt002-preview-engine.js) and REAL persistence (agt002-preview-persistence.js). It never
// retries and never falls back to a second engine/client. The only two boundaries a caller
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
} from './agt002-preview-persistence.js';
import { AGT002_V3_SAFE_VALIDATION_CODES } from './agt002-preview-engine.js';

const AGT002_V3_SAFE_VALIDATION_CODE_SET = new Set(AGT002_V3_SAFE_VALIDATION_CODES);

export { AGT002_POST_BRIDGE_STAGES, AGT002_POST_BRIDGE_ERROR_CODES };

// Real bridge client codes (agt002-preview-codex-client.js) that mean "the bridge call itself
// never produced a usable response" (timeout/cancel/malformed transport shape/session). This is
// a CLOSED set, not a prefix match: AGT002_CODEX_PROVIDER_ERROR shares the same prefix but means
// the provider itself reported a failure, and must classify as PROVIDER_ERROR, not TRANSPORT_ERROR.
// Any code not in this set — known-provider or unknown/future — also falls through to
// PROVIDER_ERROR, never TRANSPORT_ERROR, so an unrecognized code can never be mistaken for "the
// bridge itself is unreachable".
const TRANSPORT_CODES = new Set([
  'AGT002_CODEX_TIMEOUT',
  'AGT002_CODEX_TRANSPORT_ERROR',
  'AGT002_CODEX_CANCELLED',
  'AGT002_CODEX_LOGIN_REQUIRED',
  'AGT002_CODEX_ACCOUNT_INVALID',
  'AGT002_CODEX_INVALID_RESPONSE',
]);

// Both possible RPC names agt002-preview-persistence.js's registerAgt002PreviewAnalysis can
// call, depending on canonicalOnly — tracked (never re-implemented) purely to tell "the RPC was
// attempted and it rejected" (persistence) apart from "the envelope failed its own shape check
// before any RPC" (envelope_build).
const RUN_PERSISTENCE_RPC_NAMES = new Set(['psi_record_agt002_canonical_analysis_run', 'psi_record_tender_analysis_run']);

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
 * generic, identity-stable message for the closed errorCode (never raw text). The allowlisted
 * closed V3 validation subcode is appended ONLY for an INTEGRAL_V3_INVALID failure and ONLY when
 * present — so the exact governed invariant is diagnosable from the durable row while the fixed
 * generic public message is preserved verbatim and unknown/hostile values never reach the column.
 */
function agt002PostBridgeAttemptErrorMessage(errorCode, validationSubcode) {
  const base = AGT002_POST_BRIDGE_ATTEMPT_ERROR_MESSAGES[errorCode]
    || AGT002_POST_BRIDGE_ATTEMPT_ERROR_MESSAGES[AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR];
  if (errorCode === AGT002_POST_BRIDGE_ERROR_CODES.INTEGRAL_V3_INVALID && validationSubcode) {
    return `${base} [${validationSubcode}]`;
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
function classifyEnginePhase(error, { bridgeInvocationStarted = false, bridgeResponseReceived = false } = {}) {
  const stage = error?.stage;
  if (stage === AGT002_OUTPUT_REJECTION_STAGES.CONTENT_EXTRACTION) return 'content_extraction';
  if (stage === AGT002_OUTPUT_REJECTION_STAGES.JSON_PARSE) return 'json_parse';
  if (stage === AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION || stage === AGT002_OUTPUT_REJECTION_STAGES.USAGE) return 'model_output_validation';
  if (stage === AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE) return 'envelope_build';
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
 * themselves fail. Zero retry: `engine.analyze` is called exactly once. Zero fallback: no
 * second engine/client is ever constructed or reached for.
 *
 * @param {object} database Supabase-shaped `.rpc()` client (real or a verifiable double).
 * @param {{opportunityId:string, tenderId:string, snapshotId:string, contextVersionId:string,
 *   attemptKey:string, correlationId:string, claimId:?string, idempotencyKey:?string,
 *   canonicalOnly?:boolean}} context
 * @param {{engine:{analyze:Function}, observability?:{record:Function}, analysisContext:object,
 *   bridgeTelemetry?:{invocationStarted?:boolean, responseReceived?:boolean},
 *   integralContractV3?:boolean, presentAnalysis?:Function}} deps
 */
export async function runAgt002PostBridgeAnalysis(database, context = {}, deps = {}) {
  const {
    opportunityId, tenderId, snapshotId, contextVersionId, attemptKey,
    correlationId, claimId, idempotencyKey, canonicalOnly = true,
    requireTenderRequirementInventory = true,
  } = context;
  const {
    engine, observability = createAgt002AnalysisObservability(), analysisContext,
    bridgeTelemetry, integralContractV3 = false, presentAnalysis,
  } = deps;
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
      }), error, integralContractV3,
    });
    stage = classification.stage;
    errorCode = classification.error_code;
    validationSubcode = safeAgt002V3ValidationSubcode(error);
  }

  let registeredRun = null;
  if (!engineFailed) {
    let runRpcAttempted = false;
    const trackedDatabase = wrapDatabaseForRunRpcTracking(database, () => { runRpcAttempted = true; });
    try {
      registeredRun = await registerAgt002PreviewAnalysis(trackedDatabase, {
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
      });
      runPersisted = true;
      analysisRunId = registeredRun?.run_id ?? null;
    } catch (error) {
      const classification = classifyAgt002PostBridgeFailure({
        phase: runRpcAttempted ? 'persistence' : 'envelope_build', error, integralContractV3,
      });
      stage = classification.stage;
      errorCode = classification.error_code;
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
      error_message: agt002PostBridgeAttemptErrorMessage(errorCode, validationSubcode),
    } : {}),
    ...(attemptState === 'completed' ? { analysis_run_id: analysisRunId } : {}),
  });

  try {
    observability.record('reanalysis_post_bridge_outcome', {
      correlation_id: correlationId,
      stage,
      error_code: status === 'unavailable' ? errorCode : null,
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
