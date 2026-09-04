import { createAgt002HetznerBridgeClient } from './agt002-hetzner-bridge-client.js';
import { AGT002_PREVIEW_POLICY, AGT002_INTEGRAL_V3_POLICY, createAgt002PreviewEngine } from './agt002-preview-engine.js';
import { buildAgt002AnalysisConfig } from './agt002-analysis-config.js';
import { AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS } from './agt002-v3-prompt-budget.js';
import { retrieveAgt002LegalEvidence } from './agt002-legal-retrieval.js';
import { discoverTenderSemanticManifest } from './tender-semantic-discovery.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT, isAgt002PreviewReasoningEffort } from './agt002-preview-reasoning-effort.js';
import { validateAgt002CompanyEvidenceAsOf } from './agt002-company-evidence-identity.js';
import { validateAgt002CompanyEvidenceInventorySnapshot } from './agt002-company-evidence-sharepoint-catalog.js';
import { renewAgt002PreviewClaim } from './agt002-preview-persistence.js';

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
  // AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS (agt002-v3-prompt-budget.js) is a safe FLOOR —
  // 81284 was the largest prompt a non-V3 run is KNOWN to have been admitted at, not a measured
  // window. A real V3 canary (18 semantic-discovery provider turns) later failed closed under
  // that floor with `v3_prompt_budget_exceeded`. The Codex model cache for the actual pilot
  // model (gpt-5.6-luna) reports context_window=272000 / effective context=258400, and the
  // bridge separately accepted a 156226-input-token request — both comfortably above the floor.
  // Rather than hardcode a new constant ahead of a fully reconfirmed number, this override lets
  // the operator raise the cap from server-owned configuration only (never a caller/browser
  // value), exactly like every other AGT002_PREVIEW_* numeric override above/below. Absent, it
  // defaults to the unchanged safe floor, so behavior is byte-identical to before this override
  // existed.
  const promptMaxInputTokens = positiveIntFromEnv(environment, 'AGT002_PREVIEW_PROMPT_MAX_INPUT_TOKENS', AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS);
  // A V3 run spends TWO sequential provider turns under one reservation — semantic discovery
  // (discoverTenderSemanticManifest) and then the analysis turn — and `timeoutMs` bounds EACH
  // turn independently, so each turn is rounded up to whole seconds on its own before they are
  // summed, plus a 15s buffer. A lease sized for a single turn expires while the analysis turn
  // is still in flight and the run gets reclaimed underneath itself.
  const leaseSeconds = 2 * Math.ceil(timeoutMs / 1000) + 15;
  if (!Number.isInteger(timeoutMs) || !Number.isInteger(maxConcurrent) || !Number.isInteger(dailyMaxRuns) || !Number.isInteger(promptMaxInputTokens) || leaseSeconds > 600) {
    throw new Error('AGT-002 Preview no está configurado.');
  }
  // Fail-closed, explicit per-turn reasoning effort (AGT-002 root cause: an inherited Codex CLI
  // default effort emitted its final structured response only near the fixed 285_000ms per-turn
  // deadline). Absence defaults to the fastest operationally-validated level; an explicit but
  // unsupported/malformed override is rejected exactly like the other numeric overrides above —
  // never silently coerced or ignored.
  const effort = nonEmpty(environment.AGT002_PREVIEW_REASONING_EFFORT)
    ? environment.AGT002_PREVIEW_REASONING_EFFORT.trim()
    : AGT002_PREVIEW_DEFAULT_REASONING_EFFORT;
  if (!isAgt002PreviewReasoningEffort(effort)) {
    throw new Error('AGT-002 Preview no está configurado.');
  }
  return {
    model: environment.AGT002_PREVIEW_MODEL.trim(),
    policyVersion: nonEmpty(environment.AGT002_PREVIEW_POLICY_VERSION) ? environment.AGT002_PREVIEW_POLICY_VERSION.trim() : AGT002_PREVIEW_DEFAULT_POLICY_VERSION,
    timeoutMs,
    maxConcurrent,
    dailyMaxRuns,
    leaseSeconds,
    effort,
    promptMaxInputTokens,
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
  companyEvidenceRegistryEntries, companyEvidenceAsOf, companyEvidenceInventorySnapshot, categoryOverrides, evidenceClassLinkByRequirementId, governanceProvenance, contextVersionId,
  manizalesManifestSource,
  onBridgeInvocationStarted, onBridgeResponseReceived,
  // Deterministic stage-boundary heartbeat: given the claim (migration 028's
  // psi_agt002_preview_claims + its claim_id fencing token) this run is executing under, the
  // runtime builds ONE renewal hook fenced by THIS run's own idempotencyKey+claimId and hands it
  // to the engine as `beforeProviderCall` — so a V7 run whose N provider turns outlive a
  // two-turn-sized lease renews at each stage boundary instead of being reclaimed underneath
  // itself. `previewClaim` absent (every existing caller) keeps the engine options exactly what
  // they are today: the heartbeat is never fabricated.
  database, previewClaim,
  // An already-fenced heartbeat from an OUTER lease this run also lives inside (e.g. the durable
  // reanalysis worker's own job/lease_id renewal) — composed with the claim renewal above, never
  // replacing it, so both live leases renew at every provider boundary. `undefined` (every direct
  // caller) leaves the claim renewal, if any, exactly as it is on its own.
  beforeProviderCall: outerBeforeProviderCall,
  // AGT-002 durable batched analysis, Task 2: the already-built `{ loadCheckpoint, storeCheckpoint }`
  // hooks (agt002-reanalysis-executor.js constructs them via agt002-analysis-checkpoints.js, only
  // for a claimed durable_batched_v1 job). Absent (every non-durable/direct/Manizales caller today),
  // forwarded nowhere — engine construction stays byte-identical to before this option existed.
  checkpointHooks,
  createEngine = createAgt002PreviewEngine,
} = {}) {
  const { config, analysisConfig } = withRuntimeBoundaryCode('AGT002_RUNTIME_CONFIG_INVALID', () => ({
    config: getAgt002PreviewRuntimeConfig(environment),
    analysisConfig: buildAgt002AnalysisConfig(environment),
  }));
  const hasPreviewClaim = previewClaim && typeof previewClaim === 'object'
    && typeof previewClaim.idempotencyKey === 'string' && previewClaim.idempotencyKey
    && typeof previewClaim.claimId === 'string' && previewClaim.claimId;
  const claimRenewalHook = hasPreviewClaim
    ? () => renewAgt002PreviewClaim(database, {
      idempotencyKey: previewClaim.idempotencyKey,
      claimId: previewClaim.claimId,
      leaseSeconds: config.leaseSeconds,
    })
    : null;
  const hasOuterHook = typeof outerBeforeProviderCall === 'function';
  const beforeProviderCall = (hasOuterHook || claimRenewalHook)
    ? async () => {
      if (hasOuterHook) await outerBeforeProviderCall();
      if (claimRenewalHook) await claimRenewalHook();
    }
    : undefined;
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
    // F4: a real V3 run must never derive its company-evidence classes/identity from the wall
    // clock — the deterministic instant (agt002-company-evidence-identity.js's own
    // deriveAgt002CompanyEvidenceAsOf, run against the SAME registry rows above) is required
    // alongside the registry, exactly like legalCorpusContext is required alongside legalCorpus.
    if (analysisConfig.AGT002_INTEGRAL_CONTRACT_V3 && (typeof companyEvidenceAsOf !== 'string' || !companyEvidenceAsOf.trim())) {
      throw new Error('AGT-002 Preview no está configurado: AGT002_INTEGRAL_CONTRACT_V3 requiere companyEvidenceAsOf inyectado explícitamente.');
    }
    // Canonical format only — never merely Date-parseable — so an offset, a non-midnight time
    // or a calendar-impossible date is rejected here, at engine construction, rather than
    // silently reaching buildAgt002CompanyEvidenceClasses.
    if (analysisConfig.AGT002_INTEGRAL_CONTRACT_V3) {
      try {
        validateAgt002CompanyEvidenceAsOf(companyEvidenceAsOf);
      } catch {
        throw new Error('AGT-002 Preview no está configurado: companyEvidenceAsOf debe tener el formato canónico UTC de inicio de día YYYY-MM-DDT00:00:00.000Z.');
      }
    }
    // F4: mirrors the registry/asOf requirement above — a real V3 run must never analyze
    // against no company-evidence inventory at all (that reads as "no historical evidence
    // exists", the opposite of the truth). The server layer loads it once, alongside the
    // registry, and injects it here; this runtime never queries the catalog itself.
    if (analysisConfig.AGT002_INTEGRAL_CONTRACT_V3) {
      if (companyEvidenceInventorySnapshot === undefined) {
        throw new Error('AGT-002 Preview no está configurado: AGT002_INTEGRAL_CONTRACT_V3 requiere un inventario SharePoint de evidencia empresarial inyectado explícitamente.');
      }
      // Re-validated here (never trusted verbatim), exactly like every other governed value
      // this boundary checks — a malformed snapshot fails closed at construction, never
      // reaching the engine's class builder mid-run.
      validateAgt002CompanyEvidenceInventorySnapshot(companyEvidenceInventorySnapshot);
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
    effort: config.effort,
    contextV2: analysisConfig.AGT002_CONTEXT_V2,
    documentRetrieval: analysisConfig.AGT002_DOCUMENT_RETRIEVAL,
    legalCorpus: analysisConfig.AGT002_LEGAL_CORPUS,
    legalEvidenceProvider,
    ...(loadedLegalCorpus ? {
      legalCorpusVersionId: loadedLegalCorpus.legal_corpus_version_id,
      legalCorpusContentSha256: loadedLegalCorpus.content_sha256,
    } : {}),
    ...(beforeProviderCall ? { beforeProviderCall } : {}),
    integralContractV3: analysisConfig.AGT002_INTEGRAL_CONTRACT_V3,
    ...(analysisConfig.AGT002_INTEGRAL_CONTRACT_V3 ? {
      companyEvidenceClassesProvider: () => companyEvidenceRegistryEntries,
      companyEvidenceAsOf,
      companyEvidenceInventorySnapshot,
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
      // unchanged.
      promptBudget: true,
      // config.promptMaxInputTokens (getAgt002PreviewRuntimeConfig above) defaults to the safe-floor
      // constant AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS = 81_284, which is anchored to the
      // observed prod plateau, NOT a measured model window — a real V3 canary (18 semantic-discovery
      // provider turns) later failed closed under exactly that floor with `v3_prompt_budget_exceeded`,
      // even though the Codex model cache for the pilot model (gpt-5.6-luna) reports
      // context_window=272000 / effective context=258400, and the bridge separately accepted a
      // 156226-input-token request. The cap is raised only via the server-owned
      // AGT002_PREVIEW_PROMPT_MAX_INPUT_TOKENS env override — never from request/caller input — and
      // scoped here to the V3 path exactly like promptBudget itself; a legacy (non-V3) runtime never
      // forwards it. Absent, this is byte-identical to before the override existed.
      promptMaxInputTokens: config.promptMaxInputTokens,
    } : {}),
    ...(countDailyRuns ? { countDailyRuns } : {}),
    ...(checkpointHooks ? { checkpointHooks } : {}),
  }));
}
