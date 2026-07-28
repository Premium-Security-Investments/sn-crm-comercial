import assert from 'node:assert/strict';
import { buildCanonicalString, sha256Hex, signCanonicalString, verifySignatureConstantTime } from '../agt002-hetzner-bridge-signing.js';
import { createAgt003CopilotBridgeClient } from '../agt003-copilot-bridge-client.js';

const URL = 'https://agents.example.test/v1/agt003-copilot/run';
const SECRET = 's'.repeat(32);

function fakeFetch({ status = 200, payload, capture, throws = false }) {
  return async (url, init) => {
    if (throws) throw new Error('private transport detail');
    capture?.({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
}

assert.throws(() => createAgt003CopilotBridgeClient({ url: 'http://agents.example.test/run', hmacSecret: SECRET }), /HTTPS/i);
assert.throws(() => createAgt003CopilotBridgeClient({ url: URL, hmacSecret: 'short' }), /32/);

let captured;
const client = createAgt003CopilotBridgeClient({
  url: URL,
  hmacSecret: SECRET,
  fetchImpl: fakeFetch({ payload: { content: '{"summary":"ok"}', usage: { input_tokens: 3, output_tokens: 4 }, rate_limit: null }, capture: value => { captured = value; } }),
  randomNonce: () => 'n'.repeat(16),
  now: () => 1000,
});
const result = await client.run({ model: 'model-x', policy: 'policy', input: { safe: true }, outputSchema: { type: 'object' }, timeoutMs: 5000, idempotencyKey: 'idem-1' });
assert.deepEqual(result, { content: '{"summary":"ok"}', usage: { input_tokens: 3, output_tokens: 4 }, rate_limit: null });
assert.equal(captured.init.headers['X-AGT003-Timestamp'], '1000');
assert.equal(captured.init.headers['X-AGT003-Nonce'], 'n'.repeat(16));
assert.equal(captured.init.headers['Idempotency-Key'], 'idem-1');
const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt003-copilot/run', bodySha256Hex: sha256Hex(captured.init.body), timestamp: '1000', nonce: 'n'.repeat(16) });
assert.equal(verifySignatureConstantTime(signCanonicalString(SECRET, canonical), captured.init.headers['X-AGT003-Signature']), true);
assert.equal(JSON.parse(captured.init.body).signal, undefined);
assert.equal(JSON.parse(captured.init.body).cwd, undefined);

const invalid = createAgt003CopilotBridgeClient({ url: URL, hmacSecret: SECRET, fetchImpl: fakeFetch({ payload: { content: 4, usage: {} } }) });
await assert.rejects(() => invalid.run({ model: 'm', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5, idempotencyKey: 'i' }), error => error.code === 'AGT003_COPILOT_INVALID_RESPONSE');
const unavailable = createAgt003CopilotBridgeClient({ url: URL, hmacSecret: SECRET, fetchImpl: fakeFetch({ throws: true }) });
await assert.rejects(() => unavailable.run({ model: 'm', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5, idempotencyKey: 'i' }), error => error.code === 'AGT003_COPILOT_TRANSPORT_ERROR' && !error.message.includes('private'));

console.log('AGT-003 copilot signed bridge client passed');
