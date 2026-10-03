// AGT-002 durable batched V3 — material omissions must skip the model turn entirely.
//
// WHY THIS FILE EXISTS
//   Every batch of a run whose governed context already observed material retrieval omissions is
//   deterministically coerced to abstention by validateAgt002PreviewModelOutputV3Batch (production
//   incident d14a1a46 / job 10753262: 9/141 batches executed, each doomed to abstention, before the
//   run died — the remaining ~132 model calls would have been pure waste). This test proves
//   executeBatch (agt002-preview-engine.js) never calls client.run in that case, still renews the
//   heartbeat/lease via beforeProviderCall, and still completes the run end to end with every unit
//   abstained.
//
// Run: node --test tests/agt002-batched-v3-material-omissions-skip-model.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  AGT002_INTEGRAL_V3_POLICY,
  createAgt002PreviewEngine,
  runAgt002BatchedV3Analysis,
} from '../agt002-preview-engine.js';
import { buildTenderSemanticManifest } from '../tender-semantic-manifest.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';

const hash = value => createHash('sha256').update(value).digest('hex');

const MODEL = 'synthetic-codex-model';
const SNAPSHOT_ID = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const OPPORTUNITY_ID = '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b';
const FIXED_RUN_ID = '99999999-9999-4999-8999-999999999999';
const POLICY_VERSION = 'agt002-integral-v3-policy-test';
const SERVER_OWNED_MAX_INPUT_TOKENS = 180_000;

const PLIEGO_TEXT = [
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
].join('\n');

const documents = [{
  document_id: 'sintetico-pliego',
  document_version_id: 'sintetico-pliego-v1',
  opportunity_id: OPPORTUNITY_ID,
  snapshot_id: null,
  document_type: 'pliego',
  name: 'Pliego.pdf',
  version: 1,
  content_hash: hash(PLIEGO_TEXT),
  current: true,
  extracted_text: PLIEGO_TEXT,
}];

function contextV2Sections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: OPPORTUNITY_ID, owner_id: 'owner', owner_name: 'Ana', updated_at: '2026-08-24T00:00:00.000Z' },
      tender: {
        id: 'tender-sintetico', title: 'Proceso sintético', entity: 'Entidad sintética',
        source: 'SECOP II', updated_at: '2026-08-24T00:00:00.000Z',
      },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Sintética Ltda.', updated_at: '2026-08-24T00:00:00.000Z' },
      documents: [],
    }),
  };
}

const analysisContext = () => ({
  snapshotId: SNAPSHOT_ID, documents, documentGaps: [], deepAnalysis: {}, contextV2Sections: contextV2Sections(),
});

function structuralDiscovery(options) {
  const discovered = buildTenderSemanticManifest({ inventory: options.inventory, documents: options.documents });
  return {
    semanticManifest: discovered,
    categoryOverrides: Object.fromEntries(discovered.requirements.map(requirement => [
      requirement.requirement_id,
      requirement.front === 'financial' ? 'habilitating' : 'technical',
    ])),
    usage: { input_tokens: 11, output_tokens: 5 },
  };
}

/** A client whose `run` must never be invoked once material omissions have been observed. */
function forbiddenClient() {
  const calls = [];
  return {
    calls,
    run: async (options) => {
      calls.push(options);
      throw new Error('client.run must never be called when materialOmissionsObserved is true');
    },
  };
}

function recordingCheckpointHooks() {
  const loads = [];
  const stores = [];
  return {
    loads,
    stores,
    loadCheckpoint: async (options) => { loads.push(options); return { hit: false }; },
    storeCheckpoint: async (options) => { stores.push(options); return { status: 'created', checkpointId: `cp-${stores.length + 1}` }; },
  };
}

function discoveryEngine(client, overrides = {}) {
  return createAgt002PreviewEngine({
    client,
    model: MODEL,
    policyVersion: POLICY_VERSION,
    policyText: AGT002_INTEGRAL_V3_POLICY,
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    idGenerator: () => FIXED_RUN_ID,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    semanticDiscoveryProvider: async options => structuralDiscovery(options),
    promptBudget: true,
    promptMaxInputTokens: SERVER_OWNED_MAX_INPUT_TOKENS,
    ...overrides,
  });
}

test('a batch whose governed context observed material omissions never calls client.run, still renews the heartbeat, and still completes', async () => {
  // The engine's own real previewInput/validationContext are used unchanged — only
  // materialOmissionsObserved is forced true, at the exact orchestrator boundary, so this test
  // exercises the real planner/projector/batch-contract/merge/envelope machinery end to end and
  // cannot drift from what production actually wires.
  let heartbeatCalls = 0;
  const client = forbiddenClient();
  const hooks = recordingCheckpointHooks();
  const finalEngine = discoveryEngine(client, {
    checkpointHooks: hooks,
    batchedV3Orchestrator: (args) => runAgt002BatchedV3Analysis({
      ...args,
      validationContext: { ...args.validationContext, materialOmissionsObserved: true },
      beforeProviderCall: async () => { heartbeatCalls += 1; },
    }),
  });

  const envelope = await finalEngine.analyze(analysisContext());

  assert.equal(envelope.status, 'completed', 'the run must still complete deterministically, without ever reaching the provider');
  assert.equal(client.calls.length, 0, 'client.run must never be called when materialOmissionsObserved is true');
  assert.ok(heartbeatCalls >= hooks.stores.length, 'beforeProviderCall must still be invoked (at least once per batch) so the lease/heartbeat renews at the provider-call boundary even though the model is skipped');

  assert.ok(envelope.integral_analysis.analysis_units.length >= 2);
  for (const unit of envelope.integral_analysis.analysis_units) {
    assert.equal(unit.assessment_mode, 'abstained');
    assert.equal(unit.conclusion.confidence, 'unavailable');
  }
  assert.equal(envelope.integral_analysis.coverage.material_omissions, true);

  for (const store of hooks.stores) {
    assert.equal(store.usage.input_tokens, 0, 'a skipped model turn must record zero input tokens');
    assert.equal(store.usage.output_tokens, 0, 'a skipped model turn must record zero output tokens');
  }
});
