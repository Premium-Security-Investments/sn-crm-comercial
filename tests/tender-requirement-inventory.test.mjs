import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildTenderRequirementInventory,
  isTenderDocumentContentHashVerifiable,
  validateTenderRequirementInventory,
  UNVERIFIABLE_CONTENT_HASH_REASON,
} from '../tender-requirement-inventory.js';

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

const tenderA = [
  document({ id: 'a-pliego', version: 'a-v1', text: [
    'El oferente debe acreditar experiencia específica en vigilancia hospitalaria.',
    'Debe aportar certificación de disponibilidad de personal bilingüe.',
    'La propuesta debe incluir un plan de continuidad operativa.',
  ].join('\n\n') }),
];
const tenderB = [
  document({ id: 'b-pliego', version: 'b-v1', text: [
    'La entidad exige protocolo de ciberseguridad para el centro de monitoreo.',
    'El contratista entregará radios satelitales interoperables.',
  ].join('\n\n') }),
];

// The inventory is derived from each tender's documentary units, not the historic four-regex catalog.
{
  const inventoryA = buildTenderRequirementInventory({ snapshotId: 'snapshot-a', documents: tenderA, documentGaps: [] });
  const inventoryB = buildTenderRequirementInventory({ snapshotId: 'snapshot-b', documents: tenderB, documentGaps: [] });

  assert.equal(inventoryA.requirements.length, 3);
  assert.equal(inventoryB.requirements.length, 2);
  assert.notDeepEqual(inventoryA.requirements.map(item => item.requirement_id), inventoryB.requirements.map(item => item.requirement_id));
  assert.equal(inventoryA.requirements.some(item => item.supplemental_signal_ids.length > 0), false, 'a documentary-only requirement must not require a legacy regex signal');
  assert.equal(inventoryA.expedient_coverage.status, 'complete');
  assert.equal(inventoryA.analyzed_coverage.status, 'incomplete');
  assert.equal(inventoryA.decision_ready, false);
  assert.equal(inventoryA.recommendation, 'pause');
  assert.equal(inventoryA.human_review_required, true);
}

// Every gap is visible in the ledger and blocks the decision; it is never silently dropped.
{
  const inventory = buildTenderRequirementInventory({
    snapshotId: 'snapshot-gap',
    documents: tenderA,
    documentGaps: [{ document_id: 'missing-addendum', reason: 'download_failed' }],
  });
  assert.equal(inventory.expedient_coverage.status, 'partial');
  assert.equal(inventory.coverage_ledger.unresolved_visible_count, 1);
  assert.equal(inventory.source_units.find(unit => unit.document_id === 'missing-addendum').disposition, 'unresolved_visible');
  assert.equal(inventory.decision_ready, false);
  assert.equal(inventory.recommendation, 'pause');
}

// Citations are server allowlisted by source unit and exact hash; tampering fails closed.
{
  const inventory = buildTenderRequirementInventory({ snapshotId: 'snapshot-citation', documents: tenderA, documentGaps: [] });
  const invalid = structuredClone(inventory);
  invalid.requirements[0].citations[0].unit_hash = hash('forged');
  assert.throws(() => validateTenderRequirementInventory(invalid), /cita|hash|allowlist/i);
}

// A historical four-item matrix has no inventory/ledger provenance and is never integral.
{
  const inventory = buildTenderRequirementInventory({
    snapshotId: 'bogota-historical',
    documents: [],
    documentGaps: [],
    historicalAnalysis: { requirement_ids: ['legal-rce-policy', 'legal-collective-life-policy', 'financial-working-capital', 'technical-video-surveillance-scope'] },
  });
  assert.equal(inventory.requirements.length, 0);
  assert.equal(inventory.expedient_coverage.status, 'incomplete');
  assert.equal(inventory.analyzed_coverage.status, 'incomplete');
  assert.equal(inventory.historical_catalog_not_integral, true);
  assert.equal(inventory.recommendation, 'pause');
}

// Addenda change the snapshot/document hashes, inventory hash and the deterministic requirement identity.
{
  const base = document({ id: 'same-doc', version: 'same-v1', text: 'El plazo de ejecución es de doce meses.' });
  const addendum = document({ id: 'same-doc', version: 'same-v2', text: 'El plazo de ejecución se amplía a dieciocho meses mediante adenda.' });
  const before = buildTenderRequirementInventory({ snapshotId: 'same-snapshot', documents: [base], documentGaps: [] });
  const after = buildTenderRequirementInventory({ snapshotId: 'same-snapshot', documents: [addendum], documentGaps: [] });
  assert.notEqual(before.snapshot_hash, after.snapshot_hash);
  assert.notEqual(before.inventory_hash, after.inventory_hash);
  assert.notEqual(before.requirements[0].requirement_id, after.requirements[0].requirement_id);
}

// Construction is deterministic and does not mutate frozen input.
{
  const frozen = Object.freeze(tenderA.map(item => Object.freeze({ ...item })));
  const forward = buildTenderRequirementInventory({ snapshotId: 'frozen', documents: frozen, documentGaps: [] });
  const reverse = buildTenderRequirementInventory({ snapshotId: 'frozen', documents: [...frozen].reverse(), documentGaps: [] });
  assert.deepEqual(forward, reverse);
}

// A legacy/current document with a missing or non-hex content_hash never crashes identity
// building and never fabricates evidence: it is disposed as an unresolved source unit.
{
  const legible = 'El contratista debe operar un centro de monitoreo 7x24.';
  for (const badHash of [undefined, null, '', '   ', 'no-es-un-hash', hash('x').slice(0, 63), `${hash('x')}f`, 'ZZ'.repeat(32), 12345]) {
    const documents = [{
      document_id: 'legacy-doc',
      document_version_id: 'legacy-v1',
      content_hash: badHash,
      extracted_text: legible,
      document_type: 'pliego',
      name: 'legacy.pdf',
      current: true,
    }];
    const inventory = buildTenderRequirementInventory({ snapshotId: 'snapshot-legacy', documents, documentGaps: [] });

    assert.equal(inventory.source_units.length, 1);
    const [unit] = inventory.source_units;
    assert.equal(unit.disposition, 'unresolved_visible');
    assert.equal(unit.reason, UNVERIFIABLE_CONTENT_HASH_REASON);
    assert.match(unit.content_hash, /^[a-f0-9]{64}$/, 'la unidad conserva un content_hash derivado, no el valor rechazado');
    assert.notEqual(unit.content_hash, typeof badHash === 'string' ? badHash.trim().toLowerCase() : String(badHash));
    assert.notEqual(unit.content_hash, hash(legible), 'el hash derivado nunca puede confundirse con el hash del texto');
    // No requirement, therefore no citation, therefore no fabricated evidence.
    assert.equal(inventory.requirements.length, 0);
    assert.equal(inventory.expedient_coverage.status, 'partial');
    assert.equal(inventory.coverage_ledger.analyzable_count, 0);
    assert.equal(inventory.coverage_ledger.unresolved_visible_count, 1);
    assert.equal(inventory.coverage_ledger.every_source_unit_disposed, true);
    assert.equal(inventory.decision_ready, false);
    assert.equal(inventory.recommendation, 'pause');
  }
}

// The verifiable siblings of an unverifiable document still produce real, citable requirements;
// citations stay `{source_unit_id, unit_hash}` and only ever point at analyzable units.
{
  const inventory = buildTenderRequirementInventory({
    snapshotId: 'snapshot-mixed',
    documents: [
      ...tenderA,
      { ...document({ id: 'z-legacy', version: 'z-v1', text: 'Requisito no verificable.' }), content_hash: 'not-a-hash' },
    ],
    documentGaps: [],
  });

  assert.equal(inventory.requirements.length, 3, 'los documentos verificables siguen produciendo sus requisitos');
  assert.equal(inventory.coverage_ledger.unresolved_visible_count, 1);
  assert.equal(inventory.expedient_coverage.status, 'partial');
  const analyzableIds = new Set(inventory.source_units.filter(unit => unit.disposition === 'analyzable').map(unit => unit.source_unit_id));
  for (const requirement of inventory.requirements) {
    for (const citation of requirement.citations) {
      assert.deepEqual(Object.keys(citation).sort(), ['source_unit_id', 'unit_hash']);
      assert.ok(analyzableIds.has(citation.source_unit_id), 'una cita sólo puede apuntar a una unidad analizable');
    }
  }
  // The unverifiable document is visible in the ledger and never cited.
  const unresolved = inventory.source_units.find(unit => unit.document_id === 'z-legacy');
  assert.equal(unresolved.reason, UNVERIFIABLE_CONTENT_HASH_REASON);
  assert.equal(inventory.requirements.some(requirement => requirement.citations.some(citation => citation.source_unit_id === unresolved.source_unit_id)), false);
  validateTenderRequirementInventory(inventory);
}

// Deterministic and identity-bearing: same input, same hashes; repairing the hash changes them.
{
  const broken = [{ ...document({ id: 'repairable', version: 'r-v1', text: 'Plazo de doce meses.' }), content_hash: null }];
  const repaired = [document({ id: 'repairable', version: 'r-v1', text: 'Plazo de doce meses.' })];
  const first = buildTenderRequirementInventory({ snapshotId: 'snapshot-repair', documents: broken, documentGaps: [] });
  const again = buildTenderRequirementInventory({ snapshotId: 'snapshot-repair', documents: broken, documentGaps: [] });
  const fixed = buildTenderRequirementInventory({ snapshotId: 'snapshot-repair', documents: repaired, documentGaps: [] });

  assert.deepEqual(first, again, 'la representación de un documento no verificable es determinística');
  assert.notEqual(first.snapshot_hash, fixed.snapshot_hash, 'reparar el content_hash cambia la identidad del snapshot');
  assert.notEqual(first.inventory_hash, fixed.inventory_hash);
  assert.equal(fixed.expedient_coverage.status, 'complete');
}

// A snapshot with no unverifiable document keeps the exact snapshot_hash preimage it had
// before the unresolved-document branch existed, so healthy expedientes never churn identity
// (and therefore never lose idempotent reuse of an already persisted run).
{
  const stable = value => (Array.isArray(value)
    ? value.map(stable)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
      : value);
  const inventory = buildTenderRequirementInventory({ snapshotId: 'snapshot-a', documents: tenderA, documentGaps: [] });
  const expected = createHash('sha256').update(JSON.stringify(stable({
    documents: tenderA.map(item => ({
      document_id: item.document_id,
      document_version_id: item.document_version_id,
      content_hash: item.content_hash,
      extracted_text_hash: hash(item.extracted_text),
    })),
    gaps: [],
  }))).digest('hex');

  assert.equal(inventory.expedient_coverage.status, 'complete');
  assert.equal(inventory.snapshot_hash, expected, 'un expediente sano no puede cambiar de identidad por este cambio');
}

// A durable gap for the same document stays authoritative: the document is disposed once.
{
  const documents = [{ ...document({ id: 'both', version: 'b-v1', text: 'Texto.' }), content_hash: 'invalid' }];
  const inventory = buildTenderRequirementInventory({
    snapshotId: 'snapshot-both',
    documents,
    documentGaps: [{ document_id: 'both', reason: 'failed_terminal' }],
  });
  const units = inventory.source_units.filter(unit => unit.document_id === 'both');
  assert.equal(units.length, 1);
  assert.equal(units[0].reason, 'failed_terminal');
}

// The shared verifiability predicate is the single definition used by the preview packet builders.
{
  assert.equal(isTenderDocumentContentHashVerifiable({ content_hash: hash('a') }), true);
  assert.equal(isTenderDocumentContentHashVerifiable({ content_hash: hash('a').toUpperCase() }), true);
  for (const value of [undefined, null, '', 'abc', 42, {}]) {
    assert.equal(isTenderDocumentContentHashVerifiable({ content_hash: value }), false);
  }
  assert.equal(isTenderDocumentContentHashVerifiable(null), false);
}

console.log('tender-specific requirement inventory fail-closed contract passed');
