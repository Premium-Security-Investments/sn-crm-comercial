// AGT-002 — buildAgt002CompanyEvidenceIdentity: optional `inventorySnapshot` input.
//
// This mirrors the safer contract already required by the companion projection test
// (agt002-company-evidence-inventory-projection.test.mjs): attaching a governed SharePoint
// inventory snapshot must bind BOTH identity hashes — source_snapshot_hash (the run's raw
// fingerprint) and preview_artifact_hash (the projected artifact) — never just one. A catalog
// revision is real input to what the run identifies, so the raw fingerprint may not silently
// ignore it. source_manifest_version and the identity's own 3-key public shape stay untouched.
//
// Like the companion classes-builder RED file, this file reconstructs the governed inventory
// snapshot shape by hand rather than importing agt002-company-evidence-sharepoint-catalog.js,
// so this file's RED reason stays isolated to the identity builder itself.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { buildAgt002CompanyEvidenceIdentity } from '../agt002-company-evidence-identity.js';

const ASOF = new Date('2026-08-29T00:00:00.000Z');
const MANIFEST_VERSION = 'v0.3.1-approved-20260829';
const INVENTORY_VERSION = 'agt002-company-evidence-sharepoint-catalog-v1';
const GOVERNED_STATES = ['current_valid', 'historical_update_required', 'reported_unverified', 'absent_unknown', 'process_specific_template'];
const STATE_PRECEDENCE = ['current_valid', 'historical_update_required', 'reported_unverified', 'process_specific_template'];
const IDENTITY_KEYS = ['preview_artifact_hash', 'source_manifest_version', 'source_snapshot_hash'];

function fixtureHash(seed) {
  return createHash('sha256').update(`fixture-hash:${seed}`).digest('hex');
}

function zeroCounts() {
  return Object.fromEntries(GOVERNED_STATES.map(state => [state, 0]));
}

function effectiveStateFor(counts) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) return 'absent_unknown';
  return STATE_PRECEDENCE.find(state => counts[state] > 0) ?? 'absent_unknown';
}

function buildInventorySnapshot({ overridesByEntryId = {}, catalogSnapshotHash = fixtureHash('inventory-base') } = {}) {
  const classes = AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(entryId => {
    const counts = overridesByEntryId[entryId] ?? { ...zeroCounts(), reported_unverified: 1 };
    const sourceFileCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return {
      entry_id: entryId,
      source_file_count: sourceFileCount,
      state_counts: counts,
      effective_state: effectiveStateFor(counts),
      last_reconciled_at: sourceFileCount === 0 ? null : '2026-08-20T00:00:00.000Z',
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

function row(entryId, overrides = {}) {
  return {
    entry_id: entryId,
    document_class: `Clase ${entryId}`,
    existence_status: 'reported',
    human_review_status: 'pending_human_review',
    applicability_status: 'pending_case_validation',
    source_reference: 'BASE MAESTRA CONFIDENCIAL — nunca debe filtrarse',
    human_gate: 'juridico_y_comercial',
    hash: fixtureHash(entryId),
    expiry: null,
    current: true,
    integration_active: true,
    updated_at: '2026-08-01T10:00:00.000Z',
    created_at: '2026-07-01T10:00:00.000Z',
    source_manifest_version: MANIFEST_VERSION,
    ...overrides,
  };
}

function validRows() {
  return AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(entryId => row(entryId));
}

// ---------------------------------------------------------------------------
// Legacy call (no inventorySnapshot): public identity keeps exactly its 3 keys, and an
// explicit `inventorySnapshot: null` must be byte-identical to omitting it altogether — the
// legacy no-snapshot identity behavior stays untouched.
// ---------------------------------------------------------------------------
{
  const rows = validRows();
  const omitted = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF });
  assert.deepEqual(Object.keys(omitted).sort(), [...IDENTITY_KEYS].sort());

  const explicitNull = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF, inventorySnapshot: null });
  assert.deepEqual(explicitNull, omitted, 'an explicit null snapshot must produce the exact legacy identity');
}

// ---------------------------------------------------------------------------
// With inventorySnapshot: the identity's public shape stays exactly the same 3 keys — the
// snapshot changes VALUES, never the contract.
// ---------------------------------------------------------------------------
{
  const snapshot = buildInventorySnapshot();
  const identity = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF, inventorySnapshot: snapshot });
  assert.deepEqual(Object.keys(identity).sort(), [...IDENTITY_KEYS].sort(), 'inventorySnapshot must never widen the public identity shape beyond its 3 keys');
  assert.equal(identity.source_manifest_version, MANIFEST_VERSION, 'source_manifest_version must still come from the registry rows, untouched by inventory');
  assert.match(identity.source_snapshot_hash, /^[0-9a-f]{64}$/);
  assert.match(identity.preview_artifact_hash, /^[0-9a-f]{64}$/);
}

// ---------------------------------------------------------------------------
// Supplying an inventorySnapshot binds BOTH hashes: source_snapshot_hash (the run's raw
// fingerprint) and preview_artifact_hash (the projected artifact) must both react — a
// governed catalog revision is real input to what the run identifies, not a cosmetic
// annotation the raw fingerprint is allowed to ignore. source_manifest_version and the public
// 3-key shape stay unchanged.
// ---------------------------------------------------------------------------
{
  const rows = validRows();
  const withoutInventory = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF });
  const withInventory = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF, inventorySnapshot: buildInventorySnapshot() });

  assert.notEqual(withInventory.source_snapshot_hash, withoutInventory.source_snapshot_hash, 'inventorySnapshot must bind source_snapshot_hash too, not just preview_artifact_hash');
  assert.notEqual(withInventory.preview_artifact_hash, withoutInventory.preview_artifact_hash, 'attaching an inventory snapshot must change the projected preview_artifact_hash');
  assert.equal(withInventory.source_manifest_version, withoutInventory.source_manifest_version, 'source_manifest_version stays the registry\'s, untouched by the catalog');
  assert.deepEqual(Object.keys(withInventory).sort(), [...IDENTITY_KEYS].sort(), 'the public identity shape stays the same exact 3 keys');
}

// ---------------------------------------------------------------------------
// Changing catalog_snapshot_hash / a governed state count / a class's source_file_count
// inside the inventorySnapshot — while the registry rows stay unchanged — must change BOTH
// hashes, never be absorbed as a no-op by either one.
// ---------------------------------------------------------------------------
{
  const rows = validRows();
  const base = buildAgt002CompanyEvidenceIdentity({
    registryEntries: rows, asOf: ASOF, inventorySnapshot: buildInventorySnapshot(),
  });

  const changedHash = buildAgt002CompanyEvidenceIdentity({
    registryEntries: rows, asOf: ASOF,
    inventorySnapshot: buildInventorySnapshot({ catalogSnapshotHash: fixtureHash('inventory-changed') }),
  });
  assert.notEqual(changedHash.preview_artifact_hash, base.preview_artifact_hash, 'a changed catalog_snapshot_hash must change the identity');
  assert.notEqual(changedHash.source_snapshot_hash, base.source_snapshot_hash, 'a changed catalog_snapshot_hash must change source_snapshot_hash too, even though the registry rows themselves did not change');

  const changedState = buildAgt002CompanyEvidenceIdentity({
    registryEntries: rows, asOf: ASOF,
    inventorySnapshot: buildInventorySnapshot({ overridesByEntryId: { rup: { ...zeroCounts(), historical_update_required: 1 } } }),
  });
  assert.notEqual(changedState.preview_artifact_hash, base.preview_artifact_hash, 'a changed governed state for one class must change the identity');
  assert.notEqual(changedState.source_snapshot_hash, base.source_snapshot_hash, 'a changed governed state for one class must change source_snapshot_hash too');

  const changedCount = buildAgt002CompanyEvidenceIdentity({
    registryEntries: rows, asOf: ASOF,
    inventorySnapshot: buildInventorySnapshot({ overridesByEntryId: { rup: { ...zeroCounts(), reported_unverified: 4 } } }),
  });
  assert.notEqual(changedCount.preview_artifact_hash, base.preview_artifact_hash, 'a changed per-class source_file_count must change the identity');
  assert.notEqual(changedCount.source_snapshot_hash, base.source_snapshot_hash, 'a changed per-class source_file_count must change source_snapshot_hash too');
}

// ---------------------------------------------------------------------------
// Deterministic and order independent: reordering the registry rows AND the inventory
// snapshot's own classes array must never change the resulting identity.
// ---------------------------------------------------------------------------
{
  const rows = validRows();
  const snapshot = buildInventorySnapshot({ overridesByEntryId: { rup: { ...zeroCounts(), historical_update_required: 2 } } });
  const forward = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF, inventorySnapshot: snapshot });

  const reversedRows = [...rows].reverse();
  const reversedSnapshot = { ...snapshot, classes: [...snapshot.classes].reverse() };
  const reversed = buildAgt002CompanyEvidenceIdentity({ registryEntries: reversedRows, asOf: ASOF, inventorySnapshot: reversedSnapshot });

  assert.deepEqual(forward, reversed, 'reordering rows and/or the inventory snapshot classes must never change the identity');

  // Repeat build with the exact same (unreordered) inputs must be byte-identical (pure/deterministic).
  const repeat = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF, inventorySnapshot: snapshot });
  assert.deepEqual(forward, repeat);
}

// ---------------------------------------------------------------------------
// Fail-closed: a malformed inventorySnapshot must reject the whole identity build.
// ---------------------------------------------------------------------------
{
  const rows = validRows();
  const base = buildInventorySnapshot();

  assert.throws(
    () => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF, inventorySnapshot: { ...base, inventory_version: 'bogus-v0' } }),
    /inventory_version/i,
  );
  assert.throws(
    () => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF, inventorySnapshot: { ...base, catalog_snapshot_hash: 'not-a-hash' } }),
    /hash/i,
  );
  assert.throws(
    () => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF, inventorySnapshot: { ...base, classes: base.classes.slice(1) } }),
    /17|exactamente|falta/i,
  );
}

console.log('AGT-002 buildAgt002CompanyEvidenceIdentity optional inventorySnapshot contract passed');
