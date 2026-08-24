import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
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
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';

// AGT-002 V4 semantic discovery, policy v3 (architectural remediation after three successive
// prompt/schema fixes).
//
// Real V4 failures proved what the wire JSON Schema cannot do: it can constrain `label` to a
// closed catalog enum AND constrain `source_unit_ids[]`/`front_evidence_source_unit_id` to real
// ids, but it cannot express the ONLY constraint that mattered — that the excerpt chosen for
// `label` belongs to the units those ids name. Every schema-valid answer that got the relation
// wrong burned a full provider turn and died at canonicalizeProposal's anchor gate.
//
// v3 deletes the relation instead of guarding it. A requirement on the wire is exactly
// {kind, label, front, category}; the model never sends a source id for a requirement at all, and
// the server derives `front_evidence`/`citations` from the same deterministic catalog it built the
// enum from. This file pins that contract end to end:
//   * the wire schema no longer contains requirement source-id fields;
//   * a label drawn from unit A yields front evidence and citations pointing at A, with the model
//     supplying no ids whatsoever;
//   * an identical label present in A and B yields deterministic citations to BOTH, with a stable
//     primary owner;
//   * a model-supplied requirement source id is rejected, never read;
//   * excluded/unresolved overlapping a DERIVED owner is rejected fail-closed;
//   * omitted units stay unresolved, and under policy v4 a visible unit the proposal never listed
//     is COMPLETED into unresolved instead of destroying the turn
//     (tests/tender-semantic-discovery-coverage-completion.test.mjs pins that end to end);
//   * a label outside the catalog is rejected, with no fuzzy matching and no invented source.
// No provider, network, bridge, DB or environment is touched anywhere below.

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

// P0/P1 are distinct paragraphs (each yields excerpts exclusive to itself). P2/P3 deliberately
// share one identical clause behind different lead-ins, which is the only way a single catalog
// candidate can be literally stated by two different source units — the co-ownership case the
// derived mapping has to resolve deterministically.
const SHARED_CLAUSE = 'El contratista debera mantener la poliza de cumplimiento vigente durante toda la ejecucion del contrato';
const PARAGRAPHS = [
  'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria durante los ultimos cinco anos.',
  'El contratista entregara un informe mensual de operaciones dentro de los primeros cinco dias habiles de cada mes.',
  `Anexo tecnico primero. ${SHARED_CLAUSE}.`,
  `Anexo tecnico segundo. ${SHARED_CLAUSE}.`,
];

const documents = [document({ id: 'pliego', version: 'v1', text: PARAGRAPHS.join('\n\n') })];
const inventory = buildTenderRequirementInventory({ snapshotId: 'snap-derived-citations', documents, documentGaps: [] });
assert.equal(inventory.source_units.length, PARAGRAPHS.length, 'fixture must produce one analyzable unit per paragraph');

const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });

// The exact packet order discoverTenderSemanticManifest itself builds (single document, so
// paragraph index decides). Everything about determinism below is stated against this order.
const packetUnits = [...resolvedTexts.entries()]
  .map(([sourceUnitId, value]) => ({ source_unit_id: sourceUnitId, text: value.text, source_text: value.text, index: value.index }))
  .sort((left, right) => left.index - right.index);
const unitIdByParagraph = PARAGRAPHS.map(paragraph => {
  const unit = packetUnits.find(entry => entry.text === paragraph);
  assert.ok(unit, `fixture must resolve the source unit for: ${paragraph.slice(0, 40)}`);
  return unit.source_unit_id;
});

const catalog = buildTenderSemanticLabelCatalog({ units: packetUnits, maxCatalogChars: 40_000 });
const ownerIndex = buildTenderSemanticLabelOwnerIndex({
  orderedUnitIds: packetUnits.map(unit => unit.source_unit_id),
  candidatesByUnitId: catalog.candidates_by_unit_id,
});

/** A catalog candidate literally stated by exactly the given source units, and by no other. */
function candidateOwnedByExactly(sourceUnitIds) {
  const expected = [...sourceUnitIds];
  const found = catalog.candidates.find(candidate => {
    const owners = ownerIndex.get(candidate) ?? [];
    return owners.length === expected.length && expected.every((id, position) => owners[position] === id);
  });
  assert.ok(found, `fixture must expose a candidate owned by exactly ${expected.length} unit(s)`);
  return found;
}

const soloCandidate = candidateOwnedByExactly([unitIdByParagraph[0]]);
const sharedCandidate = candidateOwnedByExactly([unitIdByParagraph[2], unitIdByParagraph[3]]);

function requirement(label, overrides = {}) {
  return { kind: 'obligation', label, front: 'technical', category: 'technical', ...overrides };
}

/** Disposes every visible unit the derived mapping does not already claim — the v3 model duty. */
function proposalFor(requirements, derivedOwnerIds, { excluded = [], unresolved = [] } = {}) {
  const claimed = new Set([...derivedOwnerIds, ...excluded.map(entry => entry.source_unit_id), ...unresolved.map(entry => entry.source_unit_id)]);
  return {
    requirements,
    excluded: [
      ...excluded,
      ...packetUnits
        .filter(unit => !claimed.has(unit.source_unit_id))
        .map(unit => ({ source_unit_id: unit.source_unit_id, reason: 'descriptive_or_contextual' })),
    ],
    unresolved,
  };
}

function capturingClient(proposal) {
  const captured = {};
  return {
    captured,
    run: async request => {
      captured.request = request;
      return { content: JSON.stringify(proposal), usage: { input_tokens: 3, output_tokens: 4 } };
    },
  };
}

function run(client, overrides = {}) {
  return discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-derived-citations',
    inventory,
    documents,
    ...overrides,
  });
}

async function assertRejection(promiseFactory, { stage, code, message }) {
  let caught;
  try {
    await promiseFactory();
    assert.fail('expected a rejection but none occurred');
  } catch (error) {
    caught = error;
  }
  assert.match(caught.message, message);
  assert.equal(caught.stage, stage, `expected stage "${stage}", got "${caught.stage}" (message: ${caught.message})`);
  assert.equal(caught.code, code, `expected code "${code}", got "${caught.code}" (message: ${caught.message})`);
  assert.ok(TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.includes(caught.code), 'code must be a closed catalog member');
  return caught;
}

// ---------------------------------------------------------------------------------------------
// The wire contract changed, so the policy version moved with it.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(
    TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
    'tender-semantic-discovery.v5',
    'removing the requirement source-id fields (v3), making coverage fail-safe (v4) and then making '
    + 'the dispositions themselves optional (v5) are all material changes to what the model is asked '
    + 'for and to how the answer is canonicalized, so the policy version must move with them',
  );
}

// ---------------------------------------------------------------------------------------------
// 1. The wire schema no longer contains ANY requirement source-id field.
// ---------------------------------------------------------------------------------------------
let capturedRequest;
{
  const client = capturingClient(proposalFor([requirement(soloCandidate)], [unitIdByParagraph[0]]));
  await run(client);
  capturedRequest = client.captured.request;

  const items = capturedRequest.outputSchema.properties.requirements.items;
  assert.deepEqual(
    Object.keys(items.properties).sort(),
    ['category', 'front', 'kind', 'label'],
    'a wire requirement declares exactly {kind, label, front, category}',
  );
  assert.deepEqual(
    [...items.required].sort(),
    ['category', 'front', 'kind', 'label'],
    'the required list must match the four declared fields exactly',
  );
  assert.equal(items.additionalProperties, false, 'a wire requirement must stay a closed object');
  for (const removed of ['source_unit_ids', 'front_evidence_source_unit_id']) {
    assert.equal(Object.hasOwn(items.properties, removed), false, `${removed} must be gone from the wire schema`);
    assert.ok(
      !JSON.stringify(capturedRequest.outputSchema.properties.requirements).includes(removed),
      `${removed} must not appear anywhere under requirements on the wire`,
    );
  }
  // The allowed-source-id enum survives ONLY for the two model-owned disposition lists.
  const allowedIds = packetUnits.map(unit => unit.source_unit_id).sort();
  for (const field of ['excluded', 'unresolved']) {
    assert.deepEqual(
      [...capturedRequest.outputSchema.properties[field].items.properties.source_unit_id.enum].sort(),
      allowedIds,
      `${field} must still pin the snapshot's own source_unit_id enum`,
    );
  }

  // The policy the model reads matches the schema it is answering: no contradictory instruction
  // about requirement source ids survives, and the derived binding + coverage duty are stated.
  assert.doesNotMatch(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /"source_unit_ids" no puede repetir|de una de las source_unit_ids listadas|source_unit_ids que citas/,
    'no instruction about requirement-level source_unit_ids may survive the field being removed',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Las citas se vinculan automáticamente/,
    'the policy must state that citations are bound automatically by the server',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /no envíes "source_unit_ids", ni "front_evidence_source_unit_id"/,
    'the policy must forbid sending any requirement source id',
  );
  // v5: the disposition lists hold ONLY units the derived binding left over — unchanged — but the
  // model is no longer told it must list all of them there (see
  // tests/tender-semantic-discovery-v5-obligation-contract.test.mjs).
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Dispón allí, si acaso, sólo unidades restantes/,
    'the policy must confine excluded/unresolved to units no requirement already cites, without demanding all of them',
  );
  assert.doesNotMatch(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /todas ellas/,
    'no residue of the exhaustive-enumeration demand may survive in the policy',
  );
}

// ---------------------------------------------------------------------------------------------
// 2. A label drawn from unit A yields front evidence and citations from A — with the model
//    supplying no source id at all.
// ---------------------------------------------------------------------------------------------
{
  const unitA = unitIdByParagraph[0];
  const proposal = proposalFor([requirement(soloCandidate)], [unitA]);
  // The proposal the fake provider returns carries no source id anywhere in its requirements: the
  // citations asserted below are derived, not echoed.
  assert.deepEqual(Object.keys(proposal.requirements[0]).sort(), ['category', 'front', 'kind', 'label']);

  const result = await run(capturingClient(proposal));
  assert.equal(result.semanticManifest.requirements.length, 1);
  const [derived] = result.semanticManifest.requirements;
  assert.equal(derived.label, soloCandidate, 'the canonical label is the catalog member itself');
  assert.equal(derived.front_evidence.source_unit_id, unitA, 'front evidence must be derived to unit A');
  assert.deepEqual(
    derived.citations.map(citation => citation.source_unit_id),
    [unitA],
    'citations must be derived to exactly the owning unit, with no model-provided id',
  );
  assert.equal(
    derived.front_evidence.unit_hash,
    inventory.source_units.find(unit => unit.source_unit_id === unitA).unit_hash,
    'the hash is re-derived from the inventory, never from the model',
  );

  // Output object shape is unchanged for every existing caller.
  assert.deepEqual(Object.keys(result).sort(), ['categoryOverrides', 'semanticManifest', 'usage']);
  // And the canonical requirement shape is unchanged: {kind,label,front,front_evidence,citations}
  // plus the server-owned identity fields the assembler has always added.
  assert.deepEqual(
    Object.keys(derived).sort(),
    ['citations', 'front', 'front_evidence', 'kind', 'label', 'obligation_key', 'requirement_id', 'supplemental_signal_ids'],
  );
}

// ---------------------------------------------------------------------------------------------
// 3. An identical label present in A and B cites BOTH, deterministically, with a stable primary
//    owner — and the model still supplies nothing.
// ---------------------------------------------------------------------------------------------
{
  const ownerA = unitIdByParagraph[2];
  const ownerB = unitIdByParagraph[3];
  assert.deepEqual(
    [...ownerIndex.get(sharedCandidate)],
    [ownerA, ownerB],
    'the shared clause must be owned by both units, in source-packet order',
  );

  const proposal = proposalFor([requirement(sharedCandidate)], [ownerA, ownerB]);
  const first = await run(capturingClient(proposal));
  const second = await run(capturingClient(proposal));

  for (const result of [first, second]) {
    assert.equal(result.semanticManifest.requirements.length, 1);
    const [derived] = result.semanticManifest.requirements;
    assert.deepEqual(
      derived.citations.map(citation => citation.source_unit_id).sort(),
      [ownerA, ownerB].sort(),
      'both owning units must be cited',
    );
    assert.equal(
      derived.front_evidence.source_unit_id,
      ownerA,
      'the primary owner is the first owner in source-packet order, deterministically',
    );
  }
  assert.equal(
    first.semanticManifest.semantic_manifest_hash,
    second.semanticManifest.semantic_manifest_hash,
    'the same snapshot and the same proposal must derive a byte-identical manifest',
  );
}

// ---------------------------------------------------------------------------------------------
// 4. No source id is ever accepted from the model for a requirement.
// ---------------------------------------------------------------------------------------------
for (const smuggled of [
  { source_unit_ids: [unitIdByParagraph[1]] },
  { front_evidence_source_unit_id: unitIdByParagraph[1] },
]) {
  await assertRejection(
    () => run(capturingClient(proposalFor([requirement(soloCandidate, smuggled)], [unitIdByParagraph[0]]))),
    {
      stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION,
      code: 'v4_discovery_shape_invariant',
      message: /claves inválidas/,
    },
  );
}

// ---------------------------------------------------------------------------------------------
// 5. excluded/unresolved overlapping a DERIVED owner is rejected fail-closed. The model cannot see
//    the mapping it is contradicting, which is exactly why the policy tells it the rule; nothing
//    here silently drops the disposition or the citation.
// ---------------------------------------------------------------------------------------------
{
  const ownerA = unitIdByParagraph[2];
  const ownerB = unitIdByParagraph[3];
  for (const [field, entry] of [
    ['excluded', { source_unit_id: ownerB, reason: 'duplicate_source_unit' }],
    ['unresolved', { source_unit_id: ownerB, reason: 'obligation_not_classifiable' }],
  ]) {
    await assertRejection(
      () => run(capturingClient(proposalFor(
        [requirement(sharedCandidate)],
        [ownerA, ownerB],
        { [field]: [entry] },
      ))),
      {
        stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION,
        code: 'v4_discovery_uniqueness_invariant',
        message: /disposición duplicada/,
      },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Coverage is COMPLETED, not destroyed: a visible unit the proposal never listed becomes an
//    unresolved entry (v4), and every OMITTED unit stays unresolved exactly as before.
// ---------------------------------------------------------------------------------------------
{
  // A proposal that got one requirement right and simply never disposed of the other three visible
  // units. Under v1..v3 this threw 'v4_discovery_coverage_invariant' and the correct requirement
  // died with it; under v4 the requirement survives and the three unlisted units are recorded.
  const completed = await run(capturingClient({
    requirements: [requirement(soloCandidate)],
    excluded: [],
    unresolved: [],
  }));
  assert.equal(completed.semanticManifest.requirements.length, 1, 'the correct requirement must survive the omission');
  assert.deepEqual(
    completed.semanticManifest.unresolved
      .map(entry => [entry.source_unit_id, entry.origin, entry.reason])
      .sort(([left], [right]) => left.localeCompare(right)),
    unitIdByParagraph.slice(1)
      .map(sourceUnitId => [sourceUnitId, 'semantic', 'source_unit_not_dispositioned'])
      .sort(([left], [right]) => left.localeCompare(right)),
    'every visible unit the model left unlisted must be preserved as unresolved, never dropped',
  );
  // The omission still blocks the decision — that is what makes completing it safe.
  assert.equal(completed.semanticManifest.coverage_ledger.every_source_unit_disposed, true);
  assert.equal(completed.semanticManifest.discovery_coverage.status, 'partial');
  assert.equal(completed.semanticManifest.decision_ready, false);
  assert.equal(completed.semanticManifest.recommendation, 'pause');

  // A source budget that only fits the first paragraph. The label catalog keeps its own (ample)
  // budget, so this exercises omission, not the catalog's fail-closed coverage gate.
  const client = capturingClient({
    requirements: [requirement(soloCandidate)],
    excluded: [],
    unresolved: [],
  });
  const result = await run(client, { maxSourceChars: PARAGRAPHS[0].length, maxLabelCatalogChars: 40_000 });

  assert.deepEqual(
    client.captured.request.input.source_units.map(unit => unit.source_unit_id),
    [unitIdByParagraph[0]],
    'only the first paragraph fits the source budget',
  );
  assert.deepEqual(
    [...client.captured.request.input.omitted_source_unit_ids].sort(),
    unitIdByParagraph.slice(1).sort(),
    'the remaining paragraphs are declared omitted to the model',
  );
  const unresolvedById = new Map(result.semanticManifest.unresolved.map(entry => [entry.source_unit_id, entry]));
  for (const omittedId of unitIdByParagraph.slice(1)) {
    assert.equal(
      unresolvedById.get(omittedId)?.reason,
      'source_unit_not_dispositioned',
      'an omitted unit must stay visibly unresolved, never silently absent',
    );
  }
  assert.equal(result.semanticManifest.requirements[0].citations.length, 1, 'only visible units can own a label');
  assert.equal(result.semanticManifest.coverage_ledger.every_source_unit_disposed, true);
}

// ---------------------------------------------------------------------------------------------
// 7. A label outside the catalog is rejected locally — no fuzzy matching, no invented source.
// ---------------------------------------------------------------------------------------------
{
  const enumValues = capturedRequest.outputSchema.properties.requirements.items.properties.label.enum;
  for (const outsider of [
    'requisito inventado que no aparece en el texto',                 // pure hallucination
    'experiencia en el ambito de vigilancia para hospitales',         // paraphrase of paragraph 0
    `1. ${soloCandidate}`,                                            // real excerpt with a prefix
    soloCandidate.replace(' ', '  '),                                 // real excerpt, respaced
    soloCandidate.slice(0, Math.floor(soloCandidate.length / 2)),     // a real, but uncataloged, span
  ]) {
    assert.ok(!enumValues.includes(outsider), `fixture case must be outside the enum: ${outsider.slice(0, 40)}`);
    await assertRejection(
      () => run(capturingClient(proposalFor([requirement(outsider)], [unitIdByParagraph[0]]))),
      {
        stage: AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION,
        code: 'v4_discovery_citation_anchor_invariant',
        message: /anclada literalmente/,
      },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// 8. The reverse mapping itself: deterministic, containment-complete, and empty for a label it
//    does not know — which is the input canonicalizeProposal rejects rather than citing nothing.
// ---------------------------------------------------------------------------------------------
{
  const orderedUnitIds = packetUnits.map(unit => unit.source_unit_id);
  const rebuilt = buildTenderSemanticLabelOwnerIndex({ orderedUnitIds, candidatesByUnitId: catalog.candidates_by_unit_id });
  assert.deepEqual(
    [...rebuilt].map(([candidate, owners]) => [candidate, [...owners]]),
    [...ownerIndex].map(([candidate, owners]) => [candidate, [...owners]]),
    'the owner index must be identical across builds',
  );

  // Reversing the unit order reverses each owner list, proving the order is the packet's and not
  // an accident of Map iteration.
  const reversed = buildTenderSemanticLabelOwnerIndex({
    orderedUnitIds: [...orderedUnitIds].reverse(),
    candidatesByUnitId: catalog.candidates_by_unit_id,
  });
  assert.deepEqual(
    [...reversed.get(sharedCandidate)],
    [...ownerIndex.get(sharedCandidate)].reverse(),
    'owner order follows the given source-packet order',
  );

  // Every credited candidate is literally stated by every unit credited with it, in BOTH the
  // redacted text the model receives and the snapshot's own text the validators re-anchor against.
  for (const [candidate, owners] of ownerIndex) {
    for (const ownerId of owners) {
      const unit = packetUnits.find(entry => entry.source_unit_id === ownerId);
      assert.ok(unit.text.includes(candidate), `candidate not literal in owner ${ownerId}: ${JSON.stringify(candidate)}`);
      assert.ok(unit.source_text.includes(candidate), `candidate not literal in owner source text ${ownerId}`);
    }
  }
  // Containment-completeness: if a unit's text states a catalog candidate, that unit owns it.
  for (const candidate of catalog.candidates) {
    for (const unit of packetUnits) {
      if (!unit.text.includes(candidate) || !unit.source_text.includes(candidate)) continue;
      assert.ok(
        (ownerIndex.get(candidate) ?? []).includes(unit.source_unit_id),
        `unit ${unit.source_unit_id} states ${JSON.stringify(candidate)} but does not own it`,
      );
    }
  }

  assert.equal(ownerIndex.get('un fragmento que no existe en este catalogo'), undefined, 'an unknown label owns nothing');
  assert.ok(Object.isFrozen(ownerIndex.get(sharedCandidate)), 'derived owner lists are server-owned and immutable');
  assert.throws(
    () => buildTenderSemanticLabelOwnerIndex({ orderedUnitIds, candidatesByUnitId: {} }),
    /mapa de candidatos por unidad/,
    'the index refuses anything but the catalog\'s own map',
  );
}

console.log('tests/tender-semantic-discovery-derived-citations.test.mjs OK');
