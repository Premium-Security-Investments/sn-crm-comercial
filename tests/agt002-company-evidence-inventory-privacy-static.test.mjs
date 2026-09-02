// AGT-002 — privacy/minimum-exposure contract for the governed SharePoint company-evidence
// catalog. SharePoint stays the source of truth: this system inventories, classifies and
// links, and must never persist or forward a file's name, path, URL, eTag, item id, raw
// content fingerprint or any personal data.
//
// RED reason: `agt002-company-evidence-sharepoint-catalog.js` does not exist, so the dynamic
// import throws ERR_MODULE_NOT_FOUND before any assertion runs; the model-projection
// assertions below additionally require the per-class `inventory` summary that
// buildAgt002CompanyEvidenceClasses does not produce yet.
//
// Two distinct guarantees are pinned here:
//   (a) FORBIDDEN FIELD NAMES — no locator/identity field may ever appear as a key anywhere
//       in the safe snapshot, the typed class artifact or the run identity;
//   (b) SAFE MODEL PROJECTION — catalog_snapshot_hash and every source-file id are run
//       identity, not model input: they must never reach the packet the provider sees.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  AGT002_COMPANY_EVIDENCE_CLASS_IDS,
  buildAgt002CompanyEvidenceClasses,
} from '../agt002-company-evidence-classes.js';
import { buildAgt002CompanyEvidenceIdentity } from '../agt002-company-evidence-identity.js';

const catalogModulePath = new URL('../agt002-company-evidence-sharepoint-catalog.js', import.meta.url);
const { buildAgt002CompanyEvidenceInventorySnapshot } = await import(catalogModulePath.href);

const catalogSource = readFileSync(catalogModulePath, 'utf8');
const engineSource = readFileSync(new URL('../agt002-preview-engine.js', import.meta.url), 'utf8');
const previewInputSource = readFileSync(new URL('../agt002-preview-input.js', import.meta.url), 'utf8');
const classesSource = readFileSync(new URL('../agt002-company-evidence-classes.js', import.meta.url), 'utf8');

const CATALOG_HASH = 'c'.repeat(64);
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Exact key names (never substrings — `source_file_count` is a legitimate safe count, while
// `source_file_id` is a row identity that must never leave the database).
const FORBIDDEN_KEYS = new Set([
  'name', 'file_name', 'filename', 'display_name', 'title',
  'path', 'relative_path', 'folder_path', 'parent_path', 'full_path',
  'url', 'web_url', 'weburl', 'download_url', 'source_url', 'signed_url',
  'etag', 'e_tag', 'item_id', 'drive_id', 'site_id', 'sharepoint_item_id',
  'source_file_id', 'source_fingerprint', 'source_revision', 'content_hash',
  'catalog_snapshot_hash',
  'email', 'phone', 'cedula', 'nit', 'document_number', 'owner_name', 'author',
]);

function walk(value, visit, path = '$') {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walk(child, visit, `${path}.${key}`);
  }
}

function assertSafe(artifact, label, { allowKeys = new Set() } = {}) {
  walk(artifact, (value, path) => {
    const key = path.split('.').pop().replace(/\[\d+\]$/, '');
    if (!allowKeys.has(key)) {
      assert.ok(!FORBIDDEN_KEYS.has(key), `${label}: forbidden field name "${key}" at ${path}`);
    }
    if (typeof value === 'string') {
      const lowered = value.toLowerCase();
      for (const forbidden of ['http://', 'https://', 'sharepoint', '/sites/', '/drives/', ':/root:', '.pdf', '.docx', '.xlsx', '.zip']) {
        assert.ok(!lowered.includes(forbidden), `${label}: forbidden value fragment "${forbidden}" at ${path}`);
      }
      assert.doesNotMatch(value, UUID_ANYWHERE, `${label}: a row-identity uuid must never appear at ${path}`);
    }
  });
}

function stateCounts(overrides = {}) {
  return {
    current_valid: 0, historical_update_required: 0, reported_unverified: 0, absent_unknown: 0, process_specific_template: 0,
    ...overrides,
  };
}

function registryRow(entryId) {
  return {
    entry_id: entryId,
    document_class: `Clase ${entryId}`,
    existence_status: 'reported',
    human_review_status: 'pending_human_review',
    applicability_status: 'pending_case_validation',
    // Deliberately hostile input: every one of these must be dropped by the projection.
    source_reference: 'Comercial/Licitaciones/RAMA JUDICIAL PEREIRA/POLIZA RCE.zip',
    item_id: '01PXSUBJ3FM4EW7U2H35BZF3IFBM2PTWRA',
    web_url: 'https://contoso.sharepoint.com/sites/comercial/Documents/POLIZA%20RCE.zip',
    notes: 'cédula 1.234.567 del representante legal',
    human_gate: 'juridico_y_comercial',
    hash: 'a'.repeat(64),
    expiry: null,
    current: true,
    integration_active: true,
    updated_at: '2026-08-01T10:00:00.000Z',
    created_at: '2026-07-01T10:00:00.000Z',
    source_manifest_version: 'v0.3.1-approved-20260829',
  };
}

const registryEntries = AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(registryRow);
const inventorySnapshot = buildAgt002CompanyEvidenceInventorySnapshot({
  catalogSnapshotHash: CATALOG_HASH,
  sourceFileCount: 93,
  excludedNonEvidenceCount: 1,
  stateCounts: stateCounts({ historical_update_required: 25, reported_unverified: 50, process_specific_template: 17 }),
  classes: AGT002_COMPANY_EVIDENCE_CLASS_IDS.map((entryId, index) => {
    const counts = index === 0
      ? stateCounts({ historical_update_required: 2 })
      : stateCounts({ reported_unverified: 1 });
    return {
      entry_id: entryId,
      source_file_count: Object.values(counts).reduce((sum, value) => sum + value, 0),
      state_counts: counts,
      last_reconciled_at: '2026-09-01T00:00:00.000Z',
    };
  }),
});

// ===========================================================================
// (a) Forbidden field names.
// ===========================================================================
assertSafe(inventorySnapshot, 'inventory snapshot', { allowKeys: new Set(['catalog_snapshot_hash']) });
assert.equal(
  inventorySnapshot.catalog_snapshot_hash, CATALOG_HASH,
  'precondition: the snapshot itself legitimately carries the catalog hash — it is run identity',
);

const built = buildAgt002CompanyEvidenceClasses({
  registryEntries, inventorySnapshot, asOf: new Date('2026-08-29T00:00:00.000Z'),
});
assertSafe(built, 'typed company evidence classes');

const identity = buildAgt002CompanyEvidenceIdentity({
  registryEntries, inventorySnapshot, asOf: new Date('2026-08-29T00:00:00.000Z'),
});
assertSafe(identity, 'company evidence run identity');

// The hostile registry columns above must be gone, not merely renamed.
{
  const serialized = JSON.stringify(built);
  for (const leaked of ['POLIZA', 'sharepoint', '01PXSUBJ', 'cédula', 'RAMA JUDICIAL']) {
    assert.ok(!serialized.includes(leaked), `the typed artifact must never leak "${leaked}"`);
  }
}

// ===========================================================================
// (b) Safe model projection: catalog_snapshot_hash and source ids never reach the model.
// ===========================================================================

// The typed class artifact is what buildAgt002PreviewInput carries verbatim into
// `company_evidence_classes` — the packet the provider actually sees.
{
  const serialized = JSON.stringify(built);
  assert.ok(!serialized.includes(CATALOG_HASH), 'catalog_snapshot_hash must never reach the model packet');
  assert.ok(!serialized.includes('catalog_snapshot_hash'), 'not even the field name may reach the model packet');
  assert.doesNotMatch(serialized, UUID_ANYWHERE, 'no source-file row id may reach the model packet');

  for (const cls of built.classes) {
    assert.deepEqual(
      Object.keys(cls.inventory).sort(),
      ['effective_state', 'last_reconciled_at', 'source_file_count', 'state_counts'].sort(),
      `${cls.entry_id}: the model-facing inventory summary is counts and state only`,
    );
  }
}

// Source-level lock: the catalog hash lives in run identity (agt002-company-evidence-identity.js)
// and in the database, never in the model-facing packet builders.
assert.doesNotMatch(engineSource, /catalog_snapshot_hash/, 'the preview engine must never handle the catalog hash as model input');
assert.doesNotMatch(previewInputSource, /catalog_snapshot_hash/, 'the preview input builder must never carry the catalog hash to the provider');
assert.doesNotMatch(classesSource, /catalog_snapshot_hash/, 'the typed class builder must never project the catalog hash');

// The catalog module reads through its single RPC and never touches a detail table, so no
// source-file row (and therefore no row id) can be selected into application memory at all.
assert.doesNotMatch(
  catalogSource,
  /psi_agt002_company_evidence_source_files|psi_agt002_company_evidence_source_file_links/,
  'the catalog module must never query a detail table directly — the safe RPC is the only read path',
);
assert.doesNotMatch(catalogSource, /\.from\(/, 'the catalog module must never build a table query');
assert.doesNotMatch(catalogSource, /\.select\(\s*['"`]\*/, 'select(*) is prohibited on every AGT-002 evidence surface');

console.log('AGT-002 company evidence catalog privacy contract (forbidden field names + safe model projection) passed');
