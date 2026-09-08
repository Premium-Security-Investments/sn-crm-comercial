import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startSyntheticAgt002HetznerBridge } from './fixtures/agt002-hetzner-bridge-synthetic-server.mjs';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { createAgt002ClaudeClient } from '../agt002-claude-client.js';

// AGT-002 end to end: real HMAC-signed bridge client -> real HTTP bridge server
// -> real Claude print-mode client (fake spawn). Claude has no effort flag, so
// the requested low/medium value must be acknowledged without reaching argv.

const SECRET = 'a'.repeat(32);

function baseRunInput(overrides = {}) {
  return {
    model: 'sonnet',
    policy: 'POLICY',
    input: { snapshot_id: 'snap-1' },
    outputSchema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
    timeoutMs: 5000,
    idempotencyKey: 'idem-reasoning-effort',
    ...overrides,
  };
}

function fakeClaudeSpawn(capture) {
  return function spawn(command, args, options) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; return true; };
    child.stdin = {
      chunks: [],
      write(data) { this.chunks.push(String(data)); return true; },
      end() {
        capture.stdin = this.chunks.join('');
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify({
            type: 'result', subtype: 'success', is_error: false,
            structured_output: { ok: true },
            usage: { input_tokens: 1, output_tokens: 1 },
          })));
          child.emit('exit', 0, null);
        });
      },
      on() {},
    };
    capture.calls.push({ command, args, options });
    return child;
  };
}

async function withClaudeBridge(capture, fn) {
  const claudeClient = createAgt002ClaudeClient({
    spawn: fakeClaudeSpawn(capture), command: 'claude-fake', cwd: '/tmp', env: { PATH: '/usr/bin' },
  });
  const capturingClient = {
    async run(options) {
      capture.providerResult = await claudeClient.run(options);
      return capture.providerResult;
    },
  };
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient: capturingClient });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    await fn(client);
  } finally {
    await bridge.close();
  }
}

function assertClaudeInvocation(capture, expectedInput) {
  assert.equal(capture.calls.length, 1);
  const call = capture.calls[0];
  assert.equal(call.command, 'claude-fake');
  assert.equal(call.args[call.args.indexOf('--model') + 1], 'sonnet');
  assert.equal(call.args.some(value => /effort|reasoning/i.test(String(value))), false, 'Claude argv must not receive an unsupported effort/reasoning flag');
  assert.deepEqual(JSON.parse(capture.stdin), expectedInput, 'stdin must contain only the structured input');
}

async function testLowEffortIsAckedAcrossTheRealBridgeHop() {
  const capture = { calls: [], providerResult: null, stdin: null };
  const request = baseRunInput({ effort: 'low' });
  await withClaudeBridge(capture, async client => {
    const result = await client.run(request);
    assert.deepEqual(JSON.parse(result.content), { ok: true });
  });
  assert.equal(capture.providerResult.effort_ack, 'low');
  assertClaudeInvocation(capture, request.input);
}

async function testMediumEffortIsAckedAcrossTheRealBridgeHop() {
  const capture = { calls: [], providerResult: null, stdin: null };
  const request = baseRunInput({ effort: 'medium', idempotencyKey: 'idem-reasoning-effort-medium' });
  await withClaudeBridge(capture, async client => {
    const result = await client.run(request);
    assert.deepEqual(JSON.parse(result.content), { ok: true });
  });
  assert.equal(capture.providerResult.effort_ack, 'medium');
  assertClaudeInvocation(capture, request.input);
}

async function testUnsupportedEffortNeverReachesTheBridgeOrTheProvider() {
  const capture = { calls: [], providerResult: null, stdin: null };
  await withClaudeBridge(capture, async client => {
    await assert.rejects(
      () => client.run(baseRunInput({ effort: 'high', idempotencyKey: 'idem-reasoning-effort-invalid' })),
      /esfuerzo de razonamiento/i,
    );
  });
  assert.equal(capture.calls.length, 0, 'a malformed effort must be rejected before spawning Claude');
  assert.equal(capture.providerResult, null);
}

await testLowEffortIsAckedAcrossTheRealBridgeHop();
await testMediumEffortIsAckedAcrossTheRealBridgeHop();
await testUnsupportedEffortNeverReachesTheBridgeOrTheProvider();
console.log('agt002-preview-reasoning-effort-bridge-propagation.integration.test.mjs OK');
