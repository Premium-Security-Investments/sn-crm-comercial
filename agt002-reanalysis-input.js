import { ANALYSIS_FLAG_NAMES } from './agt002-analysis-config.js';

function object(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
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
    || !Number.isInteger(runtimeConfig.timeoutMs) || runtimeConfig.timeoutMs <= 0 || runtimeConfig.timeoutMs > 480_000
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
