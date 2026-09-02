import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_POLICY,
  TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
  TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES,
} from '../tender-semantic-discovery.js';
import {
  buildTenderSemanticLabelCatalog,
  buildTenderSemanticLabelOwnerIndex,
} from '../tender-semantic-label-catalog.js';
import {
  tenderSemanticObligationKey,
  toAgt002RequirementManifest,
  validateTenderSemanticManifest,
} from '../tender-semantic-manifest.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';
import { buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';

// AGT-002 V4 semantic discovery, policy v6 — exact-repeat coalescing.
//
// The blocker this file pins: with the label catalog globally unique by obligation key
// (tests/tender-semantic-discovery-label-catalog.test.mjs), the only remaining way live Luna can
// reach the obligation-key gate is by returning the SAME catalog label twice, with the same
// kind/front/category — which it does repeatedly. canonicalizeProposal rejected the second
// occurrence under `v4_discovery_uniqueness_invariant`, burning a whole provider turn over a
// restatement that carries no second claim, no second category and no second citation.
//
// v6 coalesces exactly that case, and only that case, BEFORE the obligation-key rejection and
// therefore before the manifest is assembled. This file proves:
//
//   1. the policy version moved to v6 and states the rule in one sentence;
//   2. an exact identical repetition yields exactly ONE manifest requirement with the same
//      server-derived citations/front evidence as the un-repeated proposal, and does not
//      double-count anywhere (requirement count, coverage ledger, canonical proposal hash);
//   3. a repeat with ANY conflicting explicit field (category, front, kind) is still rejected
//      fail-closed as `v4_discovery_uniqueness_invariant`, and the message exposes no label;
//   4. two DIFFERENT labels are never merged, no matter how similar;
//   5. source anchoring, the persisted projection and the coverage completion all stay valid.
//
// No provider, network, bridge, DB, environment or UI is touched: the client is a local fake.

const hash = value => createHash('sha256').update(value).digest('hex');

const SNAPSHOT_ID = '66666666-6666-4666-8666-666666666606';
const OPPORTUNITY_ID = '11111111-2222-4333-8444-666666666606';

const PARAGRAPHS = [
  'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria durante los ultimos cinco anos.',
  'El contratista entregara un informe mensual de operaciones dentro de los primeros dias habiles de cada mes.',
  'El plazo de ejecucion del contrato sera de doce meses contados a partir del acta de inicio del contrato.',
  'Queda prohibido subcontratar el servicio de monitoreo sin autorizacion previa y escrita de la entidad.',
];
const PLIEGO_TEXT = PARAGRAPHS.join('\n\n');

const documents = [{
  document_id: 'pliego',
  document_version_id: 'pliego-v1',
  opportunity_id: OPPORTUNITY_ID,
  snapshot_id: null,
  document_type: 'pliego',
  name: 'Pliego.pdf',
  version: 1,
  content_hash: hash(PLIEGO_TEXT),
  current: true,
  extracted_text: PLIEGO_TEXT,
}];

// The SAME inventory builder the analysis packet uses, so the ids below are the ids a real run of
// this snapshot would produce.
const inventory = buildAgt002TenderRequirementInventory({ snapshotId: SNAPSHOT_ID, documents, documentGaps: [] });
assert.equal(inventory.source_units.length, PARAGRAPHS.length, 'fixture must produce one analyzable unit per paragraph');

const unitHashById = new Map(inventory.source_units.map(unit => [unit.source_unit_id, unit.unit_hash]));
const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const packetUnits = [...resolvedTexts.entries()]
  .map(([sourceUnitId, value]) => ({ source_unit_id: sourceUnitId, text: value.text, source_text: value.text, index: value.index }))
  .sort((left, right) => left.index - right.index);
const unitIdByParagraph = PARAGRAPHS.map(paragraph => {
  const unit = packetUnits.find(entry => entry.text === paragraph);
  assert.ok(unit, 'fixture must resolve every paragraph to its own source unit');
  return unit.source_unit_id;
});

const catalog = buildTenderSemanticLabelCatalog({ units: packetUnits, maxCatalogChars: 40_000 });
const ownerIndex = buildTenderSemanticLabelOwnerIndex({
  orderedUnitIds: packetUnits.map(unit => unit.source_unit_id),
  candidatesByUnitId: catalog.candidates_by_unit_id,
});

/** A catalog candidate literally stated by exactly one source unit, and by no other. */
function candidateExclusiveTo(sourceUnitId) {
  const found = catalog.candidates.find(candidate => {
    const owners = ownerIndex.get(candidate) ?? [];
    return owners.length === 1 && owners[0] === sourceUnitId;
  });
  assert.ok(found, `fixture must expose a candidate exclusive to ${sourceUnitId}`);
  return found;
}

const LABEL_A = candidateExclusiveTo(unitIdByParagraph[0]);
const LABEL_B = candidateExclusiveTo(unitIdByParagraph[1]);
assert.notEqual(LABEL_A, LABEL_B, 'fixture must expose two distinct catalog labels');
assert.notEqual(
  tenderSemanticObligationKey(LABEL_A),
  tenderSemanticObligationKey(LABEL_B),
  'the two labels must name two different obligations, so nothing below turns on a key collision',
);

function requirement(label, overrides = {}) {
  return { kind: 'obligation', label, front: 'technical', category: 'technical', ...overrides };
}

function countingClient(proposal) {
  const captured = { calls: 0 };
  return {
    captured,
    run: async request => {
      captured.calls += 1;
      captured.request = request;
      return { content: JSON.stringify(proposal), usage: { input_tokens: 7, output_tokens: 9 } };
    },
  };
}

function run(proposal) {
  return discoverTenderSemanticManifest({
    client: countingClient(proposal),
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-v6-repeat-coalescing',
    inventory,
    documents,
  });
}

async function assertRejection(promiseFactory, { code, message }) {
  let caught;
  try {
    await promiseFactory();
    assert.fail('expected a rejection but none occurred');
  } catch (error) {
    caught = error;
  }
  assert.match(caught.message, message);
  assert.equal(caught.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION);
  assert.equal(caught.code, code, `expected code "${code}", got "${caught.code}" (message: ${caught.message})`);
  assert.ok(TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.includes(caught.code), 'code must be a closed catalog member');
  return caught;
}

// ---------------------------------------------------------------------------------------------
// 1. The canonical handling of a provider answer changed, so the policy version moved, and the
//    policy states the rule in exactly one truthful sentence: identical repetitions are
//    canonicalized once, conflicting ones reject.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(
    TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
    'tender-semantic-discovery.v7',
    'coalescing an exact repetition changes how a provider answer is canonicalized, and v7\'s '
    + 'multi-batch input is a further material change to what the model is asked, so the policy '
    + 'version must move',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Si repites una obligación con exactamente el mismo "label", "kind", "front" y "category", el servidor la canoniza una sola vez sin contarla dos veces/,
    'the policy must state that an exact repetition is canonicalized once',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /si repites esa etiqueta u obligación con algún campo distinto, se rechaza toda la propuesta/,
    'the policy must state that a conflicting repetition still rejects the whole proposal',
  );
  // The unchanged one-obligation-once rule is NOT withdrawn by the new sentence.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Propón cada obligación semántica una sola vez/,
    'the policy must keep asking for each obligation exactly once',
  );
}

// ---------------------------------------------------------------------------------------------
// 2. An exact identical repetition yields exactly ONE requirement, byte-identical to the
//    un-repeated proposal's, and is double-counted nowhere.
// ---------------------------------------------------------------------------------------------
const baseline = await run({
  requirements: [requirement(LABEL_A)],
  excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
  unresolved: [],
});

for (const repeats of [2, 3]) {
  const client = countingClient({
    requirements: Array.from({ length: repeats }, () => requirement(LABEL_A)),
    excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
    unresolved: [],
  });
  const coalesced = await discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-v6-repeat-coalescing',
    inventory,
    documents,
  });

  assert.equal(client.captured.calls, 1, 'coalescing happens locally: no retry and no second provider turn');
  assert.equal(
    coalesced.semanticManifest.requirements.length, 1,
    `${repeats} identical proposals of one obligation must canonicalize to exactly one requirement`,
  );
  // The whole requirement — id, label, front, derived citations and front evidence — is exactly the
  // one the un-repeated proposal produced. Nothing was merged, re-derived or re-numbered.
  assert.deepEqual(
    coalesced.semanticManifest.requirements[0],
    baseline.semanticManifest.requirements[0],
    'the surviving requirement must be identical to the one the un-repeated proposal produced',
  );
  assert.deepEqual(
    coalesced.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id),
    [unitIdByParagraph[0]],
    'the server-derived citations are unchanged by the repetition',
  );
  assert.equal(coalesced.semanticManifest.requirements[0].front_evidence.source_unit_id, unitIdByParagraph[0]);

  // Not double-counted anywhere the count is load-bearing.
  assert.equal(coalesced.semanticManifest.discovery_coverage.requirement_count, 1);
  assert.deepEqual(
    coalesced.semanticManifest.coverage_ledger,
    baseline.semanticManifest.coverage_ledger,
    'a repetition may not move a single coverage count',
  );
  // The canonical proposal hash is derived from the canonical requirements/dispositions, so an
  // identical hash proves the repetition left no trace in what is persisted.
  assert.equal(
    coalesced.semanticManifest.proposal_hash,
    baseline.semanticManifest.proposal_hash,
    'the canonical proposal must be byte-identical to the un-repeated one',
  );
  assert.deepEqual(
    coalesced.categoryOverrides,
    baseline.categoryOverrides,
    'the repetition must not add or change a category override',
  );

  // 5. Source anchoring, the persisted projection and the coverage completion stay valid.
  validateTenderSemanticManifest(coalesced.semanticManifest, { inventory, documents });
  for (const citation of coalesced.semanticManifest.requirements[0].citations) {
    assert.equal(
      citation.unit_hash, unitHashById.get(citation.source_unit_id),
      'every derived citation must still anchor to this snapshot\'s own source unit hash',
    );
  }
  assert.deepEqual(
    coalesced.semanticManifest.excluded.map(entry => entry.source_unit_id),
    [unitIdByParagraph[1]],
    'the explicit exclusion is untouched by coalescing',
  );
  assert.deepEqual(
    coalesced.semanticManifest.unresolved.map(entry => [entry.source_unit_id, entry.reason]),
    unitIdByParagraph.slice(2).map(sourceUnitId => [sourceUnitId, 'source_unit_not_dispositioned']),
    'the v4 coverage completion still preserves every unlisted unit, in source-packet order',
  );
  assert.equal(coalesced.semanticManifest.coverage_ledger.every_source_unit_disposed, true);
  assert.equal(coalesced.semanticManifest.discovery_coverage.status, 'partial');
  assert.equal(coalesced.semanticManifest.decision_ready, false);

  const projection = toAgt002RequirementManifest({
    semanticManifest: coalesced.semanticManifest, inventory, documents,
  });
  assert.equal(
    projection.requirement_manifest.length, 1,
    'the projection persisted for the analysis turn must carry the obligation exactly once',
  );
  assert.deepEqual(
    projection.requirement_manifest.map(entry => entry.requirement_id),
    toAgt002RequirementManifest({ semanticManifest: baseline.semanticManifest, inventory, documents })
      .requirement_manifest.map(entry => entry.requirement_id),
    'the projected requirement ids are unchanged by the repetition',
  );
}

// ---------------------------------------------------------------------------------------------
// 3. A repeat with ANY conflicting explicit field is still rejected fail-closed, under the
//    established closed code. Choosing between two categories/fronts/kinds for one obligation is
//    an inference this module never makes.
// ---------------------------------------------------------------------------------------------
for (const conflicting of [
  { category: 'habilitating' },
  { category: 'discard' },
  { front: 'legal' },
  { front: 'financial' },
  { kind: 'deliverable' },
  { kind: 'restriction' },
  { kind: 'condition', front: 'legal', category: 'financial_execution' },
]) {
  const caught = await assertRejection(
    () => run({
      requirements: [requirement(LABEL_A), requirement(LABEL_A, conflicting)],
      excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
      unresolved: [],
    }),
    { code: 'v4_discovery_uniqueness_invariant', message: /obligación vacía o duplicada/ },
  );
  // Privacy: the established safe message names the index only — never the label, never a
  // source_unit id, never a fragment of the expediente.
  for (const secret of [LABEL_A, LABEL_B, ...PARAGRAPHS, ...unitIdByParagraph]) {
    assert.ok(!caught.message.includes(secret), 'the rejection message must never expose a label, an id or source text');
  }
}

// The order of the conflict does not matter either: the SECOND field wins nothing, and a conflict
// discovered after an already-coalesced identical repeat still rejects the whole proposal.
await assertRejection(
  () => run({
    requirements: [requirement(LABEL_A), requirement(LABEL_A), requirement(LABEL_A, { category: 'habilitating' })],
    excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
    unresolved: [],
  }),
  { code: 'v4_discovery_uniqueness_invariant', message: /obligación vacía o duplicada/ },
);

// ---------------------------------------------------------------------------------------------
// 4. Two DIFFERENT labels are never merged — coalescing is exact-identity only, never similarity.
// ---------------------------------------------------------------------------------------------
{
  const twoObligations = await run({
    requirements: [requirement(LABEL_A), requirement(LABEL_B)],
    excluded: [],
    unresolved: [],
  });
  assert.equal(
    twoObligations.semanticManifest.requirements.length, 2,
    'two different labels must stay two requirements',
  );
  // Manifest requirements are ordered by their derived requirement_id, so compare as a set.
  assert.deepEqual(
    twoObligations.semanticManifest.requirements
      .map(entry => entry.citations.map(citation => citation.source_unit_id).join(','))
      .sort(),
    [unitIdByParagraph[0], unitIdByParagraph[1]].sort(),
    'each requirement keeps its own single server-derived citation; nothing is pooled or merged',
  );
  assert.deepEqual(
    twoObligations.semanticManifest.requirements.map(entry => entry.label).sort(),
    [LABEL_A, LABEL_B].sort(),
    'both labels survive as their own obligations',
  );
  assert.equal(
    new Set(twoObligations.semanticManifest.requirements.map(entry => entry.requirement_id)).size, 2,
    'two obligations must carry two distinct requirement ids',
  );

  // A near-miss of a catalog label is not "the same label with a transport artefact": it has no
  // derivable provenance at all and is still rejected on the anchor gate, never coalesced onto the
  // member it resembles.
  await assertRejection(
    () => run({
      requirements: [requirement(LABEL_A), requirement(`${LABEL_A} y sus anexos`)],
      excluded: [],
      unresolved: [],
    }),
    { code: 'v4_discovery_citation_anchor_invariant', message: /anclada literalmente/ },
  );
}

console.log('tests/tender-semantic-discovery-v6-repeat-coalescing.test.mjs OK');
