import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS,
  AGT002_RECLASS_17_TO_22_TARGET_CLASS_COUNT,
  AGT002_RECLASS_17_TO_22_MAPPING_KINDS,
  AGT002_RECLASS_17_TO_22_TEMPORAL_APPLICABILITY,
  AGT002_RECLASS_17_TO_22_APPROVAL_STATUSES,
  AGT002_RECLASS_17_TO_22_APPROVED_STATUSES,
  AGT002_RECLASS_17_TO_22_SEMANTIC_STATE_KEYS,
  validateAgt002Reclass17To22RepositoryInputs,
  buildAgt002Reclass17To22DryRunReport,
  computeAgt002Reclass17To22Hash,
} from '../agt002-company-evidence-reclass-17-to-22.js';

// F2 read-only slice. This suite proves the module fails closed on the actual, incomplete
// state of this repository (no 22-class target manifest, no matching approval record exist
// here) AND, separately, that its merge/split/archive/governance logic is correct against a
// clearly-labeled SYNTHETIC fixture built only for this test — never presented as real
// production data.

function opaqueRef(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

// Deep-clones a value with every object's own keys inserted in REVERSED order — used to
// prove the hash is truly key-order-independent, since JSON.parse(JSON.stringify(x))
// alone preserves the original insertion order and would not exercise that at all.
function reorderKeysDeep(value) {
  if (Array.isArray(value)) return value.map(reorderKeysDeep);
  if (value !== null && typeof value === 'object') {
    const reversedKeys = Object.keys(value).reverse();
    const result = {};
    for (const key of reversedKeys) result[key] = reorderKeysDeep(value[key]);
    return result;
  }
  return value;
}

// --- Synthetic 17→22 fixture (test-only; not a claim about any real approval/manifest). ---

const MERGE_TARGET = 'financial_and_labor_pack';
const SPLIT_TARGETS = {
  communications_license: ['communications_spectrum_permit', 'communications_service_contract', 'communications_commercial_reference'],
  corporate_background_checks: ['corporate_disciplinary_check', 'corporate_fiscal_check', 'corporate_corrective_measures_check'],
  differential_scoring_support: ['differential_scoring_criteria_a', 'differential_scoring_criteria_b', 'differential_scoring_criteria_c'],
};
const ONE_TO_ONE_SOURCES = [
  'supervigilancia_operating_license', 'rup', 'rut', 'uniforms_resolution',
  'no_fines_sanctions_certificate', 'authorized_weapons_list', 'rce_policy',
  'collective_life_policy', 'accredited_experience', 'bank_certificate',
  'legal_representative_vault', 'personnel_credentials_vault',
];

function buildMappingRules() {
  const rules = ONE_TO_ONE_SOURCES.map(id => ({ targetClassId: id, sourceClassIds: [id], kind: 'one_to_one' }));
  rules.push({ targetClassId: MERGE_TARGET, sourceClassIds: ['financial_and_tax_pack', 'overtime_authorization'], kind: 'merge' });
  for (const [sourceId, targetIds] of Object.entries(SPLIT_TARGETS)) {
    for (const targetId of targetIds) rules.push({ targetClassId: targetId, sourceClassIds: [sourceId], kind: 'one_to_one' });
  }
  return rules;
}

function buildTargetManifest(mappingRules) {
  return {
    version: 'test-fixture-v1',
    classes: mappingRules.map(rule => ({ id: rule.targetClassId, label: `Synthetic label for ${rule.targetClassId}`, sensitivity: 'internal' })),
  };
}

function buildArchivedEntries() {
  return AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS.map(entryId => ({
    entryId, version: 1, archived: true, archivedAt: '2026-08-29T00:00:00.000Z',
  }));
}

// The approval's version/hash/scope must bind deterministically to the EXACT targetManifest
// + mappingRules content being validated (requirement: on every path, not only historical) —
// so this fixture derives them FROM that content rather than hardcoding unrelated values.
function buildApprovalRecord(targetManifest, mappingRules) {
  return {
    approver: 'test-fixture-synthetic-approver',
    date: '2026-08-29',
    status: 'APPROVED_CANONICAL_CONDITIONAL',
    source: 'test-fixture',
    version: targetManifest.version,
    hash: computeAgt002Reclass17To22Hash({ targetManifest, mappingRules }),
    scope: [targetManifest.version, 'agt002-reclass-17-to-22-f2-fixture'],
    exclusions: [],
  };
}

function buildGovernanceAcknowledgements() {
  return {
    sensitivityFieldSourceDeclaration: 'synthetic fixture literal value; not read from psi_agt002_company_evidence_registry (excluded from its minimal-exposure allowlist).',
    sharePointOpaqueRefsOnlyConfirmed: true,
  };
}

function buildTargetEntries(mappingRules) {
  const sourcesByTarget = new Map(mappingRules.map(rule => [rule.targetClassId, rule.sourceClassIds]));
  return mappingRules.map(rule => {
    const sources = sourcesByTarget.get(rule.targetClassId);
    const previousVersionPointer = sources.length > 1
      ? sources.map(sourceId => ({ entryId: sourceId }))
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
      // temporalApplicability intentionally omitted: proves the prospective default.
    };
  });
}

function buildCompleteRepositoryInputs() {
  const mappingRules = buildMappingRules();
  const targetManifest = buildTargetManifest(mappingRules);
  return {
    targetManifest,
    mappingRules,
    declaredSplitSourceIds: Object.keys(SPLIT_TARGETS),
    archivedEntries: buildArchivedEntries(),
    approvalRecord: buildApprovalRecord(targetManifest, mappingRules),
    governanceAcknowledgements: buildGovernanceAcknowledgements(),
    targetEntries: buildTargetEntries(mappingRules),
  };
}

// --- Constants/contract shape. ---
assert.deepEqual(AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS.length, 17);
assert.equal(AGT002_RECLASS_17_TO_22_TARGET_CLASS_COUNT, 22);
assert.deepEqual([...AGT002_RECLASS_17_TO_22_MAPPING_KINDS].sort(), ['merge', 'one_to_one']);
assert.deepEqual([...AGT002_RECLASS_17_TO_22_TEMPORAL_APPLICABILITY].sort(), ['historical', 'prospective']);
assert.ok(AGT002_RECLASS_17_TO_22_APPROVAL_STATUSES.includes('APPROVED_CANONICAL_CONDITIONAL'));
assert.deepEqual([...AGT002_RECLASS_17_TO_22_SEMANTIC_STATE_KEYS].sort(), [
  'catalogueApproved', 'evidenceCurrent', 'humanValidated', 'requirementMatched', 'submissionAuthorized',
].sort());

// --- Incomplete repository inputs (the ACTUAL current state of this repo: no 22-class
// manifest, no matching approval record) must yield READY=false, fail closed, with explicit
// blockers — never invented data filling the gap. ---
{
  const emptyReport = buildAgt002Reclass17To22DryRunReport({});
  assert.equal(emptyReport.ready, false);
  assert.ok(emptyReport.blockers.length > 0);
  assert.ok(emptyReport.blockers.some(b => /targetManifest/.test(b)));
  assert.ok(emptyReport.blockers.some(b => /approvalRecord/.test(b)));
  assert.ok(emptyReport.blockers.some(b => /archivedEntries/.test(b)));
  assert.ok(emptyReport.blockers.some(b => /mappingRules/.test(b)));
  assert.ok(emptyReport.blockers.some(b => /governanceAcknowledgements/.test(b)));
  assert.ok(emptyReport.blockers.some(b => /targetEntries/.test(b)));
  assert.equal(emptyReport.reconciliation_claim, false, 'must never claim reconciliation');
  assert.equal(Object.hasOwn(emptyReport, 'hash'), false, 'no hash may be computed when not ready');

  const partialReport = buildAgt002Reclass17To22DryRunReport({ targetManifest: buildTargetManifest(buildMappingRules()) });
  assert.equal(partialReport.ready, false, 'supplying only one section must still be READY=false');
}

// --- Complete synthetic fixture: proves the positive path end to end. ---
{
  const complete = buildCompleteRepositoryInputs();
  const blockers = validateAgt002Reclass17To22RepositoryInputs(complete);
  assert.deepEqual(blockers, [], `expected zero blockers, got: ${JSON.stringify(blockers)}`);

  const report = buildAgt002Reclass17To22DryRunReport(complete);
  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.reconciliation_claim, false);

  // 22 unique target classes when complete.
  assert.equal(report.targetClassIds.length, 22);
  assert.equal(new Set(report.targetClassIds).size, 22);

  // Every source mapped.
  const mappedSources = new Set(complete.mappingRules.flatMap(rule => rule.sourceClassIds));
  assert.deepEqual([...mappedSources].sort(), [...AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS].sort());

  // Merge/split explicit and reported.
  assert.deepEqual(report.merges, [MERGE_TARGET]);
  assert.deepEqual(report.splits, Object.keys(SPLIT_TARGETS).sort());

  // Archive-not-delete: all 17 source rows archived, none deleted.
  assert.deepEqual(report.archived, [...AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS].sort());

  // Prospective default applied without any explicit temporalApplicability in the fixture.
  assert.ok(complete.targetEntries.every(e => !Object.hasOwn(e, 'temporalApplicability')));

  // Revalidation queue empty when every semantic state is true.
  assert.deepEqual(report.revalidationQueue, []);

  // Hash is deterministic sha256 and independent of key order.
  assert.match(report.hash, /^[0-9a-f]{64}$/);
  const reordered = reorderKeysDeep(complete);
  assert.notDeepEqual(Object.keys(reordered), Object.keys(complete), 'sanity check: the reorder helper must actually change key order');
  const reorderedHash = computeAgt002Reclass17To22Hash(reordered);
  assert.equal(reorderedHash, report.hash, 'hash must be stable regardless of supplied key order');

  const mutated = structuredClone(complete);
  mutated.targetEntries[0].submissionAuthorized = false;
  const mutatedHash = computeAgt002Reclass17To22Hash(mutated);
  assert.notEqual(mutatedHash, report.hash, 'hash must change when the underlying input changes');
}

// --- No deletion: any 'deleted' key anywhere in archivedEntries fails closed, regardless of value. ---
{
  const withDeletedFlag = structuredClone(buildCompleteRepositoryInputs());
  withDeletedFlag.archivedEntries[0].deleted = false;
  const report = buildAgt002Reclass17To22DryRunReport(withDeletedFlag);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(b => /deleted/.test(b)));

  const notArchived = structuredClone(buildCompleteRepositoryInputs());
  notArchived.archivedEntries[0].archived = false;
  assert.ok(buildAgt002Reclass17To22DryRunReport(notArchived).blockers.some(b => /archived debe ser exactamente true/.test(b)));

  const missingArchive = structuredClone(buildCompleteRepositoryInputs());
  missingArchive.archivedEntries.shift();
  assert.ok(buildAgt002Reclass17To22DryRunReport(missingArchive).blockers.some(b => /falta el archivo/.test(b)));
}

// --- Every source mapped: dropping a source's mapping rule fails closed. ---
{
  const missingSourceMapping = structuredClone(buildCompleteRepositoryInputs());
  missingSourceMapping.mappingRules = missingSourceMapping.mappingRules.filter(rule => rule.targetClassId !== 'rup');
  missingSourceMapping.targetManifest.classes = missingSourceMapping.targetManifest.classes.filter(cls => cls.id !== 'rup');
  missingSourceMapping.targetEntries = missingSourceMapping.targetEntries.filter(e => e.entryId !== 'rup');
  const report = buildAgt002Reclass17To22DryRunReport(missingSourceMapping);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(b => b.includes('rup') && /no quedó mapeada/.test(b)));
}

// --- Merge/split must be explicit: wrong 'kind' and undeclared splits fail closed. ---
{
  const wrongKind = structuredClone(buildCompleteRepositoryInputs());
  const mergeRule = wrongKind.mappingRules.find(rule => rule.targetClassId === MERGE_TARGET);
  mergeRule.kind = 'one_to_one';
  assert.ok(buildAgt002Reclass17To22DryRunReport(wrongKind).blockers.some(b => b.includes(MERGE_TARGET) && /kind/.test(b)));

  const undeclaredSplit = structuredClone(buildCompleteRepositoryInputs());
  undeclaredSplit.declaredSplitSourceIds = undeclaredSplit.declaredSplitSourceIds.filter(id => id !== 'communications_license');
  assert.ok(buildAgt002Reclass17To22DryRunReport(undeclaredSplit).blockers.some(b => b.includes('communications_license') && /split/.test(b)));

  const fakeSplitDeclared = structuredClone(buildCompleteRepositoryInputs());
  fakeSplitDeclared.declaredSplitSourceIds.push('rup');
  assert.ok(buildAgt002Reclass17To22DryRunReport(fakeSplitDeclared).blockers.some(b => b.includes('rup') && /no es un split real/.test(b)));
}

// --- Approval record scope fields are required, not merely present-or-absent as a whole. ---
{
  for (const field of ['approver', 'date', 'status', 'source', 'version', 'hash', 'scope', 'exclusions']) {
    const missingField = structuredClone(buildCompleteRepositoryInputs());
    delete missingField.approvalRecord[field];
    const report = buildAgt002Reclass17To22DryRunReport(missingField);
    assert.equal(report.ready, false, `missing approvalRecord.${field} must fail closed`);
    assert.ok(report.blockers.some(b => b.includes(`approvalRecord.${field}`)), `blocker must name approvalRecord.${field}; got ${JSON.stringify(report.blockers)}`);
  }
  const noApproval = structuredClone(buildCompleteRepositoryInputs());
  delete noApproval.approvalRecord;
  assert.ok(buildAgt002Reclass17To22DryRunReport(noApproval).blockers.some(b => /approvalRecord ausente/.test(b)));
}

// --- Semantic states are separated: independent booleans, never coerced or derived from
// one another, and each one individually type-checked. ---
{
  const partiallyValidated = structuredClone(buildCompleteRepositoryInputs());
  const target = partiallyValidated.targetEntries.find(e => e.entryId === 'rup');
  target.catalogueApproved = false; // deliberately the only false state on this entry
  const report = buildAgt002Reclass17To22DryRunReport(partiallyValidated);
  assert.equal(report.ready, true, 'a false semantic state does not block readiness by itself');
  assert.ok(report.revalidationQueue.includes('rup'), 'an entry with any semantic state false must be queued for revalidation');
  assert.equal(target.evidenceCurrent, true, 'other semantic states on the same entry must stay untouched/independent');

  const wrongType = structuredClone(buildCompleteRepositoryInputs());
  wrongType.targetEntries.find(e => e.entryId === 'rup').humanValidated = 'true';
  assert.ok(buildAgt002Reclass17To22DryRunReport(wrongType).blockers.some(b => b.includes('humanValidated')));
}

// --- PII refs must be opaque: raw paths/URLs and forbidden raw keys fail closed. ---
{
  const rawPath = structuredClone(buildCompleteRepositoryInputs());
  rawPath.targetEntries.find(e => e.entryId === 'rup').evidenceRef = '/vault/secret/rup.pdf';
  assert.ok(buildAgt002Reclass17To22DryRunReport(rawPath).blockers.some(b => b.includes('evidenceRef')));

  const forbiddenKey = structuredClone(buildCompleteRepositoryInputs());
  forbiddenKey.targetEntries.find(e => e.entryId === 'rup').item_id = 'AAA111';
  const report = buildAgt002Reclass17To22DryRunReport(forbiddenKey);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(b => /item_id/.test(b)));

  const rawSharePointId = structuredClone(buildCompleteRepositoryInputs());
  rawSharePointId.targetEntries.find(e => e.entryId === 'rup').sharePointSyncRef = 'AAAABBBB1234';
  assert.ok(buildAgt002Reclass17To22DryRunReport(rawSharePointId).blockers.some(b => b.includes('sharePointSyncRef')));
}

// --- Sensitivity/SharePoint governance conflicts require an explicit acknowledgement, not a
// silent default. ---
{
  const noAck = structuredClone(buildCompleteRepositoryInputs());
  delete noAck.governanceAcknowledgements;
  assert.ok(buildAgt002Reclass17To22DryRunReport(noAck).blockers.some(b => /governanceAcknowledgements ausente/.test(b)));

  const falseAck = structuredClone(buildCompleteRepositoryInputs());
  falseAck.governanceAcknowledgements.sharePointOpaqueRefsOnlyConfirmed = false;
  assert.ok(buildAgt002Reclass17To22DryRunReport(falseAck).blockers.some(b => /sharePointOpaqueRefsOnlyConfirmed/.test(b)));
}

// --- Governed, reversible historical reclassification: explicit opt-in only, tied to the
// approval record's own scope; the prospective default requires none of this. ---
{
  const unGoverned = structuredClone(buildCompleteRepositoryInputs());
  const rupEntry = unGoverned.targetEntries.find(e => e.entryId === 'rup');
  rupEntry.temporalApplicability = 'historical';
  const report = buildAgt002Reclass17To22DryRunReport(unGoverned);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(b => b.includes('rup') && /reversible/.test(b)));

  const governed = structuredClone(buildCompleteRepositoryInputs());
  const governedRup = governed.targetEntries.find(e => e.entryId === 'rup');
  governedRup.temporalApplicability = 'historical';
  governedRup.reversible = true;
  governedRup.governedReclassificationApproval = { scopeRef: governed.approvalRecord.scope[0] };
  const governedReport = buildAgt002Reclass17To22DryRunReport(governed);
  assert.equal(governedReport.ready, true, 'a fully governed, reversible, in-scope historical reclassification must be allowed');
}

// --- Historical version pointers must trace back to an archived source that is actually
// this target's mapped source. ---
{
  const wrongPointer = structuredClone(buildCompleteRepositoryInputs());
  wrongPointer.targetEntries.find(e => e.entryId === 'rup').previousVersionPointer = { entryId: 'rut' };
  const report = buildAgt002Reclass17To22DryRunReport(wrongPointer);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(b => b.includes('rup') && /no es fuente/.test(b)));
}

// --- (5) previousVersionPointer must equal — exactly — the complete source set mappingRules
// declares for that target: no omission, no extras, no duplicates. MERGE_TARGET's two-source
// lineage (financial_and_tax_pack, overtime_authorization) exercises all four cases. ---
{
  const partialLineage = structuredClone(buildCompleteRepositoryInputs());
  partialLineage.targetEntries.find(e => e.entryId === MERGE_TARGET).previousVersionPointer = [
    { entryId: 'financial_and_tax_pack' },
  ];
  const partialReport = buildAgt002Reclass17To22DryRunReport(partialLineage);
  assert.equal(partialReport.ready, false, 'omitting one of two merge sources must fail closed');
  assert.ok(
    partialReport.blockers.some(b => b.includes(MERGE_TARGET) && b.includes('overtime_authorization') && /incompleto/.test(b)),
    `expected an incomplete-lineage blocker naming overtime_authorization; got ${JSON.stringify(partialReport.blockers)}`,
  );

  const extraLineage = structuredClone(buildCompleteRepositoryInputs());
  extraLineage.targetEntries.find(e => e.entryId === MERGE_TARGET).previousVersionPointer = [
    { entryId: 'financial_and_tax_pack' },
    { entryId: 'overtime_authorization' },
    { entryId: 'rup' },
  ];
  const extraReport = buildAgt002Reclass17To22DryRunReport(extraLineage);
  assert.equal(extraReport.ready, false, 'an extra source beyond mappingRules must fail closed');
  assert.ok(extraReport.blockers.some(b => b.includes(MERGE_TARGET) && b.includes('rup') && /no es fuente/.test(b)));

  const duplicateLineage = structuredClone(buildCompleteRepositoryInputs());
  duplicateLineage.targetEntries.find(e => e.entryId === MERGE_TARGET).previousVersionPointer = [
    { entryId: 'financial_and_tax_pack' },
    { entryId: 'financial_and_tax_pack' },
    { entryId: 'overtime_authorization' },
  ];
  const duplicateReport = buildAgt002Reclass17To22DryRunReport(duplicateLineage);
  assert.equal(duplicateReport.ready, false, 'a duplicated source pointer must fail closed');
  assert.ok(
    duplicateReport.blockers.some(b => b.includes(MERGE_TARGET) && b.includes('financial_and_tax_pack') && /duplicado/.test(b)),
  );
  assert.ok(
    !duplicateReport.blockers.some(b => /incompleto/.test(b) && b.includes(MERGE_TARGET)),
    'a duplicate that still covers every expected source must not also report a false incomplete-lineage blocker',
  );

  // Valid complete lineage, order-independent: the exact expected set in reverse order must
  // still be accepted as ready.
  const reorderedLineage = structuredClone(buildCompleteRepositoryInputs());
  reorderedLineage.targetEntries.find(e => e.entryId === MERGE_TARGET).previousVersionPointer = [
    { entryId: 'overtime_authorization' },
    { entryId: 'financial_and_tax_pack' },
  ];
  assert.equal(buildAgt002Reclass17To22DryRunReport(reorderedLineage).ready, true, 'a complete lineage in a different order must still be ready');
}

// --- (1) approvalRecord must have an EXACT approved status: PENDING/REJECTED/anything else
// fails closed even though they are recognized enum values; both approved statuses succeed. ---
{
  for (const status of ['PENDING', 'REJECTED', 'SOMETHING_UNRECOGNIZED']) {
    const badStatus = structuredClone(buildCompleteRepositoryInputs());
    badStatus.approvalRecord.status = status;
    const report = buildAgt002Reclass17To22DryRunReport(badStatus);
    assert.equal(report.ready, false, `status ${status} must fail closed`);
    assert.ok(report.blockers.some(b => b.includes('approvalRecord.status')), `blocker must name approvalRecord.status for ${status}; got ${JSON.stringify(report.blockers)}`);
  }

  const unconditional = structuredClone(buildCompleteRepositoryInputs());
  unconditional.approvalRecord.status = 'APPROVED_UNCONDITIONAL';
  assert.equal(buildAgt002Reclass17To22DryRunReport(unconditional).ready, true, 'APPROVED_UNCONDITIONAL must be accepted like APPROVED_CANONICAL_CONDITIONAL');

  assert.deepEqual([...AGT002_RECLASS_17_TO_22_APPROVED_STATUSES].sort(), ['APPROVED_CANONICAL_CONDITIONAL', 'APPROVED_UNCONDITIONAL']);
  assert.ok(!AGT002_RECLASS_17_TO_22_APPROVED_STATUSES.includes('PENDING'));
  assert.ok(!AGT002_RECLASS_17_TO_22_APPROVED_STATUSES.includes('REJECTED'));
  assert.ok(AGT002_RECLASS_17_TO_22_APPROVAL_STATUSES.includes('PENDING'), 'PENDING stays a recognized status, just never an approved one');
}

// --- (2) approvalRecord.version/hash/scope must bind deterministically to the EXACT
// targetManifest/mappingRules content being validated, on every path — not only when a
// historical entry is present. ---
{
  const wrongVersion = structuredClone(buildCompleteRepositoryInputs());
  wrongVersion.approvalRecord.version = 'v-not-the-manifest-version';
  const wrongVersionReport = buildAgt002Reclass17To22DryRunReport(wrongVersion);
  assert.equal(wrongVersionReport.ready, false);
  assert.ok(wrongVersionReport.blockers.some(b => b.includes('approvalRecord.version') && /coincidir/.test(b)));

  const wrongHash = structuredClone(buildCompleteRepositoryInputs());
  wrongHash.approvalRecord.hash = opaqueRef('unrelated-content');
  const wrongHashReport = buildAgt002Reclass17To22DryRunReport(wrongHash);
  assert.equal(wrongHashReport.ready, false);
  assert.ok(wrongHashReport.blockers.some(b => b.includes('approvalRecord.hash') && /determinístico/.test(b)));

  const wrongScope = structuredClone(buildCompleteRepositoryInputs());
  wrongScope.approvalRecord.scope = wrongScope.approvalRecord.scope.filter(s => s !== wrongScope.targetManifest.version);
  const wrongScopeReport = buildAgt002Reclass17To22DryRunReport(wrongScope);
  assert.equal(wrongScopeReport.ready, false);
  assert.ok(wrongScopeReport.blockers.some(b => b.includes('approvalRecord.scope') && /incluir explícitamente/.test(b)));

  // Content drift: mutating targetManifest/mappingRules without re-issuing the approval's
  // hash must fail closed — proves the binding is to the exact content, not merely to the
  // presence of a version/hash/scope field.
  const contentDrift = structuredClone(buildCompleteRepositoryInputs());
  contentDrift.targetManifest.classes[0].label = 'Different label after drift';
  const contentDriftReport = buildAgt002Reclass17To22DryRunReport(contentDrift);
  assert.equal(contentDriftReport.ready, false);
  assert.ok(contentDriftReport.blockers.some(b => b.includes('approvalRecord.hash')));

  // Positive: every entry in the baseline fixture is prospective (no historical entries at
  // all), and the binding still must hold for readiness — proves it applies on every path.
  const baseline = buildCompleteRepositoryInputs();
  assert.ok(baseline.targetEntries.every(e => (e.temporalApplicability ?? 'prospective') === 'prospective'));
  assert.equal(buildAgt002Reclass17To22DryRunReport(baseline).ready, true, 'correctly bound approval on an all-prospective bundle must be ready');
}

// --- (3) forbidden raw-reference keys/values are rejected recursively across the ENTIRE
// input — archive, approval, acknowledgements, rules, target manifest — not only target
// entries — while legitimate governance metadata elsewhere is allowed through untouched. ---
{
  const forbiddenKeyCases = [
    ['archivedEntries', 0, 'token', 'raw-secret-token'],
    ['approvalRecord', null, 'password', 'hunter2'],
    ['governanceAcknowledgements', null, 'secret', 'shh'],
    ['mappingRules', 0, 'name', 'Real Person Name'],
    ['targetManifest', null, 'etag', 'W/"abc123"'],
  ];
  for (const [section, index, key, val] of forbiddenKeyCases) {
    const tampered = structuredClone(buildCompleteRepositoryInputs());
    const target = index === null ? tampered[section] : tampered[section][index];
    target[key] = val;
    const report = buildAgt002Reclass17To22DryRunReport(tampered);
    assert.equal(report.ready, false, `forbidden key '${key}' under ${section} must fail closed`);
    assert.ok(report.blockers.some(b => b.includes(key)), `blocker must name ${key}; got ${JSON.stringify(report.blockers)}`);
  }

  const piiValueCases = [
    ['archivedEntries', 0, 'note', 'someone@example.com'],
    ['approvalRecord', null, 'internalNote', 'https://sharepoint.example.com/sites/x'],
    ['governanceAcknowledgements', null, 'extra', '/etc/passwd'],
    ['targetManifest', null, 'extra', 'www.example.com/manifest'],
  ];
  for (const [section, index, key, val] of piiValueCases) {
    const tampered = structuredClone(buildCompleteRepositoryInputs());
    const target = index === null ? tampered[section] : tampered[section][index];
    target[key] = val;
    const report = buildAgt002Reclass17To22DryRunReport(tampered);
    assert.equal(report.ready, false, `PII-ish raw value under ${section}.${key} must fail closed`);
    assert.ok(report.blockers.some(b => b.includes(key)), `blocker must name ${section}.${key}; got ${JSON.stringify(report.blockers)}`);
  }

  // Positive: legitimate governance metadata (free descriptive text, opaque hashes, plain
  // identifiers) throughout the whole bundle passes without any false-positive blocker.
  assert.deepEqual(validateAgt002Reclass17To22RepositoryInputs(buildCompleteRepositoryInputs()), []);
}

// --- (4) declaredSplitSourceIds must reference the closed 17-class source catalog: a
// typo/unknown id fails closed even when otherwise well-formed. ---
{
  const typoSplit = structuredClone(buildCompleteRepositoryInputs());
  typoSplit.declaredSplitSourceIds.push('communications_licence_typo');
  const report = buildAgt002Reclass17To22DryRunReport(typoSplit);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(b => b.includes('communications_licence_typo') && /catálogo cerrado/.test(b)));

  // Positive: the baseline fixture's declaredSplitSourceIds are all valid catalog ids.
  const baseline = buildCompleteRepositoryInputs();
  assert.ok(baseline.declaredSplitSourceIds.length > 0);
  assert.ok(baseline.declaredSplitSourceIds.every(id => AGT002_RECLASS_17_TO_22_SOURCE_CLASS_IDS.includes(id)));
}

// --- (6) the safe exemption for hash/evidenceRef/sharePointSyncRef applies ONLY at their
// exact canonical paths (approvalRecord.hash; targetEntries[i].evidenceRef/sharePointSyncRef)
// — the same bare key names anywhere else must still be recursively scanned and rejected when
// they carry a URL/email/absolute-path raw-reference value, so a raw reference cannot be
// smuggled in just by naming it like one of the exempt fields. ---
{
  const smugglingCases = [
    ['governanceAcknowledgements', null, 'hash', 'https://evil.example.com/leak'],
    ['archivedEntries', 0, 'evidenceRef', '/vault/leaked-evidence.pdf'],
    ['mappingRules', 0, 'hash', 'someone@example.com'],
    ['targetManifest', null, 'hash', 'https://sharepoint.example.com/sites/leak'],
    // Analogous unexpected location: 'hash' is only exempt at approvalRecord.hash, never at
    // targetEntries[i].hash (evidenceRef/sharePointSyncRef are the only exempt keys there).
    ['targetEntries', 0, 'hash', 'www.example.com/leak'],
  ];
  for (const [section, index, key, val] of smugglingCases) {
    const tampered = structuredClone(buildCompleteRepositoryInputs());
    const target = index === null ? tampered[section] : tampered[section][index];
    target[key] = val;
    const report = buildAgt002Reclass17To22DryRunReport(tampered);
    assert.equal(report.ready, false, `smuggled raw value under ${section}${index === null ? '' : `[${index}]`}.${key} must fail closed`);
    assert.ok(
      report.blockers.some(b => b.includes(key)),
      `blocker must name ${section}${index === null ? '' : `[${index}]`}.${key}; got ${JSON.stringify(report.blockers)}`,
    );
  }

  // Positive control: the exact canonical paths, holding their legitimate dedicated-format
  // values (a real sha256 hex hash / real opaque refs), remain exempt and pass untouched.
  assert.deepEqual(validateAgt002Reclass17To22RepositoryInputs(buildCompleteRepositoryInputs()), []);
}

console.log('agt002-company-evidence-reclass-17-to-22: OK');
