import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_POLICY,
} from '../tender-semantic-discovery.js';

// Companion to tests/tender-semantic-discovery-citation-anchor-policy.test.mjs, for the OTHER
// recurring real-model failure mode: a V4 run that passed provider/schema/citation gates and then
// failed v4_discovery_uniqueness_invariant, while a repeat over the same schema produced a
// duplicate-free proposal. That is stochastic noncompliance with a rule the policy never stated,
// not an architecture defect — the previous policy text only demanded integral coverage ("dispón
// todas las source_units"), which a model can satisfy while double-proposing one obligation.
//
// So the ONLY change under test is model-facing policy text. canonicalizeProposal, the wire schema,
// the label catalog, the validators, the vocabularies, the output keys, the policy version, the
// bridge and the retry behaviour are all untouched: nothing here deduplicates or repairs a model
// answer. This file pins (a) that the three uniqueness rules are actually stated to the model, and
// (b) that the unchanged local gates still reject every duplicate shape fail-closed.

// ---------------------------------------------------------------------------------------------
// (a) The policy states the three uniqueness rules.
// ---------------------------------------------------------------------------------------------
{
  // 1. Within a requirement, source_unit_ids never repeats an id.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /"source_unit_ids" no puede repetir ningún identificador/,
    'policy must forbid a repeated source_unit_id inside one requirement',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /cita cada source_unit_id a lo sumo una vez por requisito/,
    'policy must state the per-requirement at-most-once citation rule explicitly',
  );

  // 2. One requirement per semantic obligation: no two labels deriving the same normalized key.
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
  // The prescribed remedy is consolidation into ONE requirement, never dropping a cited unit.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /consolida esas unidades citándolas todas en un único requisito/,
    'policy must resolve a duplicated obligation by consolidating the cited units into one requirement',
  );

  // 3. Dispositions never repeat and never overlap a cited unit.
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
    /Cada unidad recibe exactamente una disposición/,
    'policy must state the exactly-one-disposition rule',
  );
}

// ---------------------------------------------------------------------------------------------
// (b) The unchanged local gates still reject every duplicate shape.
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

// Both paragraphs name the SAME obligation subject, differing only by capitalization — the exact
// pair that lets two literally-anchored labels still fold to one obligation key
// (tenderSemanticObligationKey strips accents, lowercases and separates on non-alphanumerics), so
// the duplicate-obligation case below fails on the key, never on the anchor gate.
const documents = [document({
  id: 'pliego',
  version: 'v1',
  text: [
    'El oferente debera acreditar experiencia especifica en Vigilancia hospitalaria.',
    'El contratista debera garantizar vigilancia hospitalaria permanente durante la ejecucion.',
  ].join('\n\n'),
})];

const inventory = buildTenderRequirementInventory({ snapshotId: 'snap-uniqueness-policy', documents, documentGaps: [] });
assert.equal(inventory.source_units.length, 2, 'fixture must produce exactly two analyzable source units');

// source_units are keyed by content hash, not paragraph order, so each unit is resolved by its own
// text rather than by array index.
const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const unitA = inventory.source_units.find(unit => resolvedTexts.get(unit.source_unit_id)?.text.includes('experiencia especifica'));
const unitB = inventory.source_units.find(unit => resolvedTexts.get(unit.source_unit_id)?.text.includes('garantizar vigilancia'));
assert.ok(unitA && unitB && unitA.source_unit_id !== unitB.source_unit_id, 'fixture must resolve both source units unambiguously');

function requirement(overrides = {}) {
  return {
    kind: 'obligation',
    label: 'Vigilancia hospitalaria',
    front: 'technical',
    category: 'technical',
    front_evidence_source_unit_id: unitA.source_unit_id,
    source_unit_ids: [unitA.source_unit_id],
    ...overrides,
  };
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
// uniqueness reason under test and not because the fixture is malformed.
{
  const result = await run({
    requirements: [requirement()],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  });
  assert.equal(result.semanticManifest.requirements.length, 1);
}

// Rule 1 — a requirement citing the same source_unit twice is still rejected locally.
await assert.rejects(
  () => run({
    requirements: [requirement({ source_unit_ids: [unitA.source_unit_id, unitA.source_unit_id] })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  }),
  /source_unit duplicada/,
  'a repeated source_unit_id inside one requirement must still be rejected fail-closed',
);

// Rule 2 — two requirements whose distinct, individually anchored labels fold to the SAME
// obligation key are still rejected. Both labels are literal excerpts of the unit each one cites,
// so this proves the obligation-key gate rejects them, not the citation-anchor gate. Nothing
// merges them: the whole proposal is rejected.
await assert.rejects(
  () => run({
    requirements: [
      requirement({ label: 'Vigilancia hospitalaria', source_unit_ids: [unitA.source_unit_id] }),
      requirement({
        label: 'vigilancia hospitalaria',
        front_evidence_source_unit_id: unitB.source_unit_id,
        source_unit_ids: [unitB.source_unit_id],
      }),
    ],
    excluded: [],
    unresolved: [],
  }),
  /obligación vacía o duplicada/,
  'two labels deriving the same normalized obligation key must still be rejected fail-closed',
);

// Rule 2, prescribed remedy — the SAME two units consolidated into one requirement is accepted,
// and the accepted requirement keeps both citations (the policy never asks the model to drop a
// unit to resolve a duplicate).
{
  const result = await run({
    requirements: [requirement({ source_unit_ids: [unitA.source_unit_id, unitB.source_unit_id] })],
    excluded: [],
    unresolved: [],
  });
  assert.equal(result.semanticManifest.requirements.length, 1, 'consolidation into a single requirement must be accepted');
  assert.deepEqual(
    result.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id).sort(),
    [unitA.source_unit_id, unitB.source_unit_id].sort(),
    'the consolidated requirement must keep every cited unit',
  );
}

// Rule 3 — the same unit excluded twice is still rejected.
await assert.rejects(
  () => run({
    requirements: [requirement()],
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
    requirements: [requirement()],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [{ source_unit_id: unitB.source_unit_id, reason: 'obligation_not_classifiable' }],
  }),
  /disposición duplicada/,
  'a source_unit appearing in both excluded and unresolved must still be rejected fail-closed',
);

// Rule 3 — a unit already cited by a requirement may not also be dispositioned.
await assert.rejects(
  () => run({
    requirements: [requirement()],
    excluded: [
      { source_unit_id: unitA.source_unit_id, reason: 'duplicate_source_unit' },
      { source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' },
    ],
    unresolved: [],
  }),
  /disposición duplicada/,
  'a cited source_unit must not also be excluded',
);

await assert.rejects(
  () => run({
    requirements: [requirement()],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [{ source_unit_id: unitA.source_unit_id, reason: 'obligation_not_classifiable' }],
  }),
  /disposición duplicada/,
  'a cited source_unit must not also be reported unresolved',
);

console.log('tests/tender-semantic-discovery-uniqueness-policy.test.mjs OK');
