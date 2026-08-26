import { ANALYSIS_FLAG_NAMES } from './agt002-analysis-config.js';

function object(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Hard ceiling the durable preview reservation accepts for a single claim lease. */
export const AGT002_MAX_PREVIEW_CLAIM_LEASE_SECONDS = 600;

/**
 * The durable claim lease one queued job needs, and the single source both the enqueue contract
 * and the worker executor read. A V3 run spends TWO sequential provider turns under one claim
 * (semantic discovery, then analysis) and `timeout_ms` bounds each turn independently, so each
 * turn rounds up to whole seconds on its own before they are summed, plus the executor's 30s
 * buffer. The result is NEVER clamped: clamping hands back a lease that silently underfunds both
 * turns and the run is reclaimed mid-flight after the provider has already been paid.
 */
export function agt002RequiredPreviewClaimLeaseSeconds(timeoutMs) {
  return 2 * Math.ceil(timeoutMs / 1000) + 30;
}

/**
 * Whether a job frozen with this turn timeout can ever be executed. The worker rejects an
 * unfundable lease BEFORE claiming, on every cycle, so queueing one only creates a corrida that
 * dies without ever reaching the provider — the enqueue side must refuse exactly what the worker
 * refuses. 285_000ms is the largest fundable timeout (2*285+30 = 600 exactly); 285_001ms needs
 * 602s and is refused here instead of being queued and rejected later.
 */
export function isAgt002QueueableTimeoutMs(timeoutMs) {
  return Number.isInteger(timeoutMs)
    && timeoutMs > 0
    && agt002RequiredPreviewClaimLeaseSeconds(timeoutMs) <= AGT002_MAX_PREVIEW_CLAIM_LEASE_SECONDS;
}

function cloneJson(value, label) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
    return JSON.parse(serialized);
  } catch {
    throw new Error(`AGT-002 reanalysis ${label} must be JSON-safe.`);
  }
}

/** Creates the immutable, non-secret engine input persisted with a queue job. */
export function buildAgt002FrozenEngineInput({
  runtimeConfig,
  analysisConfig,
  analysisContext,
  legalCorpusContext = null,
  integralV3Governance = null,
  manizalesManifestSource = null,
  idempotencyKey,
} = {}) {
  if (!object(runtimeConfig)
    || typeof runtimeConfig.model !== 'string' || !runtimeConfig.model.trim()
    || typeof runtimeConfig.policyVersion !== 'string' || !runtimeConfig.policyVersion.trim()
    || !isAgt002QueueableTimeoutMs(runtimeConfig.timeoutMs)
    || !Number.isInteger(runtimeConfig.dailyMaxRuns) || runtimeConfig.dailyMaxRuns <= 0
    || !Number.isInteger(runtimeConfig.maxConcurrent) || runtimeConfig.maxConcurrent <= 0
    || !object(analysisConfig) || analysisConfig.AGT002_CANONICAL_ONLY !== true
    || !object(analysisContext) || analysisContext.canonicalOnly !== true
    || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw new Error('AGT-002 reanalysis frozen input is invalid.');
  }
  if (analysisConfig.AGT002_INTEGRAL_CONTRACT_V3 === true && !object(integralV3Governance)) {
    throw new Error('AGT-002 reanalysis frozen governance is required.');
  }
  if (analysisConfig.AGT002_LEGAL_CORPUS === true && !object(legalCorpusContext)) {
    throw new Error('AGT-002 reanalysis frozen legal corpus is required.');
  }

  const flags = {};
  for (const name of ANALYSIS_FLAG_NAMES) flags[name] = analysisConfig[name] === true;
  return Object.freeze(cloneJson({
    schema_version: 1,
    engine_identity: {
      model: runtimeConfig.model.trim(),
      policy_version: runtimeConfig.policyVersion.trim(),
      timeout_ms: runtimeConfig.timeoutMs,
      daily_max_runs: runtimeConfig.dailyMaxRuns,
      max_concurrent: runtimeConfig.maxConcurrent,
      idempotency_key: idempotencyKey.trim(),
    },
    analysis_flags: flags,
    analysis_context: analysisContext,
    legal_corpus_context: legalCorpusContext,
    integral_v3_governance: integralV3Governance,
    manizales_manifest_source: manizalesManifestSource,
  }, 'input'));
}
