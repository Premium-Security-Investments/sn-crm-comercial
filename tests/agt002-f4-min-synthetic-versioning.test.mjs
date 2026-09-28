import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_F4MIN_SCHEMA_VERSION,
  AGT002_F4MIN_ENVIRONMENT,
  AGT002_F4MIN_ROW_COUNT,
  AGT002_F4MIN_RECONSTRUCTION_SENTINEL,
  AGT002_F4MIN_CLASSIFICATIONS,
  buildAgt002F4MinManifest,
  verifyAgt002F4MinManifestIntegrity,
  recomputeAgt002F4MinRowHash,
  recomputeAgt002F4MinManifestHash,
  recomputeAgt002F4MinVersionRecordHash,
  computeAgt002F4MinCanonicalSourceBytes,
  createAgt002F4MinSyntheticVersioning,
} from '../agt002-f4-min-synthetic-versioning.js';

// AGT-002 F4-min: focused tests for the isolated in-memory synthetic versioning slice. All
// ids/locators below are synthetic-prefixed / fixture:// only. No IO, no network, no DB, no
// wiring into any real runtime.

const SENTINEL = AGT002_F4MIN_RECONSTRUCTION_SENTINEL;
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_PATH = path.join(REPO_ROOT, 'agt002-f4-min-synthetic-versioning.js');

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function humanActor(id) {
  return {
    principal_id: id,
    principal_kind: 'person',
    durable_ref: { locator: `fixture://agt002-f4-min/actors/${id}.json` },
  };
}

function findRowByClassification(manifest, classification) {
  return manifest.rows.find((row) => row.classification === classification);
}

function validReconstructionInput(row, { suffix } = {}) {
  const bytes = computeAgt002F4MinCanonicalSourceBytes(row.row_id);
  const label = suffix ?? row.row_id.replace(/[^a-z0-9]+/gi, '-');
  const actor = humanActor(`synthetic-actor-${label}`);
  const sourceId = `synthetic-source-${label}`;
  return {
    sentinel: SENTINEL,
    row_id: row.row_id,
    version_id: `synthetic-version-${label}`,
    source_id: sourceId,
    source_bytes: bytes,
    source_hash: sha256Hex(bytes),
    provenance: {
      source: 'legacy_archive_fixture',
      issuer: 'agt002-f4-min-fixture-issuer',
      locator: `fixture://agt002-f4-min/sources/${label}.json`,
      captured_at_utc: '2026-09-01T09:00:00Z',
    },
    mapping: {
      row_id: row.row_id,
      source_id: sourceId,
      approved: true,
      approver: actor,
      approved_at_utc: '2026-09-01T09:05:00Z',
    },
    reconstructed_at_utc: '2026-09-01T09:10:00Z',
  };
}

// --- Manifest: exact row count and closed classification catalog --------------------------------

test('manifest generates exactly 33 synthetic rows classified only as the three closed values', () => {
  const manifest = buildAgt002F4MinManifest();
  assert.equal(AGT002_F4MIN_ROW_COUNT, 33);
  assert.equal(manifest.row_count, 33);
  assert.equal(manifest.rows.length, 33);

  const counts = { backfillable_with_source: 0, legacy_metadata_only: 0, requires_human_resolution: 0 };
  for (const row of manifest.rows) {
    assert.ok(AGT002_F4MIN_CLASSIFICATIONS.includes(row.classification), `unexpected classification ${row.classification}`);
    counts[row.classification] += 1;
    assert.ok(row.row_id.startsWith('synthetic-'), 'every row id must be synthetic-prefixed');
    assert.ok(row.legacy_locator.startsWith('fixture://'), 'every row locator must be fixture://');
  }
  assert.deepEqual(counts, { backfillable_with_source: 11, legacy_metadata_only: 11, requires_human_resolution: 11 });

  const ids = new Set(manifest.rows.map((row) => row.row_id));
  assert.equal(ids.size, 33, 'row ids must be unique');
});

// --- Manifest: source bytes / version / hash / provenance shape ---------------------------------

test('backfillable_with_source rows pin a fixture:// source locator and an expected content hash; the other two classifications never do', () => {
  const manifest = buildAgt002F4MinManifest();
  for (const row of manifest.rows) {
    if (row.classification === 'backfillable_with_source') {
      assert.ok(row.source_locator.startsWith('fixture://'));
      assert.match(row.expected_content_sha256, /^[0-9a-f]{64}$/);
      assert.equal(row.legacy_metadata, null);
      assert.equal(row.conflict, null);
      assert.equal(
        row.expected_content_sha256,
        sha256Hex(computeAgt002F4MinCanonicalSourceBytes(row.row_id)),
        'pinned hash must match the canonical source bytes helper',
      );
    } else if (row.classification === 'legacy_metadata_only') {
      assert.equal(row.source_locator, null);
      assert.equal(row.expected_content_sha256, null);
      assert.ok(row.legacy_metadata && typeof row.legacy_metadata.note === 'string');
      assert.equal(row.conflict, null);
    } else {
      assert.equal(row.source_locator, null);
      assert.equal(row.expected_content_sha256, null);
      assert.equal(row.legacy_metadata, null);
      assert.ok(row.conflict && typeof row.conflict.code === 'string' && typeof row.conflict.detail === 'string');
    }
  }
});

// --- Manifest: frozen, deterministic -------------------------------------------------------------

test('manifest is frozen and fully deterministic across builds and across instances', () => {
  const manifestA = buildAgt002F4MinManifest();
  const manifestB = buildAgt002F4MinManifest();

  assert.ok(Object.isFrozen(manifestA));
  assert.ok(Object.isFrozen(manifestA.rows));
  for (const row of manifestA.rows) assert.ok(Object.isFrozen(row));

  assert.deepEqual(manifestA, manifestB);
  assert.equal(manifestA.manifest_hash, manifestB.manifest_hash);

  const verticalA = createAgt002F4MinSyntheticVersioning();
  const verticalB = createAgt002F4MinSyntheticVersioning();
  assert.deepEqual(verticalA.getManifest(), verticalB.getManifest());
  assert.equal(verticalA.getManifest().manifest_hash, verticalB.getManifest().manifest_hash);
});

// --- Reconstruction and tamper detection ----------------------------------------------------------

test('manifest integrity verification is VALID for a fresh manifest and detects row-level and manifest-level tampering', () => {
  const manifest = buildAgt002F4MinManifest();
  const fresh = verifyAgt002F4MinManifestIntegrity(manifest);
  assert.equal(fresh.verdict, 'VALID');
  assert.deepEqual(fresh.reasons, []);

  for (const row of manifest.rows) {
    assert.equal(recomputeAgt002F4MinRowHash(row), row.row_hash);
  }
  assert.equal(recomputeAgt002F4MinManifestHash(manifest), manifest.manifest_hash);

  const tamperedRowIndex = manifest.rows.findIndex((row) => row.classification === 'backfillable_with_source');
  const tamperedRows = manifest.rows.map((row, index) => (
    index === tamperedRowIndex ? { ...row, expected_content_sha256: '0'.repeat(64) } : row
  ));
  const tamperedManifest = { ...manifest, rows: tamperedRows };
  const tamperedResult = verifyAgt002F4MinManifestIntegrity(tamperedManifest);
  assert.equal(tamperedResult.verdict, 'INVALID');
  assert.ok(tamperedResult.reasons.includes('manifest.row_hash_mismatch'));
  assert.ok(tamperedResult.reasons.includes('manifest.manifest_hash_mismatch'));

  const invalidClassificationManifest = {
    ...manifest,
    rows: manifest.rows.map((row, index) => (index === 0 ? { ...row, classification: 'not_a_real_classification' } : row)),
  };
  const invalidClassificationResult = verifyAgt002F4MinManifestIntegrity(invalidClassificationManifest);
  assert.equal(invalidClassificationResult.verdict, 'INVALID');
  assert.ok(invalidClassificationResult.reasons.includes('manifest.classification_invalid'));

  const shortManifest = { ...manifest, rows: manifest.rows.slice(0, 10), row_count: 10 };
  const shortResult = verifyAgt002F4MinManifestIntegrity(shortManifest);
  assert.equal(shortResult.verdict, 'INVALID');
  assert.ok(shortResult.reasons.includes('manifest.row_count_invalid'));

  const directHashTamper = { ...manifest, manifest_hash: 'f'.repeat(64) };
  const directHashResult = verifyAgt002F4MinManifestIntegrity(directHashTamper);
  assert.equal(directHashResult.verdict, 'INVALID');
  assert.ok(directHashResult.reasons.includes('manifest.manifest_hash_mismatch'));
});

// --- Positive: reconstruction of an eligible row ---------------------------------------------------

test('positive: a backfillable_with_source row reconstructs into a chained, reconstructible v1 version with verifiable bytes/hash/provenance', () => {
  const vertical = createAgt002F4MinSyntheticVersioning();
  const manifest = vertical.getManifest();
  const row = findRowByClassification(manifest, 'backfillable_with_source');
  const input = validReconstructionInput(row, { suffix: 'pos-1' });

  const result = vertical.reconstructVersion(input);
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.version.row_id, row.row_id);
  assert.equal(result.version.content_sha256, row.expected_content_sha256);
  assert.equal(result.version.previous_hash, row.row_hash);
  assert.equal(result.version.mapping.approved, true);
  assert.ok(Object.isFrozen(result.version));
  assert.ok(Object.isFrozen(result.version.mapping));
  assert.ok(Object.isFrozen(result.version.provenance));

  assert.equal(recomputeAgt002F4MinVersionRecordHash(result.version), result.version.record_hash);

  const versions = vertical.getVersions();
  assert.equal(versions.size, 1);
  assert.deepEqual(versions.get(row.row_id), result.version);

  const auditEntry = vertical.getAuditLog().at(-1);
  assert.equal(auditEntry.status, 'ALLOWED');
  assert.equal(auditEntry.row_id, row.row_id);
});

test('deterministic reconstruction: identical synthetic inputs on two isolated instances yield identical version hashes', () => {
  const verticalA = createAgt002F4MinSyntheticVersioning();
  const verticalB = createAgt002F4MinSyntheticVersioning();
  const rowA = findRowByClassification(verticalA.getManifest(), 'backfillable_with_source');
  const rowB = findRowByClassification(verticalB.getManifest(), 'backfillable_with_source');
  assert.equal(rowA.row_id, rowB.row_id);

  const input = validReconstructionInput(rowA, { suffix: 'det-1' });
  const resultA = verticalA.reconstructVersion(input);
  const resultB = verticalB.reconstructVersion({ ...input });

  assert.equal(resultA.status, 'RECORDED');
  assert.equal(resultB.status, 'RECORDED');
  assert.equal(resultA.version.record_hash, resultB.version.record_hash);
  assert.deepEqual(resultA.version, resultB.version);
});

// --- Negative: ineligible classifications never produce a v1, regardless of otherwise-valid input --

test('negative: legacy_metadata_only and requires_human_resolution rows are never eligible for v1, even with an otherwise well-formed request', () => {
  for (const classification of ['legacy_metadata_only', 'requires_human_resolution']) {
    const vertical = createAgt002F4MinSyntheticVersioning();
    const row = findRowByClassification(vertical.getManifest(), classification);
    const input = validReconstructionInput(
      { row_id: row.row_id, expected_content_sha256: sha256Hex(computeAgt002F4MinCanonicalSourceBytes(row.row_id)) },
      { suffix: `inelig-${classification}` },
    );
    const result = vertical.reconstructVersion(input);
    assert.equal(result.status, 'DENIED');
    assert.equal(result.reason, 'row.not_eligible_for_v1');
    assert.equal(vertical.getVersions().size, 0);
  }
});

// --- Negative: sentinel gate ------------------------------------------------------------------------

test('negative: a wrong or missing reconstruction sentinel is denied fail-closed and audited', () => {
  const vertical = createAgt002F4MinSyntheticVersioning();
  const row = findRowByClassification(vertical.getManifest(), 'backfillable_with_source');
  const input = validReconstructionInput(row, { suffix: 'sentinel-1' });

  const deniedWrong = vertical.reconstructVersion({ ...input, sentinel: 'not-the-sentinel' });
  assert.equal(deniedWrong.status, 'DENIED');
  assert.equal(deniedWrong.reason, 'reconstruction.sentinel_invalid');

  const { sentinel, ...withoutSentinel } = input;
  const deniedMissing = vertical.reconstructVersion(withoutSentinel);
  assert.equal(deniedMissing.reason, 'reconstruction.sentinel_invalid');

  assert.equal(vertical.getVersions().size, 0);
  const sentinelDenials = vertical.getAuditLog().filter((entry) => entry.reason === 'reconstruction.sentinel_invalid');
  assert.equal(sentinelDenials.length, 2);
});

// --- Negative: unknown row --------------------------------------------------------------------------

test('negative: an unknown row id is denied fail-closed', () => {
  const vertical = createAgt002F4MinSyntheticVersioning();
  const input = validReconstructionInput({ row_id: 'synthetic-legacy-row-999' }, { suffix: 'unknown-1' });
  const result = vertical.reconstructVersion(input);
  assert.equal(result.status, 'DENIED');
  assert.equal(result.reason, 'row.not_found');
});

// --- Negative: fabricated v1 without verifiable bytes/hash ------------------------------------------

test('negative: refuses a fabricated v1 for every way bytes/hash can fail to be verifiable', () => {
  const vertical = createAgt002F4MinSyntheticVersioning();
  const row = findRowByClassification(vertical.getManifest(), 'backfillable_with_source');
  const base = validReconstructionInput(row, { suffix: 'fab-1' });
  const otherBytes = computeAgt002F4MinCanonicalSourceBytes('synthetic-legacy-row-999');

  const cases = [
    [{ source_bytes: undefined }, 'source.bytes_missing'],
    [{ source_bytes: '' }, 'source.bytes_missing'],
    [{ source_hash: 'not-a-hash' }, 'source.hash_invalid'],
    [{ source_hash: undefined }, 'source.hash_invalid'],
    // internally self-consistent (hash matches these bytes) but not the bytes this row expects
    [{ source_bytes: otherBytes, source_hash: sha256Hex(otherBytes) }, 'source.hash_mismatch_row_expectation'],
    // claims match, but the declared hash does not match the actual bytes supplied
    [{ source_hash: sha256Hex(otherBytes) }, 'source.hash_mismatch'],
  ];

  for (const [override, expectedReason] of cases) {
    const result = vertical.reconstructVersion({ ...base, ...override, version_id: `${base.version_id}-${expectedReason}` });
    assert.equal(result.status, 'DENIED', expectedReason);
    assert.equal(result.reason, expectedReason);
  }
  assert.equal(vertical.getVersions().size, 0);
});

// --- Negative: mapping must be an approved, exact, human-bound mapping ------------------------------

test('negative: refuses a v1 without an approved, exact, human-bound mapping, for every malformed mapping shape', () => {
  const vertical = createAgt002F4MinSyntheticVersioning();
  const row = findRowByClassification(vertical.getManifest(), 'backfillable_with_source');
  const base = validReconstructionInput(row, { suffix: 'map-1' });

  const cases = [
    [{ mapping: undefined }, 'mapping.missing'],
    [{ mapping: { ...base.mapping, row_id: 'synthetic-legacy-row-999' } }, 'mapping.row_id_mismatch'],
    [{ mapping: { ...base.mapping, source_id: 'synthetic-source-other' } }, 'mapping.source_id_mismatch'],
    [{ mapping: { ...base.mapping, approved: false } }, 'mapping.not_approved'],
    [{ mapping: { ...base.mapping, approved: undefined } }, 'mapping.not_approved'],
    [{ mapping: { ...base.mapping, approver: undefined } }, 'identity.actor_missing'],
    [
      { mapping: { ...base.mapping, approver: { principal_kind: 'system', principal_id: 'x', durable_ref: { locator: 'fixture://x' } } } },
      'identity.principal_kind_not_person',
    ],
    [
      { mapping: { ...base.mapping, approver: { principal_kind: 'person', principal_id: 'gerencia', durable_ref: { locator: 'fixture://x' } } } },
      'identity.principal_id_is_role',
    ],
    [
      { mapping: { ...base.mapping, approver: { principal_kind: 'person', principal_id: 'synthetic-actor-map-1', durable_ref: { locator: 'https://not-isolated.example/x' } } } },
      'identity.durable_ref_locator_not_isolated',
    ],
    [{ mapping: { ...base.mapping, approved_at_utc: 'not-a-timestamp' } }, 'mapping.approval_timestamp_invalid'],
  ];

  for (const [override, expectedReason] of cases) {
    const result = vertical.reconstructVersion({ ...base, ...override, version_id: `${base.version_id}-${expectedReason}` });
    assert.equal(result.status, 'DENIED', expectedReason);
    assert.equal(result.reason, expectedReason);
  }
  assert.equal(vertical.getVersions().size, 0);
});

// --- Negative: malformed synthetic ids, fixture:// locators, and hashes fail closed -----------------

test('table: malformed synthetic ids, fixture:// locators, and hashes are all denied fail-closed with exact reason codes', () => {
  const vertical = createAgt002F4MinSyntheticVersioning();
  const row = findRowByClassification(vertical.getManifest(), 'backfillable_with_source');
  const base = validReconstructionInput(row, { suffix: 'malformed-1' });

  const cases = [
    [{ version_id: 'not-synthetic-version' }, 'version.id_not_synthetic'],
    [{ version_id: undefined }, 'version.id_not_synthetic'],
    [{ source_id: 'not-synthetic-source' }, 'source.id_not_synthetic'],
    [{ source_id: undefined }, 'source.id_not_synthetic'],
    [{ provenance: { ...base.provenance, locator: 'https://not-isolated.example/x' } }, 'provenance.locator_not_isolated'],
    [{ provenance: { ...base.provenance, locator: undefined } }, 'provenance.fields_missing'],
    [{ provenance: { ...base.provenance, captured_at_utc: 'not-a-timestamp' } }, 'provenance.timestamp_invalid'],
    [{ provenance: undefined }, 'provenance.fields_missing'],
    [{ reconstructed_at_utc: 'not-a-timestamp' }, 'version.timestamp_invalid'],
  ];

  for (const [override, expectedReason] of cases) {
    // Every case here is denied before a version is ever recorded, so reusing the same
    // `version_id`/`row_id` across cases cannot collide with `row.already_versioned`.
    const result = vertical.reconstructVersion({ ...base, ...override });
    assert.equal(result.status, 'DENIED', expectedReason);
    assert.equal(result.reason, expectedReason);
  }
  assert.equal(vertical.getVersions().size, 0);
});

// --- Negative: a row can only ever be versioned once ------------------------------------------------

test('negative: a row already versioned is denied fail-closed on a second attempt, leaving the original version intact', () => {
  const vertical = createAgt002F4MinSyntheticVersioning();
  const row = findRowByClassification(vertical.getManifest(), 'backfillable_with_source');
  const input = validReconstructionInput(row, { suffix: 'repeat-1' });

  const first = vertical.reconstructVersion(input);
  assert.equal(first.status, 'RECORDED');

  const second = vertical.reconstructVersion({ ...input, version_id: 'synthetic-version-repeat-1-again' });
  assert.equal(second.status, 'DENIED');
  assert.equal(second.reason, 'row.already_versioned');

  assert.deepEqual(vertical.getVersions().get(row.row_id), first.version);
  assert.equal(vertical.getVersions().size, 1);
});

// --- Teardown: preserves the audit trail, clears working versions -----------------------------------

test('teardown clears only the working versions, preserves the audit trail, and blocks further mutation', () => {
  const vertical = createAgt002F4MinSyntheticVersioning();
  const row = findRowByClassification(vertical.getManifest(), 'backfillable_with_source');
  const input = validReconstructionInput(row, { suffix: 'teardown-1' });
  const recorded = vertical.reconstructVersion(input);
  assert.equal(recorded.status, 'RECORDED');

  const auditBefore = vertical.getAuditLog();
  assert.ok(auditBefore.length > 0);
  assert.equal(vertical.getVersions().size, 1);

  const teardownResult = vertical.teardown({ torn_down_at_utc: '2026-09-01T11:00:00Z' });
  assert.equal(teardownResult.status, 'TORN_DOWN');
  assert.equal(teardownResult.already_torn_down, false);

  assert.equal(vertical.getVersions().size, 0);
  const auditAfter = vertical.getAuditLog();
  assert.deepEqual(auditAfter.slice(0, auditBefore.length), auditBefore, 'the audit trail must survive teardown untouched');
  assert.ok(auditAfter.length > auditBefore.length, 'teardown itself must be audited');
  assert.equal(auditAfter.at(-1).action, 'teardown');

  // The manifest itself is a pure, static concept and is unaffected by teardown of an instance's
  // working versions.
  assert.equal(vertical.getManifest().manifest_hash, buildAgt002F4MinManifest().manifest_hash);

  const deniedAfterTeardown = vertical.reconstructVersion(
    validReconstructionInput(row, { suffix: 'teardown-2' }),
  );
  assert.equal(deniedAfterTeardown.status, 'DENIED');
  assert.equal(deniedAfterTeardown.reason, 'instance.torn_down');

  const secondTeardown = vertical.teardown();
  assert.equal(secondTeardown.already_torn_down, true);
});

// --- Static isolation: the module itself stays isolated ----------------------------------------------

test('module source is static-clean: only node:crypto is imported, no wall-clock, no IO/network/SQL/runtime-wiring or forbidden-scope keywords', () => {
  const source = readFileSync(MODULE_PATH, 'utf8');

  const importSpecifiers = [...source.matchAll(/^\s*import\s+.*?\sfrom\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(importSpecifiers, ['node:crypto']);

  const FORBIDDEN_PATTERNS = [
    [/\bDate\.now\s*\(/, 'Date.now('],
    [/new\s+Date\s*\(/, 'new Date('],
    [/\bMath\.random\s*\(/, 'Math.random('],
    [/\bfetch\s*\(/i, 'fetch('],
    [/\bprocess\.env/, 'process.env'],
    [/\brequire\s*\(/, 'require('],
    [/\bsupabase\b/i, 'supabase'],
    [/\bsql\b/i, 'sql'],
    [/\bDANE\b/, 'DANE'],
    [/\bSIIO\b/i, 'SIIO'],
    [/AGT-003|AGT003/, 'AGT-003'],
    [/\bmigration\b/i, 'migration'],
    [/readFileSync|writeFileSync|readdirSync/, 'filesystem access'],
    [/\bnode:fs\b|\bnode:net\b|\bnode:http\b|\bnode:https\b/, 'IO/network module'],
  ];
  for (const [re, label] of FORBIDDEN_PATTERNS) {
    assert.equal(re.test(source), false, `module must not reference "${label}"`);
  }
});

// --- Sanity: exported schema/environment constants are the frozen, expected shape --------------------

test('exported constants are the expected frozen, closed shapes', () => {
  assert.equal(AGT002_F4MIN_SCHEMA_VERSION, 1);
  assert.equal(AGT002_F4MIN_ENVIRONMENT, 'isolated_fixture');
  assert.ok(Object.isFrozen(AGT002_F4MIN_CLASSIFICATIONS));
  assert.deepEqual(AGT002_F4MIN_CLASSIFICATIONS, [
    'backfillable_with_source', 'legacy_metadata_only', 'requires_human_resolution',
  ]);
});
