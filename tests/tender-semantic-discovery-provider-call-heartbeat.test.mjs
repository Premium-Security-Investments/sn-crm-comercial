// AGT-002 V7 complete discovery — per-batch `beforeProviderCall` hook (RED, no production change).
//
// V7 semantic discovery makes N sequential provider calls for one expediente
// (tender-semantic-discovery.js's batch loop), while the reservations that fund it were sized for
// two turns. The remediation is a DETERMINISTIC STAGE-BOUNDARY heartbeat, never a timer: the caller
// injects `beforeProviderCall`, discovery awaits it IMMEDIATELY BEFORE each batch's `client.run`,
// and a rejection stops that provider call from happening at all — the run fails closed, keeping
// the deterministic, SAFE discovery ledger it already produces for any other per-batch failure.
//
// `discoverTenderSemanticManifest` ignores unknown options today, so the hook is simply never
// invoked: the first ordering assertion below is the RED signal. No network, no provider, no
// secret — the only double is the batch client, exactly as in
// tests/tender-semantic-discovery-multibatch-regression.test.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest } from '../tender-semantic-discovery.js';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function document(id, text) {
  return { document_id: id, document_version_id: `${id}-v1`, content_hash: hash(text), extracted_text: text };
}

// Same forced-split mechanics already proven in tests/tender-semantic-discovery-batching.test.mjs
// and the multibatch regression: doc-hb-a's own text consumes the whole budget alone, and doc-hb-b
// and doc-hb-c together exceed it, so the round-major planner produces exactly three batches. No
// digits, "@" or other redaction triggers appear in the fixture, so the resolved length is exactly
// what the planner measures.
const DOC_A_TEXT = 'El oferente debera acreditar experiencia especifica y verificable en la prestacion continua del servicio de vigilancia hospitalaria, aportando certificaciones expedidas por las entidades contratantes correspondientes, en las cuales conste el objeto contractual ejecutado, el plazo real de ejecucion y la calificacion final obtenida por el contratista durante toda la vigencia del contrato suscrito.';
const DOC_B_TEXT = 'El contratista entregara un informe mensual de operaciones debidamente detallado y suscrito por el supervisor designado, dentro de los primeros dias habiles de cada mes calendario de la vigencia contractual acordada entre las partes.';
const DOC_C_TEXT = 'Queda expresamente prohibido subcontratar total o parcialmente el servicio de monitoreo electronico sin autorizacion previa, expresa y escrita de la entidad contratante responsable de la supervision del contrato suscrito.';

const documents = [
  document('doc-hb-a', DOC_A_TEXT),
  document('doc-hb-b', DOC_B_TEXT),
  document('doc-hb-c', DOC_C_TEXT),
];

const SNAPSHOT = '77777777-7777-4777-8777-777777777021';
const inventory = buildTenderRequirementInventory({ snapshotId: SNAPSHOT, documents, documentGaps: [] });
const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const unitsA = [...resolvedTexts.values()].filter(value => value.document_id === 'doc-hb-a');
const maxSourceChars = unitsA.reduce((total, value) => total + value.text.length, 0);
assert.ok(maxSourceChars > 0, 'fixture must yield a positive per-batch budget');

function fakeBatchClient(events) {
  const requests = [];
  return {
    requests,
    run: async request => {
      events.push({ kind: 'provider_call', batchIndex: request.input.batch.index });
      requests.push(request);
      const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
      const proposal = enumLabels.length
        ? { requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }], excluded: [], unresolved: [] }
        : { requirements: [], excluded: [], unresolved: [] };
      return { content: JSON.stringify(proposal), usage: { input_tokens: 5, output_tokens: 5 } };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 0. FIXTURE SANITY (passes against production as it stands today): with no hook injected the
//    expediente splits into exactly three provider batches and discovery completes. This runs first
//    on purpose — if it ever fails, the problem is the fixture, not the missing heartbeat, and every
//    RED assertion below is telling you nothing.
// ---------------------------------------------------------------------------------------------
{
  const events = [];
  const client = fakeBatchClient(events);
  const result = await discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-heartbeat-absent',
    inventory,
    documents,
    maxSourceChars,
    maxLabelCatalogChars: 40_000,
  });
  assert.equal(client.requests.length, 3, 'fixture assumption: this expediente must split into exactly three provider batches');
  assert.deepEqual(
    events.map(event => event.kind), ['provider_call', 'provider_call', 'provider_call'],
    'an existing caller that injects no hook must behave exactly as today: no extra call of any kind',
  );
  assert.equal(result.discoveryLedger.status, 'completed');
}

// ---------------------------------------------------------------------------------------------
// 1. The hook fires exactly once immediately BEFORE every batch's provider call — never once per
//    run, never after the response, never on a timer.
// ---------------------------------------------------------------------------------------------
{
  const events = [];
  const hookArguments = [];
  const client = fakeBatchClient(events);
  await discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-heartbeat-happy-path',
    inventory,
    documents,
    maxSourceChars,
    maxLabelCatalogChars: 40_000,
    beforeProviderCall: async (...args) => { hookArguments.push(args); events.push({ kind: 'before_provider_call' }); },
  });

  assert.equal(client.requests.length, 3, 'fixture assumption: this expediente must split into exactly three provider batches');
  assert.deepEqual(
    events.map(event => event.kind),
    ['before_provider_call', 'provider_call', 'before_provider_call', 'provider_call', 'before_provider_call', 'provider_call'],
    'beforeProviderCall must run exactly once immediately before each batch client call, strictly alternating with them',
  );
  assert.equal(
    hookArguments.length, client.requests.length,
    'the number of heartbeats must equal the number of provider calls: N provider turns need N renewals, not one per run',
  );

  // Whatever the hook is handed, it can never be a channel for expediente text or model content:
  // a renewal only ever needs safe identity.
  const hookJson = JSON.stringify(hookArguments);
  for (const text of [DOC_A_TEXT, DOC_B_TEXT, DOC_C_TEXT]) {
    assert.ok(!hookJson.includes(text.slice(0, 40)), 'the heartbeat hook must never receive expediente document text');
  }
}

// ---------------------------------------------------------------------------------------------
// 2. A rejecting hook fails closed: the provider call it guards is never made, the error the caller
//    threw survives unchanged (so the caller's own closed lease classification still works), and the
//    deterministic SAFE discovery ledger is still attached to it.
// ---------------------------------------------------------------------------------------------
{
  const events = [];
  const client = fakeBatchClient(events);
  const leaseLost = new Error('la reserva AGT-002 se perdio antes de la llamada al proveedor');
  leaseLost.code = 'AGT002_PREVIEW_LEASE_LOST';

  let heartbeats = 0;
  await assert.rejects(
    () => discoverTenderSemanticManifest({
      client,
      model: 'test-model',
      timeoutMs: 1000,
      idempotencyKey: 'idem-heartbeat-lease-lost',
      inventory,
      documents,
      maxSourceChars,
      maxLabelCatalogChars: 40_000,
      beforeProviderCall: async () => {
        heartbeats += 1;
        events.push({ kind: 'before_provider_call' });
        // The lease is reported lost at the SECOND stage boundary, so batch 0 has already completed
        // honestly and batch 1's provider call is the one that must never happen.
        if (heartbeats === 2) throw leaseLost;
      },
    }),
    error => {
      assert.equal(
        client.requests.length, 1,
        'a rejected heartbeat must prevent the provider call it guards: only batch 0 may ever have been sent',
      );
      assert.deepEqual(
        events.map(event => event.kind),
        ['before_provider_call', 'provider_call', 'before_provider_call'],
        'discovery must stop at the failed stage boundary instead of continuing into the guarded provider call',
      );
      assert.equal(error, leaseLost, "the caller's own error object must survive so its closed lease code still classifies downstream");

      const ledger = error.discoveryLedger;
      assert.ok(ledger, 'a heartbeat failure must still leave the deterministic safe discovery ledger behind, exactly like any other per-batch failure');
      assert.equal(ledger.status, 'failed');
      assert.equal(ledger.decision_ready, false, 'a run stopped by a lost lease can never be declared decision-ready');
      assert.equal(ledger.batches.length, 3, 'the ledger must account for every planned batch, including the ones never attempted');
      assert.equal(ledger.batches[0].status, 'completed', 'the batch that did complete before the lease was lost stays honestly completed');
      assert.equal(ledger.batches[1].status, 'failed', 'the batch whose guarded provider call never happened must be reported as failed, not pending');
      assert.equal(ledger.batches[2].status, 'pending', 'a batch this run never reached must be reported as pending');

      const ledgerJson = JSON.stringify(ledger);
      assert.ok(!ledgerJson.includes('la reserva AGT-002 se perdio'), 'the ledger must never carry the raw rejection message');
      for (const text of [DOC_A_TEXT, DOC_B_TEXT, DOC_C_TEXT]) {
        assert.ok(!ledgerJson.includes(text.slice(0, 40)), 'the ledger must never carry expediente document text');
      }
      return true;
    },
  );
}

// ---------------------------------------------------------------------------------------------
// 3. A rejection at the very FIRST stage boundary reaches no provider at all.
// ---------------------------------------------------------------------------------------------
{
  const events = [];
  const client = fakeBatchClient(events);
  const leaseLost = new Error('la reserva AGT-002 ya no existe');
  leaseLost.code = 'AGT002_PREVIEW_LEASE_LOST';

  await assert.rejects(
    () => discoverTenderSemanticManifest({
      client,
      model: 'test-model',
      timeoutMs: 1000,
      idempotencyKey: 'idem-heartbeat-lease-lost-first',
      inventory,
      documents,
      maxSourceChars,
      maxLabelCatalogChars: 40_000,
      beforeProviderCall: async () => { events.push({ kind: 'before_provider_call' }); throw leaseLost; },
    }),
    error => {
      assert.equal(client.requests.length, 0, 'a lease lost before the first batch must cost zero provider turns');
      assert.equal(error, leaseLost);
      assert.equal(error.discoveryLedger?.status, 'failed');
      assert.equal(error.discoveryLedger?.decision_ready, false);
      return true;
    },
  );
}

console.log('tests/tender-semantic-discovery-provider-call-heartbeat.test.mjs OK');
