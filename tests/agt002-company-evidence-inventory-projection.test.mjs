// AGT-002 — the governed SharePoint catalog snapshot projected into the typed 17-class
// company-evidence contract (agt002-company-evidence-classes.js) and bound into the
// run-binding evidence identity (agt002-company-evidence-identity.js).
//
// RED reason: neither builder accepts an `inventorySnapshot` yet, so every assertion below
// that expects a per-class `inventory` summary — or an identity that changes when the catalog
// changes — fails against the current implementations. This file deliberately hand-writes the
// snapshot as a plain JSON object (never via the new module's builder) because that is exactly
// how it arrives in production: as the RPC's jsonb payload or a frozen job's persisted value.
// Both builders must therefore RE-VALIDATE it rather than trust it.
//
// The load-bearing invariant: the catalog is an ADDITIVE observation plane. It may never
// promote validity, applicability or compliance. "We hold 25 historical files for this class"
// must remain structurally incapable of meaning "this class is current/applicable/sufficient".
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  AGT002_COMPANY_EVIDENCE_CLASS_IDS,
  buildAgt002CompanyEvidenceClasses,
} from '../agt002-company-evidence-classes.js';
import { buildAgt002CompanyEvidenceIdentity } from '../agt002-company-evidence-identity.js';

const ASOF = new Date('2026-08-29T00:00:00.000Z');
const MANIFEST_VERSION = 'v0.3.1-approved-20260829';
const INVENTORY_VERSION = 'agt002-company-evidence-sharepoint-catalog-v1';
const CATALOG_HASH = 'c'.repeat(64);
const RECONCILED_AT = '2026-09-01T00:00:00.000Z';
const GOVERNED_STATES = ['current_valid', 'historical_update_required', 'reported_unverified', 'absent_unknown', 'process_specific_template'];

function fixtureHash(seed) {
  return createHash('sha256').update(`fixture-hash:${seed}`).digest('hex');
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
    notes: 'informacion sensible que nunca debe filtrarse',
    ...overrides,
  };
}

function validRows(overridesByEntryId = {}) {
  return AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(entryId => row(entryId, overridesByEntryId[entryId] || {}));
}

function stateCounts(overrides = {}) {
  return {
    current_valid: 0,
    historical_update_required: 0,
    reported_unverified: 0,
    absent_unknown: 0,
    process_specific_template: 0,
    ...overrides,
  };
}

function total(counts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function effectiveState(counts) {
  if (total(counts) === 0) return 'absent_unknown';
  for (const state of ['current_valid', 'historical_update_required', 'reported_unverified', 'process_specific_template']) {
    if (counts[state] > 0) return state;
  }
  return 'absent_unknown';
}

/**
 * A safe snapshot in the exact production contract shape. `overridesByEntryId` replaces a
 * single class's counts; every other class keeps one reported_unverified file, so the
 * top-level totals stay derivable and consistent.
 */
function snapshot({ overridesByEntryId = {}, catalogSnapshotHash = CATALOG_HASH, excludedNonEvidenceCount = 1 } = {}) {
  const classes = AGT002_COMPANY_EVIDENCE_CLASS_IDS.map((entryId) => {
    const counts = overridesByEntryId[entryId] ?? stateCounts({ reported_unverified: 1 });
    return {
      entry_id: entryId,
      source_file_count: total(counts),
      state_counts: counts,
      effective_state: effectiveState(counts),
      last_reconciled_at: RECONCILED_AT,
    };
  });
  // The top-level counts describe the source files themselves (each counted exactly once),
  // so they are supplied explicitly rather than summed over the N:M class links.
  const evidenceCounts = stateCounts();
  for (const cls of classes) {
    for (const state of GOVERNED_STATES) evidenceCounts[state] += cls.state_counts[state];
  }
  return {
    inventory_version: INVENTORY_VERSION,
    catalog_snapshot_hash: catalogSnapshotHash,
    source_file_count: total(evidenceCounts) + excludedNonEvidenceCount,
    excluded_non_evidence_count: excludedNonEvidenceCount,
    state_counts: evidenceCounts,
    classes,
  };
}

// ===========================================================================
// 1. buildAgt002CompanyEvidenceClasses — additive `inventory` summary per class.
// ===========================================================================

// --- Legacy call (no snapshot): byte-compatible, no `inventory` key anywhere. ---
{
  const legacy = buildAgt002CompanyEvidenceClasses({ registryEntries: validRows(), asOf: ASOF });
  assert.deepEqual(Object.keys(legacy).sort(), ['classes', 'coverage'], 'the built artifact must stay exactly {classes, coverage}');
  for (const cls of legacy.classes) {
    assert.ok(!Object.hasOwn(cls, 'inventory'), 'a legacy call must never gain an inventory key');
  }
  const explicitlyAbsent = buildAgt002CompanyEvidenceClasses({ registryEntries: validRows(), inventorySnapshot: null, asOf: ASOF });
  assert.deepEqual(explicitlyAbsent, legacy, 'an explicit null snapshot must be byte-identical to omitting it');
}

// --- With a snapshot: every typed class gains exactly the safe inventory summary. ---
{
  const inventorySnapshot = snapshot({
    overridesByEntryId: {
      rup: stateCounts({ historical_update_required: 3, reported_unverified: 2 }),
      rut: stateCounts(),
      differential_scoring_support: stateCounts({ process_specific_template: 4 }),
    },
  });
  const { classes, coverage } = buildAgt002CompanyEvidenceClasses({ registryEntries: validRows(), inventorySnapshot, asOf: ASOF });

  assert.equal(classes.length, 17);
  for (const cls of classes) {
    assert.ok(Object.hasOwn(cls, 'inventory'), `${cls.entry_id} must carry the catalog inventory summary`);
    assert.deepEqual(
      Object.keys(cls.inventory).sort(),
      ['effective_state', 'last_reconciled_at', 'source_file_count', 'state_counts'].sort(),
      'the per-class inventory summary must expose exactly the four safe fields — never the catalog hash, never a source id',
    );
    assert.deepEqual(Object.keys(cls.inventory.state_counts).sort(), [...GOVERNED_STATES].sort());
  }

  const rup = classes.find(cls => cls.entry_id === 'rup');
  assert.equal(rup.inventory.source_file_count, 5);
  assert.equal(rup.inventory.effective_state, 'historical_update_required');
  assert.deepEqual(rup.inventory.state_counts, stateCounts({ historical_update_required: 3, reported_unverified: 2 }));
  assert.equal(rup.inventory.last_reconciled_at, RECONCILED_AT);

  const rut = classes.find(cls => cls.entry_id === 'rut');
  assert.equal(rut.inventory.source_file_count, 0);
  assert.equal(rut.inventory.effective_state, 'absent_unknown', 'a class with no linked source file is a declared documental gap');

  const templates = classes.find(cls => cls.entry_id === 'differential_scoring_support');
  assert.equal(templates.inventory.effective_state, 'process_specific_template');

  // The catalog hash never reaches the class projection: it is run identity, not model input.
  const serialized = JSON.stringify({ classes, coverage });
  assert.ok(!serialized.includes(CATALOG_HASH), 'catalog_snapshot_hash must never appear in the typed class artifact');
  assert.ok(!serialized.toLowerCase().includes('catalog_snapshot_hash'));
  assert.ok(!serialized.toLowerCase().includes('inventory_version'), 'the per-class summary carries counts and state only');
  assert.deepEqual(Object.keys({ classes, coverage }).sort(), ['classes', 'coverage'], 'no new top-level key may leak the catalog hash either');
}

// --- The catalog may never promote presence/review/validity/applicability/compliance. ---
{
  const registryEntries = validRows({ rup: { expiry: '2020-01-01' } });
  const neutral = snapshot();
  // The most favorable catalog state imaginable for rup: several current_valid files.
  const favorable = snapshot({ overridesByEntryId: { rup: stateCounts({ current_valid: 9 }) } });

  const withNeutral = buildAgt002CompanyEvidenceClasses({ registryEntries, inventorySnapshot: neutral, asOf: ASOF });
  const withFavorable = buildAgt002CompanyEvidenceClasses({ registryEntries, inventorySnapshot: favorable, asOf: ASOF });

  const stripInventory = built => built.classes.map(({ inventory: _inventory, ...rest }) => rest);
  assert.deepEqual(
    stripInventory(withFavorable),
    stripInventory(withNeutral),
    'no catalog state may change a single governed dimension of the typed classes',
  );
  assert.deepEqual(withFavorable.coverage, withNeutral.coverage, 'the coverage manifest must be independent of the catalog');

  const rupFavorable = withFavorable.classes.find(cls => cls.entry_id === 'rup');
  assert.equal(rupFavorable.inventory.effective_state, 'current_valid', 'precondition: the catalog really does say current_valid');
  assert.equal(rupFavorable.presence_status, 'reported', 'presence still comes only from existence_status');
  assert.equal(rupFavorable.review_status, 'pending_human_review', 'review still comes only from human_review_status');
  assert.equal(rupFavorable.validity_status, 'expired', 'validity still comes only from expiry vs asOf');
  assert.equal(rupFavorable.applicability_status, 'pending_case_validation', 'applicability still comes only from applicability_status');
  assert.equal(rupFavorable.compliance_status, 'pending_review', 'compliance has no write path and the catalog is not one');

  // Symmetrically: the WORST catalog state may not demote a class either.
  const absent = snapshot({ overridesByEntryId: { rup: stateCounts() } });
  const withAbsent = buildAgt002CompanyEvidenceClasses({ registryEntries, inventorySnapshot: absent, asOf: ASOF });
  assert.deepEqual(stripInventory(withAbsent), stripInventory(withNeutral), 'an empty catalog must not demote any governed dimension either');
}

// --- The snapshot is re-validated, never trusted verbatim. ---
{
  const registryEntries = validRows();
  assert.throws(() => buildAgt002CompanyEvidenceClasses({ registryEntries, inventorySnapshot: 'nope', asOf: ASOF }), /inventar|snapshot|objeto/i);
  assert.throws(() => buildAgt002CompanyEvidenceClasses({ registryEntries, inventorySnapshot: {}, asOf: ASOF }), /inventar|snapshot|inventory_version/i);

  const short = snapshot();
  short.classes = short.classes.slice(1);
  assert.throws(() => buildAgt002CompanyEvidenceClasses({ registryEntries, inventorySnapshot: short, asOf: ASOF }), /17|exactamente|falta/i);

  const promoted = snapshot();
  promoted.classes.find(cls => cls.entry_id === 'rup').effective_state = 'current_valid';
  assert.throws(
    () => buildAgt002CompanyEvidenceClasses({ registryEntries, inventorySnapshot: promoted, asOf: ASOF }),
    /effective_state|rup/i,
    'a snapshot whose effective_state disagrees with its own counts must be rejected, not projected',
  );

  const badTotals = snapshot();
  badTotals.source_file_count += 7;
  assert.throws(() => buildAgt002CompanyEvidenceClasses({ registryEntries, inventorySnapshot: badTotals, asOf: ASOF }), /total|source_file_count|suma/i);
}

// ===========================================================================
// 2. buildAgt002CompanyEvidenceIdentity — the catalog binds the run.
// ===========================================================================

// --- Public shape is unchanged: exactly three keys, frozen, registry manifest version. ---
{
  const identity = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), inventorySnapshot: snapshot(), asOf: ASOF });
  assert.deepEqual(Object.keys(identity).sort(), ['preview_artifact_hash', 'source_manifest_version', 'source_snapshot_hash']);
  assert.match(identity.source_snapshot_hash, /^[0-9a-f]{64}$/);
  assert.match(identity.preview_artifact_hash, /^[0-9a-f]{64}$/);
  assert.equal(identity.source_manifest_version, MANIFEST_VERSION, 'the manifest version stays the REGISTRY\'s, never the catalog\'s inventory version');
  assert.ok(Object.isFrozen(identity));
  assert.ok(!JSON.stringify(identity).includes(INVENTORY_VERSION));
}

// --- Legacy: absent/null snapshot stays byte-compatible with today's identity. ---
{
  const omitted = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  const explicitNull = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), inventorySnapshot: null, asOf: ASOF });
  assert.deepEqual(explicitNull, omitted, 'an explicit null snapshot must produce the exact legacy identity');
}

// --- Supplying a snapshot binds BOTH hashes. ---
{
  const legacy = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  const bound = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), inventorySnapshot: snapshot(), asOf: ASOF });
  assert.notEqual(bound.source_snapshot_hash, legacy.source_snapshot_hash, 'source_snapshot_hash must bind the catalog snapshot');
  assert.notEqual(bound.preview_artifact_hash, legacy.preview_artifact_hash, 'preview_artifact_hash must bind the catalog snapshot too');
}

// --- Determinism and order independence: same input, any order, same identity. ---
{
  const forward = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), inventorySnapshot: snapshot(), asOf: ASOF });
  const again = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), inventorySnapshot: snapshot(), asOf: ASOF });
  assert.deepEqual(again, forward, 'the identity must be a pure function of its inputs');

  const shuffled = snapshot();
  shuffled.classes = [...shuffled.classes].reverse();
  const reordered = buildAgt002CompanyEvidenceIdentity({
    registryEntries: [...validRows()].reverse(), inventorySnapshot: shuffled, asOf: ASOF,
  });
  assert.deepEqual(reordered, forward, 'reordering registry rows and snapshot classes must never change the identity');
}

// --- A changed catalog hash changes the identity (a source revision the counts cannot see). ---
{
  const base = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), inventorySnapshot: snapshot(), asOf: ASOF });
  const rehashed = buildAgt002CompanyEvidenceIdentity({
    registryEntries: validRows(), inventorySnapshot: snapshot({ catalogSnapshotHash: 'd'.repeat(64) }), asOf: ASOF,
  });
  assert.notDeepEqual(rehashed, base, 'a revised source file must change the run identity even when every count is identical');
  assert.notEqual(rehashed.source_snapshot_hash, base.source_snapshot_hash);
}

// --- A changed class state changes BOTH hashes (it changes the real projection too). ---
{
  const base = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), inventorySnapshot: snapshot(), asOf: ASOF });
  const restated = buildAgt002CompanyEvidenceIdentity({
    registryEntries: validRows(),
    inventorySnapshot: snapshot({ overridesByEntryId: { rup: stateCounts({ historical_update_required: 1 }) } }),
    asOf: ASOF,
  });
  assert.notEqual(restated.source_snapshot_hash, base.source_snapshot_hash);
  assert.notEqual(restated.preview_artifact_hash, base.preview_artifact_hash);
}

// --- A changed file count changes BOTH hashes. ---
{
  const base = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), inventorySnapshot: snapshot(), asOf: ASOF });
  const recounted = buildAgt002CompanyEvidenceIdentity({
    registryEntries: validRows(),
    inventorySnapshot: snapshot({ overridesByEntryId: { rup: stateCounts({ reported_unverified: 4 }) } }),
    asOf: ASOF,
  });
  assert.notEqual(recounted.source_snapshot_hash, base.source_snapshot_hash);
  assert.notEqual(recounted.preview_artifact_hash, base.preview_artifact_hash);

  // Even a change that only touches the excluded (non-evidence) tail must be visible.
  const reexcluded = buildAgt002CompanyEvidenceIdentity({
    registryEntries: validRows(), inventorySnapshot: snapshot({ excludedNonEvidenceCount: 2 }), asOf: ASOF,
  });
  assert.notEqual(reexcluded.source_snapshot_hash, base.source_snapshot_hash);
}

// --- Fail-closed: a malformed snapshot can never produce an identity. ---
{
  const registryEntries = validRows();
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries, inventorySnapshot: {}, asOf: ASOF }), /inventar|snapshot|inventory_version/i);
  const tampered = snapshot();
  tampered.classes.find(cls => cls.entry_id === 'rup').source_file_count = 99;
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries, inventorySnapshot: tampered, asOf: ASOF }), /total|source_file_count|suma|rup/i);
}

// --- The identity never leaks anything from the catalog beyond opaque digests. ---
{
  const identity = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), inventorySnapshot: snapshot(), asOf: ASOF });
  const serialized = JSON.stringify(identity);
  for (const forbidden of ['item_id', 'path', 'url', 'etag', 'sharepoint', 'CONFIDENCIAL', 'human_gate', 'source_reference']) {
    assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `the identity must never carry "${forbidden}"`);
  }
}

console.log('AGT-002 company evidence catalog projection (typed classes + run-binding identity) contract passed');
