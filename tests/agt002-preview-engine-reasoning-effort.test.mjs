// AGT-002 root-cause fix (TDD): explicit, fail-closed per-turn Codex reasoning effort.
//
// A real production run inherited the Codex CLI default reasoning effort (medium, never
// requested by this codebase) and its first provider turn emitted the final structured response
// only near the fixed 285_000ms per-turn deadline, still streaming when killed —
// AGT002_TRANSPORT_ERROR/timeout, no canonical run. This file pins:
//   1. Engine construction validates `effort` fail-closed (default low, narrow allowlist).
//   2. Every provider turn this engine can take — the legacy/v2 turn, the v3 analysis turn, and
//      the v3 discovery turn (when a semanticDiscoveryProvider is wired) — receives the exact
//      same configured effort.
//   3. A rejected output's safe telemetry event carries the effort its turn was pinned to.
//
// No real provider, bridge, network or subprocess is used anywhere below.

import assert from 'node:assert/strict';
import { createAgt002PreviewEngine, AGT002_INTEGRAL_V3_POLICY } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT } from '../agt002-preview-reasoning-effort.js';

function fakeClient(handler) {
  const calls = [];
  return { calls, run: async (options) => { calls.push(options); return handler(options, calls.length); } };
}

function legacyContext() {
  return {
    opportunity: { id: 'opp-1', company_name: 'Entidad de prueba', title: 'Vigilancia' },
    documents: [{ id: 'doc-01', name: 'Pliego', document_type: 'pliego', extracted_text: 'Requiere póliza vigente.' }],
    companyProfile: {}, deepAnalysis: {}, snapshotId: '11111111-1111-4111-8111-111111111111',
  };
}

function legacyModelOutput() {
  return {
    recommendation: 'pause', summary: 'Falta confirmar la póliza.', strengths: [],
    weaknesses: [{ id: 'f-1', text: 'Falta póliza vigente.', critical: true, evidence_refs: ['document:doc-01'] }],
    blockers: [], questions: [], unverified: [], next_action: 'Solicitar póliza vigente.', human_review_required: true,
  };
}

function baseEngineOptions(overrides = {}) {
  return {
    model: 'synthetic-codex-model', policyVersion: 'agt002-preview-policy-v1', timeoutMs: 2000,
    maxConcurrent: 2, dailyMaxRuns: 5, countDailyRuns: async () => 0, ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Construction: default, explicit accepted, rejected unsupported.
// ---------------------------------------------------------------------------
assert.throws(
  () => createAgt002PreviewEngine({ client: { run: async () => {} }, ...baseEngineOptions(), effort: 'high' }),
  /no está configurado/i,
  'an unsupported reasoning effort must fail closed at engine construction',
);
assert.throws(
  () => createAgt002PreviewEngine({ client: { run: async () => {} }, ...baseEngineOptions(), effort: 'minimal' }),
  /no está configurado/i,
);
assert.doesNotThrow(() => createAgt002PreviewEngine({ client: { run: async () => {} }, ...baseEngineOptions(), effort: 'medium' }));
assert.doesNotThrow(() => createAgt002PreviewEngine({ client: { run: async () => {} }, ...baseEngineOptions() }));

// ---------------------------------------------------------------------------
// 2a. The legacy/v2 provider turn (runOnce) carries the configured effort.
// ---------------------------------------------------------------------------
{
  const client = fakeClient(() => ({ content: JSON.stringify(legacyModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await engine.analyze(legacyContext());
  assert.equal(client.calls[0].effort, AGT002_PREVIEW_DEFAULT_REASONING_EFFORT, 'the default effort must reach the legacy provider turn');
}
{
  const client = fakeClient(() => ({ content: JSON.stringify(legacyModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions(), effort: 'medium' });
  await engine.analyze(legacyContext());
  assert.equal(client.calls[0].effort, 'medium', 'an explicit effort must reach the legacy provider turn');
}

// ---------------------------------------------------------------------------
// 2b. The v3 analysis provider turn (runOnceV3, no discovery) carries the configured effort.
// Stops immediately after the client captures the request (TEST_INPUT_CAPTURE pattern already
// used in tests/agt002-preview-engine.test.mjs) — a full valid v3 model output is not needed to
// prove what request was actually sent to the provider.
// ---------------------------------------------------------------------------
function v3Context() {
  return {
    documents: [{
      document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null,
      document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64), current: true,
      extracted_text: 'Requiere póliza vigente de cumplimiento.',
    }],
    deepAnalysis: {
      matrix: {
        legal: [{
          id: 'req-poliza', front: 'legal', label: 'Póliza vigente',
          evidence: [{ document_id: 'ver-01', document_name: 'Pliego', document_type: 'pliego', excerpt: 'Requiere póliza vigente de cumplimiento.' }],
        }],
        financial: [], technical: [],
      },
    },
    snapshotId: '55555555-5555-4555-8555-555555555555',
    contextV2Sections: {
      ...buildAgt002OpportunityContextV2({
        opportunity: { id: 'opp-1', updated_at: '2026-08-01T10:00:00.000Z' },
        tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-08-01T10:00:00.000Z' },
      }),
      company_dossier: buildAgt002CompanyDossier({ profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-08-01T10:00:00.000Z' }, documents: [] }),
    },
  };
}

function stopAfterCaptureClient() {
  return fakeClient(async () => {
    const error = new Error('stop after governed input capture');
    error.code = 'TEST_INPUT_CAPTURE';
    throw error;
  });
}

{
  const client = stopAfterCaptureClient();
  const engine = createAgt002PreviewEngine({
    client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
    categoryOverrides: { 'req-poliza': 'habilitating' },
    governanceProvenance: {
      'category_override:req-poliza': {
        requirement_id: 'req-poliza', override_kind: 'category_override', category_value: 'habilitating',
        rationale: 'x', source_reference: 'y', curated_by: '10101010-1010-4010-8010-101010101010',
        curated_at: '2026-08-07T00:00:00.000Z', version: 1,
      },
    },
    companyEvidenceClassesProvider: () => [],
    effort: 'medium',
  });
  await assert.rejects(() => engine.analyze(v3Context()), /no está disponible/i);
  assert.equal(client.calls[0].effort, 'medium', 'the v3 analysis provider turn must carry the configured effort');
}

// ---------------------------------------------------------------------------
// 2c. The v3 DISCOVERY provider turn: the engine's own call into semanticDiscoveryProvider must
// carry the exact same effort. The provider mock captures its options and stops the run
// immediately — this proves what the ENGINE handed the discovery boundary, independent of
// whatever tender-semantic-discovery.js itself does with it (covered separately).
// ---------------------------------------------------------------------------
{
  const client = stopAfterCaptureClient();
  let capturedDiscoveryOptions = null;
  const engine = createAgt002PreviewEngine({
    client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    semanticDiscoveryProvider: async (options) => { capturedDiscoveryOptions = options; throw new Error('stop after discovery capture'); },
    effort: 'medium',
  });
  await assert.rejects(() => engine.analyze(v3Context()));
  assert.ok(capturedDiscoveryOptions, 'the discovery provider must have been invoked');
  assert.equal(capturedDiscoveryOptions.effort, 'medium', 'the discovery turn must carry the exact same configured effort as the analysis turn');
}

// ---------------------------------------------------------------------------
// 3. Safe telemetry: a rejected output's diagnostic event carries the effort its turn used.
// ---------------------------------------------------------------------------
{
  const emitted = [];
  const client = fakeClient(() => ({ content: '', usage: { input_tokens: 1, output_tokens: 0 } }));
  const engine = createAgt002PreviewEngine({
    client, ...baseEngineOptions(), effort: 'medium',
    observability: { record: (eventType, fields) => emitted.push({ eventType, fields }) },
  });
  await assert.rejects(() => engine.analyze(legacyContext()), /no produjo una respuesta válida/i);
  const rejectedEvent = emitted.find(event => event.eventType === 'output_rejected');
  assert.ok(rejectedEvent, 'an output_rejected event must have been recorded');
  assert.equal(rejectedEvent.fields.effort, 'medium');
}

console.log('agt002-preview-engine-reasoning-effort.test.mjs OK');
