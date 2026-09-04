import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS,
  TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
} from '../tender-semantic-discovery.js';
import {
  planTenderSemanticDiscoveryBatches,
  computeTenderSemanticDiscoveryBatchHash,
  tenderSemanticDiscoveryBatchIdempotencyKey,
  TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION,
} from '../tender-semantic-discovery-batches.js';
import { buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';

// AGT-002 V3 semantic discovery, policy v9 — batch-size remediation for two observed real
// Procuraduria timeout attempts. Offline replay of the exact frozen 13-document snapshot from
// those attempts through the official batch planner showed the timing-out batch (batch 2,
// serialized request chars 320041) was the third attempted request and timed out twice; it was
// not the largest batch the previous default (`maxSourceChars = 40_000`) produced — that plan's
// actual maximum was a different batch, at 353001 chars. The same snapshot at
// `maxSourceChars = 20_000` plans more, smaller batches (35 instead of 18) and brings the maximum
// serialized request down to 199057 chars. This file pins the product change with a synthetic
// corpus (no network, no provider, no DB) instead of replaying the real snapshot:
//
//   1. the exported default is exactly 20_000, half the previous 40_000;
//   2. the policy version moved to v9, because both the model-facing batch plan and the per-batch
//      idempotency identity change under the new default;
//   3. a synthetic corpus above 20_000 chars, run through `discoverTenderSemanticManifest` WITHOUT
//      an explicit `maxSourceChars` (so the new default governs), produces more than one sequential
//      provider call, and every source unit the planner could assign is sent in exactly one of those
//      calls — the same corpus plans strictly fewer, larger batches at the old 40_000 budget, which
//      is the size reduction this remediation exists to produce;
//   4. the merged run's own `discoveryLedger` accounts for every unit as assigned or explicitly
//      failed (never silently short), matching the planner's own ledger;
//   5. the per-batch idempotency identity stays deterministic across a repeat run, and differs from
//      what the same batch would hash to under a literal 'tender-semantic-discovery.v8' policy
//      version — a response reserved under v8 must never be replayed for a v9 request.

const hash = value => createHash('sha256').update(value).digest('hex');
function document(id, text) {
  return {
    document_id: id,
    document_version_id: `${id}-v1`,
    opportunity_id: '11111111-2222-4333-8444-777777777777',
    snapshot_id: null,
    document_type: 'pliego',
    name: `${id}.pdf`,
    version: 1,
    content_hash: hash(text),
    current: true,
    extracted_text: text,
  };
}

// Deliberately no digits anywhere in the generated text: `redactText` (tender-semantic-discovery.js)
// treats digit runs as potential cedula/phone content, and this fixture's char counts must equal the
// raw resolved text length with no redaction rewriting it.
const WORDS = [
  'alfa', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa',
  'lambda', 'omicron', 'sigma', 'tau', 'upsilon', 'psi', 'omega', 'rho', 'phi', 'chi',
  'norte', 'sur', 'oriente', 'occidente',
];
function tagFor(globalIndex) {
  return `${WORDS[globalIndex % WORDS.length]} ${WORDS[Math.floor(globalIndex / WORDS.length) % WORDS.length]}`;
}
function paragraphFor(globalIndex) {
  return 'El interventor debera verificar el cumplimiento pleno de las especificaciones tecnicas '
    + `contratadas por la entidad, correspondientes a la unidad marcador ${tagFor(globalIndex)}, dentro `
    + 'del expediente sometido a revision documental exhaustiva y permanente durante toda la vigencia '
    + 'del contrato suscrito entre las partes involucradas en el proceso.';
}

const DOCUMENT_COUNT = 8;
const PARAGRAPHS_PER_DOCUMENT = 25;
const documents = Array.from({ length: DOCUMENT_COUNT }, (_, docIndex) => {
  const paragraphs = Array.from(
    { length: PARAGRAPHS_PER_DOCUMENT },
    (_, paragraphIndex) => paragraphFor(docIndex * PARAGRAPHS_PER_DOCUMENT + paragraphIndex),
  );
  return document(`doc-${String.fromCharCode(97 + docIndex)}`, paragraphs.join('\n\n'));
});

const SNAPSHOT_ID = '77777777-7777-4777-8777-777777777099';
// The same production inventory builder agt002-preview-engine.js uses on the discovery path.
const inventory = buildAgt002TenderRequirementInventory({ snapshotId: SNAPSHOT_ID, documents, documentGaps: [] });
assert.equal(
  inventory.source_units.length,
  DOCUMENT_COUNT * PARAGRAPHS_PER_DOCUMENT,
  'fixture must produce exactly one analyzable source unit per paragraph',
);

const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const allSourceUnitIds = [...resolvedTexts.keys()];
const orderedUnits = [...resolvedTexts.entries()]
  .map(([sourceUnitId, value]) => ({
    source_unit_id: sourceUnitId,
    document_id: value.document_id,
    document_version_id: value.document_version_id,
    index: value.index,
    text: value.text,
  }))
  .sort((left, right) => (
    left.document_id < right.document_id ? -1 : left.document_id > right.document_id ? 1
    : left.index - right.index
  ));
const totalCorpusChars = orderedUnits.reduce((total, unit) => total + unit.text.length, 0);

// ---------------------------------------------------------------------------------------------
// 0. Exported identities: the default source-char budget is 20_000, and the policy version moved
//    to v9 with it.
// ---------------------------------------------------------------------------------------------
assert.equal(
  TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS, 20_000,
  'the default per-batch source-char budget must be lowered from 40_000 to 20_000 to remediate the '
  + 'real AGT-002 Procuraduria batch-2 bridge timeouts',
);
assert.equal(
  TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION, 'tender-semantic-discovery.v9',
  'lowering the default source-char budget changes the model-facing batch plan and the per-batch '
  + 'idempotency identity, so the policy version must move',
);

// ---------------------------------------------------------------------------------------------
// 1. Fixture sanity: the synthetic corpus must exceed both the new 20_000 default AND the old
//    40_000 default, so the comparison below is not an artefact of a corpus too small to matter.
// ---------------------------------------------------------------------------------------------
assert.ok(
  totalCorpusChars > 40_000,
  `fixture corpus must exceed the old 40_000-char default to be a meaningful regression fixture, got ${totalCorpusChars}`,
);

// ---------------------------------------------------------------------------------------------
// 2. Pure planner comparison: the SAME corpus plans strictly more (and smaller) batches at the new
//    20_000 default than it would have at the old 40_000 default — the size reduction this
//    remediation exists to produce, mirrored from the real snapshot's offline 18-vs-35 measurement.
// ---------------------------------------------------------------------------------------------
const planAtNewDefault = planTenderSemanticDiscoveryBatches({
  units: orderedUnits, maxSourceCharsPerBatch: TENDER_SEMANTIC_DISCOVERY_MAX_SOURCE_CHARS,
});
const planAtOldDefault = planTenderSemanticDiscoveryBatches({ units: orderedUnits, maxSourceCharsPerBatch: 40_000 });
assert.ok(
  planAtNewDefault.batches.length > planAtOldDefault.batches.length,
  `the 20_000 default must plan more batches than the old 40_000 default over the same corpus `
  + `(got ${planAtNewDefault.batches.length} vs ${planAtOldDefault.batches.length})`,
);
assert.ok(planAtNewDefault.batches.length > 1, 'the new default must still split this corpus into multiple batches');
const maxBatchCharsAtNewDefault = Math.max(...planAtNewDefault.batches.map(batch => batch.char_count));
const maxBatchCharsAtOldDefault = Math.max(...planAtOldDefault.batches.map(batch => batch.char_count));
assert.ok(
  maxBatchCharsAtNewDefault < maxBatchCharsAtOldDefault,
  'the largest single batch under the new default must be smaller than the largest single batch under the old default',
);

// ---------------------------------------------------------------------------------------------
// 3. Integration: `discoverTenderSemanticManifest` called WITHOUT an explicit `maxSourceChars` (so
//    the new default governs) must issue multiple sequential provider calls over this corpus, and
//    every source unit sent to the provider must be sent in exactly one of them — no unit
//    duplicated, none silently missing from every batch.
// ---------------------------------------------------------------------------------------------
function fakeMultiCaptureClient() {
  const requests = [];
  return {
    requests,
    run: async request => {
      requests.push(request);
      const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
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
  idempotencyKey: 'idem-v9-default-batch-size',
  inventory,
  documents,
  // Generous on purpose: this file tests the SOURCE budget default, not the label-catalog budget,
  // which is a separate, already-covered concern (tests/tender-semantic-discovery-label-catalog.test.mjs).
  maxLabelCatalogChars: 500_000,
});

assert.ok(
  capture.requests.length > 1,
  `the default source-char budget must split this corpus into multiple sequential provider calls, got ${capture.requests.length}`,
);
assert.equal(
  capture.requests.length, planAtNewDefault.batches.length,
  'the number of provider calls actually made must match the pure planner\'s own batch count at the same default',
);

const sentUnitIds = capture.requests.flatMap(req => req.input.source_units.map(unit => unit.source_unit_id));
assert.deepEqual(
  [...sentUnitIds].sort(), [...allSourceUnitIds].sort(),
  'every source_unit of the corpus must be sent to the provider across the batches, none silently omitted',
);
assert.equal(
  new Set(sentUnitIds).size, sentUnitIds.length,
  'no source_unit may be sent to the provider more than once across the batches',
);

// ---------------------------------------------------------------------------------------------
// 4. The merged run's own discoveryLedger must account for every source unit as assigned or
//    explicitly failed — the planner's own contract (tender-semantic-discovery-batches.js) — with
//    no unit left out of both counts.
// ---------------------------------------------------------------------------------------------
assert.ok(result.discoveryLedger, 'the result must carry a discoveryLedger');
assert.equal(result.discoveryLedger.batch_count, capture.requests.length);
assert.equal(result.discoveryLedger.total_source_units, allSourceUnitIds.length);
assert.equal(
  result.discoveryLedger.assigned_source_units + result.discoveryLedger.failed_source_units.length,
  result.discoveryLedger.total_source_units,
  'every source unit must be counted as assigned or explicitly failed, with no silent third outcome',
);
assert.deepEqual(
  result.discoveryLedger.failed_source_units, [],
  'no unit of this fixture exceeds the absolute per-unit ceiling, so none may be reported as failed',
);
assert.equal(result.discoveryLedger.policy_version, TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION);

// ---------------------------------------------------------------------------------------------
// 5. Determinism: re-running the exact same corpus under the exact same idempotencyKey must
//    reproduce the exact same batch structure and the exact same per-batch idempotencyKeys.
// ---------------------------------------------------------------------------------------------
const secondCapture = fakeMultiCaptureClient();
await discoverTenderSemanticManifest({
  client: secondCapture,
  model: 'test-model',
  timeoutMs: 1000,
  idempotencyKey: 'idem-v9-default-batch-size',
  inventory,
  documents,
  maxLabelCatalogChars: 500_000,
});
assert.deepEqual(
  secondCapture.requests.map(req => ({ idempotencyKey: req.idempotencyKey, input: req.input })),
  capture.requests.map(req => ({ idempotencyKey: req.idempotencyKey, input: req.input })),
  'the same corpus under the new default must reproduce the same batch structure and idempotencyKeys on repeat',
);

// ---------------------------------------------------------------------------------------------
// 6. Per-batch identity: the hash (and therefore the idempotencyKey) a real batch reduces to under
//    the current v9 policy version must differ from what the identical batch would reduce to under
//    a literal 'tender-semantic-discovery.v8' policy version — a response reserved under v8 must
//    never be replayed for a v9 request that asks a differently-shaped question.
// ---------------------------------------------------------------------------------------------
{
  const sampleBatch = planAtNewDefault.batches[0];
  const baseHashInput = {
    plannerVersion: TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION,
    snapshotHash: inventory.snapshot_hash,
    inventoryHash: inventory.inventory_hash,
    batchIndex: sampleBatch.batch_index,
    units: sampleBatch.units,
  };
  const hashAtV9 = computeTenderSemanticDiscoveryBatchHash({ ...baseHashInput, policyVersion: TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION });
  const hashAtV8Literal = computeTenderSemanticDiscoveryBatchHash({ ...baseHashInput, policyVersion: 'tender-semantic-discovery.v8' });
  assert.match(hashAtV9, /^[0-9a-f]{64}$/, 'the batch hash must be a stable 64-char lowercase hex digest');
  assert.notEqual(
    hashAtV9, hashAtV8Literal,
    'the same batch must hash differently under the real v9 policy version than under a literal v8 policy version',
  );
  assert.equal(
    hashAtV9,
    computeTenderSemanticDiscoveryBatchHash({ ...baseHashInput, policyVersion: TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION }),
    'the same input must re-derive the exact same hash under v9',
  );

  const keyAtV9 = tenderSemanticDiscoveryBatchIdempotencyKey({ idempotencyKey: 'run-1', batchIndex: sampleBatch.batch_index, batchHash: hashAtV9 });
  const keyAtV8Literal = tenderSemanticDiscoveryBatchIdempotencyKey({ idempotencyKey: 'run-1', batchIndex: sampleBatch.batch_index, batchHash: hashAtV8Literal });
  assert.notEqual(
    keyAtV9, keyAtV8Literal,
    'the per-batch idempotencyKey must differ between v9 and a literal v8 policy version, so a v8 response is never replayed for a v9 request',
  );
}

console.log('tests/tender-semantic-discovery-v9-batch-size-default.test.mjs OK');
