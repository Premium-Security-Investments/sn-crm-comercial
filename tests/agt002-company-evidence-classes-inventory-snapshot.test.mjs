// AGT-002 — buildAgt002CompanyEvidenceClasses: optional `inventorySnapshot` input.
//
// RED reason: `buildAgt002CompanyEvidenceClasses` (agt002-company-evidence-classes.js) does
// not yet accept/consume an `inventorySnapshot` option, so every assertion below that expects
// a per-class `inventory` (or a fail-closed rejection of a malformed snapshot) fails
// against the current production behavior, which silently ignores the extra option.
//
// This file never imports agt002-company-evidence-sharepoint-catalog.js: the governed
// SharePoint inventory snapshot shape is reconstructed by hand from the contract that module's
// own RED tests (tests/agt002-company-evidence-sharepoint-catalog.test.mjs) already pin, so
// this file's RED reason stays isolated to the classes builder itself.
//
// What this file pins for the future contract:
//   - legacy call (no inventorySnapshot) stays byte-compatible with today's shape;
//   - with an inventorySnapshot, every class gains exactly one additive `inventory`
//     field, built from that class's own entry in the snapshot;
//   - inventory data can NEVER promote presence/validity/applicability/compliance — those
//     stay derived exclusively from the registry row, exactly as today;
//   - a malformed inventorySnapshot (wrong version, bad hash, incomplete catalog, corrupted
//     counts) fails closed, the same way every other malformed input in this module does.
import { strict as assert } from 'node:assert';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS, buildAgt002CompanyEvidenceClasses } from '../agt002-company-evidence-classes.js';

const ASOF = new Date('2026-09-02T00:00:00.000Z');
const INVENTORY_VERSION = 'agt002-company-evidence-sharepoint-catalog-v1';
const GOVERNED_STATES = ['current_valid', 'historical_update_required', 'reported_unverified', 'absent_unknown', 'process_specific_template'];
const STATE_PRECEDENCE = ['current_valid', 'historical_update_required', 'reported_unverified', 'process_specific_template'];

function zeroCounts() {
  return Object.fromEntries(GOVERNED_STATES.map(state => [state, 0]));
}

function effectiveStateFor(counts) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) return 'absent_unknown';
  return STATE_PRECEDENCE.find(state => counts[state] > 0) ?? 'absent_unknown';
}

/** Hand-built governed SharePoint inventory snapshot, matching the contract pinned by
 * tests/agt002-company-evidence-sharepoint-catalog.test.mjs, without importing that module. */
function buildInventorySnapshot({ overridesByEntryId = {}, catalogSnapshotHash = 'd'.repeat(64), lastReconciledAt = '2026-09-01T00:00:00.000Z' } = {}) {
  const classes = AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(entryId => {
    const counts = overridesByEntryId[entryId] ?? { ...zeroCounts(), reported_unverified: 1 };
    const sourceFileCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return {
      entry_id: entryId,
      source_file_count: sourceFileCount,
      state_counts: counts,
      effective_state: effectiveStateFor(counts),
      last_reconciled_at: sourceFileCount === 0 ? null : lastReconciledAt,
    };
  });
  const stateCounts = zeroCounts();
  for (const cls of classes) {
    for (const state of GOVERNED_STATES) stateCounts[state] += cls.state_counts[state];
  }
  return {
    inventory_version: INVENTORY_VERSION,
    catalog_snapshot_hash: catalogSnapshotHash,
    source_file_count: classes.reduce((sum, cls) => sum + cls.source_file_count, 0),
    excluded_non_evidence_count: 0,
    state_counts: stateCounts,
    classes,
  };
}

function registryEntry(entryId, overrides = {}) {
  return {
    entry_id: entryId,
    document_class: `Clase ${entryId}`,
    existence_status: 'reported',
    human_review_status: 'pending_human_review',
    applicability_status: 'pending_case_validation',
    source_reference: 'BASE MAESTRA CONFIDENCIAL',
    human_gate: 'juridico_y_comercial',
    hash: null,
    expiry: null,
    current: true,
    integration_active: true,
    updated_at: '2026-08-01T10:00:00.000Z',
    created_at: '2026-07-01T10:00:00.000Z',
    source_manifest_version: 'v0.3.1-approved-20260829',
    ...overrides,
  };
}

const LEGACY_CLASS_KEYS = [
  'entry_id', 'evidence_type', 'presence_status', 'review_status', 'validity_status',
  'applicability_status', 'compliance_status', 'source', 'last_reconciled_at', 'source_manifest_version',
].sort();

// ---------------------------------------------------------------------------
// Legacy call (no inventorySnapshot): byte-compatible with today's contract — no new key.
// ---------------------------------------------------------------------------
{
  const { classes } = buildAgt002CompanyEvidenceClasses({ registryEntries: [registryEntry('rup')], asOf: ASOF });
  const rup = classes.find(cls => cls.entry_id === 'rup');
  assert.deepEqual(Object.keys(rup).sort(), LEGACY_CLASS_KEYS, 'omitting inventorySnapshot must keep the exact legacy shape, with no inventory key');
  assert.ok(!Object.hasOwn(rup, 'inventory'), 'no inventorySnapshot was supplied: inventory must not appear at all');
}

// ---------------------------------------------------------------------------
// With inventorySnapshot: every class gains exactly one additive inventory field,
// built from that class's own entry — never invented, never cross-wired to another class.
// ---------------------------------------------------------------------------
{
  const snapshot = buildInventorySnapshot({
    overridesByEntryId: {
      rup: { ...zeroCounts(), historical_update_required: 2, reported_unverified: 1 },
      rut: zeroCounts(),
    },
  });
  const { classes } = buildAgt002CompanyEvidenceClasses({
    registryEntries: [registryEntry('rup'), registryEntry('rut')],
    asOf: ASOF,
    inventorySnapshot: snapshot,
  });

  const rup = classes.find(cls => cls.entry_id === 'rup');
  const rut = classes.find(cls => cls.entry_id === 'rut');
  const license = classes.find(cls => cls.entry_id === 'supervigilancia_operating_license');

  assert.deepEqual(
    Object.keys(rup).sort(),
    [...LEGACY_CLASS_KEYS, 'inventory'].sort(),
    'with inventorySnapshot supplied, every class must gain exactly one additive inventory key',
  );
  assert.deepEqual(
    Object.keys(rup.inventory).sort(),
    ['effective_state', 'last_reconciled_at', 'source_file_count', 'state_counts'].sort(),
    'inventory must carry exactly the four safe per-class inventory fields (entry_id is already the class\'s own field)',
  );
  assert.equal(rup.inventory.source_file_count, 3);
  assert.deepEqual(rup.inventory.state_counts, { ...zeroCounts(), historical_update_required: 2, reported_unverified: 1 });
  assert.equal(rup.inventory.effective_state, 'historical_update_required');

  assert.equal(rut.inventory.source_file_count, 0);
  assert.equal(rut.inventory.effective_state, 'absent_unknown');
  assert.equal(rut.inventory.last_reconciled_at, null);

  // A class with no registry row at all (a "missing" placeholder class) must still receive
  // its own inventory — inventory is independent of whether the registry has a row.
  assert.ok(Object.hasOwn(license, 'inventory'), 'a missing-registry-row placeholder class must still carry its own inventory');
  assert.equal(license.inventory.source_file_count, 1, 'a reported_unverified:1 default must be reflected for every un-overridden class');
}

// ---------------------------------------------------------------------------
// Inventory data must NEVER promote presence/validity/applicability/compliance — those stay
// derived exclusively from the registry row, exactly as without an inventorySnapshot.
// ---------------------------------------------------------------------------
{
  const favorableSnapshot = buildInventorySnapshot({
    overridesByEntryId: { rup: { ...zeroCounts(), current_valid: 5 } },
  });
  const plainEntry = registryEntry('rup'); // existence_status=reported, pending review, pending_case_validation, no expiry
  const withoutInventory = buildAgt002CompanyEvidenceClasses({ registryEntries: [plainEntry], asOf: ASOF })
    .classes.find(cls => cls.entry_id === 'rup');
  const withInventory = buildAgt002CompanyEvidenceClasses({
    registryEntries: [plainEntry], asOf: ASOF, inventorySnapshot: favorableSnapshot,
  }).classes.find(cls => cls.entry_id === 'rup');

  assert.equal(withInventory.presence_status, withoutInventory.presence_status, 'presence_status must stay derived only from existence_status');
  assert.equal(withInventory.validity_status, 'unknown', 'a favorable current_valid inventory summary must never promote validity_status');
  assert.equal(withInventory.applicability_status, 'pending_case_validation', 'inventory must never promote applicability_status');
  assert.equal(withInventory.compliance_status, 'pending_review', 'inventory must never promote compliance_status — it has no write path');
  assert.equal(withInventory.inventory.effective_state, 'current_valid', 'sanity: the favorable inventory summary really is current_valid');
}

// ---------------------------------------------------------------------------
// Fail-closed: a malformed inventorySnapshot must reject the whole build, never be silently
// ignored or partially applied.
// ---------------------------------------------------------------------------
{
  const entries = [registryEntry('rup')];
  const base = buildInventorySnapshot();

  assert.throws(
    () => buildAgt002CompanyEvidenceClasses({ registryEntries: entries, asOf: ASOF, inventorySnapshot: { ...base, inventory_version: 'bogus-v0' } }),
    /inventory_version/i,
    'an inventory_version mismatch must fail closed',
  );
  assert.throws(
    () => buildAgt002CompanyEvidenceClasses({ registryEntries: entries, asOf: ASOF, inventorySnapshot: { ...base, catalog_snapshot_hash: 'not-a-hash' } }),
    /hash/i,
    'a malformed catalog_snapshot_hash must fail closed',
  );
  assert.throws(
    () => buildAgt002CompanyEvidenceClasses({ registryEntries: entries, asOf: ASOF, inventorySnapshot: { ...base, classes: base.classes.slice(1) } }),
    /17|exactamente|falta/i,
    'an inventorySnapshot missing a catalog class must fail closed',
  );
  assert.throws(
    () => buildAgt002CompanyEvidenceClasses({
      registryEntries: entries, asOf: ASOF,
      inventorySnapshot: { ...base, classes: base.classes.map(cls => (cls.entry_id === 'rup' ? { ...cls, source_file_count: 999 } : cls)) },
    }),
    /rup|total|source_file_count|suma/i,
    'an internally-inconsistent inventory class must fail closed, never be silently trusted',
  );
  assert.throws(
    () => buildAgt002CompanyEvidenceClasses({ registryEntries: entries, asOf: ASOF, inventorySnapshot: { ...base, extra_field: true } }),
    /clave|key|exactamente/i,
    'an inventorySnapshot with an unexpected extra field must fail closed',
  );
}

console.log('AGT-002 buildAgt002CompanyEvidenceClasses optional inventorySnapshot contract passed');
