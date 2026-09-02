import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import { discoverTenderSemanticManifest } from '../tender-semantic-discovery.js';
import { validateTenderSemanticManifest, TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS } from '../tender-semantic-manifest.js';

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
// The liquidity unit is already cited by the derived binding, so disposing of it again is an
// overlap, not a second opinion.
await rejectsProposal(proposal => { proposal.excluded.push({ source_unit_id: liquidity.source_unit_id, reason: 'not_an_obligation' }); }, /disposici|duplicad|unidad/i);

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
