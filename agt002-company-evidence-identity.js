// F3: a compact, run-binding identity for the AGT-002 company evidence registry, so a
// snapshot/context idempotency key can be made to depend on WHICH evidence backed a run —
// never only on the snapshot/context/inventory identity that already exists. Without this,
// re-running the same tender against a corrected/expired evidence row would silently reuse
// the stale run instead of triggering a fresh analysis.
//
// This module never reads the database itself and never invents anything: it re-validates
// its input the same way agt002-company-evidence-classes.js does (reusing its own closed
// enums and its own buildAgt002CompanyEvidenceClasses builder), then fails closed on any
// registry snapshot that is not exactly the 17 current rows of the closed catalog, sharing
// one non-empty source_manifest_version. The three returned fields are opaque sha256
// digests / a version string — never the underlying rows — so nothing sensitive (source
// reference, human_gate, notes, storage paths, signed URLs, raw content) can ever leak
// through this identity, regardless of what the input rows carried.

import { createHash } from 'node:crypto';
import {
  AGT002_COMPANY_EVIDENCE_CLASS_IDS,
  AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES,
  AGT002_COMPANY_EVIDENCE_REVIEW_STATUSES,
  AGT002_COMPANY_EVIDENCE_APPLICABILITY_STATUSES,
  buildAgt002CompanyEvidenceClasses,
} from './agt002-company-evidence-classes.js';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const EXPECTED_CLASS_COUNT = AGT002_COMPANY_EVIDENCE_CLASS_IDS.length;
const EVIDENCE_IDENTITY_KEYS = ['source_snapshot_hash', 'preview_artifact_hash', 'source_manifest_version'];
const CANONICAL_AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/;

function fail(message) {
  throw new Error(`AGT-002 identidad de evidencia empresarial: ${message}.`);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} debe ser texto no vacío`);
  return value.trim();
}

function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} no es un valor permitido: ${String(value)}`);
  return value;
}

function requireHashOrNull(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    fail(`${label} debe ser un hash sha256 hexadecimal (64 caracteres) o null`);
  }
  return value;
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} debe ser una marca de tiempo real`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${label} no es una fecha válida`);
  return parsed.toISOString();
}

function normalizeExpiry(value, label) {
  if (value === null || value === undefined) return null;
  const text = String(value).slice(0, 10);
  if (Number.isNaN(new Date(`${text}T00:00:00.000Z`).getTime())) fail(`${label} no es una fecha válida`);
  return text;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

/** Deterministic sha256 over a canonical (sorted-keys) JSON serialization; order of object keys never affects the result. */
export function computeAgt002CompanyEvidenceCanonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(sortKeysDeep(value)), 'utf8').digest('hex');
}

// Only the safe, decisional columns ever enter the snapshot identity — never
// source_reference, human_gate, notes, storage paths, signed URLs or any raw content.
function validateRow(rawEntry, seenEntryIds) {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) fail('cada fila del registro debe ser un objeto');
  const entryId = requireNonEmptyString(rawEntry.entry_id, 'entry_id');
  if (!AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(entryId)) {
    fail(`entry_id fuera del catálogo cerrado de ${EXPECTED_CLASS_COUNT} clases: ${entryId}`);
  }
  if (seenEntryIds.has(entryId)) fail(`entry_id duplicado: ${entryId}`);
  seenEntryIds.add(entryId);
  if (rawEntry.current !== true) fail(`${entryId}: sólo se admiten filas current=true`);
  const existenceStatus = requireEnum(rawEntry.existence_status, AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES, `${entryId}.existence_status`);
  const humanReviewStatus = requireEnum(rawEntry.human_review_status, AGT002_COMPANY_EVIDENCE_REVIEW_STATUSES, `${entryId}.human_review_status`);
  const applicabilityStatus = requireEnum(rawEntry.applicability_status, AGT002_COMPANY_EVIDENCE_APPLICABILITY_STATUSES, `${entryId}.applicability_status`);
  const hash = requireHashOrNull(rawEntry.hash, `${entryId}.hash`);
  if (typeof rawEntry.integration_active !== 'boolean') fail(`${entryId}.integration_active debe ser booleano`);
  const sourceManifestVersion = requireNonEmptyString(rawEntry.source_manifest_version, `${entryId}.source_manifest_version`);
  const updatedAt = requireIsoTimestamp(rawEntry.updated_at, `${entryId}.updated_at`);
  const expiry = normalizeExpiry(rawEntry.expiry, `${entryId}.expiry`);
  return {
    entry_id: entryId,
    hash,
    expiry,
    existence_status: existenceStatus,
    human_review_status: humanReviewStatus,
    applicability_status: applicabilityStatus,
    integration_active: rawEntry.integration_active,
    source_manifest_version: sourceManifestVersion,
    updated_at: updatedAt,
  };
}

/**
 * Re-validates a `{ source_snapshot_hash, preview_artifact_hash, source_manifest_version }`
 * value against the exact shape `buildAgt002CompanyEvidenceIdentity` produces: own (never
 * inherited) properties, no extras, no missing keys, both hashes exact 64-lowercase-hex
 * sha256 digests, and a non-empty manifest version. Any caller that receives this identity
 * from elsewhere (e.g. persisted alongside a context) must re-validate through this function
 * rather than trust it verbatim. Returns a frozen clone — never the input object itself — so
 * a caller-held reference can never mutate the value after validation.
 */
export function validateAgt002CompanyEvidenceIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('la identidad de evidencia empresarial debe ser un objeto');
  }
  const ownKeys = Object.keys(value);
  if (ownKeys.length !== EVIDENCE_IDENTITY_KEYS.length || !EVIDENCE_IDENTITY_KEYS.every(key => Object.hasOwn(value, key))) {
    fail(`la identidad de evidencia empresarial debe tener exactamente ${EVIDENCE_IDENTITY_KEYS.join(', ')}`);
  }
  const sourceSnapshotHash = requireNonEmptyString(value.source_snapshot_hash, 'source_snapshot_hash');
  if (!HASH_PATTERN.test(sourceSnapshotHash)) fail('source_snapshot_hash debe ser un hash sha256 hexadecimal (64 caracteres) en minúsculas');
  const previewArtifactHash = requireNonEmptyString(value.preview_artifact_hash, 'preview_artifact_hash');
  if (!HASH_PATTERN.test(previewArtifactHash)) fail('preview_artifact_hash debe ser un hash sha256 hexadecimal (64 caracteres) en minúsculas');
  const sourceManifestVersion = requireNonEmptyString(value.source_manifest_version, 'source_manifest_version');
  return Object.freeze({
    source_snapshot_hash: sourceSnapshotHash,
    preview_artifact_hash: previewArtifactHash,
    source_manifest_version: sourceManifestVersion,
  });
}

/**
 * Validates that `value` is EXACTLY the canonical start-of-day UTC instant
 * `deriveAgt002CompanyEvidenceAsOf` produces — `YYYY-MM-DDT00:00:00.000Z`, never an offset,
 * never a non-midnight time, never merely "Date-parseable" — and that it round-trips through
 * `Date` back to itself, so a calendar-impossible date (e.g. `2024-02-30T00:00:00.000Z`, which
 * `Date` silently rolls into March) is rejected rather than silently accepted. Every governed
 * asOf consumer (frozen reanalysis input, reanalysis executor, preview runtime, preview engine)
 * shares this single validator rather than re-deriving its own parseability check. Returns the
 * validated string.
 */
export function validateAgt002CompanyEvidenceAsOf(value, label = 'evidenceAsOf') {
  if (typeof value !== 'string' || !CANONICAL_AS_OF_PATTERN.test(value)) {
    fail(`${label} debe tener el formato canónico UTC de inicio de día YYYY-MM-DDT00:00:00.000Z`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} no es una fecha UTC válida`);
  }
  return value;
}

/**
 * Derives the single deterministic instant a company-evidence build/identity run must use as
 * `asOf`: the start of UTC day containing the latest `updated_at` across the exact 17 current
 * rows of the closed catalog. Pure and deterministic — never reads the wall clock (`new
 * Date()`) — so the SAME registry snapshot always derives the SAME asOf, independent of when or
 * how many times it is called. Fails closed exactly like buildAgt002CompanyEvidenceIdentity's own
 * row/catalog checks: not an array, not exactly 17 rows, a row outside the closed catalog, a
 * missing/duplicated entry_id, or a row with no parseable `updated_at`.
 */
export function deriveAgt002CompanyEvidenceAsOf(registryEntries) {
  if (!Array.isArray(registryEntries)) fail('registryEntries debe ser una lista');
  if (registryEntries.length !== EXPECTED_CLASS_COUNT) {
    fail(`se requieren exactamente ${EXPECTED_CLASS_COUNT} filas current del catálogo cerrado, hay ${registryEntries.length}`);
  }

  const seenEntryIds = new Set();
  let latestMs = null;
  for (const rawEntry of registryEntries) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) fail('cada fila del registro debe ser un objeto');
    const entryId = requireNonEmptyString(rawEntry.entry_id, 'entry_id');
    if (!AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(entryId)) {
      fail(`entry_id fuera del catálogo cerrado de ${EXPECTED_CLASS_COUNT} clases: ${entryId}`);
    }
    if (seenEntryIds.has(entryId)) fail(`entry_id duplicado: ${entryId}`);
    seenEntryIds.add(entryId);
    const updatedAtMs = new Date(requireIsoTimestamp(rawEntry.updated_at, `${entryId}.updated_at`)).getTime();
    if (latestMs === null || updatedAtMs > latestMs) latestMs = updatedAtMs;
  }

  for (const catalogEntryId of AGT002_COMPANY_EVIDENCE_CLASS_IDS) {
    if (!seenEntryIds.has(catalogEntryId)) fail(`falta la fila current del catálogo cerrado: ${catalogEntryId}`);
  }

  return `${new Date(latestMs).toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/**
 * Builds the run-binding evidence identity `{ source_snapshot_hash, preview_artifact_hash,
 * source_manifest_version }` from the exact 17 current rows of the closed company evidence
 * catalog. Fails closed on anything else: not an array, not exactly 17 rows, a row outside
 * the closed catalog, a missing or duplicated entry_id, a non-current row, an invalid
 * status/hash, or rows whose source_manifest_version disagrees with one another (e.g. a
 * registry snapshot mixing the v0.2 and v0.3.1 manifests).
 *
 * `source_snapshot_hash` is a canonical hash of the rows themselves (order-independent,
 * safe columns only); `preview_artifact_hash` is a canonical hash of the typed
 * {classes, coverage} artifact this same input actually projects to via
 * buildAgt002CompanyEvidenceClasses — so it changes whenever the real projection would,
 * including through `asOf`.
 */
export function buildAgt002CompanyEvidenceIdentity({ registryEntries, asOf = new Date() } = {}) {
  if (!Array.isArray(registryEntries)) fail('registryEntries debe ser una lista');
  if (registryEntries.length !== EXPECTED_CLASS_COUNT) {
    fail(`se requieren exactamente ${EXPECTED_CLASS_COUNT} filas current del catálogo cerrado, hay ${registryEntries.length}`);
  }

  const seenEntryIds = new Set();
  const rows = registryEntries.map(rawEntry => validateRow(rawEntry, seenEntryIds));

  for (const catalogEntryId of AGT002_COMPANY_EVIDENCE_CLASS_IDS) {
    if (!seenEntryIds.has(catalogEntryId)) fail(`falta la fila current del catálogo cerrado: ${catalogEntryId}`);
  }

  const manifestVersions = new Set(rows.map(row => row.source_manifest_version));
  if (manifestVersions.size !== 1) {
    fail(`todas las filas deben compartir el mismo source_manifest_version; se encontraron mezclados: ${[...manifestVersions].sort().join(', ')}`);
  }
  const [sourceManifestVersion] = manifestVersions;

  const canonicalRows = [...rows].sort((a, b) => (a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0));
  const sourceSnapshotHash = computeAgt002CompanyEvidenceCanonicalHash(canonicalRows);

  // Re-derived through the real runtime builder — never a hand-rolled shadow of it — so
  // this identity changes whenever the actual projection (coverage/validity) would.
  const { classes, coverage } = buildAgt002CompanyEvidenceClasses({ registryEntries, asOf });
  const previewArtifactHash = computeAgt002CompanyEvidenceCanonicalHash({ classes, coverage });

  return validateAgt002CompanyEvidenceIdentity({
    source_snapshot_hash: sourceSnapshotHash,
    preview_artifact_hash: previewArtifactHash,
    source_manifest_version: sourceManifestVersion,
  });
}
