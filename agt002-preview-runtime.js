import { createAgt002HetznerBridgeClient } from './agt002-hetzner-bridge-client.js';
import { AGT002_PREVIEW_POLICY, createAgt002PreviewEngine } from './agt002-preview-engine.js';
import { buildAgt002AnalysisConfig } from './agt002-analysis-config.js';
import { retrieveAgt002LegalEvidence } from './agt002-legal-retrieval.js';

export const AGT002_PREVIEW_ENGINE_ID = 'agt002_codex_preview';
const REQUIRED_ENV_KEYS = ['AGT002_PREVIEW_MODEL', 'AGT002_HETZNER_BRIDGE_URL', 'AGT002_HETZNER_BRIDGE_HMAC_SECRET'];
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_DAILY_MAX_RUNS = 20;
export const AGT002_PREVIEW_DEFAULT_POLICY_VERSION = 'agt002-preview-policy-v2';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
  const leaseSeconds = Math.ceil(timeoutMs / 1000) + 15;
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
  onBridgeInvocationStarted,
  createEngine = createAgt002PreviewEngine,
} = {}) {
  const config = getAgt002PreviewRuntimeConfig(environment);
  const analysisConfig = buildAgt002AnalysisConfig(environment);
  const loadedLegalCorpus = analysisConfig.AGT002_LEGAL_CORPUS ? requireLegalCorpusContext(legalCorpusContext) : null;
  const legalEvidenceProvider = loadedLegalCorpus ? createLegalEvidenceProvider(loadedLegalCorpus, environment) : undefined;

  // AGT002_INTEGRAL_CONTRACT_V3: mirrors the legalCorpusContext pattern above — the
  // server layer loads the 17-class company-evidence registry once (from DB, migration
  // 061) and injects the raw rows here; this runtime never queries a database itself.
  // Without an explicit injection the flag fails closed at engine construction, exactly
  // like legalCorpus does without a legalCorpusContext.
  if (analysisConfig.AGT002_INTEGRAL_CONTRACT_V3 && !Array.isArray(companyEvidenceRegistryEntries)) {
    throw new Error('AGT-002 Preview no está configurado: AGT002_INTEGRAL_CONTRACT_V3 requiere un registro de evidencia empresarial inyectado explícitamente.');
  }

  const bridgeClient = createAgt002HetznerBridgeClient({
    url: environment.AGT002_HETZNER_BRIDGE_URL,
    hmacSecret: environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET,
  });
  const client = typeof onBridgeInvocationStarted === 'function'
    ? Object.freeze({
      run: request => {
        onBridgeInvocationStarted();
        return bridgeClient.run(request);
      },
    })
    : bridgeClient;

  return createEngine({
    client,
    model: config.model,
    policyVersion: config.policyVersion,
    policyText: AGT002_PREVIEW_POLICY,
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
      categoryOverrides: categoryOverrides ?? {},
      evidenceClassLinkByRequirementId: evidenceClassLinkByRequirementId ?? {},
      governanceProvenance: governanceProvenance ?? {},
      contextVersionId: contextVersionId ?? null,
    } : {}),
    ...(countDailyRuns ? { countDailyRuns } : {}),
  });
}
