// AGT-002 F4-min: bounded, isolated in-memory synthetic versioning slice.
//
// Pure, fail-closed, self-contained: no imports from the rest of the repo, no filesystem, no
// network, no relational database, no wall-clock reads of any kind. It models a fixed catalog of
// 33 generated synthetic legacy rows, each classified into exactly one of three closed
// classifications (backfillable_with_source, legacy_metadata_only, requires_human_resolution),
// exposed as a frozen, deterministic manifest with a verifiable hash chain. Only a row classified
// backfillable_with_source can ever be reconstructed into a "v1" version, and only when the caller
// supplies source bytes whose sha256 matches both the caller's own declared hash and this row's
// pinned expected hash, plus a mapping approved by a validated human identity bound to the exact
// row/source pair. Every id must carry the "synthetic-" prefix over a "fixture://" locator. This
// module never performs an external action and is not wired into any production route, worker,
// or database object.

import { createHash } from 'node:crypto';

export const AGT002_F4MIN_SCHEMA_VERSION = 1;
export const AGT002_F4MIN_ENVIRONMENT = 'isolated_fixture';
export const AGT002_F4MIN_ROW_COUNT = 33;
export const AGT002_F4MIN_RECONSTRUCTION_SENTINEL = 'agt002-f4-min-reconstruction/1.0.0';

export const AGT002_F4MIN_CLASSIFICATIONS = Object.freeze([
  'backfillable_with_source',
  'legacy_metadata_only',
  'requires_human_resolution',
]);

// Same closed-catalog convention as the rest of AGT-002's fail-closed modules: role ids are not
// people, and a principal without a durable, isolated locator is never treated as human.
const AGT002_F4MIN_ROLE_PRINCIPAL_IDS = Object.freeze([
  'admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta',
]);

export const AGT002_F4MIN_REASON_CODES = Object.freeze([
  'instance.torn_down',
  'reconstruction.sentinel_invalid',
  'row.not_found',
  'row.not_eligible_for_v1',
  'row.already_versioned',
  'version.id_not_synthetic',
  'version.timestamp_invalid',
  'source.id_not_synthetic',
  'source.bytes_missing',
  'source.hash_invalid',
  'source.hash_mismatch',
  'source.hash_mismatch_row_expectation',
  'provenance.fields_missing',
  'provenance.locator_not_isolated',
  'provenance.timestamp_invalid',
  'mapping.missing',
  'mapping.row_id_mismatch',
  'mapping.source_id_mismatch',
  'mapping.not_approved',
  'mapping.approval_timestamp_invalid',
  'identity.actor_missing',
  'identity.principal_kind_not_person',
  'identity.principal_id_missing',
  'identity.principal_id_is_role',
  'identity.durable_ref_missing',
  'identity.durable_ref_locator_not_isolated',
  'manifest.row_count_invalid',
  'manifest.classification_invalid',
  'manifest.row_hash_mismatch',
  'manifest.manifest_hash_mismatch',
]);

const SYNTHETIC_PREFIX = 'synthetic-';
const FIXTURE_LOCATOR_RE = /^fixture:\/\//;
const HASH64_RE = /^[0-9a-f]{64}$/;
const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSyntheticId(value) {
  return typeof value === 'string' && value.startsWith(SYNTHETIC_PREFIX) && value.length > SYNTHETIC_PREFIX.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

function hashOf(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

// Content hashing is deliberately distinct from `hashOf`: it hashes the raw bytes a caller claims
// to hold, never a JSON-structural re-encoding of them, so a caller cannot satisfy a bytes/hash
// check by reshaping data instead of possessing the actual source bytes.
function contentSha256Hex(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  return createHash('sha256').update(buffer).digest('hex');
}

// Public, pure fixture primitive: the canonical byte content backing a `backfillable_with_source`
// row's pinned `expected_content_sha256`. Exposed so a caller can legitimately reconstruct a row's
// v1 version by supplying exactly this content, without this module ever reading it from disk.
export function computeAgt002F4MinCanonicalSourceBytes(rowId) {
  return `agt002-f4-min-canonical-source::${rowId}`;
}

function withRowHash(row) {
  return Object.freeze({ ...row, row_hash: hashOf(row) });
}

function withManifestHash(manifest) {
  return Object.freeze({ ...manifest, manifest_hash: hashOf(manifest) });
}

function withRecordHash(record) {
  return Object.freeze({ ...record, record_hash: hashOf(record) });
}

function generateAgt002F4MinLegacyRows() {
  const rows = [];
  for (let index = 1; index <= AGT002_F4MIN_ROW_COUNT; index += 1) {
    const padded = String(index).padStart(3, '0');
    const rowId = `${SYNTHETIC_PREFIX}legacy-row-${padded}`;
    const classification = AGT002_F4MIN_CLASSIFICATIONS[(index - 1) % AGT002_F4MIN_CLASSIFICATIONS.length];
    const legacyLocator = `fixture://agt002-f4-min/legacy-rows/${padded}.json`;

    let sourceLocator = null;
    let expectedContentSha256 = null;
    let legacyMetadata = null;
    let conflict = null;

    if (classification === 'backfillable_with_source') {
      sourceLocator = `fixture://agt002-f4-min/sources/${padded}.json`;
      expectedContentSha256 = contentSha256Hex(computeAgt002F4MinCanonicalSourceBytes(rowId));
    } else if (classification === 'legacy_metadata_only') {
      legacyMetadata = { note: 'no recoverable source bytes; legacy metadata only' };
    } else {
      conflict = {
        code: 'ambiguous_legacy_mapping',
        detail: 'legacy row cannot be deterministically mapped to a unique source without human resolution',
      };
    }

    rows.push(withRowHash({
      row_id: rowId,
      index,
      classification,
      environment: AGT002_F4MIN_ENVIRONMENT,
      legacy_locator: legacyLocator,
      source_locator: sourceLocator,
      expected_content_sha256: expectedContentSha256,
      legacy_metadata: legacyMetadata,
      conflict,
    }));
  }
  return Object.freeze(rows);
}

// Public, pure reconstruction primitive: recomputes the hash a stored row *should* carry from its
// own fields (everything except row_hash), independent of this module's internal state.
export function recomputeAgt002F4MinRowHash(row) {
  if (!isPlainObject(row)) return null;
  const { row_hash, ...rest } = row;
  return hashOf(rest);
}

// Public, pure reconstruction primitive: recomputes the hash a stored manifest *should* carry from
// its own fields (everything except manifest_hash).
export function recomputeAgt002F4MinManifestHash(manifest) {
  if (!isPlainObject(manifest)) return null;
  const { manifest_hash, ...rest } = manifest;
  return hashOf(rest);
}

// Public, pure reconstruction primitive: recomputes the hash a stored version record *should*
// carry from its own fields (everything except record_hash).
export function recomputeAgt002F4MinVersionRecordHash(record) {
  if (!isPlainObject(record)) return null;
  const { record_hash, ...rest } = record;
  return hashOf(rest);
}

// Pure, deterministic builder: identical every call, on every instance, with no randomness and no
// wall-clock read of any kind.
export function buildAgt002F4MinManifest() {
  const rows = generateAgt002F4MinLegacyRows();
  const manifest = {
    schema_version: AGT002_F4MIN_SCHEMA_VERSION,
    environment: AGT002_F4MIN_ENVIRONMENT,
    row_count: rows.length,
    classifications: AGT002_F4MIN_CLASSIFICATIONS,
    rows,
  };
  return withManifestHash(manifest);
}

// Public, pure reconstruction check: recomputes every row's own hash and the manifest's own hash
// from the manifest's fields, and checks the closed classification catalog and fixed row count.
// Detects both row-level and manifest-level tampering.
export function verifyAgt002F4MinManifestIntegrity(manifest) {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.rows)) {
    return Object.freeze({ verdict: 'INVALID', reasons: Object.freeze(['manifest.row_count_invalid']) });
  }

  const reasons = [];
  if (manifest.row_count !== AGT002_F4MIN_ROW_COUNT || manifest.rows.length !== AGT002_F4MIN_ROW_COUNT) {
    reasons.push('manifest.row_count_invalid');
  }
  for (const row of manifest.rows) {
    if (!AGT002_F4MIN_CLASSIFICATIONS.includes(row && row.classification)) {
      reasons.push('manifest.classification_invalid');
    }
    if (recomputeAgt002F4MinRowHash(row) !== (row && row.row_hash)) {
      reasons.push('manifest.row_hash_mismatch');
    }
  }
  if (recomputeAgt002F4MinManifestHash(manifest) !== manifest.manifest_hash) {
    reasons.push('manifest.manifest_hash_mismatch');
  }

  const dedupedReasons = [...new Set(reasons)];
  return Object.freeze({ verdict: dedupedReasons.length === 0 ? 'VALID' : 'INVALID', reasons: Object.freeze(dedupedReasons) });
}

function validateHumanIdentity(actor) {
  if (!isPlainObject(actor)) return { valid: false, reason: 'identity.actor_missing' };
  if (actor.principal_kind !== 'person') return { valid: false, reason: 'identity.principal_kind_not_person' };
  if (typeof actor.principal_id !== 'string' || actor.principal_id.length === 0) {
    return { valid: false, reason: 'identity.principal_id_missing' };
  }
  if (AGT002_F4MIN_ROLE_PRINCIPAL_IDS.includes(actor.principal_id)) {
    return { valid: false, reason: 'identity.principal_id_is_role' };
  }
  const durableRef = actor.durable_ref;
  if (!isPlainObject(durableRef) || typeof durableRef.locator !== 'string' || durableRef.locator.length === 0) {
    return { valid: false, reason: 'identity.durable_ref_missing' };
  }
  if (!FIXTURE_LOCATOR_RE.test(durableRef.locator)) {
    return { valid: false, reason: 'identity.durable_ref_locator_not_isolated' };
  }
  return { valid: true, reason: null };
}

function freezeActor(actor) {
  return Object.freeze({
    principal_id: actor.principal_id,
    principal_kind: actor.principal_kind,
    durable_ref: Object.freeze({ ...actor.durable_ref }),
  });
}

export function createAgt002F4MinSyntheticVersioning() {
  const manifest = buildAgt002F4MinManifest();
  const versions = new Map();
  const auditLog = [];
  let auditCounter = 0;
  let tornDown = false;

  function audit({ phase, action, status, reason, row_id, actor_principal_id, at_utc }) {
    auditCounter += 1;
    auditLog.push(Object.freeze({
      audit_id: `synthetic-f4min-audit-${auditCounter}`,
      phase,
      action,
      status,
      reason: reason ?? null,
      row_id: row_id ?? null,
      actor_principal_id: actor_principal_id ?? null,
      at_utc: at_utc ?? null,
    }));
  }

  function deny(phase, action, reason, rowId = null, actorPrincipalId = null) {
    audit({ phase, action, status: 'DENIED', reason, row_id: rowId, actor_principal_id: actorPrincipalId, at_utc: null });
    return { status: 'DENIED', reason, version: null };
  }

  function getManifest() {
    return manifest;
  }

  function reconstructVersion(input = {}) {
    const {
      sentinel, row_id, version_id, source_id, source_bytes, source_hash,
      provenance, mapping, reconstructed_at_utc,
    } = input;

    if (tornDown) return deny('VERSION', 'reconstruct_version', 'instance.torn_down', row_id ?? null);
    if (sentinel !== AGT002_F4MIN_RECONSTRUCTION_SENTINEL) {
      return deny('VERSION', 'reconstruct_version', 'reconstruction.sentinel_invalid', row_id ?? null);
    }

    const row = manifest.rows.find((candidate) => candidate.row_id === row_id);
    if (!row) return deny('VERSION', 'reconstruct_version', 'row.not_found', row_id ?? null);
    if (row.classification !== 'backfillable_with_source') {
      return deny('VERSION', 'reconstruct_version', 'row.not_eligible_for_v1', row_id);
    }
    if (versions.has(row_id)) return deny('VERSION', 'reconstruct_version', 'row.already_versioned', row_id);

    if (!isSyntheticId(version_id)) return deny('VERSION', 'reconstruct_version', 'version.id_not_synthetic', row_id);
    if (!isSyntheticId(source_id)) return deny('VERSION', 'reconstruct_version', 'source.id_not_synthetic', row_id);

    if (!isPlainObject(mapping)) return deny('VERSION', 'reconstruct_version', 'mapping.missing', row_id);
    if (mapping.row_id !== row_id) return deny('VERSION', 'reconstruct_version', 'mapping.row_id_mismatch', row_id);
    if (mapping.source_id !== source_id) return deny('VERSION', 'reconstruct_version', 'mapping.source_id_mismatch', row_id);
    if (mapping.approved !== true) return deny('VERSION', 'reconstruct_version', 'mapping.not_approved', row_id);

    const identity = validateHumanIdentity(mapping.approver);
    if (!identity.valid) {
      return deny('VERSION', 'reconstruct_version', identity.reason, row_id, mapping.approver && mapping.approver.principal_id);
    }
    const approverPrincipalId = mapping.approver.principal_id;
    if (!RFC3339_UTC_RE.test(mapping.approved_at_utc)) {
      return deny('VERSION', 'reconstruct_version', 'mapping.approval_timestamp_invalid', row_id, approverPrincipalId);
    }

    if (
      !isPlainObject(provenance)
      || typeof provenance.source !== 'string' || provenance.source.length === 0
      || typeof provenance.issuer !== 'string' || provenance.issuer.length === 0
      || typeof provenance.locator !== 'string' || provenance.locator.length === 0
      || typeof provenance.captured_at_utc !== 'string' || provenance.captured_at_utc.length === 0
    ) {
      return deny('VERSION', 'reconstruct_version', 'provenance.fields_missing', row_id, approverPrincipalId);
    }
    if (!FIXTURE_LOCATOR_RE.test(provenance.locator)) {
      return deny('VERSION', 'reconstruct_version', 'provenance.locator_not_isolated', row_id, approverPrincipalId);
    }
    if (!RFC3339_UTC_RE.test(provenance.captured_at_utc)) {
      return deny('VERSION', 'reconstruct_version', 'provenance.timestamp_invalid', row_id, approverPrincipalId);
    }

    if (!((typeof source_bytes === 'string' && source_bytes.length > 0) || Buffer.isBuffer(source_bytes))) {
      return deny('VERSION', 'reconstruct_version', 'source.bytes_missing', row_id, approverPrincipalId);
    }
    if (!HASH64_RE.test(source_hash)) {
      return deny('VERSION', 'reconstruct_version', 'source.hash_invalid', row_id, approverPrincipalId);
    }
    const computedHash = contentSha256Hex(source_bytes);
    if (computedHash !== source_hash) {
      return deny('VERSION', 'reconstruct_version', 'source.hash_mismatch', row_id, approverPrincipalId);
    }
    // Fail-closed: even self-consistent bytes/hash pairs are refused unless they match this row's
    // pinned expectation — a caller cannot fabricate a v1 out of arbitrary, if internally
    // consistent, content.
    if (computedHash !== row.expected_content_sha256) {
      return deny('VERSION', 'reconstruct_version', 'source.hash_mismatch_row_expectation', row_id, approverPrincipalId);
    }

    if (!RFC3339_UTC_RE.test(reconstructed_at_utc)) {
      return deny('VERSION', 'reconstruct_version', 'version.timestamp_invalid', row_id, approverPrincipalId);
    }

    const record = withRecordHash({
      schema_version: AGT002_F4MIN_SCHEMA_VERSION,
      environment: AGT002_F4MIN_ENVIRONMENT,
      row_id,
      version_id,
      source_id,
      content_sha256: computedHash,
      provenance: Object.freeze({ ...provenance }),
      mapping: Object.freeze({
        row_id: mapping.row_id,
        source_id: mapping.source_id,
        approved: true,
        approver: freezeActor(mapping.approver),
        approved_at_utc: mapping.approved_at_utc,
      }),
      reconstructed_at_utc,
      previous_hash: row.row_hash,
    });

    versions.set(row_id, record);
    audit({
      phase: 'VERSION', action: 'reconstruct_version', status: 'ALLOWED', reason: null,
      row_id, actor_principal_id: approverPrincipalId, at_utc: reconstructed_at_utc,
    });
    return { status: 'RECORDED', reason: null, version: record };
  }

  function getVersions() {
    return new Map(versions);
  }

  function getAuditLog() {
    return [...auditLog];
  }

  function teardown({ torn_down_at_utc } = {}) {
    const alreadyTornDown = tornDown;
    versions.clear();
    tornDown = true;
    // The audit trail is not "working data" — it is the compliance ledger, and it survives
    // teardown untouched. Teardown removes only this instance's isolated version records.
    audit({
      phase: 'LIFECYCLE', action: 'teardown', status: 'ALLOWED', reason: null,
      row_id: null, actor_principal_id: null, at_utc: torn_down_at_utc ?? null,
    });
    return { status: 'TORN_DOWN', reason: null, already_torn_down: alreadyTornDown };
  }

  return Object.freeze({
    getManifest,
    reconstructVersion,
    getVersions,
    getAuditLog,
    teardown,
  });
}
