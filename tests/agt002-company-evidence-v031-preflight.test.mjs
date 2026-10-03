// F2 preflight slice. Synthetic contract-only fixtures: the canonical artifact fields and the
// 22 target entry ids come from the canonical validator module's own exported constants (the
// same values the preflight module cross-binds against), not typed out independently or
// copied from any real approved artifact. Every other value (labels, notes, opaque refs) is
// synthetic placeholder text. No DB/fs/network access, no production data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256,
  AGT002_CANONICAL_V031_EXPECTED_VERSION,
  AGT002_CANONICAL_V031_EXPECTED_STATUS,
  AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY,
  AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC,
  AGT002_CANONICAL_V031_EXPECTED_MATCHING_RULE,
  AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS,
  AGT002_CANONICAL_V031_EXPECTED_APPROVAL_SCOPE,
  AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS,
  AGT002_CANONICAL_V031_ENTRY_IDS,
  AGT002_CANONICAL_V031_VAULT_ENTRY_IDS,
  AGT002_CANONICAL_V031_EXPECTED_SUPERSEDES,
  AGT002_CANONICAL_V031_SUPERSEDED_VERSIONS,
  AGT002_CANONICAL_V031_EXPECTED_APPROVAL_EVIDENCE,
  AGT002_CANONICAL_V031_EXPECTED_RESIDUAL_NON_CLASS_ITEMS,
  computeCanonicalPayloadSha256Hex,
  computeCanonicalPayloadByteLength,
} from '../agt002-company-evidence-canonical-v031-validator.js';
import {
  AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS,
  computeAgt002Reclass17To22Hash,
} from '../agt002-company-evidence-reclass-17-to-22.js';
import {
  AGT002_PREFLIGHT_EXPECTED_APPROVAL_SOURCE,
  AGT002_PREFLIGHT_REQUIRED_ARCHIVE_ONLY_SOURCE_IDS,
  validateAgt002CompanyEvidenceV031PreflightInputs,
  buildAgt002CompanyEvidenceV031PreflightReport,
} from '../agt002-company-evidence-v031-preflight.js';

function opaqueRef(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

const SYNTHETIC_HASH = '1234567890abcdef'.repeat(4);

// --- Canonical envelope fixture (mirrors agt002-company-evidence-canonical-v031-validator.test.mjs). ---

function buildSyntheticCanonicalEntry(entryId) {
  const isVault = AGT002_CANONICAL_V031_VAULT_ENTRY_IDS.includes(entryId);
  return {
    entry_id: entryId,
    document_class: `synthetic-document-class-${entryId}`,
    change_action: 'synthetic-normalized',
    proposed_state: 'synthetic-proposed-state',
    evidence_state: 'synthetic-evidence-state',
    validity: 'synthetic-validity-window',
    sensitivity: 'synthetic-sensitivity-tag',
    source_segments_or_count: 'synthetic-source-ref-1',
    applicability: 'synthetic-applicability-scope',
    match_policy: 'synthetic-match-policy',
    human_gate: 'synthetic-human-gate-required',
    notes: 'synthetic governance note',
    evidence_sha256: isVault ? '' : SYNTHETIC_HASH,
  };
}

function buildSyntheticTransformations() {
  return Object.entries(AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS).map(([original, resolution]) => ({
    original,
    resolution,
    technical_hold_resolved: true,
  }));
}

function buildValidCanonicalArtifact() {
  return {
    version: AGT002_CANONICAL_V031_EXPECTED_VERSION,
    status: AGT002_CANONICAL_V031_EXPECTED_STATUS,
    approved_by: AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY,
    approved_at_utc: AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC,
    matching_rule: AGT002_CANONICAL_V031_EXPECTED_MATCHING_RULE,
    ...AGT002_CANONICAL_V031_EXPECTED_TOP_LEVEL_COUNTS,
    approval_scope: { ...AGT002_CANONICAL_V031_EXPECTED_APPROVAL_SCOPE },
    transformations: buildSyntheticTransformations(),
    entries: AGT002_CANONICAL_V031_ENTRY_IDS.map(buildSyntheticCanonicalEntry),
    supersedes: AGT002_CANONICAL_V031_EXPECTED_SUPERSEDES,
    superseded_versions: [...AGT002_CANONICAL_V031_SUPERSEDED_VERSIONS],
    approval_evidence: AGT002_CANONICAL_V031_EXPECTED_APPROVAL_EVIDENCE,
    residual_non_class_items: { ...AGT002_CANONICAL_V031_EXPECTED_RESIDUAL_NON_CLASS_ITEMS },
  };
}

function buildValidCanonicalEnvelope() {
  const artifact = buildValidCanonicalArtifact();
  return {
    artifact,
    observedFileSha256: AGT002_CANONICAL_V031_EXPECTED_FILE_SHA256,
    canonicalPayloadSha256: computeCanonicalPayloadSha256Hex(artifact),
    canonicalPayloadBytes: computeCanonicalPayloadByteLength(artifact),
  };
}

// --- reclassInputs fixture: exact 22 canonical target ids, split/archive-only declarations
// bound to the canonical transformations, governance bound to the canonical governance
// record. communications_license splits into 5 (matching its approved "split_into_5_classes"
// resolution), corporate_background_checks splits into 3 (matching "split_3_authority_classes"),
// financial_and_tax_pack splits across the corporate-process target (corporate_tax_return) and
// the personal-vault target (legal_representative_vault, matching "excluded ... personal
// vault"), and overtime_authorization is archive-only (matching "deprecated ... archived as
// process-specific"). Every other one of the 17 sources maps one-to-one to its same-named
// canonical target. ---

const COMMS_SPLIT_TARGETS = Object.freeze([
  'radio_spectrum_permit', 'radio_network_technical_profile', 'rutic_registration',
  'telecom_service_contract', 'telecom_commercial_reference',
]);
const CORP_BG_SPLIT_TARGETS = Object.freeze([
  'corporate_disciplinary_certificate', 'corporate_fiscal_certificate', 'corporate_corrective_measures_rnmc_certificate',
]);
const PLAIN_ONE_TO_ONE_SOURCES = Object.freeze([
  'supervigilancia_operating_license', 'rup', 'rut', 'uniforms_resolution',
  'no_fines_sanctions_certificate', 'authorized_weapons_list', 'rce_policy',
  'collective_life_policy', 'accredited_experience', 'bank_certificate',
  'personnel_credentials_vault', 'differential_scoring_support',
]);
const REQUIRED_SPLIT_SOURCE_IDS = Object.freeze(['communications_license', 'financial_and_tax_pack', 'corporate_background_checks']);

function buildPreflightMappingRules() {
  const rules = PLAIN_ONE_TO_ONE_SOURCES.map((id) => ({ targetClassId: id, sourceClassIds: [id], kind: 'one_to_one' }));
  rules.push({ targetClassId: 'legal_representative_vault', sourceClassIds: ['legal_representative_vault', 'financial_and_tax_pack'], kind: 'merge' });
  rules.push({ targetClassId: 'corporate_tax_return', sourceClassIds: ['financial_and_tax_pack'], kind: 'one_to_one' });
  for (const targetId of COMMS_SPLIT_TARGETS) rules.push({ targetClassId: targetId, sourceClassIds: ['communications_license'], kind: 'one_to_one' });
  for (const targetId of CORP_BG_SPLIT_TARGETS) rules.push({ targetClassId: targetId, sourceClassIds: ['corporate_background_checks'], kind: 'one_to_one' });
  return rules;
}

function buildPreflightTargetManifest(mappingRules) {
  return {
    version: AGT002_CANONICAL_V031_EXPECTED_VERSION,
    classes: mappingRules.map((rule) => ({
      id: rule.targetClassId,
      label: `Synthetic label for ${rule.targetClassId}`,
      sensitivity: 'internal',
    })),
  };
}

function buildPreflightArchivedEntries() {
  return AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS.map((entryId) => ({
    entryId, version: 1, archived: true, archivedAt: '2026-08-29T00:00:00.000Z',
  }));
}

function buildPreflightApprovalRecord(targetManifest, mappingRules) {
  return {
    approver: AGT002_CANONICAL_V031_EXPECTED_APPROVED_BY,
    date: AGT002_CANONICAL_V031_EXPECTED_APPROVED_AT_UTC.slice(0, 10),
    status: AGT002_CANONICAL_V031_EXPECTED_STATUS,
    source: AGT002_PREFLIGHT_EXPECTED_APPROVAL_SOURCE,
    version: targetManifest.version,
    hash: computeAgt002Reclass17To22Hash({ targetManifest, mappingRules }),
    scope: [targetManifest.version, 'agt002-preflight-v031-fixture'],
    exclusions: [],
  };
}

function buildPreflightGovernanceAcknowledgements() {
  return {
    sensitivityFieldSourceDeclaration: 'synthetic fixture literal value; not read from psi_agt002_company_evidence_registry.',
    sharePointOpaqueRefsOnlyConfirmed: true,
  };
}

function buildPreflightTargetEntries(mappingRules) {
  const sourcesByTarget = new Map(mappingRules.map((rule) => [rule.targetClassId, rule.sourceClassIds]));
  return mappingRules.map((rule) => {
    const sources = sourcesByTarget.get(rule.targetClassId);
    const previousVersionPointer = sources.length > 1
      ? sources.map((sourceId) => ({ entryId: sourceId }))
      : { entryId: sources[0] };
    return {
      entryId: rule.targetClassId,
      classDefinitionVersion: 'v1-synthetic',
      sensitivity: 'internal',
      evidenceRef: opaqueRef(`${rule.targetClassId}:evidence`),
      sharePointSyncRef: opaqueRef(`${rule.targetClassId}:sharepoint`),
      previousVersionPointer,
      catalogueApproved: true,
      evidenceCurrent: true,
      requirementMatched: true,
      humanValidated: true,
      submissionAuthorized: true,
    };
  });
}

function buildValidReclassInputs() {
  const mappingRules = buildPreflightMappingRules();
  const targetManifest = buildPreflightTargetManifest(mappingRules);
  return {
    targetManifest,
    mappingRules,
    declaredSplitSourceIds: [...REQUIRED_SPLIT_SOURCE_IDS],
    declaredArchiveOnlySourceIds: [...AGT002_PREFLIGHT_REQUIRED_ARCHIVE_ONLY_SOURCE_IDS],
    archiveOnlyProvenance: { overtime_authorization: AGT002_CANONICAL_V031_EXPECTED_TRANSFORMATIONS.overtime_authorization },
    archivedEntries: buildPreflightArchivedEntries(),
    approvalRecord: buildPreflightApprovalRecord(targetManifest, mappingRules),
    governanceAcknowledgements: buildPreflightGovernanceAcknowledgements(),
    targetEntries: buildPreflightTargetEntries(mappingRules),
  };
}

function buildValidPreflightInput() {
  return {
    canonicalEnvelope: buildValidCanonicalEnvelope(),
    reclassInputs: buildValidReclassInputs(),
  };
}

// ---------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------

test('sanity: the positive fixture targets exactly the 22 canonical entry ids', () => {
  const reclassInputs = buildValidReclassInputs();
  const ids = reclassInputs.targetManifest.classes.map((c) => c.id).sort();
  assert.deepEqual(ids, [...AGT002_CANONICAL_V031_ENTRY_IDS].sort());
});

// ---------------------------------------------------------------------------
// Positive path
// ---------------------------------------------------------------------------

test('a fully synthetic, well-bound preflight input is preflight_ready:true with zero blockers', () => {
  const report = buildAgt002CompanyEvidenceV031PreflightReport(buildValidPreflightInput());
  assert.equal(report.preflight_ready, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.canonical_valid, true);
  assert.equal(report.reclass_ready, true);
});

test('validateAgt002CompanyEvidenceV031PreflightInputs returns zero blockers for the same valid input', () => {
  assert.deepEqual(validateAgt002CompanyEvidenceV031PreflightInputs(buildValidPreflightInput()), []);
});

// ---------------------------------------------------------------------------
// Canonical file sha256 drift
// ---------------------------------------------------------------------------

test('canonical file sha256 drift fails closed and never runs reclass', () => {
  const input = buildValidPreflightInput();
  input.canonicalEnvelope.observedFileSha256 = 'f'.repeat(64);
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.equal(report.canonical_valid, false);
  assert.equal(report.reclass_ready, false);
  assert.deepEqual(report.reclass_blockers, []);
  assert.ok(report.blockers.some((b) => b.includes('observedFileSha256')));
});

// ---------------------------------------------------------------------------
// Canonical payload sha256 / byte drift
// ---------------------------------------------------------------------------

test('canonical payload sha256 drift fails closed', () => {
  const input = buildValidPreflightInput();
  input.canonicalEnvelope.canonicalPayloadSha256 = 'a'.repeat(64);
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.equal(report.canonical_valid, false);
  assert.equal(report.reclass_ready, false);
});

test('canonical payload byte length drift fails closed', () => {
  const input = buildValidPreflightInput();
  input.canonicalEnvelope.canonicalPayloadBytes += 1;
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.equal(report.canonical_valid, false);
  assert.equal(report.reclass_ready, false);
});

test('missing canonicalPayloadSha256/canonicalPayloadBytes fails closed even though the canonical shape itself is valid', () => {
  const input = buildValidPreflightInput();
  delete input.canonicalEnvelope.canonicalPayloadSha256;
  delete input.canonicalEnvelope.canonicalPayloadBytes;
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.canonical_valid, true, 'canonical shape itself remains valid without the optional payload binding');
  assert.equal(report.preflight_ready, false);
  assert.equal(report.reclass_ready, false, 'reclass must never run without a bound canonical payload');
  assert.ok(report.blockers.some((b) => b.includes('canonicalPayloadSha256')));
});

// ---------------------------------------------------------------------------
// Target manifest cross-binding: extra / missing / version drift
// ---------------------------------------------------------------------------

test('target manifest missing a canonical entry id fails closed', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.targetManifest.classes = input.reclassInputs.targetManifest.classes.filter((c) => c.id !== 'rup');
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('rup') && b.includes('AGT002_CANONICAL_V031_ENTRY_IDS')));
});

test('target manifest with an extra, non-canonical class id fails closed', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.targetManifest.classes.push({ id: 'unapproved_extra_class', label: 'x', sensitivity: 'internal' });
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('unapproved_extra_class')));
});

test('target manifest version drift from the canonical approved version fails closed', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.targetManifest.version = 'v0.3.1-drifted';
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('targetManifest.version')));
});

// ---------------------------------------------------------------------------
// Approval/governance cross-binding
// ---------------------------------------------------------------------------

test('approvalRecord.status not matching the canonical governance status fails closed even though it is a recognized approved status', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.approvalRecord.status = 'APPROVED_UNCONDITIONAL';
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('approvalRecord.status')));
});

test('approvalRecord.approver not matching canonical approved_by fails closed', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.approvalRecord.approver = 'Someone Else';
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('approvalRecord.approver')));
});

test('approvalRecord.date not matching the canonical approval date fails closed', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.approvalRecord.date = '2026-01-01';
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('approvalRecord.date')));
});

test('approvalRecord.source not the fixed canonical governance literal fails closed: arbitrary synthetic governance is never accepted as approved', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.approvalRecord.source = 'some-other-synthetic-source';
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('approvalRecord.source')));
});

test('approvalRecord.version not matching the canonical approved version fails closed', () => {
  const input = buildValidPreflightInput();
  // Change both targetManifest.version and approvalRecord.version together so the reclass
  // module's own version/hash binding stays internally consistent, isolating this assertion
  // to the preflight-level cross-bind against the canonical version specifically.
  const driftedVersion = 'v0.3.1-not-canonical';
  input.reclassInputs.targetManifest.version = driftedVersion;
  input.reclassInputs.approvalRecord.version = driftedVersion;
  input.reclassInputs.approvalRecord.scope = [driftedVersion, 'agt002-preflight-v031-fixture'];
  input.reclassInputs.approvalRecord.hash = computeAgt002Reclass17To22Hash({
    targetManifest: input.reclassInputs.targetManifest,
    mappingRules: input.reclassInputs.mappingRules,
  });
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('approvalRecord.version')));
  assert.ok(report.blockers.some((b) => b.includes('targetManifest.version')));
});

test('approvalRecord.scope missing the canonical version fails closed', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.approvalRecord.scope = input.reclassInputs.approvalRecord.scope.filter(
    (s) => s !== AGT002_CANONICAL_V031_EXPECTED_VERSION,
  );
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('approvalRecord.scope')));
});

// ---------------------------------------------------------------------------
// Propagated reclass blocker
// ---------------------------------------------------------------------------

test('a blocker from the underlying reclass dry-run report propagates into preflight blockers', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.archivedEntries.shift();
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.equal(report.reclass_ready, false);
  assert.ok(report.reclass_blockers.some((b) => b.includes('falta el archivo')));
  assert.ok(report.blockers.some((b) => b.includes('reclassInputs:') && b.includes('falta el archivo')));
});

// ---------------------------------------------------------------------------
// Archive-only conflict
// ---------------------------------------------------------------------------

test('declaredArchiveOnlySourceIds other than exactly [overtime_authorization] fails closed', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.declaredArchiveOnlySourceIds = [];
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('declaredArchiveOnlySourceIds')));
});

test('archiveOnlyProvenance.overtime_authorization not the exact canonical approved resolution text fails closed', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.archiveOnlyProvenance.overtime_authorization = 'a different, invented justification';
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('archiveOnlyProvenance.overtime_authorization')));
});

// ---------------------------------------------------------------------------
// Split coverage
// ---------------------------------------------------------------------------

test('declaredSplitSourceIds missing a canonical split-transformation source fails closed', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.declaredSplitSourceIds = input.reclassInputs.declaredSplitSourceIds.filter(
    (id) => id !== 'communications_license',
  );
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
  assert.ok(report.blockers.some((b) => b.includes('communications_license') && b.includes('declaredSplitSourceIds')));
});

// ---------------------------------------------------------------------------
// Determinism / deep freeze
// ---------------------------------------------------------------------------

test('the report is deterministic across repeated calls on the same valid input', () => {
  const input = buildValidPreflightInput();
  const first = buildAgt002CompanyEvidenceV031PreflightReport(structuredClone(input));
  const second = buildAgt002CompanyEvidenceV031PreflightReport(structuredClone(input));
  assert.deepEqual(first, second);
});

test('the report is deterministic across repeated calls on the same invalid input', () => {
  const input = buildValidPreflightInput();
  input.canonicalEnvelope.observedFileSha256 = 'bad';
  const first = buildAgt002CompanyEvidenceV031PreflightReport(structuredClone(input));
  const second = buildAgt002CompanyEvidenceV031PreflightReport(structuredClone(input));
  assert.deepEqual(first, second);
});

test('the report is deeply frozen', () => {
  const report = buildAgt002CompanyEvidenceV031PreflightReport(buildValidPreflightInput());
  assert.throws(() => { report.preflight_ready = false; }, TypeError);
  assert.throws(() => { report.blockers.push('x'); }, TypeError);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.blockers));
  assert.ok(Object.isFrozen(report.canonical_blockers));
  assert.ok(Object.isFrozen(report.reclass_blockers));
});

// ---------------------------------------------------------------------------
// Malformed / Proxy / accessor input never throws
// ---------------------------------------------------------------------------

for (const malformed of [null, undefined, 'a string', 42, true, [], () => {}]) {
  test(`buildAgt002CompanyEvidenceV031PreflightReport never throws on malformed input: ${String(malformed)}`, () => {
    assert.doesNotThrow(() => buildAgt002CompanyEvidenceV031PreflightReport(malformed));
    const report = buildAgt002CompanyEvidenceV031PreflightReport(malformed);
    assert.equal(report.preflight_ready, false);
  });

  test(`validateAgt002CompanyEvidenceV031PreflightInputs never throws on malformed input: ${String(malformed)}`, () => {
    assert.doesNotThrow(() => validateAgt002CompanyEvidenceV031PreflightInputs(malformed));
    const blockers = validateAgt002CompanyEvidenceV031PreflightInputs(malformed);
    assert.ok(blockers.length > 0);
  });
}

test('a throwing Proxy get trap on canonicalEnvelope never throws and fails closed', () => {
  const throwingProxy = new Proxy({}, { get() { throw new Error('boom'); } });
  const input = { canonicalEnvelope: throwingProxy, reclassInputs: {} };
  assert.doesNotThrow(() => buildAgt002CompanyEvidenceV031PreflightReport(input));
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
});

test('a throwing accessor property for reclassInputs never throws and fails closed', () => {
  const input = { canonicalEnvelope: buildValidCanonicalEnvelope() };
  Object.defineProperty(input, 'reclassInputs', { get() { throw new Error('boom'); }, enumerable: true, configurable: true });
  assert.doesNotThrow(() => buildAgt002CompanyEvidenceV031PreflightReport(input));
  const report = buildAgt002CompanyEvidenceV031PreflightReport(input);
  assert.equal(report.preflight_ready, false);
});

test('a throwing top-level Proxy input never throws and fails closed', () => {
  const throwingProxy = new Proxy({}, { get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => buildAgt002CompanyEvidenceV031PreflightReport(throwingProxy));
  const report = buildAgt002CompanyEvidenceV031PreflightReport(throwingProxy);
  assert.equal(report.preflight_ready, false);
});

test('a circular reclassInputs never causes a stack overflow / throw', () => {
  const input = buildValidPreflightInput();
  input.reclassInputs.selfRef = input.reclassInputs;
  assert.doesNotThrow(() => buildAgt002CompanyEvidenceV031PreflightReport(input));
});

// ---------------------------------------------------------------------------
// Authority flags always false; ready-only output omitted when invalid
// ---------------------------------------------------------------------------

test('authority flags are always false regardless of preflight_ready', () => {
  const validReport = buildAgt002CompanyEvidenceV031PreflightReport(buildValidPreflightInput());
  assert.equal(validReport.preflight_ready, true);
  assert.equal(validReport.reconciliation_claim, false);
  assert.equal(validReport.authorizes_migration, false);
  assert.equal(validReport.authorizes_runtime_activation, false);
  assert.equal(validReport.authorizes_go, false);
  assert.equal(validReport.authorizes_submission, false);

  const invalidInput = buildValidPreflightInput();
  invalidInput.canonicalEnvelope.observedFileSha256 = 'bad';
  const invalidReport = buildAgt002CompanyEvidenceV031PreflightReport(invalidInput);
  assert.equal(invalidReport.preflight_ready, false);
  assert.equal(invalidReport.reconciliation_claim, false);
  assert.equal(invalidReport.authorizes_migration, false);
  assert.equal(invalidReport.authorizes_runtime_activation, false);
  assert.equal(invalidReport.authorizes_go, false);
  assert.equal(invalidReport.authorizes_submission, false);
});

test('ready-only output fields (hash, target class ids, canonical payload) are omitted when preflight_ready is false', () => {
  const invalidInput = buildValidPreflightInput();
  invalidInput.canonicalEnvelope.observedFileSha256 = 'bad';
  const report = buildAgt002CompanyEvidenceV031PreflightReport(invalidInput);
  assert.equal(report.preflight_ready, false);
  assert.equal(Object.hasOwn(report, 'reclass_hash'), false);
  assert.equal(Object.hasOwn(report, 'target_class_ids'), false);
  assert.equal(Object.hasOwn(report, 'canonical_payload_sha256'), false);
  assert.equal(Object.hasOwn(report, 'canonical_payload_bytes'), false);
  assert.equal(Object.hasOwn(report, 'merges'), false);
  assert.equal(Object.hasOwn(report, 'splits'), false);
});

test('ready output fields are present when preflight_ready is true', () => {
  const report = buildAgt002CompanyEvidenceV031PreflightReport(buildValidPreflightInput());
  assert.equal(report.preflight_ready, true);
  assert.match(report.reclass_hash, /^[0-9a-f]{64}$/);
  assert.equal(report.target_class_ids.length, 22);
  assert.deepEqual(report.archive_only, ['overtime_authorization']);
  assert.deepEqual([...report.splits].sort(), [...REQUIRED_SPLIT_SOURCE_IDS].sort());
});

console.log('agt002-company-evidence-v031-preflight: OK');
