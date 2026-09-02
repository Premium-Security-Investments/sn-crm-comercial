import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest, TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION } from '../tender-semantic-discovery.js';
import { TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION } from '../tender-semantic-discovery-batches.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';

// AGT-002 V3 multi-batch semantic discovery — REGRESSION (RED, no production fix yet).
//
// `sourcePacket` (tender-semantic-discovery.js) greedily fills ONE provider request up to
// `maxSourceChars`, then treats everything past that budget as `omitted`: never shown to the model
// at all, and silently completed into `unresolved` with `source_unit_not_dispositioned` by
// `canonicalizeProposal`'s v4 coverage completion. For an expediente whose text exceeds the budget,
// that means whole documents are never analyzed by the provider in a single discovery call — they
// are declared holes without ever being looked at, which is a different (and worse) fact than "the
// model looked and found nothing".
//
// This file pins the DESIRED behaviour: a corpus over the per-batch budget must be split into
// multiple provider requests (batches) so that every document eventually reaches the model, each
// source unit is sent exactly once across the batches, the batching is deterministic (repeat runs
// produce the same request/batch structure and idempotency keys), and the merged result is never
// falsely decision-ready while anything remains unaccounted for.
//
// Current production code makes exactly ONE provider call no matter the corpus size, so the very
// first assertion below — more than one request for an over-budget corpus — fails today. No
// production file is touched by this test.

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function document(id, text) {
  return { document_id: id, document_version_id: `${id}-v1`, content_hash: hash(text), extracted_text: text };
}

// Document A alone is sized to consume the whole injected budget (see `maxSourceChars` below,
// derived from A's own resolved text) so that, under the current greedy single-batch behaviour, A
// is entirely visible and B/C are entirely omitted from the provider request. Documents B and C sort
// after A by `document_id`, which is exactly the order `sourcePacket` uses.
const DOC_A_PARAGRAPHS = [
  'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria durante los ultimos anos consecutivos sin interrupciones documentadas por la entidad contratante.',
  'El contratista entregara un informe mensual de operaciones detallado dentro de los primeros dias habiles de cada mes calendario vigente del contrato suscrito.',
];
const DOC_B_PARAGRAPHS = [
  'El plazo de ejecucion del contrato sera contado a partir del acta de inicio suscrita por las partes involucradas en el proceso.',
];
const DOC_C_PARAGRAPHS = [
  'Queda prohibido subcontratar el servicio de monitoreo sin autorizacion previa y escrita de la entidad contratante responsable.',
];

const documents = [
  document('doc-a', DOC_A_PARAGRAPHS.join('\n\n')),
  document('doc-b', DOC_B_PARAGRAPHS.join('\n\n')),
  document('doc-c', DOC_C_PARAGRAPHS.join('\n\n')),
];

const SNAPSHOT = '77777777-7777-4777-8777-777777777003';
const inventory = buildTenderRequirementInventory({ snapshotId: SNAPSHOT, documents, documentGaps: [] });
assert.equal(
  inventory.source_units.length,
  DOC_A_PARAGRAPHS.length + DOC_B_PARAGRAPHS.length + DOC_C_PARAGRAPHS.length,
  'fixture must produce exactly one analyzable source unit per paragraph',
);

const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const allSourceUnitIds = [...resolvedTexts.keys()];
const unitsA = [...resolvedTexts.values()].filter(value => value.document_id === 'doc-a');
assert.equal(unitsA.length, DOC_A_PARAGRAPHS.length, 'fixture must resolve one source unit per doc-a paragraph');

// None of the fixture text contains digits, "@", or the other redaction triggers, so `redactText`
// is the identity on it — the raw resolved length is exactly what `sourcePacket` measures against
// the budget, with no risk of the budget arithmetic drifting from an opaque, unexported function.
const maxSourceChars = unitsA.reduce((total, value) => total + value.text.length, 0);
assert.ok(maxSourceChars > 0, 'fixture must yield a positive per-batch budget');

function fakeMultiCaptureClient() {
  const requests = [];
  return {
    requests,
    run: async request => {
      requests.push(request);
      const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
      // A locally valid proposal for THIS batch's own visible units/catalog: one requirement built
      // from the batch's own literal label enum, preserving the v6 wire contract exactly
      // ({kind, label, front, category} only) and leaving every other visible unit unlisted so the
      // server's own coverage completion (unchanged) disposes it as `unresolved`.
      const proposal = enumLabels.length
        ? { requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }], excluded: [], unresolved: [] }
        : { requirements: [], excluded: [], unresolved: [] };
      return { content: JSON.stringify(proposal), usage: { input_tokens: 5, output_tokens: 5 } };
    },
  };
}

const capture = fakeMultiCaptureClient();
const result = await discoverTenderSemanticManifest({
  client: capture,
  model: 'test-model',
  timeoutMs: 1000,
  idempotencyKey: 'idem-multibatch-presupuesto',
  inventory,
  documents,
  maxSourceChars,
  maxLabelCatalogChars: 40_000,
});

// 1. REQUIRED FIRST RED: a corpus above the per-batch budget must be split into more than one
// provider request. Today `discoverTenderSemanticManifest` calls `client.run` exactly once
// regardless of corpus size, so `capture.requests.length` is 1 here and this fails immediately.
assert.ok(capture.requests.length > 1, 'un expediente sobre el presupuesto debe producir múltiples lotes');

// 2. Every document must be represented in what the model actually SAW across the batches — not
// merely in the final manifest's silently-completed `unresolved` list.
const sentDocumentIds = new Set(capture.requests.flatMap(req => req.input.source_units.map(unit => unit.document_id)));
assert.deepEqual(
  [...sentDocumentIds].sort(),
  ['doc-a', 'doc-b', 'doc-c'],
  'cada documento del expediente debe llegar a alguna solicitud enviada al proveedor',
);

// 3. Every source unit is sent exactly once across all batches: no duplicate transmission, and no
// unit silently missing from every batch.
const sentUnitIds = capture.requests.flatMap(req => req.input.source_units.map(unit => unit.source_unit_id));
assert.deepEqual(
  [...sentUnitIds].sort(),
  [...allSourceUnitIds].sort(),
  'cada source_unit del expediente debe enviarse en algún lote',
);
assert.equal(
  new Set(sentUnitIds).size,
  sentUnitIds.length,
  'ninguna source_unit puede enviarse en más de un lote',
);

// 4. Idempotency: re-running the exact same expediente must produce the exact same batch structure
// (same per-batch `input`, same per-batch `idempotencyKey`), not merely the same final manifest.
const secondCapture = fakeMultiCaptureClient();
await discoverTenderSemanticManifest({
  client: secondCapture,
  model: 'test-model',
  timeoutMs: 1000,
  idempotencyKey: 'idem-multibatch-presupuesto',
  inventory,
  documents,
  maxSourceChars,
  maxLabelCatalogChars: 40_000,
});
assert.deepEqual(
  secondCapture.requests.map(req => ({ idempotencyKey: req.idempotencyKey, input: req.input })),
  capture.requests.map(req => ({ idempotencyKey: req.idempotencyKey, input: req.input })),
  'el mismo expediente debe producir la misma estructura de lotes y las mismas idempotencyKey en cada re-ejecución',
);

// 5. The merged result must never be falsely decision-ready while anything is unaccounted for: this
// fixture's fake client deliberately leaves every non-chosen unit undispositioned, so the run must
// stay paused rather than claiming readiness over units the model never actually resolved.
assert.equal(
  result.semanticManifest.decision_ready,
  false,
  'el manifiesto fusionado no puede quedar listo para decidir mientras existan unidades sin resolver',
);
assert.notEqual(
  result.semanticManifest.discovery_coverage.status,
  'complete',
  'la cobertura de descubrimiento no puede declararse completa mientras existan unidades sin resolver',
);

// 6. DISCOVERY LEDGER (HIGH): the merged result must carry a deterministic accounting of the batch
// plan itself — planner/policy identity, batch_count matching what was actually captured, total/
// assigned/failed accounting and one completed status per batch — not just the merged manifest, so a
// caller can tell HOW the corpus was split and THAT no unit was silently left out of the plan,
// independent of what the model answered in each batch. Current production computes this ledger
// internally (planTenderSemanticDiscoveryBatches, tender-semantic-discovery-batches.js) but never
// attaches it to discoverTenderSemanticManifest's return value, so `result.discoveryLedger` is
// `undefined` here and the very first assertion below fails.
assert.ok(result.discoveryLedger, 'el resultado debe incluir un discoveryLedger determinista del plan de lotes');
assert.equal(
  result.discoveryLedger.planner_version, TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION,
  'el ledger debe declarar la identidad determinista del planificador de lotes',
);
assert.equal(
  result.discoveryLedger.policy_version, TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
  'el ledger debe declarar la identidad determinista de la política de descubrimiento',
);
assert.equal(
  result.discoveryLedger.batch_count, capture.requests.length,
  'batch_count del ledger debe coincidir exactamente con el número de solicitudes realmente capturadas',
);
assert.equal(
  result.discoveryLedger.total_source_units, allSourceUnitIds.length,
  'total_source_units del ledger debe cubrir cada source_unit del expediente',
);
assert.equal(
  result.discoveryLedger.assigned_source_units, allSourceUnitIds.length,
  'assigned_source_units debe coincidir con total_source_units cuando ningún lote falla al planificarse',
);
assert.deepEqual(
  result.discoveryLedger.failed_source_units, [],
  'ninguna source_unit puede quedar fuera del plan de lotes en esta corrida exitosa',
);
assert.equal(
  result.discoveryLedger.batches.length, capture.requests.length,
  'debe existir una entrada de ledger por cada lote realmente enviado al proveedor',
);
result.discoveryLedger.batches.forEach((batchEntry, index) => {
  assert.equal(batchEntry.batch_index, index, 'los índices de lote del ledger deben ser consecutivos desde 0');
  assert.equal(batchEntry.status, 'completed', 'cada lote exitoso debe reportar estado completed en el ledger');
});
const ledgerUnitIds = result.discoveryLedger.batches.flatMap(batchEntry => batchEntry.source_unit_ids);
assert.deepEqual(
  [...ledgerUnitIds].sort(), [...allSourceUnitIds].sort(),
  'la unión de source_unit_ids del ledger debe cubrir exactamente el expediente entero, sin omisiones',
);

// ---------------------------------------------------------------------------------------------
// CODE-POINT ORDER (HIGH): document ids in the request the provider actually receives must be
// ordered by plain Unicode code points, never by locale collation. `orderedSourceUnits`
// (tender-semantic-discovery.js) currently sorts `document_id` with `String.prototype.localeCompare`,
// whose default Node/ICU collation treats letter case as a secondary key: it compares 'a' and 'Z' at
// primary strength (case-folded) and places 'a-doc' before 'Z-doc'. Plain code-point order does the
// opposite — 'Z' is U+005A and 'a' is U+0061, so 'Z-doc' sorts first — which is what this assertion
// requires. This fixture is independent of every other one in this file: a single small batch, one
// paragraph per document, large enough budget for both to share it, is all that is needed to observe
// the order the provider actually sees.
// ---------------------------------------------------------------------------------------------
{
  const orderDocuments = [
    document('Z-doc', 'El interventor debera verificar el cumplimiento de las especificaciones tecnicas contratadas por la entidad.'),
    document('a-doc', 'El proveedor entregara los bienes conforme al cronograma establecido en el contrato suscrito entre las partes.'),
  ];
  const SNAPSHOT_ORDER = '77777777-7777-4777-8777-777777777011';
  const orderInventory = buildTenderRequirementInventory({ snapshotId: SNAPSHOT_ORDER, documents: orderDocuments, documentGaps: [] });
  const orderResolvedTexts = resolveTenderInventorySourceTexts({ inventory: orderInventory, documents: orderDocuments });
  const orderBudget = [...orderResolvedTexts.values()].reduce((total, value) => total + value.text.length, 0);

  const orderCapture = fakeMultiCaptureClient();
  await discoverTenderSemanticManifest({
    client: orderCapture,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-order-code-point',
    inventory: orderInventory,
    documents: orderDocuments,
    maxSourceChars: orderBudget,
    maxLabelCatalogChars: 40_000,
  });

  assert.equal(orderCapture.requests.length, 1, 'ambos documentos deben caber en un único lote para esta prueba de orden');
  assert.deepEqual(
    orderCapture.requests[0].input.source_units.map(unit => unit.document_id),
    ['Z-doc', 'a-doc'],
    'el orden de document_id en la solicitud debe ser por punto de código Unicode puro, nunca por localeCompare',
  );
}

// ---------------------------------------------------------------------------------------------
// DISCOVERY LEDGER on a controlled failure (HIGH): a batch that fails after a real bridge response
// must still leave a deterministic, SAFE ledger behind — one completed batch, one failed batch
// tagged with a closed structural stage/code only, never raw model content or document text —
// attached to the thrown error itself, since the caller never receives a resolved `result` to read
// it from. Independent fixture: doc-fail-a's own text is sized to consume the whole budget alone
// (same round-major mechanics already proven in tests/tender-semantic-discovery-batching.test.mjs),
// forcing doc-fail-b's unit into a deterministic second batch.
// ---------------------------------------------------------------------------------------------
{
  const FAIL_DOC_A_TEXT = 'El supervisor debera radicar ante la entidad contratante el informe mensual de cumplimiento contractual dentro de los primeros dias habiles de cada periodo vigente del contrato suscrito entre las partes involucradas.';
  const FAIL_DOC_B_TEXT = 'El contratista garantizara disponibilidad continua del servicio contratado.';
  const failDocuments = [
    document('doc-fail-a', FAIL_DOC_A_TEXT),
    document('doc-fail-b', FAIL_DOC_B_TEXT),
  ];
  const SNAPSHOT_FAIL = '77777777-7777-4777-8777-777777777012';
  const failInventory = buildTenderRequirementInventory({ snapshotId: SNAPSHOT_FAIL, documents: failDocuments, documentGaps: [] });
  const failResolvedTexts = resolveTenderInventorySourceTexts({ inventory: failInventory, documents: failDocuments });
  const unitsFailA = [...failResolvedTexts.values()].filter(value => value.document_id === 'doc-fail-a');
  const failBudget = unitsFailA.reduce((total, value) => total + value.text.length, 0);

  function fakeFailingClient() {
    const requests = [];
    let callIndex = 0;
    return {
      requests,
      run: async request => {
        const batchIndex = callIndex;
        callIndex += 1;
        requests.push(request);
        if (batchIndex === 0) {
          const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
          const proposal = enumLabels.length
            ? { requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }], excluded: [], unresolved: [] }
            : { requirements: [], excluded: [], unresolved: [] };
          return { content: JSON.stringify(proposal), usage: { input_tokens: 5, output_tokens: 5 } };
        }
        return { content: '{not valid json', usage: { input_tokens: 5, output_tokens: 5 } };
      },
    };
  }

  const failClient = fakeFailingClient();
  await assert.rejects(
    () => discoverTenderSemanticManifest({
      client: failClient,
      model: 'test-model',
      timeoutMs: 1000,
      idempotencyKey: 'idem-multibatch-ledger-failure',
      inventory: failInventory,
      documents: failDocuments,
      maxSourceChars: failBudget,
      maxLabelCatalogChars: 40_000,
    }),
    error => {
      assert.equal(failClient.requests.length, 2, 'el lote 1 inválido sólo puede observarse después de que el lote 0 fue enviado');
      assert.ok(error.discoveryLedger, 'el error de un lote fallido debe cargar el discoveryLedger hasta el punto de la falla');
      assert.equal(error.discoveryLedger.decision_ready, false, 'un ledger con un lote fallido nunca puede declarar la corrida lista para decidir');
      assert.equal(error.discoveryLedger.status, 'failed', 'el estado agregado del ledger debe reflejar el lote fallido');
      assert.equal(error.discoveryLedger.batches.length, 2, 'el ledger debe registrar una entrada por cada lote intentado, incluido el que falló');
      const [batch0, batch1] = error.discoveryLedger.batches;
      assert.equal(batch0.batch_index, 0);
      assert.equal(batch0.status, 'completed', 'el primer lote sí respondió y fue canonicalizado con éxito');
      assert.equal(batch1.batch_index, 1);
      assert.equal(batch1.status, 'failed', 'el segundo lote debe quedar marcado como fallido en el ledger');
      assert.equal(batch1.stage, AGT002_OUTPUT_REJECTION_STAGES.JSON_PARSE, 'la etapa del fallo debe ser el código cerrado existente, no uno nuevo ni libre');
      assert.equal(batch1.code, 'v4_discovery_invalid_json', 'el código del fallo debe ser el código cerrado existente de JSON inválido');
      const batch1Json = JSON.stringify(batch1);
      assert.ok(!batch1Json.includes('not valid json'), 'el ledger jamás debe cargar el contenido crudo devuelto por el modelo');
      assert.ok(!batch1Json.includes('El contratista'), 'el ledger jamás debe cargar texto del documento del expediente');
      return true;
    },
  );
}

// ---------------------------------------------------------------------------------------------
// USAGE/COST — deterministic sum across batches (MEDIUM). Independent two-batch fixture (same
// forced-split mechanics as above): each batch's fake client reports its own deterministic
// `cost_usd`, and the merged `result.usage` must sum input_tokens, output_tokens AND cost_usd across
// every batch. Current production's `requireUsage`/usage reducer never reads or aggregates
// `cost_usd` at all, so `result.usage.cost_usd` is `undefined` here.
// ---------------------------------------------------------------------------------------------
{
  const COST_DOC_A_TEXT = 'El operador debera mantener actualizado permanentemente el registro de novedades operativas del servicio de vigilancia prestado durante toda la vigencia del contrato suscrito.';
  const COST_DOC_B_TEXT = 'El contratista suministrara los elementos de proteccion personal requeridos.';
  const costDocuments = [
    document('doc-cost-a', COST_DOC_A_TEXT),
    document('doc-cost-b', COST_DOC_B_TEXT),
  ];
  const SNAPSHOT_COST = '77777777-7777-4777-8777-777777777013';
  const costInventory = buildTenderRequirementInventory({ snapshotId: SNAPSHOT_COST, documents: costDocuments, documentGaps: [] });
  const costResolvedTexts = resolveTenderInventorySourceTexts({ inventory: costInventory, documents: costDocuments });
  const unitsCostA = [...costResolvedTexts.values()].filter(value => value.document_id === 'doc-cost-a');
  const costBudget = unitsCostA.reduce((total, value) => total + value.text.length, 0);

  const BATCH_COSTS_USD = [0.0123, 0.0045];
  const BATCH_INPUT_TOKENS = [10, 11];
  const BATCH_OUTPUT_TOKENS = [4, 5];
  function fakeCostClient() {
    const requests = [];
    let callIndex = 0;
    return {
      requests,
      run: async request => {
        const batchIndex = callIndex;
        callIndex += 1;
        requests.push(request);
        const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
        const proposal = enumLabels.length
          ? { requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }], excluded: [], unresolved: [] }
          : { requirements: [], excluded: [], unresolved: [] };
        return {
          content: JSON.stringify(proposal),
          usage: {
            input_tokens: BATCH_INPUT_TOKENS[batchIndex],
            output_tokens: BATCH_OUTPUT_TOKENS[batchIndex],
            cost_usd: BATCH_COSTS_USD[batchIndex],
          },
        };
      },
    };
  }

  const costClient = fakeCostClient();
  const costResult = await discoverTenderSemanticManifest({
    client: costClient,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-multibatch-cost-sum',
    inventory: costInventory,
    documents: costDocuments,
    maxSourceChars: costBudget,
    maxLabelCatalogChars: 40_000,
  });

  assert.equal(costClient.requests.length, 2, 'esta prueba de costo requiere exactamente dos lotes capturados');
  assert.equal(
    costResult.usage.input_tokens, BATCH_INPUT_TOKENS[0] + BATCH_INPUT_TOKENS[1],
    'usage.input_tokens debe ser la suma de input_tokens de cada lote',
  );
  assert.equal(
    costResult.usage.output_tokens, BATCH_OUTPUT_TOKENS[0] + BATCH_OUTPUT_TOKENS[1],
    'usage.output_tokens debe ser la suma de output_tokens de cada lote',
  );
  assert.equal(
    costResult.usage.cost_usd, BATCH_COSTS_USD[0] + BATCH_COSTS_USD[1],
    'usage.cost_usd debe ser la suma exacta del costo informado por cada lote',
  );
}

// ---------------------------------------------------------------------------------------------
// USAGE/COST — unknown never becomes silently zero (MEDIUM). Independent two-batch fixture where
// one batch's usage omits `cost_usd` entirely (a real, honest gap in provider billing data, not a
// zero-cost batch). The aggregate `result.usage.cost_usd` must become `null` (unknown), never `0`
// and never merely the other batch's own cost.
// ---------------------------------------------------------------------------------------------
{
  const COSTNULL_DOC_A_TEXT = 'El interventor verificara mensualmente el cumplimiento de las metas tecnicas y financieras establecidas en el contrato de vigilancia suscrito entre las partes involucradas.';
  const COSTNULL_DOC_B_TEXT = 'El contratista dispondra de personal de reemplazo inmediato ante ausencias.';
  const nullCostDocuments = [
    document('doc-costnull-a', COSTNULL_DOC_A_TEXT),
    document('doc-costnull-b', COSTNULL_DOC_B_TEXT),
  ];
  const SNAPSHOT_COSTNULL = '77777777-7777-4777-8777-777777777014';
  const nullCostInventory = buildTenderRequirementInventory({ snapshotId: SNAPSHOT_COSTNULL, documents: nullCostDocuments, documentGaps: [] });
  const nullCostResolvedTexts = resolveTenderInventorySourceTexts({ inventory: nullCostInventory, documents: nullCostDocuments });
  const unitsNullCostA = [...nullCostResolvedTexts.values()].filter(value => value.document_id === 'doc-costnull-a');
  const nullCostBudget = unitsNullCostA.reduce((total, value) => total + value.text.length, 0);

  function fakeMixedCostClient() {
    const requests = [];
    let callIndex = 0;
    return {
      requests,
      run: async request => {
        const batchIndex = callIndex;
        callIndex += 1;
        requests.push(request);
        const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
        const proposal = enumLabels.length
          ? { requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }], excluded: [], unresolved: [] }
          : { requirements: [], excluded: [], unresolved: [] };
        const usage = batchIndex === 0
          ? { input_tokens: 8, output_tokens: 3, cost_usd: 0.02 }
          // Deliberately omits cost_usd: an honest "the provider did not report a cost for this
          // batch", not a zero-cost batch.
          : { input_tokens: 6, output_tokens: 2 };
        return { content: JSON.stringify(proposal), usage };
      },
    };
  }

  const mixedCostClient = fakeMixedCostClient();
  const mixedCostResult = await discoverTenderSemanticManifest({
    client: mixedCostClient,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-multibatch-cost-unknown',
    inventory: nullCostInventory,
    documents: nullCostDocuments,
    maxSourceChars: nullCostBudget,
    maxLabelCatalogChars: 40_000,
  });

  assert.equal(mixedCostClient.requests.length, 2, 'esta prueba de costo desconocido requiere exactamente dos lotes capturados');
  assert.equal(
    mixedCostResult.usage.cost_usd, null,
    'si algún lote no informa cost_usd, el costo agregado debe quedar null (desconocido), nunca cero silencioso',
  );
}

console.log('tests/tender-semantic-discovery-multibatch-regression.test.mjs OK');
