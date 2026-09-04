// AGT-002 fenced lease heartbeat — preview runtime + engine + persistence frontier (RED).
//
// Pins the runtime/integration half of the deterministic stage-boundary heartbeat for the preview
// claim (migration 028's psi_agt002_preview_claims and its `claim_id` fencing token):
//
//   A. createAgt002PreviewRuntime, given the claim it is running under, builds ONE renewal hook and
//      hands it to the engine — so a V7 run whose N provider turns outlive a two-turn lease renews
//      at each boundary instead of being reclaimed underneath itself.
//   B. createAgt002PreviewEngine awaits that hook IMMEDIATELY BEFORE its provider turn, and a lost
//      lease stops the turn from happening at all.
//   C. runAgt002PostBridgeAnalysis renews IMMEDIATELY BEFORE canonical persistence, and a lost lease
//      stops persistence from being attempted at all — the claim is still released exactly once.
//
// Every fixture below reuses the smallest existing seams (the `createEngine` spy already used by
// tests/agt002-preview-runtime.test.mjs, the engine's own injected `client`, and the Supabase-shaped
// `.rpc()` double already used by the post-bridge/persistence tests). Nothing is mocked out of
// agt002-preview-persistence.js or agt002-post-bridge-observability.js: the real modules run. No
// network, no provider, no secret, no timer and no sleep.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createAgt002PreviewRuntime, getAgt002PreviewRuntimeConfig } from '../agt002-preview-runtime.js';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { AGT002_POST_BRIDGE_ERROR_CODES, runAgt002PostBridgeAnalysis } from '../agt002-post-bridge-observability.js';

const RENEW_RPC = 'psi_renew_agt002_preview_claim';
const RELEASE_RPC = 'psi_release_agt002_preview_claim';
const RUN_RPC = 'psi_record_tender_analysis_run';
const ATTEMPT_RPC = 'psi_append_agt002_analysis_attempt';

const IDS = Object.freeze({
  opportunity: '00000000-0000-4000-8000-000000000012',
  tender: '00000000-0000-4000-8000-000000000013',
  snapshot: '00000000-0000-4000-8000-000000000014',
  contextVersion: '00000000-0000-4000-8000-000000000015',
  correlation: '00000000-0000-4000-8000-000000000016',
  claim: '00000000-0000-4000-8000-0000000000c9',
});
const IDEMPOTENCY_KEY = 'd'.repeat(64);

function baseEnv(overrides = {}) {
  return {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'synthetic-codex-model',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
    ...overrides,
  };
}

function fakeDb({ rpcResults = {} } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    names: () => rpcCalls.map(call => call.name),
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const result = rpcResults[name];
      if (typeof result === 'function') return Promise.resolve(result(args));
      return Promise.resolve(result || { data: null, error: null });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// A. The runtime builds the renewal hook from the claim it is running under.
// ---------------------------------------------------------------------------------------------

function captureRuntimeOptions({ database, previewClaim, environment = baseEnv() } = {}) {
  let captured = null;
  createAgt002PreviewRuntime({
    environment,
    countDailyRuns: async () => 0,
    database,
    previewClaim,
    createEngine: options => { captured = options; return { analyze: async () => { throw new Error('not called'); } }; },
  });
  return captured;
}

test('the runtime hands the engine a beforeProviderCall bound to the run\'s own claim', async () => {
  const database = fakeDb({
    rpcResults: { [RENEW_RPC]: { data: { status: 'renewed', lease_expires_at: '2026-09-02T00:01:15.000Z' }, error: null } },
  });
  const options = captureRuntimeOptions({
    database,
    previewClaim: { idempotencyKey: IDEMPOTENCY_KEY, claimId: IDS.claim },
  });
  assert.equal(
    typeof options.beforeProviderCall, 'function',
    'a preview runtime constructed under a claim must forward a stage-boundary renewal hook to the engine, exactly like it forwards semanticDiscoveryProvider',
  );

  await options.beforeProviderCall();
  const expectedLeaseSeconds = getAgt002PreviewRuntimeConfig(baseEnv()).leaseSeconds;
  assert.deepEqual(database.rpcCalls, [{
    name: RENEW_RPC,
    args: { p_idempotency_key: IDEMPOTENCY_KEY, p_claim_id: IDS.claim, p_lease_seconds: expectedLeaseSeconds },
  }], "the hook must renew THIS run's claim, fenced by its claim_id, for exactly the configured lease window");
});

test('a lost lease makes the runtime hook fail closed instead of resolving', async () => {
  const database = fakeDb({ rpcResults: { [RENEW_RPC]: { data: { status: 'lost' }, error: null } } });
  const options = captureRuntimeOptions({
    database,
    previewClaim: { idempotencyKey: IDEMPOTENCY_KEY, claimId: IDS.claim },
  });
  assert.equal(typeof options.beforeProviderCall, 'function');
  await assert.rejects(
    () => options.beforeProviderCall(),
    error => {
      assert.match(String(error?.code ?? error?.runtime_boundary_code ?? ''), /LEASE/, 'a lost lease must be reported with a stable, non-secret lease code');
      return true;
    },
    'a lost lease must reject so the guarded provider call never happens',
  );
  assert.equal(database.rpcCalls.length, 1, 'a lost lease must not trigger any follow-up call');
});

test('a runtime constructed without a claim is unchanged: no hook is invented', () => {
  const options = captureRuntimeOptions({ database: fakeDb(), previewClaim: undefined });
  assert.equal(
    options.beforeProviderCall, undefined,
    'an existing caller that supplies no claim must keep exactly its current engine options; the heartbeat is never fabricated',
  );
});

// ---------------------------------------------------------------------------------------------
// B. The real engine awaits the hook immediately before its provider turn.
// ---------------------------------------------------------------------------------------------

const ANALYZE_CONTEXT = Object.freeze({
  opportunity: {},
  documents: [{ id: 'd1', name: 'n', document_type: 't', extracted_text: 'x' }],
  companyProfile: {},
  deepAnalysis: {},
  snapshotId: IDS.snapshot,
});

function engineWithHook({ beforeProviderCall, events, clientRun }) {
  return createAgt002PreviewEngine({
    client: { run: async request => { events.push('provider_call'); return clientRun(request); } },
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v2',
    countDailyRuns: async () => 0,
    beforeProviderCall,
  });
}

test('the engine renews immediately before its provider turn', async () => {
  const events = [];
  const engine = engineWithHook({
    events,
    beforeProviderCall: async () => { events.push('before_provider_call'); },
    // The provider answer itself is irrelevant here: this test pins the ORDER of the stage
    // boundary, not the parsing that follows it.
    clientRun: async () => { throw new Error('synthetic provider failure'); },
  });
  await assert.rejects(() => engine.analyze({ ...ANALYZE_CONTEXT }, { idempotencyKey: IDEMPOTENCY_KEY }));
  assert.deepEqual(
    events, ['before_provider_call', 'provider_call'],
    'the lease must be renewed immediately BEFORE the provider turn, never after it and never on a timer',
  );
});

test('a lost lease stops the engine before it reaches the provider', async () => {
  const events = [];
  const leaseLost = new Error('la reserva AGT-002 se perdio antes de la llamada al proveedor');
  leaseLost.code = 'AGT002_PREVIEW_LEASE_LOST';
  const engine = engineWithHook({
    events,
    beforeProviderCall: async () => { events.push('before_provider_call'); throw leaseLost; },
    clientRun: async () => ({ content: '{}', usage: { input_tokens: 1, output_tokens: 1 } }),
  });
  await assert.rejects(
    () => engine.analyze({ ...ANALYZE_CONTEXT }, { idempotencyKey: IDEMPOTENCY_KEY }),
    error => {
      assert.match(String(error?.code ?? ''), /LEASE/, "the engine's safe wrapper must preserve the closed lease code so the caller can classify the failure");
      assert.doesNotMatch(String(error?.message ?? ''), /se perdio antes/, 'the raw rejection message must never reach the caller verbatim');
      return true;
    },
  );
  assert.deepEqual(events, ['before_provider_call'], 'a lost lease must cost zero provider turns');
});

test('an engine with no hook injected keeps its exact current behaviour', async () => {
  const events = [];
  const engine = createAgt002PreviewEngine({
    client: { run: async () => { events.push('provider_call'); throw new Error('synthetic provider failure'); } },
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v2',
    countDailyRuns: async () => 0,
  });
  await assert.rejects(() => engine.analyze({ ...ANALYZE_CONTEXT }, { idempotencyKey: `${IDEMPOTENCY_KEY}-nohook` }));
  assert.deepEqual(events, ['provider_call'], 'no hook means no extra call of any kind');
});

// ---------------------------------------------------------------------------------------------
// C. The persistence/release frontier is its own stage boundary.
//
// Legacy (non-canonical) envelope on purpose: it is the smallest input that drives the REAL
// registerAgt002PreviewAnalysis all the way to a real run RPC, so "persistence was attempted" is
// directly observable in the RPC log rather than inferred.
// ---------------------------------------------------------------------------------------------

function legacyEnvelope() {
  return {
    producer: 'AGT-002', agent_id: 'AGT-002', method: 'agent_ai',
    schema_version: 'agt002-preview-v1',
    policy_version: 'agt002-preview-policy-v2',
    usage: { model: 'synthetic-codex-model' },
    recommendation: 'no_go',
    summary: 'Resumen sintético.',
    strengths: [], weaknesses: [], blockers: [], questions: [], unverified: [],
    next_action: 'Revisión humana.',
    human_review_required: true,
  };
}

function postBridgeDb(renewResult) {
  return fakeDb({
    rpcResults: {
      [ATTEMPT_RPC]: { data: { id: '00000000-0000-4000-8000-0000000000e1' }, error: null },
      [RENEW_RPC]: { data: renewResult, error: null },
      [RUN_RPC]: {
        data: {
          id: '00000000-0000-4000-8000-0000000000f1',
          snapshot_id: IDS.snapshot, producer: 'AGT-002', method: 'agent_ai', status: 'completed', critical_open_count: 0,
        },
        error: null,
      },
      [RELEASE_RPC]: { data: true, error: null },
    },
  });
}

function postBridgeContext() {
  return {
    opportunityId: IDS.opportunity, tenderId: IDS.tender, snapshotId: IDS.snapshot,
    contextVersionId: IDS.contextVersion, attemptKey: 'attempt-heartbeat-1', correlationId: IDS.correlation,
    claimId: IDS.claim, idempotencyKey: IDEMPOTENCY_KEY, leaseSeconds: 75,
    canonicalOnly: false, requireTenderRequirementInventory: false,
  };
}

test('the claim is renewed immediately before persistence is attempted', async () => {
  const database = postBridgeDb({ status: 'renewed', lease_expires_at: '2026-09-02T00:01:15.000Z' });
  const result = await runAgt002PostBridgeAnalysis(database, postBridgeContext(), {
    engine: { analyze: async () => legacyEnvelope() },
    observability: { record: () => {} },
    analysisContext: { documents: [] },
  });

  assert.equal(result.status, 'completed', 'a healthy lease must not change the existing successful outcome');

  const renewCalls = database.rpcCalls.filter(call => call.name === RENEW_RPC);
  assert.equal(renewCalls.length, 1, 'persistence is one stage boundary, so it renews exactly once — never on a timer');
  assert.deepEqual(
    renewCalls[0].args,
    { p_idempotency_key: IDEMPOTENCY_KEY, p_claim_id: IDS.claim, p_lease_seconds: 75 },
    'the persistence-frontier renewal must be fenced by the same claim_id the run holds',
  );

  const names = database.names();
  assert.ok(
    names.indexOf(RENEW_RPC) < names.indexOf(RUN_RPC),
    'the lease must be renewed BEFORE the canonical persistence RPC, not afterwards',
  );
  assert.ok(names.includes(RELEASE_RPC), 'the existing exactly-once claim release must be preserved');
});

test('a lost lease prevents persistence entirely and still releases the claim exactly once', async () => {
  const database = postBridgeDb({ status: 'lost' });
  const result = await runAgt002PostBridgeAnalysis(database, postBridgeContext(), {
    engine: { analyze: async () => legacyEnvelope() },
    observability: { record: () => {} },
    analysisContext: { documents: [] },
  });

  assert.equal(
    database.names().includes(RUN_RPC), false,
    'a run whose lease was lost must never attempt persistence: another worker may already own this reservation',
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null, 'no run id may be fabricated for a persistence that never happened');
  assert.ok(
    Object.values(AGT002_POST_BRIDGE_ERROR_CODES).includes(result.error_code),
    'the failure must be reported with an existing closed post-bridge error code, never a new free-form one',
  );
  assert.equal(
    database.rpcCalls.filter(call => call.name === RELEASE_RPC).length, 1,
    'the existing exactly-once claim release must still happen after a lost-lease failure',
  );
  assert.doesNotMatch(JSON.stringify(result), /se perdio|lease_expires_at/, 'no raw renewal detail may reach the caller payload');
});
