import { strict as assert } from 'node:assert';
import { AGT002_PREVIEW_POLICY, createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { AGT002_PREVIEW_OUTPUT_JSON_SCHEMA } from '../agt002-preview-contract.js';

const context = {
  opportunity: { id: 'opp-1', company_name: 'Entidad de prueba', title: 'Vigilancia' },
  documents: [
    { id: 'doc-01', name: 'Pliego', document_type: 'pliego', extracted_text: 'Requiere póliza vigente.' },
    { id: 'doc-02', name: 'Anexo', document_type: 'anexo_tecnico', extracted_text: 'Requiere CCTV.' },
  ],
  companyProfile: { working_capital: 500 },
  deepAnalysis: {},
  snapshotId: '11111111-1111-4111-8111-111111111111',
};

function validModelOutput(overrides = {}) {
  return {
    recommendation: 'pause',
    summary: 'Falta confirmar la póliza.',
    strengths: [],
    weaknesses: [{ id: 'f-1', text: 'Falta póliza vigente.', critical: true, evidence_refs: ['document:doc-01'] }],
    blockers: [],
    questions: [],
    unverified: [],
    next_action: 'Solicitar póliza vigente.',
    human_review_required: true,
    ...overrides,
  };
}

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    run: async (options) => {
      calls.push(options);
      return handler(options, calls.length);
    },
  };
}

function baseEngineOptions(overrides = {}) {
  return {
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v1',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    ...overrides,
  };
}

for (const text of ['datos no confiables', 'GO / NO GO', 'herramientas', 'evidence_id', 'JSON estructurado']) {
  assert.match(AGT002_PREVIEW_POLICY, new RegExp(text, 'i'));
}

// Happy path: closed envelope, correct identity, usage/rate-limit surfaced.
{
  const client = fakeClient(async () => ({
    content: JSON.stringify(validModelOutput()),
    usage: { input_tokens: 120, output_tokens: 40 },
    rate_limit: { window: '5h', used_percent: 3 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  const result = await engine.analyze(context);
  assert.equal(result.producer, 'AGT-002');
  assert.equal(result.agent_id, 'AGT-002');
  assert.equal(result.method, 'agent_ai');
  assert.equal(result.schema_version, '2.0-preview.1');
  assert.equal(result.status, 'completed');
  assert.equal(result.human_review_required, true);
  assert.equal(result.snapshot_id, context.snapshotId);
  assert.equal(result.policy_version, 'agt002-preview-policy-v1');
  assert.equal(result.usage.provider, 'codex_app_server');
  assert.equal(result.usage.model, 'synthetic-codex-model');
  assert.equal(result.usage.input_tokens, 120);
  assert.equal(result.usage.output_tokens, 40);
  assert.deepEqual(result.usage.rate_limit, { window: '5h', used_percent: 3 });
  assert.ok(!Object.hasOwn(result, 'decision') && !Object.hasOwn(result, 'go_no_go'), 'AGT-002 Preview must never emit an authoritative GO/NO GO field');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].model, 'synthetic-codex-model');
  assert.equal(client.calls[0].input.snapshot_id, context.snapshotId);
  assert.equal(client.calls[0].outputSchema.type, 'object');
  assert.equal(client.calls[0].outputSchema.additionalProperties, false);
  assert.equal(client.calls[0].outputSchema.properties.human_review_required.const, true);
  for (const field of ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']) {
    assert.deepEqual(
      client.calls[0].outputSchema.properties[field].items.properties.evidence_refs.items.enum,
      ['document:doc-01', 'document:doc-02'],
      `${field} debe restringir evidence_refs al snapshot enviado`,
    );
  }
  assert.equal(
    Object.hasOwn(AGT002_PREVIEW_OUTPUT_JSON_SCHEMA.properties.strengths.items.properties.evidence_refs.items, 'enum'),
    false,
    'el schema base compartido no debe mutarse al crear el enum dinámico',
  );
}

// Valid JSON wrapped in peripheral whitespace (trailing newline, etc.) must still be
// accepted: JSON.parse tolerates it and the bridge legitimately returns it that way.
{
  const client = fakeClient(async () => ({
    content: `\n  ${JSON.stringify(validModelOutput())}\n`,
    usage: { input_tokens: 120, output_tokens: 40 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  const result = await engine.analyze(context);
  assert.equal(result.status, 'completed');
  assert.equal(result.human_review_required, true);
}

// Citation discipline enforced end-to-end: a hallucinated evidence_id is rejected safely.
{
  const client = fakeClient(async () => ({
    content: JSON.stringify(validModelOutput({ weaknesses: [{ id: 'f-1', text: 'x', critical: true, evidence_refs: ['document:doc-99'] }] })),
    usage: { input_tokens: 10, output_tokens: 5 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), /no produjo una respuesta válida/i);
}

// Prompt-injection-shaped output (extra key trying to smuggle an authoritative decision) is rejected.
{
  const client = fakeClient(async () => ({
    content: JSON.stringify({ ...validModelOutput(), go_no_go: 'go' }),
    usage: { input_tokens: 10, output_tokens: 5 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), /no produjo una respuesta válida/i);
}

// Non-JSON / truncated content is rejected safely, not thrown as a raw parse error.
{
  const client = fakeClient(async () => ({ content: '```json\n{}\n```', usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), /no produjo una respuesta válida/i);
}

// Invalid usage (non-integer tokens) is rejected safely.
{
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 'many', output_tokens: 5 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), /no produjo una respuesta válida/i);
}

// Transport failure (timeout/crash from the client) surfaces a safe, non-provider-leaking message.
{
  const client = fakeClient(async () => { const error = new Error('provider internals leaked here'); error.code = 'AGT002_CODEX_TIMEOUT'; throw error; });
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  await assert.rejects(() => engine.analyze(context), error => !/provider internals/i.test(error.message) && /no está disponible/i.test(error.message));
}

// Bounded concurrency: a second distinct request while one is in flight is rejected
// without ever reaching the client, and later requests succeed once a slot frees up.
{
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = fakeClient(async () => { await gate; return { content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }; });
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ maxConcurrent: 1 }) });
  const first = engine.analyze(context, { idempotencyKey: 'key-a' });
  await new Promise(resolve => setTimeout(resolve, 10));
  await assert.rejects(
    () => engine.analyze({ ...context, snapshotId: '22222222-2222-4222-8222-222222222222' }, { idempotencyKey: 'key-b' }),
    /saturad/i,
  );
  assert.equal(client.calls.length, 1, 'the concurrent second request must never reach the client');
  release();
  await first;
}

// Concurrency reservation is synchronous: even while the first quota probe is
// awaiting, a distinct request cannot race through the same maxConcurrent slot.
{
  let releaseQuota;
  const quotaGate = new Promise(resolve => { releaseQuota = resolve; });
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ maxConcurrent: 1, countDailyRuns: async () => { await quotaGate; return 0; } }) });
  const first = engine.analyze(context, { idempotencyKey: 'quota-race-a' });
  const second = engine.analyze({ ...context, snapshotId: '33333333-3333-4333-8333-333333333333' }, { idempotencyKey: 'quota-race-b' });
  await new Promise(resolve => setTimeout(resolve, 0));
  releaseQuota();
  await first;
  await assert.rejects(second, /saturad/i);
  assert.equal(client.calls.length, 1, 'quota await must not allow another request to steal the reserved slot');
}

// In-process idempotency: two concurrent calls with the same key collapse into one
// underlying client invocation and resolve to the exact same run.
{
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ maxConcurrent: 2 }) });
  const [a, b] = await Promise.all([
    engine.analyze(context, { idempotencyKey: 'same-key' }),
    engine.analyze(context, { idempotencyKey: 'same-key' }),
  ]);
  assert.equal(client.calls.length, 1, 'identical concurrent requests must not double-spend quota');
  assert.deepEqual(a, b);
  assert.equal(a.run_id, b.run_id);
}

// Interpretable daily quota: exceeding the injected daily run count blocks before transport.
{
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ dailyMaxRuns: 3, countDailyRuns: async () => 3 }) });
  await assert.rejects(() => engine.analyze(context), /cuota/i);
  assert.equal(client.calls.length, 0);
}

// Fail-closed on an untrustworthy quota probe (never assume zero usage silently).
{
  const client = fakeClient(async () => ({ content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions({ countDailyRuns: async () => -1 }) });
  await assert.rejects(() => engine.analyze(context), /no está disponible/i);
  assert.equal(client.calls.length, 0);
}

// Cancellation/timeout signal propagates through to the transport layer.
{
  let capturedSignal;
  const client = fakeClient(async (options) => {
    capturedSignal = options.signal;
    return { content: JSON.stringify(validModelOutput()), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const engine = createAgt002PreviewEngine({ client, ...baseEngineOptions() });
  const controller = new AbortController();
  await engine.analyze(context, { signal: controller.signal });
  assert.equal(capturedSignal, controller.signal);
}

// Configuration failures must fail closed rather than silently no-op.
assert.throws(() => createAgt002PreviewEngine({}), /no está configurado/i);
assert.throws(() => createAgt002PreviewEngine({ client: { run: async () => {} }, model: '', policyVersion: 'v1' }), /no está configurado/i);

console.log('AGT-002 Preview engine orchestration passed');
