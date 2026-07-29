import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGT002_WORKBENCH_ENGINE_ID,
  isAgt002WorkbenchApiEnabled,
  isAgt002WorkbenchDrainEnabled,
  getAgt002WorkbenchRuntimeConfig,
  createAgt002WorkbenchRuntime,
  createAgt002WorkbenchDrain,
} from '../agt002-workbench-runtime.js';

const AGENT_ID = '10000000-0000-4000-8000-000000000099';

function baseEnv(overrides = {}) {
  return {
    AGT002_WORKBENCH_RUNTIME: AGT002_WORKBENCH_ENGINE_ID,
    AGT002_WORKBENCH_DRAIN_ENABLED: 'true',
    AGT002_WORKBENCH_MODEL: 'vigia-workbench-model',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
    AGT002_WORKBENCH_AGENT_ID: AGENT_ID,
    AGT002_WORKBENCH_WORKER_ID: 'worker-test',
    ...overrides,
  };
}

// ===========================================================================
// Gates and config resolution
// ===========================================================================

// --- API gate: exact engine id only ---
assert.equal(isAgt002WorkbenchApiEnabled({}), false);
assert.equal(isAgt002WorkbenchApiEnabled({ AGT002_WORKBENCH_RUNTIME: 'something_else' }), false);
assert.equal(isAgt002WorkbenchApiEnabled({ AGT002_WORKBENCH_RUNTIME: AGT002_WORKBENCH_ENGINE_ID }), true);

// --- Drain gate requires API gate + explicit drain flag + full valid config ---
assert.equal(isAgt002WorkbenchDrainEnabled({}), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_RUNTIME: undefined })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_DRAIN_ENABLED: undefined })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_DRAIN_ENABLED: 'TRUE' })), false, 'debe ser exactamente la cadena "true"');
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_DRAIN_ENABLED: '1' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv()), true);

// --- Own model required explicitly; never falls back to the AGT-002 Preview model ---
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_MODEL: undefined })), false);
assert.equal(
  isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_MODEL: undefined, AGT002_PREVIEW_MODEL: 'other-preview-model' })),
  false,
  'AGT002_WORKBENCH_MODEL nunca debe heredar el modelo de AGT-002 Preview',
);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_MODEL: '   ' })), false);

// --- Bridge URL/secret reused from AGT002_HETZNER_BRIDGE_*, but must be valid ---
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_HETZNER_BRIDGE_URL: 'http://not-https.example' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_HETZNER_BRIDGE_URL: 'not-a-url' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(31) })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32) })), true);

// --- Agent id must be a valid UUID ---
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_AGENT_ID: 'not-a-uuid' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_AGENT_ID: undefined })), false);

// --- Worker id must be a non-empty string ---
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_WORKER_ID: '   ' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_WORKER_ID: undefined })), false);

// --- caps opcionales: 0 significa ilimitado; negativos/malformados fallan cerrado ---
assert.throws(() => getAgt002WorkbenchRuntimeConfig(baseEnv({ AGT002_WORKBENCH_RUNTIME: undefined })), /no est[aá] configurad/i);
assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv()).dailyMaxJobs, 0, 'sin variable no hay cuota diaria artificial');
assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv({ AGT002_WORKBENCH_DAILY_MAX_JOBS: '0' })).dailyMaxJobs, 0);
assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv({ AGT002_WORKBENCH_DAILY_MAX_JOBS: '5' })).dailyMaxJobs, 5);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_DAILY_MAX_JOBS: '-1' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_DAILY_MAX_JOBS: 'not-a-number' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_DAILY_MAX_JOBS: '2147483648' })), false);

assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv()).maxConcurrent, 0, 'sin variable no hay tope artificial de concurrencia');
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_MAX_CONCURRENT: '0' })), true);
assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv({ AGT002_WORKBENCH_MAX_CONCURRENT: '2' })).maxConcurrent, 2);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_MAX_CONCURRENT: '-1' })), false);

// --- timeout 1..45000, default 30000 ---
assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv()).timeoutMs, 30_000);
assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv({ AGT002_WORKBENCH_TIMEOUT_MS: '1' })).timeoutMs, 1);
assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv({ AGT002_WORKBENCH_TIMEOUT_MS: '45000' })).timeoutMs, 45_000);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_TIMEOUT_MS: '0' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_TIMEOUT_MS: '45001' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_TIMEOUT_MS: 'nope' })), false);

// --- lease is derived, never independently configurable, and stays within bounds ---
{
  const config = getAgt002WorkbenchRuntimeConfig(baseEnv({ AGT002_WORKBENCH_TIMEOUT_MS: '5000' }));
  assert.equal(config.leaseSeconds, Math.ceil(5000 / 1000) + 15);
  assert.ok(config.leaseSeconds <= 600);
}

// --- sweep max bounded ---
assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv()).sweepMax > 0, true);
assert.equal(getAgt002WorkbenchRuntimeConfig(baseEnv({ AGT002_WORKBENCH_SWEEP_MAX: '500' })).sweepMax, 500);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_SWEEP_MAX: '501' })), false);
assert.equal(isAgt002WorkbenchDrainEnabled(baseEnv({ AGT002_WORKBENCH_SWEEP_MAX: '0' })), false);

// --- createAgt002WorkbenchRuntime fails closed and never eagerly touches the network ---
assert.throws(() => createAgt002WorkbenchRuntime({ environment: {} }), /no est[aá] configurad/i);
{
  const runtime = createAgt002WorkbenchRuntime({ environment: baseEnv() });
  assert.equal(typeof runtime.responder.respond, 'function');
  assert.equal(runtime.config.model, 'vigia-workbench-model');
}

// --- Never manages an API key/bearer token directly; secrets stay in env only ---
{
  const source = readFileSync(new URL('../agt002-workbench-runtime.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.(log|warn|error)\([^)]*(hmacSecret|HMAC_SECRET)/i);
}

console.log('AGT-002 workbench runtime gates + config passed');

// ===========================================================================
// createAgt002WorkbenchDrain: sweep-before-claim, dynamic kill switch, quota/
// saturated/idle passthrough, exactly one job per invocation, sanitized output.
// ===========================================================================

function jobRow(id) {
  return {
    id,
    thread_id: '10000000-0000-4000-8000-000000000101',
    origin_message_id: '10000000-0000-4000-8000-000000000102',
    opportunity_id: '10000000-0000-4000-8000-000000000103',
    tender_id: '10000000-0000-4000-8000-000000000104',
    snapshot_id: '10000000-0000-4000-8000-000000000105',
    base_version_id: null,
    capability_id: 'agt002.dossier-workbench.reply.v1',
    contract_version: 'agt002.dossier-workbench.v1',
    policy_version: 'agt002.dossier-workbench.policy.v1',
    context_links: [],
    message: 'Identifique los faltantes con sus fuentes.',
    requested_by: '10000000-0000-4000-8000-000000000106',
    idempotency_key: 'a'.repeat(64),
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function fakeDatabase(handlers) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) throw new Error(`Unexpected RPC in test double: ${name}`);
      return handler(args, calls);
    },
  };
}

function fakeBridgeClient(runImpl) {
  const calls = [];
  return { calls, async run(args) { calls.push(args); return runImpl(args); } };
}

function validReplyModelClient() {
  return fakeBridgeClient(async () => ({
    content: JSON.stringify({ content_text: 'ok', source_links: [], missing_information: [], required_actions: [] }),
    usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null,
  }));
}

// --- Disabled gate: runOnce() is a safe no-op, never touches the database ---
{
  const database = fakeDatabase({});
  const drain = createAgt002WorkbenchDrain({ database, environment: {}, bridgeClient: validReplyModelClient() });
  const result = await drain.runOnce();
  assert.deepEqual(result, { status: 'disabled' });
  assert.equal(database.calls.length, 0);
}

// --- Sweeps expired leases before claiming; exactly one claim (no second job per invocation) ---
{
  const database = fakeDatabase({
    psi_sweep_agt002_workbench_expired_leases: () => ({ data: { status: 'swept', released: 3, job_ids: [], max: 25, more: false }, error: null }),
    psi_claim_agt002_workbench_job: () => ({ data: { status: 'empty' }, error: null }),
  });
  const bridgeClient = validReplyModelClient();
  const drain = createAgt002WorkbenchDrain({ database, environment: baseEnv(), bridgeClient });
  const result = await drain.runOnce();
  assert.deepEqual(result, { status: 'idle', swept: 3 });
  assert.deepEqual(database.calls.map(call => call.name), [
    'psi_sweep_agt002_workbench_expired_leases',
    'psi_claim_agt002_workbench_job',
  ], 'el barrido debe ocurrir antes del claim');
  assert.equal(bridgeClient.calls.length, 0);
}

// --- Quota/saturated pass through cleanly, without ever invoking the model ---
for (const status of ['quota', 'saturated']) {
  const database = fakeDatabase({
    psi_sweep_agt002_workbench_expired_leases: () => ({ data: { status: 'swept', released: 0, job_ids: [], max: 25, more: false }, error: null }),
    psi_claim_agt002_workbench_job: () => ({ data: { status }, error: null }),
  });
  const bridgeClient = validReplyModelClient();
  const drain = createAgt002WorkbenchDrain({ database, environment: baseEnv(), bridgeClient });
  const result = await drain.runOnce();
  assert.deepEqual(result, { status, swept: 0 });
  assert.equal(bridgeClient.calls.length, 0);
}

// --- Dynamic kill switch: a flip between claim and the bridge call blocks the model ---
{
  const environment = baseEnv();
  const job = jobRow('10000000-0000-4000-8000-000000000201');
  const claimId = '10000000-0000-4000-8000-000000000202';
  const database = fakeDatabase({
    psi_sweep_agt002_workbench_expired_leases: () => ({ data: { status: 'swept', released: 0, job_ids: [], max: 25, more: false }, error: null }),
    psi_claim_agt002_workbench_job: () => {
      // El drain ya reclamó el trabajo; el operador apaga el interruptor antes de que
      // el responder llegue a invocar al modelo.
      environment.AGT002_WORKBENCH_DRAIN_ENABLED = 'false';
      return { data: { status: 'claimed', claim_id: claimId, job }, error: null };
    },
    psi_append_agt002_workbench_job_event: () => ({ data: { status: 'failed', event_id: 'evt-1' }, error: null }),
  });
  const bridgeClient = validReplyModelClient();
  const drain = createAgt002WorkbenchDrain({ database, environment, bridgeClient });
  const result = await drain.runOnce();
  assert.equal(result.status, 'failed', 'el cambio de interruptor a mitad de camino debe fallar el trabajo, no completarlo');
  assert.equal(bridgeClient.calls.length, 0, 'el modelo nunca debe invocarse tras el apagado dinámico');
  const failedCall = database.calls.find(call => call.name === 'psi_append_agt002_workbench_job_event');
  assert.equal(failedCall.args.p_event_type, 'failed');
  assert.equal(failedCall.args.p_metadata.code, 'AGT002_RESPONDER_KILL_SWITCH_ENGAGED');
}

// --- Full success path: sanitized return shape only (status/swept/job_id) ---
{
  const job = jobRow('10000000-0000-4000-8000-000000000301');
  const claimId = '10000000-0000-4000-8000-000000000302';
  const database = fakeDatabase({
    psi_sweep_agt002_workbench_expired_leases: () => ({ data: { status: 'swept', released: 1, job_ids: [], max: 25, more: false }, error: null }),
    psi_claim_agt002_workbench_job: () => ({ data: { status: 'claimed', claim_id: claimId, job }, error: null }),
    psi_complete_agt002_workbench_job: () => ({ data: { status: 'completed', message_id: 'msg-1', event_id: 'evt-2' }, error: null }),
  });
  const bridgeClient = validReplyModelClient();
  const drain = createAgt002WorkbenchDrain({ database, environment: baseEnv(), bridgeClient });
  const result = await drain.runOnce();
  assert.deepEqual(result, { status: 'completed', job_id: job.id, swept: 1 });
  assert.deepEqual(Object.keys(result).sort(), ['job_id', 'status', 'swept']);
  assert.equal(bridgeClient.calls.length, 1);
}

console.log('AGT-002 workbench drain (sweep-before-claim, dynamic kill switch, sanitized output) passed');
