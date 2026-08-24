import { strict as assert } from 'node:assert';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';

// RED (TDD): pins how agt002-preview-engine.js's V4 discovery frontier (usesSemanticDiscovery)
// must now handle a rejection thrown by its injected `semanticDiscoveryProvider`
// (tender-semantic-discovery.js — see tests/tender-semantic-discovery-post-response-classification
// .test.mjs for that module's own half of this fix). Before this fix, ANY discovery rejection —
// including a schema-valid-JSON-but-locally-invalid semantic rejection, exactly the real job
// f7f3dbcc shape (bridge invocation started=true, response_received=true, ~63.7s latency,
// non-empty content) — fell through the engine's generic catch and surfaced only as the engine's
// own opaque SAFE_UNAVAILABLE with no `.stage` at all, which agt002-post-bridge-observability.js's
// classifyEnginePhase has no choice but to classify as 'unexpected'/AGT002_UNEXPECTED_ERROR once
// the bridge has already answered. No real client/bridge/network/Supabase is used anywhere below;
// every fixture is synthetic.

function spyObservability() {
  const records = [];
  return { records, record: (eventType, fields) => { records.push({ eventType, fields }); return { event: eventType, ...fields }; } };
}

function baseEngineOptions(overrides = {}) {
  return {
    client: { run: async () => { throw new Error('client.run must not be reached: the discovery fake itself rejects before any real bridge call'); } },
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v1',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    ...overrides,
  };
}

// Requirement: a discovery rejection tagged by tender-semantic-discovery.js with a real
// AGT002_OUTPUT_REJECTION_STAGES value and a real TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES
// member must surface from engine.analyze() as SAFE_INVALID carrying that SAME stage/code — never
// the engine's generic SAFE_UNAVAILABLE — and must emit exactly one output_rejected event with a
// closed validation_code, never the raw proposal/label/document content.
{
  const observability = spyObservability();
  const taggedError = new Error('requirements[0]: la etiqueta debe estar anclada literalmente en el texto de una source_unit citada: [contenido sensible del expediente que nunca debe salir de este módulo]');
  taggedError.stage = AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION;
  taggedError.code = 'v4_discovery_citation_anchor_invariant';

  const engine = createAgt002PreviewEngine(baseEngineOptions({
    observability,
    semanticDiscoveryProvider: async () => { throw taggedError; },
  }));

  await assert.rejects(
    () => engine.analyze({ snapshotId: '00000000-0000-4000-8000-0000000000d1', documents: [] }),
    (error) => {
      assert.equal(error.message, 'AGT-002 Preview no produjo una respuesta válida.',
        'the public message contract stays exactly the fixed SAFE_INVALID string');
      assert.equal(error.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION);
      assert.equal(error.code, 'v4_discovery_citation_anchor_invariant');
      return true;
    },
  );

  assert.equal(observability.records.length, 1, 'exactly one output_rejected event, never zero, never a second call to any fallback engine');
  const { eventType, fields } = observability.records[0];
  assert.equal(eventType, 'output_rejected');
  assert.equal(fields.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION);
  assert.equal(fields.validation_code, 'v4_discovery_citation_anchor_invariant');

  const serialized = JSON.stringify(observability.records);
  assert.ok(!serialized.includes('contenido sensible del expediente'), 'raw discovery error text must never leak into the observability event');
}

// Requirement: an UNTAGGED discovery failure (no `.stage` at all — a transport/provider failure
// from client.run inside the discovery turn, or any bug that raises a bare Error) must fall
// through unchanged to the engine's existing generic handling: SAFE_UNAVAILABLE, no `.stage`, and
// NO output_rejected event — so a real transport/provider failure keeps classifying exactly as it
// did before this fix (the post-bridge runner's own bridge-telemetry-based transport/provider
// split is untouched by this change).
{
  const observability = spyObservability();
  const engine = createAgt002PreviewEngine(baseEngineOptions({
    observability,
    semanticDiscoveryProvider: async () => {
      const error = new Error('El servicio de AGT-002 Preview no está disponible.');
      error.code = 'AGT002_CODEX_TRANSPORT_ERROR';
      throw error;
    },
  }));

  await assert.rejects(
    () => engine.analyze({ snapshotId: '00000000-0000-4000-8000-0000000000d2', documents: [] }),
    (error) => {
      assert.equal(error.message, 'AGT-002 Preview no está disponible en este momento.');
      assert.equal(error.stage, undefined, 'an untagged/transport-shaped discovery error must never be misclassified as SEMANTIC_VALIDATION');
      assert.equal(error.code, 'AGT002_CODEX_TRANSPORT_ERROR', 'the upstream transport code still survives onto the safe wrapper, unchanged from before this fix');
      return true;
    },
  );
  assert.equal(observability.records.length, 0, 'a transport-shaped discovery failure must never emit output_rejected');
}

// Requirement: a hostile/unrecognized `.code` alongside a valid `.stage` must collapse to the
// generic closed fallback — never leak an arbitrary string onto the durable/observable surface.
{
  const observability = spyObservability();
  const hostile = 'DROP TABLE psi_agt002_analysis_attempt_events; secret-token-abcdefghijklmnopqrstuvwx';
  const hostileError = new Error('shape violation');
  hostileError.stage = AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION;
  hostileError.code = hostile;

  const engine = createAgt002PreviewEngine(baseEngineOptions({
    observability,
    semanticDiscoveryProvider: async () => { throw hostileError; },
  }));

  await assert.rejects(
    () => engine.analyze({ snapshotId: '00000000-0000-4000-8000-0000000000d3', documents: [] }),
    (error) => {
      assert.equal(error.code, 'v4_discovery_invariant_violation');
      return true;
    },
  );
  assert.equal(observability.records[0].fields.validation_code, 'v4_discovery_invariant_violation');
  const serialized = JSON.stringify(observability.records);
  assert.ok(!serialized.includes('DROP TABLE'));
  assert.ok(!serialized.includes('secret-token'));
}

console.log('tests/agt002-preview-engine-discovery-post-response-classification.test.mjs OK');
