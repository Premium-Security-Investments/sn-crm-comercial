// F4: the governed SharePoint company-evidence inventory snapshot. SharePoint stays the
// source of truth for the underlying files; this module only ever carries a SAFE, aggregate
// observation of it into the rest of AGT-002 — counts and a governed per-class state, never an
// item id, name, path, URL, eTag, raw content fingerprint or any personal data. That safety
// property is enforced structurally: every shape here (builder output, validator output, RPC
// payload) is a closed set of fields, and any extra/forbidden field fails the whole build/load
// closed rather than being silently dropped or passed through.
//
// The five governed states describe what SharePoint currently holds for a class, never what a
// human decided about it: they can never promote presence/review/validity/applicability/
// compliance (those stay exclusively the concern of psi_agt002_company_evidence_registry via
// agt002-company-evidence-classes.js). Zero linked source files is always the explicit
// documental gap absent_unknown — never silently omitted from the closed 17-class catalog.
//
// The loader reads through exactly one RPC and never a detail table directly, so no source-file
// row (and therefore no row id) can ever be selected into application memory by this module at
// all. Any RPC error or malformed/incomplete payload fails closed: this module exists precisely
// to stop "we could not read the inventory" from being silently absorbed as "this company has
// no evidence".

import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';

export const AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION = 'agt002-company-evidence-sharepoint-catalog-v1';
export const AGT002_COMPANY_EVIDENCE_GOVERNED_STATES = Object.freeze([
  'current_valid',
  'historical_update_required',
  'reported_unverified',
  'absent_unknown',
  'process_specific_template',
]);
export const AGT002_COMPANY_EVIDENCE_INVENTORY_RPC = 'psi_get_agt002_company_evidence_inventory_snapshot';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SNAPSHOT_KEYS = ['catalog_snapshot_hash', 'classes', 'excluded_non_evidence_count', 'inventory_version', 'source_file_count', 'state_counts'];
const CLASS_KEYS = ['effective_state', 'entry_id', 'last_reconciled_at', 'source_file_count', 'state_counts'];

function fail(message) {
  throw new Error(`AGT-002 catálogo SharePoint de evidencia empresarial: ${message}.`);
}

function requireExactKeys(value, expectedKeys, label) {
  const ownKeys = Object.keys(value);
  const extra = ownKeys.filter(key => !expectedKeys.includes(key));
  const missing = expectedKeys.filter(key => !ownKeys.includes(key));
  if (extra.length || missing.length) {
    fail(`${label} debe tener exactamente las claves [${expectedKeys.join(', ')}] (clave(s) inesperada(s): ${extra.join(', ') || 'ninguna'}; falta(n): ${missing.join(', ') || 'ninguna'})`);
  }
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${label} debe ser un entero no negativo`);
  }
  return value;
}

function requireHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    fail(`${label} debe ser un hash sha256 hexadecimal de 64 caracteres en minúsculas`);
  }
  return value;
}

function requireTimestampOrNull(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) fail(`${label} debe ser una marca de tiempo real o null`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${label} no es una fecha válida`);
  return parsed.toISOString();
}

function requireStateCounts(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} debe ser un objeto de conteos por estado`);
  requireExactKeys(value, AGT002_COMPANY_EVIDENCE_GOVERNED_STATES, label);
  const normalized = {};
  for (const state of AGT002_COMPANY_EVIDENCE_GOVERNED_STATES) {
    normalized[state] = requireNonNegativeInteger(value[state], `${label}.${state}`);
  }
  return Object.freeze(normalized);
}

function sumStateCounts(stateCounts) {
  return AGT002_COMPANY_EVIDENCE_GOVERNED_STATES.reduce((sum, state) => sum + stateCounts[state], 0);
}

/**
 * Pure, deterministic derivation of a class's governed effective_state from its own counts —
 * never a stored/model-supplied value. Zero source files is always the explicit documental gap
 * absent_unknown; otherwise the precedence is current_valid > historical_update_required >
 * reported_unverified > process_specific_template, with absent_unknown as the floor.
 */
export function resolveAgt002CompanyEvidenceEffectiveState({ source_file_count: sourceFileCount, state_counts: stateCounts }) {
  if (!sourceFileCount) return 'absent_unknown';
  if (stateCounts.current_valid > 0) return 'current_valid';
  if (stateCounts.historical_update_required > 0) return 'historical_update_required';
  if (stateCounts.reported_unverified > 0) return 'reported_unverified';
  if (stateCounts.process_specific_template > 0) return 'process_specific_template';
  return 'absent_unknown';
}

function parseClassRecord(rawClass, { expectEffectiveState }) {
  if (!rawClass || typeof rawClass !== 'object' || Array.isArray(rawClass)) fail('cada clase del inventario debe ser un objeto');
  if (expectEffectiveState) requireExactKeys(rawClass, CLASS_KEYS, `la clase de inventario ${typeof rawClass.entry_id === 'string' ? rawClass.entry_id : ''}`.trim());
  const entryId = typeof rawClass.entry_id === 'string' ? rawClass.entry_id.trim() : '';
  if (!entryId) fail('entry_id es obligatorio en cada clase del inventario');
  if (!AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(entryId)) {
    fail(`entry_id fuera del catálogo cerrado de evidencia: ${entryId}`);
  }
  const sourceFileCount = requireNonNegativeInteger(rawClass.source_file_count, `${entryId}.source_file_count`);
  const stateCounts = requireStateCounts(rawClass.state_counts, `${entryId}.state_counts`);
  const sum = sumStateCounts(stateCounts);
  if (sum !== sourceFileCount) {
    fail(`${entryId}: la suma de state_counts (${sum}) debe ser igual a source_file_count (${sourceFileCount}); total inconsistente`);
  }
  const lastReconciledAt = requireTimestampOrNull(rawClass.last_reconciled_at, `${entryId}.last_reconciled_at`);
  const effectiveState = resolveAgt002CompanyEvidenceEffectiveState({ source_file_count: sourceFileCount, state_counts: stateCounts });
  if (expectEffectiveState && rawClass.effective_state !== effectiveState) {
    fail(`${entryId}.effective_state no coincide con los conteos declarados`);
  }
  return Object.freeze({
    entry_id: entryId,
    source_file_count: sourceFileCount,
    state_counts: stateCounts,
    last_reconciled_at: lastReconciledAt,
    effective_state: effectiveState,
  });
}

function parseClasses(rawClasses, { expectEffectiveState }) {
  if (!Array.isArray(rawClasses)) fail('classes debe ser una lista');
  const byId = new Map();
  for (const rawClass of rawClasses) {
    const record = parseClassRecord(rawClass, { expectEffectiveState });
    if (byId.has(record.entry_id)) fail(`entry_id duplicado en classes: ${record.entry_id}`);
    byId.set(record.entry_id, record);
  }
  const missing = AGT002_COMPANY_EVIDENCE_CLASS_IDS.filter(id => !byId.has(id));
  if (byId.size !== AGT002_COMPANY_EVIDENCE_CLASS_IDS.length || missing.length) {
    fail(`se requieren exactamente ${AGT002_COMPANY_EVIDENCE_CLASS_IDS.length} clases del catálogo cerrado; falta(n): ${missing.join(', ') || 'ninguna'}`);
  }
  return AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(id => byId.get(id));
}

function finalizeSnapshot({ catalogSnapshotHash, sourceFileCount, excludedNonEvidenceCount, stateCounts, classes }) {
  const hash = requireHash(catalogSnapshotHash, 'catalog_snapshot_hash');
  const totalSourceFileCount = requireNonNegativeInteger(sourceFileCount, 'source_file_count');
  const excluded = requireNonNegativeInteger(excludedNonEvidenceCount, 'excluded_non_evidence_count');
  const normalizedStateCounts = requireStateCounts(stateCounts, 'state_counts');
  const total = sumStateCounts(normalizedStateCounts) + excluded;
  if (total !== totalSourceFileCount) {
    fail(`la suma de state_counts más excluded_non_evidence_count (${total}) debe ser igual a source_file_count (${totalSourceFileCount}); total inconsistente`);
  }
  return Object.freeze({
    inventory_version: AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION,
    catalog_snapshot_hash: hash,
    source_file_count: totalSourceFileCount,
    excluded_non_evidence_count: excluded,
    state_counts: normalizedStateCounts,
    classes: Object.freeze(classes),
  });
}

/**
 * Builds a safe governed SharePoint inventory snapshot from plain per-class counts. Fails
 * closed on any inconsistency: totals that do not add up (global or per-class), a class outside
 * (or missing from) the closed 17-class catalog, a duplicated entry_id, non-integer/negative
 * counts, a malformed catalog_snapshot_hash, or an unparseable last_reconciled_at. Order of the
 * `classes` input never affects the result: the snapshot is always emitted in closed-catalog
 * order.
 */
export function buildAgt002CompanyEvidenceInventorySnapshot({
  catalogSnapshotHash,
  sourceFileCount,
  excludedNonEvidenceCount,
  stateCounts,
  classes,
} = {}) {
  const parsedClasses = parseClasses(classes, { expectEffectiveState: false });
  return finalizeSnapshot({ catalogSnapshotHash, sourceFileCount, excludedNonEvidenceCount, stateCounts, classes: parsedClasses });
}

/**
 * Re-validates a snapshot received from elsewhere (the RPC, a frozen job, a fixture) rather
 * than trusting it verbatim: exact top-level and per-class key sets, exact inventory_version,
 * closed 17-class catalog coverage, per-class and global total consistency, and a re-derived
 * (never merely accepted) effective_state per class. Returns a frozen, normalized clone —
 * never the caller-held input — with classes in deterministic closed-catalog order.
 */
export function validateAgt002CompanyEvidenceInventorySnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('el inventario debe ser un objeto');
  requireExactKeys(value, SNAPSHOT_KEYS, 'el inventario');
  if (value.inventory_version !== AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION) {
    fail(`inventory_version debe ser ${AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION}`);
  }
  const parsedClasses = parseClasses(value.classes, { expectEffectiveState: true });
  return finalizeSnapshot({
    catalogSnapshotHash: value.catalog_snapshot_hash,
    sourceFileCount: value.source_file_count,
    excludedNonEvidenceCount: value.excluded_non_evidence_count,
    stateCounts: value.state_counts,
    classes: parsedClasses,
  });
}

/**
 * Loads the governed SharePoint inventory snapshot through exactly one RPC round-trip, then
 * re-validates it through the same validator the builder itself uses — the loader never has its
 * own, weaker rules. Fails closed on ANY database error (including "function/table does not
 * exist" codes that other optional-surface loaders in this codebase deliberately fail soft on)
 * and on any absent/malformed/internally-inconsistent payload: silently degrading into an empty
 * inventory would read as "this company has no evidence", which is exactly the failure mode
 * this snapshot exists to make impossible.
 */
export async function loadAgt002CompanyEvidenceInventorySnapshot(database) {
  const { data, error } = await database.rpc(AGT002_COMPANY_EVIDENCE_INVENTORY_RPC, {});
  if (error) {
    fail(`no se pudo cargar el inventario SharePoint de evidencia vía RPC ${AGT002_COMPANY_EVIDENCE_INVENTORY_RPC} (${error.code ?? 'sin código'}: ${error.message ?? 'sin mensaje'})`);
  }
  return validateAgt002CompanyEvidenceInventorySnapshot(data);
}
