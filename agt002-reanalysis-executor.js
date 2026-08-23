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
import { classifyAgt002ReanalysisWorkerError } from './agt002-reanalysis-worker.js';

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Hard ceiling the durable preview reservation accepts for a single claim lease. */
const MAX_PREVIEW_CLAIM_LEASE_SECONDS = 600;

/**
 * Single deterministic source for the durable preview claim lease, so the validation gate and
 * the claim itself can never drift apart. A V3 run spends TWO sequential provider turns under
 * one claim (semantic discovery, then analysis) and `timeout_ms` bounds each turn independently,
 * so each turn rounds up to whole seconds on its own before they are summed, plus the executor's
 * 30s buffer. The result is NEVER clamped: clamping would hand back a lease that silently
 * underfunds both turns and the run would be reclaimed mid-flight after the provider is paid.
 */
function requiredPreviewClaimLeaseSeconds(timeoutMs) {
  return 2 * Math.ceil(timeoutMs / 1000) + 30;
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
  // A timeout whose two-turn lease the reservation ceiling cannot fund is a frozen-config error,
  // not a capacity state: reject it here — before any claim, runtime construction or post-bridge
  // call — exactly like the other pre-claim validation failures. 285_000ms is the largest fundable
  // timeout (2*285+30 = 600 exactly); 285_001ms needs 602s and is rejected.
  if (requiredPreviewClaimLeaseSeconds(identity.timeout_ms) > MAX_PREVIEW_CLAIM_LEASE_SECONDS) return null;
  if (identity.idempotency_key != null && identity.idempotency_key !== job.idempotencyKey) return null;
  if (context?.opportunity?.id !== job.opportunityId
    || context.snapshotId !== job.snapshotId
    || context.canonicalOnly !== true
    || flags.AGT002_CANONICAL_ONLY !== true) return null;
  if (flags.AGT002_INTEGRAL_CONTRACT_V3 === true && !isObject(input.integral_v3_governance)) return null;
  if (flags.AGT002_LEGAL_CORPUS === true && !isObject(input.legal_corpus_context)) return null;
  return input;
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
 * Builds the direct-host executor. The legacy preview claim is acquired only
 * immediately before engine construction. runAgt002PostBridgeAnalysis owns
 * that claim once invoked; any earlier failure releases it exactly once.
 */
export function createAgt002ReanalysisExecutor({
  environment = process.env,
  claimPreviewRun = claimAgt002PreviewRun,
  findPreviewRun = findAgt002PreviewRun,
  releasePreviewClaim = releaseAgt002PreviewClaim,
  countDailyRuns = countAgt002PreviewRunsToday,
  createRuntime = createAgt002PreviewRuntime,
  runPostBridgeAnalysis = runAgt002PostBridgeAnalysis,
  createCorrelationId = randomUUID,
  observability = createAgt002AnalysisObservability(),
} = {}) {
  return async function executeAgt002Reanalysis(database, job) {
    const input = validFrozenInput(job);
    if (!input) return { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false };

    const identity = input.engine_identity;
    // Never clamped — validFrozenInput already rejected anything the ceiling cannot fund.
    const leaseSeconds = requiredPreviewClaimLeaseSeconds(identity.timeout_ms);
    let previewClaimId = null;
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
        ...(governance ? {
          companyEvidenceRegistryEntries: governance.companyEvidenceRegistryEntries,
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
        canonicalOnly: true,
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
