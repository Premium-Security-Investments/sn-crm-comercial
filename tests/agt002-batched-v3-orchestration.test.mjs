// AGT-002 durable batched analysis — Task 6A1 (docs/plans/2026-09-03-agt002-durable-batched-analysis.md,
// "Task 6: Engine orchestration"), TDD RED slice, TESTS-ONLY.
//
// Pins the not-yet-created `runAgt002BatchedV3Orchestration` export of `agt002-preview-engine.js`: a
// small, dependency-injected helper that drives one durable-batched V3 analysis run across the
// Task-4 batch plan, using the real-shaped Task-2 checkpoint hooks
// (`loadCheckpoint({stage,batchIndex,expectedRequestHash,validate})` /
// `storeCheckpoint({stage,batchIndex,requestHash,stageContractVersion,output,outputSha256,usage,
// providerIdempotencyKey})` — see agt002-analysis-checkpoints.js) and the bounded per-boundary
// retry precedent already proven for semantic discovery (tender-semantic-discovery-batch-retry.test.mjs:
// heartbeat re-awaited before every attempt, same request/idempotency identity reused on retry, only
// the bridge's own retryable code retried).
//
// `agt002-preview-engine.js` already exists with many other exports, so a plain named import of the
// still-missing export would throw a module-load SyntaxError and abort this whole file before any
// test() body runs. A namespace import avoids that: the module loads fine, and a missing export is
// simply `undefined` on the namespace object — an ORDINARY assertion failure (first test below), not
// a file-aborting load error.
//
// Only tiny sentinel objects are used below — no real V3 content, no network/provider/DB. Task-5 owns
// semantic merge correctness; `mergeBatches`/`finalizeEnvelope`/`executeBatch`/`validateCheckpoint`/
// `isRetryableError` are all dependency-injected here and asserted only on call count/order/argument
// shape, never on real V3 semantics.
//
// RED command: node --test tests/agt002-batched-v3-orchestration.test.mjs
import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as Agt002PreviewEngine from '../agt002-preview-engine.js';
import { AGT002_CHECKPOINT_STAGES } from '../agt002-analysis-checkpoints.js';

// Real closed Task-2 stage this helper is expected to bind every checkpoint call to — never
// invented here, cross-checked against the actual closed catalog.
const STAGE = 'integral_analysis_batch';
assert.ok(AGT002_CHECKPOINT_STAGES.includes(STAGE), 'test bug: STAGE must be a real AGT002_CHECKPOINT_STAGES member');

const RAW_LEAK_SENTINELS = [
  'RAW_PROVIDER_ERROR_SENTINEL',
  'RAW_PROMPT_SENTINEL',
  'RAW_RESPONSE_SENTINEL',
  'RAW_SOURCE_SENTINEL',
];

const SIGNAL_SENTINEL = { sentinel: 'abort-signal' };

// ---------------------------------------------------------------------------------------------
// Tiny sentinel Task-4-shaped plan/batches builders — field names mirror the real
// agt002-integral-analysis-batches.js output exactly; every value is an inert sentinel.
// ---------------------------------------------------------------------------------------------
function makePlan(batchCount, overrides = {}) {
  const batches = Array.from({ length: batchCount }, (_, batchIndex) => ({
    batch_index: batchIndex,
    batch_count: batchCount,
    requirement_count: 1,
    first_requirement_id: `sentinel-req-${batchIndex}`,
    last_requirement_id: `sentinel-req-${batchIndex}`,
    request_hash: `sentinel-request-hash-${batchIndex}`,
    estimated_input_tokens: 10,
  }));
  return {
    planner_version: 'sentinel-planner-v1',
    contract_version: 'sentinel-contract-v1',
    requirement_manifest_version: 'sentinel-manifest-v1',
    snapshot_id: 'sentinel-snapshot',
    snapshot_hash: 'sentinel-snapshot-hash',
    inventory_hash: 'sentinel-inventory-hash',
    model: 'sentinel-model',
    max_input_tokens: 1000,
    max_requirements_per_batch: 5,
    requirement_count: batchCount,
    batch_count: batchCount,
    batches,
    ...overrides,
  };
}

function makeBatches(batchCount) {
  return Array.from({ length: batchCount }, (_, batchIndex) => ({
    batch_index: batchIndex,
    batch_count: batchCount,
    requirement_ids: [`sentinel-req-${batchIndex}`],
  }));
}

function defaultValidateCheckpoint(output) {
  return output && typeof output === 'object' ? { ...output } : null;
}

function defaultIsRetryableError(error) {
  return error?.code === 'SENTINEL_RETRYABLE_TIMEOUT';
}

function buildInput(overrides = {}) {
  const batchCount = overrides.batchCount ?? 2;
  return {
    plan: overrides.plan ?? makePlan(batchCount),
    batches: overrides.batches ?? makeBatches(batchCount),
    priorUsage: 'priorUsage' in overrides ? overrides.priorUsage : { input_tokens: 5, output_tokens: 2 },
    idempotencyKey: overrides.idempotencyKey ?? 'sentinel-run-key',
    signal: 'signal' in overrides ? overrides.signal : SIGNAL_SENTINEL,
    checkpointHooks: overrides.checkpointHooks,
    beforeBoundary: overrides.beforeBoundary,
    executeBatch: overrides.executeBatch,
    validateCheckpoint: overrides.validateCheckpoint ?? defaultValidateCheckpoint,
    mergeBatches: overrides.mergeBatches,
    finalizeEnvelope: overrides.finalizeEnvelope,
    recordProgress: overrides.recordProgress ?? (() => {}),
    maxBatchAttempts: overrides.maxBatchAttempts ?? 3,
    isRetryableError: overrides.isRetryableError ?? defaultIsRetryableError,
    now: overrides.now ?? (() => Date.now()),
  };
}

// Normalizes a sync throw into a rejection, so assert.rejects behaves identically whether the
// helper is (correctly) async or (today) simply undefined.
function invoke(input) {
  return Promise.resolve().then(() => Agt002PreviewEngine.runAgt002BatchedV3Orchestration(input));
}

// Real-shaped Task-2 checkpoint store double: hit only on an exact (stage,batchIndex) whose
// requestHash matches, revalidated through the caller's own `validate` on every load — byte-faithful
// to loadAgt002AnalysisCheckpoint's contract in agt002-analysis-checkpoints.js.
function makeCheckpointStore(events, seed = new Map()) {
  const store = new Map(seed);
  const loadCalls = [];
  const storeCalls = [];
  return {
    store,
    loadCalls,
    storeCalls,
    async loadCheckpoint({ stage, batchIndex, expectedRequestHash, validate }) {
      loadCalls.push({ stage, batchIndex, expectedRequestHash });
      events.push({ kind: 'load_checkpoint', batchIndex });
      const row = store.get(batchIndex);
      if (!row || row.stage !== stage || row.requestHash !== expectedRequestHash) return { hit: false };
      let canonical;
      try { canonical = validate(row.output); } catch { return { hit: false }; }
      if (!canonical) return { hit: false };
      return {
        hit: true,
        output: canonical,
        usage: row.usage,
        requestHash: row.requestHash,
        stageContractVersion: row.stageContractVersion,
        providerIdempotencyKey: row.providerIdempotencyKey,
      };
    },
    async storeCheckpoint(params) {
      storeCalls.push(params);
      events.push({ kind: 'store_checkpoint', batchIndex: params.batchIndex });
      store.set(params.batchIndex, {
        stage: params.stage,
        requestHash: params.requestHash,
        stageContractVersion: params.stageContractVersion,
        output: params.output,
        usage: params.usage,
        providerIdempotencyKey: params.providerIdempotencyKey,
      });
      return { status: 'created', checkpointId: `sentinel-checkpoint-${params.batchIndex}` };
    },
  };
}

function boundaryTracker(events, { failWhen } = {}) {
  return async ({ boundary, batchIndex }) => {
    events.push({ kind: 'boundary', boundary, batchIndex });
    if (failWhen && failWhen(boundary, batchIndex)) {
      const error = new Error('sentinel lease lost immediately before boundary');
      error.code = 'SENTINEL_LEASE_LOST';
      throw error;
    }
  };
}

// `scriptByBatchIndex[i]` is an ordered list of outcomes for the (i)-th batch's successive
// executeBatch attempts, mirroring sequencedClient in tender-semantic-discovery-batch-retry.test.mjs.
function scriptedExecuteBatch(events, scriptByBatchIndex) {
  const cursors = {};
  const calls = [];
  return {
    calls,
    async executeBatch({ batch, planBatch, providerIdempotencyKey, priorUsage, signal, attempt }) {
      const batchIndex = batch.batch_index;
      calls.push({ batchIndex, attempt, providerIdempotencyKey, priorUsage, signal, planBatch });
      events.push({ kind: 'execute_batch', batchIndex, attempt });
      const steps = scriptByBatchIndex[batchIndex] || [];
      const stepIndex = cursors[batchIndex] ?? 0;
      cursors[batchIndex] = stepIndex + 1;
      const step = steps[stepIndex];
      if (!step) throw new Error(`test bug: no scripted step for batch ${batchIndex} call #${stepIndex + 1}`);
      if (step.type === 'timeout') {
        const error = new Error('RAW_PROVIDER_ERROR_SENTINEL: upstream boom, never forward this text');
        error.code = 'SENTINEL_RETRYABLE_TIMEOUT';
        throw error;
      }
      if (step.type === 'fatal') {
        const error = new Error('RAW_PROVIDER_ERROR_SENTINEL: fatal, never retried');
        error.code = 'SENTINEL_FATAL';
        throw error;
      }
      return { output: step.output, usage: step.usage };
    },
  };
}

function trackedMerge(events) {
  const calls = [];
  return {
    calls,
    mergeBatches(canonicalOutputsInOrder) {
      calls.push(canonicalOutputsInOrder);
      events.push({ kind: 'merge_batches' });
      return { merged: true, count: canonicalOutputsInOrder.length, batchTokens: canonicalOutputsInOrder.map(o => o.batchToken) };
    },
  };
}

function trackedFinalize(events) {
  const calls = [];
  return {
    calls,
    finalizeEnvelope(arg) {
      calls.push(arg);
      events.push({ kind: 'finalize_envelope' });
      return { envelope: true, ...arg };
    },
  };
}

// No prompt/response/source-text/provider-error string may ever reach recordProgress, and no such
// string may ever reach the caller through a thrown/rejected error's own message or string-valued
// enumerable properties (mirrors the FORBIDDEN_OUTPUT_KEYS discipline of agt002-analysis-checkpoints.js,
// applied here to string CONTENT rather than object keys).
function assertNoRawLeak(...haystacks) {
  const combined = haystacks.map(value => {
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join('\n');
  for (const sentinel of RAW_LEAK_SENTINELS) {
    assert.ok(!combined.includes(sentinel), `must never forward raw content matching "${sentinel}"`);
  }
}

// ---------------------------------------------------------------------------------------------
test('exports runAgt002BatchedV3Orchestration as a function (RED)', () => {
  assert.equal(typeof Agt002PreviewEngine.runAgt002BatchedV3Orchestration, 'function');
});

// ---------------------------------------------------------------------------------------------
test('two-batch happy path: exact order, stable idempotency keys, boundary heartbeats, one checkpoint write per batch, usage aggregation, merge/finalize exactly once, safe progress only', async () => {
  const events = [];
  const progressEvents = [];
  const plan = makePlan(2);
  const batches = makeBatches(2);
  const checkpoints = makeCheckpointStore(events);
  const beforeBoundary = boundaryTracker(events);
  const exec = scriptedExecuteBatch(events, {
    0: [{ type: 'success', output: { batchToken: 'b0' }, usage: { input_tokens: 10, output_tokens: 3 } }],
    1: [{ type: 'success', output: { batchToken: 'b1' }, usage: { input_tokens: 20, output_tokens: 4 } }],
  });
  const merge = trackedMerge(events);
  const finalize = trackedFinalize(events);

  const input = buildInput({
    plan, batches,
    checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
    beforeBoundary,
    executeBatch: exec.executeBatch,
    mergeBatches: merge.mergeBatches,
    finalizeEnvelope: finalize.finalizeEnvelope,
    recordProgress: event => progressEvents.push(event),
  });

  const result = await Agt002PreviewEngine.runAgt002BatchedV3Orchestration(input);

  assert.deepEqual(events, [
    { kind: 'load_checkpoint', batchIndex: 0 },
    { kind: 'boundary', boundary: 'provider_call', batchIndex: 0 },
    { kind: 'execute_batch', batchIndex: 0, attempt: 1 },
    { kind: 'boundary', boundary: 'checkpoint_write', batchIndex: 0 },
    { kind: 'store_checkpoint', batchIndex: 0 },
    { kind: 'load_checkpoint', batchIndex: 1 },
    { kind: 'boundary', boundary: 'provider_call', batchIndex: 1 },
    { kind: 'execute_batch', batchIndex: 1, attempt: 1 },
    { kind: 'boundary', boundary: 'checkpoint_write', batchIndex: 1 },
    { kind: 'store_checkpoint', batchIndex: 1 },
    { kind: 'merge_batches' },
    { kind: 'finalize_envelope' },
  ], 'exact order: per-batch [checkpoint check -> heartbeat -> provider -> heartbeat -> checkpoint write], then one merge, then one finalize');

  // stage/hash identity forwarded to the checkpoint hooks, real-shaped
  for (const call of checkpoints.loadCalls) assert.equal(call.stage, STAGE);
  for (const call of checkpoints.storeCalls) assert.equal(call.stage, STAGE);
  assert.equal(checkpoints.loadCalls[0].expectedRequestHash, plan.batches[0].request_hash);
  assert.equal(checkpoints.loadCalls[1].expectedRequestHash, plan.batches[1].request_hash);
  assert.equal(checkpoints.storeCalls[0].requestHash, plan.batches[0].request_hash);
  assert.equal(checkpoints.storeCalls[1].requestHash, plan.batches[1].request_hash);
  for (const call of checkpoints.storeCalls) {
    assert.equal(call.stageContractVersion, plan.contract_version);
    assert.match(call.outputSha256, /^[0-9a-f]{64}$/, 'outputSha256 must be a real sha256 hex digest');
    assert.ok(call.output && typeof call.output === 'object' && 'batchToken' in call.output);
  }

  // stable per-batch provider idempotency keys: forwarded identically to executeBatch and storeCheckpoint,
  // and distinct across batches
  assert.equal(exec.calls[0].providerIdempotencyKey, checkpoints.storeCalls[0].providerIdempotencyKey);
  assert.equal(exec.calls[1].providerIdempotencyKey, checkpoints.storeCalls[1].providerIdempotencyKey);
  assert.notEqual(exec.calls[0].providerIdempotencyKey, exec.calls[1].providerIdempotencyKey);
  assert.equal(typeof exec.calls[0].providerIdempotencyKey, 'string');
  assert.ok(exec.calls[0].providerIdempotencyKey.length > 0);

  // signal threaded through unchanged
  assert.equal(exec.calls[0].signal, SIGNAL_SENTINEL);
  assert.equal(exec.calls[1].signal, SIGNAL_SENTINEL);

  // merge exactly once, with the canonical per-batch outputs in order
  assert.equal(merge.calls.length, 1);
  assert.deepEqual(merge.calls[0], [{ batchToken: 'b0' }, { batchToken: 'b1' }]);

  // finalize exactly once, after merge, with aggregated usage including priorUsage and the exact
  // merged result mergeBatches returned
  assert.equal(finalize.calls.length, 1);
  assert.deepEqual(finalize.calls[0].usage, { input_tokens: 5 + 10 + 20, output_tokens: 2 + 3 + 4 });
  assert.deepEqual(finalize.calls[0].merged, { merged: true, count: 2, batchTokens: ['b0', 'b1'] });

  assert.deepEqual(result, { envelope: true, merged: { merged: true, count: 2, batchTokens: ['b0', 'b1'] }, usage: { input_tokens: 35, output_tokens: 9 } });

  assertNoRawLeak(progressEvents);
});

// ---------------------------------------------------------------------------------------------
test('resume: batch 0 checkpoint hit is revalidated and reused (no provider/store), batch 1 executes fresh, one merge/finalize, usage includes checkpoint usage', async () => {
  const events = [];
  const plan = makePlan(2);
  const batches = makeBatches(2);
  const seed = new Map([[0, {
    stage: STAGE,
    requestHash: plan.batches[0].request_hash,
    stageContractVersion: plan.contract_version,
    output: { batchToken: 'b0' },
    usage: { input_tokens: 7, output_tokens: 1 },
    providerIdempotencyKey: 'sentinel-preexisting-key-0',
  }]]);
  const checkpoints = makeCheckpointStore(events, seed);
  const beforeBoundary = boundaryTracker(events);
  const exec = scriptedExecuteBatch(events, {
    1: [{ type: 'success', output: { batchToken: 'b1' }, usage: { input_tokens: 20, output_tokens: 4 } }],
  });
  const merge = trackedMerge(events);
  const finalize = trackedFinalize(events);

  const input = buildInput({
    plan, batches,
    checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
    beforeBoundary,
    executeBatch: exec.executeBatch,
    mergeBatches: merge.mergeBatches,
    finalizeEnvelope: finalize.finalizeEnvelope,
  });

  await Agt002PreviewEngine.runAgt002BatchedV3Orchestration(input);

  assert.deepEqual(events, [
    { kind: 'load_checkpoint', batchIndex: 0 },
    { kind: 'load_checkpoint', batchIndex: 1 },
    { kind: 'boundary', boundary: 'provider_call', batchIndex: 1 },
    { kind: 'execute_batch', batchIndex: 1, attempt: 1 },
    { kind: 'boundary', boundary: 'checkpoint_write', batchIndex: 1 },
    { kind: 'store_checkpoint', batchIndex: 1 },
    { kind: 'merge_batches' },
    { kind: 'finalize_envelope' },
  ], 'batch 0 is a checkpoint hit: revalidated via loadCheckpoint, never re-sent to the provider, never re-stored');

  assert.equal(exec.calls.filter(call => call.batchIndex === 0).length, 0, 'no provider call for the checkpointed batch');
  assert.equal(checkpoints.storeCalls.filter(call => call.batchIndex === 0).length, 0, 'no re-store for the checkpointed batch');

  assert.equal(merge.calls.length, 1);
  assert.deepEqual(merge.calls[0], [{ batchToken: 'b0' }, { batchToken: 'b1' }]);

  assert.equal(finalize.calls.length, 1);
  assert.deepEqual(finalize.calls[0].usage, { input_tokens: 5 + 7 + 20, output_tokens: 2 + 1 + 4 });
});

// ---------------------------------------------------------------------------------------------
test('one-batch progress enrichment: safe structural fields only, retry count, completion timing/usage/provider id, and checkpoint-reused variant (RED)', async () => {
  const REQUEST_HASH = 'a'.repeat(64);
  assert.match(REQUEST_HASH, /^[0-9a-f]{64}$/, 'test bug: REQUEST_HASH must itself be real 64-lowercase-hex');

  const plan = makePlan(1);
  plan.batches = [{ ...plan.batches[0], request_hash: REQUEST_HASH }];
  const batches = makeBatches(1);

  const LIFECYCLE_KINDS = ['batch_checkpoint_hit', 'batch_attempt_retry', 'batch_completed'];
  const FORBIDDEN_EVENT_KEYS = ['output', 'error', 'prompt', 'response', 'source', 'providerError'];

  function assertSafeEventShape(event) {
    for (const key of FORBIDDEN_EVENT_KEYS) {
      assert.equal(key in event, false, `progress event of kind "${event.kind}" must never carry a raw "${key}" field`);
    }
  }

  // --- fresh execution: one scripted retryable timeout, then success --------------------------
  const progressEvents = [];
  const nowValues = [1000, 1010, 1017, 1024, 1031, 1038];
  let nowCursor = 0;
  const now = () => nowValues[Math.min(nowCursor++, nowValues.length - 1)];

  const checkpointsFresh = makeCheckpointStore([]);
  let freshAttempts = 0;
  const executeBatchFresh = async ({ attempt }) => {
    freshAttempts += 1;
    if (attempt === 1) {
      const error = new Error('RAW_PROVIDER_ERROR_SENTINEL: upstream boom, never forward this text');
      error.code = 'SENTINEL_RETRYABLE_TIMEOUT';
      throw error;
    }
    return {
      output: { batchToken: 'RAW_RESPONSE_SENTINEL-safe-b0' },
      usage: { input_tokens: 11, output_tokens: 7 },
      providerRequestId: 'req-safe-123',
    };
  };

  const inputFresh = buildInput({
    plan, batches,
    checkpointHooks: { loadCheckpoint: checkpointsFresh.loadCheckpoint, storeCheckpoint: checkpointsFresh.storeCheckpoint },
    beforeBoundary: async () => {},
    executeBatch: executeBatchFresh,
    mergeBatches: () => ({ merged: true }),
    finalizeEnvelope: arg => ({ envelope: true, ...arg }),
    recordProgress: event => progressEvents.push(event),
    now,
  });

  await Agt002PreviewEngine.runAgt002BatchedV3Orchestration(inputFresh);
  assert.equal(freshAttempts, 2, 'test bug: expected exactly one scripted retry before success');

  const batchLifecycleEvents = progressEvents.filter(event => LIFECYCLE_KINDS.includes(event.kind));
  assert.ok(batchLifecycleEvents.length > 0, 'expected at least one batch-lifecycle progress event');
  for (const event of batchLifecycleEvents) {
    assert.ok(LIFECYCLE_KINDS.includes(event.kind), `progress event kind "${event.kind}" must be one of the closed lifecycle kinds`);
    assert.equal(event.batchIndex, 0);
    assert.equal(event.batchCount, 1);
    assert.equal(event.requestHash, REQUEST_HASH);
    assertSafeEventShape(event);
  }

  const retryEvent = progressEvents.find(event => event.kind === 'batch_attempt_retry');
  assert.ok(retryEvent, 'expected a retry progress event for the scripted retryable timeout');
  assert.equal(retryEvent.attempt, 1, 'retry event must carry the attempt/retry count of the failed attempt');

  const completedEvent = progressEvents.find(event => event.kind === 'batch_completed');
  assert.ok(completedEvent, 'expected a completion progress event');
  assert.equal(Number.isInteger(completedEvent.durationMs), true, 'completed durationMs must be an integer');
  assert.ok(completedEvent.durationMs >= 0, 'completed durationMs must be nonnegative');
  assert.equal(completedEvent.inputTokens, 11);
  assert.equal(completedEvent.outputTokens, 7);
  assert.equal(completedEvent.providerRequestId, 'req-safe-123');
  assert.equal(completedEvent.checkpointReused, false);

  assertNoRawLeak(progressEvents);

  // --- checkpoint-reused variant: same batch/request-hash identity, pre-seeded checkpoint hit --
  const progressEventsHit = [];
  const seedHit = new Map([[0, {
    stage: STAGE,
    requestHash: REQUEST_HASH,
    stageContractVersion: plan.contract_version,
    output: { batchToken: 'RAW_RESPONSE_SENTINEL-safe-b0' },
    usage: { input_tokens: 9, output_tokens: 5 },
    providerIdempotencyKey: 'sentinel-preexisting-key-0',
  }]]);
  const checkpointsHit = makeCheckpointStore([], seedHit);
  const executeBatchMustNotRun = async () => {
    throw new Error('test bug: executeBatch must not be called on a checkpoint hit');
  };

  const inputHit = buildInput({
    plan, batches,
    checkpointHooks: { loadCheckpoint: checkpointsHit.loadCheckpoint, storeCheckpoint: checkpointsHit.storeCheckpoint },
    beforeBoundary: async () => {},
    executeBatch: executeBatchMustNotRun,
    mergeBatches: () => ({ merged: true }),
    finalizeEnvelope: arg => ({ envelope: true, ...arg }),
    recordProgress: event => progressEventsHit.push(event),
    now,
  });

  await Agt002PreviewEngine.runAgt002BatchedV3Orchestration(inputHit);

  const hitEvent = progressEventsHit.find(event => event.kind === 'batch_checkpoint_hit');
  assert.ok(hitEvent, 'expected a checkpoint-reused progress event');
  assert.equal(hitEvent.batchIndex, 0);
  assert.equal(hitEvent.batchCount, 1);
  assert.equal(hitEvent.requestHash, REQUEST_HASH);
  assert.equal(hitEvent.checkpointReused, true);
  assert.equal(hitEvent.inputTokens, 9);
  assert.equal(hitEvent.outputTokens, 5);
  assert.equal('providerRequestId' in hitEvent, false, 'a checkpoint hit never sent a provider request, so it must carry no provider request id');
  assertSafeEventShape(hitEvent);

  assertNoRawLeak(progressEventsHit);
});

// ---------------------------------------------------------------------------------------------
test('partial failure in batch 1: bounded retry on the injected retryable timeout with the same provider idempotency key, then rejects safely with zero merge/finalize and the first validated checkpoint left in place', async () => {
  const events = [];
  const progressEvents = [];
  const plan = makePlan(2);
  const batches = makeBatches(2);
  const checkpoints = makeCheckpointStore(events);
  const beforeBoundary = boundaryTracker(events);
  const exec = scriptedExecuteBatch(events, {
    0: [{ type: 'success', output: { batchToken: 'b0' }, usage: { input_tokens: 10, output_tokens: 3 } }],
    1: [{ type: 'timeout' }, { type: 'timeout' }, { type: 'timeout' }],
  });
  const merge = trackedMerge(events);
  const finalize = trackedFinalize(events);

  const input = buildInput({
    plan, batches, maxBatchAttempts: 3,
    checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
    beforeBoundary,
    executeBatch: exec.executeBatch,
    mergeBatches: merge.mergeBatches,
    finalizeEnvelope: finalize.finalizeEnvelope,
    recordProgress: event => progressEvents.push(event),
  });

  let caughtError = null;
  try {
    await invoke(input);
    assert.fail('expected the orchestration to reject once batch 1 exhausts its retry budget');
  } catch (error) {
    caughtError = error;
  }

  assert.deepEqual(events, [
    { kind: 'load_checkpoint', batchIndex: 0 },
    { kind: 'boundary', boundary: 'provider_call', batchIndex: 0 },
    { kind: 'execute_batch', batchIndex: 0, attempt: 1 },
    { kind: 'boundary', boundary: 'checkpoint_write', batchIndex: 0 },
    { kind: 'store_checkpoint', batchIndex: 0 },
    { kind: 'load_checkpoint', batchIndex: 1 },
    { kind: 'boundary', boundary: 'provider_call', batchIndex: 1 },
    { kind: 'execute_batch', batchIndex: 1, attempt: 1 },
    { kind: 'boundary', boundary: 'provider_call', batchIndex: 1 },
    { kind: 'execute_batch', batchIndex: 1, attempt: 2 },
    { kind: 'boundary', boundary: 'provider_call', batchIndex: 1 },
    { kind: 'execute_batch', batchIndex: 1, attempt: 3 },
  ], 'bounded to exactly maxBatchAttempts total provider attempts for batch 1, heartbeat re-awaited before every attempt, no checkpoint write ever attempted for batch 1');

  const batch1Calls = exec.calls.filter(call => call.batchIndex === 1);
  assert.equal(batch1Calls.length, 3);
  assert.equal(batch1Calls[0].providerIdempotencyKey, batch1Calls[1].providerIdempotencyKey);
  assert.equal(batch1Calls[1].providerIdempotencyKey, batch1Calls[2].providerIdempotencyKey);

  assert.equal(merge.calls.length, 0);
  assert.equal(finalize.calls.length, 0);

  // first validated checkpoint remains, untouched, not rolled back
  assert.equal(checkpoints.storeCalls.length, 1);
  assert.equal(checkpoints.storeCalls[0].batchIndex, 0);
  assert.ok(checkpoints.store.has(0));

  const errorStringProps = Object.entries(caughtError || {}).filter(([, value]) => typeof value === 'string');
  assertNoRawLeak(progressEvents, caughtError?.message, errorStringProps);
});

// ---------------------------------------------------------------------------------------------
test('heartbeat/lease failure immediately before the provider call prevents that call, the checkpoint write, and finalize', async () => {
  const events = [];
  const plan = makePlan(2);
  const batches = makeBatches(2);
  const checkpoints = makeCheckpointStore(events);
  const beforeBoundary = boundaryTracker(events, { failWhen: boundary => boundary === 'provider_call' });
  const exec = scriptedExecuteBatch(events, {
    0: [{ type: 'success', output: { batchToken: 'b0' }, usage: { input_tokens: 10, output_tokens: 3 } }],
    1: [{ type: 'success', output: { batchToken: 'b1' }, usage: { input_tokens: 20, output_tokens: 4 } }],
  });
  const merge = trackedMerge(events);
  const finalize = trackedFinalize(events);

  const input = buildInput({
    plan, batches,
    checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
    beforeBoundary,
    executeBatch: exec.executeBatch,
    mergeBatches: merge.mergeBatches,
    finalizeEnvelope: finalize.finalizeEnvelope,
  });

  await assert.rejects(() => invoke(input));

  assert.deepEqual(events, [
    { kind: 'load_checkpoint', batchIndex: 0 },
    { kind: 'boundary', boundary: 'provider_call', batchIndex: 0 },
  ]);
  assert.equal(exec.calls.length, 0, 'the provider call must never happen once its own heartbeat rejected');
  assert.equal(checkpoints.storeCalls.length, 0);
  assert.equal(merge.calls.length, 0);
  assert.equal(finalize.calls.length, 0);
});

test('heartbeat/lease failure immediately before the checkpoint write prevents that write and finalize', async () => {
  const events = [];
  const plan = makePlan(2);
  const batches = makeBatches(2);
  const checkpoints = makeCheckpointStore(events);
  const beforeBoundary = boundaryTracker(events, { failWhen: boundary => boundary === 'checkpoint_write' });
  const exec = scriptedExecuteBatch(events, {
    0: [{ type: 'success', output: { batchToken: 'b0' }, usage: { input_tokens: 10, output_tokens: 3 } }],
    1: [{ type: 'success', output: { batchToken: 'b1' }, usage: { input_tokens: 20, output_tokens: 4 } }],
  });
  const merge = trackedMerge(events);
  const finalize = trackedFinalize(events);

  const input = buildInput({
    plan, batches,
    checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
    beforeBoundary,
    executeBatch: exec.executeBatch,
    mergeBatches: merge.mergeBatches,
    finalizeEnvelope: finalize.finalizeEnvelope,
  });

  await assert.rejects(() => invoke(input));

  assert.deepEqual(events, [
    { kind: 'load_checkpoint', batchIndex: 0 },
    { kind: 'boundary', boundary: 'provider_call', batchIndex: 0 },
    { kind: 'execute_batch', batchIndex: 0, attempt: 1 },
    { kind: 'boundary', boundary: 'checkpoint_write', batchIndex: 0 },
  ]);
  assert.equal(exec.calls.length, 1, 'the provider call for batch 0 already happened before its checkpoint-write heartbeat rejected');
  assert.equal(checkpoints.storeCalls.length, 0, 'the checkpoint write must never happen once its own heartbeat rejected');
  assert.equal(merge.calls.length, 0);
  assert.equal(finalize.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
test('malformed/incoherent plan/batches/request-hash/index/count are rejected before any checkpoint or provider interaction', async () => {
  const basePlan = makePlan(2);
  const baseBatches = makeBatches(2);

  const cases = [
    {
      name: 'plan.batch_count does not match batches.length',
      mutate: () => ({ plan: { ...basePlan, batch_count: 2 }, batches: makeBatches(3) }),
    },
    {
      name: 'plan.batches.length does not match plan.batch_count',
      mutate: () => ({ plan: { ...basePlan, batch_count: 2, batches: makePlan(3).batches }, batches: baseBatches }),
    },
    {
      name: 'plan.batches[*].batch_index out of contiguous order',
      mutate: () => ({
        plan: { ...basePlan, batches: [{ ...basePlan.batches[0], batch_index: 0 }, { ...basePlan.batches[1], batch_index: 2 }] },
        batches: baseBatches,
      }),
    },
    {
      name: 'batches[*].batch_index disagrees with plan.batches[*].batch_index at the same position',
      mutate: () => ({ plan: basePlan, batches: [{ ...baseBatches[1], batch_index: 0 }, { ...baseBatches[0], batch_index: 1 }] }),
    },
    {
      name: 'plan.batches[0].request_hash is not a nonempty string',
      mutate: () => ({
        plan: { ...basePlan, batches: [{ ...basePlan.batches[0], request_hash: '' }, basePlan.batches[1]] },
        batches: baseBatches,
      }),
    },
    {
      name: 'batches[0].batch_count disagrees with plan.batch_count',
      mutate: () => ({ plan: basePlan, batches: [{ ...baseBatches[0], batch_count: 3 }, baseBatches[1]] }),
    },
    {
      name: 'plan.batches[1].batch_index is out of range for batch_count',
      mutate: () => ({
        plan: { ...basePlan, batches: [basePlan.batches[0], { ...basePlan.batches[1], batch_index: 5 }] },
        batches: baseBatches,
      }),
    },
  ];

  for (const testCase of cases) {
    const events = [];
    const checkpoints = makeCheckpointStore(events);
    const beforeBoundary = boundaryTracker(events);
    const exec = scriptedExecuteBatch(events, {});
    const merge = trackedMerge(events);
    const finalize = trackedFinalize(events);
    const { plan, batches } = testCase.mutate();

    const input = buildInput({
      plan, batches,
      checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
      beforeBoundary,
      executeBatch: exec.executeBatch,
      mergeBatches: merge.mergeBatches,
      finalizeEnvelope: finalize.finalizeEnvelope,
    });

    let rejected = false;
    try { await invoke(input); } catch { rejected = true; }
    assert.ok(rejected, `case "${testCase.name}" must reject`);
    assert.equal(checkpoints.loadCalls.length, 0, `case "${testCase.name}" must never reach a checkpoint load`);
    assert.equal(exec.calls.length, 0, `case "${testCase.name}" must never reach a provider call`);
    assert.equal(checkpoints.storeCalls.length, 0, `case "${testCase.name}" must never reach a checkpoint store`);
    assert.equal(merge.calls.length, 0, `case "${testCase.name}" must never reach merge`);
    assert.equal(finalize.calls.length, 0, `case "${testCase.name}" must never reach finalize`);
  }
});

// ---------------------------------------------------------------------------------------------
// Task 6C1, TDD RED: fail-closed attribution. Today `runAgt002BatchedV3Orchestration` collapses
// every failure into one of its own generic AGT002_BATCHED_V3_* codes with no `.stage` at all
// (see agt002BatchedV3Error/crossBoundary in agt002-preview-engine.js) — so every assertion below
// on `.code`/`.stage` is an ordinary metadata mismatch against real, tiny sentinel doubles already
// declared above, never a new fixture and never real V3 content. In every case the raw upstream
// sentinel text must never reach the caller (checked via the file's own assertNoRawLeak/
// RAW_LEAK_SENTINELS), and downstream merge/finalize must never run once the failure already
// happened before them.
// ---------------------------------------------------------------------------------------------

test('fail-closed attribution: beforeBoundary lease-loss preserves AGT002_REANALYSIS_LEASE_LOST, tags stage lease_renewal, exposes only a fixed safe message (RED)', async () => {
  const plan = makePlan(1);
  const batches = makeBatches(1);
  const checkpoints = makeCheckpointStore([]);
  const exec = scriptedExecuteBatch([], {});
  const merge = trackedMerge([]);
  const finalize = trackedFinalize([]);

  const beforeBoundary = async () => {
    const error = new Error('RAW_SOURCE_SENTINEL: lease already gone, never forward this text');
    error.code = 'AGT002_REANALYSIS_LEASE_LOST';
    throw error;
  };

  const input = buildInput({
    plan, batches,
    checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
    beforeBoundary,
    executeBatch: exec.executeBatch,
    mergeBatches: merge.mergeBatches,
    finalizeEnvelope: finalize.finalizeEnvelope,
  });

  let caughtError = null;
  try {
    await invoke(input);
    assert.fail('expected the orchestration to reject once the lease heartbeat rejects');
  } catch (error) {
    caughtError = error;
  }

  assert.equal(caughtError.code, 'AGT002_REANALYSIS_LEASE_LOST', 'the exact lease-lost code must be preserved, never replaced');
  assert.equal(caughtError.stage, 'lease_renewal');
  assert.notEqual(caughtError.message, 'RAW_SOURCE_SENTINEL: lease already gone, never forward this text');
  const errorStringProps = Object.entries(caughtError).filter(([, value]) => typeof value === 'string');
  assertNoRawLeak(caughtError.message, errorStringProps);

  assert.equal(exec.calls.length, 0, 'the provider call must never happen once its own heartbeat rejected');
  assert.equal(merge.calls.length, 0);
  assert.equal(finalize.calls.length, 0);
});

test('fail-closed attribution: executeBatch exhausts retryable AGT002_CODEX_TIMEOUT, preserves the exact code, tags stage transport, exposes only a fixed safe message (RED)', async () => {
  const plan = makePlan(1);
  const batches = makeBatches(1);
  const checkpoints = makeCheckpointStore([]);
  const merge = trackedMerge([]);
  const finalize = trackedFinalize([]);
  const maxBatchAttempts = 3;
  let attempts = 0;
  const executeBatch = async () => {
    attempts += 1;
    const error = new Error('RAW_PROVIDER_ERROR_SENTINEL: upstream boom, never forward this text');
    error.code = 'AGT002_CODEX_TIMEOUT';
    throw error;
  };

  const input = buildInput({
    plan, batches, maxBatchAttempts,
    checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
    beforeBoundary: async () => {},
    executeBatch,
    mergeBatches: merge.mergeBatches,
    finalizeEnvelope: finalize.finalizeEnvelope,
    isRetryableError: error => error?.code === 'AGT002_CODEX_TIMEOUT',
  });

  let caughtError = null;
  try {
    await invoke(input);
    assert.fail('expected the orchestration to reject once the retry budget is exhausted');
  } catch (error) {
    caughtError = error;
  }

  assert.equal(attempts, maxBatchAttempts, 'test bug: expected exactly maxBatchAttempts scripted executeBatch calls');
  assert.equal(caughtError.code, 'AGT002_CODEX_TIMEOUT', 'the exact retryable transport code must be preserved, never replaced');
  assert.equal(caughtError.stage, 'transport');
  const errorStringProps = Object.entries(caughtError).filter(([, value]) => typeof value === 'string');
  assertNoRawLeak(caughtError.message, errorStringProps);

  assert.equal(checkpoints.storeCalls.length, 0, 'no checkpoint write for a batch that never produced a fresh result');
  assert.equal(merge.calls.length, 0);
  assert.equal(finalize.calls.length, 0);
});

test('fail-closed attribution: executeBatch nonretryable semantic_validation rejection maps to a closed invalid-output code, tags stage semantic_validation, exposes only a fixed safe message (RED)', async () => {
  const plan = makePlan(1);
  const batches = makeBatches(1);
  const checkpoints = makeCheckpointStore([]);
  const merge = trackedMerge([]);
  const finalize = trackedFinalize([]);

  const executeBatch = async () => {
    const error = new Error('RAW_RESPONSE_SENTINEL: model output rejected, never forward this text');
    error.code = 'SENTINEL_MODEL_OUTPUT_INVALID';
    error.stage = 'semantic_validation';
    throw error;
  };

  const input = buildInput({
    plan, batches,
    checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
    beforeBoundary: async () => {},
    executeBatch,
    mergeBatches: merge.mergeBatches,
    finalizeEnvelope: finalize.finalizeEnvelope,
    // default isRetryableError only recognizes 'SENTINEL_RETRYABLE_TIMEOUT', so this rejects on
    // the very first attempt — never retried.
  });

  let caughtError = null;
  try {
    await invoke(input);
    assert.fail('expected the orchestration to reject on the first nonretryable attempt');
  } catch (error) {
    caughtError = error;
  }

  assert.equal(caughtError.stage, 'semantic_validation');
  assert.match(caughtError.code, /VALIDATION|INVALID/i, 'must be a closed invalid-output code');
  const errorStringProps = Object.entries(caughtError).filter(([, value]) => typeof value === 'string');
  assertNoRawLeak(caughtError.message, errorStringProps);

  assert.equal(checkpoints.storeCalls.length, 0);
  assert.equal(merge.calls.length, 0);
  assert.equal(finalize.calls.length, 0);
});

test('fail-closed attribution: a checkpoint load or store failure maps to a closed checkpoint/persistence code, tags stage persistence, exposes only a fixed safe message (RED)', async () => {
  const cases = [
    {
      name: 'loadCheckpoint throws',
      checkpointHooks: {
        loadCheckpoint: async () => {
          const error = new Error('RAW_SOURCE_SENTINEL: checkpoint store unreachable, never forward this text');
          error.code = 'SENTINEL_DB_ERROR';
          throw error;
        },
        storeCheckpoint: async () => {
          throw new Error('test bug: storeCheckpoint must not be reached when loadCheckpoint already rejected');
        },
      },
      scriptByBatchIndex: {},
    },
    {
      name: 'storeCheckpoint throws',
      checkpointHooks: {
        loadCheckpoint: async () => ({ hit: false }),
        storeCheckpoint: async () => {
          const error = new Error('RAW_SOURCE_SENTINEL: checkpoint write rejected, never forward this text');
          error.code = 'SENTINEL_DB_ERROR';
          throw error;
        },
      },
      scriptByBatchIndex: { 0: [{ type: 'success', output: { batchToken: 'b0' }, usage: { input_tokens: 1, output_tokens: 1 } }] },
    },
  ];

  for (const testCase of cases) {
    const plan = makePlan(1);
    const batches = makeBatches(1);
    const merge = trackedMerge([]);
    const finalize = trackedFinalize([]);
    const exec = scriptedExecuteBatch([], testCase.scriptByBatchIndex);

    const input = buildInput({
      plan, batches,
      checkpointHooks: testCase.checkpointHooks,
      beforeBoundary: async () => {},
      executeBatch: exec.executeBatch,
      mergeBatches: merge.mergeBatches,
      finalizeEnvelope: finalize.finalizeEnvelope,
    });

    let caughtError = null;
    try {
      await invoke(input);
      assert.fail(`case "${testCase.name}" expected the orchestration to reject`);
    } catch (error) {
      caughtError = error;
    }

    assert.equal(caughtError.stage, 'persistence', `case "${testCase.name}" must tag stage persistence`);
    assert.match(caughtError.code, /CHECKPOINT|PERSIST/i, `case "${testCase.name}" must be a closed checkpoint/persistence code`);
    const errorStringProps = Object.entries(caughtError).filter(([, value]) => typeof value === 'string');
    assertNoRawLeak(caughtError.message, errorStringProps);

    assert.equal(merge.calls.length, 0, `case "${testCase.name}" must never reach merge`);
    assert.equal(finalize.calls.length, 0, `case "${testCase.name}" must never reach finalize`);
  }
});

test('fail-closed attribution: a mergeBatches or finalizeEnvelope failure maps to a closed code, tags stage envelope, exposes only a fixed safe message, with zero calls past the failure point (RED)', async () => {
  const cases = [
    {
      name: 'mergeBatches throws',
      buildDeps: () => {
        const finalize = trackedFinalize([]);
        return {
          mergeBatches: () => { throw new Error('RAW_RESPONSE_SENTINEL: merge exploded, never forward this text'); },
          finalizeEnvelope: finalize.finalizeEnvelope,
          finalize,
        };
      },
      assertPostFailure: ({ finalize }) => {
        assert.equal(finalize.calls.length, 0, 'finalize must never run once merge already rejected');
      },
    },
    {
      name: 'finalizeEnvelope throws',
      buildDeps: () => {
        const merge = trackedMerge([]);
        return {
          mergeBatches: merge.mergeBatches,
          finalizeEnvelope: () => { throw new Error('RAW_RESPONSE_SENTINEL: finalize exploded, never forward this text'); },
          merge,
        };
      },
      assertPostFailure: ({ merge }) => {
        assert.equal(merge.calls.length, 1, 'merge already ran exactly once before finalize rejected');
      },
    },
  ];

  for (const testCase of cases) {
    const plan = makePlan(1);
    const batches = makeBatches(1);
    const checkpoints = makeCheckpointStore([]);
    const exec = scriptedExecuteBatch([], {
      0: [{ type: 'success', output: { batchToken: 'b0' }, usage: { input_tokens: 1, output_tokens: 1 } }],
    });
    const deps = testCase.buildDeps();

    const input = buildInput({
      plan, batches,
      checkpointHooks: { loadCheckpoint: checkpoints.loadCheckpoint, storeCheckpoint: checkpoints.storeCheckpoint },
      beforeBoundary: async () => {},
      executeBatch: exec.executeBatch,
      mergeBatches: deps.mergeBatches,
      finalizeEnvelope: deps.finalizeEnvelope,
    });

    let caughtError = null;
    try {
      await invoke(input);
      assert.fail(`case "${testCase.name}" expected the orchestration to reject`);
    } catch (error) {
      caughtError = error;
    }

    assert.equal(caughtError.stage, 'envelope', `case "${testCase.name}" must tag stage envelope`);
    assert.equal(typeof caughtError.code, 'string', `case "${testCase.name}" must carry a closed string code`);
    const errorStringProps = Object.entries(caughtError).filter(([, value]) => typeof value === 'string');
    assertNoRawLeak(caughtError.message, errorStringProps);

    testCase.assertPostFailure(deps);
  }
});
