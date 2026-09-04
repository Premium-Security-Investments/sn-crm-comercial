// TDD RED, TESTS-ONLY (docs/plans/2026-09-03-agt002-durable-batched-analysis.md, "Checkpoint
// semantic discovery" follow-up) -- every checkpoint `discoverTenderSemanticManifest` stores must
// now carry progress metadata: `progressPhase`, `completedBatchCount` and `totalBatchCount`.
//
// agt002-analysis-checkpoints.js's storeAgt002AnalysisCheckpoint (and the
// createAgt002AnalysisCheckpointAdapter hooks it backs) already REQUIRE these three fields --
// see agt002-analysis-checkpoints.js lines ~355-358. tender-semantic-discovery.js's two
// `checkpointHooks.storeCheckpoint` call sites (the per-batch store and the final
// `semantic_manifest` store) do not pass any of them yet, so every assertion below is expected to
// fail as an ordinary AssertionError against `undefined` -- never a load/type error -- until the
// production caller is updated to compute and forward this metadata.
//
// The fixture (two single-unit documents, one batch each) and the checkpoint stub store deliberately
// mirror tests/tender-semantic-discovery.test.mjs's own Task-3 checkpoint lifecycle contract, so the
// two files describe the very same wiring at two different altitudes: that file owns request
// hashes/idempotency/output-shape/fail-closed behaviour, this file owns progress-metadata
// correctness (absolute planned counts, resume semantics, never re-storing a reused hit).
//
// Run: node tests/tender-semantic-discovery-checkpoints.test.mjs

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest, TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION } from '../tender-semantic-discovery.js';
import { validateTenderSemanticManifest } from '../tender-semantic-manifest.js';
import {
  computeTenderSemanticDiscoveryBatchHash,
  tenderSemanticDiscoveryBatchIdempotencyKey,
  TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION,
} from '../tender-semantic-discovery-batches.js';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function document(id, text) {
  return { document_id: id, document_version_id: `${id}-v1`, content_hash: hash(text), extracted_text: text };
}
function inventory(snapshotId, documents) {
  return buildTenderRequirementInventory({ snapshotId, documents });
}
function sourceUnitsFor(inv, documents) {
  return [...resolveTenderInventorySourceTexts({ inventory: inv, documents }).entries()]
    .map(([source_unit_id, value]) => ({ source_unit_id, ...value }))
    .sort((a, b) => a.index - b.index || a.source_unit_id.localeCompare(b.source_unit_id));
}

function createCheckpointStubStore() {
  const rows = new Map();
  const loadCalls = [];
  const storeCalls = [];
  const hooks = Object.freeze({
    async loadCheckpoint({ stage, batchIndex, expectedRequestHash, validate }) {
      loadCalls.push({ stage, batchIndex, expectedRequestHash });
      const row = rows.get(`${stage}:${batchIndex}`);
      if (!row || row.requestHash !== expectedRequestHash) return { hit: false };
      let canonical;
      try { canonical = validate(row.output); } catch { return { hit: false }; }
      if (!canonical) return { hit: false };
      return {
        hit: true,
        output: canonical,
        usage: row.usage,
        requestHash: row.requestHash,
        stageContractVersion: row.stageContractVersion,
        providerIdempotencyKey: row.providerIdempotencyKey,
      };
    },
    async storeCheckpoint(params) {
      storeCalls.push(params);
      rows.set(`${params.stage}:${params.batchIndex}`, {
        output: params.output,
        usage: params.usage,
        requestHash: params.requestHash,
        stageContractVersion: params.stageContractVersion,
        providerIdempotencyKey: params.providerIdempotencyKey,
      });
      return { status: 'created', checkpointId: `stub-${params.stage}-${params.batchIndex}` };
    },
  });
  return { hooks, rows, loadCalls, storeCalls };
}

function ckptFakeClient(events) {
  const requests = [];
  return {
    requests,
    run: async request => {
      const batchIndex = request.input.batch.index;
      events.push({ kind: 'provider_call', batchIndex });
      requests.push(request);
      const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
      const proposal = {
        requirements: enumLabels.length
          ? [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }]
          : [],
        excluded: [],
        unresolved: [],
      };
      return { content: JSON.stringify(proposal), usage: { input_tokens: 10 + batchIndex, output_tokens: 5 + batchIndex } };
    },
  };
}

function forbiddenKeyLeak(value) {
  return /"(prompt|raw_output|raw_response|source_text|credential|api_key|secret|password)"\s*:/.test(JSON.stringify(value));
}

// Same forced-split fixture pattern as tests/tender-semantic-discovery-provider-call-heartbeat.test.mjs
// and tests/tender-semantic-discovery.test.mjs's own checkpoint block: two plain single-paragraph
// documents, each resolving to exactly one source unit, with a per-batch budget sized to fit only
// one unit -- deterministically N = 2 planned batches, so totalBatchCount is N + 1 = 3 throughout.
const DOC_A_TEXT = 'El oferente debera acreditar experiencia especifica mediante certificaciones de contratos ejecutados anteriormente con entidades publicas del orden nacional o territorial correspondiente.';
const DOC_B_TEXT = 'El supervisor del contrato debera verificar el cumplimiento de las obligaciones contractuales pactadas y elaborar actas de seguimiento periodicas durante toda la ejecucion contractual pactada.';

const SNAPSHOT = '99999999-9999-4999-8999-999999999041';
const DOCUMENTS = [document('progress-doc-a', DOC_A_TEXT), document('progress-doc-b', DOC_B_TEXT)];
const INVENTORY = inventory(SNAPSHOT, DOCUMENTS);
const UNITS = sourceUnitsFor(INVENTORY, DOCUMENTS);
assert.equal(UNITS.length, 2, 'fixture must yield exactly one source unit per document');
const UNIT_A = UNITS.find(unit => unit.document_id === 'progress-doc-a');
const UNIT_B = UNITS.find(unit => unit.document_id === 'progress-doc-b');
const MAX_SOURCE_CHARS = UNIT_A.text.length;

const N = 2; // planned discovery batches
const TOTAL_BATCH_COUNT = N + 1; // + 1 deterministic final semantic_manifest checkpoint

function batchHash(batchIndex, units) {
  return computeTenderSemanticDiscoveryBatchHash({
    plannerVersion: TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION,
    policyVersion: TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
    snapshotHash: INVENTORY.snapshot_hash,
    inventoryHash: INVENTORY.inventory_hash,
    batchIndex,
    units,
  });
}
const BATCH_HASHES = [batchHash(0, [UNIT_A]), batchHash(1, [UNIT_B])];

function batchIdempotencyKey(runKey, batchIndex) {
  return tenderSemanticDiscoveryBatchIdempotencyKey({ idempotencyKey: runKey, batchIndex, batchHash: BATCH_HASHES[batchIndex] });
}

async function runDiscovery({ client, hooks, idempotencyKey }) {
  return discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey,
    inventory: INVENTORY,
    documents: DOCUMENTS,
    maxSourceChars: MAX_SOURCE_CHARS,
    maxLabelCatalogChars: 40_000,
    checkpointHooks: hooks,
  });
}

/** Asserts requestHash/idempotency/output-shape invariants unrelated to progress metadata. */
function assertBatchStoreShape(call, { runKey, batchIndex }) {
  assert.equal(call.requestHash, BATCH_HASHES[batchIndex], "the stored request hash must be this batch's own identity");
  assert.equal(call.stageContractVersion, TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION, 'the stored contract version must be the existing discovery policy version');
  assert.equal(call.providerIdempotencyKey, batchIdempotencyKey(runKey, batchIndex), "the stored provider idempotency key must be this batch's own existing idempotency key");
  assert.match(call.outputSha256, /^[0-9a-f]{64}$/, 'the stored output sha256 must be a stable 64-char lowercase hex digest');
  assert.equal(typeof call.output, 'object', 'the stored output must be a structured object, never a raw string');
  assert.equal(forbiddenKeyLeak(call.output), false, 'a stored batch checkpoint must never carry a prompt/raw_response/source_text/credential key');
}

// ---------------------------------------------------------------------------------------------
// 1. Fresh run: every store, for every planned discovery batch AND the final semantic_manifest
//    store, must carry progressPhase:'semantic_discovery' and absolute, plan-wide
//    completedBatchCount/totalBatchCount -- batch i (0-based) => completedBatchCount i+1, and the
//    final manifest checkpoint => completedBatchCount N+1 -- both counted out of the same
//    totalBatchCount, N+1, which INCLUDES the final manifest checkpoint as one additional
//    deterministic checkpoint beyond the N discovery batches.
// ---------------------------------------------------------------------------------------------
let freshStore;
let freshResult;
{
  const events = [];
  const client = ckptFakeClient(events);
  freshStore = createCheckpointStubStore();
  const runKey = 'progress-fresh-run';

  freshResult = await runDiscovery({ client, hooks: freshStore.hooks, idempotencyKey: runKey });
  validateTenderSemanticManifest(freshResult.semanticManifest, { inventory: INVENTORY });

  const batchStoreCalls = freshStore.storeCalls.filter(call => call.stage === 'semantic_discovery_batch');
  assert.equal(batchStoreCalls.length, N, 'every planned batch must be freshly stored on a first run');
  batchStoreCalls.forEach((call, batchIndex) => {
    assertBatchStoreShape(call, { runKey, batchIndex });
    assert.equal(call.progressPhase, 'semantic_discovery', `batch ${batchIndex}'s store must carry progressPhase:'semantic_discovery'`);
    assert.equal(call.completedBatchCount, batchIndex + 1, `batch ${batchIndex} (0-based) must report completedBatchCount ${batchIndex + 1}`);
    assert.equal(call.totalBatchCount, TOTAL_BATCH_COUNT, `batch ${batchIndex}'s store must report the plan-wide totalBatchCount ${TOTAL_BATCH_COUNT} (N discovery batches + 1 final manifest checkpoint)`);
  });

  const manifestStoreCalls = freshStore.storeCalls.filter(call => call.stage === 'semantic_manifest');
  assert.equal(manifestStoreCalls.length, 1, 'the merged manifest checkpoint must be stored exactly once after a fully successful fresh run');
  const manifestCall = manifestStoreCalls[0];
  assert.match(manifestCall.outputSha256, /^[0-9a-f]{64}$/);
  assert.equal(forbiddenKeyLeak(manifestCall.output), false);
  assert.equal(manifestCall.progressPhase, 'semantic_discovery', "the semantic_manifest store must carry the same progressPhase:'semantic_discovery'");
  assert.equal(manifestCall.completedBatchCount, TOTAL_BATCH_COUNT, `the semantic_manifest store must report completedBatchCount ${TOTAL_BATCH_COUNT} (every discovery batch plus itself)`);
  assert.equal(manifestCall.totalBatchCount, TOTAL_BATCH_COUNT, `the semantic_manifest store must report totalBatchCount ${TOTAL_BATCH_COUNT}`);
}

// ---------------------------------------------------------------------------------------------
// 2. Resume: when an earlier run already checkpointed batch 0, a fresh run over the SAME plan
//    must (a) never re-store the reused hit, and (b) still store batch 1 and the final manifest
//    with the exact same ABSOLUTE plan-wide counts as the fresh run above -- never counts computed
//    relative to only the batches this resumed process itself executed (which would wrongly report
//    batch 1 as completedBatchCount 1 of totalBatchCount 1/2 instead of 2 of 3).
// ---------------------------------------------------------------------------------------------
{
  const resumeStore = createCheckpointStubStore();
  const validBatch0 = freshStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 0);
  assert.ok(validBatch0, 'setup precondition: the fresh batch 0 checkpoint must already have been captured above');
  resumeStore.rows.set('semantic_discovery_batch:0', {
    output: validBatch0.output, usage: validBatch0.usage, requestHash: validBatch0.requestHash,
    stageContractVersion: validBatch0.stageContractVersion, providerIdempotencyKey: validBatch0.providerIdempotencyKey,
  });

  const events = [];
  const client = ckptFakeClient(events);
  const resumeResult = await runDiscovery({ client, hooks: resumeStore.hooks, idempotencyKey: 'progress-fresh-run' });

  assert.deepEqual(events.map(event => event.batchIndex), [1], 'only the missing batch (1) may reach the provider when batch 0 is already checkpointed');
  assert.deepEqual(resumeResult.usage, freshResult.usage, 'resuming from one reused checkpoint must reproduce the identical aggregate usage');

  assert.equal(
    resumeStore.storeCalls.some(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 0),
    false,
    'a reused loaded checkpoint (batch 0) must never be re-stored',
  );

  const resumedBatch1Store = resumeStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 1);
  assert.ok(resumedBatch1Store, 'batch 1 must still be freshly stored after resuming');
  assertBatchStoreShape(resumedBatch1Store, { runKey: 'progress-fresh-run', batchIndex: 1 });
  assert.equal(resumedBatch1Store.progressPhase, 'semantic_discovery');
  assert.equal(resumedBatch1Store.completedBatchCount, 2, 'batch 1 must report the absolute plan-wide completedBatchCount (2), not a restart-relative count (1) that ignores the reused checkpoint');
  assert.equal(resumedBatch1Store.totalBatchCount, TOTAL_BATCH_COUNT, `batch 1 must report the absolute plan-wide totalBatchCount (${TOTAL_BATCH_COUNT}), not a restart-relative total (e.g. 1) computed from only the batches this resumed run itself attempted`);

  const resumedManifestStore = resumeStore.storeCalls.find(call => call.stage === 'semantic_manifest');
  assert.ok(resumedManifestStore, 'the final manifest checkpoint must still be stored after resuming');
  assert.equal(resumedManifestStore.progressPhase, 'semantic_discovery');
  assert.equal(resumedManifestStore.completedBatchCount, TOTAL_BATCH_COUNT, `the resumed run's final manifest store must still report the absolute completedBatchCount (${TOTAL_BATCH_COUNT})`);
  assert.equal(resumedManifestStore.totalBatchCount, TOTAL_BATCH_COUNT, `the resumed run's final manifest store must still report the absolute totalBatchCount (${TOTAL_BATCH_COUNT})`);
}

// ---------------------------------------------------------------------------------------------
// 3. Resume with every batch already checkpointed: zero provider calls and zero batch stores, but
//    the final manifest checkpoint -- itself freshly computed from the reconstructed merge -- must
//    still carry the exact same absolute counts as the very first fresh run.
// ---------------------------------------------------------------------------------------------
{
  const allHitStore = createCheckpointStubStore();
  const validBatch0 = freshStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 0);
  const validBatch1 = freshStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 1);
  assert.ok(validBatch0 && validBatch1, 'setup precondition: both fresh batch checkpoints must already have been captured above');
  for (const call of [validBatch0, validBatch1]) {
    allHitStore.rows.set(`semantic_discovery_batch:${call.batchIndex}`, {
      output: call.output, usage: call.usage, requestHash: call.requestHash,
      stageContractVersion: call.stageContractVersion, providerIdempotencyKey: call.providerIdempotencyKey,
    });
  }
  const events = [];
  const client = ckptFakeClient(events);
  const allHitResult = await runDiscovery({ client, hooks: allHitStore.hooks, idempotencyKey: 'progress-fresh-run' });

  assert.equal(events.length, 0, 'when every batch hits its checkpoint, zero provider calls may be made');
  assert.deepEqual(allHitResult.usage, freshResult.usage, 'usage reconstructed entirely from checkpoint hits must equal the original fresh aggregate exactly');
  assert.equal(
    allHitStore.storeCalls.some(call => call.stage === 'semantic_discovery_batch'),
    false,
    'no batch may be re-stored when every one of them is a reused checkpoint hit',
  );

  const manifestStoreCalls = allHitStore.storeCalls.filter(call => call.stage === 'semantic_manifest');
  assert.equal(manifestStoreCalls.length, 1, 'the final manifest checkpoint must still be stored exactly once, even when every discovery batch was reused');
  assert.equal(manifestStoreCalls[0].progressPhase, 'semantic_discovery');
  assert.equal(manifestStoreCalls[0].completedBatchCount, TOTAL_BATCH_COUNT, `even with every batch reused, the final manifest store must report the absolute completedBatchCount (${TOTAL_BATCH_COUNT})`);
  assert.equal(manifestStoreCalls[0].totalBatchCount, TOTAL_BATCH_COUNT, `even with every batch reused, the final manifest store must report the absolute totalBatchCount (${TOTAL_BATCH_COUNT})`);
}

console.log('tender semantic discovery checkpoint progress-metadata RED contract executed');
