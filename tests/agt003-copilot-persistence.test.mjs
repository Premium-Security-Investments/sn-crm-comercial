import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as agt003Persistence from '../agt003-copilot-persistence.js';
import {
  claimAgt003CopilotRun,
  computeAgt003CopilotHash,
  computeAgt003CopilotIdempotencyKey,
  findAgt003CopilotRunById,
  findAgt003CopilotRunByKey,
  recordAgt003CopilotFeedback,
  recordAgt003CopilotFailure,
  recordAgt003CopilotRun,
  releaseAgt003CopilotClaim,
} from '../agt003-copilot-persistence.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const request = JSON.parse(readFileSync(path.join(root, 'contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-request.json'), 'utf8'));
const response = JSON.parse(readFileSync(path.join(root, 'contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-copilot-response.json'), 'utf8'));
const ids = {
  opportunity: '22222222-2222-4222-8222-222222222222',
  actor: '11111111-1111-4111-8111-111111111111',
  run: '33333333-3333-4333-8333-333333333333',
  claim: '44444444-4444-4444-8444-444444444444',
};

assert.match(computeAgt003CopilotHash(request), /^[a-f0-9]{64}$/);
assert.equal(computeAgt003CopilotHash(request), computeAgt003CopilotHash(structuredClone(request)));
const key = computeAgt003CopilotIdempotencyKey({ snapshotId: request.snapshot_id, policyVersion: response.policy_version, model: response.model });
assert.match(key, /^[a-f0-9]{64}$/);
assert.equal(key, computeAgt003CopilotIdempotencyKey({ snapshotId: request.snapshot_id, policyVersion: response.policy_version, model: response.model }));
assert.notEqual(key, computeAgt003CopilotIdempotencyKey({ snapshotId: `${request.snapshot_id}-other`, policyVersion: response.policy_version, model: response.model }));
assert.equal(typeof agt003Persistence.computeAgt003CopilotRetryKey, 'function', 'persistencia debe exponer la derivación cerrada de retry');
const retryKey = agt003Persistence.computeAgt003CopilotRetryKey({ previousKey: key, failedRunId: ids.run });
assert.match(retryKey, /^[a-f0-9]{64}$/);
assert.notEqual(retryKey, key);
assert.equal(retryKey, agt003Persistence.computeAgt003CopilotRetryKey({ previousKey: key, failedRunId: ids.run }), 'la cadena de retry es determinística');
assert.notEqual(retryKey, agt003Persistence.computeAgt003CopilotRetryKey({ previousKey: key, failedRunId: '55555555-5555-4555-8555-555555555555' }));

function rpcDatabase(handler) {
  return { rpc: async (name, args) => handler(name, args) };
}

for (const status of ['existing', 'in_progress', 'quota', 'saturated']) {
  const claim = await claimAgt003CopilotRun(rpcDatabase(async (name, args) => {
    assert.equal(name, 'psi_claim_agt003_copilot_run');
    assert.deepEqual(args, { p_idempotency_key: key, p_daily_max_runs: 20, p_max_concurrent: 2, p_lease_seconds: 45 });
    return { data: { status }, error: null };
  }), { idempotencyKey: key, dailyMaxRuns: 20, maxConcurrent: 2, leaseSeconds: 45 });
  assert.deepEqual(claim, { status });
}
const claimed = await claimAgt003CopilotRun(rpcDatabase(async () => ({ data: { status: 'claimed', claim_id: ids.claim }, error: null })), { idempotencyKey: key, dailyMaxRuns: 20, maxConcurrent: 2, leaseSeconds: 45 });
assert.deepEqual(claimed, { status: 'claimed', claim_id: ids.claim });
await assert.rejects(() => claimAgt003CopilotRun(rpcDatabase(async () => ({ data: { status: 'claimed' }, error: null })), { idempotencyKey: key, dailyMaxRuns: 20, maxConcurrent: 2, leaseSeconds: 45 }), /identificador/i);

const persistedRun = { id: ids.run, opportunity_id: ids.opportunity, idempotency_key: key, status: 'completed', output: response, failure_code: null, created_at: '2030-02-01T10:02:00.000Z', completed_at: '2030-02-01T10:02:00.000Z' };
assert.deepEqual(await findAgt003CopilotRunByKey(rpcDatabase(async (name, args) => {
  assert.equal(name, 'psi_get_agt003_copilot_run_by_key');
  assert.deepEqual(args, { p_idempotency_key: key });
  return { data: persistedRun, error: null };
}), key), { ...persistedRun, run_id: ids.run });
assert.deepEqual(await findAgt003CopilotRunById(rpcDatabase(async (name, args) => {
  assert.equal(name, 'psi_get_agt003_copilot_run_by_id');
  assert.deepEqual(args, { p_run_id: ids.run });
  return { data: persistedRun, error: null };
}), ids.run), { ...persistedRun, run_id: ids.run });
assert.equal(await findAgt003CopilotRunByKey(rpcDatabase(async () => ({ data: null, error: null })), key), null);

assert.equal(await releaseAgt003CopilotClaim(rpcDatabase(async (name, args) => {
  assert.equal(name, 'psi_release_agt003_copilot_claim');
  assert.deepEqual(args, { p_idempotency_key: key, p_claim_id: ids.claim });
  return { data: true, error: null };
}), { idempotencyKey: key, claimId: ids.claim }), true);

const usage = { provider: 'agent_bridge', model: response.model, input_tokens: 10, output_tokens: 20, rate_limit: null };
let recordArgs;
const recorded = await recordAgt003CopilotRun(rpcDatabase(async (name, args) => {
  assert.equal(name, 'psi_record_agt003_copilot_run');
  recordArgs = args;
  return { data: { id: ids.run, idempotency_key: key, status: 'completed', output: response, created_at: '2030-02-01T10:02:00.000Z', completed_at: '2030-02-01T10:02:00.000Z' }, error: null };
}), { opportunityId: ids.opportunity, actorId: ids.actor, claimId: ids.claim, request, response, usage });
assert.equal(recorded.run_id, ids.run);
assert.equal(recorded.status, 'completed');
assert.equal(recordArgs.p_idempotency_key, key);
assert.equal(recordArgs.p_claim_id, ids.claim);
assert.equal(recordArgs.p_opportunity_id, ids.opportunity);
assert.equal(recordArgs.p_actor_id, ids.actor);
assert.equal(recordArgs.p_snapshot_id, request.snapshot_id);
assert.equal(recordArgs.p_contract_version, request.contract_version);
assert.equal(recordArgs.p_capability_id, request.capability_id);
assert.equal(recordArgs.p_policy_version, response.policy_version);
assert.equal(recordArgs.p_model, response.model);
assert.deepEqual(recordArgs.p_output, response);
assert.deepEqual(recordArgs.p_usage, usage);
assert.match(recordArgs.p_input_hash, /^[a-f0-9]{64}$/);
assert.match(recordArgs.p_output_hash, /^[a-f0-9]{64}$/);

let retryRecordArgs;
await recordAgt003CopilotRun(rpcDatabase(async (_name, args) => {
  retryRecordArgs = args;
  return { data: { id: ids.run, idempotency_key: retryKey, status: 'completed', output: response }, error: null };
}), { opportunityId: ids.opportunity, actorId: ids.actor, claimId: ids.claim, idempotencyKey: retryKey, request, response, usage });
assert.equal(retryRecordArgs.p_idempotency_key, retryKey, 'un retry se persiste con la clave realmente reclamada');

await assert.rejects(() => recordAgt003CopilotRun(rpcDatabase(async () => ({ data: {}, error: null })), { opportunityId: ids.opportunity, actorId: ids.actor, claimId: ids.claim, request, response: { ...response, snapshot_id: 'wrong' }, usage }), /respuesta|snapshot/i);
await assert.rejects(() => recordAgt003CopilotRun(rpcDatabase(async () => ({ data: {}, error: null })), { opportunityId: ids.opportunity, actorId: ids.actor, claimId: ids.claim, request, response, usage: { ...usage, input_tokens: -1 } }), /usage|tokens/i);

const failed = await recordAgt003CopilotFailure(rpcDatabase(async (name, args) => {
  assert.equal(name, 'psi_record_agt003_copilot_failure');
  assert.equal(args.p_claim_id, ids.claim);
  assert.equal(args.p_failure_code, 'PROVIDER_UNAVAILABLE');
  assert.equal(args.p_output, undefined);
  return { data: { id: ids.run, status: 'failed', failure_code: args.p_failure_code }, error: null };
}), {
  opportunityId: ids.opportunity,
  actorId: ids.actor,
  claimId: ids.claim,
  request,
  policyVersion: response.policy_version,
  model: response.model,
  usage: { ...usage, input_tokens: 0, output_tokens: 0 },
  failureCode: 'PROVIDER_UNAVAILABLE',
});
assert.equal(failed.status, 'failed');
assert.equal(failed.failure_code, 'PROVIDER_UNAVAILABLE');
let retryFailureArgs;
await recordAgt003CopilotFailure(rpcDatabase(async (_name, args) => {
  retryFailureArgs = args;
  return { data: { id: ids.run, status: 'failed', failure_code: args.p_failure_code }, error: null };
}), {
  opportunityId: ids.opportunity, actorId: ids.actor, claimId: ids.claim, idempotencyKey: retryKey, request,
  policyVersion: response.policy_version, model: response.model, usage, failureCode: 'AGT003_CLAUDE_SESSION_LIMIT',
});
assert.equal(retryFailureArgs.p_idempotency_key, retryKey);
assert.equal(retryFailureArgs.p_failure_code, 'AGT003_CLAUDE_SESSION_LIMIT');
await assert.rejects(() => recordAgt003CopilotFailure(rpcDatabase(async () => ({ data: {}, error: null })), {
  opportunityId: ids.opportunity, actorId: ids.actor, claimId: ids.claim, request,
  policyVersion: response.policy_version, model: response.model, usage, failureCode: 'private detail',
}), /failure|código/i);

const feedback = await recordAgt003CopilotFeedback(rpcDatabase(async (name, args) => {
  assert.equal(name, 'psi_record_agt003_copilot_feedback');
  assert.deepEqual(args, { p_run_id: ids.run, p_opportunity_id: ids.opportunity, p_actor_id: ids.actor, p_rating: 'needs_change', p_comment: 'Ajustar el tono.' });
  return { data: { id: '55555555-5555-4555-8555-555555555555', ...args }, error: null };
}), { runId: ids.run, opportunityId: ids.opportunity, actorId: ids.actor, rating: 'needs_change', comment: 'Ajustar el tono.' });
assert.equal(feedback.rating, 'needs_change');
await assert.rejects(() => recordAgt003CopilotFeedback(rpcDatabase(async () => ({ data: {}, error: null })), { runId: ids.run, opportunityId: ids.opportunity, actorId: ids.actor, rating: 'send', comment: null }), /feedback|rating/i);

console.log('AGT-003 copilot persistence adapter passed');
