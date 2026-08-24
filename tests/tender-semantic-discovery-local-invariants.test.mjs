import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest } from '../tender-semantic-discovery.js';

// Root-cause fix companion suite (AGT-002 V4 discoverTenderSemanticManifest immediate provider
// failure): the wire fix strips `uniqueItems` from the outputSchema sent to Codex App Server
// (tests/agt002-preview-codex-client.test.mjs). This file proves the OTHER half of the invariant
// the task requires: the label bounds keep being enforced LOCALLY, after the response, by
// canonicalizeProposal/assembleTenderSemanticManifest — never by the provider's best-effort
// compliance with the wire schema. None of these checks depend on what the wire schema declares;
// a hostile/non-compliant provider response must still be rejected fail-closed.
//
// Policy v3 update: the `minItems`/`uniqueItems` cases that used to live here were about
// `requirements[].source_unit_ids`, a field the wire contract no longer has at all — the server
// now derives every requirement citation from its own label catalog
// (tests/tender-semantic-discovery-derived-citations.test.mjs). What replaces them here is the
// stronger local invariant: a proposal that still sends a requirement source id is rejected rather
// than having the field ignored, and the wire schema no longer declares one.

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

const inventory = buildTenderRequirementInventory({ snapshotId: 'snap-local-invariants', documents, documentGaps: [] });
assert.equal(inventory.source_units.length, 2, 'fixture must produce exactly two analyzable source units');

// source_units are ordered by source_unit_id (a content hash), not by paragraph position, so the
// unit that literally carries the requirement's label is found by its resolved text, never assumed
// by array index.
const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const unitA = inventory.source_units.find(unit => resolvedTexts.get(unit.source_unit_id)?.text.includes('vigilancia hospitalaria'));
const unitB = inventory.source_units.find(unit => unit.source_unit_id !== unitA.source_unit_id);
assert.ok(unitA && unitB, 'fixture must resolve both source units unambiguously');

// v3: a requirement is exactly {kind, label, front, category}. The label is a member of this
// snapshot's own literal catalog, and the citation back to unitA is DERIVED from it — nothing here
// tells the server which unit to cite.
function baseRequirement(overrides = {}) {
  return {
    kind: 'obligation',
    label: 'experiencia especifica en vigilancia hospitalaria',
    front: 'technical',
    category: 'technical',
    ...overrides,
  };
}

function fakeClient(proposal) {
  const captured = {};
  return {
    captured,
    run: async request => {
      captured.request = request;
      return { content: JSON.stringify(proposal), usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
}

function runWith(client) {
  return discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-local-invariants',
    inventory,
    documents,
  });
}

function run(proposal) {
  return runWith(fakeClient(proposal));
}

// Sanity: the fixture proposal itself is valid end to end (proves the negative cases below fail
// for the reason under test, not because the fixture is malformed). It also proves the citation
// the model never sent: front evidence and citations both resolve to unitA, derived from the label.
{
  const client = fakeClient({
    requirements: [baseRequirement()],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  });
  const result = await runWith(client);
  assert.equal(result.semanticManifest.requirements.length, 1);
  assert.equal(result.semanticManifest.requirements[0].front_evidence.source_unit_id, unitA.source_unit_id);
  assert.deepEqual(
    result.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id),
    [unitA.source_unit_id],
  );

  // The wire schema itself no longer declares any requirement source id, so there is no
  // model-provided id left for the local gates to have to reconcile with the label.
  const items = client.captured.request.outputSchema.properties.requirements.items;
  assert.deepEqual(Object.keys(items.properties).sort(), ['category', 'front', 'kind', 'label']);
  assert.deepEqual([...items.required].sort(), ['category', 'front', 'kind', 'label']);
}

// A requirement source id is never accepted from the model — the field is rejected outright rather
// than ignored, so a legacy or hostile answer can never smuggle a citation past the derived map.
for (const smuggled of [
  { source_unit_ids: [unitB.source_unit_id] },
  { source_unit_ids: [unitA.source_unit_id, unitA.source_unit_id] },
  { source_unit_ids: [] },
  { front_evidence_source_unit_id: unitB.source_unit_id },
]) {
  await assert.rejects(
    () => run({
      requirements: [baseRequirement(smuggled)],
      excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
      unresolved: [],
    }),
    /claves inválidas/,
    'a model-provided requirement source id must be rejected locally regardless of the wire schema',
  );
}

// minLength semantics: a label shorter than 3 characters must still be rejected locally.
await assert.rejects(
  () => run({
    requirements: [baseRequirement({ label: 'ab' })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  }),
  /etiqueta inválida/,
  'a too-short label must be rejected locally regardless of the wire schema',
);

// maxLength semantics: a label longer than 160 characters must still be rejected locally.
await assert.rejects(
  () => run({
    requirements: [baseRequirement({ label: 'x'.repeat(161) })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  }),
  /etiqueta inválida/,
  'a too-long label must be rejected locally regardless of the wire schema',
);

// enum semantics: a within-bounds label that is not a member of this request's own literal catalog
// has no derivable provenance at all, so it is rejected rather than matched fuzzily or paired with
// an invented source. The wire enum is advisory; this local gate is the boundary.
await assert.rejects(
  () => run({
    requirements: [baseRequirement({ label: 'experiencia en el ambito de vigilancia para hospitales' })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  }),
  /anclada literalmente/,
  'a label outside the catalog must be rejected locally regardless of the wire schema',
);

console.log('tests/tender-semantic-discovery-local-invariants.test.mjs OK');
