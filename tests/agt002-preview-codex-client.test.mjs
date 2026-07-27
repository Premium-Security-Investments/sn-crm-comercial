import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AGT002_CODEX_CLIENT_NAME,
  createCodexAppServerClient,
  requestAgt002CodexDeviceCodeLogin,
} from '../agt002-preview-codex-client.js';

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
  await assert.rejects(() => client.run(baseRunOptions()), error => error.code === 'AGT002_CODEX_PROVIDER_ERROR');
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
  assert.deepEqual(capturedTurnStartParams.outputSchema, CLOSED_OUTPUT_SCHEMA);
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
