// RED (TDD) — AGT-002 durable batched V3: the SERVER-OWNED prompt input cap must reach the
// batched/discovered route, and a purely LOCAL planning failure must not be reported as
// stage=unexpected.
//
// WHY THIS FILE EXISTS (the exact incident it closes)
//   A real durable_batched_v1 reanalysis reused 35 semantic_discovery_batch checkpoints + 1
//   semantic_manifest checkpoint (so ZERO discovery provider turns were taken), then burned ~560 s
//   of CPU, wrote no integral checkpoint, persisted nothing, and surfaced through
//   runAgt002PostBridgeAnalysis as stage=unexpected / AGT002_UNEXPECTED_ERROR with
//   bridge_invocation_started=false and bridge_response_received=false.
//
//   Two defects are pinned here:
//     1. createAgt002PreviewRuntime resolves `config.promptMaxInputTokens` from the server-owned
//        env override AGT002_PREVIEW_PROMPT_MAX_INPUT_TOKENS and hands it to
//        createAgt002PreviewEngine, but the discovered + checkpointHooks route called
//        `batchedV3Orchestrator({...})` WITHOUT `maxInputTokens`. runAgt002BatchedV3Analysis then
//        silently fell back to its own AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS floor, so the
//        planner split (and could fail closed) against a cap the server never configured.
//     2. The planner's own local, pre-provider failure is recoded to the closed
//        AGT002_BATCHED_V3_PLAN_INCOHERENT code with NO stage, so the post-bridge classifier could
//        only fall back to its bridge-telemetry heuristic and land on 'unexpected'.
//
// INVARIANTS THIS FILE ALSO GUARDS
//   - The cap is CONSTRUCTOR/server-owned: an `analyze()` caller (or anything reachable from a
//     browser request body) can never override it.
//   - The legacy / no-checkpoint-hooks one-turn route is unchanged: same provider turn, same cap.
//   - A local planning failure stays a NON-transient invalid_output for the queue: it is attributed
//     to the closed pre-provider `envelope_build` frontier, never to the provider, and never to a
//     retryable transport/timeout bucket.
//
// No real provider, bridge, network, Supabase or secret is used: every fixture below is synthetic.
//
// Run: node --test tests/agt002-batched-v3-prompt-budget-propagation.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  AGT002_INTEGRAL_V3_POLICY,
  createAgt002PreviewEngine,
  runAgt002BatchedV3Orchestration,
} from '../agt002-preview-engine.js';
import { buildTenderSemanticManifest } from '../tender-semantic-manifest.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS } from '../agt002-v3-prompt-budget.js';
import { runAgt002PostBridgeAnalysis } from '../agt002-post-bridge-observability.js';
import { classifyAgt002ReanalysisWorkerError } from '../agt002-reanalysis-worker.js';

const hash = value => createHash('sha256').update(value).digest('hex');

const MODEL = 'synthetic-codex-model';
const SNAPSHOT_ID = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const OPPORTUNITY_ID = '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b';
const TENDER_ID = '5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c';
const CONTEXT_VERSION_ID = '6d6d6d6d-6d6d-4d6d-8d6d-6d6d6d6d6d6d';
const CORRELATION_ID = '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e';
const FIXED_RUN_ID = '99999999-9999-4999-8999-999999999999';

// A deliberately non-default, server-owned cap: nothing in the engine may ever silently replace it
// with AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS on the batched route.
const SERVER_OWNED_MAX_INPUT_TOKENS = 180_000;

// Same shape (and same two resolvable requirements) as the fixture in
// tests/agt002-preview-engine-discovery-frontier-projection.test.mjs: single newlines, so the
// inventory segments one source unit per line.
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

/** Exactly the shape the production discovery stage returns for the snapshot it was handed. */
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

/** The governed abstention every unit collapses to on a discovered frontier. */
function buildV3AbstainedUnits(input) {
  return input.document_evidence.requirement_manifest.map((entry, index) => ({
    unit_id: `UNIT-${index + 1}`, unit_kind: 'tender_requirement', requirement_id: entry.requirement_id,
    category: null, sequence: index + 1, title: entry.label.slice(0, 200), assessment_mode: 'abstained',
    conclusion: { status: 'human_validation_required', summary: 'Pendiente de validación humana.', confidence: 'unavailable' },
    blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'Sin determinación automática; requiere revisión humana.' },
    evidence_state: null, evidence_refs: [], missing_evidence: [],
    commercial_impact: { level: 'unknown', summary: 'Impacto no determinado.', dimension: 'unknown' },
    legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico.', human_legal_review_required: false },
    actions: [],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
    escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
    closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida.', evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
  }));
}

function fakeClient(handler) {
  const calls = [];
  return { calls, run: async (options) => { calls.push(options); return handler(options, calls.length); } };
}

function spyObservability() {
  const records = [];
  return { records, record: (eventType, fields) => { records.push({ eventType, fields }); return { event: eventType, ...fields }; } };
}

/** Checkpoint hooks that always miss — the batched route is entered, nothing is ever reused. */
function missingCheckpointHooks() {
  return {
    loadCheckpoint: async () => ({ hit: false }),
    storeCheckpoint: async () => ({ status: 'created', checkpointId: 'sentinel-checkpoint' }),
  };
}

function discoveryEngine(client, overrides = {}) {
  return createAgt002PreviewEngine({
    client,
    model: MODEL,
    policyVersion: 'agt002-integral-v3-policy-test',
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
    // Exactly what createAgt002PreviewRuntime forwards for a V3 construction.
    promptBudget: true,
    promptMaxInputTokens: SERVER_OWNED_MAX_INPUT_TOKENS,
    ...overrides,
  });
}

// =============================================================================================
// 1. The server-owned cap reaches the batched/discovered orchestrator verbatim.
// =============================================================================================
test('the discovered + checkpointHooks route forwards the engine\'s server-owned cap as maxInputTokens', async () => {
  let orchestratorArgs;
  const client = fakeClient(() => {
    throw new Error('the analysis turn belongs to the orchestrator, never to the engine on this route');
  });
  const engine = discoveryEngine(client, {
    batchedV3Orchestrator: async args => {
      orchestratorArgs = args;
      return { status: 'completed', analysis_run_id: FIXED_RUN_ID };
    },
  });

  await engine.analyze(analysisContext(), { analysisCheckpointHooks: missingCheckpointHooks() });

  assert.ok(orchestratorArgs, 'the batched orchestrator must have been invoked');
  assert.equal(
    orchestratorArgs.maxInputTokens, SERVER_OWNED_MAX_INPUT_TOKENS,
    'the batched route must plan against the SAME server-owned cap the engine was configured with, '
    + 'never runAgt002BatchedV3Analysis\'s own default floor',
  );
  assert.notEqual(
    orchestratorArgs.maxInputTokens, AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
    'the silent fallback to the default floor is exactly the defect this pins',
  );
});

// =============================================================================================
// 2. With no override configured, the forwarded cap is the safe-floor default — explicitly, so the
//    batched route can never diverge from the engine's own budget again.
// =============================================================================================
test('with no configured override the batched route is handed the safe-floor default explicitly', async () => {
  let orchestratorArgs;
  const client = fakeClient(() => { throw new Error('unreachable'); });
  const engine = discoveryEngine(client, {
    promptMaxInputTokens: undefined,
    batchedV3Orchestrator: async args => {
      orchestratorArgs = args;
      return { status: 'completed', analysis_run_id: FIXED_RUN_ID };
    },
  });

  await engine.analyze(analysisContext(), { analysisCheckpointHooks: missingCheckpointHooks() });

  assert.equal(
    orchestratorArgs.maxInputTokens, AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
    'the engine must forward its own resolved cap, not leave it undefined for the orchestrator to guess',
  );
});

// =============================================================================================
// 3. The cap is server-owned: no analyze() caller / request body can move it.
// =============================================================================================
test('an analyze() caller can never override the server-owned cap', async () => {
  let orchestratorArgs;
  const client = fakeClient(() => { throw new Error('unreachable'); });
  const engine = discoveryEngine(client, {
    batchedV3Orchestrator: async args => {
      orchestratorArgs = args;
      return { status: 'completed', analysis_run_id: FIXED_RUN_ID };
    },
  });

  await engine.analyze(
    // A hostile caller/browser payload trying both spellings on both surfaces.
    { ...analysisContext(), maxInputTokens: 7, promptMaxInputTokens: 7 },
    { analysisCheckpointHooks: missingCheckpointHooks(), maxInputTokens: 7, promptMaxInputTokens: 7 },
  );

  assert.equal(
    orchestratorArgs.maxInputTokens, SERVER_OWNED_MAX_INPUT_TOKENS,
    'only the constructor (server) cap may govern the batched plan',
  );
});

// =============================================================================================
// 4. The no-hooks (one-turn) discovered route is untouched: same provider turn, same cap, and the
//    injected orchestrator is never consulted.
// =============================================================================================
test('the no-hooks discovered route stays one-turn and keeps using the same server-owned cap', async () => {
  const orchestratorCalls = [];
  const budgetReports = [];
  const client = fakeClient(options => ({
    content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
    usage: { input_tokens: 7, output_tokens: 7 },
  }));
  const engine = discoveryEngine(client, {
    batchedV3Orchestrator: async args => { orchestratorCalls.push(args); return {}; },
    onPromptBudget: report => budgetReports.push(report),
  });

  const envelope = await engine.analyze(analysisContext());

  assert.equal(orchestratorCalls.length, 0, 'without checkpoint hooks the batched orchestrator is never invoked');
  assert.equal(client.calls.length, 1, 'the one-turn route still takes exactly one analysis provider turn');
  assert.equal(envelope.status, 'completed');
  assert.equal(budgetReports.length, 1, 'the one-turn route still budgets its own request');
  assert.equal(
    budgetReports[0].budget_max_input_tokens, SERVER_OWNED_MAX_INPUT_TOKENS,
    'the one-turn route already honoured the server-owned cap and must keep doing so',
  );
});

// =============================================================================================
// 5. Under the budgeted (V3) construction createAgt002PreviewRuntime always performs — it wires
//    `promptBudget: true` for every V3 runtime — the cap is validated at construction, so what the
//    batched route receives is a checked positive integer, never a value that only blows up deep
//    inside a run. The guard stays EXACTLY the pre-existing `promptBudget`-scoped one: an unbudgeted
//    (legacy) construction is byte-identical to before this fix, and the batched route is
//    unreachable from it anyway (it requires integralContractV3 + a discovered frontier).
// =============================================================================================
test('a non-positive-integer cap fails closed at construction of a budgeted engine', () => {
  for (const invalid of [0, -1, 1.5, '180000', null]) {
    assert.throws(
      () => discoveryEngine(fakeClient(() => ({})), { promptMaxInputTokens: invalid }),
      /promptMaxInputTokens/,
      `promptMaxInputTokens=${JSON.stringify(invalid)} must be rejected at construction`,
    );
  }
});

test('an unbudgeted (legacy) construction keeps its pre-existing behaviour: the cap is not validated', () => {
  // Pinned so this fix can never be read as licence to tighten the legacy contract: with
  // promptBudget off, construction accepted any promptMaxInputTokens before and must keep doing so.
  for (const invalid of [0, -1, 1.5, '180000', null]) {
    assert.doesNotThrow(
      () => discoveryEngine(fakeClient(() => ({})), { promptBudget: false, promptMaxInputTokens: invalid }),
      `promptBudget=false must not start rejecting promptMaxInputTokens=${JSON.stringify(invalid)}`,
    );
  }
});

// =============================================================================================
// 6. THE INCIDENT SIGNATURE: discovery fully served from checkpoints (zero bridge turns), then a
//    purely local planning failure. It must be attributed to the closed pre-provider
//    envelope_build frontier -> AGT002_ENVELOPE_INVALID -> the queue's (non-transient)
//    invalid_output, never stage=unexpected and never the provider.
// =============================================================================================
function fakeDatabase() {
  const calls = [];
  let attemptSeq = 0;
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'psi_append_agt002_analysis_attempt') {
        attemptSeq += 1;
        return { data: { id: `attempt-event-${attemptSeq}`, ...params }, error: null };
      }
      if (name === 'psi_release_agt002_preview_claim') return { data: true, error: null };
      if (name === 'psi_record_agt002_canonical_analysis_run') {
        return { data: null, error: { message: 'persistence must never be reached when planning failed closed' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
}

test('a local batched-planning failure is reported as envelope_build/invalid_output, not unexpected', async () => {
  // The bridge is never invoked at all — exactly like the incident, whose 35 discovery batches and
  // manifest were all checkpoint hits.
  const telemetry = { invocationStarted: false, responseReceived: false, invocationCount: 0, responseCount: 0 };
  const client = fakeClient(() => {
    throw new Error('no provider turn may be taken: planning fails closed first');
  });
  // The REAL default batchedV3Orchestrator (runAgt002BatchedV3Analysis) — never a double — with a
  // cap so small that the planner's fixed-point pass fails closed on a lone requirement before any
  // batch, checkpoint or provider call exists. Hooks are bound at construction exactly like
  // createAgt002PreviewRuntime binds them, since runAgt002PostBridgeAnalysis owns the analyze() call.
  const engine = discoveryEngine(client, {
    promptMaxInputTokens: 1,
    checkpointHooks: missingCheckpointHooks(),
  });

  const observability = spyObservability();
  const database = fakeDatabase();
  const result = await runAgt002PostBridgeAnalysis(database, {
    opportunityId: OPPORTUNITY_ID,
    tenderId: TENDER_ID,
    snapshotId: SNAPSHOT_ID,
    contextVersionId: CONTEXT_VERSION_ID,
    attemptKey: 'reanalysis:batched-plan-failure',
    correlationId: CORRELATION_ID,
    claimId: 'claim-plan',
    idempotencyKey: 'd'.repeat(64),
    canonicalOnly: true,
    requireTenderRequirementInventory: false,
  }, {
    engine,
    observability,
    analysisContext: analysisContext(),
    bridgeTelemetry: telemetry,
    integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(client.calls.length, 0, 'precondition: the provider was never asked anything');
  assert.equal(
    result.error_code, 'AGT002_ENVELOPE_INVALID',
    'a local, pre-provider planning refusal is an assembly failure, never an unexpected/provider one',
  );

  const outcome = observability.records.find(record => record.eventType === 'reanalysis_post_bridge_outcome');
  assert.ok(outcome, 'the single post-bridge outcome event must have been emitted');
  assert.equal(outcome.fields.stage, 'envelope_build');
  assert.notEqual(outcome.fields.stage, 'unexpected', 'the live misclassification must not survive this fix');
  assert.equal(outcome.fields.bridge_invocation_started, false);
  assert.equal(outcome.fields.bridge_response_received, false);

  // The queue outcome stays exactly what it already was — a NON-transient invalid_output. This fix
  // localizes the stage; it must never make a deterministic local refusal look retryable.
  assert.equal(classifyAgt002ReanalysisWorkerError({ code: result.error_code }), 'invalid_output');

  assert.equal(
    database.calls.some(call => call.name === 'psi_record_agt002_canonical_analysis_run'), false,
    'a planning refusal must never reach persistence',
  );

  const serialized = JSON.stringify({ result, calls: database.calls, records: observability.records });
  for (const leak of ['Residencia de datos', 'apalancamiento', 'REQUISITOS', 'sintetico-pliego']) {
    assert.equal(serialized.includes(leak), false, 'no expediente content may reach the durable row or observability');
  }
});

// =============================================================================================
// 7. A DURABLE-BOUNDARY failure on the batched route is a persistence failure, not an unexpected
//    one. The batched orchestration already tags a checkpoint/boundary rejection with its own
//    closed `persistence` stage; that stage was then discarded by the engine's generic catch, so
//    the run could only be classified by the bridge-telemetry heuristic and landed on 'unexpected'
//    -> the queue's invalid_output — a retry-less bucket that says "the model answered badly" about
//    a run whose checkpoint store was simply unavailable.
//
//    The engine now forwards this ONE extra stage through a SECOND, separate closed allowlist
//    (AGT002_ENGINE_FORWARDED_DURABLE_STAGES). Tests 7c/7d below pin that the orchestration's two
//    OTHER stages are deliberately excluded and keep classifying exactly as they already did.
// =============================================================================================

/** Hooks whose checkpoint LOAD fails: no provider turn can be taken, so no batch answer is needed. */
function failingLoadCheckpointHooks() {
  return {
    loadCheckpoint: async () => { throw new Error('el almacén de checkpoints rechazó la lectura'); },
    storeCheckpoint: async () => ({ status: 'created', checkpointId: 'sentinel-checkpoint' }),
  };
}

test('a checkpoint-store failure reaches the engine caller as the closed persistence stage', async () => {
  const client = fakeClient(() => {
    throw new Error('no provider turn may be taken: the checkpoint load fails first');
  });
  const engine = discoveryEngine(client, { checkpointHooks: failingLoadCheckpointHooks() });

  const error = await engine.analyze(analysisContext()).then(
    () => { throw new Error('the run must not complete'); },
    caught => caught,
  );

  assert.equal(client.calls.length, 0, 'precondition: the provider was never asked anything');
  // The public message contract is unchanged — only the closed structural metadata is richer.
  assert.equal(error.message, 'AGT-002 Preview no está disponible en este momento.');
  assert.equal(error.stage, 'persistence', 'the durable-boundary stage must survive the engine\'s generic catch');
  assert.equal(error.code, 'AGT002_BATCHED_V3_CHECKPOINT_FAILED');
  assert.equal(
    classifyAgt002ReanalysisWorkerError(error), 'persistence_failure',
    'a checkpoint failure is a persistence failure for the queue, never invalid_output',
  );
  assert.equal(
    JSON.stringify(error).includes('almacén de checkpoints'), false,
    'the upstream store\'s own message must never survive onto the sanitized error',
  );
});

test('a durable-boundary failure is reported as persistence/AGT002_PERSISTENCE_FAILED, not unexpected', async () => {
  const telemetry = { invocationStarted: false, responseReceived: false, invocationCount: 0, responseCount: 0 };
  const client = fakeClient(() => { throw new Error('unreachable'); });
  const engine = discoveryEngine(client, { checkpointHooks: failingLoadCheckpointHooks() });

  const observability = spyObservability();
  const database = fakeDatabase();
  const result = await runAgt002PostBridgeAnalysis(database, {
    opportunityId: OPPORTUNITY_ID,
    tenderId: TENDER_ID,
    snapshotId: SNAPSHOT_ID,
    contextVersionId: CONTEXT_VERSION_ID,
    attemptKey: 'reanalysis:checkpoint-failure',
    correlationId: CORRELATION_ID,
    claimId: 'claim-checkpoint',
    idempotencyKey: 'e'.repeat(64),
    canonicalOnly: true,
    requireTenderRequirementInventory: false,
  }, {
    engine, observability, analysisContext: analysisContext(), bridgeTelemetry: telemetry, integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(result.error_code, 'AGT002_PERSISTENCE_FAILED');

  const outcome = observability.records.find(record => record.eventType === 'reanalysis_post_bridge_outcome');
  assert.equal(outcome.fields.stage, 'persistence');
  assert.notEqual(outcome.fields.stage, 'unexpected', 'the live misclassification must not survive this fix');
  // No real database rejection happened, so no SQLSTATE category may be invented for one.
  assert.equal(outcome.fields.persistence_subcode, null);
  assert.equal(outcome.fields.persistence_attempts, 0);
  assert.equal(outcome.fields.bridge_invocation_started, false);
  assert.equal(outcome.fields.bridge_response_received, false);

  const serialized = JSON.stringify({ result, calls: database.calls, records: observability.records });
  for (const leak of ['Residencia de datos', 'apalancamiento', 'REQUISITOS', 'almacén de checkpoints']) {
    assert.equal(serialized.includes(leak), false, 'no expediente content or upstream error text may reach the durable row');
  }
});

test('a lost lease at a batched boundary is still lease_renewal/AGT002_LEASE_LOST, never persistence', async () => {
  const client = fakeClient(() => { throw new Error('unreachable'); });
  // The orchestration's lease-lost arm tags stage `lease_renewal`, which is deliberately NOT in the
  // forwarded allowlist: it is classified from its own closed code, exactly as it already was.
  const engine = discoveryEngine(client, {
    checkpointHooks: missingCheckpointHooks(),
    beforeProviderCall: async () => {
      const error = new Error('la reserva del trabajo se perdió');
      error.code = 'AGT002_REANALYSIS_LEASE_LOST';
      throw error;
    },
  });

  const observability = spyObservability();
  const result = await runAgt002PostBridgeAnalysis(fakeDatabase(), {
    opportunityId: OPPORTUNITY_ID,
    tenderId: TENDER_ID,
    snapshotId: SNAPSHOT_ID,
    contextVersionId: CONTEXT_VERSION_ID,
    attemptKey: 'reanalysis:lease-lost',
    correlationId: CORRELATION_ID,
    claimId: 'claim-lease',
    idempotencyKey: 'f'.repeat(64),
    canonicalOnly: true,
    requireTenderRequirementInventory: false,
  }, {
    engine,
    observability,
    analysisContext: analysisContext(),
    bridgeTelemetry: { invocationStarted: false, responseReceived: false, invocationCount: 0, responseCount: 0 },
    integralContractV3: true,
  });

  assert.equal(result.error_code, 'AGT002_LEASE_LOST');
  const outcome = observability.records.find(record => record.eventType === 'reanalysis_post_bridge_outcome');
  assert.equal(outcome.fields.stage, 'lease_renewal', 'a confirmed lost lease must never be reattributed to persistence');
});

test('a batched transport timeout still keeps its own closed timeout code', async () => {
  // `transport` is the other deliberately-excluded orchestration stage: the queue reads the closed
  // AGT002_CODEX_TIMEOUT code, which this fix leaves untouched.
  const client = fakeClient(() => {
    const error = new Error('el puente no respondió');
    error.code = 'AGT002_CODEX_TIMEOUT';
    throw error;
  });
  const engine = discoveryEngine(client, { checkpointHooks: missingCheckpointHooks() });

  const error = await engine.analyze(analysisContext()).then(
    () => { throw new Error('the run must not complete'); },
    caught => caught,
  );

  assert.equal(error.code, 'AGT002_CODEX_TIMEOUT');
  assert.equal(error.stage, undefined, 'the orchestration\'s `transport` stage is not forwarded — only its closed code is');
  assert.equal(
    classifyAgt002ReanalysisWorkerError(error), 'timeout',
    'a transport timeout must stay a retryable timeout, never become a persistence failure',
  );
});

// =============================================================================================
// 8. PLAN INCOHERENCE HAS EXACTLY ONE ATTRIBUTION, from EVERY source.
//
//    runAgt002BatchedV3Analysis's own planning refusal (test 6 above) is tagged with the closed
//    pre-provider ENVELOPE stage. runAgt002BatchedV3Orchestration has a SECOND plan-incoherence
//    frontier — validateAgt002BatchedV3Plan, which re-checks the {plan,batches} pairing before any
//    checkpoint or provider interaction — and it minted the same closed PLAN_INCOHERENT code with
//    NO stage at all. That untagged rejection is discarded by the engine's generic catch and can
//    then only be classified by the bridge-telemetry heuristic, landing on 'unexpected': a
//    deterministic, local, pre-provider refusal reported as an unknown frontier.
// =============================================================================================

/** The minimum coherent argument set runAgt002BatchedV3Orchestration requires, with an inert plan. */
function orchestrationArgs(overrides = {}) {
  return {
    plan: {
      planner_version: 'sentinel-planner', contract_version: 'sentinel-contract',
      requirement_manifest_version: 'sentinel-manifest', snapshot_id: 'sentinel-snapshot',
      snapshot_hash: 'sentinel-snapshot-hash', inventory_hash: 'sentinel-inventory-hash',
      model: 'sentinel-model', max_input_tokens: 1000, max_requirements_per_batch: 5,
      requirement_count: 1, batch_count: 1,
      batches: [{
        batch_index: 0, batch_count: 1, requirement_count: 1,
        first_requirement_id: 'sentinel-req-0', last_requirement_id: 'sentinel-req-0',
        request_hash: 'sentinel-request-hash-0', estimated_input_tokens: 10,
      }],
    },
    batches: [{ batch_index: 0, batch_count: 1, requirement_ids: ['sentinel-req-0'] }],
    idempotencyKey: 'sentinel-idempotency-key',
    checkpointHooks: missingCheckpointHooks(),
    beforeBoundary: async () => {},
    executeBatch: async () => { throw new Error('no batch may be executed once the plan is rejected'); },
    validateCheckpoint: output => output,
    mergeBatches: () => { throw new Error('no merge may happen once the plan is rejected'); },
    finalizeEnvelope: () => { throw new Error('no finalize may happen once the plan is rejected'); },
    recordProgress: () => {},
    isRetryableError: () => false,
    ...overrides,
  };
}

test('every plan-coherence rejection carries the closed pre-provider envelope stage', async () => {
  const incoherent = [
    ['plan.batch_count disagrees with batches.length', { batches: [] }],
    ['plan is not an object', { plan: null }],
    ['plan.max_input_tokens is not a positive integer', args => ({ plan: { ...args.plan, max_input_tokens: 0 } })],
    ['a batch request_hash is empty', args => ({ plan: { ...args.plan, batches: [{ ...args.plan.batches[0], request_hash: '' }] } })],
    ['a runtime batch disagrees with its plan batch', { batches: [{ batch_index: 0, batch_count: 1, requirement_ids: ['other-req'] }] }],
  ];

  for (const [label, override] of incoherent) {
    const base = orchestrationArgs();
    const args = { ...base, ...(typeof override === 'function' ? override(base) : override) };
    const error = await runAgt002BatchedV3Orchestration(args).then(
      () => { throw new Error(`${label}: the run must not proceed`); },
      caught => caught,
    );
    assert.equal(error.code, 'AGT002_BATCHED_V3_PLAN_INCOHERENT', `${label}: the closed code is unchanged`);
    assert.equal(
      error.stage, 'envelope',
      `${label}: an incoherent plan is a local pre-provider assembly refusal, and must say so`,
    );
  }
});

test('an incoherent plan surfaced through the engine is envelope_build/invalid_output, never unexpected', async () => {
  const client = fakeClient(() => { throw new Error('no provider turn may be taken: the plan is rejected first'); });
  // The REAL runAgt002BatchedV3Orchestration, handed a plan whose batches do not pair with it.
  const engine = discoveryEngine(client, {
    checkpointHooks: missingCheckpointHooks(),
    batchedV3Orchestrator: () => runAgt002BatchedV3Orchestration(orchestrationArgs({ batches: [] })),
  });

  const observability = spyObservability();
  const database = fakeDatabase();
  const result = await runAgt002PostBridgeAnalysis(database, {
    opportunityId: OPPORTUNITY_ID,
    tenderId: TENDER_ID,
    snapshotId: SNAPSHOT_ID,
    contextVersionId: CONTEXT_VERSION_ID,
    attemptKey: 'reanalysis:plan-incoherent',
    correlationId: CORRELATION_ID,
    claimId: 'claim-incoherent',
    idempotencyKey: 'a'.repeat(64),
    canonicalOnly: true,
    requireTenderRequirementInventory: false,
  }, {
    engine, observability, analysisContext: analysisContext(), integralContractV3: true,
    bridgeTelemetry: { invocationStarted: false, responseReceived: false, invocationCount: 0, responseCount: 0 },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(client.calls.length, 0, 'precondition: the provider was never asked anything');
  assert.equal(result.error_code, 'AGT002_ENVELOPE_INVALID');
  const outcome = observability.records.find(record => record.eventType === 'reanalysis_post_bridge_outcome');
  assert.equal(outcome.fields.stage, 'envelope_build');
  assert.equal(classifyAgt002ReanalysisWorkerError({ code: result.error_code }), 'invalid_output');
  assert.equal(
    database.calls.some(call => call.name === 'psi_record_agt002_canonical_analysis_run'), false,
    'an incoherent plan must never reach persistence',
  );
});
