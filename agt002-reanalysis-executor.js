import { randomUUID } from 'node:crypto';
import { ANALYSIS_FLAG_NAMES } from './agt002-analysis-config.js';
import { createAgt002AnalysisObservability } from './agt002-analysis-observability.js';
import { runAgt002PostBridgeAnalysis } from './agt002-post-bridge-observability.js';
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

function mapPostBridgeOutcomeCode(value) {
  const code = String(value || '').toUpperCase();
  if (code.includes('TRANSPORT') || code.includes('TIMEOUT')) return 'timeout';
  if (code.includes('PERSIST')) return 'persistence_failure';
  if (code.includes('CONTENT') || code.includes('JSON') || code.includes('INVALID') || code.includes('VALIDATION') || code.includes('ENVELOPE')) return 'invalid_output';
  return 'provider_error';
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

      const bridgeTelemetry = { invocationStarted: false, responseReceived: false };
      const governance = input.integral_v3_governance;
      const engine = createRuntime({
        environment: frozenEnvironment(environment, input),
        countDailyRuns: () => countDailyRuns(database),
        legalCorpusContext: input.legal_corpus_context,
        manizalesManifestSource: input.manizales_manifest_source,
        onBridgeInvocationStarted: () => { bridgeTelemetry.invocationStarted = true; },
        onBridgeResponseReceived: () => { bridgeTelemetry.responseReceived = true; },
        // Both live leases renew at every provider boundary: the runtime's own preview-claim
        // renewal (fenced by job.idempotencyKey + this claim) composes with the durable worker's
        // outer job-lease renewal (fenced by job.jobId + job.leaseId), never skipping either.
        database,
        previewClaim: { idempotencyKey: job.idempotencyKey, claimId: previewClaimId },
        ...(jobLeaseHeartbeat ? { beforeProviderCall: jobLeaseHeartbeat } : {}),
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
