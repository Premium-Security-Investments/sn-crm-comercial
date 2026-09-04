// AGT-002 bounded per-batch retry for the real AGT-002 semantic discovery transport timeout.
//
// Evidence: a real v9 20k-char Procuraduria run succeeded five batches (latencies 19.6-57.6s,
// input tokens 17.5k-75.5k) and then batch 6 rejected with the bridge's OWN exact transport code,
// `AGT002_CODEX_TIMEOUT`, at 285002ms — a transient/stalled provider turn, not an oversized request
// (see the TENDER_SEMANTIC_DISCOVERY_MAX_BATCH_ATTEMPTS note in tender-semantic-discovery.js). This
// file proves the bounded retry that remediates it: up to
// TENDER_SEMANTIC_DISCOVERY_MAX_BATCH_ATTEMPTS total client.run attempts per batch, ONLY when the
// rejection carries that exact code, with the heartbeat re-awaited before every attempt, the same
// exact request (including idempotencyKey) reused on every attempt, no retry of any other failure
// (provider error, cancellation/abort, invalid content/JSON/usage, semantic/catalog/coverage), and
// successful usage counting only the accepted response. No network, no provider, no DB — only the
// same in-memory client/inventory doubles every other discovery test in this repo already uses.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest, TENDER_SEMANTIC_DISCOVERY_MAX_BATCH_ATTEMPTS } from '../tender-semantic-discovery.js';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function document(id, text) {
  return { document_id: id, document_version_id: `${id}-v1`, content_hash: hash(text), extracted_text: text };
}

assert.equal(TENDER_SEMANTIC_DISCOVERY_MAX_BATCH_ATTEMPTS, 3, 'the requirement is exactly three attempts per batch');

function timeoutError(attemptNumber) {
  const error = new Error(`AGT-002 Preview excedió el tiempo permitido (intento de prueba ${attemptNumber}).`);
  error.code = 'AGT002_CODEX_TIMEOUT';
  return error;
}

function successPayload(request) {
  const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
  return {
    content: JSON.stringify({
      requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }],
      excluded: [],
      unresolved: [],
    }),
    usage: { input_tokens: 11, output_tokens: 7 },
  };
}

// A scripted client: `outcomes[i]` describes the (i+1)-th call to `client.run`, across the WHOLE
// run (every batch, every attempt) — never just one batch — so a test can assert precisely how many
// times, and in what order, the provider boundary was actually crossed.
function sequencedClient(outcomes) {
  const calls = [];
  return {
    calls,
    run: async request => {
      const callIndex = calls.length;
      calls.push(request);
      const step = outcomes[callIndex];
      if (!step) throw new Error(`test bug: unexpected extra client.run call #${callIndex + 1}`);
      if (step.type === 'timeout') throw timeoutError(callIndex + 1);
      if (step.type === 'error') throw step.error;
      if (step.type === 'raw') return step.raw;
      if (step.type === 'success') return successPayload(request);
      throw new Error(`test bug: unknown outcome type ${step.type}`);
    },
  };
}

function heartbeatTracker(events, { failOnCall = null, failure = null } = {}) {
  let count = 0;
  return async () => {
    count += 1;
    events.push({ kind: 'before_provider_call', call: count });
    if (failOnCall !== null && count === failOnCall) throw failure;
  };
}

// ---------------------------------------------------------------------------------------------
// Single-batch fixture: one small document, well under the default per-batch budget, so every
// scenario below is exactly one planned batch unless a test states otherwise.
// ---------------------------------------------------------------------------------------------
const DOC_TEXT = 'El oferente debera acreditar experiencia especifica y verificable en la prestacion continua del servicio de vigilancia hospitalaria, aportando certificaciones expedidas por las entidades contratantes correspondientes.';
const DOCUMENTS = [document('doc-retry-a', DOC_TEXT)];
const SNAPSHOT = '99999999-9999-4999-8999-999999999031';
const INVENTORY = buildTenderRequirementInventory({ snapshotId: SNAPSHOT, documents: DOCUMENTS, documentGaps: [] });

function run(client, extra = {}) {
  return discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'run-retry',
    inventory: INVENTORY,
    documents: DOCUMENTS,
    ...extra,
  });
}

// ---------------------------------------------------------------------------------------------
// 1. timeout, timeout, success => exactly 3 client calls, 3 heartbeats, the same exact request
//    object (including idempotencyKey) on every attempt, and a completed ledger entry whose
//    attempt_count is 3 and whose usage is ONLY the accepted (third) response's usage.
// ---------------------------------------------------------------------------------------------
{
  const client = sequencedClient([{ type: 'timeout' }, { type: 'timeout' }, { type: 'success' }]);
  const events = [];
  const beforeProviderCall = heartbeatTracker(events);

  const result = await run(client, { beforeProviderCall });

  assert.equal(client.calls.length, 3, 'must attempt client.run exactly 3 times: two timeouts, one success');
  assert.equal(events.length, 3, 'the heartbeat must be awaited before every one of the 3 attempts');

  const [first, second, third] = client.calls;
  assert.equal(first, second, 'every attempt must send the SAME request object, not a rebuilt one');
  assert.equal(second, third, 'every attempt must send the SAME request object, not a rebuilt one');
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.match(first.idempotencyKey, /^run-retry:semantic-discovery:0:[0-9a-f]{16}$/);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(second.idempotencyKey, third.idempotencyKey);

  assert.equal(result.discoveryLedger.status, 'completed');
  assert.equal(result.discoveryLedger.batches.length, 1);
  assert.equal(result.discoveryLedger.batches[0].status, 'completed');
  assert.equal(result.discoveryLedger.batches[0].attempt_count, 3, 'a batch that needed 3 attempts must report attempt_count 3');

  // Usage must come ONLY from the accepted (third) response — the two timed-out attempts never
  // produced a usage object at all, so a bug that summed across attempts would inflate this.
  assert.equal(result.usage.input_tokens, 11);
  assert.equal(result.usage.output_tokens, 7);
  assert.equal(result.discoveryLedger.batches[0].usage.input_tokens, 11);
  assert.equal(result.discoveryLedger.batches[0].usage.output_tokens, 7);
}

// ---------------------------------------------------------------------------------------------
// 2. Three timeouts => reject after exactly 3 calls (never a 4th), with a FAILED ledger entry
//    whose attempt_count is 3, and — because this scenario spans two planned batches — the second
//    batch's provider call must never happen at all.
// ---------------------------------------------------------------------------------------------
{
  // Two documents, each large enough alone to force its own batch under a tight per-batch budget,
  // guaranteeing a 2-batch plan so "no later batch call" is a meaningful assertion.
  const docA = document('doc-retry-multi-a', DOC_TEXT);
  const docB = document('doc-retry-multi-b', 'El contratista entregara un informe mensual de operaciones debidamente detallado y suscrito por el supervisor designado dentro de los primeros dias habiles de cada mes calendario de la vigencia contractual acordada.');
  const documents = [docA, docB];
  const snapshot = '99999999-9999-4999-8999-999999999032';
  const inventory = buildTenderRequirementInventory({ snapshotId: snapshot, documents, documentGaps: [] });
  const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
  const unitsA = [...resolvedTexts.values()].filter(value => value.document_id === 'doc-retry-multi-a');
  const maxSourceChars = unitsA.reduce((total, value) => total + value.text.length, 0);
  assert.ok(maxSourceChars > 0);

  const client = sequencedClient([{ type: 'timeout' }, { type: 'timeout' }, { type: 'timeout' }]);
  const events = [];
  const beforeProviderCall = heartbeatTracker(events);

  await assert.rejects(
    () => discoverTenderSemanticManifest({
      client,
      model: 'test-model',
      timeoutMs: 1000,
      idempotencyKey: 'run-retry-multi',
      inventory,
      documents,
      maxSourceChars,
      maxLabelCatalogChars: 40_000,
      beforeProviderCall,
    }),
    error => {
      assert.equal(error.code, 'AGT002_CODEX_TIMEOUT', 'the caller must still see the original timeout code after retries are exhausted');
      assert.equal(client.calls.length, 3, 'must fail closed after exactly 3 attempts, never a 4th');
      assert.equal(events.length, 3, 'a heartbeat must be awaited before each of the 3 exhausted attempts, and never again after the 3rd');

      const ledger = error.discoveryLedger;
      assert.ok(ledger);
      assert.equal(ledger.status, 'failed');
      assert.equal(ledger.decision_ready, false);
      assert.equal(ledger.batches.length, 2, 'the ledger must account for both planned batches');
      assert.equal(ledger.batches[0].status, 'failed');
      assert.equal(ledger.batches[0].attempt_count, 3, 'the failed batch must report all 3 exhausted attempts');
      assert.equal(ledger.batches[1].status, 'pending', 'the second batch must never be attempted after the first exhausts its retries');
      return true;
    },
  );
}

// ---------------------------------------------------------------------------------------------
// 3. A non-timeout client.run rejection must never be retried: exactly 1 call, and the original
//    error (code, message) survives unchanged. The failed ledger entry must NOT carry attempt_count
//    (only 1 attempt was made), preserving the ordinary one-attempt ledger shape.
// ---------------------------------------------------------------------------------------------
{
  const providerError = new Error('El servicio de AGT-002 Preview no está disponible.');
  providerError.code = 'AGT002_CODEX_TRANSPORT_ERROR';
  const client = sequencedClient([{ type: 'error', error: providerError }, { type: 'success' }]);
  const events = [];
  const beforeProviderCall = heartbeatTracker(events);

  await assert.rejects(
    () => run(client, { beforeProviderCall }),
    error => {
      assert.equal(error, providerError, 'a non-timeout provider error must never be retried or wrapped');
      assert.equal(client.calls.length, 1, 'a non-timeout error must cost exactly 1 client.run call');
      assert.equal(events.length, 1, 'exactly one heartbeat for the one attempt actually made');
      assert.equal(error.discoveryLedger.batches[0].status, 'failed');
      assert.equal(Object.hasOwn(error.discoveryLedger.batches[0], 'attempt_count'), false,
        'a single-attempt failure must not carry attempt_count, keeping the ordinary ledger shape');
      return true;
    },
  );
}

// ---------------------------------------------------------------------------------------------
// 3b. Cancellation/abort must never be retried either — same shape as any other non-timeout error.
// ---------------------------------------------------------------------------------------------
{
  const abortError = new Error('La solicitud de AGT-002 Preview fue cancelada.');
  abortError.code = 'AGT002_CODEX_CANCELLED';
  const client = sequencedClient([{ type: 'error', error: abortError }, { type: 'success' }]);

  await assert.rejects(
    () => run(client),
    error => {
      assert.equal(error, abortError);
      assert.equal(client.calls.length, 1, 'cancellation must cost exactly 1 client.run call, never retried');
      return true;
    },
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Every post-response validation failure must never be retried either: the provider DID answer
//    (client.run resolved, not rejected), so there is nothing transient to retry — exactly 1 call
//    each, and the same closed {stage, code} classification as before this retry existed.
// ---------------------------------------------------------------------------------------------
async function assertsSingleAttemptFailure(outcome, codePattern) {
  const client = sequencedClient([outcome, { type: 'success' }]);
  await assert.rejects(
    () => run(client),
    error => {
      assert.equal(client.calls.length, 1, 'a post-response validation failure must cost exactly 1 client.run call');
      assert.match(error.code, codePattern);
      assert.equal(Object.hasOwn(error.discoveryLedger.batches[0], 'attempt_count'), false);
      return true;
    },
  );
}

// 4a. Missing/empty content.
await assertsSingleAttemptFailure({ type: 'raw', raw: { content: '', usage: { input_tokens: 1, output_tokens: 1 } } }, /^v4_discovery_missing_content$/);

// 4b. Invalid JSON.
await assertsSingleAttemptFailure({ type: 'raw', raw: { content: 'not json at all', usage: { input_tokens: 1, output_tokens: 1 } } }, /^v4_discovery_invalid_json$/);

// 4c. Invalid usage.
await assertsSingleAttemptFailure(
  { type: 'raw', raw: { content: JSON.stringify({ requirements: [], excluded: [], unresolved: [] }), usage: { input_tokens: -1, output_tokens: 1 } } },
  /^v4_discovery_invalid_usage$/,
);

// 4d. Invalid semantic response: a label outside this batch's own literal catalog.
await assertsSingleAttemptFailure(
  {
    type: 'raw',
    raw: {
      content: JSON.stringify({
        requirements: [{ kind: 'obligation', label: 'esto no es un fragmento literal del catalogo', front: 'technical', category: 'technical' }],
        excluded: [],
        unresolved: [],
      }),
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  },
  /^v4_discovery_citation_anchor_invariant$/,
);

// ---------------------------------------------------------------------------------------------
// 5. A heartbeat failure on a RETRY attempt: the client call it guards must never happen, and the
//    heartbeat failure itself must never be retried (it is not a client.run timeout at all).
// ---------------------------------------------------------------------------------------------
{
  const leaseLost = new Error('la reserva AGT-002 se perdio antes del reintento');
  leaseLost.code = 'AGT002_PREVIEW_LEASE_LOST';
  const client = sequencedClient([{ type: 'timeout' }, { type: 'success' }]);
  const events = [];
  // Fails on the SECOND heartbeat call — i.e. the one guarding the retry after the first timeout.
  const beforeProviderCall = heartbeatTracker(events, { failOnCall: 2, failure: leaseLost });

  await assert.rejects(
    () => run(client, { beforeProviderCall }),
    error => {
      assert.equal(error, leaseLost, 'the heartbeat rejection must surface unchanged, never retried, never wrapped');
      assert.equal(client.calls.length, 1, 'the retry client.run call guarded by the failed heartbeat must never happen');
      assert.equal(events.length, 2, 'exactly 2 heartbeats: one before the timed-out attempt, one that then failed and stopped the retry');
      assert.equal(error.discoveryLedger.batches[0].status, 'failed');
      assert.equal(Object.hasOwn(error.discoveryLedger.batches[0], 'attempt_count'), false,
        'only 1 client.run attempt was ever made before the heartbeat failed, so attempt_count must not appear');
      return true;
    },
  );
}

console.log('tests/tender-semantic-discovery-batch-retry.test.mjs OK');
