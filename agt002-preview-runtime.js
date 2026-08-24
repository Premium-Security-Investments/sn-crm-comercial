import { createAgt002HetznerBridgeClient } from './agt002-hetzner-bridge-client.js';
import { AGT002_PREVIEW_POLICY, AGT002_INTEGRAL_V3_POLICY, createAgt002PreviewEngine } from './agt002-preview-engine.js';
import { buildAgt002AnalysisConfig } from './agt002-analysis-config.js';
import { retrieveAgt002LegalEvidence } from './agt002-legal-retrieval.js';
import { discoverTenderSemanticManifest } from './tender-semantic-discovery.js';

export const AGT002_PREVIEW_ENGINE_ID = 'agt002_codex_preview';
const REQUIRED_ENV_KEYS = ['AGT002_PREVIEW_MODEL', 'AGT002_HETZNER_BRIDGE_URL', 'AGT002_HETZNER_BRIDGE_HMAC_SECRET'];
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_DAILY_MAX_RUNS = 20;
export const AGT002_PREVIEW_DEFAULT_POLICY_VERSION = 'agt002-preview-policy-v2';
// v3: AGT002_INTEGRAL_V3_POLICY now states the milestone relationships already enforced
// fail-closed by validateAgt002IntegralAnalysisV3: verified requires non-null at/source_ref,
// while not_identified requires both null. Provenance must distinguish this materially aligned prompt.
// v4: the governed frontier of a non-pilot V3 run is no longer the fixed historical deep-analysis
// matrix — it is discovered from THIS process's own expediente by discoverTenderSemanticManifest
// before the analysis turn. The requirements the model is asked about therefore differ materially
// from a v3 run, so the persisted policy version must tell the two apart.
// v5: the model-facing input of a DISCOVERED-frontier run changed, and AGT002_INTEGRAL_V3_POLICY
// changed with it. The provider no longer receives the two full per-source-unit audit ledgers
// (tender_requirement_inventory / tender_semantic_manifest) — which on a real expediente are tens of
// thousands of entries and exhausted the prompt budget before the analysis turn — but a server-
// derived `semantic_frontier_summary` of their arithmetic, while the durable envelope keeps both
// ledgers complete. What the model is shown and told is therefore materially different from a v4
// run, so the persisted policy version must tell the two apart. The OUTPUT contract is unchanged.
export const AGT002_INTEGRAL_V3_POLICY_VERSION = 'agt002-integral-v3-policy-v5';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function withRuntimeBoundaryCode(code, operation) {
  try {
    return operation();
  } catch (error) {
    if (error && (typeof error === 'object' || typeof error === 'function')) {
      try { error.runtime_boundary_code = code; } catch { /* use the safe wrapper below */ }
      if (error.runtime_boundary_code === code) throw error;
    }
    const boundaryError = new Error('AGT-002 Preview no está disponible.', { cause: error });
    boundaryError.runtime_boundary_code = code;
    throw boundaryError;
  }
}

function legalAsOf(environment) {
  const value = environment.AGT002_LEGAL_AS_OF || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new Error('AGT002_LEGAL_AS_OF no es una fecha ISO válida.');
  }
  return value;
}

/**
 * The runtime never loads the legal corpus itself: the server layer loads it once from
 * the published DB rows (agt002-legal-corpus-store.js) and injects the immutable result
 * here, so this validates the caller's context instead of touching the filesystem or a
 * network client.
 */
function requireLegalCorpusContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || typeof context.legal_corpus_version_id !== 'string' || !context.legal_corpus_version_id.trim()
    || typeof context.corpus_version !== 'string' || !context.corpus_version.trim()
    || typeof context.content_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(context.content_sha256)
    || !context.corpus || typeof context.corpus !== 'object' || Array.isArray(context.corpus)) {
    throw new Error('AGT-002 Preview requiere un corpus jurídico publicado inyectado explícitamente y válido.');
  }
  return context;
}

function createLegalEvidenceProvider(legalCorpusContext, environment) {
  const { corpus, corpus_version: corpusVersion } = legalCorpusContext;
  const asOf = legalAsOf(environment);
  const topics = [...new Set(corpus.sources.flatMap(source => source.topic))].sort();
  const sector = [...new Set(corpus.sources.flatMap(source => source.sector))].sort();
  return () => retrieveAgt002LegalEvidence({ corpus, corpus_version: corpusVersion, as_of: asOf, topics, sector });
}

/** Checked before anything else: no client is ever constructed unless every required variable is present. */
export function isAgt002PreviewConfigured(environment = process.env) {
  return environment?.TENDER_ANALYSIS_ENGINE === AGT002_PREVIEW_ENGINE_ID
    && REQUIRED_ENV_KEYS.every(key => nonEmpty(environment[key]));
}

/** Single validated source for both the DB reservation and local runtime limits. */
export function getAgt002PreviewRuntimeConfig(environment = process.env) {
  if (!isAgt002PreviewConfigured(environment)) throw new Error('AGT-002 Preview no está configurado.');
  const timeoutMs = positiveIntFromEnv(environment, 'AGT002_PREVIEW_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxConcurrent = positiveIntFromEnv(environment, 'AGT002_PREVIEW_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT);
  const dailyMaxRuns = positiveIntFromEnv(environment, 'AGT002_PREVIEW_DAILY_MAX_RUNS', DEFAULT_DAILY_MAX_RUNS);
  // A V3 run spends TWO sequential provider turns under one reservation — semantic discovery
  // (discoverTenderSemanticManifest) and then the analysis turn — and `timeoutMs` bounds EACH
  // turn independently, so each turn is rounded up to whole seconds on its own before they are
  // summed, plus a 15s buffer. A lease sized for a single turn expires while the analysis turn
  // is still in flight and the run gets reclaimed underneath itself.
  const leaseSeconds = 2 * Math.ceil(timeoutMs / 1000) + 15;
  if (!Number.isInteger(timeoutMs) || !Number.isInteger(maxConcurrent) || !Number.isInteger(dailyMaxRuns) || leaseSeconds > 600) {
    throw new Error('AGT-002 Preview no está configurado.');
  }
  return {
    model: environment.AGT002_PREVIEW_MODEL.trim(),
    policyVersion: nonEmpty(environment.AGT002_PREVIEW_POLICY_VERSION) ? environment.AGT002_PREVIEW_POLICY_VERSION.trim() : AGT002_PREVIEW_DEFAULT_POLICY_VERSION,
    timeoutMs,
    maxConcurrent,
    dailyMaxRuns,
    leaseSeconds,
  };
}

function positiveIntFromEnv(environment, key, fallback) {
  if (!nonEmpty(environment[key])) return fallback;
  const parsed = Number(environment[key]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

/**
 * Builds the AGT-002 Preview engine from server-side configuration only.
 * Fails closed (throws) when unconfigured or malformed — callers must catch
 * and keep the deterministic rules-based analysis available.
 */
export function createAgt002PreviewRuntime({
  environment = process.env, countDailyRuns, legalCorpusContext,
  companyEvidenceRegistryEntries, categoryOverrides, evidenceClassLinkByRequirementId, governanceProvenance, contextVersionId,
  manizalesManifestSource,
  onBridgeInvocationStarted, onBridgeResponseReceived,
  createEngine = createAgt002PreviewEngine,
} = {}) {
  const { config, analysisConfig } = withRuntimeBoundaryCode('AGT002_RUNTIME_CONFIG_INVALID', () => ({
    config: getAgt002PreviewRuntimeConfig(environment),
    analysisConfig: buildAgt002AnalysisConfig(environment),
  }));
  const { loadedLegalCorpus, legalEvidenceProvider } = withRuntimeBoundaryCode('AGT002_RUNTIME_LEGAL_CORPUS_INVALID', () => {
    const corpus = analysisConfig.AGT002_LEGAL_CORPUS ? requireLegalCorpusContext(legalCorpusContext) : null;
    return {
      loadedLegalCorpus: corpus,
      legalEvidenceProvider: corpus ? createLegalEvidenceProvider(corpus, environment) : undefined,
    };
  });

  // AGT002_INTEGRAL_CONTRACT_V3: mirrors the legalCorpusContext pattern above — the
  // server layer loads the 17-class company-evidence registry once (from DB, migration
  // 061) and injects the raw rows here; this runtime never queries a database itself.
  // Without an explicit injection the flag fails closed at engine construction, exactly
  // like legalCorpus does without a legalCorpusContext.
  withRuntimeBoundaryCode('AGT002_RUNTIME_GOVERNANCE_INVALID', () => {
    if (analysisConfig.AGT002_INTEGRAL_CONTRACT_V3 && !Array.isArray(companyEvidenceRegistryEntries)) {
      throw new Error('AGT-002 Preview no está configurado: AGT002_INTEGRAL_CONTRACT_V3 requiere un registro de evidencia empresarial inyectado explícitamente.');
    }
  });

  const bridgeClient = withRuntimeBoundaryCode('AGT002_RUNTIME_BRIDGE_CLIENT_INVALID', () => createAgt002HetznerBridgeClient({
    url: environment.AGT002_HETZNER_BRIDGE_URL,
    hmacSecret: environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET,
  }));
  const hasBridgeInvocationHook = typeof onBridgeInvocationStarted === 'function';
  // `onBridgeResponseReceived` mirrors `onBridgeInvocationStarted`: purely observational, never
  // changes what is sent, what is returned, or how an error propagates. It fires ONLY after
  // bridgeClient.run has actually resolved — never on rejection/throw — so a caller can tell
  // "the bridge answered" apart from "the bridge call itself failed" without this runtime (or
  // the bridge client it wraps) changing in any other way.
  const hasBridgeResponseHook = typeof onBridgeResponseReceived === 'function';
  const client = (hasBridgeInvocationHook || hasBridgeResponseHook)
    ? Object.freeze({
      run: async request => {
        if (hasBridgeInvocationHook) onBridgeInvocationStarted();
        const response = await bridgeClient.run(request);
        if (hasBridgeResponseHook) onBridgeResponseReceived();
        return response;
      },
    })
    : bridgeClient;

  return withRuntimeBoundaryCode('AGT002_RUNTIME_ENGINE_CREATION_FAILED', () => createEngine({
    client,
    model: config.model,
    policyVersion: analysisConfig.AGT002_INTEGRAL_CONTRACT_V3
      ? AGT002_INTEGRAL_V3_POLICY_VERSION
      : config.policyVersion,
    policyText: analysisConfig.AGT002_INTEGRAL_CONTRACT_V3
      ? AGT002_INTEGRAL_V3_POLICY
      : AGT002_PREVIEW_POLICY,
    timeoutMs: config.timeoutMs,
    maxConcurrent: config.maxConcurrent,
    dailyMaxRuns: config.dailyMaxRuns,
    contextV2: analysisConfig.AGT002_CONTEXT_V2,
    documentRetrieval: analysisConfig.AGT002_DOCUMENT_RETRIEVAL,
    legalCorpus: analysisConfig.AGT002_LEGAL_CORPUS,
    legalEvidenceProvider,
    ...(loadedLegalCorpus ? {
      legalCorpusVersionId: loadedLegalCorpus.legal_corpus_version_id,
      legalCorpusContentSha256: loadedLegalCorpus.content_sha256,
    } : {}),
    integralContractV3: analysisConfig.AGT002_INTEGRAL_CONTRACT_V3,
    ...(analysisConfig.AGT002_INTEGRAL_CONTRACT_V3 ? {
      companyEvidenceClassesProvider: () => companyEvidenceRegistryEntries,
      // The semantic discovery stage is not behind an env flag: a V3 run built by this runtime is
      // always a production run, and a production run must derive its frontier from the process's
      // own expediente. Direct engine callers (unit tests, canary scripts) leave the provider unset
      // and keep the legacy fixed-matrix frontier.
      semanticDiscoveryProvider: discoverTenderSemanticManifest,
      categoryOverrides: categoryOverrides ?? {},
      evidenceClassLinkByRequirementId: evidenceClassLinkByRequirementId ?? {},
      governanceProvenance: governanceProvenance ?? {},
      contextVersionId: contextVersionId ?? null,
      // AGT002_INTEGRAL_CONTRACT_V3 Phase 3: the server layer loads the checked-in pilot
      // manifest read-only and injects it here for the exact Manizales opportunity/process
      // only, mirroring the company-evidence registry/category-override injection above. The
      // engine validates it fail-closed (wrong pilot/malformed throws through the boundary
      // wrapper below); an absent source keeps the current governed 4-requirement behavior.
      manizalesManifestSource: manizalesManifestSource ?? null,
      // Phase 9 (T7): the deterministic server-owned prompt budget is now ACTIVE for every V3
      // runtime construction (it was previously wired into runOnceV3 but left dormant at its
      // default-off, reachable only by a canary script). Enabling it here means an oversized V3
      // request is deterministically reduced (summarize omitted_chunks, then water-fill-truncate
      // selected_chunks[].text with provenance) or FAILS CLOSED with AGT002_V3_PROMPT_BUDGET_EXCEEDED
      // *before* any provider call — strictly safer than shipping an over-window prompt and getting
      // a non-deterministic context_window_exceeded from the model. A request already under budget is
      // byte-identical (the engine returns the same input reference), so non-oversized runs are
      // unchanged. The engine's default cap (AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS = 81_284) is a
      // conservative floor anchored to the observed prod plateau, NOT a measured model window; it must
      // be reconfirmed/raised against the real model context window before any authorized live run.
      promptBudget: true,
    } : {}),
    ...(countDailyRuns ? { countDailyRuns } : {}),
  }));
}
