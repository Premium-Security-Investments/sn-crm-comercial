import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AGT003_PREFLIGHT_POLICY, createAgt003PreflightEngine } from '../agt003-preflight-engine.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const request = JSON.parse(readFileSync(path.join(root, 'contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-preflight-request.json'), 'utf8'));
const response = JSON.parse(readFileSync(path.join(root, 'contracts/agents/AGT-003/v2-draft/fixtures/valid-opportunity-preflight-response.json'), 'utf8'));
const payload = { actions: response.actions };

function fakeClient(content = JSON.stringify(payload), usage = { input_tokens: 10, output_tokens: 20 }) {
  return {
    calls: [],
    async run(input) {
      this.calls.push(input);
      return { content, usage, rate_limit: null };
    },
  };
}

assert.match(AGT003_PREFLIGHT_POLICY, /texto.*CRM.*no confiable/i);
assert.match(AGT003_PREFLIGHT_POLICY, /no uses herramientas/i);
assert.match(AGT003_PREFLIGHT_POLICY, /no envíes/i);
assert.match(AGT003_PREFLIGHT_POLICY, /no (redactes|escribas).*correo/i);
assert.match(AGT003_PREFLIGHT_POLICY, /evidence_id/i);

const client = fakeClient();
const engine = createAgt003PreflightEngine({
  client,
  model: response.model,
  policyVersion: response.policy_version,
  now: () => response.generated_at,
});
const generated = await engine.preflight(request);
assert.deepEqual(generated.response, response);
assert.deepEqual(generated.usage, {
  provider: 'agent_bridge',
  model: response.model,
  input_tokens: 10,
  output_tokens: 20,
  rate_limit: null,
});
assert.equal(client.calls.length, 1);
assert.equal(client.calls[0].input, request);
assert.equal(client.calls[0].outputSchema.additionalProperties, false);
assert.deepEqual(client.calls[0].outputSchema.required, ['actions']);
assert.equal(client.calls[0].outputSchema.properties.actions.items.additionalProperties, false);
assert.deepEqual(
  client.calls[0].outputSchema.properties.actions.items.properties.evidence_refs.items.enum.sort(),
  ['evidence:interaction:001', 'evidence:opportunity:service', 'evidence:opportunity:stage'],
);
assert.deepEqual(
  client.calls[0].outputSchema.properties.actions.items.properties.issue_code.enum,
  ['next_action', 'close_date', 'decision_maker', 'stalled_conversation', 'pending_terms', 'escalation_needed', 'other'],
);

for (const [content, usage, pattern] of [
  ['not-json', { input_tokens: 1, output_tokens: 1 }, /válida/i],
  [JSON.stringify({ actions: [{ ...response.actions[0], send_now: true }] }), { input_tokens: 1, output_tokens: 1 }, /válida/i],
  [JSON.stringify({ actions: [{ ...response.actions[0], issue_code: 'free_text_issue' }] }), { input_tokens: 1, output_tokens: 1 }, /válida/i],
  [JSON.stringify({ actions: [{ ...response.actions[0], evidence_refs: ['evidence:invented'] }] }), { input_tokens: 1, output_tokens: 1 }, /válida/i],
  [JSON.stringify(payload), { input_tokens: -1, output_tokens: 1 }, /válida/i],
]) {
  const invalidEngine = createAgt003PreflightEngine({ client: fakeClient(content, usage), model: 'm', policyVersion: 'p' });
  await assert.rejects(() => invalidEngine.preflight(request), pattern);
}

const collapseClient = fakeClient();
let releaseCollapse;
collapseClient.run = function run(input) {
  this.calls.push(input);
  return new Promise(resolve => {
    releaseCollapse = () => resolve({ content: JSON.stringify(payload), usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null });
  });
};
const collapseEngine = createAgt003PreflightEngine({
  client: collapseClient,
  model: 'm',
  policyVersion: 'p',
  now: () => response.generated_at,
});
const first = collapseEngine.preflight(request);
const second = collapseEngine.preflight(request);
await new Promise(resolve => setImmediate(resolve));
assert.equal(collapseClient.calls.length, 1, 'same snapshot/policy/model collapses in flight');
releaseCollapse();
assert.deepEqual(await first, await second);

const concurrencyClient = fakeClient();
let releaseConcurrency;
concurrencyClient.run = function run(input) {
  this.calls.push(input);
  return new Promise(resolve => {
    releaseConcurrency = () => resolve({ content: JSON.stringify(payload), usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null });
  });
};
const concurrencyEngine = createAgt003PreflightEngine({
  client: concurrencyClient,
  model: 'm',
  policyVersion: 'p',
  maxConcurrent: 1,
  now: () => response.generated_at,
});
const occupying = concurrencyEngine.preflight(request, { idempotencyKey: 'first' });
await new Promise(resolve => setImmediate(resolve));
await assert.rejects(
  () => concurrencyEngine.preflight(request, { idempotencyKey: 'second' }),
  error => error.code === 'AGT003_PREFLIGHT_CONCURRENCY' && /saturad/i.test(error.message),
);
releaseConcurrency();
await occupying;

let currentTime = '2030-02-01T10:01:00.000Z';
const quotaClient = fakeClient();
const quotaEngine = createAgt003PreflightEngine({
  client: quotaClient,
  model: 'm',
  policyVersion: 'p',
  dailyMaxRuns: 1,
  now: () => currentTime,
});
await quotaEngine.preflight(request, { idempotencyKey: 'day-one-first' });
await assert.rejects(
  () => quotaEngine.preflight(request, { idempotencyKey: 'day-one-second' }),
  error => error.code === 'AGT003_PREFLIGHT_QUOTA' && /cuota/i.test(error.message),
);
assert.equal(quotaClient.calls.length, 1, 'quota rejects before another provider turn');
currentTime = '2030-02-02T00:00:00.000Z';
await quotaEngine.preflight(request, { idempotencyKey: 'day-two-first' });
assert.equal(quotaClient.calls.length, 2, 'UTC day change resets the in-process quota');

for (const [providerCode, expectedCode] of [
  ['AGT003_CLAUDE_SESSION_LIMIT', 'AGT003_CLAUDE_SESSION_LIMIT'],
  ['AGT003_CLAUDE_LOGIN_REQUIRED', 'AGT003_CLAUDE_LOGIN_REQUIRED'],
  ['AGT003_BRIDGE_BUSY', 'AGT003_BRIDGE_BUSY'],
  ['AGT003_BRIDGE_AUTH_INVALID', 'AGT003_BRIDGE_AUTH_INVALID'],
  ['AGT003_BRIDGE_BAD_REQUEST', undefined],
  ['PRIVATE_PROVIDER_DETAIL', undefined],
]) {
  const failingClient = { async run() { const error = new Error('detalle privado'); error.code = providerCode; throw error; } };
  const failingEngine = createAgt003PreflightEngine({ client: failingClient, model: 'm', policyVersion: 'p' });
  await assert.rejects(() => failingEngine.preflight(request), error => {
    assert.equal(error.message, 'Vig-IA no está disponible en este momento.');
    assert.equal(error.code, expectedCode);
    assert.equal(error.message.includes('privado'), false);
    return true;
  });
}

console.log('AGT-003 preflight fail-closed engine passed');
