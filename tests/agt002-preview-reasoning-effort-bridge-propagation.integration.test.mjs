import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startSyntheticAgt002HetznerBridge } from './fixtures/agt002-hetzner-bridge-synthetic-server.mjs';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { createCodexAppServerClient } from '../agt002-preview-codex-client.js';

// AGT-002 root-cause fix, end to end: real HMAC-signed bridge client -> real HTTP bridge server
// -> real Codex App Server client (fake spawn) -> turn/start.params.effort. Proves the value
// travels the FULL transport hop, not just each layer in isolation (already covered by
// tests/agt002-hetzner-bridge-client.test.mjs and tests/agt002-hetzner-bridge-server.test.mjs).

const SECRET = 'a'.repeat(32);

function baseRunInput(overrides = {}) {
  return {
    model: 'gpt-5.6-luna',
    policy: 'POLICY',
    input: { snapshot_id: 'snap-1' },
    outputSchema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
    timeoutMs: 5000,
    idempotencyKey: 'idem-reasoning-effort',
    ...overrides,
  };
}

function fakeCodexSpawnCapturingTurnStart(capture) {
  return function fakeSpawn() {
    const child = new EventEmitter();
    child.stdin = { write: (data) => { queueMicrotask(() => onWrite(data)); }, end() {} };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; };
    function onWrite(data) {
      const message = JSON.parse(String(data).trim());
      const respond = result => child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: message.id, result })}\n`));
      if (message.method === 'initialize') { respond({ codexHome: '/tmp', platformFamily: 'unix', platformOs: 'linux', userAgent: 'fake/1.0' }); return; }
      if (message.method === 'account/read') { respond({ account: { type: 'chatgpt', email: null, planType: 'team' }, requiresOpenaiAuth: false }); return; }
      if (message.method === 'account/rateLimits/read') { respond({ rateLimits: { primary: { usedPercent: 1 } } }); return; }
      if (message.method === 'thread/start') { respond({ thread: { id: 'thread-fake' }, approvalPolicy: 'never', approvalsReviewer: 'user', cwd: '/tmp', model: 'x', modelProvider: 'openai', sandbox: {} }); return; }
      if (message.method === 'turn/start') {
        capture.turnStartParams = message.params;
        respond({ turn: { id: 'turn-fake', status: 'inProgress', items: [] } });
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-fake', turnId: 'turn-fake', completedAtMs: 0, item: { id: 'i1', type: 'agentMessage', text: JSON.stringify({ ok: true }) } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-fake', turnId: 'turn-fake', tokenUsage: { total: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 }, last: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 } } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-fake', turn: { id: 'turn-fake', status: 'completed', items: [] } } })}\n`));
        return;
      }
    }
    return child;
  };
}

// `args: ['app-server']` is the real deployment argv (run-server.mjs's default): the client now
// refuses to run a turn that requested an effort it cannot pin on the Codex process argv, so a
// test double must carry the same subcommand token the production process does.
async function testDefaultLowEffortReachesTurnStartAcrossTheRealBridgeHop() {
  const capture = { turnStartParams: null };
  const codexClient = createCodexAppServerClient({ spawn: fakeCodexSpawnCapturingTurnStart(capture), command: 'ignored', args: ['app-server'] });
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    await client.run(baseRunInput({ effort: 'low' }));
    assert.equal(capture.turnStartParams.effort, 'low', 'the default AGT-002 reasoning effort must reach turn/start.params.effort across the real HMAC bridge hop');
  } finally {
    await bridge.close();
  }
}

async function testExplicitMediumEffortReachesTurnStart() {
  const capture = { turnStartParams: null };
  const codexClient = createCodexAppServerClient({ spawn: fakeCodexSpawnCapturingTurnStart(capture), command: 'ignored', args: ['app-server'] });
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    await client.run(baseRunInput({ effort: 'medium', idempotencyKey: 'idem-reasoning-effort-medium' }));
    assert.equal(capture.turnStartParams.effort, 'medium');
  } finally {
    await bridge.close();
  }
}

async function testUnsupportedEffortNeverReachesTheBridgeOrTheProvider() {
  let codexClientInvoked = false;
  const codexClient = { run: async () => { codexClientInvoked = true; return { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null }; } };
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    await assert.rejects(
      () => client.run(baseRunInput({ effort: 'high', idempotencyKey: 'idem-reasoning-effort-invalid' })),
      /esfuerzo de razonamiento/i,
    );
    assert.equal(codexClientInvoked, false, 'a malformed effort must be rejected client-side, before any bridge/provider call');
  } finally {
    await bridge.close();
  }
}

await testDefaultLowEffortReachesTurnStartAcrossTheRealBridgeHop();
await testExplicitMediumEffortReachesTurnStart();
await testUnsupportedEffortNeverReachesTheBridgeOrTheProvider();
console.log('agt002-preview-reasoning-effort-bridge-propagation.integration.test.mjs OK');
