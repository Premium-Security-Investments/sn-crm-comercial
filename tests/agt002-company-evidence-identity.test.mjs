import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import {
  buildAgt002CompanyEvidenceIdentity,
  computeAgt002CompanyEvidenceCanonicalHash,
  deriveAgt002CompanyEvidenceAsOf,
  validateAgt002CompanyEvidenceAsOf,
} from '../agt002-company-evidence-identity.js';

const ASOF = new Date('2026-08-29T00:00:00.000Z');
const MANIFEST_VERSION = 'v0.3.1-approved-20260829';
const OTHER_MANIFEST_VERSION = 'v0.2-provisional-20260801';

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

// --- Happy path: exact frozen shape, 64-hex hashes, real shared manifest version. ---
{
  const identity = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  assert.deepEqual(Object.keys(identity).sort(), ['preview_artifact_hash', 'source_manifest_version', 'source_snapshot_hash']);
  assert.match(identity.source_snapshot_hash, /^[0-9a-f]{64}$/);
  assert.match(identity.preview_artifact_hash, /^[0-9a-f]{64}$/);
  assert.equal(identity.source_manifest_version, MANIFEST_VERSION);
  assert.ok(Object.isFrozen(identity), 'the identity object must be frozen');
}

// --- Deterministic under row reordering: this is a set of 17, not a sequence. ---
{
  const forward = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  const reversed = buildAgt002CompanyEvidenceIdentity({ registryEntries: [...validRows()].reverse(), asOf: ASOF });
  assert.deepEqual(forward, reversed, 'reordering the same 17 rows must never change the identity');
}

// --- Changing a single row's hash changes the overall identity. ---
{
  const base = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  const changed = buildAgt002CompanyEvidenceIdentity({
    registryEntries: validRows({ rup: { hash: fixtureHash('rup-changed') } }),
    asOf: ASOF,
  });
  assert.notDeepEqual(base, changed, 'a changed hash must change the identity');
  assert.notEqual(base.source_snapshot_hash, changed.source_snapshot_hash);
}

// --- Changing a status dimension changes both hashes: the raw snapshot AND the projection. ---
{
  const base = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  const changed = buildAgt002CompanyEvidenceIdentity({
    registryEntries: validRows({ rup: { human_review_status: 'approved', applicability_status: 'applicable' } }),
    asOf: ASOF,
  });
  assert.notEqual(base.source_snapshot_hash, changed.source_snapshot_hash);
  assert.notEqual(base.preview_artifact_hash, changed.preview_artifact_hash);
}

// --- Changing source_manifest_version (shared across all 17 rows) changes the returned
// version AND both hashes (the raw rows carry it, and so does each projected class). ---
{
  const base = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  const rows = validRows().map(r => ({ ...r, source_manifest_version: OTHER_MANIFEST_VERSION }));
  const changed = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF });
  assert.equal(changed.source_manifest_version, OTHER_MANIFEST_VERSION);
  assert.notEqual(base.source_snapshot_hash, changed.source_snapshot_hash);
  assert.notEqual(base.preview_artifact_hash, changed.preview_artifact_hash);
}

// --- The preview artifact hash reacts to the real projection (validity_status depends on
// asOf vs expiry), even when the raw rows (and therefore source_snapshot_hash) stay
// byte-for-byte identical — proving it is a genuine re-derivation, not a copy of the
// snapshot hash. asOf is explicit so this is fully deterministic. ---
{
  const rows = validRows({ rup: { expiry: '2026-08-15' } });
  const beforeExpiry = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: new Date('2026-08-01T00:00:00.000Z') });
  const afterExpiry = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: new Date('2026-09-01T00:00:00.000Z') });
  assert.equal(beforeExpiry.source_snapshot_hash, afterExpiry.source_snapshot_hash, 'raw rows are unchanged, so the snapshot hash must be identical');
  assert.notEqual(beforeExpiry.preview_artifact_hash, afterExpiry.preview_artifact_hash, 'the crossed expiry must flip validity_status and change the preview artifact hash');
}

// --- No sensitive/raw fields ever affect the snapshot identity: source_reference, notes
// and (with updated_at present) created_at are excluded from the canonical snapshot
// serialization by construction. ---
{
  const base = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  const rows = validRows().map(r => ({
    ...r,
    source_reference: 'OTRA REFERENCIA COMPLETAMENTE DISTINTA',
    notes: 'otra nota sensible distinta',
    created_at: '2020-01-01T00:00:00.000Z',
  }));
  const changed = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF });
  assert.deepEqual(base, changed, 'source_reference/notes/created_at must never affect the identity');
}

// human_gate is a real, non-excluded field of the typed class projection (agt002-company-
// evidence-classes.js's own class.source.human_gate) — it legitimately changes
// preview_artifact_hash, but it must never enter the raw snapshot hash, which is limited
// to exactly the safe/decisional columns.
{
  const base = buildAgt002CompanyEvidenceIdentity({ registryEntries: validRows(), asOf: ASOF });
  const rows = validRows().map(r => ({ ...r, human_gate: 'otro_gate_distinto' }));
  const changed = buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF });
  assert.equal(base.source_snapshot_hash, changed.source_snapshot_hash, 'human_gate must never enter the raw snapshot hash');
}

// --- Fail-closed: not an array. ---
assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries: {}, asOf: ASOF }), /lista/i);

// --- Fail-closed: missing a row (16 instead of 17). ---
{
  const rows = validRows().slice(1);
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF }), /17|exactamente/i);
}

// --- Fail-closed: a duplicate entry_id (still 17 rows, but missing coverage of one class). ---
{
  const rows = validRows().slice(1);
  rows.push(row(rows[0].entry_id, { hash: fixtureHash('dup') }));
  assert.equal(rows.length, 17);
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF }), /duplicado|falta/i);
}

// --- Fail-closed: a row outside the closed catalog. ---
{
  const rows = validRows().slice(1);
  rows.push(row('unknown_class', { hash: fixtureHash('unknown') }));
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF }), /catálogo/i);
}

// --- Fail-closed: a non-current row must never silently participate in the identity. ---
{
  const rows = validRows({ rup: { current: false } });
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF }), /current/i);
}

// --- Fail-closed: an invalid status enum. ---
{
  const rows = validRows({ rup: { human_review_status: 'bogus' } });
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF }), /human_review_status/i);
}

// --- Fail-closed: an invalid hash format (not 64 hex chars). ---
{
  const rows = validRows({ rup: { hash: 'not-a-real-hash' } });
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF }), /hash/i);
}

// --- Fail-closed: rows must all share the same source_manifest_version — a registry
// snapshot mixing v0.2 and v0.3.1 rows must never resolve to one identity. ---
{
  const rows = validRows({ rup: { source_manifest_version: OTHER_MANIFEST_VERSION } });
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF }), /source_manifest_version/i);
}

// --- Fail-closed: an empty source_manifest_version. ---
{
  const rows = validRows({ rup: { source_manifest_version: '' } });
  assert.throws(() => buildAgt002CompanyEvidenceIdentity({ registryEntries: rows, asOf: ASOF }), /source_manifest_version/i);
}

// --- computeAgt002CompanyEvidenceCanonicalHash: pure, deterministic, key-order independent. ---
{
  const a = computeAgt002CompanyEvidenceCanonicalHash({ b: 1, a: 2 });
  const b = computeAgt002CompanyEvidenceCanonicalHash({ a: 2, b: 1 });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  const c = computeAgt002CompanyEvidenceCanonicalHash({ a: 2, b: 2 });
  assert.notEqual(a, c);
}

// --- validateAgt002CompanyEvidenceAsOf: exactly the canonical start-of-day UTC form —
// never merely Date-parseable. Offset, non-midnight time and calendar-impossible dates
// must all fail closed; the exact canonical form (and deriveAgt002CompanyEvidenceAsOf's own
// output against real rows) must be accepted. ---
{
  assert.throws(() => validateAgt002CompanyEvidenceAsOf('2026-08-29T00:00:00.000+00:00'), /formato canónico/i, 'an explicit UTC offset instead of Z must be rejected');
  assert.throws(() => validateAgt002CompanyEvidenceAsOf('2026-08-29T08:30:00.000Z'), /formato canónico/i, 'a non-midnight time must be rejected');
  assert.throws(() => validateAgt002CompanyEvidenceAsOf('2026-02-30T00:00:00.000Z'), /fecha UTC válida/i, 'a calendar-impossible date must be rejected even though Date silently rolls it over');
  assert.throws(() => validateAgt002CompanyEvidenceAsOf('2026-08-29'), /formato canónico/i, 'a bare date with no time component must be rejected');
  assert.throws(() => validateAgt002CompanyEvidenceAsOf(null), /formato canónico/i, 'a non-string must be rejected');
  assert.equal(validateAgt002CompanyEvidenceAsOf('2026-08-29T00:00:00.000Z'), '2026-08-29T00:00:00.000Z');
  const derived = deriveAgt002CompanyEvidenceAsOf(validRows());
  assert.equal(validateAgt002CompanyEvidenceAsOf(derived), derived, 'deriveAgt002CompanyEvidenceAsOf must always produce the canonical form the validator accepts');
}

console.log('AGT-002 company evidence identity (F3) contract passed');
