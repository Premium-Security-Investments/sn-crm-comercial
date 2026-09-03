import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
  TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES,
} from '../tender-semantic-discovery.js';
import { validateTenderSemanticManifest, TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS } from '../tender-semantic-manifest.js';
import {
  computeTenderSemanticDiscoveryBatchHash,
  tenderSemanticDiscoveryBatchIdempotencyKey,
  TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION,
} from '../tender-semantic-discovery-batches.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';
import { AGT002_CHECKPOINT_ERROR_CODES } from '../agt002-analysis-checkpoints.js';

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

const SNAPSHOT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOCUMENTS = [
  document('pliego', [
    'REQUISITOS FINANCIEROS',
    'Índice de liquidez: El proponente deberá acreditar un indicador igual o superior a 1,20.',
    'REQUISITOS TÉCNICOS',
    'Centro de monitoreo: El contratista deberá operar una plataforma disponible las veinticuatro horas.',
  ].join('\n')),
];
const INVENTORY = inventory(SNAPSHOT, DOCUMENTS);
const UNITS = sourceUnitsFor(INVENTORY, DOCUMENTS);
const byText = fragment => UNITS.find(unit => unit.text.includes(fragment));
const financialHeading = byText('REQUISITOS FINANCIEROS');
const liquidity = byText('Índice de liquidez');
const technicalHeading = byText('REQUISITOS TÉCNICOS');
const monitoring = byText('Centro de monitoreo');

// Each label is the clause's own inline subject, taken literally out of the unit's text rather than
// retyped here: that is exactly what the discovery catalog offers as an enum member, and what the
// server looks up to derive the requirement's citations.
const FINANCIAL_LABEL = liquidity.text.split(':')[0];
const TECHNICAL_LABEL = monitoring.text.split(':')[0];

// v3 wire contract: a requirement carries EXACTLY {kind, label, front, category}. It never names a
// source unit — the server derives front_evidence/citations from the label's own literal owners —
// so the two front headings, which state no obligation of their own, must be dispositioned
// explicitly instead of being offered as a requirement's evidence.
function validProposal() {
  return {
    requirements: [
      { kind: 'condition', label: FINANCIAL_LABEL, front: 'financial', category: 'financial_execution' },
      { kind: 'obligation', label: TECHNICAL_LABEL, front: 'technical', category: 'technical' },
    ],
    excluded: [
      { source_unit_id: financialHeading.source_unit_id, reason: 'descriptive_or_contextual' },
      { source_unit_id: technicalHeading.source_unit_id, reason: 'descriptive_or_contextual' },
    ],
    unresolved: [],
  };
}

function citationOf(unit) {
  return { source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash };
}

{
  let captured;
  const client = {
    run: async request => {
      captured = request;
      return { content: JSON.stringify(validProposal()), usage: { input_tokens: 100, output_tokens: 30 } };
    },
  };
  const result = await discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'run-1',
    inventory: INVENTORY,
    documents: DOCUMENTS,
    effort: 'low',
  });

  // AGT-002 root-cause fix: the discovery turn is a real provider turn and must carry the same
  // explicit reasoning effort as the analysis turn — never silently inherit a default.
  assert.equal(captured.effort, 'low');

  validateTenderSemanticManifest(result.semanticManifest, { inventory: INVENTORY });
  assert.equal(result.semanticManifest.origin, 'model_proposal');
  assert.equal(result.semanticManifest.discovery_coverage.status, 'complete');
  assert.equal(result.semanticManifest.analyzed_coverage.status, 'incomplete');
  assert.equal(result.semanticManifest.decision_ready, false);
  assert.equal(result.semanticManifest.requirements.length, 2);
  assert.deepEqual(Object.values(result.categoryOverrides).sort(), ['financial_execution', 'technical']);
  assert.equal(result.usage.input_tokens, 100);
  assert.equal(result.usage.output_tokens, 30);
  // v7: the idempotency key is now per-batch — base run key, batch index, then a 16 lowercase hex
  // char prefix of that batch's own stable content hash — not the whole-run key alone.
  assert.match(captured.idempotencyKey, /^run-1:semantic-discovery:0:[0-9a-f]{16}$/);
  assert.deepEqual(captured.outputSchema.properties.requirements.items.properties.category.enum,
    ['discard', 'habilitating', 'technical', 'financial_execution']);
  // The model is never even offered a place to put a source id: the requirement item declares the
  // four decidable fields and nothing else.
  assert.deepEqual(captured.outputSchema.properties.requirements.items.required, ['kind', 'label', 'front', 'category']);
  assert.deepEqual(Object.keys(captured.outputSchema.properties.requirements.items.properties).sort(),
    ['category', 'front', 'kind', 'label']);
  assert.equal(captured.outputSchema.properties.requirements.items.additionalProperties, false);
  assert.equal([FINANCIAL_LABEL, TECHNICAL_LABEL]
    .every(label => captured.outputSchema.properties.requirements.items.properties.label.enum.includes(label)), true);
  assert.equal(captured.input.source_units.every(unit => typeof unit.text === 'string' && !Object.hasOwn(unit, 'document')), true);

  // The citations are DERIVED from each label's literal owners, not proposed: the financial
  // requirement binds to the liquidity clause and the technical one to the monitoring clause, even
  // though the proposal named neither.
  const financial = result.semanticManifest.requirements.find(requirement => requirement.front === 'financial');
  const technical = result.semanticManifest.requirements.find(requirement => requirement.front === 'technical');
  assert.equal(financial.label, FINANCIAL_LABEL);
  assert.deepEqual(financial.front_evidence, citationOf(liquidity));
  assert.deepEqual(financial.citations, [citationOf(liquidity)]);
  assert.equal(technical.label, TECHNICAL_LABEL);
  assert.deepEqual(technical.front_evidence, citationOf(monitoring));
  assert.deepEqual(technical.citations, [citationOf(monitoring)]);

  // A front heading states no obligation, so it is never a requirement's evidence — it is
  // dispositioned explicitly instead.
  const requirementUnitIds = new Set(result.semanticManifest.requirements.flatMap(requirement => [
    requirement.front_evidence.source_unit_id,
    ...requirement.citations.map(citation => citation.source_unit_id),
  ]));
  assert.equal(requirementUnitIds.has(financialHeading.source_unit_id), false);
  assert.equal(requirementUnitIds.has(technicalHeading.source_unit_id), false);
  assert.deepEqual(result.semanticManifest.excluded.map(entry => entry.source_unit_id).sort(),
    [financialHeading.source_unit_id, technicalHeading.source_unit_id].sort());
  assert.equal(result.semanticManifest.excluded.every(entry => entry.reason === 'descriptive_or_contextual'), true);
  assert.equal(result.semanticManifest.requirements.some(req => TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS.includes(req.requirement_id)), false);
}

async function rejectsProposal(mutator, pattern) {
  const proposal = validProposal();
  mutator(proposal);
  await assert.rejects(
    discoverTenderSemanticManifest({
      client: { run: async () => ({ content: JSON.stringify(proposal), usage: { input_tokens: 1, output_tokens: 1 } }) },
      model: 'test-model', timeoutMs: 1000, idempotencyKey: 'reject', inventory: INVENTORY, documents: DOCUMENTS,
    }),
    pattern,
  );
}

// A label outside this snapshot's own literal catalog has no derivable provenance at all.
await rejectsProposal(proposal => { proposal.requirements[0].label = 'Capital de trabajo'; }, /etiqueta|texto|fuente|anclad/i);
await rejectsProposal(proposal => { proposal.requirements[0].category = 'strategic'; }, /categor|esquema|propuesta/i);
// A legacy or hostile answer cannot smuggle a citation back in: a source id inside a requirement is
// an invalid key, rejected on shape before any id is read.
await rejectsProposal(proposal => { proposal.requirements[0].source_unit_ids = [liquidity.source_unit_id]; }, /clave|inválid|propuesta/i);

// The liquidity unit is already cited by the derived binding, so disposing of it again is a
// self-contradiction. v8: it is retracted rather than rejecting the whole run — the citation is
// never moved, and the contradictory disposition leaves no trace.
{
  const proposal = validProposal();
  proposal.excluded.push({ source_unit_id: liquidity.source_unit_id, reason: 'not_an_obligation' });
  const result = await discoverTenderSemanticManifest({
    client: { run: async () => ({ content: JSON.stringify(proposal), usage: { input_tokens: 1, output_tokens: 1 } }) },
    model: 'test-model', timeoutMs: 1000, idempotencyKey: 'overlap-retraction', inventory: INVENTORY, documents: DOCUMENTS,
  });
  const financial = result.semanticManifest.requirements.find(requirement => requirement.front === 'financial');
  assert.deepEqual(financial.citations, [citationOf(liquidity)], 'the derived citation must survive the contradiction untouched');
  assert.equal(
    result.semanticManifest.excluded.some(entry => entry.source_unit_id === liquidity.source_unit_id), false,
    'the contradictory disposition over the cited unit must leave no trace',
  );
  assert.deepEqual(
    result.semanticManifest.excluded.map(entry => entry.source_unit_id).sort(),
    [financialHeading.source_unit_id, technicalHeading.source_unit_id].sort(),
    'the two unrelated, valid exclusions must survive untouched',
  );
  assert.equal(result.discoveryLedger.batches[0].retracted_disposition_units, 1);
}

// v4: dropping a requirement leaves the monitoring clause unlisted. That is an omission, not a
// wrong claim, so it no longer rejects the turn: the obligation the proposal DID state survives and
// the unlisted unit is preserved as an unresolved entry, which keeps discovery 'partial' and the
// decision paused. Nothing is inferred for it — no requirement, no category, no exclusion.
{
  const proposal = validProposal();
  proposal.requirements.splice(1, 1);
  const result = await discoverTenderSemanticManifest({
    client: { run: async () => ({ content: JSON.stringify(proposal), usage: { input_tokens: 1, output_tokens: 1 } }) },
    model: 'test-model', timeoutMs: 1000, idempotencyKey: 'coverage-completion', inventory: INVENTORY, documents: DOCUMENTS,
  });
  assert.equal(result.semanticManifest.requirements.length, 1);
  assert.deepEqual(result.semanticManifest.unresolved, [{
    source_unit_id: monitoring.source_unit_id,
    unit_hash: monitoring.unit_hash,
    origin: 'semantic',
    reason: 'source_unit_not_dispositioned',
  }]);
  assert.equal(result.semanticManifest.coverage_ledger.every_source_unit_disposed, true);
  assert.equal(result.semanticManifest.discovery_coverage.status, 'partial');
  assert.equal(result.semanticManifest.decision_ready, false);
  assert.equal(result.semanticManifest.recommendation, 'pause');
}

{
  const otherSnapshot = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const otherInventory = inventory(otherSnapshot, DOCUMENTS);
  const otherUnits = sourceUnitsFor(otherInventory, DOCUMENTS);
  const proposal = validProposal();
  // A requirement can no longer carry a foreign id at all, so the only remaining door for one is a
  // disposition — and it stays shut: an id from another snapshot is not a visible unit of this one.
  proposal.excluded.push({
    source_unit_id: otherUnits.find(unit => unit.text.includes('Índice')).source_unit_id,
    reason: 'not_an_obligation',
  });
  await assert.rejects(
    discoverTenderSemanticManifest({
      client: { run: async () => ({ content: JSON.stringify(proposal), usage: { input_tokens: 1, output_tokens: 1 } }) },
      model: 'test-model', timeoutMs: 1000, idempotencyKey: 'foreign', inventory: INVENTORY, documents: DOCUMENTS,
    }),
    /unidad|source_unit|permitid|snapshot/i,
  );
}

console.log('tender semantic discovery fail-closed contract passed');

// =================================================================================================
// AGT-002 durable batched analysis, Task 3 (TDD RED, no production change) --
// docs/plans/2026-09-03-agt002-durable-batched-analysis.md, "Checkpoint semantic discovery".
//
// `discoverTenderSemanticManifest` today has no `checkpointHooks` parameter at all: an unknown
// option key is simply never read, so every scenario below runs through unchanged -- the provider
// is always called, the hook spies are never invoked, and every assertion fails as an ordinary,
// deterministic AssertionError (never a syntax/import error). The fake hook pair below
// (createCheckpointStubStore) deliberately mirrors the REAL adapter contract this module must be
// wired against -- agt002-analysis-checkpoints.js's loadAgt002AnalysisCheckpoint /
// storeAgt002AnalysisCheckpoint (Task 2, already implemented): `validate` is called SYNCHRONOUSLY
// against the raw stored `output`, and a row is a hit only when the caller's own current
// validator/canonicalizer accepts it. No database, no network -- spies and mocks only.
// =================================================================================================

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

// Two plain, single-paragraph documents, no digits/"@"/phone-shaped substrings, following the exact
// forced-split fixture pattern already proven in tests/tender-semantic-discovery-provider-call-heartbeat.test.mjs:
// each document resolves to exactly one source unit, and a per-batch budget sized to fit only the
// first document's unit alone deterministically produces exactly two single-unit batches.
const CKPT_DOC_A_TEXT = 'El oferente debera acreditar experiencia especifica mediante certificaciones de contratos ejecutados anteriormente con entidades publicas del orden nacional o territorial correspondiente.';
const CKPT_DOC_B_TEXT = 'El supervisor del contrato debera verificar el cumplimiento de las obligaciones contractuales pactadas y elaborar actas de seguimiento periodicas durante toda la ejecucion contractual pactada.';

function leaksCkptDocumentText(value) {
  const json = JSON.stringify(value);
  return [CKPT_DOC_A_TEXT, CKPT_DOC_B_TEXT].some(text => json.includes(JSON.stringify(text).slice(1, -1)));
}

const CKPT_SNAPSHOT = '99999999-9999-4999-8999-999999999031';
const ckptDocuments = [document('ckpt-doc-a', CKPT_DOC_A_TEXT), document('ckpt-doc-b', CKPT_DOC_B_TEXT)];
const ckptInventory = inventory(CKPT_SNAPSHOT, ckptDocuments);
const ckptUnits = sourceUnitsFor(ckptInventory, ckptDocuments);
assert.equal(ckptUnits.length, 2, 'checkpoint fixture must yield exactly one source unit per document');
const ckptUnitA = ckptUnits.find(unit => unit.document_id === 'ckpt-doc-a');
const ckptUnitB = ckptUnits.find(unit => unit.document_id === 'ckpt-doc-b');
const CKPT_MAX_SOURCE_CHARS = ckptUnitA.text.length;

function ckptBatchHash(batchIndex, units) {
  return computeTenderSemanticDiscoveryBatchHash({
    plannerVersion: TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION,
    policyVersion: TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
    snapshotHash: ckptInventory.snapshot_hash,
    inventoryHash: ckptInventory.inventory_hash,
    batchIndex,
    units,
  });
}
const CKPT_BATCH_HASHES = [ckptBatchHash(0, [ckptUnitA]), ckptBatchHash(1, [ckptUnitB])];

function ckptBatchIdempotencyKey(runKey, batchIndex) {
  return tenderSemanticDiscoveryBatchIdempotencyKey({ idempotencyKey: runKey, batchIndex, batchHash: CKPT_BATCH_HASHES[batchIndex] });
}

function corruptStringsDeep(value) {
  if (typeof value === 'string') return `CORRUPTED-${value}`;
  if (Array.isArray(value)) return value.map(corruptStringsDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, corruptStringsDeep(val)]));
  return value;
}

async function runCkptDiscovery({ client, hooks, idempotencyKey }) {
  return discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey,
    inventory: ckptInventory,
    documents: ckptDocuments,
    maxSourceChars: CKPT_MAX_SOURCE_CHARS,
    maxLabelCatalogChars: 40_000,
    checkpointHooks: hooks,
  });
}

// ---------------------------------------------------------------------------------------------
// Requirement 1: the no-hook path is byte-equivalent to today, and omitting `checkpointHooks`
// introduces no new required option. This already holds today (the key is simply ignored); it is
// asserted here as the regression floor every block below is layered on top of.
// ---------------------------------------------------------------------------------------------
{
  const eventsOmitted = [];
  const clientOmitted = ckptFakeClient(eventsOmitted);
  const resultOmitted = await discoverTenderSemanticManifest({
    client: clientOmitted, model: 'test-model', timeoutMs: 1000, idempotencyKey: 'ckpt-no-hook',
    inventory: ckptInventory, documents: ckptDocuments, maxSourceChars: CKPT_MAX_SOURCE_CHARS, maxLabelCatalogChars: 40_000,
  });

  const eventsExplicitUndefined = [];
  const clientExplicitUndefined = ckptFakeClient(eventsExplicitUndefined);
  const resultExplicitUndefined = await discoverTenderSemanticManifest({
    client: clientExplicitUndefined, model: 'test-model', timeoutMs: 1000, idempotencyKey: 'ckpt-no-hook',
    inventory: ckptInventory, documents: ckptDocuments, maxSourceChars: CKPT_MAX_SOURCE_CHARS, maxLabelCatalogChars: 40_000,
    checkpointHooks: undefined,
  });

  assert.deepEqual(
    clientOmitted.requests.map(request => request.input), clientExplicitUndefined.requests.map(request => request.input),
    'omitting checkpointHooks and passing checkpointHooks: undefined must send the identical request sequence',
  );
  assert.deepEqual(resultOmitted, resultExplicitUndefined, 'the no-hook path must be byte-equivalent whether checkpointHooks is absent or explicitly undefined');
  assert.equal(eventsOmitted.length, 2, 'the no-hook path must still make one provider call per planned batch, exactly as before checkpointHooks existed');
}

// ---------------------------------------------------------------------------------------------
// Requirements 2, 4, 8 and 9: a fresh run (no pre-existing checkpoint) must call
// checkpointHooks.loadCheckpoint once per planned batch, in contiguous batch_index order, BEFORE
// that batch's provider call, using the stable stage 'semantic_discovery_batch' and this module's
// own already-computed per-batch request hash/contract version/provider idempotency key; after a
// miss it must run the provider, canonicalize the answer, and ONLY THEN call storeCheckpoint with
// the canonical structured output plus a deterministic sha256 and safe usage/idempotency metadata
// -- never the raw prompt, the raw provider response, source document text or a credential. The
// merged manifest checkpoint is attempted first (and, on this first run, missed) and stored last,
// with the aggregate usage of every batch. The final manifest must still satisfy every existing V3
// coverage/order/uniqueness invariant (requirement 8), unchanged.
// ---------------------------------------------------------------------------------------------
let lifecycleStore;
let freshResult;
{
  const events = [];
  const client = ckptFakeClient(events);
  lifecycleStore = createCheckpointStubStore();
  const runKey = 'ckpt-lifecycle-run';

  freshResult = await runCkptDiscovery({ client, hooks: lifecycleStore.hooks, idempotencyKey: runKey });
  validateTenderSemanticManifest(freshResult.semanticManifest, { inventory: ckptInventory });

  const batchLoadCalls = lifecycleStore.loadCalls.filter(call => call.stage === 'semantic_discovery_batch');
  assert.deepEqual(batchLoadCalls.map(call => call.batchIndex), [0, 1], 'loadCheckpoint must be called once per batch, in contiguous batch_index order starting at 0');
  assert.deepEqual(batchLoadCalls.map(call => call.expectedRequestHash), CKPT_BATCH_HASHES, "each batch's loadCheckpoint call must carry this module's own already-computed request hash for that exact batch");

  const manifestLoadCalls = lifecycleStore.loadCalls.filter(call => call.stage === 'semantic_manifest');
  assert.equal(manifestLoadCalls.length, 1, 'the merged manifest checkpoint must be attempted exactly once per run, under the stable closed stage name semantic_manifest');
  assert.equal(manifestLoadCalls[0].batchIndex, 0, 'the merged manifest checkpoint is a single closed-stage row and must use a deterministic non-negative batch_index');
  assert.match(manifestLoadCalls[0].expectedRequestHash, /^[0-9a-f]{64}$/, 'the merged manifest checkpoint identity must be a stable sha256 hex digest');

  const batchStoreCalls = lifecycleStore.storeCalls.filter(call => call.stage === 'semantic_discovery_batch');
  assert.deepEqual(batchStoreCalls.map(call => call.batchIndex), [0, 1], 'storeCheckpoint must be called once per freshly executed batch, in the same contiguous order');
  batchStoreCalls.forEach((call, batchIndex) => {
    assert.equal(call.requestHash, CKPT_BATCH_HASHES[batchIndex], 'the stored request hash must be the exact same identity the load call used');
    assert.equal(call.stageContractVersion, TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION, "the stored contract version must be this module's own existing discovery policy version, never a newly invented one");
    assert.equal(call.providerIdempotencyKey, ckptBatchIdempotencyKey(runKey, batchIndex), "the stored provider idempotency key must be this module's own existing per-batch idempotency key");
    assert.match(call.outputSha256, /^[0-9a-f]{64}$/, 'the stored output sha256 must be a stable 64-char lowercase hex digest');
    assert.equal(typeof call.output, 'object', 'the stored output must be a structured object, never a raw string');
    assert.deepEqual(call.usage, { input_tokens: 10 + batchIndex, output_tokens: 5 + batchIndex, cost_usd: null }, "the stored usage must be exactly this batch's own safe normalized accepted usage");
    assert.equal(forbiddenKeyLeak(call.output), false, 'a stored batch checkpoint must never carry a prompt/raw_response/source_text/credential key at any depth');
    assert.equal(leaksCkptDocumentText(call.output), false, 'a stored batch checkpoint must never carry the raw expediente document text');
  });

  const manifestStoreCalls = lifecycleStore.storeCalls.filter(call => call.stage === 'semantic_manifest');
  assert.equal(manifestStoreCalls.length, 1, 'the merged manifest checkpoint must be persisted exactly once after a fully successful fresh run');
  assert.equal(manifestStoreCalls[0].batchIndex, 0);
  assert.equal(manifestStoreCalls[0].requestHash, manifestLoadCalls[0].expectedRequestHash, 'the manifest checkpoint stored must use the exact same identity the load attempt used');
  assert.equal(typeof manifestStoreCalls[0].stageContractVersion, 'string');
  assert.ok(manifestStoreCalls[0].stageContractVersion.length > 0, 'the manifest checkpoint must carry a non-empty stage contract version');
  assert.deepEqual(manifestStoreCalls[0].usage, { input_tokens: 21, output_tokens: 11, cost_usd: null }, 'the merged manifest checkpoint must carry the AGGREGATE usage of every batch counted exactly once');
  assert.equal(forbiddenKeyLeak(manifestStoreCalls[0].output), false, 'the merged manifest checkpoint must never carry a prompt/raw_response/source_text/credential key at any depth');
  assert.equal(leaksCkptDocumentText(manifestStoreCalls[0].output), false, 'the merged manifest checkpoint must never carry the raw expediente document text');

  const orderedProviderKinds = events.map(event => `provider_call:${event.batchIndex}`);
  const orderedLoadKinds = lifecycleStore.loadCalls.map(call => `load:${call.stage}:${call.batchIndex}`);
  const orderedStoreKinds = lifecycleStore.storeCalls.map(call => `store:${call.stage}:${call.batchIndex}`);
  // Deterministic stage-boundary ordering only (requirement 9): the merged-manifest check first,
  // then EACH batch's own load(miss) -> provider call -> store, strictly in batch order, then the
  // final manifest store.
  assert.deepEqual(
    [
      orderedLoadKinds[0], orderedLoadKinds[1], orderedProviderKinds[0], orderedStoreKinds[0],
      orderedLoadKinds[2], orderedProviderKinds[1], orderedStoreKinds[1], orderedStoreKinds[2],
    ],
    [
      'load:semantic_manifest:0', 'load:semantic_discovery_batch:0', 'provider_call:0', 'store:semantic_discovery_batch:0',
      'load:semantic_discovery_batch:1', 'provider_call:1', 'store:semantic_discovery_batch:1', 'store:semantic_manifest:0',
    ],
    'checkpoint hooks must fire at deterministic stage boundaries only: the merged-manifest check first, then per-batch load/call/store in order, then the final manifest store',
  );
}

// ---------------------------------------------------------------------------------------------
// Requirement 3: every loaded checkpoint output is untrusted until it is re-run through the
// CURRENT batch validator/canonicalizer. A stored batch checkpoint whose content has been
// corrupted (every string field mutated, so no label/id/kind it names can still match this batch's
// own current catalog/allowlist) must be rejected -- becoming a miss -- and the batch must be
// recovered by a fresh provider call, while the OTHER, uncorrupted batch checkpoint still hits and
// costs zero provider calls.
// ---------------------------------------------------------------------------------------------
{
  const staleStore = createCheckpointStubStore();
  const validBatch0 = lifecycleStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 0);
  const validBatch1 = lifecycleStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 1);
  assert.ok(validBatch0 && validBatch1, 'setup precondition from the block above: both fresh batch checkpoints must already have been captured');
  staleStore.rows.set('semantic_discovery_batch:0', {
    output: validBatch0.output, usage: validBatch0.usage, requestHash: validBatch0.requestHash,
    stageContractVersion: validBatch0.stageContractVersion, providerIdempotencyKey: validBatch0.providerIdempotencyKey,
  });
  staleStore.rows.set('semantic_discovery_batch:1', {
    output: corruptStringsDeep(validBatch1.output), usage: validBatch1.usage, requestHash: validBatch1.requestHash,
    stageContractVersion: validBatch1.stageContractVersion, providerIdempotencyKey: validBatch1.providerIdempotencyKey,
  });

  const events = [];
  const client = ckptFakeClient(events);
  const result = await runCkptDiscovery({ client, hooks: staleStore.hooks, idempotencyKey: 'ckpt-lifecycle-run' });

  assert.deepEqual(events.map(event => event.batchIndex), [1], 'a valid loaded checkpoint (batch 0) must skip its provider call; only the corrupted batch (1) may reach the provider');
  assert.deepEqual(result, freshResult, 'recovering the corrupted batch via a fresh provider call must reproduce the identical merged manifest, usage and ledger');
  assert.ok(
    staleStore.loadCalls.some(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 1),
    'the corrupted batch must still be attempted as a checkpoint load before falling back to the provider',
  );
  assert.ok(
    staleStore.storeCalls.some(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 1),
    'a batch recovered via a fresh provider call after a corrupted checkpoint must still be checkpointed durably',
  );
  assert.equal(
    staleStore.storeCalls.some(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 0),
    false,
    'a checkpoint hit must never be re-stored',
  );
}

// ---------------------------------------------------------------------------------------------
// Requirement 5: a checkpoint store conflict/lease loss propagates fail closed. The caller's own
// error must survive unchanged (so its closed classification still works downstream), no later
// batch may ever be attempted, and no merged manifest checkpoint or final result may be produced.
// ---------------------------------------------------------------------------------------------
{
  const conflictStore = createCheckpointStubStore();
  const conflictError = new Error('AGT-002 checkpoint: conflicto de persistencia bajo la misma identidad.');
  conflictError.code = 'AGT002_CHECKPOINT_PERSISTENCE_CONFLICT';
  const hooks = Object.freeze({
    loadCheckpoint: conflictStore.hooks.loadCheckpoint,
    async storeCheckpoint(params) {
      if (params.stage === 'semantic_discovery_batch' && params.batchIndex === 0) throw conflictError;
      return conflictStore.hooks.storeCheckpoint(params);
    },
  });
  const events = [];
  const client = ckptFakeClient(events);
  await assert.rejects(
    () => runCkptDiscovery({ client, hooks, idempotencyKey: 'ckpt-conflict' }),
    error => {
      assert.equal(error, conflictError, "a checkpoint store conflict/lease loss must propagate the caller's own error unchanged so its closed code still classifies downstream");
      assert.deepEqual(events.map(event => event.batchIndex), [0], 'a fail-closed store conflict on batch 0 must prevent batch 1 from ever being attempted');
      return true;
    },
  );
  assert.equal(
    conflictStore.storeCalls.some(call => call.stage === 'semantic_manifest'),
    false,
    'a store conflict must never allow a merged manifest checkpoint or final result to be produced',
  );
}

// ---------------------------------------------------------------------------------------------
// Requirement 6: aggregate usage must count each EFFECTIVE checkpoint (loaded hit or freshly
// executed) exactly once -- never dropped (a hit silently missing from the aggregate) and never
// doubled (a hit's usage added on top of a phantom fresh computation).
// ---------------------------------------------------------------------------------------------
{
  const allHitStore = createCheckpointStubStore();
  const validBatch0 = lifecycleStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 0);
  const validBatch1 = lifecycleStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 1);
  assert.ok(validBatch0 && validBatch1, 'setup precondition: both fresh batch checkpoints must already have been captured');
  for (const call of [validBatch0, validBatch1]) {
    allHitStore.rows.set(`semantic_discovery_batch:${call.batchIndex}`, {
      output: call.output, usage: call.usage, requestHash: call.requestHash,
      stageContractVersion: call.stageContractVersion, providerIdempotencyKey: call.providerIdempotencyKey,
    });
  }
  const events = [];
  const client = ckptFakeClient(events);
  const allHitResult = await runCkptDiscovery({ client, hooks: allHitStore.hooks, idempotencyKey: 'ckpt-lifecycle-run' });
  assert.equal(events.length, 0, 'when every batch hits its checkpoint, zero provider calls may be made');
  assert.deepEqual(allHitResult.usage, freshResult.usage, 'usage reconstructed entirely from checkpoint hits must equal the original fresh aggregate exactly -- not zero, not doubled');
  assert.equal(allHitStore.storeCalls.some(call => call.stage === 'semantic_discovery_batch'), false, 'a checkpoint hit must never be re-stored');
}
{
  const mixedStore = createCheckpointStubStore();
  const validBatch0 = lifecycleStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 0);
  assert.ok(validBatch0, 'setup precondition: the fresh batch 0 checkpoint must already have been captured');
  mixedStore.rows.set('semantic_discovery_batch:0', {
    output: validBatch0.output, usage: validBatch0.usage, requestHash: validBatch0.requestHash,
    stageContractVersion: validBatch0.stageContractVersion, providerIdempotencyKey: validBatch0.providerIdempotencyKey,
  });
  const events = [];
  const client = ckptFakeClient(events);
  const mixedResult = await runCkptDiscovery({ client, hooks: mixedStore.hooks, idempotencyKey: 'ckpt-lifecycle-run' });
  assert.deepEqual(events.map(event => event.batchIndex), [1], 'only the missing batch (1) may reach the provider when batch 0 already has a valid checkpoint');
  assert.deepEqual(mixedResult.usage, freshResult.usage, "a mix of one loaded checkpoint's usage plus one freshly executed batch's usage must sum to exactly the original aggregate");
}

// ---------------------------------------------------------------------------------------------
// Requirement 7: a validated merged `semantic_manifest` checkpoint hit must skip EVERY semantic
// provider call -- not just the batches, the per-batch checkpoint lookups too -- and return the
// exact canonical merged manifest. An invalid/corrupted merged hit must never be trusted directly
// either: it must fall back to the normal per-batch path.
// ---------------------------------------------------------------------------------------------
{
  const throwingClient = { run: async () => { throw new Error('must never be called: a validated merged manifest checkpoint hit must skip every provider call'); } };
  const replay = await runCkptDiscovery({ client: throwingClient, hooks: lifecycleStore.hooks, idempotencyKey: 'ckpt-lifecycle-run' });
  assert.deepEqual(replay, freshResult, 'a validated merged manifest checkpoint hit must return the exact canonical merged manifest, usage and ledger of the original run');
}
{
  const fallbackStore = createCheckpointStubStore();
  const validManifest = lifecycleStore.storeCalls.find(call => call.stage === 'semantic_manifest');
  const validBatch0 = lifecycleStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 0);
  const validBatch1 = lifecycleStore.storeCalls.find(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 1);
  assert.ok(validManifest && validBatch0 && validBatch1, 'setup precondition: the fresh manifest and both fresh batch checkpoints must already have been captured');
  fallbackStore.rows.set('semantic_manifest:0', {
    output: { bogus_shape: true, not_a_real_manifest: 'CORRUPTED' }, usage: validManifest.usage,
    requestHash: validManifest.requestHash, stageContractVersion: validManifest.stageContractVersion,
    providerIdempotencyKey: validManifest.providerIdempotencyKey,
  });
  for (const call of [validBatch0, validBatch1]) {
    fallbackStore.rows.set(`semantic_discovery_batch:${call.batchIndex}`, {
      output: call.output, usage: call.usage, requestHash: call.requestHash,
      stageContractVersion: call.stageContractVersion, providerIdempotencyKey: call.providerIdempotencyKey,
    });
  }
  const throwingClient = { run: async () => { throw new Error('must never be called: both batches already have valid checkpoints for the fallback path'); } };
  const fallbackResult = await runCkptDiscovery({ client: throwingClient, hooks: fallbackStore.hooks, idempotencyKey: 'ckpt-lifecycle-run' });
  const batchLoadCalls = fallbackStore.loadCalls.filter(call => call.stage === 'semantic_discovery_batch');
  assert.deepEqual(batchLoadCalls.map(call => call.batchIndex), [0, 1], 'an invalid merged manifest checkpoint hit must fall back to the normal per-batch checkpoint path, never trust the corrupted merge directly');
  assert.deepEqual(fallbackResult, freshResult, 'the per-batch fallback must reconstruct the exact same canonical merged manifest as the original run');
}

// ---------------------------------------------------------------------------------------------
// Requirement 8 (partial-failure half): a partial run must never store the merged manifest
// checkpoint, even though every batch that DID complete validly is still checkpointed durably --
// the entire point of this remediation (see the 2026-09-03 Procuraduria incident in the plan).
// ---------------------------------------------------------------------------------------------
{
  const partialStore = createCheckpointStubStore();
  const partialClient = {
    run: async request => {
      const batchIndex = request.input.batch.index;
      if (batchIndex === 1) throw new Error('proveedor no disponible para el lote 1');
      const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
      const proposal = { requirements: [{ kind: 'obligation', label: enumLabels[0], front: 'technical', category: 'technical' }], excluded: [], unresolved: [] };
      return { content: JSON.stringify(proposal), usage: { input_tokens: 10, output_tokens: 5 } };
    },
  };
  await assert.rejects(() => runCkptDiscovery({ client: partialClient, hooks: partialStore.hooks, idempotencyKey: 'ckpt-partial' }));
  assert.ok(
    partialStore.storeCalls.some(call => call.stage === 'semantic_discovery_batch' && call.batchIndex === 0),
    'the batch that DID complete validly before the later failure must still be checkpointed durably',
  );
  assert.equal(
    partialStore.storeCalls.some(call => call.stage === 'semantic_manifest'),
    false,
    'a partial/failed run must never store the merged manifest checkpoint',
  );
}

// ---------------------------------------------------------------------------------------------
// Requirement 10 (MEDIUM review finding, still open): a checkpoint STORE failure carries its own
// closed infrastructure/fencing code from agt002-analysis-checkpoints.js's
// AGT002_CHECKPOINT_ERROR_CODES (e.g. AGT002_CHECKPOINT_PERSISTENCE_CONFLICT /
// AGT002_CHECKPOINT_LEASE_LOST) but no `.stage` of its own. The per-batch catch-all fallback that
// builds `error.discoveryLedger` today defaults an untagged error's stage to
// AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION and its code to `error.code` verbatim -- so a
// closed checkpoint adapter error is misclassified as a semantic_validation/model-output rejection
// and the foreign AGT002_CHECKPOINT_* code is written straight into the ledger `code` field that
// must otherwise hold only a TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES member. Discovery must
// still fail closed (unchanged error identity, no later batch, no merged-manifest checkpoint), but
// the failed ledger entry must instead carry a deterministic, dedicated `checkpoint_persistence`
// stage and preserve the adapter's own closed code, unchanged, in an explicit `checkpoint_code`
// field -- never inside the semantic-validation `code` catalog, and never the raw `.message` text.
// ---------------------------------------------------------------------------------------------
for (const checkpointErrorCode of [
  AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_PERSISTENCE_CONFLICT,
  AGT002_CHECKPOINT_ERROR_CODES.LEASE_LOST,
]) {
  const infraStore = createCheckpointStubStore();
  const infraError = new Error(
    `AGT-002 checkpoint adapter closed failure ${checkpointErrorCode}: fencing/persistence, never a model or semantic rejection.`,
  );
  infraError.code = checkpointErrorCode;
  const hooks = Object.freeze({
    loadCheckpoint: infraStore.hooks.loadCheckpoint,
    async storeCheckpoint(params) {
      if (params.stage === 'semantic_discovery_batch' && params.batchIndex === 0) throw infraError;
      return infraStore.hooks.storeCheckpoint(params);
    },
  });
  const events = [];
  const client = ckptFakeClient(events);
  await assert.rejects(
    () => runCkptDiscovery({ client, hooks, idempotencyKey: `ckpt-checkpoint-infra-${checkpointErrorCode}` }),
    error => {
      assert.equal(error, infraError, "a checkpoint store's own closed infrastructure/fencing error must still propagate unchanged");
      assert.deepEqual(
        events.map(event => event.batchIndex), [0],
        'a checkpoint-store infrastructure failure on batch 0 must still fail closed and prevent batch 1 from ever being attempted',
      );

      assert.ok(error.discoveryLedger, 'a checkpoint-store failure must still attach a safe discoveryLedger to the thrown error');
      const failedEntry = error.discoveryLedger.batches.find(entry => entry.batch_index === 0 && entry.status === 'failed');
      assert.ok(failedEntry, 'the ledger must still tag batch 0 as failed');

      assert.notEqual(
        failedEntry.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION,
        'a checkpoint infrastructure/fencing failure must never be misclassified under the semantic_validation/model-output-rejection stage',
      );
      assert.equal(
        failedEntry.stage, 'checkpoint_persistence',
        'a checkpoint-store failure must classify under its own deterministic, safe stage, not fall through the generic semantic_validation default',
      );
      assert.notEqual(
        failedEntry.code, checkpointErrorCode,
        'the foreign AGT002_CHECKPOINT_* code must never be written into the ledger `code` field reserved for the closed semantic-validation catalog',
      );
      if (failedEntry.code !== undefined) {
        assert.ok(
          TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.includes(failedEntry.code),
          'if the failed entry still carries a `code`, it must remain a genuine TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES member, never a foreign checkpoint code',
        );
      }
      assert.equal(
        failedEntry.checkpoint_code, checkpointErrorCode,
        "the checkpoint adapter's own closed code must be preserved unchanged in an explicit, dedicated checkpoint_code field",
      );
      assert.equal(
        JSON.stringify(failedEntry).includes(infraError.message), false,
        'the failed ledger entry must never embed the raw checkpoint adapter error text, only closed stage/code metadata',
      );
      return true;
    },
  );
  assert.equal(
    infraStore.storeCalls.some(call => call.stage === 'semantic_manifest'),
    false,
    'a checkpoint-store infrastructure failure must never allow a merged manifest checkpoint or final result to be produced',
  );
}

console.log('tender semantic discovery checkpoint hooks RED contract executed (Task 3)');
