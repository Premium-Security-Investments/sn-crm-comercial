import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { AGT002_PREVIEW_POLICY, AGT002_INTEGRAL_V3_POLICY } from '../agt002-preview-engine.js';
import { AGT002_PREVIEW_DEFAULT_POLICY_VERSION, AGT002_INTEGRAL_V3_POLICY_VERSION, createAgt002PreviewRuntime, getAgt002PreviewRuntimeConfig, isAgt002PreviewConfigured } from '../agt002-preview-runtime.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT } from '../agt002-preview-reasoning-effort.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION } from '../agt002-company-evidence-sharepoint-catalog.js';
import { AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS } from '../agt002-v3-prompt-budget.js';

function baseEnv(overrides = {}) {
  return {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'synthetic-codex-model',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
    ...overrides,
  };
}

assert.equal(isAgt002PreviewConfigured({}), false);
assert.equal(isAgt002PreviewConfigured(baseEnv({ TENDER_ANALYSIS_ENGINE: undefined })), false);
assert.equal(isAgt002PreviewConfigured(baseEnv({ TENDER_ANALYSIS_ENGINE: 'agt002_openai_preview' })), false, 'only the Codex App Server engine id is accepted; the legacy OpenAI-key plan id must not silently enable this runtime');
assert.equal(isAgt002PreviewConfigured(baseEnv({ AGT002_PREVIEW_MODEL: '' })), false);
assert.equal(isAgt002PreviewConfigured(baseEnv({ AGT002_HETZNER_BRIDGE_URL: '   ' })), false);
assert.equal(isAgt002PreviewConfigured(baseEnv({ AGT002_HETZNER_BRIDGE_HMAC_SECRET: '   ' })), false);
assert.equal(isAgt002PreviewConfigured(baseEnv()), true);

// Fails closed when unconfigured; never constructs a client/spawns anything.
assert.throws(() => createAgt002PreviewRuntime({ environment: {} }), /no está configurado/i);
assert.throws(() => createAgt002PreviewRuntime({ environment: baseEnv({ AGT002_PREVIEW_MODEL: undefined }) }), /no está configurado/i);

// When configured, returns a usable engine without eagerly spawning (construction is cheap/safe).
{
  const runtime = createAgt002PreviewRuntime({ environment: baseEnv(), countDailyRuns: async () => 0 });
  assert.equal(typeof runtime.analyze, 'function');
}

// The optional diagnostic hook stays false during construction and fires exactly
// when the engine delegates to the bridge client. It never receives request data.
{
  let invocationStarted = false;
  let capturedClient = null;
  createAgt002PreviewRuntime({
    environment: baseEnv(),
    countDailyRuns: async () => 0,
    onBridgeInvocationStarted: () => { invocationStarted = true; },
    createEngine: ({ client }) => {
      capturedClient = client;
      return { analyze: async () => null };
    },
  });
  assert.equal(invocationStarted, false);
  assert.equal(typeof capturedClient.run, 'function');
  const delegated = capturedClient.run({ marker: 'synthetic' });
  assert.equal(invocationStarted, true);
  await assert.rejects(() => delegated, /modelo configurado/u);
}

// Malformed numeric overrides must fail closed rather than silently coerce to an unsafe default.
assert.throws(
  () => createAgt002PreviewRuntime({ environment: baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: 'not-a-number' }), countDailyRuns: async () => 0 }),
  /no está configurado/i,
);

// Negative/zero operator overrides must also fail closed.
assert.throws(
  () => createAgt002PreviewRuntime({ environment: baseEnv({ AGT002_PREVIEW_MAX_CONCURRENT: '0' }), countDailyRuns: async () => 0 }),
  /no está configurado/i,
);

// AGT002_PREVIEW_PROMPT_MAX_INPUT_TOKENS: server-owned override of the V3 prompt-budget cap
// (agt002-v3-prompt-budget.js). Absent -> the safe-floor constant; a valid positive integer
// override is honored verbatim; malformed/zero/negative must fail closed exactly like every
// other numeric override above (AGT002_PREVIEW_TIMEOUT_MS, AGT002_PREVIEW_MAX_CONCURRENT, ...).
{
  assert.equal(
    getAgt002PreviewRuntimeConfig(baseEnv()).promptMaxInputTokens,
    AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
    'absent override must default to the safe-floor constant',
  );
  assert.equal(
    getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_PROMPT_MAX_INPUT_TOKENS: '180000' })).promptMaxInputTokens,
    180000,
    'a valid override must be honored verbatim',
  );
  for (const badValue of ['not-a-number', '0', '-5']) {
    assert.throws(
      () => getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_PROMPT_MAX_INPUT_TOKENS: badValue })),
      /no está configurado/i,
      `${badValue} must fail closed instead of silently coercing to an unsafe default`,
    );
  }
}

// Release blocker: the semantic V3 path makes TWO sequential provider turns (semantic
// discovery, then analysis) inside a single claimed run, and AGT002_PREVIEW_TIMEOUT_MS
// bounds EACH turn. A lease sized for one timeout expires mid-run while the second turn
// is still in flight, so the reservation must cover both full timeouts plus the same
// 15s buffer: leaseSeconds = 2 * ceil(timeoutMs / 1000) + 15.
{
  assert.equal(
    getAgt002PreviewRuntimeConfig(baseEnv()).leaseSeconds,
    75,
    'the default 30s timeout funds two sequential provider turns, so the lease must be 2*30+15=75s, not 45s',
  );
  assert.equal(
    getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: '5000' })).leaseSeconds,
    25,
    'lease must scale with both turns: 2*5+15=25s',
  );
  // Sub-second precision is still rounded up per turn before doubling.
  assert.equal(
    getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: '4500' })).leaseSeconds,
    25,
    'each turn rounds up to whole seconds before the two-turn lease is computed',
  );
}

// Boundary: the 600s reservation ceiling must be enforced against the TWO-turn lease. A
// timeout that fits under the ceiling for one turn but not for two must fail closed at
// configuration time rather than being accepted and then expiring mid-run.
{
  assert.throws(
    () => getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: '300000' })),
    /no está configurado/i,
    '2*300+15=615 exceeds the 600s ceiling, so a 300s timeout must be rejected even though one turn would fit',
  );
  assert.throws(
    () => getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: '292500' })),
    /no está configurado/i,
    'the first rejected value above the ceiling is 2*293+15=601',
  );
  assert.equal(
    getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: '292000' })).leaseSeconds,
    599,
    'the largest two-turn lease at or under the 600s ceiling stays accepted',
  );
}

// AGT-002 root-cause fix: reasoning effort is explicit, fail-closed, and defaults to the
// fastest operationally-validated level instead of silently inheriting the Codex CLI/account
// default (the production incident: an inherited default effort emitted its final structured
// response only near the fixed 285_000ms per-turn deadline).
{
  assert.equal(getAgt002PreviewRuntimeConfig(baseEnv()).effort, AGT002_PREVIEW_DEFAULT_REASONING_EFFORT);
  assert.equal(getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_REASONING_EFFORT: 'medium' })).effort, 'medium');
  assert.throws(
    () => getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_REASONING_EFFORT: 'high' })),
    /no está configurado/i,
    'an unsupported reasoning effort must fail closed instead of silently reaching the provider',
  );
  assert.throws(
    () => getAgt002PreviewRuntimeConfig(baseEnv({ AGT002_PREVIEW_REASONING_EFFORT: 'Low' })),
    /no está configurado/i,
    'reasoning effort matching must be exact-case, never coerced',
  );
}

// The resolved effort reaches the engine exactly like model/timeoutMs/policyVersion do.
{
  let capturedOptions = null;
  const spyEngine = (options) => { capturedOptions = options; return { analyze: async () => {} }; };
  createAgt002PreviewRuntime({ environment: baseEnv(), countDailyRuns: async () => 0, createEngine: spyEngine });
  assert.equal(capturedOptions.effort, AGT002_PREVIEW_DEFAULT_REASONING_EFFORT);

  let capturedOptions2 = null;
  const spyEngine2 = (options) => { capturedOptions2 = options; return { analyze: async () => {} }; };
  createAgt002PreviewRuntime({
    environment: baseEnv({ AGT002_PREVIEW_REASONING_EFFORT: 'medium' }), countDailyRuns: async () => 0, createEngine: spyEngine2,
  });
  assert.equal(capturedOptions2.effort, 'medium');
}

// Explicit numeric overrides are honored when valid.
{
  const runtime = createAgt002PreviewRuntime({
    environment: baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: '5000', AGT002_PREVIEW_MAX_CONCURRENT: '1', AGT002_PREVIEW_DAILY_MAX_RUNS: '4', AGT002_PREVIEW_POLICY_VERSION: 'agt002-preview-policy-v2' }),
    countDailyRuns: async () => 4,
  });
  await assert.rejects(
    () => runtime.analyze({ opportunity: {}, documents: [{ id: 'd1', name: 'n', document_type: 't', extracted_text: 'x' }], companyProfile: {}, deepAnalysis: {}, snapshotId: 'snapshot-1' }),
    /cuota/i,
  );
}

// AGT002_CONTEXT_V2 must be propagated by the server-side runtime factory. With the
// flag enabled, incomplete v1-only input fails closed before quota/provider work.
{
  const runtime = createAgt002PreviewRuntime({
    environment: baseEnv({ AGT002_CONTEXT_V2: 'true', AGT002_PREVIEW_DAILY_MAX_RUNS: '1' }),
    countDailyRuns: async () => 1,
  });
  assert.throws(
    () => runtime.analyze({
      opportunity: {},
      documents: [{ id: 'd1', name: 'n', document_type: 't', extracted_text: 'x' }],
      companyProfile: {},
      deepAnalysis: {},
      snapshotId: 'snapshot-1',
    }),
    /context.*v2|contexto.*v2/i,
    'runtime must enable context v2 from AGT002_CONTEXT_V2 rather than silently using v1',
  );
}

function validLegalCorpusContext(overrides = {}) {
  return Object.freeze({
    legal_corpus_version_id: '10101010-1010-4010-8010-101010101010',
    corpus_version: 'legal-corpus-v1',
    content_sha256: 'a'.repeat(64),
    corpus: {
      corpus_version: 'legal-corpus-v1',
      sources: [{
        source_id: 'ley-80-1993-art-1', norm_type: 'Ley', norm_number: '80', year: 1993,
        article_or_section: 'Artículo 1', current_text: 'Texto vigente.',
        issuing_authority: 'Congreso de la República', issued_at: '1993-10-28T00:00:00.000Z',
        effective_from: '1993-10-28T00:00:00.000Z', effective_to: null, modifications: [],
        official_url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?ruta=Leyes/1790106',
        topic: ['contratacion_estatal'], sector: ['vigilancia_privada'],
        verified_at: '2026-07-29T00:00:00.000Z', verification_status: 'verified',
        validity_status: 'confirmed', applicability_status: 'applicable',
        corpus_version: 'legal-corpus-v1',
      }],
    },
    ...overrides,
  });
}

// AGT002_LEGAL_CORPUS must reach the engine together with a deterministic, versioned corpus
// provider bound to the exact DB-loaded corpus context. Engine construction itself fails
// closed if runtime forgets either dependency, and the runtime never falls back to reading
// the local fixture file: the loaded context must be injected explicitly by the caller
// (the server layer, after loading it from the DB via agt002-legal-corpus-store.js).
{
  assert.throws(
    () => createAgt002PreviewRuntime({
      environment: baseEnv({ AGT002_CONTEXT_V2: 'true', AGT002_LEGAL_CORPUS: 'true', AGT002_LEGAL_AS_OF: '2026-07-30' }),
      countDailyRuns: async () => 0,
    }),
    /corpus jurídico/i,
    'without an explicitly injected legalCorpusContext, the runtime must fail closed rather than silently reading a local fixture',
  );

  const runtime = createAgt002PreviewRuntime({
    environment: baseEnv({ AGT002_CONTEXT_V2: 'true', AGT002_LEGAL_CORPUS: 'true', AGT002_LEGAL_AS_OF: '2026-07-30' }),
    countDailyRuns: async () => 0,
    legalCorpusContext: validLegalCorpusContext(),
  });
  assert.equal(typeof runtime.analyze, 'function');
}

// A malformed injected legal corpus context must also fail closed.
for (const overrides of [
  { legal_corpus_version_id: '' },
  { corpus_version: '' },
  { content_sha256: 'not-a-hash' },
  { corpus: null },
]) {
  assert.throws(
    () => createAgt002PreviewRuntime({
      environment: baseEnv({ AGT002_CONTEXT_V2: 'true', AGT002_LEGAL_CORPUS: 'true', AGT002_LEGAL_AS_OF: '2026-07-30' }),
      countDailyRuns: async () => 0,
      legalCorpusContext: validLegalCorpusContext(overrides),
    }),
    /corpus jurídico/i,
  );
}

// ---------------------------------------------------------------------------
// Task 8: AGT002_INTEGRAL_CONTRACT_V3 wiring. server/index.js and api/[...path].js both
// call createAgt002PreviewRuntime — parity is structural (one shared module), so all v3
// wiring behavior is tested once here.
// ---------------------------------------------------------------------------

const V3_BASE_ENV = {
  AGT002_CANONICAL_ONLY: 'true', AGT002_CONTEXT_V2: 'true', AGT002_DOCUMENT_RETRIEVAL: 'true', AGT002_INTEGRAL_CONTRACT_V3: 'true',
};
const SYNTHETIC_EVIDENCE_AS_OF = '2026-08-29T00:00:00.000Z';

// Synthetic, privacy-safe valid 17-class inventory snapshot matching the real validator shape
// (agt002-company-evidence-sharepoint-catalog.js) — no real names, paths, URLs or raw ids.
const SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT = Object.freeze({
  inventory_version: AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION,
  catalog_snapshot_hash: 'c'.repeat(64),
  source_file_count: 18,
  excluded_non_evidence_count: 1,
  state_counts: {
    current_valid: 0, historical_update_required: 0, reported_unverified: 17, absent_unknown: 0, process_specific_template: 0,
  },
  classes: AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(entryId => ({
    entry_id: entryId,
    source_file_count: 1,
    state_counts: {
      current_valid: 0, historical_update_required: 0, reported_unverified: 1, absent_unknown: 0, process_specific_template: 0,
    },
    effective_state: 'reported_unverified',
    last_reconciled_at: '2026-08-29T00:00:00.000Z',
  })),
});

// Flag off (default): construction and behavior are exactly as before — no v3 option
// is ever consulted, and no request/environment parameter besides the flag itself can
// turn v3 on.
{
  const runtime = createAgt002PreviewRuntime({ environment: baseEnv(), countDailyRuns: async () => 0 });
  assert.equal(typeof runtime.analyze, 'function');
}

// Flag on requires a company-evidence registry source, mirroring the legalCorpusContext
// fail-closed pattern: without it, construction must fail closed rather than silently
// running v3 with no company-evidence signal.
assert.throws(
  () => createAgt002PreviewRuntime({ environment: baseEnv(V3_BASE_ENV), countDailyRuns: async () => 0 }),
  /no está configurado|evidencia empresarial|companyEvidence/i,
  'AGT002_INTEGRAL_CONTRACT_V3 must fail closed without an injected company-evidence registry source',
);

// F4: the flag also requires the deterministic asOf the identity/classes must be derived
// against — a registry with no asOf must fail closed exactly like a missing registry does,
// never silently default to the wall clock.
assert.throws(
  () => createAgt002PreviewRuntime({
    environment: baseEnv(V3_BASE_ENV), countDailyRuns: async () => 0, companyEvidenceRegistryEntries: [],
  }),
  /no está configurado|companyEvidenceAsOf/i,
  'AGT002_INTEGRAL_CONTRACT_V3 must fail closed without an injected companyEvidenceAsOf',
);

// Focal: companyEvidenceAsOf must be exactly the canonical start-of-day UTC form — never
// merely Date-parseable — so an offset, a non-midnight time or a calendar-impossible date
// fails closed exactly like a missing asOf does.
for (const badAsOf of ['2026-08-29T00:00:00.000+00:00', '2026-08-29T08:30:00.000Z', '2026-02-30T00:00:00.000Z']) {
  assert.throws(
    () => createAgt002PreviewRuntime({
      environment: baseEnv(V3_BASE_ENV), countDailyRuns: async () => 0, companyEvidenceRegistryEntries: [], companyEvidenceAsOf: badAsOf,
    }),
    /no está configurado|companyEvidenceAsOf/i,
    `${badAsOf} must fail closed instead of being treated as a valid asOf`,
  );
}

// Flag on with an (empty, synthetic) registry supplied: construction succeeds. Category
// overrides and contextVersionId are constructor-only configuration — never read from
// the per-request analyze() context, matching every other engine-level flag.
{
  const runtime = createAgt002PreviewRuntime({
    environment: baseEnv(V3_BASE_ENV), countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [], companyEvidenceAsOf: SYNTHETIC_EVIDENCE_AS_OF, companyEvidenceInventorySnapshot: SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT, categoryOverrides: { 'req-1': 'habilitating' },
    governanceProvenance: {
      'category_override:req-1': {
        requirement_id: 'req-1', override_kind: 'category_override', category_value: 'habilitating',
        rationale: 'Clasificación curada.', source_reference: 'pliego:1', curated_by: 'curator',
        curated_at: '2026-08-07T00:00:00.000Z', version: 1,
      },
    },
    contextVersionId: '10101010-1010-4010-8010-101010101010',
  });
  assert.equal(typeof runtime.analyze, 'function');
}

// evidenceClassLinkByRequirementId must reach the engine exactly like categoryOverrides
// does — both are governed, curated, constructor-only maps (agt002-evidence-state-manifest.js /
// agt002-integral-category-manifest.js). createEngine is an injectable seam (defaulting to
// the real createAgt002PreviewEngine) purely so this test can assert on the exact options
// object the runtime builds, without ever constructing a real network client.
{
  let capturedOptions = null;
  const spyEngine = (options) => {
    capturedOptions = options;
    return { analyze: async () => { throw new Error('not called'); } };
  };
  const evidenceClassLinkByRequirementId = { 'req-1': 'rup' };
  const categoryOverrides = { 'req-2': 'technical' };
  const manizalesManifestSource = { artifact_type: 'agt002_manizales_integral_manifest', marker: 'server-owned-test-source' };
  const governanceProvenance = {
    'evidence_class_link:req-1': { requirement_id: 'req-1', override_kind: 'evidence_class_link', evidence_class_id: 'rup', rationale: 'x', source_reference: 'y', curated_by: 'z', curated_at: '2026-08-07T00:00:00.000Z', version: 1 },
    'category_override:req-2': { requirement_id: 'req-2', override_kind: 'category_override', category_value: 'technical', rationale: 'x', source_reference: 'y', curated_by: 'z', curated_at: '2026-08-07T00:00:00.000Z', version: 1 },
  };
  createAgt002PreviewRuntime({
    environment: baseEnv(V3_BASE_ENV), countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [], companyEvidenceAsOf: SYNTHETIC_EVIDENCE_AS_OF, companyEvidenceInventorySnapshot: SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT, categoryOverrides, evidenceClassLinkByRequirementId, governanceProvenance, manizalesManifestSource,
    contextVersionId: '10101010-1010-4010-8010-101010101010',
    createEngine: spyEngine,
  });
  // F4: the SAME asOf reaches the engine construction — never re-derived, never the wall clock.
  assert.equal(capturedOptions.companyEvidenceAsOf, SYNTHETIC_EVIDENCE_AS_OF, 'the runtime must forward companyEvidenceAsOf to the engine verbatim');
  assert.deepEqual(capturedOptions.evidenceClassLinkByRequirementId, evidenceClassLinkByRequirementId, 'the runtime must forward evidenceClassLinkByRequirementId to the engine, exactly like categoryOverrides');
  assert.deepEqual(capturedOptions.categoryOverrides, categoryOverrides);
  assert.equal(capturedOptions.manizalesManifestSource, manizalesManifestSource, 'the runtime must forward the exact server-owned manifest source to the engine');
  assert.equal(capturedOptions.policyText, AGT002_INTEGRAL_V3_POLICY, 'V3 runtime must use the V3 wire policy, never the legacy preview policy');
  // v5: the discovered-frontier run's model-facing input (server-derived semantic_frontier_summary
  // instead of the two full audit ledgers) and the policy sentence describing it both changed, so
  // the persisted provenance must distinguish it from a v4 run.
  assert.equal(AGT002_INTEGRAL_V3_POLICY_VERSION, 'agt002-integral-v3-policy-v5', 'a materially different model-facing input/policy requires a distinct persisted policy version');
  assert.equal(capturedOptions.policyVersion, AGT002_INTEGRAL_V3_POLICY_VERSION, 'persisted policy version must identify the V3 policy actually used');
  assert.notEqual(capturedOptions.policyText, AGT002_PREVIEW_POLICY);
  assert.notEqual(capturedOptions.policyVersion, AGT002_PREVIEW_DEFAULT_POLICY_VERSION);
  // P2-1: governance_provenance must reach the engine exactly like categoryOverrides and
  // evidenceClassLinkByRequirementId do — it is the traceability behind those bindings.
  assert.deepEqual(capturedOptions.governanceProvenance, governanceProvenance, 'the runtime must forward governanceProvenance to the engine, exactly like categoryOverrides');
  // The semantic discovery stage is part of what a V3 run IS — a production run must derive its
  // frontier from the process's own expediente — so the runtime wires the provider from the V3
  // flag set alone. There is no separate env flag for it: nothing but AGT002_INTEGRAL_CONTRACT_V3
  // (plus the context/retrieval flags it already requires) decides whether it is present.
  assert.equal(typeof capturedOptions.semanticDiscoveryProvider, 'function',
    'a V3 runtime must inject the semantic discovery provider so the frontier comes from this process, not the fixed historical matrix');
}

// Without an explicit evidenceClassLinkByRequirementId/governanceProvenance, the engine
// must receive the same safe empty-map default as categoryOverrides — never undefined
// (which would fall back to the engine's own default, silently decoupling runtime
// behavior from what was requested).
{
  let capturedOptions = null;
  const spyEngine = (options) => { capturedOptions = options; return { analyze: async () => {} }; };
  createAgt002PreviewRuntime({
    environment: baseEnv(V3_BASE_ENV), countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [], companyEvidenceAsOf: SYNTHETIC_EVIDENCE_AS_OF, companyEvidenceInventorySnapshot: SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT, createEngine: spyEngine,
  });
  assert.deepEqual(capturedOptions.evidenceClassLinkByRequirementId, {});
  assert.deepEqual(capturedOptions.categoryOverrides, {});
  assert.deepEqual(capturedOptions.governanceProvenance, {});
  assert.equal(typeof capturedOptions.semanticDiscoveryProvider, 'function',
    'the discovery provider is part of the V3 wiring itself, not an opt-in the caller must remember');
}

// A non-V3 runtime is unchanged: it never receives a discovery provider, so a legacy preview run
// keeps its exact current behavior and no environment value can turn discovery on by itself.
{
  let capturedOptions = null;
  const spyEngine = (options) => { capturedOptions = options; return { analyze: async () => {} }; };
  createAgt002PreviewRuntime({
    environment: baseEnv({ AGT002_CONTEXT_V2: 'true', AGT002_DOCUMENT_RETRIEVAL: 'true' }),
    countDailyRuns: async () => 0, createEngine: spyEngine,
  });
  assert.equal(capturedOptions.semanticDiscoveryProvider, undefined);
}

const source = readFileSync(new URL('../agt002-preview-runtime.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /OPENAI_API_KEY|HERMES_INTERIM_API_KEY|Authorization|Bearer/i, 'the runtime must never manage an API key or bearer token');
assert.doesNotMatch(source, /readFileSync/, 'the runtime must never read the local legal corpus fixture as production evidence; it must consume an injected, DB-loaded context');
assert.doesNotMatch(source, /AGT002_[A-Z0-9_]*SEMANTIC/, 'semantic discovery must not be gated by an environment flag of its own; it belongs to the V3 wiring');

function testConfiguredRequiresHetznerBridgeUrlAndSecret() {
  const baseEnv = { TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview', AGT002_PREVIEW_MODEL: 'gpt-x' };
  assert.equal(isAgt002PreviewConfigured(baseEnv), false, 'sin URL de puente, debe fallar cerrado (kill switch apagado por defecto)');
  assert.equal(isAgt002PreviewConfigured({ ...baseEnv, AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run' }), false, 'sin secreto HMAC, debe fallar cerrado');
  assert.equal(isAgt002PreviewConfigured({
    ...baseEnv,
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
  }), true);
}

function testRuntimeBuildsHetznerBridgeClientNotLocalSpawn() {
  const environment = {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'gpt-x',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
  };
  const engine = createAgt002PreviewRuntime({ environment, countDailyRuns: async () => 0 });
  assert.equal(typeof engine.analyze, 'function');
}

testConfiguredRequiresHetznerBridgeUrlAndSecret();
testRuntimeBuildsHetznerBridgeClientNotLocalSpawn();

// Safe constructor-boundary diagnostics: each failure before bridge invocation must carry
// a stable non-secret code so production observability can distinguish the root cause
// without logging exception messages, environment values, or tender content.
{
  const cases = [
    {
      label: 'runtime config',
      code: 'AGT002_RUNTIME_CONFIG_INVALID',
      run: () => createAgt002PreviewRuntime({
        environment: baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: 'invalid' }),
        countDailyRuns: async () => 0,
      }),
    },
    {
      label: 'legal corpus',
      code: 'AGT002_RUNTIME_LEGAL_CORPUS_INVALID',
      run: () => createAgt002PreviewRuntime({
        environment: baseEnv({ AGT002_CONTEXT_V2: 'true', AGT002_LEGAL_CORPUS: 'true' }),
        countDailyRuns: async () => 0,
      }),
    },
    {
      label: 'integral governance',
      code: 'AGT002_RUNTIME_GOVERNANCE_INVALID',
      run: () => createAgt002PreviewRuntime({
        environment: baseEnv(V3_BASE_ENV),
        countDailyRuns: async () => 0,
      }),
    },
    {
      label: 'bridge client',
      code: 'AGT002_RUNTIME_BRIDGE_CLIENT_INVALID',
      run: () => createAgt002PreviewRuntime({
        environment: baseEnv({ AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'short-secret' }),
        countDailyRuns: async () => 0,
      }),
    },
    {
      label: 'engine creation',
      code: 'AGT002_RUNTIME_ENGINE_CREATION_FAILED',
      run: () => createAgt002PreviewRuntime({
        environment: baseEnv(),
        countDailyRuns: async () => 0,
        createEngine: () => { throw new Error('synthetic internal detail that must not become a diagnostic code'); },
      }),
    },
  ];
  for (const scenario of cases) {
    assert.throws(scenario.run, error => {
      assert.equal(error?.runtime_boundary_code, scenario.code, `${scenario.label} must expose only its stable boundary code`);
      assert.equal(String(error?.runtime_boundary_code).includes('synthetic internal detail'), false);
      assert.equal(String(error?.runtime_boundary_code).includes('short-secret'), false);
      return true;
    });
  }

  const codedCause = new Error('synthetic coded cause');
  codedCause.code = 'UPSTREAM_STABLE_CODE';
  assert.throws(
    () => createAgt002PreviewRuntime({
      environment: baseEnv(),
      countDailyRuns: async () => 0,
      createEngine: () => { throw codedCause; },
    }),
    error => error === codedCause
      && error.code === 'UPSTREAM_STABLE_CODE'
      && error.runtime_boundary_code === 'AGT002_RUNTIME_ENGINE_CREATION_FAILED',
    'boundary diagnostics must preserve the original error object and code',
  );

  const frozenCause = Object.freeze(new Error('frozen synthetic detail'));
  assert.throws(
    () => createAgt002PreviewRuntime({
      environment: baseEnv(),
      countDailyRuns: async () => 0,
      createEngine: () => { throw frozenCause; },
    }),
    error => error !== frozenCause
      && error.message === 'AGT-002 Preview no está disponible.'
      && error.runtime_boundary_code === 'AGT002_RUNTIME_ENGINE_CREATION_FAILED'
      && error.cause === frozenCause,
    'non-extensible failures must use a generic safe wrapper and preserve the cause',
  );
}

console.log('AGT-002 Preview runtime factory (fail-closed environment wiring) passed');
