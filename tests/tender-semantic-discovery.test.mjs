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

function validProposal() {
  return {
    requirements: [
      {
        kind: 'condition',
        label: 'Índice de liquidez',
        front: 'financial',
        category: 'financial_execution',
        front_evidence_source_unit_id: financialHeading.source_unit_id,
        source_unit_ids: [liquidity.source_unit_id],
      },
      {
        kind: 'obligation',
        label: 'Centro de monitoreo',
        front: 'technical',
        category: 'technical',
        front_evidence_source_unit_id: technicalHeading.source_unit_id,
        source_unit_ids: [monitoring.source_unit_id],
      },
    ],
    excluded: [],
    unresolved: [],
  };
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
  });

  validateTenderSemanticManifest(result.semanticManifest, { inventory: INVENTORY });
  assert.equal(result.semanticManifest.origin, 'model_proposal');
  assert.equal(result.semanticManifest.discovery_coverage.status, 'complete');
  assert.equal(result.semanticManifest.analyzed_coverage.status, 'incomplete');
  assert.equal(result.semanticManifest.decision_ready, false);
  assert.equal(result.semanticManifest.requirements.length, 2);
  assert.deepEqual(Object.values(result.categoryOverrides).sort(), ['financial_execution', 'technical']);
  assert.equal(result.usage.input_tokens, 100);
  assert.equal(result.usage.output_tokens, 30);
  assert.equal(captured.idempotencyKey, 'run-1:semantic-discovery');
  assert.deepEqual(captured.outputSchema.properties.requirements.items.properties.category.enum,
    ['discard', 'habilitating', 'technical', 'financial_execution']);
  assert.equal(captured.input.source_units.every(unit => typeof unit.text === 'string' && !Object.hasOwn(unit, 'document')), true);
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

await rejectsProposal(proposal => { proposal.requirements[0].label = 'Capital de trabajo'; }, /etiqueta|texto|fuente|anclad/i);
await rejectsProposal(proposal => { proposal.requirements[0].category = 'strategic'; }, /categor|esquema|propuesta/i);
await rejectsProposal(proposal => { proposal.requirements[0].source_unit_ids = ['unit:foreign']; }, /unidad|source_unit|permitid|propuesta/i);
await rejectsProposal(proposal => { proposal.excluded.push({ source_unit_id: liquidity.source_unit_id, reason: 'not_an_obligation' }); }, /disposici|duplicad|unidad/i);
await rejectsProposal(proposal => { proposal.requirements.splice(1, 1); }, /disponer|cobertura|unidad|faltante/i);

{
  const otherSnapshot = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const otherInventory = inventory(otherSnapshot, DOCUMENTS);
  const otherUnits = sourceUnitsFor(otherInventory, DOCUMENTS);
  const proposal = validProposal();
  proposal.requirements[0].source_unit_ids = [otherUnits.find(unit => unit.text.includes('Índice')).source_unit_id];
  await assert.rejects(
    discoverTenderSemanticManifest({
      client: { run: async () => ({ content: JSON.stringify(proposal), usage: { input_tokens: 1, output_tokens: 1 } }) },
      model: 'test-model', timeoutMs: 1000, idempotencyKey: 'foreign', inventory: INVENTORY, documents: DOCUMENTS,
    }),
    /unidad|source_unit|permitid|snapshot/i,
  );
}

console.log('tender semantic discovery fail-closed contract passed');
