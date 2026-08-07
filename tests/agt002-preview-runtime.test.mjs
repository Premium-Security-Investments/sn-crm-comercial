import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createAgt002PreviewRuntime, isAgt002PreviewConfigured } from '../agt002-preview-runtime.js';

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

// Flag on with an (empty, synthetic) registry supplied: construction succeeds. Category
// overrides and contextVersionId are constructor-only configuration — never read from
// the per-request analyze() context, matching every other engine-level flag.
{
  const runtime = createAgt002PreviewRuntime({
    environment: baseEnv(V3_BASE_ENV), countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [], categoryOverrides: { 'req-1': 'habilitating' }, contextVersionId: '10101010-1010-4010-8010-101010101010',
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
  createAgt002PreviewRuntime({
    environment: baseEnv(V3_BASE_ENV), countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [], categoryOverrides, evidenceClassLinkByRequirementId,
    contextVersionId: '10101010-1010-4010-8010-101010101010',
    createEngine: spyEngine,
  });
  assert.deepEqual(capturedOptions.evidenceClassLinkByRequirementId, evidenceClassLinkByRequirementId, 'the runtime must forward evidenceClassLinkByRequirementId to the engine, exactly like categoryOverrides');
  assert.deepEqual(capturedOptions.categoryOverrides, categoryOverrides);
}

// Without an explicit evidenceClassLinkByRequirementId, the engine must receive the same
// safe empty-map default as categoryOverrides — never undefined (which would fall back to
// the engine's own default, silently decoupling runtime behavior from what was requested).
{
  let capturedOptions = null;
  const spyEngine = (options) => { capturedOptions = options; return { analyze: async () => {} }; };
  createAgt002PreviewRuntime({
    environment: baseEnv(V3_BASE_ENV), countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [], createEngine: spyEngine,
  });
  assert.deepEqual(capturedOptions.evidenceClassLinkByRequirementId, {});
  assert.deepEqual(capturedOptions.categoryOverrides, {});
}

const source = readFileSync(new URL('../agt002-preview-runtime.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /OPENAI_API_KEY|HERMES_INTERIM_API_KEY|Authorization|Bearer/i, 'the runtime must never manage an API key or bearer token');
assert.doesNotMatch(source, /readFileSync/, 'the runtime must never read the local legal corpus fixture as production evidence; it must consume an injected, DB-loaded context');

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

console.log('AGT-002 Preview runtime factory (fail-closed environment wiring) passed');
