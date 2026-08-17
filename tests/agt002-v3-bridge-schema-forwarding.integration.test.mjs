import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startSyntheticAgt002HetznerBridge } from './fixtures/agt002-hetzner-bridge-synthetic-server.mjs';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { createCodexAppServerClient } from '../agt002-preview-codex-client.js';
import { buildAgt002IntegralAnalysisV3OutputJsonSchema } from '../agt002-preview-contract.js';

// Phase 5 remediation regression (v3_model_output_shape_mismatch).
//
// The failing corrected canary fit the context window but the model turn returned an
// integral_analysis carrying server-owned keys beyond analysis_units. Before blaming the model we
// must PROVE, end to end, that the closed wire schema built by
// buildAgt002IntegralAnalysisV3OutputJsonSchema — which forbids exactly those keys
// (additionalProperties:false, required:['analysis_units'] under integral_analysis) — is actually
// forwarded UNCHANGED through the Hetzner bridge and reaches Codex `turn/start`, so its constraint
// is really presented to the provider. The engine→client.run boundary is covered by
// tests/agt002-preview-engine.test.mjs (the built schema exposes only analysis_units under
// integral_analysis); the const→enum wire adaptation is covered by
// tests/agt002-preview-codex-client.test.mjs. THIS test closes the previously-unasserted segment:
// the real HMAC-signed HTTP hop through the bridge, all the way to the turn/start params.

const SECRET = 'a'.repeat(32);

const VALIDATION_CONTEXT = {
  requirementManifest: [
    { requirement_id: 'REQ-1', category: 'discard' },
    { requirement_id: 'REQ-2', category: 'habilitating' },
  ],
  companyEvidenceClassIds: ['rup', 'licenses'],
  allowlist: {
    tender_document: ['document:doc-1'],
    company_evidence: ['company:rup-1'],
    legal_corpus: ['legal:rule-1'],
    human_evidence: ['human:answer-1'],
    objective_validation: ['objective:REQ-1:amount'],
  },
};

function baseRunInput() {
  return {
    model: 'gpt-x',
    policy: 'POLICY',
    input: { snapshot_id: 'snap-1' },
    timeoutMs: 5000,
    idempotencyKey: 'idem-v3-schema-forwarding',
  };
}

function successUsage(content) {
  return { content, usage: { input_tokens: 12, output_tokens: 34 }, rate_limit: null };
}

// ---------------------------------------------------------------------------
// Part A — the bridge forwards the V3 outputSchema BYTE-IDENTICAL.
// Real client → real HMAC-signed HTTP → real bridge server → capturing codexClient. The object the
// codexClient receives must deep-equal the exact schema the caller built: the signed JSON round
// trip preserves it with no reshaping, truncation or key drop.
// ---------------------------------------------------------------------------
async function testBridgeForwardsV3SchemaUnchanged() {
  const builtSchema = buildAgt002IntegralAnalysisV3OutputJsonSchema(VALIDATION_CONTEXT);
  let receivedByCodex = null;
  const capturingCodexClient = {
    async run(options) {
      receivedByCodex = options.outputSchema;
      return successUsage(JSON.stringify({ integral_analysis: { analysis_units: [] } }));
    },
  };
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient: capturingCodexClient });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    await client.run({ ...baseRunInput(), outputSchema: builtSchema });
    assert.deepEqual(receivedByCodex, builtSchema, 'the Hetzner bridge must forward the V3 outputSchema byte-identical to the codex client');
    // Explicit: the closed shape that forbids server-owned keys survives the transport intact.
    assert.equal(receivedByCodex.additionalProperties, false);
    assert.deepEqual(receivedByCodex.required, ['integral_analysis']);
    assert.equal(receivedByCodex.properties.integral_analysis.additionalProperties, false);
    assert.deepEqual(receivedByCodex.properties.integral_analysis.required, ['analysis_units']);
    assert.deepEqual(Object.keys(receivedByCodex.properties.integral_analysis.properties), ['analysis_units']);
  } finally {
    await bridge.close();
  }
}

// ---------------------------------------------------------------------------
// Part B — end to end to Codex turn/start: the closed shape survives the wire adaptation.
// Real client → real HTTP bridge → REAL codex client with a fake spawn capturing turn/start. The
// turn/start outputSchema must still forbid every server-owned key: integral_analysis stays closed
// (additionalProperties:false) and offers ONLY analysis_units, so contract_version / coverage have
// no slot the provider could legitimately fill; const has been adapted to enum on the wire.
// ---------------------------------------------------------------------------
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
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-fake', turnId: 'turn-fake', completedAtMs: 0, item: { id: 'i1', type: 'agentMessage', text: JSON.stringify({ integral_analysis: { analysis_units: [] } }) } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-fake', turnId: 'turn-fake', tokenUsage: { total: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 }, last: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 } } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-fake', turn: { id: 'turn-fake', status: 'completed', items: [] } } })}\n`));
        return;
      }
    }
    return child;
  };
}

function assertNoConstAndClosed(node, path = '$') {
  if (!node || typeof node !== 'object') return;
  assert.equal(Object.hasOwn(node, 'const'), false, `${path} must have its const adapted to enum on the wire`);
  if (node.type === 'object') {
    assert.equal(node.additionalProperties, false, `${path} must stay closed (additionalProperties:false) on the wire`);
    for (const [key, child] of Object.entries(node.properties || {})) assertNoConstAndClosed(child, `${path}.properties.${key}`);
  }
  if (node.type === 'array' && node.items) assertNoConstAndClosed(node.items, `${path}.items`);
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    node[keyword]?.forEach((child, index) => assertNoConstAndClosed(child, `${path}.${keyword}[${index}]`));
  }
}

async function testV3SchemaReachesTurnStartClosed() {
  const builtSchema = buildAgt002IntegralAnalysisV3OutputJsonSchema(VALIDATION_CONTEXT);
  const pristine = buildAgt002IntegralAnalysisV3OutputJsonSchema(VALIDATION_CONTEXT);
  const capture = { turnStartParams: null };
  const codexClient = createCodexAppServerClient({ spawn: fakeCodexSpawnCapturingTurnStart(capture), command: 'ignored', args: [], timeoutMs: 2000 });
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    await client.run({ ...baseRunInput(), outputSchema: builtSchema });

    const wire = capture.turnStartParams.outputSchema;
    assert.ok(wire, 'turn/start must carry an outputSchema');
    // Top level and integral_analysis stay closed and offer only the model-owned key.
    assert.equal(wire.additionalProperties, false);
    assert.deepEqual(wire.required, ['integral_analysis']);
    assert.equal(wire.properties.integral_analysis.additionalProperties, false);
    assert.deepEqual(wire.properties.integral_analysis.required, ['analysis_units']);
    assert.deepEqual(Object.keys(wire.properties.integral_analysis.properties), ['analysis_units']);
    // Server-owned keys have no slot the provider could legitimately fill.
    for (const serverOwned of ['contract_version', 'coverage']) {
      assert.equal(Object.hasOwn(wire.properties.integral_analysis.properties, serverOwned), false, `integral_analysis must not offer ${serverOwned} on the wire`);
    }
    // The whole schema is closed and const-free after the adaptation.
    assertNoConstAndClosed(wire);
    // The adaptation must not mutate the caller's schema object.
    assert.deepEqual(builtSchema, pristine, 'the built V3 schema must not be mutated by transport or wire adaptation');
  } finally {
    await bridge.close();
  }
}

await testBridgeForwardsV3SchemaUnchanged();
await testV3SchemaReachesTurnStartClosed();
console.log('agt002-v3-bridge-schema-forwarding.integration.test.mjs OK');
