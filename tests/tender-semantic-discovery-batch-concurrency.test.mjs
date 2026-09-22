// AGT-002 durable resumed job — bounded batch concurrency for semantic discovery (RED, no
// production change). `discoverTenderSemanticManifest`'s batch loop (tender-semantic-discovery.js)
// is a plain sequential `for (const batch of batches) { await ... }`: it accepts no
// `batchConcurrency` option at all today, so every assertion below that depends on two batches
// being IN FLIGHT AT ONCE fails against current production — either as a direct assertion failure
// or, where the test can only observe "did batch N start", as a bounded timeout (see `withTimeout`)
// so a still-sequential implementation fails fast instead of hanging the run forever.
//
// Every fixture below uses REAL deferred promises (manually resolved by the test, never a fixed
// `setTimeout` delay) to control exactly when each batch's fake `client.run` resolves, so ordering
// scenarios (batch 1 finishing before batch 0, batch 0 failing while batch 1 is already in flight)
// are deterministic rather than timing-dependent. No production file is touched by this test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest } from '../tender-semantic-discovery.js';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function document(id, text) {
  return { document_id: id, document_version_id: `${id}-v1`, content_hash: hash(text), extracted_text: text };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Resolves true if `predicate()` becomes true within `timeoutMs`, false otherwise — used only to
// observe test-side side effects (e.g. checkpoint writes) that happen on a microtask chain this
// test does not otherwise control a gate for.
async function waitUntil(predicate, timeoutMs = 500, intervalMs = 5) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return true;
}

// Asserts `predicate()` stays false for a short grace window — used to prove something did NOT
// happen (e.g. a third batch starting while only two concurrency slots exist) rather than merely
// that it hadn't happened yet at the instant of the check.
async function assertStaysFalse(predicate, graceMs, message) {
  await new Promise(resolve => setTimeout(resolve, graceMs));
  assert.equal(predicate(), false, message);
}

function successProposal(request) {
  const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
  return enumLabels.length
    ? { requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }], excluded: [], unresolved: [] }
    : { requirements: [], excluded: [], unresolved: [] };
}

// A client whose `run` records when each batch STARTS (synchronously, before awaiting anything)
// and only resolves once the test explicitly releases that batch's own deferred gate.
function fakeGatedClient({ order, startedGates, resolveGates, failBatchIndexes = new Set() }) {
  const requests = [];
  return {
    requests,
    run: async request => {
      const batchIndex = request.input.batch.index;
      requests.push(request);
      order.push({ kind: 'start', batchIndex });
      startedGates[batchIndex].resolve();
      await resolveGates[batchIndex].promise;
      order.push({ kind: 'settle', batchIndex });
      if (failBatchIndexes.has(batchIndex)) {
        throw Object.assign(new Error(`fallo simulado del proveedor en el lote ${batchIndex}`), { code: 'SIMULATED_PROVIDER_FAILURE' });
      }
      return { content: JSON.stringify(successProposal(request)), usage: { input_tokens: 5, output_tokens: 5 } };
    },
  };
}

function fakeCheckpointHooks(writes) {
  return {
    loadCheckpoint: async () => ({ hit: false }),
    storeCheckpoint: async entry => { writes.push(entry); },
  };
}

// --- Fixtures -----------------------------------------------------------------------------------
// Same forced-split mechanics already proven in tests/tender-semantic-discovery-multibatch-regression.test.mjs
// and tests/tender-semantic-discovery-provider-call-heartbeat.test.mjs: doc *-a's own text alone
// consumes the whole per-batch budget, so the round-major planner closes it as its own batch before
// any other document can contribute, forcing every later document into its own later batch.
const DOC_A_TEXT = 'El oferente debera acreditar experiencia especifica y verificable en la prestacion continua del servicio de vigilancia hospitalaria, aportando certificaciones expedidas por las entidades contratantes correspondientes, en las cuales conste el objeto contractual ejecutado, el plazo real de ejecucion y la calificacion final obtenida por el contratista durante toda la vigencia del contrato suscrito.';
const DOC_B_TEXT = 'El contratista entregara un informe mensual de operaciones debidamente detallado y suscrito por el supervisor designado, dentro de los primeros dias habiles de cada mes calendario de la vigencia contractual acordada entre las partes.';
const DOC_C_TEXT = 'Queda expresamente prohibido subcontratar total o parcialmente el servicio de monitoreo electronico sin autorizacion previa, expresa y escrita de la entidad contratante responsable de la supervision del contrato suscrito.';

function buildFixture(documents, snapshotId) {
  const inventory = buildTenderRequirementInventory({ snapshotId, documents, documentGaps: [] });
  const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
  const unitsA = [...resolvedTexts.values()].filter(value => value.document_id === documents[0].document_id);
  const maxSourceChars = unitsA.reduce((total, value) => total + value.text.length, 0);
  assert.ok(maxSourceChars > 0, 'fixture must yield a positive per-batch budget');
  return { inventory, documents, maxSourceChars };
}

const TWO_BATCH = buildFixture(
  [document('doc-conc2-a', DOC_A_TEXT), document('doc-conc2-b', DOC_B_TEXT)],
  '77777777-7777-4777-8777-777777777031',
);
const THREE_BATCH = buildFixture(
  [document('doc-conc3-a', DOC_A_TEXT), document('doc-conc3-b', DOC_B_TEXT), document('doc-conc3-c', DOC_C_TEXT)],
  '77777777-7777-4777-8777-777777777032',
);
const SINGLE_BATCH = buildFixture(
  [document('doc-conc1-a', 'Este es un texto minimo suficiente para una unica source_unit de la prueba de concurrencia invalida.')],
  '77777777-7777-4777-8777-777777777033',
);
// Generous budget so the single tiny document never splits — only used to reach the option
// validation boundary, never an actual provider call.
SINGLE_BATCH.maxSourceChars = 10_000;

function baseArgs(fixture, idempotencyKey) {
  return {
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey,
    inventory: fixture.inventory,
    documents: fixture.documents,
    maxSourceChars: fixture.maxSourceChars,
    maxLabelCatalogChars: 40_000,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. batchConcurrency=2 starts at most two provider calls before either resolves — proves max
//    active == 2, over a THREE-batch corpus so a naive "just run everything in parallel" fix would
//    also be caught (batch 2 must stay held back until a slot frees).
// ---------------------------------------------------------------------------------------------
{
  const order = [];
  const startedGates = [deferred(), deferred(), deferred()];
  const resolveGates = [deferred(), deferred(), deferred()];
  const client = fakeGatedClient({ order, startedGates, resolveGates });

  const resultPromise = discoverTenderSemanticManifest({
    ...baseArgs(THREE_BATCH, 'idem-concurrency-max-active'),
    client,
    batchConcurrency: 2,
  });

  await withTimeout(
    Promise.all([startedGates[0].promise, startedGates[1].promise]),
    500,
    'RED: con batchConcurrency=2 deben iniciarse los lotes 0 y 1 antes de que cualquiera resuelva; la implementación actual es secuencial y nunca inicia el lote 1 aquí',
  );
  assert.deepEqual(
    order, [{ kind: 'start', batchIndex: 0 }, { kind: 'start', batchIndex: 1 }],
    'deben iniciarse exactamente los lotes 0 y 1 antes de que cualquiera resuelva, nunca el lote 2 primero',
  );

  let batch2StartedEarly = false;
  startedGates[2].promise.then(() => { batch2StartedEarly = true; });
  await assertStaysFalse(
    () => batch2StartedEarly, 80,
    'el lote 2 no debe iniciarse mientras dos lotes ya están activos con batchConcurrency=2 (máximo activo == 2)',
  );

  resolveGates[0].resolve();
  resolveGates[1].resolve();
  await withTimeout(startedGates[2].promise, 500, 'el lote 2 debe iniciarse en cuanto se libera un cupo de concurrencia');
  resolveGates[2].resolve();

  const result = await withTimeout(resultPromise, 1000, 'el descubrimiento con batchConcurrency=2 debe completarse tras liberar los tres lotes');
  assert.equal(client.requests.length, 3);
  assert.equal(result.discoveryLedger.status, 'completed');
}

// ---------------------------------------------------------------------------------------------
// 2. Out-of-order completion: batch 1 resolves before batch 0, but checkpoint writes must still be
//    strictly ordered [0, 1] — never written in completion order.
// ---------------------------------------------------------------------------------------------
{
  const order = [];
  const startedGates = [deferred(), deferred()];
  const resolveGates = [deferred(), deferred()];
  const client = fakeGatedClient({ order, startedGates, resolveGates });
  const writes = [];

  const resultPromise = discoverTenderSemanticManifest({
    ...baseArgs(TWO_BATCH, 'idem-concurrency-out-of-order'),
    client,
    batchConcurrency: 2,
    checkpointHooks: fakeCheckpointHooks(writes),
  });

  await withTimeout(
    Promise.all([startedGates[0].promise, startedGates[1].promise]),
    500,
    'RED: ambos lotes deben iniciarse con batchConcurrency=2 antes de resolver ninguno',
  );

  // Resolve batch 1 FIRST while batch 0 is still pending.
  resolveGates[1].resolve();
  const batch1SettledFirst = await waitUntil(() => order.some(entry => entry.kind === 'settle' && entry.batchIndex === 1));
  assert.ok(batch1SettledFirst, 'el lote 1 debe poder resolverse en el proveedor antes que el lote 0');

  // Even though batch 1 already settled at the provider, it must not be checkpointed while batch 0
  // is still outstanding.
  assert.equal(
    writes.filter(entry => entry.batchIndex === 1).length, 0,
    'el lote 1 no debe checkpointearse mientras el lote 0, de menor índice, sigue pendiente',
  );

  resolveGates[0].resolve();
  // Filter to per-batch checkpoints only: the final merged checkpoint also uses stage
  // 'semantic_manifest' with batchIndex 0 (see tender-semantic-discovery.js), so counting/mapping
  // raw `writes` here could pick it up as a spurious third (or repeated-index) entry once the run
  // completes and the merge stores that final checkpoint.
  const batchWrites = () => writes.filter(entry => entry.stage === 'semantic_discovery_batch');
  const bothWritten = await waitUntil(() => batchWrites().length >= 2);
  assert.ok(bothWritten, 'ambos lotes deben terminar checkpointeados una vez que el lote 0 también se libera');
  assert.deepEqual(
    batchWrites().map(entry => entry.batchIndex), [0, 1],
    'los checkpoints por lote deben escribirse en orden estricto de índice de lote [0, 1], nunca en orden de finalización',
  );

  const result = await withTimeout(resultPromise, 1000, 'el descubrimiento debe completarse tras liberar ambos lotes');
  assert.equal(result.discoveryLedger.status, 'completed');
}

// ---------------------------------------------------------------------------------------------
// 3. Lower batch fails while a higher batch is already in flight: the higher batch's result must be
//    awaited/settled (no unhandled rejection, no hang) but never checkpointed and never surfaced as
//    a completed entry in the discovery ledger.
// ---------------------------------------------------------------------------------------------
{
  const order = [];
  const startedGates = [deferred(), deferred()];
  const resolveGates = [deferred(), deferred()];
  const client = fakeGatedClient({ order, startedGates, resolveGates, failBatchIndexes: new Set([0]) });
  const writes = [];

  let unhandled = null;
  const onUnhandledRejection = reason => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    const resultPromise = discoverTenderSemanticManifest({
      ...baseArgs(TWO_BATCH, 'idem-concurrency-lower-fails'),
      client,
      batchConcurrency: 2,
      checkpointHooks: fakeCheckpointHooks(writes),
    });
    // Prevent Node from ever seeing this as an unhandled rejection itself; the assertion below
    // reads the settled outcome explicitly instead.
    resultPromise.catch(() => {});

    await withTimeout(
      Promise.all([startedGates[0].promise, startedGates[1].promise]),
      500,
      'RED: ambos lotes deben iniciarse con batchConcurrency=2 antes de fallar el lote 0',
    );

    // Batch 1 (higher) completes successfully first, while batch 0 (lower) is still pending.
    resolveGates[1].resolve();
    const batch1Settled = await waitUntil(() => order.some(entry => entry.kind === 'settle' && entry.batchIndex === 1));
    assert.ok(batch1Settled, 'el lote 1 debe poder resolverse en el proveedor mientras el lote 0 sigue pendiente');

    // Now fail the lower batch.
    resolveGates[0].resolve();

    await assert.rejects(
      () => withTimeout(resultPromise, 500, 'la corrida debe fallar (nunca colgarse) una vez que el lote 0 falla y el lote 1 ya resolvió'),
      error => {
        assert.equal(error.code, 'SIMULATED_PROVIDER_FAILURE', 'la falla del lote 0, de menor índice, debe ser la que determina el resultado de la corrida');
        assert.equal(
          writes.filter(entry => entry.batchIndex === 1).length, 0,
          'el lote 1, aunque ya resuelto en el proveedor, nunca debe checkpointearse si el lote 0 falló',
        );
        const ledger = error.discoveryLedger;
        assert.ok(ledger, 'el error debe cargar el discoveryLedger determinista hasta el punto de la falla');
        const batch1Entry = ledger.batches.find(entry => entry.batch_index === 1);
        assert.notEqual(
          batch1Entry?.status, 'completed',
          'el lote 1 no debe surgir como completado/progreso en el ledger aunque ya haya resuelto en el proveedor',
        );
        return true;
      },
    );

    // Give the event loop a moment to surface any unhandled rejection from a dangling (never
    // awaited) batch-1 promise before asserting there was none.
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(
      unhandled, null,
      'el resultado ya iniciado del lote superior debe ser esperado (awaited/settled) por el módulo, nunca dejado como una promesa no manejada',
    );
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Regression: callers that omit batchConcurrency keep the exact sequential behaviour they have
//    today — batch 1 must never start before batch 0 resolves.
// ---------------------------------------------------------------------------------------------
{
  const order = [];
  const startedGates = [deferred(), deferred(), deferred()];
  const resolveGates = [deferred(), deferred(), deferred()];
  const client = fakeGatedClient({ order, startedGates, resolveGates });

  const resultPromise = discoverTenderSemanticManifest({
    ...baseArgs(THREE_BATCH, 'idem-concurrency-default-sequential'),
    client,
    // batchConcurrency intentionally omitted.
  });

  await withTimeout(startedGates[0].promise, 500, 'el lote 0 debe iniciarse de inmediato');

  let batch1StartedEarly = false;
  startedGates[1].promise.then(() => { batch1StartedEarly = true; });
  await assertStaysFalse(
    () => batch1StartedEarly, 80,
    'sin batchConcurrency, el lote 1 no debe iniciarse mientras el lote 0 sigue en curso (concurrencia por defecto == 1)',
  );

  resolveGates[0].resolve();
  await withTimeout(startedGates[1].promise, 500, 'el lote 1 debe iniciarse tras resolverse el lote 0');
  resolveGates[1].resolve();
  await withTimeout(startedGates[2].promise, 500, 'el lote 2 debe iniciarse tras resolverse el lote 1');
  resolveGates[2].resolve();

  await withTimeout(resultPromise, 1000, 'el descubrimiento secuencial por defecto debe completarse tras liberar los tres lotes');
  assert.deepEqual(
    order.map(entry => `${entry.kind}:${entry.batchIndex}`),
    ['start:0', 'settle:0', 'start:1', 'settle:1', 'start:2', 'settle:2'],
    'sin la opción, el orden debe seguir siendo estrictamente secuencial: iniciar y resolver un lote antes de iniciar el siguiente',
  );
}

// ---------------------------------------------------------------------------------------------
// 5. Fail closed for any batchConcurrency other than the integers 1 or 2 — never silently coerced,
//    never silently clamped, and never reaching a provider call.
// ---------------------------------------------------------------------------------------------
{
  const invalidValues = [0, 3, -1, 1.5, NaN, '2', null, true];
  for (const batchConcurrency of invalidValues) {
    const client = {
      run: async () => { throw new Error(`client.run must never be called for invalid batchConcurrency ${JSON.stringify(batchConcurrency)}`); },
    };
    await assert.rejects(
      () => discoverTenderSemanticManifest({
        ...baseArgs(SINGLE_BATCH, `idem-concurrency-invalid-${JSON.stringify(batchConcurrency)}`),
        client,
        batchConcurrency,
      }),
      /no está configurado/,
      `batchConcurrency=${JSON.stringify(batchConcurrency)} debe fallar cerrado sin invocar al proveedor`,
    );
  }

  // Sanity: the two allowed integers must NOT be rejected by option validation (the run may still
  // legitimately proceed to call the provider for these).
  for (const batchConcurrency of [1, 2]) {
    const client = { run: async request => ({ content: JSON.stringify(successProposal(request)), usage: { input_tokens: 1, output_tokens: 1 } }) };
    await discoverTenderSemanticManifest({
      ...baseArgs(SINGLE_BATCH, `idem-concurrency-valid-${batchConcurrency}`),
      client,
      batchConcurrency,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Three-batch regression: batch 0 succeeds/commits, freeing a concurrency slot so batch 2 starts
//    while batch 1 is still pending; batch 2 then resolves successfully at the provider BEFORE
//    batch 1; but batch 1 (the lower, still-outstanding batch) then fails. Only batch 0's checkpoint
//    may ever be persisted; batch 2 must be awaited/settled (no unhandled rejection, no hang) yet
//    never checkpointed or surfaced as completed in the ledger; batch 1's error must be the one that
//    determines the run's failure.
// ---------------------------------------------------------------------------------------------
{
  const order = [];
  const startedGates = [deferred(), deferred(), deferred()];
  const resolveGates = [deferred(), deferred(), deferred()];
  const client = fakeGatedClient({ order, startedGates, resolveGates, failBatchIndexes: new Set([1]) });
  const writes = [];

  let unhandled = null;
  const onUnhandledRejection = reason => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    const resultPromise = discoverTenderSemanticManifest({
      ...baseArgs(THREE_BATCH, 'idem-concurrency-batch2-before-batch1-fails'),
      client,
      batchConcurrency: 2,
      checkpointHooks: fakeCheckpointHooks(writes),
    });
    // Prevent Node from ever seeing this as an unhandled rejection itself; the assertion below
    // reads the settled outcome explicitly instead.
    resultPromise.catch(() => {});

    await withTimeout(
      Promise.all([startedGates[0].promise, startedGates[1].promise]),
      500,
      'RED: con batchConcurrency=2 deben iniciarse los lotes 0 y 1 antes de resolver ninguno',
    );

    // Only per-batch checkpoints, excluding the final merged 'semantic_manifest' checkpoint that a
    // successful run stores at the end (see the note in scenario 2 above).
    const batchWrites = () => writes.filter(entry => entry.stage === 'semantic_discovery_batch');

    // Batch 0 succeeds and commits, freeing a concurrency slot, so batch 2 must start while batch 1
    // is still pending.
    resolveGates[0].resolve();
    const batch0Checkpointed = await waitUntil(() => batchWrites().some(entry => entry.batchIndex === 0));
    assert.ok(batch0Checkpointed, 'el lote 0 debe checkpointearse en cuanto resuelve, sin esperar al lote 1');

    await withTimeout(
      startedGates[2].promise, 500,
      'RED: el lote 2 debe iniciarse en cuanto el lote 0 libera un cupo de concurrencia, mientras el lote 1 sigue pendiente',
    );

    // Batch 2 (higher index) resolves successfully at the provider BEFORE batch 1 (lower index,
    // still pending).
    resolveGates[2].resolve();
    const batch2Settled = await waitUntil(() => order.some(entry => entry.kind === 'settle' && entry.batchIndex === 2));
    assert.ok(batch2Settled, 'el lote 2 debe poder resolverse en el proveedor mientras el lote 1 sigue pendiente');
    assert.equal(
      batchWrites().filter(entry => entry.batchIndex === 2).length, 0,
      'el lote 2 no debe checkpointearse mientras el lote 1, de menor índice, sigue pendiente',
    );

    // Now fail the still-pending, lower-index batch 1.
    resolveGates[1].resolve();

    await assert.rejects(
      () => withTimeout(resultPromise, 500, 'la corrida debe fallar (nunca colgarse) una vez que el lote 1 falla y el lote 2 ya resolvió'),
      error => {
        assert.equal(
          error.code, 'SIMULATED_PROVIDER_FAILURE',
          'la falla del lote 1, de menor índice entre los pendientes, debe ser la que determina el resultado de la corrida',
        );
        assert.deepEqual(
          batchWrites().map(entry => entry.batchIndex), [0],
          'sólo el checkpoint del lote 0 debe persistirse; ni el lote 1 (falló) ni el lote 2 (de mayor índice, nunca liberado tras la falla del lote 1) deben checkpointearse',
        );
        const ledger = error.discoveryLedger;
        assert.ok(ledger, 'el error debe cargar el discoveryLedger determinista hasta el punto de la falla');
        const batch0Entry = ledger.batches.find(entry => entry.batch_index === 0);
        assert.equal(batch0Entry?.status, 'completed', 'el lote 0 debe surgir como completado en el ledger');
        const batch1Entry = ledger.batches.find(entry => entry.batch_index === 1);
        assert.notEqual(batch1Entry?.status, 'completed', 'el lote 1 falló y no debe surgir como completado en el ledger');
        const batch2Entry = ledger.batches.find(entry => entry.batch_index === 2);
        assert.notEqual(
          batch2Entry?.status, 'completed',
          'el lote 2 no debe surgir como completado/en progreso en el ledger aunque ya haya resuelto en el proveedor antes que el lote 1',
        );
        return true;
      },
    );

    // Give the event loop a moment to surface any unhandled rejection from a dangling (never
    // awaited) batch-2 promise before asserting there was none.
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(
      unhandled, null,
      'el resultado ya iniciado del lote 2 debe ser esperado (awaited/settled) por el módulo, nunca dejado como una promesa no manejada',
    );
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
}

console.log('tests/tender-semantic-discovery-batch-concurrency.test.mjs OK');
