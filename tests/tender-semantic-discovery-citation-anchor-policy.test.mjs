import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_POLICY,
} from '../tender-semantic-discovery.js';

// Companion to tests/tender-semantic-discovery-post-response-classification.test.mjs, focused on
// the recurring real-model failure mode for v4_discovery_citation_anchor_invariant: the model
// paraphrases a label instead of copying it verbatim from a cited source_unit. canonicalizeProposal
// already normalizes NFC, collapses whitespace, and lowercases (es) before the literal `.includes`
// anchor check (normalizedForAnchor) — that check itself is NOT relaxed here. This file only pins
// the strengthened model-facing contract (policy text) and proves the anchor gate's existing
// behavior end to end: a paraphrase must still fail, and a literal quote that only differs by
// whitespace layout in the source text must still pass.

// The policy is the only lever available to reduce a real model's paraphrase rate — no fuzzy
// matching, repair, or label derivation is introduced anywhere in canonicalizeProposal.
{
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /copia literal y contigua/,
    'policy must require label to be a literal, contiguous copy',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /no parafrasees/i,
    'policy must explicitly forbid paraphrasing the label',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /prefijos|numeraci[oó]n/i,
    'policy must forbid prefixes/numbering added to the label',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /puntos suspensivos|comillas/i,
    'policy must forbid added ellipses/quotes/punctuation not present in the source text',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /antes de responder.*subcadena exacta y literal/is,
    'policy must instruct a final self-check that every label is an exact normalized substring',
  );
}

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

// Source paragraphs are whitespace-collapsed at the inventory layer itself (a single `\n` already
// splits paragraphs there), so the "whitespace-normalized quote passes" case below has to inject
// its irregular whitespace on the PROPOSED LABEL side, not the source text — exactly what
// normalizedForAnchor's own whitespace collapse (applied to both label and unit text) exists to
// absorb.
const documents = [document({
  id: 'pliego',
  version: 'v1',
  text: [
    'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria.',
    'El oferente debera aportar certificacion de disponibilidad de personal bilingue.',
  ].join('\n\n'),
})];

const inventory = buildTenderRequirementInventory({ snapshotId: 'snap-citation-anchor-policy', documents, documentGaps: [] });
assert.equal(inventory.source_units.length, 2, 'fixture must produce exactly two analyzable source units');

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
    idempotencyKey: 'idem-citation-anchor-policy',
    inventory,
    documents,
  });
}

// Literal quote, whitespace-normalized: the proposed label has doubled interior spaces the model's
// own generation introduced (the source text itself has single spaces only) — after
// normalizedForAnchor collapses whitespace on both sides, it must still anchor and pass. (A raw
// newline/tab is deliberately NOT used here: assembleTenderSemanticManifest's own label validation
// rejects control characters regardless of anchoring, so it is not a whitespace-normalization case.)
{
  const result = await run({
    requirements: [baseRequirement({ label: 'experiencia  especifica  en  vigilancia hospitalaria' })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  });
  assert.equal(result.semanticManifest.requirements.length, 1, 'a whitespace-normalized literal quote must still be accepted');
  assert.equal(
    result.semanticManifest.requirements[0].label,
    'experiencia  especifica  en  vigilancia hospitalaria',
    'the canonicalized label preserves the original text (only trimmed/NFC-normalized), never rewritten',
  );
}

// Paraphrase: reordered/reworded text that is semantically equivalent but not a literal substring
// of the cited source_unit must still be rejected — this is the exact recurring real-model failure
// this policy strengthening targets, and the anchor gate itself must not be relaxed to accept it.
await assert.rejects(
  () => run({
    requirements: [baseRequirement({ label: 'experiencia en el ambito de vigilancia para hospitales' })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  }),
  /anclada literalmente/,
  'a paraphrased label must be rejected by the (unrelaxed) literal anchor gate',
);

// A label with an added prefix/numbering the policy forbids ("1. " is not part of the source text)
// must also be rejected by the same unrelaxed anchor gate, since it is no longer a literal substring.
await assert.rejects(
  () => run({
    requirements: [baseRequirement({ label: '1. experiencia especifica en vigilancia hospitalaria' })],
    excluded: [{ source_unit_id: unitB.source_unit_id, reason: 'descriptive_or_contextual' }],
    unresolved: [],
  }),
  /anclada literalmente/,
  'a label with an added prefix/numbering must be rejected by the literal anchor gate',
);

console.log('tests/tender-semantic-discovery-citation-anchor-policy.test.mjs OK');
