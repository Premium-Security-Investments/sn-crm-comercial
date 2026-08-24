import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest, TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES } from '../tender-semantic-discovery.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';

// RED (TDD) companion to tests/tender-semantic-discovery-local-invariants.test.mjs and
// tests/agt002-post-bridge-observability.test.mjs: the real job f7f3dbcc symptom this fix targets
// (bridge invocation started=true, response_received=true, bridge success latency ~63.7s, non-empty
// content) but the worker catch logged stage='unexpected', error_code='AGT002_UNEXPECTED_ERROR'.
// Root cause: every post-response rejection thrown by discoverTenderSemanticManifest (this file's
// subject) was a PLAIN, untyped `new Error(...)` — no `.stage`, no `.code` — so agt002-preview-
// engine.js's generic catch could only ever wrap it as the engine's own opaque SAFE_UNAVAILABLE,
// which agt002-post-bridge-observability.js's classifyEnginePhase then has no choice but to
// classify as 'unexpected' once the bridge has already answered. This file pins that every
// post-response rejection now carries a real, closed `.stage` (AGT002_OUTPUT_REJECTION_STAGES) and
// a stable, closed internal `.code` (TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES) — WITHOUT
// relaxing any citation/uniqueness/inventory gate: every fixture below that makes a WRONG CLAIM is
// still, and must remain, rejected.
//
// Policy v4 changes exactly one of these fixtures, and only because it was never a wrong claim: a
// proposal that omits a visible source_unit asserted nothing about it, so it is completed into
// `unresolved` rather than rejected (see the coverage block below). Every other rejection here is
// untouched.

const hash = value => createHash('sha256').update(value).digest('hex');
const document = ({ id, version, text }) => ({
  document_id: id,
  document_version_id: version,
  content_hash: hash(text),
  extracted_text: text,
  document_type: 'pliego',
  name: `${id}.pdf`,
  current: true,
});

const documents = [document({
  id: 'pliego',
  version: 'v1',
  text: [
    'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria.',
    'El oferente debera aportar certificacion de disponibilidad de personal bilingue.',
  ].join('\n\n'),
})];

const inventory = buildTenderRequirementInventory({ snapshotId: 'snap-post-response', documents, documentGaps: [] });
assert.equal(inventory.source_units.length, 2, 'fixture must produce exactly two analyzable source units');

const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const unitA = inventory.source_units.find(unit => resolvedTexts.get(unit.source_unit_id)?.text.includes('vigilancia hospitalaria'));
const unitB = inventory.source_units.find(unit => unit.source_unit_id !== unitA.source_unit_id);
assert.ok(unitA && unitB, 'fixture must resolve both source units unambiguously');

// v3: a requirement carries no source id at all; unitA is CITED because the label is a catalog
// excerpt of unitA's own text, derived server-side (see
// tests/tender-semantic-discovery-derived-citations.test.mjs).
function baseRequirement(overrides = {}) {
  return {
    kind: 'obligation',
    label: 'experiencia especifica en vigilancia hospitalaria',
    front: 'technical',
    category: 'technical',
    ...overrides,
  };
}

function fakeClient(raw) {
  return { run: async () => raw };
}

function run(raw) {
  return discoverTenderSemanticManifest({
    client: fakeClient(raw),
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-post-response',
    inventory,
    documents,
  });
}

async function assertRejection(promiseFactory, { stage, code }) {
  let caught;
  try {
    await promiseFactory();
    assert.fail('expected a rejection but none occurred');
  } catch (error) {
    caught = error;
  }
  assert.equal(caught.stage, stage, `expected stage "${stage}", got "${caught.stage}" (message: ${caught.message})`);
  assert.equal(caught.code, code, `expected code "${code}", got "${caught.code}" (message: ${caught.message})`);
  assert.ok(TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.includes(caught.code), 'code must be a closed catalog member');
  return caught;
}

// Sanity: the catalog is closed and immutable, mirroring AGT002_V3_SAFE_VALIDATION_CODES.
// It deliberately keeps 'v4_discovery_citation_inventory_invariant' and
// 'v4_discovery_citation_missing_invariant' even though no fixture below can reach them any more:
// under v3 a requirement's citations are derived by the server from its own catalog, so those two
// now guard a server-side derivation rather than a model answer. They stay distinct, closed
// members so a future catalog/packet divergence surfaces as its own diagnosable code instead of
// collapsing into the generic 'v4_discovery_invariant_violation' fallback.
{
  assert.ok(Array.isArray(TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES));
  assert.ok(Object.isFrozen(TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES));
  assert.throws(() => TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.push('hostile'), TypeError);
  for (const preserved of ['v4_discovery_citation_inventory_invariant', 'v4_discovery_citation_missing_invariant']) {
    assert.ok(TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.includes(preserved), `${preserved} must stay a closed catalog member`);
  }
}

// Missing/empty content: distinct stage from JSON parse, matching agt002-preview-engine.js's own
// runOnce/runOnceV3 split.
await assertRejection(
  () => run({ content: '', usage: { input_tokens: 1, output_tokens: 1 } }),
  { stage: AGT002_OUTPUT_REJECTION_STAGES.CONTENT_EXTRACTION, code: 'v4_discovery_missing_content' },
);

// Non-JSON content after a real bridge response.
await assertRejection(
  () => run({ content: '```json\n{not valid json\n```', usage: { input_tokens: 1, output_tokens: 1 } }),
  { stage: AGT002_OUTPUT_REJECTION_STAGES.JSON_PARSE, code: 'v4_discovery_invalid_json' },
);

// Well-formed JSON, but invalid/missing usage.
await assertRejection(
  () => run({
    content: JSON.stringify({
      requirements: [baseRequirement()],
      excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
      unresolved: [],
    }),
    usage: { input_tokens: -1, output_tokens: 0 },
  }),
  { stage: AGT002_OUTPUT_REJECTION_STAGES.USAGE, code: 'v4_discovery_invalid_usage' },
);

function semanticProposal(proposal) {
  return { content: JSON.stringify(proposal), usage: { input_tokens: 5, output_tokens: 5 } };
}

// Citation gate (anchor): a label outside this request's own literal catalog — a hallucinated
// label on otherwise schema-valid JSON. This is the recurring real-model failure, and under v3 it
// is also the ONLY citation subcode a non-compliant provider can still reach: the other two guard
// a mapping the server derives itself. The code is deliberately unchanged, so an existing
// diagnostic consumer's attribution keeps meaning what it meant.
await assertRejection(
  () => run(semanticProposal({
    requirements: [baseRequirement({ label: 'requisito inventado que no aparece en el texto' })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  })),
  { stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION, code: 'v4_discovery_citation_anchor_invariant' },
);

// A real catalog excerpt of unitA is accepted and cites unitA; a real excerpt is NOT accepted
// merely because it is real — the paraphrase above and the respaced variant below both fail the
// same gate, with no fuzzy repair.
await assertRejection(
  () => run(semanticProposal({
    requirements: [baseRequirement({ label: 'experiencia  especifica  en vigilancia hospitalaria' })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  })),
  { stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION, code: 'v4_discovery_citation_anchor_invariant' },
);

// Shape gate: any source id inside a requirement. The v3 wire contract has no such field, so a
// proposal carrying one is a contract violation classified as a shape invariant — never read, and
// never allowed to override the derived citation.
for (const smuggled of [
  { source_unit_ids: ['hallucinated-source-unit-id'] },
  { source_unit_ids: [unitA.source_unit_id, unitA.source_unit_id] },
  { source_unit_ids: [] },
  { front_evidence_source_unit_id: 'hallucinated-source-unit-id' },
]) {
  await assertRejection(
    () => run(semanticProposal({
      requirements: [baseRequirement(smuggled)],
      excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
      unresolved: [],
    })),
    { stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION, code: 'v4_discovery_shape_invariant' },
  );
}

// Uniqueness gate: a unit the derived citation already claims may not also be dispositioned.
await assertRejection(
  () => run(semanticProposal({
    requirements: [baseRequirement()],
    excluded: [
      { source_unit_id: unitA.source_unit_id, reason: 'duplicate_source_unit' },
      { source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' },
    ],
    unresolved: [],
  })),
  { stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION, code: 'v4_discovery_uniqueness_invariant' },
);

// Coverage: a visible source_unit the proposal never disposed of at all (dropped unitB) is NOT a
// post-response rejection under policy v4. An omission is not a wrong claim — nothing was asserted
// about unitB — so the turn survives and the unit is completed into `unresolved` under the closed
// reason 'source_unit_not_dispositioned', which keeps the run paused and non-decidable.
// 'v4_discovery_coverage_invariant' consequently has no live producer; it stays a closed catalog
// member (asserted below) purely so a diagnostic already recorded under v1..v3 keeps classifying to
// the code it was recorded with.
{
  const result = await run(semanticProposal({
    requirements: [baseRequirement()],
    excluded: [],
    unresolved: [],
  }));
  assert.deepEqual(
    result.semanticManifest.unresolved.map(entry => [entry.source_unit_id, entry.origin, entry.reason]),
    [[unitB.source_unit_id, 'semantic', 'source_unit_not_dispositioned']],
  );
  assert.equal(result.semanticManifest.discovery_coverage.status, 'partial');
  assert.equal(result.semanticManifest.decision_ready, false);
  assert.ok(
    TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.includes('v4_discovery_coverage_invariant'),
    'the coverage code stays a closed catalog member for already-closed historical diagnostics',
  );
}

// Inventory gate: a disposition referencing a source_unit_id outside this snapshot's inventory
// (a hallucinated id a compliant wire schema would reject, but a hostile/non-compliant provider
// response must still be rejected locally, exactly like the uniqueItems-stripped wire schema).
await assertRejection(
  () => run(semanticProposal({
    requirements: [baseRequirement()],
    excluded: [{ source_unit_id: 'hallucinated-source-unit-id', reason: 'descriptive_or_contextual' }],
    unresolved: [],
  })),
  { stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION, code: 'v4_discovery_inventory_invariant' },
);

// Shape gate: a requirement whose category falls outside the closed vocabulary.
await assertRejection(
  () => run(semanticProposal({
    requirements: [baseRequirement({ category: 'not_a_real_category' })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  })),
  { stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION, code: 'v4_discovery_shape_invariant' },
);

// Never leaks a hallucinated id or the model's label text into the tagged error's own structural
// fields (stage/code stay closed catalog members; only `.message` — never read by a caller outside
// this module for classification — may still carry it for local debugging).
{
  const caught = await assertRejection(
    () => run(semanticProposal({
      requirements: [baseRequirement()],
      excluded: [{ source_unit_id: 'hallucinated-source-unit-id', reason: 'descriptive_or_contextual' }],
      unresolved: [],
    })),
    { stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION, code: 'v4_discovery_inventory_invariant' },
  );
  assert.equal(typeof caught.stage, 'string');
  assert.equal(typeof caught.code, 'string');
}

console.log('tests/tender-semantic-discovery-post-response-classification.test.mjs OK');
