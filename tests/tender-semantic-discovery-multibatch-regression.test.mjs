import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest } from '../tender-semantic-discovery.js';

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

console.log('tests/tender-semantic-discovery-multibatch-regression.test.mjs OK');
