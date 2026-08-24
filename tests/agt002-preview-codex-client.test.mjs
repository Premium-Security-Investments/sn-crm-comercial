import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AGT002_CODEX_CLIENT_NAME,
  createCodexAppServerClient,
  requestAgt002CodexDeviceCodeLogin,
} from '../agt002-preview-codex-client.js';
import { buildAgt002IntegralAnalysisV3OutputJsonSchema } from '../agt002-preview-contract.js';

const source = readFileSync(new URL('../agt002-preview-codex-client.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /OPENAI_API_KEY|HERMES_INTERIM_API_KEY|Authorization|Bearer/i, 'the Codex App Server client must never manage an API key or Bearer token; auth is the subprocess\'s own OAuth ChatGPT session');

// The official protocol is JSON-RPC method names, never the retired synthetic ones.
assert.doesNotMatch(source, /agt002\.preview\.run|agt002\.preview\.cancel/, 'the client must speak the official Codex App Server protocol, not the retired synthetic agt002.preview.* methods');
for (const method of ['initialize', 'account/read', 'account/rateLimits/read', 'thread/start', 'turn/start', 'turn/interrupt']) {
  assert.match(source, new RegExp(method.replace(/\//g, '\\/')), `client must send ${method}`);
}

const fixture = fileURLToPath(new URL('./fixtures/agt002-codex-app-server-synthetic.mjs', import.meta.url));
const CLOSED_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['recommendation', 'summary', 'human_review_required'],
  properties: {
    recommendation: { type: 'string' },
    summary: { type: 'string' },
    human_review_required: { const: true },
  },
});

function realClient(overrides = {}) {
  return createCodexAppServerClient({ command: process.execPath, args: [fixture, overrides.scenario || 'ok'], timeoutMs: 2000, ...overrides });
}

function baseRunOptions(overrides = {}) {
  return { model: 'synthetic-codex-model', policy: 'POLICY', input: { snapshot_id: 'snap-1' }, outputSchema: CLOSED_OUTPUT_SCHEMA, timeoutMs: 2000, ...overrides };
}

// Happy path over a real child process speaking the official protocol end to end.
{
  const client = realClient({ scenario: 'ok' });
  const result = await client.run(baseRunOptions({ idempotencyKey: 'idem-1' }));
  const parsed = JSON.parse(result.content);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.scenario, 'ok');
  assert.deepEqual(result.usage, { input_tokens: 42, output_tokens: 7 });
  assert.deepEqual(result.rate_limit, { primary: { usedPercent: 12, resetsAt: null, windowDurationMins: 300 } });
}

// The client never sends a credential-shaped field, and clientInfo identifies this caller.
{
  const client = realClient({ scenario: 'ok' });
  const raw = await client.run(baseRunOptions({ idempotencyKey: 'idem-2' }));
  assert.doesNotMatch(JSON.stringify(raw), /api[_-]?key|authorization|bearer/i);
  assert.ok(nonEmpty(AGT002_CODEX_CLIENT_NAME));
}
function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }

// Ignores unrelated notifications interleaved before the real completion sequence.
{
  const client = realClient({ scenario: 'notify' });
  const result = await client.run(baseRunOptions());
  assert.equal(JSON.parse(result.content).scenario, 'notify');
}

// Missing ChatGPT login must fail safe WITHOUT starting a login flow itself.
{
  const client = realClient({ scenario: 'login-required' });
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_LOGIN_REQUIRED');
}

// An apiKey-type account must never be used to run AGT-002 Preview.
{
  const client = realClient({ scenario: 'apikey-account' });
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_ACCOUNT_INVALID');
}

// account/read transport failure fails safe without leaking provider detail.
{
  const client = realClient({ scenario: 'account-error' });
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_TRANSPORT_ERROR' && !/should never reach/i.test(error.message));
}

// account/rateLimits/read failure fails safe.
{
  const client = realClient({ scenario: 'ratelimits-error' });
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_TRANSPORT_ERROR');
}

// thread/start failure fails safe.
{
  const client = realClient({ scenario: 'thread-error' });
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_TRANSPORT_ERROR');
}

// turn/start failure fails safe.
{
  const client = realClient({ scenario: 'turn-error' });
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_TRANSPORT_ERROR');
}

// A turn that completes with status !== 'completed' is a provider error, not a silent success.
{
  const client = realClient({ scenario: 'turn-failed' });
  await assert.rejects(() => client.run(baseRunOptions()), error => {
    assert.equal(error.code, 'AGT002_CODEX_PROVIDER_ERROR');
    assert.equal(error.providerStatus, 'failed');
    assert.equal(error.providerErrorCode, 'usage_limit_exceeded');
    assert.doesNotMatch(error.message, /secret detail|model failed/i);
    return true;
  });
}

// Free-form provider status/error text must never survive into diagnostic fields.
{
  const client = realClient({ scenario: 'turn-failed-unsafe-details' });
  await assert.rejects(() => client.run(baseRunOptions()), error => {
    assert.equal(error.code, 'AGT002_CODEX_PROVIDER_ERROR');
    assert.equal(error.providerStatus, 'unknown');
    assert.equal(error.providerErrorCode, undefined);
    assert.equal(JSON.stringify(error).includes('secret detail'), false);
    return true;
  });
}

// Codex App Server 0.145 may encode status as a tagged object rather than a flat string.
{
  const client = realClient({ scenario: 'turn-completed-object-status' });
  const result = await client.run(baseRunOptions());
  assert.equal(JSON.parse(result.content).scenario, 'turn-completed-object-status');
  assert.deepEqual(result.usage, { input_tokens: 8, output_tokens: 3 });
}

// A turn that completes without ever emitting an agentMessage item is an unsafe/invalid response.
{
  const client = realClient({ scenario: 'no-agent-message' });
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_INVALID_RESPONSE');
}

// A run() call without a closed outputSchema is rejected before ever spawning anything unsafe.
{
  const client = realClient({ scenario: 'ok' });
  await assert.rejects(() => client.run({ ...baseRunOptions(), outputSchema: undefined }), /outputSchema/i);
}

// Timeout: the subprocess never answers past turn/start; run() must reject within the window.
{
  const client = realClient({ scenario: 'hang' });
  const started = Date.now();
  await assert.rejects(() => client.run(baseRunOptions({ timeoutMs: 150 })), error => error.code === 'AGT002_CODEX_TIMEOUT');
  assert.ok(Date.now() - started < 2000, 'timeout must be enforced close to the configured window');
}

// A subprocess that never emits a valid framed response before the deadline must still fail safely via timeout.
{
  const client = realClient({ scenario: 'badjson' });
  await assert.rejects(() => client.run(baseRunOptions({ timeoutMs: 150 })), error => error.code === 'AGT002_CODEX_TIMEOUT');
}

// A subprocess crash must reject with a safe transport error, not hang.
{
  const client = realClient({ scenario: 'crash' });
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_TRANSPORT_ERROR');
}

// Cancellation via AbortSignal (after threadId/turnId are known) must send turn/interrupt and reject promptly.
{
  const client = realClient({ scenario: 'hang' });
  const controller = new AbortController();
  const started = Date.now();
  const pending = client.run(baseRunOptions({ timeoutMs: 5000, signal: controller.signal }));
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(() => pending, error => error.code === 'AGT002_CODEX_CANCELLED');
  assert.ok(Date.now() - started < 2000, 'cancellation must not wait for the timeout window');
}

// Cancellation before any thread/turn exists must still reject promptly without sending turn/interrupt.
{
  const client = realClient({ scenario: 'ok' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => client.run(baseRunOptions({ signal: controller.signal })), error => error.code === 'AGT002_CODEX_CANCELLED');
}

// Spawning a missing/invalid binary must reject safely, not throw synchronously or hang.
{
  const client = createCodexAppServerClient({ command: '/nonexistent/agt002-codex-app-server-binary', args: [], timeoutMs: 2000 });
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_TRANSPORT_ERROR');
}

// Dependency injection: an in-memory fake spawn (no real process) proves the transport is fully
// injectable and exercises the whole real-method sequence end to end.
{
  function fakeSpawn() {
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
        respond({ turn: { id: 'turn-fake', status: 'inProgress', items: [] } });
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-fake', turnId: 'turn-fake', completedAtMs: 0, item: { id: 'i1', type: 'agentMessage', text: JSON.stringify({ injected: true }) } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-fake', turnId: 'turn-fake', tokenUsage: { total: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 }, last: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 } } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-fake', turn: { id: 'turn-fake', status: 'completed', items: [] } } })}\n`));
        return;
      }
    }
    return child;
  }
  const client = createCodexAppServerClient({ spawn: fakeSpawn, command: 'ignored', args: [], timeoutMs: 2000 });
  const result = await client.run(baseRunOptions());
  assert.deepEqual(JSON.parse(result.content), { injected: true });
}

// thread/start must request the safe operating envelope required for AGT-002 Preview:
// ephemeral, read-only sandbox, and approvals disabled (no side effects possible).
{
  let capturedThreadStartParams = null;
  let capturedTurnStartParams = null;
  function fakeSpawn() {
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
      if (message.method === 'thread/start') { capturedThreadStartParams = message.params; respond({ thread: { id: 'thread-fake' }, approvalPolicy: 'never', approvalsReviewer: 'user', cwd: '/tmp', model: 'x', modelProvider: 'openai', sandbox: {} }); return; }
      if (message.method === 'turn/start') {
        capturedTurnStartParams = message.params;
        respond({ turn: { id: 'turn-fake', status: 'inProgress', items: [] } });
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-fake', turnId: 'turn-fake', completedAtMs: 0, item: { id: 'i1', type: 'agentMessage', text: JSON.stringify({ ok: true }) } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-fake', turnId: 'turn-fake', tokenUsage: { total: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 }, last: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 } } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-fake', turn: { id: 'turn-fake', status: 'completed', items: [] } } })}\n`));
        return;
      }
    }
    return child;
  }
  const client = createCodexAppServerClient({ spawn: fakeSpawn, command: 'ignored', args: [], timeoutMs: 2000 });
  await client.run(baseRunOptions({ model: 'model-x', policy: 'POLICY-TEXT' }));
  assert.equal(capturedThreadStartParams.ephemeral, true);
  assert.equal(capturedThreadStartParams.sandbox, 'read-only');
  assert.equal(capturedThreadStartParams.approvalPolicy, 'never');
  assert.equal(capturedThreadStartParams.model, 'model-x');
  assert.equal(capturedThreadStartParams.baseInstructions, 'POLICY-TEXT');
  assert.ok(nonEmpty(capturedThreadStartParams.cwd));
  assert.equal(capturedTurnStartParams.threadId, 'thread-fake');
  assert.deepEqual(capturedTurnStartParams.input, [{ type: 'text', text: JSON.stringify({ snapshot_id: 'snap-1' }) }]);
  assert.deepEqual(capturedTurnStartParams.outputSchema, {
    ...CLOSED_OUTPUT_SCHEMA,
    properties: {
      ...CLOSED_OUTPUT_SCHEMA.properties,
      human_review_required: { enum: [true] },
    },
  });
  assert.deepEqual(CLOSED_OUTPUT_SCHEMA.properties.human_review_required, { const: true }, 'the canonical schema must not be mutated');

  capturedTurnStartParams = null;
  const canonicalV3Schema = buildAgt002IntegralAnalysisV3OutputJsonSchema({
    requirementManifest: [{ requirement_id: 'REQ-1', category: 'habilitating' }],
    companyEvidenceClassIds: ['rup'],
    allowlist: {
      tender_document: ['document:doc-1'],
      company_evidence: ['company:rup-1'],
      legal_corpus: ['legal:rule-1'],
      human_evidence: ['human:answer-1'],
      objective_validation: ['objective:REQ-1:amount'],
    },
  });
  await client.run(baseRunOptions({ outputSchema: canonicalV3Schema }));
  function assertCodexWireSchema(node, path = '$', objectDepth = 0, totals = { properties: 0, maxDepth: 0 }) {
    if (!node || typeof node !== 'object') return totals;
    assert.equal(Object.hasOwn(node, 'const'), false, `${path} must adapt const to enum on the wire`);
    if (node.type === 'object') {
      const nextDepth = objectDepth + 1;
      totals.maxDepth = Math.max(totals.maxDepth, nextDepth);
      assert.equal(node.additionalProperties, false, `${path} must remain closed on the wire`);
      assert.ok(node.properties && typeof node.properties === 'object', `${path} must declare properties on the wire`);
      totals.properties += Object.keys(node.properties).length;
      for (const [key, child] of Object.entries(node.properties)) assertCodexWireSchema(child, `${path}.properties.${key}`, nextDepth, totals);
    }
    if (node.type === 'array') assertCodexWireSchema(node.items, `${path}.items`, objectDepth, totals);
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
      node[keyword]?.forEach((child, index) => assertCodexWireSchema(child, `${path}.${keyword}[${index}]`, objectDepth, totals));
    }
    return totals;
  }
  const wireMetrics = assertCodexWireSchema(capturedTurnStartParams.outputSchema);
  assert.ok(wireMetrics.maxDepth <= 5, `Codex Structured Outputs supports at most 5 object levels, got ${wireMetrics.maxDepth}`);
  assert.ok(wireMetrics.properties <= 100, `Codex Structured Outputs supports at most 100 properties, got ${wireMetrics.properties}`);
  assert.equal(
    canonicalV3Schema.properties.integral_analysis.properties.analysis_units.items.properties.human_validation.properties.required.const,
    true,
    'the canonical v3 schema must not be mutated by the wire adaptation',
  );
}

// Root-cause fix (AGT-002 V4 discoverTenderSemanticManifest immediate provider failure,
// providerErrorCode=other, ~3.3s): `uniqueItems` is not part of the JSON Schema subset Codex
// Structured Outputs accepts. The proven-working V3 schema (real production canary, see
// docs/runbooks/agt002-integral-v3-canary.md) already relies on minLength/maxLength/minItems/
// maxItems end to end and never uses uniqueItems — local strict validation (never the wire
// schema) is what has always enforced uniqueness. codexCompatibleOutputSchema must strip
// uniqueItems on the wire exactly like it adapts const to enum, while leaving
// minLength/maxLength/minItems/maxItems untouched.
{
  const SCHEMA_WITH_UNIQUE_ITEMS = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['ids'],
    properties: {
      ids: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 10 } },
    },
  });
  let capturedTurnStartParams = null;
  function fakeSpawn() {
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
        capturedTurnStartParams = message.params;
        respond({ turn: { id: 'turn-fake', status: 'inProgress', items: [] } });
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-fake', turnId: 'turn-fake', completedAtMs: 0, item: { id: 'i1', type: 'agentMessage', text: JSON.stringify({ ids: ['a'] }) } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-fake', turnId: 'turn-fake', tokenUsage: { total: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 }, last: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 2 } } } })}\n`));
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-fake', turn: { id: 'turn-fake', status: 'completed', items: [] } } })}\n`));
        return;
      }
    }
    return child;
  }
  const client = createCodexAppServerClient({ spawn: fakeSpawn, command: 'ignored', args: [], timeoutMs: 2000 });
  await client.run(baseRunOptions({ outputSchema: SCHEMA_WITH_UNIQUE_ITEMS }));
  const wireIds = capturedTurnStartParams.outputSchema.properties.ids;
  assert.equal(Object.hasOwn(wireIds, 'uniqueItems'), false, 'uniqueItems is not part of the Codex Structured Outputs schema subset and must be stripped on the wire');
  assert.equal(wireIds.minItems, 1, 'minItems must still reach the wire — Codex Structured Outputs does support it');
  assert.equal(wireIds.maxItems, 5, 'maxItems must still reach the wire — Codex Structured Outputs does support it');
  assert.equal(wireIds.items.minLength, 1, 'minLength must still reach the wire — Codex Structured Outputs does support it');
  assert.equal(wireIds.items.maxLength, 10, 'maxLength must still reach the wire — Codex Structured Outputs does support it');
  assert.deepEqual(
    SCHEMA_WITH_UNIQUE_ITEMS.properties.ids,
    { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 10 } },
    'the caller schema must not be mutated by the wire adaptation',
  );
}

// --- Separate, human-gated ChatGPT device-code login flow -----------------
// This flow must never be reachable from the AGT-002 Preview analysis path.
for (const file of ['../agt002-preview-engine.js', '../agt002-preview-runtime.js', '../server/index.js', '../api/[...path].js']) {
  const guarded = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(guarded, /requestAgt002CodexDeviceCodeLogin|chatgptDeviceCode/, `${file} must never trigger the human-gated login flow automatically`);
}

{
  const login = await requestAgt002CodexDeviceCodeLogin({ command: process.execPath, args: [fixture, 'ok'], timeoutMs: 2000 });
  assert.equal(login.loginId, 'login-synthetic-1');
  assert.equal(login.userCode, 'ABCD-1234');
  assert.equal(login.verificationUrl, 'https://chatgpt.com/device');
  assert.equal(typeof login.cancel, 'function');
  await login.cancel();
}

console.log('AGT-002 Preview Codex App Server client (official protocol, OAuth-native, human-gated login) passed');
