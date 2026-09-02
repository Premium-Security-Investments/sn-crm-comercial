// AGT-002 — buildAgt002CompanyEvidenceIdentity: optional `inventorySnapshot` input.
//
// RED reason: `buildAgt002CompanyEvidenceIdentity` (agt002-company-evidence-identity.js) does
// not yet accept/consume an `inventorySnapshot` option, so the assertions below that expect
// preview_artifact_hash to react to the governed SharePoint inventory (while
// source_snapshot_hash and the identity's own key shape stay untouched) fail against current
// production behavior, which silently ignores the extra option.
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
// Legacy call (no inventorySnapshot): public identity keeps exactly its 3 keys.
// ---------------------------------------------------------------------------
{
  const identity = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  assert.deepEqual(Object.keys(identity).sort(), [...IDENTITY_KEYS].sort());
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
// inventorySnapshot affects preview_artifact_hash (it flows into the real projected
// artifact) but must NEVER affect source_snapshot_hash (the raw registry-only fingerprint) —
// exactly the same asymmetry already proven for human_gate.
// ---------------------------------------------------------------------------
{
  const rows = validRows();
  const withoutInventory = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF });
  const withInventory = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF, inventorySnapshot: buildInventorySnapshot() });

  assert.equal(withInventory.source_snapshot_hash, withoutInventory.source_snapshot_hash, 'inventorySnapshot must never enter the raw source_snapshot_hash');
  assert.notEqual(withInventory.preview_artifact_hash, withoutInventory.preview_artifact_hash, 'attaching an inventory snapshot must change the projected preview_artifact_hash');
}

// ---------------------------------------------------------------------------
// Changing catalog_snapshot_hash / a state count / a class's source_file_count inside the
// inventorySnapshot must change the identity (via preview_artifact_hash), never be absorbed
// as a no-op.
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
  assert.equal(changedHash.source_snapshot_hash, base.source_snapshot_hash, 'precondition: the registry rows themselves did not change');

  const changedState = buildAgt002CompanyEvidenceIdentity({
    registryEntries: rows, asOf: ASOF,
    inventorySnapshot: buildInventorySnapshot({ overridesByEntryId: { rup: { ...zeroCounts(), historical_update_required: 1 } } }),
  });
  assert.notEqual(changedState.preview_artifact_hash, base.preview_artifact_hash, 'a changed governed state for one class must change the identity');

  const changedCount = buildAgt002CompanyEvidenceIdentity({
    registryEntries: rows, asOf: ASOF,
    inventorySnapshot: buildInventorySnapshot({ overridesByEntryId: { rup: { ...zeroCounts(), reported_unverified: 4 } } }),
  });
  assert.notEqual(changedCount.preview_artifact_hash, base.preview_artifact_hash, 'a changed per-class source_file_count must change the identity');
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
