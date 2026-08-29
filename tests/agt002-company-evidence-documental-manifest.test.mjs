import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION,
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_ARTIFACT_TYPE,
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_CONTRACT_VERSION,
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_HASH_ALGORITHM,
  computeAgt002CompanyEvidenceGroupHash,
  buildAgt002CompanyEvidenceDocumentalManifestProjection,
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION,
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_CLASS_IDS,
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_GROUPS,
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_TO_TECHNICAL_MAP,
  computeAgt002CompanyEvidenceDocumentalManifestIdentityHash,
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_IDENTITY_HASH,
  AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST,
} from '../agt002-company-evidence-documental-manifest.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';

// ---------------------------------------------------------------------------
// This suite exercises the real v0.3.1-approved-20260829 catalog exposed by the
// module (22 documental classes projected onto the 17-class closed technical
// catalog) purely by reading its own exported data — no hardcoded restatement of
// the 22/13/5/1/3 split beyond what the module itself already documents in its
// header. The four groups whose review actually changed (communications_license,
// financial_and_tax_pack, overtime_authorization, corporate_background_checks) are
// checked against the exact literal values from migration 075 and its rollback.
// ---------------------------------------------------------------------------

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CHANGED_TECHNICAL_IDS = ['communications_license', 'financial_and_tax_pack', 'overtime_authorization', 'corporate_background_checks'];

function documentalHashById(documentalId) {
  const entry = AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST.documental_classes.find((doc) => doc.documental_class_id === documentalId);
  assert.ok(entry, `clase documental esperada en el catálogo: ${documentalId}`);
  return entry.hash;
}

function sha256Join(hashes) {
  return createHash('sha256').update(hashes.join('|'), 'utf8').digest('hex');
}

function testVersionArtifactContract() {
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION, 'v0.3.1-approved-20260829');
  assert.match(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION, /^v\d+\.\d+\.\d+-approved-\d{8}$/);
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_ARTIFACT_TYPE, 'agt002_company_evidence_documental_manifest');
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_CONTRACT_VERSION, 'agt002-company-evidence-documental-manifest@1');
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_HASH_ALGORITHM, 'sha256');
  assert.match(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_IDENTITY_HASH, HASH_PATTERN);
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST.manifest_version, AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_VERSION);
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST.artifact_type, AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_ARTIFACT_TYPE);
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST.contract_version, AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_CONTRACT_VERSION);
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST.identity_hash, AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_IDENTITY_HASH);
}

function testCountsCoverageAndMap() {
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_CLASS_IDS.length, 22);
  assert.equal(new Set(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_CLASS_IDS).size, 22);
  assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.technical_class_ids.length, 17);
  assert.deepEqual(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION.technical_class_ids, AGT002_COMPANY_EVIDENCE_CLASS_IDS);
  assert.equal(new Set(AGT002_COMPANY_EVIDENCE_CLASS_IDS).size, 17);

  const groups = Object.values(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_GROUPS);
  assert.equal(groups.length, 17);
  assert.deepEqual(groups.map((g) => g.technical_class_id).sort(), [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort());

  // Every documental id is assigned to exactly one technical group: no duplicates, full coverage.
  const allAssigned = groups.flatMap((g) => g.documental_class_ids);
  assert.equal(allAssigned.length, 22);
  assert.equal(new Set(allAssigned).size, 22);
  assert.deepEqual([...allAssigned].sort(), [...AGT002_COMPANY_EVIDENCE_DOCUMENTAL_CLASS_IDS].sort());

  // The map mirrors the same coverage: 22 keys, each value a real technical id.
  const mapKeys = Object.keys(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_TO_TECHNICAL_MAP);
  assert.equal(mapKeys.length, 22);
  assert.equal(new Set(mapKeys).size, 22);
  for (const documentalId of mapKeys) {
    assert.ok(AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_TO_TECHNICAL_MAP[documentalId]));
  }
}

function testThirteenDirectGroups() {
  const directGroups = Object.values(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_GROUPS)
    .filter((g) => !CHANGED_TECHNICAL_IDS.includes(g.technical_class_id));
  assert.equal(directGroups.length, 13);
  for (const group of directGroups) {
    assert.deepEqual(group.documental_class_ids, [group.technical_class_id]);
    assert.equal(group.complete, true);
    assert.equal(group.existence_status, 'reported');
    assert.equal(group.hash, documentalHashById(group.technical_class_id));
    assert.equal(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_TO_TECHNICAL_MAP[group.technical_class_id], group.technical_class_id);
  }
}

function testCommunicationsLicenseGroup() {
  const group = AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_GROUPS.communications_license;
  assert.ok(group);
  assert.equal(group.documental_class_ids.length, 5);
  assert.equal(group.complete, true);
  assert.equal(group.existence_status, 'reported');
  const composite = sha256Join(group.documental_class_ids.map(documentalHashById));
  assert.equal(group.hash, composite);
  assert.equal(group.hash, '8e1f0b37b48d1de7128e2b7f4b29a29ac308f6baceb5c555b9554ce5d9881ace');
  assert.deepEqual(group.governance_notes.review_focus, ['firmeza', 'titularidad', 'territorio']);
}

function testFinancialAndTaxPackGroup() {
  const group = AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_GROUPS.financial_and_tax_pack;
  assert.ok(group);
  assert.deepEqual(group.documental_class_ids, ['corporate_tax_return']);
  assert.equal(group.complete, false);
  assert.equal(group.existence_status, 'not_verified');
  assert.equal(group.hash, null);
  // The lone source hash is real and non-null; the group hash must still be null,
  // proving fail-closed behaviour is not accidental (there is nothing to hide).
  assert.match(documentalHashById('corporate_tax_return'), HASH_PATTERN);
}

function testOvertimeAuthorizationGroup() {
  const group = AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_GROUPS.overtime_authorization;
  assert.ok(group);
  assert.deepEqual(group.documental_class_ids, []);
  assert.equal(group.complete, false);
  assert.equal(group.existence_status, 'not_verified');
  assert.equal(group.hash, null);
  assert.equal(group.governance_notes.reason, 'sin_autorizacion_mintrabajo_valida');
}

function testCorporateBackgroundChecksGroup() {
  const group = AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_GROUPS.corporate_background_checks;
  assert.ok(group);
  assert.equal(group.documental_class_ids.length, 3);
  assert.equal(group.complete, true);
  assert.equal(group.existence_status, 'reported');
  const composite = sha256Join(group.documental_class_ids.map(documentalHashById));
  assert.equal(group.hash, composite);
  assert.equal(group.hash, '5cf1e715b51d18dc6a4643308447f7c238c0c73471c8eb81598f39da7dcf90bf');
  assert.deepEqual(group.governance_notes.consultation, {
    consulted_at: '2026-06-01',
    validity_days: 89,
    expires_at: '2026-08-29',
  });
}

function testGroupHashOrderSensitivityAndFailClosed() {
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);

  const forward = computeAgt002CompanyEvidenceGroupHash([hashA, hashB], { complete: true });
  const reversed = computeAgt002CompanyEvidenceGroupHash([hashB, hashA], { complete: true });
  assert.match(forward, HASH_PATTERN);
  assert.match(reversed, HASH_PATTERN);
  assert.notEqual(forward, reversed);
  assert.equal(forward, sha256Join([hashA, hashB]));
  assert.equal(reversed, sha256Join([hashB, hashA]));

  // Single-source groups pass their one hash through unchanged, never re-hashed.
  assert.equal(computeAgt002CompanyEvidenceGroupHash([hashA], { complete: true }), hashA);

  // Fail-closed: never a hash unless complete === true, non-empty, and no null member.
  assert.equal(computeAgt002CompanyEvidenceGroupHash([hashA, hashB], { complete: false }), null);
  assert.equal(computeAgt002CompanyEvidenceGroupHash([], { complete: true }), null);
  assert.equal(computeAgt002CompanyEvidenceGroupHash([hashA, null], { complete: true }), null);
  assert.equal(computeAgt002CompanyEvidenceGroupHash([null], { complete: true }), null);
}

function testBuilderRejectsInvalidInput() {
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);
  const baseDocumental = [
    { documentalId: 'doc_a', label: 'Doc A', hash: hashA },
    { documentalId: 'doc_b', label: 'Doc B', hash: hashB },
  ];
  const baseGroups = [
    { technicalClassId: 'tech_x', documentalIds: ['doc_a'], complete: true, existenceStatus: 'reported' },
    { technicalClassId: 'tech_y', documentalIds: ['doc_b'], complete: true, existenceStatus: 'reported' },
  ];
  const baseTechnicalIds = ['tech_x', 'tech_y'];

  // Sanity: the baseline synthetic catalog is itself valid.
  assert.doesNotThrow(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental, groups: baseGroups, technicalClassIds: baseTechnicalIds,
  }));

  // Duplicate documentalId in the documental catalog.
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: [...baseDocumental, { documentalId: 'doc_a', label: 'Dup', hash: null }],
    groups: baseGroups,
    technicalClassIds: baseTechnicalIds,
  }), /duplicada/i);

  // Group references a technicalClassId outside the closed catalog.
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental,
    groups: [{ technicalClassId: 'tech_z', documentalIds: ['doc_a'], complete: true, existenceStatus: 'reported' }, baseGroups[1]],
    technicalClassIds: baseTechnicalIds,
  }), /no pertenece al catálogo técnico cerrado/);

  // Catalog declares a technical id that no group covers.
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental,
    groups: baseGroups,
    technicalClassIds: [...baseTechnicalIds, 'tech_z'],
  }), /falta el grupo técnico/);

  // Group references a documentalId outside the closed documental catalog.
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental,
    groups: [{ technicalClassId: 'tech_x', documentalIds: ['doc_unknown'], complete: true, existenceStatus: 'reported' }, baseGroups[1]],
    technicalClassIds: baseTechnicalIds,
  }), /fuera del catálogo cerrado/);

  // The same documentalId assigned to two different technical groups.
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental,
    groups: [
      { technicalClassId: 'tech_x', documentalIds: ['doc_a'], complete: true, existenceStatus: 'reported' },
      { technicalClassId: 'tech_y', documentalIds: ['doc_a'], complete: true, existenceStatus: 'reported' },
    ],
    technicalClassIds: baseTechnicalIds,
  }), /asignada a más de un grupo técnico/);

  // A documentalId in the catalog is never referenced by any group (incomplete coverage).
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental,
    groups: [{ technicalClassId: 'tech_x', documentalIds: ['doc_a'], complete: true, existenceStatus: 'reported' }],
    technicalClassIds: ['tech_x'],
  }), /cobertura incompleta/);

  // Repeated documentalId inside the same group's own documentalIds array.
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental,
    groups: [{ technicalClassId: 'tech_x', documentalIds: ['doc_a', 'doc_a'], complete: true, existenceStatus: 'reported' }, baseGroups[1]],
    technicalClassIds: baseTechnicalIds,
  }), /repetidas dentro del mismo grupo/);

  // Two groups declare the same technicalClassId.
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental,
    groups: [
      { technicalClassId: 'tech_x', documentalIds: ['doc_a'], complete: true, existenceStatus: 'reported' },
      { technicalClassId: 'tech_x', documentalIds: ['doc_b'], complete: true, existenceStatus: 'reported' },
    ],
    technicalClassIds: ['tech_x'],
  }), /grupo técnico duplicado/);

  // Invalid existenceStatus value.
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental,
    groups: [{ technicalClassId: 'tech_x', documentalIds: ['doc_a'], complete: true, existenceStatus: 'invalid_status' }, baseGroups[1]],
    technicalClassIds: baseTechnicalIds,
  }), /no es un valor permitido/);

  // Non-boolean complete flag.
  assert.throws(() => buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: baseDocumental,
    groups: [{ technicalClassId: 'tech_x', documentalIds: ['doc_a'], complete: 'yes', existenceStatus: 'reported' }, baseGroups[1]],
    technicalClassIds: baseTechnicalIds,
  }), /complete debe ser booleano/);
}

function testIdentityHashDeterministicAndSensitive() {
  // Deterministic and matches the exported constant for the real catalog.
  const recomputed = computeAgt002CompanyEvidenceDocumentalManifestIdentityHash(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION);
  assert.equal(recomputed, AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_IDENTITY_HASH);
  assert.equal(
    computeAgt002CompanyEvidenceDocumentalManifestIdentityHash(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION),
    computeAgt002CompanyEvidenceDocumentalManifestIdentityHash(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST_PROJECTION),
  );

  // Sensitive to content: a synthetic projection that changes one label hashes differently.
  const hashA = 'a'.repeat(64);
  const documentalClasses = [{ documentalId: 'doc_a', label: 'Doc A', hash: hashA }];
  const groups = [{ technicalClassId: 'tech_x', documentalIds: ['doc_a'], complete: true, existenceStatus: 'reported' }];
  const technicalClassIds = ['tech_x'];

  const projectionOne = buildAgt002CompanyEvidenceDocumentalManifestProjection({ documentalClasses, groups, technicalClassIds });
  const projectionTwo = buildAgt002CompanyEvidenceDocumentalManifestProjection({
    documentalClasses: [{ documentalId: 'doc_a', label: 'Doc A (changed)', hash: hashA }],
    groups,
    technicalClassIds,
  });

  const hashOne = computeAgt002CompanyEvidenceDocumentalManifestIdentityHash(projectionOne);
  const hashTwo = computeAgt002CompanyEvidenceDocumentalManifestIdentityHash(projectionTwo);
  assert.match(hashOne, HASH_PATTERN);
  assert.match(hashTwo, HASH_PATTERN);
  assert.notEqual(hashOne, hashTwo);
  assert.equal(hashOne, computeAgt002CompanyEvidenceDocumentalManifestIdentityHash(projectionOne));
}

function testJsonSafeSurface() {
  const serialized = JSON.stringify(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST).toLowerCase();
  const forbiddenPatterns = [
    /sharepoint/, /\/sites\//, /signed[_-]?url/, /https?:\/\//,
    /"secret"/, /"password"/, /"token"/, /"content"/, /"pii"/, /"raw_content"/,
  ];
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(serialized, pattern, `superficie segura no debe contener ${pattern}`);
  }

  // Each documental class exposes only identifier, label and hash — nothing else.
  for (const doc of AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST.documental_classes) {
    assert.deepEqual(Object.keys(doc).sort(), ['documental_class_id', 'hash', 'label']);
  }

  // Each group exposes only the documented governance shape — nothing else.
  for (const group of Object.values(AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST.groups_by_technical_id)) {
    assert.deepEqual(
      Object.keys(group).sort(),
      ['complete', 'documental_class_ids', 'existence_status', 'governance_notes', 'hash', 'technical_class_id'],
    );
  }
}

function run() {
  testVersionArtifactContract();
  testCountsCoverageAndMap();
  testThirteenDirectGroups();
  testCommunicationsLicenseGroup();
  testFinancialAndTaxPackGroup();
  testOvertimeAuthorizationGroup();
  testCorporateBackgroundChecksGroup();
  testGroupHashOrderSensitivityAndFailClosed();
  testBuilderRejectsInvalidInput();
  testIdentityHashDeterministicAndSensitive();
  testJsonSafeSurface();

  console.log('agt002-company-evidence-documental-manifest v0.3.1 coverage passed');
}

run();
