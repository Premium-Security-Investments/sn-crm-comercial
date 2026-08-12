import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { AGT002_COMPANY_EVIDENCE_REGISTRY_SELECT } from '../agt002-company-dossier.js';

// F2: the 061 registry already carries 17 typed classes with independent
// existence_status/human_review_status/applicability_status columns, but every
// existing read path (agt002-company-dossier.js) compresses them into pipe-delimited
// strings inside a single recurring_documents evidence value, and its own SELECT list
// does not even fetch human_review_status — so review status is not independently
// available through any existing surface. This proves that gap directly (no new
// module needed to demonstrate it), then — once the new typed module exists — runs
// the full contract: 17 classes as separate objects, five independent status
// dimensions that presence must never imply, a closed coverage manifest, and strict
// exclusion of sensitive/raw fields.
const modulePath = new URL('../agt002-company-evidence-classes.js', import.meta.url);
if (!existsSync(modulePath)) {
  assert.match(
    AGT002_COMPANY_EVIDENCE_REGISTRY_SELECT,
    /human_review_status/,
    'GAP (expected before F2): the existing dossier registry select does not fetch human_review_status independently of applicability/existence — there is no existing surface exposing all five status dimensions as separate fields.',
  );
  console.log('AGT-002 typed company evidence classes: module not present yet — ran only the gap-proving RED assertion above.');
} else {
  // recurring_documents/legacy must stay exactly as it was: F2 is additive, not a
  // replacement. The legacy select list still deliberately does not carry
  // human_review_status as an independent field — only the new typed module's own
  // select (asserted below) does.
  assert.doesNotMatch(
    AGT002_COMPANY_EVIDENCE_REGISTRY_SELECT,
    /human_review_status/,
    'the legacy dossier registry select must stay unchanged (v2/recurring_documents compatibility) — F2 must not have widened it',
  );
  const {
    AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES,
    AGT002_COMPANY_EVIDENCE_REVIEW_STATUSES,
    AGT002_COMPANY_EVIDENCE_VALIDITY_STATUSES,
    AGT002_COMPANY_EVIDENCE_APPLICABILITY_STATUSES,
    AGT002_COMPANY_EVIDENCE_COMPLIANCE_STATUSES,
    AGT002_COMPANY_EVIDENCE_COVERAGE_CATEGORIES,
    AGT002_COMPANY_EVIDENCE_CLASS_IDS,
    AGT002_COMPANY_EVIDENCE_CLASS_SELECT,
    AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS,
    assertAgt002CompanyEvidenceRegistryMinimalExposureSelect,
    buildAgt002CompanyEvidenceClasses,
    loadAgt002CompanyEvidenceClasses,
    loadAgt002CompanyEvidenceRegistryEntries,
  } = await import(modulePath.href);

  const ASOF = new Date('2026-08-06T00:00:00.000Z');

  function entry(overrides = {}) {
    return {
      entry_id: 'supervigilancia_operating_license',
      document_class: 'Licencia de funcionamiento SuperVigilancia',
      existence_status: 'reported',
      human_review_status: 'pending_human_review',
      applicability_status: 'pending_case_validation',
      source_reference: 'LICENCIA DE FUNCIONAMIENTO SEGURIDAD NACIONAL',
      human_gate: 'juridico_y_comercial',
      hash: '45d9857f2a128853d53b6e7040dcff9551668b5e4e936dcc4e2c7249dce88255',
      expiry: null,
      current: true,
      integration_active: true,
      updated_at: '2026-08-01T10:00:00.000Z',
      created_at: '2026-07-01T10:00:00.000Z',
      // Fields that must never leak into the typed general-layer contract.
      notes: 'Excluir nombres, cédulas, firmas, direcciones.',
      decision_humana: 'aprobado',
      decision_humana_fecha: '2026-08-01',
      estado_posterior_decision: 'vigente',
      storage_path: '/vault/secret/license.pdf',
      signed_url: 'https://storage.example/signed?token=secret',
      account_number: '000111222',
      ...overrides,
    };
  }

  // --- Closed enums are exported and match the DB's own closed check constraints. ---
  assert.deepEqual([...AGT002_COMPANY_EVIDENCE_PRESENCE_STATUSES].sort(), ['not_verified', 'reported', 'verified']);
  assert.deepEqual([...AGT002_COMPANY_EVIDENCE_REVIEW_STATUSES].sort(), ['approved', 'pending_human_review', 'rejected']);
  assert.deepEqual([...AGT002_COMPANY_EVIDENCE_VALIDITY_STATUSES].sort(), ['current', 'expired', 'unknown']);
  assert.deepEqual([...AGT002_COMPANY_EVIDENCE_APPLICABILITY_STATUSES].sort(), ['applicable', 'not_applicable', 'pending_case_validation']);
  assert.ok(AGT002_COMPANY_EVIDENCE_COMPLIANCE_STATUSES.includes('pending_review'));
  assert.deepEqual([...AGT002_COMPANY_EVIDENCE_COVERAGE_CATEGORIES].sort(), ['available', 'expired', 'inaccessible', 'omitted', 'pending_review', 'selected']);
  assert.match(AGT002_COMPANY_EVIDENCE_CLASS_SELECT, /human_review_status/, 'the typed module\'s own SELECT must fetch human_review_status');

  // --- Each of the 17 classes becomes a separate typed object, not a compressed string. ---
  const licenseEntry = entry();
  const rupEntry = entry({
    entry_id: 'rup', document_class: 'Registro Único de Proponentes (RUP)',
    existence_status: 'reported', human_review_status: 'approved', applicability_status: 'applicable',
    hash: null, expiry: '2020-01-01', // expired relative to ASOF
    updated_at: '2026-07-15T00:00:00.000Z',
  });
  const deactivatedEntry = entry({
    entry_id: 'communications_license', document_class: 'Licencia o permisos de comunicaciones', integration_active: false,
    hash: 'a'.repeat(64), updated_at: '2026-06-01T00:00:00.000Z',
  });

  const { classes, coverage } = buildAgt002CompanyEvidenceClasses({ registryEntries: [licenseEntry, rupEntry, deactivatedEntry], asOf: ASOF });
  const expectedClassIds = [
    'supervigilancia_operating_license', 'rup', 'rut', 'communications_license',
    'uniforms_resolution', 'no_fines_sanctions_certificate', 'authorized_weapons_list',
    'rce_policy', 'collective_life_policy', 'accredited_experience',
    'financial_and_tax_pack', 'bank_certificate', 'overtime_authorization',
    'corporate_background_checks', 'legal_representative_vault',
    'personnel_credentials_vault', 'differential_scoring_support',
  ];
  assert.ok(Array.isArray(AGT002_COMPANY_EVIDENCE_CLASS_IDS), 'the foundation must export the closed class catalog');
  assert.deepEqual([...AGT002_COMPANY_EVIDENCE_CLASS_IDS], expectedClassIds, 'the foundation must publish exactly the 17 class IDs seeded by migration 061');
  assert.equal(classes.length, 17, 'the typed contract must always expose all 17 expected classes, including explicit inaccessible placeholders');
  assert.deepEqual(classes.map(c => c.entry_id), [...AGT002_COMPANY_EVIDENCE_CLASS_IDS], 'class output must be complete and deterministically catalog-ordered');

  const license = classes.find(c => c.entry_id === 'supervigilancia_operating_license');
  const rup = classes.find(c => c.entry_id === 'rup');
  const deactivated = classes.find(c => c.entry_id === 'communications_license');
  const missingRut = classes.find(c => c.entry_id === 'rut');

  // --- Closed shape: exactly the required separate dimensions, nothing else. ---
  const expectedKeys = [
    'entry_id', 'evidence_type', 'presence_status', 'review_status', 'validity_status',
    'applicability_status', 'compliance_status', 'source', 'last_reconciled_at',
  ].sort();
  assert.deepEqual(Object.keys(license).sort(), expectedKeys, 'a typed class must expose exactly the required independent dimensions, no more');

  // --- Presence must never imply validity/applicability/compliance. ---
  assert.equal(license.presence_status, 'reported');
  assert.equal(license.validity_status, 'unknown', 'no expiry recorded: validity must be unknown, never inferred as current from mere presence');
  assert.equal(license.applicability_status, 'pending_case_validation', 'applicability must come from its own column, never promoted by presence');
  assert.equal(license.compliance_status, 'pending_review', 'compliance/sufficiency must never be auto-promoted, regardless of presence');

  // A verified+approved+applicable entry (rup) still never auto-promotes compliance.
  assert.equal(rup.presence_status, 'reported');
  assert.equal(rup.review_status, 'approved');
  assert.equal(rup.applicability_status, 'applicable');
  assert.equal(rup.compliance_status, 'pending_review', 'compliance status has no write path yet: it must stay pending_review even when every other dimension is favorable');
  assert.equal(rup.validity_status, 'expired', 'an expiry in the past relative to asOf must be reported as expired');
  assert.equal(rup.last_reconciled_at, '2026-07-15T00:00:00.000Z', 'last_reconciled_at must be the real recorded updated_at, never an invented date');
  assert.equal(missingRut.presence_status, 'not_verified', 'a missing registry row must remain an explicit catalog class, never disappear');
  assert.equal(missingRut.validity_status, 'unknown');
  assert.equal(missingRut.applicability_status, 'pending_case_validation');
  assert.equal(missingRut.compliance_status, 'pending_review');
  assert.equal(missingRut.last_reconciled_at, null, 'a missing class must not invent a reconciliation timestamp');

  // --- Source/reference metadata only: no raw content, storage_path or signed URL. ---
  assert.deepEqual(Object.keys(license.source).sort(), ['human_gate', 'label', 'observed_at', 'reference', 'type']);
  assert.equal(license.source.reference, 'psi_agt002_company_evidence_registry:supervigilancia_operating_license');
  assert.equal(license.source.type, 'database');

  // --- No sensitive/raw fields leak anywhere in the output, even though the input rows carried them. ---
  const serialized = JSON.stringify({ classes, coverage });
  for (const forbidden of ['notes', 'decision_humana', 'storage_path', 'signed_url', 'account_number', 'secret', 'cédula', 'Excluir nombres']) {
    assert.ok(!serialized.includes(forbidden), `typed evidence classes must never leak "${forbidden}"`);
  }

  // --- Coverage manifest: closed categories, arrays of entry_id, never a promotion path. ---
  assert.deepEqual(Object.keys(coverage).sort(), [...AGT002_COMPANY_EVIDENCE_COVERAGE_CATEGORIES].sort());
  assert.ok(coverage.available.includes('supervigilancia_operating_license'));
  assert.ok(coverage.available.includes('rup'));
  assert.ok(!coverage.available.includes('communications_license'), 'a deactivated entry must not be reported as available');
  assert.ok(coverage.omitted.includes('communications_license'), 'a deactivated (integration_active=false) entry must be reported as omitted');
  assert.ok(coverage.expired.includes('rup'));
  assert.ok(!coverage.expired.includes('supervigilancia_operating_license'));
  assert.ok(coverage.inaccessible.includes('rup'), 'an entry with no hash reference must be reported as inaccessible');
  assert.ok(coverage.inaccessible.includes('rut'), 'a missing expected class must be explicitly reported as inaccessible');
  assert.ok(!coverage.inaccessible.includes('supervigilancia_operating_license'));
  assert.ok(coverage.selected.includes('rup'), 'applicability_status=applicable must be reflected in selected');
  assert.ok(!coverage.selected.includes('supervigilancia_operating_license'));
  assert.ok(coverage.pending_review.includes('supervigilancia_operating_license'));
  assert.ok(!coverage.pending_review.includes('rup'), 'an approved entry must not appear in pending_review');
  for (const key of Object.keys(coverage)) {
    const ids = coverage[key];
    assert.deepEqual(ids, [...ids].sort(), `${key} must be deterministically sorted`);
    assert.equal(new Set(ids).size, ids.length, `${key} must not contain duplicates`);
  }

  // --- Fail-closed on malformed input. ---
  assert.throws(() => buildAgt002CompanyEvidenceClasses({ registryEntries: [entry({ entry_id: '' })], asOf: ASOF }), /entry_id/);
  assert.throws(() => buildAgt002CompanyEvidenceClasses({ registryEntries: [entry({ existence_status: 'bogus' })], asOf: ASOF }), /presence|existence/i);
  assert.throws(() => buildAgt002CompanyEvidenceClasses({ registryEntries: [entry({ entry_id: 'unknown_class' })], asOf: ASOF }), /catálogo|class|entry_id/i);

  // --- Loader wires the real select/filter through a database-shaped client, and
  // still surfaces integration_active=false entries (needed for coverage.omitted). ---
  function fakeDatabase(rows) {
    return {
      from(table) {
        assert.equal(table, 'psi_agt002_company_evidence_registry');
        const filters = [];
        const chain = {
          select(columns) {
            assert.equal(columns, AGT002_COMPANY_EVIDENCE_CLASS_SELECT);
            return chain;
          },
          eq(key, value) { filters.push([key, value]); return chain; },
          order() { return chain; },
          then(resolve) {
            const data = rows.filter(row => filters.every(([key, value]) => row[key] === value));
            resolve({ data, error: null });
          },
        };
        return chain;
      },
    };
  }
  const loaded = await loadAgt002CompanyEvidenceClasses(fakeDatabase([licenseEntry, deactivatedEntry]), { asOf: ASOF });
  assert.equal(loaded.classes.length, 17, 'loader output must retain the complete closed catalog even when rows are missing');
  assert.ok(loaded.coverage.omitted.includes('communications_license'), 'the loader must query current=true only, not integration_active=true, so omitted entries stay visible in coverage');

  // --- Raw-row loader (companyEvidenceClassesProvider's real DB source): unlike
  // loadAgt002CompanyEvidenceClasses, this must return the raw registry rows
  // themselves — not the built {classes, coverage} shape — because the v3 engine's
  // companyEvidenceClassesProvider(context) contract expects to hand its result
  // straight to buildAgt002CompanyEvidenceClasses({ registryEntries }) itself. ---
  assert.equal(typeof loadAgt002CompanyEvidenceRegistryEntries, 'function', 'a raw-row loader must exist as the real DB source for companyEvidenceClassesProvider');

  const rawRows = await loadAgt002CompanyEvidenceRegistryEntries(fakeDatabase([licenseEntry, deactivatedEntry]));
  assert.ok(Array.isArray(rawRows), 'the raw loader must return an array of rows, not a built classes/coverage object');
  assert.deepEqual(rawRows.map(row => row.entry_id).sort(), ['communications_license', 'supervigilancia_operating_license']);
  assert.equal(rawRows.find(row => row.entry_id === 'supervigilancia_operating_license').source_reference, licenseEntry.source_reference, 'the raw loader must not strip or transform any real column');

  // Table-absent (a database that has not run migration 061 yet) must fail soft to
  // an empty array — never throw — mirroring loadAgt002CompanyEvidenceClasses's own
  // handling of the same optional table.
  function tableAbsentDatabase(code) {
    return {
      from(table) {
        assert.equal(table, 'psi_agt002_company_evidence_registry');
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          order() { return chain; },
          then(resolve) { resolve({ data: null, error: { code } }); },
        };
        return chain;
      },
    };
  }
  assert.deepEqual(await loadAgt002CompanyEvidenceRegistryEntries(tableAbsentDatabase('PGRST205')), []);
  assert.deepEqual(await loadAgt002CompanyEvidenceRegistryEntries(tableAbsentDatabase('42P01')), []);

  // Any other database error (permissions, connectivity) must propagate — never be
  // silently swallowed as "no evidence".
  await assert.rejects(
    loadAgt002CompanyEvidenceRegistryEntries(tableAbsentDatabase('53300')),
    error => error.code === '53300',
    'a non-table-absent error must propagate, never be treated as an empty registry',
  );

  // ---------------------------------------------------------------------------
  // P2-2: minimum-exposure defense for psi_agt002_company_evidence_registry. The real
  // select must be exactly the closed allowlist (no more, no less), and the guard itself
  // must reject select(*) and any column outside the allowlist — verifiable independent
  // of the actual real select string ever drifting.
  // ---------------------------------------------------------------------------
  assert.ok(Array.isArray(AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS) && AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS.length > 0);
  assert.deepEqual(
    [...AGT002_COMPANY_EVIDENCE_CLASS_SELECT.split(',')].sort(),
    [...AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS].sort(),
    'the real select must be exactly the allowlist, no more, no less',
  );
  assert.equal(
    assertAgt002CompanyEvidenceRegistryMinimalExposureSelect(AGT002_COMPANY_EVIDENCE_CLASS_SELECT, AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS),
    AGT002_COMPANY_EVIDENCE_CLASS_SELECT,
  );
  assert.throws(
    () => assertAgt002CompanyEvidenceRegistryMinimalExposureSelect('*', AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS),
    /select\(\*\)/i,
    'select(*) must be prohibited outright',
  );
  assert.throws(
    () => assertAgt002CompanyEvidenceRegistryMinimalExposureSelect('entry_id,*', AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS),
    /select\(\*\)/i,
    'a partial wildcard mixed with real columns must also be prohibited',
  );
  for (const sensitiveColumn of ['notes', 'decision_humana', 'classification', 'sensibilidad', 'control_de_uso', 'zona_almacenamiento']) {
    assert.throws(
      () => assertAgt002CompanyEvidenceRegistryMinimalExposureSelect(`entry_id,${sensitiveColumn}`, AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS),
      /allowlist|fuera/i,
      `${sensitiveColumn} must be rejected as outside the minimum-exposure allowlist`,
    );
  }
  assert.throws(
    () => assertAgt002CompanyEvidenceRegistryMinimalExposureSelect('entry_id,entry_id', AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS),
    /repetir/i,
    'a repeated column must be rejected',
  );
  assert.throws(
    () => assertAgt002CompanyEvidenceRegistryMinimalExposureSelect('', AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS),
    /lista de columnas/i,
  );
  assert.throws(
    () => assertAgt002CompanyEvidenceRegistryMinimalExposureSelect(null, AGT002_COMPANY_EVIDENCE_CLASS_ALLOWED_COLUMNS),
    /lista de columnas/i,
  );

  // Source-level regression: even if the guard were ever bypassed, the module's own source
  // must never literally call .select with a wildcard against this table.
  const evidenceClassesSource = readFileSync(new URL('../agt002-company-evidence-classes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(
    evidenceClassesSource,
    /\.select\(\s*['"`]\*/,
    'the module source must never call .select("*") against psi_agt002_company_evidence_registry',
  );

  console.log('AGT-002 typed company evidence classes (F2) contract passed');
}
