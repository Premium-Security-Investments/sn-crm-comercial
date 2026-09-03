import { randomUUID } from 'node:crypto';
import { ANALYSIS_FLAG_NAMES } from './agt002-analysis-config.js';
import { createAgt002AnalysisObservability } from './agt002-analysis-observability.js';
import { AGT002_POST_BRIDGE_ERROR_CODES, runAgt002PostBridgeAnalysis } from './agt002-post-bridge-observability.js';
import {
  claimAgt002PreviewRun,
  countAgt002PreviewRunsToday,
  findAgt002PreviewRun,
  releaseAgt002PreviewClaim,
} from './agt002-preview-persistence.js';
import { createAgt002PreviewRuntime } from './agt002-preview-runtime.js';
import { AGT002_MAX_PREVIEW_CLAIM_LEASE_SECONDS, agt002RequiredPreviewClaimLeaseSeconds } from './agt002-reanalysis-input.js';
import { classifyAgt002ReanalysisWorkerError } from './agt002-reanalysis-worker.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT, isAgt002PreviewReasoningEffort } from './agt002-preview-reasoning-effort.js';
import { validateAgt002CompanyEvidenceIdentity, validateAgt002CompanyEvidenceAsOf } from './agt002-company-evidence-identity.js';
import { createAgt002AnalysisCheckpointAdapter } from './agt002-analysis-checkpoints.js';

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validFrozenInput(job) {
  const input = job?.frozenEngineInput;
  const identity = input?.engine_identity;
  const flags = input?.analysis_flags;
  const context = input?.analysis_context;
  if (!isObject(input) || input.schema_version !== 1 || !isObject(identity) || !isObject(flags) || !isObject(context)) return null;
  if (typeof identity.model !== 'string' || !identity.model.trim()
    || typeof identity.policy_version !== 'string' || !identity.policy_version.trim()
    || !Number.isInteger(identity.timeout_ms) || identity.timeout_ms <= 0 || identity.timeout_ms > 480_000
    || !Number.isInteger(identity.daily_max_runs) || identity.daily_max_runs <= 0
    || !Number.isInteger(identity.max_concurrent) || identity.max_concurrent <= 0) return null;
  // AGT-002 root-cause fix: `effort` is optional here (never rejected merely for being absent) so
  // a job frozen before this field existed keeps executing exactly as it did before — see
  // frozenEnvironment below for the safe default applied at reconstruction. A PRESENT value must
  // still be a real allowlisted reasoning effort, or a corrupted/hostile frozen input could push
  // an unsupported value all the way to the provider.
  if (identity.effort !== undefined && !isAgt002PreviewReasoningEffort(identity.effort)) return null;
  // A timeout whose two-turn lease the reservation ceiling cannot fund is a frozen-config error,
  // not a capacity state: reject it here — before any claim, runtime construction or post-bridge
  // call — exactly like the other pre-claim validation failures. 285_000ms is the largest fundable
  // timeout (2*285+30 = 600 exactly); 285_001ms needs 602s and is rejected.
  if (agt002RequiredPreviewClaimLeaseSeconds(identity.timeout_ms) > AGT002_MAX_PREVIEW_CLAIM_LEASE_SECONDS) return null;
  if (identity.idempotency_key != null && identity.idempotency_key !== job.idempotencyKey) return null;
  if (context?.opportunity?.id !== job.opportunityId
    || context.snapshotId !== job.snapshotId
    || context.canonicalOnly !== true
    || flags.AGT002_CANONICAL_ONLY !== true) return null;
  if (flags.AGT002_INTEGRAL_CONTRACT_V3 === true && !validAgt002FrozenGovernance(input.integral_v3_governance)) return null;
  if (flags.AGT002_LEGAL_CORPUS === true && !isObject(input.legal_corpus_context)) return null;
  return input;
}

// C: a NEW job (agt002-reanalysis-input.js's buildAgt002FrozenEngineInput) always freezes
// evidenceIdentity and evidenceAsOf together — re-validated here, shape and all, rather than
// merely accepted. A job durably queued before evidenceAsOf existed carries neither field at
// all; that legacy shape is the only accepted exception, so an already-queued pre-F3 job is not
// rejected before even attempting execution. Either field present without the other can never
// come from any real builder (current or legacy) and is rejected as a corrupted/hostile frozen
// input.
function validAgt002FrozenGovernance(governance) {
  if (!isObject(governance)) return false;
  const hasIdentity = governance.evidenceIdentity != null;
  const hasAsOf = governance.evidenceAsOf != null;
  if (hasIdentity !== hasAsOf) return false;
  if (hasIdentity) {
    try { validateAgt002CompanyEvidenceIdentity(governance.evidenceIdentity); } catch { return false; }
  }
  if (hasAsOf) {
    // Canonical format only — never merely Date-parseable — so a corrupted/hostile frozen
    // job can never carry an offset, a non-midnight time or a calendar-impossible date.
    try { validateAgt002CompanyEvidenceAsOf(governance.evidenceAsOf); } catch { return false; }
  }
  return true;
}

function frozenEnvironment(base, input) {
  const identity = input.engine_identity;
  const environment = {
    ...base,
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: identity.model,
    AGT002_PREVIEW_POLICY_VERSION: identity.policy_version,
    AGT002_PREVIEW_TIMEOUT_MS: String(identity.timeout_ms),
    AGT002_PREVIEW_DAILY_MAX_RUNS: String(identity.daily_max_runs),
    AGT002_PREVIEW_MAX_CONCURRENT: String(identity.max_concurrent),
    // A legacy frozen input (no `effort` field) reconstructs with the current safe default,
    // never the worker host's own ambient env var — the frozen job's own identity always wins.
    AGT002_PREVIEW_REASONING_EFFORT: isAgt002PreviewReasoningEffort(identity.effort) ? identity.effort : AGT002_PREVIEW_DEFAULT_REASONING_EFFORT,
  };
  for (const name of ANALYSIS_FLAG_NAMES) {
    if (Object.hasOwn(input.analysis_flags, name)) environment[name] = input.analysis_flags[name] === true ? 'true' : 'false';
  }
  return environment;
}

/**
 * Explicit, exhaustive, closed projection of the post-bridge error catalog
 * (AGT002_POST_BRIDGE_ERROR_CODES) onto the queue's own closed catalog
 * (AGT002_REANALYSIS_QUEUE_ERROR_CODES, enforced by migration 068's CHECK constraint and by
 * psi_fail_agt002_reanalysis_job — so no new queue code may be minted here without a migration).
 *
 * This used to be substring matching with `provider_error` as the DEFAULT arm, which is how the real
 * Procuraduria reanalysis reported provider_error after 18 successful semantic-discovery bridge
 * turns (timeout_ms=285000, max observed turn latency ~89s, no 19th bridge call) and then ended
 * unavailable with no analysis_run. The durable evidence for that run proves only: stage=unexpected,
 * bridge_response_received latched true, persistence_attempts=0. It does NOT prove which local,
 * pre-provider-call frontier actually failed — a lost preview lease at the analysis-turn boundary is
 * one hypothesis consistent with that signature (and the one this module now classifies correctly,
 * see AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST below), but so is any other untagged local failure
 * between the discovery turns and the analysis bridge call (e.g. discovered-input assembly or
 * validation-context construction — see agt002-preview-engine.js). Whatever the real cause,
 * AGT002_UNEXPECTED_ERROR contains none of the matched substrings, so it fell through to the default
 * and blamed a provider that was never even called. Three distinct closed codes (UNEXPECTED_ERROR,
 * ATTEMPT_UPDATE_FAILED, RESPONSE_SERIALIZATION_FAILED) collapsed the same way.
 *
 * Every entry below is now deliberate, and `provider_error` is reachable from EXACTLY ONE code —
 * AGT002_PROVIDER_ERROR, which is only ever minted when the bridge call itself failed and the
 * provider reported the failure. An unknown/absent code is NOT the provider's fault either: it fails
 * closed onto `invalid_output`, the same fail-closed bucket the worker's own closedOutcomeCode
 * already uses for an unrecognized value.
 */
const POST_BRIDGE_TO_QUEUE_ERROR_CODE = new Map([
  // The bridge never produced a usable response (timeout, cancel, transport, session). `timeout` is
  // the queue's closest member and the code this frontier has always mapped to.
  [AGT002_POST_BRIDGE_ERROR_CODES.TRANSPORT_ERROR, 'timeout'],
  // The one and only source of provider_error.
  [AGT002_POST_BRIDGE_ERROR_CODES.PROVIDER_ERROR, 'provider_error'],
  [AGT002_POST_BRIDGE_ERROR_CODES.CONTENT_EXTRACTION_FAILED, 'invalid_output'],
  [AGT002_POST_BRIDGE_ERROR_CODES.JSON_PARSE_FAILED, 'invalid_output'],
  [AGT002_POST_BRIDGE_ERROR_CODES.MODEL_OUTPUT_INVALID, 'invalid_output'],
  [AGT002_POST_BRIDGE_ERROR_CODES.ENVELOPE_INVALID, 'invalid_output'],
  [AGT002_POST_BRIDGE_ERROR_CODES.INTEGRAL_V3_INVALID, 'invalid_output'],
  // The run's fenced lease was already gone at a stage boundary: the queue has always had a code
  // for exactly this, it was simply unreachable through the post-bridge path.
  [AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST, 'lease_lost'],
  [AGT002_POST_BRIDGE_ERROR_CODES.PERSISTENCE_FAILED, 'persistence_failure'],
  // Failing to write the durable attempt row is a persistence failure, not a provider failure.
  [AGT002_POST_BRIDGE_ERROR_CODES.ATTEMPT_UPDATE_FAILED, 'persistence_failure'],
  // The run persisted but could not be shaped into a presentable payload: a server-side output
  // problem, never the provider's.
  [AGT002_POST_BRIDGE_ERROR_CODES.RESPONSE_SERIALIZATION_FAILED, 'invalid_output'],
  // Genuinely unknown. Not attributable to the provider, so it must not say provider_error; the
  // durable attempt event and the reanalysis_post_bridge_outcome event still carry the real
  // 'unexpected' stage, which is where an operator reads WHERE it stopped.
  [AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR, 'invalid_output'],
]);

function mapPostBridgeOutcomeCode(value) {
  return POST_BRIDGE_TO_QUEUE_ERROR_CODE.get(value) ?? 'invalid_output';
}

/**
 * Wall-clock reserve at the tail of the claim lease that a bounded persistence retry may never
 * eat into: the durable 'unavailable'/'completed' attempt write, the claim release and the queue's
 * own terminal transition all still have to happen after persistence returns.
 */
export const AGT002_PERSISTENCE_RETRY_LEASE_RESERVE_MS = 10_000;

/**
 * Builds the direct-host executor. The legacy preview claim is acquired only
 * immediately before engine construction. runAgt002PostBridgeAnalysis owns
 * that claim once invoked; any earlier failure releases it exactly once.
 */
export function createAgt002ReanalysisExecutor({
  environment = process.env,
  now = Date.now,
  claimPreviewRun = claimAgt002PreviewRun,
  findPreviewRun = findAgt002PreviewRun,
  releasePreviewClaim = releaseAgt002PreviewClaim,
  countDailyRuns = countAgt002PreviewRunsToday,
  createRuntime = createAgt002PreviewRuntime,
  runPostBridgeAnalysis = runAgt002PostBridgeAnalysis,
  createCorrelationId = randomUUID,
  observability = createAgt002AnalysisObservability(),
  // AGT-002 durable batched analysis, Task 2: constructed ONLY for a claimed job whose own
  // executionMode is exactly 'durable_batched_v1' — never for a missing mode, 'single_turn_v1',
  // or any direct/Manizales/legacy path. Kept as an injectable seam (defaulting to the real
  // Supabase RPC adapter) purely so this dependency never touches a database in unit tests.
  createCheckpointAdapter = createAgt002AnalysisCheckpointAdapter,
} = {}) {
  return async function executeAgt002Reanalysis(database, job, { beforeProviderCall: jobLeaseHeartbeat } = {}) {
    const input = validFrozenInput(job);
    if (!input) return { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false };

    const identity = input.engine_identity;
    // Never clamped — validFrozenInput already rejected anything the ceiling cannot fund.
    const leaseSeconds = agt002RequiredPreviewClaimLeaseSeconds(identity.timeout_ms);
    let previewClaimId = null;
    // Stamped BEFORE the claim RPC (never after), so the derived deadline can only ever be
    // earlier than the real lease start — a bounded persistence retry must be conservative about
    // the lease it is spending, never optimistic.
    const leaseStartedAt = now();
    try {
      const claim = await claimPreviewRun(database, {
        idempotencyKey: job.idempotencyKey,
        dailyMaxRuns: identity.daily_max_runs,
        maxConcurrent: identity.max_concurrent,
        leaseSeconds,
      });
      if (claim?.status === 'existing') {
        const existing = await findPreviewRun(database, job.idempotencyKey, { canonicalOnly: true });
        if (!existing?.run_id) return { status: 'unavailable', analysis_run_id: null, error_code: 'persistence_failure', reused: false };
        return { status: 'completed', analysis_run_id: existing.run_id, reused: true };
      }
      if (claim?.status !== 'claimed' || typeof claim?.claim_id !== 'string' || !claim.claim_id) {
        return { status: 'unavailable', analysis_run_id: null, error_code: 'capacity_unavailable', reused: false };
      }
      previewClaimId = claim.claim_id;

      // The two booleans are the historical, latched run-level signals (kept verbatim: the
      // observability event still emits exactly them). The two counters are what make the signal
      // usable on the V7/V8 discovered-frontier path, where semantic discovery takes N provider
      // turns before the analysis turn: once any batch answers, `responseReceived` is permanently
      // true and can no longer tell an outstanding call apart from a finished one. `invocationCount
      // > responseCount` means, and only means, "a bridge call is in flight right now".
      const bridgeTelemetry = { invocationStarted: false, responseReceived: false, invocationCount: 0, responseCount: 0 };
      const governance = input.integral_v3_governance;
      // Durable batched checkpoint hooks: constructed exactly once, only for a claimed job whose
      // own executionMode is exactly 'durable_batched_v1', fenced by this claimed job's own
      // jobId/leaseId/idempotencyKey. A missing executionMode (every existing legacy/direct/
      // Manizales job) or an explicit 'single_turn_v1' never constructs an adapter, so
      // createRuntime never receives a checkpointHooks key at all on those paths.
      const checkpointHooks = job.executionMode === 'durable_batched_v1'
        ? createCheckpointAdapter(database, { jobId: job.jobId, leaseId: job.leaseId, idempotencyKey: job.idempotencyKey })
        : null;
      const engine = createRuntime({
        environment: frozenEnvironment(environment, input),
        countDailyRuns: () => countDailyRuns(database),
        legalCorpusContext: input.legal_corpus_context,
        manizalesManifestSource: input.manizales_manifest_source,
        onBridgeInvocationStarted: () => { bridgeTelemetry.invocationStarted = true; bridgeTelemetry.invocationCount += 1; },
        onBridgeResponseReceived: () => { bridgeTelemetry.responseReceived = true; bridgeTelemetry.responseCount += 1; },
        // Both live leases renew at every provider boundary: the runtime's own preview-claim
        // renewal (fenced by job.idempotencyKey + this claim) composes with the durable worker's
        // outer job-lease renewal (fenced by job.jobId + job.leaseId), never skipping either.
        database,
        previewClaim: { idempotencyKey: job.idempotencyKey, claimId: previewClaimId },
        ...(jobLeaseHeartbeat ? { beforeProviderCall: jobLeaseHeartbeat } : {}),
        ...(checkpointHooks ? { checkpointHooks } : {}),
        ...(governance ? {
          companyEvidenceRegistryEntries: governance.companyEvidenceRegistryEntries,
          // F4: the SAME frozen catalog snapshot the run identity was computed from — never
          // re-loaded or re-derived here.
          companyEvidenceInventorySnapshot: governance.companyEvidenceInventorySnapshot,
          // F4/A5: the SAME deterministic instant the frozen governance already carries — never
          // the wall clock, never re-derived here — so the durable engine's classes/identity bind
          // to it too.
          companyEvidenceAsOf: governance.evidenceAsOf,
          categoryOverrides: governance.categoryOverrides,
          evidenceClassLinkByRequirementId: governance.evidenceClassLinkByRequirementId,
          governanceProvenance: governance.governanceProvenance,
          contextVersionId: job.contextVersionId,
        } : {}),
      });

      const outcome = await runPostBridgeAnalysis(database, {
        opportunityId: job.opportunityId,
        tenderId: job.tenderId,
        snapshotId: job.snapshotId,
        contextVersionId: job.contextVersionId,
        attemptKey: job.idempotencyKey,
        correlationId: createCorrelationId(),
        claimId: previewClaimId,
        idempotencyKey: job.idempotencyKey,
        expectedIdempotencyKey: job.idempotencyKey,
        // Persistence is its own stage boundary (agt002-post-bridge-observability.js): the SAME
        // preview claim renews once more, fenced, immediately before the canonical persistence RPC.
        leaseSeconds,
        canonicalOnly: true,
        // F3: the SAME company evidence identity the frozen governance already carries — never
        // reloaded/re-derived here — so the durable persistence call binds to it too.
        evidenceIdentity: governance?.evidenceIdentity ?? null,
        // The frozen flags are the run's own governed truth: the enqueue that reserved
        // job.idempotencyKey bound the tender inventory into that identity if and only if
        // AGT002_DOCUMENT_RETRIEVAL was on. Requiring the inventory at persistence with
        // retrieval off would reject an envelope that legitimately has no evidence_coverage.
        requireTenderRequirementInventory: input.analysis_flags.AGT002_DOCUMENT_RETRIEVAL === true,
      }, {
        engine,
        observability,
        analysisContext: input.analysis_context,
        bridgeTelemetry,
        integralContractV3: input.analysis_flags.AGT002_INTEGRAL_CONTRACT_V3 === true,
        // Hard lease guard for the bounded in-memory persistence retry: no re-attempt may START
        // after this instant. The reserve keeps the durable attempt write, the claim release and
        // the queue's own terminal transition inside the very lease this claim funded, so a retry
        // can never be the reason a run is reclaimed mid-flight.
        persistenceRetry: {
          deadlineAt: leaseStartedAt + (leaseSeconds * 1000) - AGT002_PERSISTENCE_RETRY_LEASE_RESERVE_MS,
          now,
        },
      });
      previewClaimId = null;
      if (typeof outcome?.analysis_run_id === 'string' && outcome.analysis_run_id) {
        return { status: 'completed', analysis_run_id: outcome.analysis_run_id, error_code: null, reused: false };
      }
      return {
        status: 'unavailable',
        analysis_run_id: null,
        error_code: mapPostBridgeOutcomeCode(outcome?.error_code),
        reused: false,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        analysis_run_id: null,
        error_code: classifyAgt002ReanalysisWorkerError(error),
        reused: false,
      };
    } finally {
      if (previewClaimId) {
        try { await releasePreviewClaim(database, { idempotencyKey: job.idempotencyKey, claimId: previewClaimId }); }
        catch { /* lease is bounded; queue lease expiry closes the outer job */ }
      }
    }
  };
}
