import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest } from '../tender-semantic-discovery.js';

// Root-cause fix companion suite (AGT-002 V4 discoverTenderSemanticManifest immediate provider
// failure): the wire fix strips `uniqueItems` from the outputSchema sent to Codex App Server
// (tests/agt002-preview-codex-client.test.mjs). This file proves the OTHER half of the invariant
// the task requires: minLength/maxLength/minItems/uniqueItems keep being enforced LOCALLY, after
// the response, by canonicalizeProposal/assembleTenderSemanticManifest — never by the provider's
// best-effort compliance with the wire schema. None of these checks depend on what the wire
// schema declares; a hostile/non-compliant provider response must still be rejected fail-closed.

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

function baseRequirement(overrides = {}) {
  return {
    kind: 'obligation',
    label: 'experiencia especifica en vigilancia hospitalaria',
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
    idempotencyKey: 'idem-local-invariants',
    inventory,
    documents,
  });
}

// Sanity: the fixture proposal itself is valid end to end (proves the negative cases below fail
// for the reason under test, not because the fixture is malformed).
{
  const result = await run({
    requirements: [baseRequirement()],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  });
  assert.equal(result.semanticManifest.requirements.length, 1);
}

// uniqueItems semantics: a requirement citing the same source_unit_id twice must still be
// rejected locally even though the wire schema no longer declares uniqueItems.
await assert.rejects(
  () => run({
    requirements: [baseRequirement({ source_unit_ids: [unitA.source_unit_id, unitA.source_unit_id] })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  }),
  /source_unit duplicada/,
  'a duplicated source_unit_id must be rejected locally regardless of the wire schema',
);

// minItems semantics: an empty source_unit_ids array must still be rejected locally.
await assert.rejects(
  () => run({
    requirements: [baseRequirement({ source_unit_ids: [] })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  }),
  /debe citar al menos una source_unit/,
  'an empty source_unit_ids array must be rejected locally regardless of the wire schema',
);

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

console.log('tests/tender-semantic-discovery-local-invariants.test.mjs OK');
