import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_POLICY,
} from '../tender-semantic-discovery.js';
import {
  buildTenderSemanticLabelCatalog,
  buildTenderSemanticLabelOwnerIndex,
} from '../tender-semantic-label-catalog.js';
import { tenderSemanticObligationKey } from '../tender-semantic-manifest.js';

// Companion to tests/tender-semantic-discovery-citation-anchor-policy.test.mjs, for the OTHER
// recurring real-model failure mode: a V4 run that passed provider/schema/citation gates and then
// failed v4_discovery_uniqueness_invariant, while a repeat over the same schema produced a
// duplicate-free proposal.
//
// Under policy v3 the uniqueness surface itself changed shape, because the wire contract did. A
// requirement is exactly {kind, label, front, category}: it carries NO source id at all, and the
// server derives `front_evidence`/`citations` from the label's ownership in this snapshot's own
// literal catalog (tests/tender-semantic-discovery-derived-citations.test.mjs pins that end to
// end). So:
//
//   * the old per-requirement rule ("source_unit_ids never repeats an id") is not weakened, it is
//     unrepresentable — there is no id list to repeat, and a requirement that ships one is rejected
//     outright as an invalid shape rather than de-duplicated;
//   * "one requirement per semantic obligation" survives unchanged, and is still the model's duty:
//     two labels folding to the same normalized obligation key are still rejected fail-closed;
//   * "one disposition per unit" survives and now also governs the DERIVED citations: a unit the
//     server binds to some label may not additionally appear in excluded/unresolved.
//
// Nothing here deduplicates, merges or repairs a model answer, and no gate is relaxed: this file
// pins (a) that the v3 rules are actually stated to the model, and (b) that the local gates still
// reject every duplicate shape fail-closed.

// ---------------------------------------------------------------------------------------------
// (a) The policy states the v3 rules.
// ---------------------------------------------------------------------------------------------
{
  // 1. A requirement carries no identifiers whatsoever — the field the old rule governed is gone.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Cada requisito tiene exactamente cuatro campos: "kind", "label", "front" y "category"/,
    'policy must state the exact four-field requirement shape',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /no envíes "source_unit_ids", ni "front_evidence_source_unit_id", ni ningún otro identificador dentro de un requisito/,
    'policy must forbid sending any source identifier inside a requirement',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Usa exclusivamente source_unit_id recibidos, y sólo dentro de "excluded" y "unresolved"/,
    'policy must confine model-chosen source ids to the two disposition lists',
  );
  // And no instruction about a requirement-level id list may survive the field being removed:
  // telling a model to keep a list unique while the schema no longer declares it is exactly the
  // contradiction that produced answers this module then had to reject.
  assert.doesNotMatch(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /"source_unit_ids" no puede repetir|cita cada source_unit_id a lo sumo una vez por requisito/,
    'the old per-requirement citation-uniqueness sentences must be gone with the field',
  );

  // 2. Citations are derived by the server from label ownership, so there is no relation left for
  //    the model to get wrong — and the rule is checkable by the model from the packet it has.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Las citas se vinculan automáticamente: el servidor deriva las source_units de cada requisito a partir del fragmento que elijas en "label"/,
    'policy must state that the server derives each requirement citation from the chosen label',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Toda unidad fuente visible cuyo texto contenga literalmente ese fragmento queda citada por ese requisito/,
    'policy must state the containment rule that decides which units a label cites',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /la primera de ellas en el orden en que recibiste las unidades queda como evidencia del front/,
    'policy must state the deterministic primary owner that becomes front evidence',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Tú no eliges, no propones y no puedes alterar esas citas/,
    'policy must state that the derived citations are not the model\'s to choose or change',
  );

  // 3. One requirement per semantic obligation: no two labels deriving the same normalized key.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Propón cada obligación semántica una sola vez/,
    'policy must require each semantic obligation to be proposed exactly once',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /dos requisitos no pueden usar etiquetas que deriven la misma clave de obligación normalizada/,
    'policy must forbid two requirements whose labels derive the same normalized obligation key',
  );
  // The model can only comply if it knows the normalization the key is derived under
  // (tenderSemanticObligationKey: accent-folded, lowercased, non-alphanumerics as separators).
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /minúsculas, sin tildes y con todo signo no alfanumérico tratado como separador/,
    'policy must describe the obligation-key normalization so equivalent labels are recognizable',
  );
  // The v3 remedy is still consolidation and still never drops a unit — but the model consolidates
  // by choosing ONE fragment, because the server, not the model, then binds every unit that states
  // it.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /propón un único requisito con un solo fragmento: el servidor consolida por sí mismo todas las unidades que contienen ese fragmento/,
    'policy must resolve a duplicated obligation by one fragment the server consolidates on',
  );

  // 4. Dispositions never repeat, and never overlap a DERIVED citation.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /ningún source_unit_id puede aparecer dos veces en "excluded", dos veces en "unresolved", ni en ambas listas/,
    'policy must forbid a repeated id across/within excluded and unresolved',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /ni figurar en alguna de ellas si ya está citado por un requisito/,
    'policy must forbid disposing a unit that a requirement already cites',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /No incluyas en "excluded" ni en "unresolved" ninguna unidad cuyo texto contenga literalmente un fragmento que hayas elegido como "label"/,
    'policy must state the overlap rule in the derived form the model can actually check',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Dispón allí exactamente las unidades restantes, todas ellas/,
    'policy must state that the model disposes exactly the units the derived binding leaves over',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Cada unidad recibe exactamente una disposición/,
    'policy must state the exactly-one-disposition rule',
  );
}

// ---------------------------------------------------------------------------------------------
// (b) The local gates still reject every duplicate shape.
// ---------------------------------------------------------------------------------------------
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

// Both paragraphs state the SAME obligation clause, differing only by capitalization behind
// distinct lead-ins. That is the only way this snapshot's catalog can offer two DIFFERENT literal
// candidates — one exclusive to each unit — that still fold to a single obligation key
// (tenderSemanticObligationKey strips accents, lowercases and separates on non-alphanumerics), so
// the duplicate-obligation case below fails on the key and never on the anchor gate. The lead-ins
// also leave shorter spans that both paragraphs state verbatim, which is the co-ownership the
// consolidation remedy needs.
const documents = [document({
  id: 'pliego',
  version: 'v1',
  text: [
    'Anexo tecnico primero. Vigilancia hospitalaria permanente durante toda la ejecucion del contrato.',
    'Anexo tecnico segundo. vigilancia hospitalaria permanente durante toda la ejecucion del contrato.',
  ].join('\n\n'),
})];

const inventory = buildTenderRequirementInventory({ snapshotId: 'snap-uniqueness-policy', documents, documentGaps: [] });
assert.equal(inventory.source_units.length, 2, 'fixture must produce exactly two analyzable source units');

// source_units are keyed by content hash, not paragraph order, so each unit is resolved by its own
// text. `index` is the paragraph order the discovery source packet itself sorts by, and therefore
// the order the derived owner lists follow.
const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const packetUnits = [...resolvedTexts.entries()]
  .map(([sourceUnitId, value]) => ({ source_unit_id: sourceUnitId, text: value.text, source_text: value.text, index: value.index }))
  .sort((left, right) => left.index - right.index);
const unitA = packetUnits.find(unit => unit.text.includes('Anexo tecnico primero'));
const unitB = packetUnits.find(unit => unit.text.includes('Anexo tecnico segundo'));
assert.ok(unitA && unitB && unitA.source_unit_id !== unitB.source_unit_id, 'fixture must resolve both source units unambiguously');
assert.deepEqual(
  packetUnits.map(unit => unit.source_unit_id),
  [unitA.source_unit_id, unitB.source_unit_id],
  'the source packet orders the first paragraph before the second',
);

// The same catalog + reverse mapping discoverTenderSemanticManifest builds for this snapshot: the
// labels below are chosen from it, so every rejection is about uniqueness and never about a label
// the catalog does not contain.
const catalog = buildTenderSemanticLabelCatalog({ units: packetUnits, maxCatalogChars: 40_000 });
const ownerIndex = buildTenderSemanticLabelOwnerIndex({
  orderedUnitIds: packetUnits.map(unit => unit.source_unit_id),
  candidatesByUnitId: catalog.candidates_by_unit_id,
});

/** A catalog candidate literally stated by exactly the given source units, in that order. */
function candidateOwnedByExactly(sourceUnitIds) {
  const found = catalog.candidates.find(candidate => {
    const owners = ownerIndex.get(candidate) ?? [];
    return owners.length === sourceUnitIds.length && sourceUnitIds.every((id, position) => owners[position] === id);
  });
  assert.ok(found, `fixture must expose a candidate owned by exactly ${sourceUnitIds.length} unit(s)`);
  return found;
}

/** Two DIFFERENT catalog candidates that fold to one obligation key, owned by disjoint units. */
function collidingObligationCandidates() {
  for (const first of catalog.candidates) {
    for (const second of catalog.candidates) {
      if (first === second) continue;
      if (tenderSemanticObligationKey(first) !== tenderSemanticObligationKey(second)) continue;
      const firstOwners = ownerIndex.get(first) ?? [];
      const secondOwners = ownerIndex.get(second) ?? [];
      if (firstOwners.some(sourceUnitId => secondOwners.includes(sourceUnitId))) continue;
      return [first, second];
    }
  }
  return assert.fail('fixture must expose two catalog candidates folding to the same obligation key');
}

const [obligationOnA, obligationOnB] = collidingObligationCandidates();
assert.deepEqual([...ownerIndex.get(obligationOnA)], [unitA.source_unit_id], 'the first colliding label must be exclusive to unit A');
assert.deepEqual([...ownerIndex.get(obligationOnB)], [unitB.source_unit_id], 'the second colliding label must be exclusive to unit B');
assert.equal(
  tenderSemanticObligationKey(obligationOnA),
  tenderSemanticObligationKey(obligationOnB),
  'the two colliding labels must fold to one obligation key',
);

// A single fragment both paragraphs state verbatim: the server binds BOTH units to it, which is
// what the consolidation remedy relies on.
const sharedCandidate = candidateOwnedByExactly([unitA.source_unit_id, unitB.source_unit_id]);

// v3: exactly the four fields the model may decide. No identifier appears here.
function requirement(label, overrides = {}) {
  return { kind: 'obligation', label, front: 'technical', category: 'technical', ...overrides };
}

function fakeClient(proposal) {
  return { run: async () => ({ content: JSON.stringify(proposal), usage: { input_tokens: 1, output_tokens: 1 } }) };
}

function run(proposal) {
  return discoverTenderSemanticManifest({
    client: fakeClient(proposal),
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-uniqueness-policy',
    inventory,
    documents,
  });
}

// Sanity: the fixture proposal is valid end to end, so every rejection below fails for the
// uniqueness reason under test and not because the fixture is malformed. The requirement names no
// unit at all; its single citation is derived from the label's ownership.
{
  const result = await run({
    requirements: [requirement(obligationOnA)],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  });
  assert.equal(result.semanticManifest.requirements.length, 1);
  assert.deepEqual(
    result.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id),
    [unitA.source_unit_id],
    'the accepted requirement cites exactly the unit the catalog binds to its label',
  );
}

// Rule 1 — a requirement may not carry a source identifier at all. The old "same id twice in one
// requirement" case is not merely rejected, it is unrepresentable: there is no id list on the wire,
// and an answer that ships one is rejected as an invalid shape rather than deduplicated.
for (const smuggled of [
  { source_unit_ids: [unitA.source_unit_id] },
  { source_unit_ids: [unitA.source_unit_id, unitA.source_unit_id] },
  { front_evidence_source_unit_id: unitA.source_unit_id },
]) {
  await assert.rejects(
    () => run({
      requirements: [requirement(obligationOnA, smuggled)],
      excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
      unresolved: [],
    }),
    /claves inválidas/,
    'a requirement carrying any model-provided source id must be rejected fail-closed',
  );
}

// Rule 2 — two requirements whose distinct, individually anchored labels fold to the SAME
// obligation key are still rejected. Both labels are catalog members owned by the unit each one is
// derived to, so this proves the obligation-key gate rejects them, not the citation-anchor gate.
// Nothing merges them: the whole proposal is rejected.
await assert.rejects(
  () => run({
    requirements: [requirement(obligationOnA), requirement(obligationOnB)],
    excluded: [],
    unresolved: [],
  }),
  /obligación vacía o duplicada/,
  'two labels deriving the same normalized obligation key must still be rejected fail-closed',
);

// Rule 2, prescribed remedy — ONE requirement carrying the fragment both units state is accepted,
// and the server consolidates both units into it (the policy never asks the model to drop a unit,
// and never asks it to name one).
{
  const result = await run({
    requirements: [requirement(sharedCandidate)],
    excluded: [],
    unresolved: [],
  });
  assert.equal(result.semanticManifest.requirements.length, 1, 'consolidation into a single requirement must be accepted');
  assert.deepEqual(
    result.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id).sort(),
    [unitA.source_unit_id, unitB.source_unit_id].sort(),
    'the consolidated requirement must keep every unit the fragment binds',
  );
  assert.equal(
    result.semanticManifest.requirements[0].front_evidence.source_unit_id,
    unitA.source_unit_id,
    'front evidence is the first owner in source-packet order, deterministically',
  );
  assert.equal(result.semanticManifest.coverage_ledger.every_source_unit_disposed, true);
}

// Rule 3 — the same unit excluded twice is still rejected.
await assert.rejects(
  () => run({
    requirements: [requirement(obligationOnA)],
    excluded: [
      { source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' },
      { source_unit_id: unitB.source_unit_id, reason: 'not_an_obligation' },
    ],
    unresolved: [],
  }),
  /disposición duplicada/,
  'a source_unit excluded twice must still be rejected fail-closed',
);

// Rule 3 — the same unit in both disposition lists is still rejected.
await assert.rejects(
  () => run({
    requirements: [requirement(obligationOnA)],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [{ source_unit_id: unitB.source_unit_id, reason: 'obligation_not_classifiable' }],
  }),
  /disposición duplicada/,
  'a source_unit appearing in both excluded and unresolved must still be rejected fail-closed',
);

// Rule 3 — a unit the server DERIVED as a citation may not also be dispositioned. The model cannot
// see the mapping it is contradicting, which is exactly why the policy states the rule in terms of
// the fragment it did choose; nothing here silently drops the disposition or the citation.
await assert.rejects(
  () => run({
    requirements: [requirement(obligationOnA)],
    excluded: [
      { source_unit_id: unitA.source_unit_id, reason: 'duplicate_source_unit' },
      { source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' },
    ],
    unresolved: [],
  }),
  /disposición duplicada/,
  'a derived-cited source_unit must not also be excluded',
);

await assert.rejects(
  () => run({
    requirements: [requirement(obligationOnA)],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [{ source_unit_id: unitA.source_unit_id, reason: 'obligation_not_classifiable' }],
  }),
  /disposición duplicada/,
  'a derived-cited source_unit must not also be reported unresolved',
);

// Rule 3, over a CO-OWNED label: the second unit the server binds is just as undisposable as the
// first, even though the model never named either of them.
for (const [field, entry] of [
  ['excluded', { source_unit_id: unitB.source_unit_id, reason: 'duplicate_source_unit' }],
  ['unresolved', { source_unit_id: unitB.source_unit_id, reason: 'obligation_not_classifiable' }],
]) {
  await assert.rejects(
    () => run({
      requirements: [requirement(sharedCandidate)],
      excluded: [],
      unresolved: [],
      [field]: [entry],
    }),
    /disposición duplicada/,
    `a co-owned derived citation must not also appear in ${field}`,
  );
}

console.log('tests/tender-semantic-discovery-uniqueness-policy.test.mjs OK');
