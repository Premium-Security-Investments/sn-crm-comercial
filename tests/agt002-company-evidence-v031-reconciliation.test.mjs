// All fixtures below are synthetic. No DANE data, no network/DB/fs/env access, no real timestamps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCatalogueApproval,
  assertFreezeBeforeCutover,
  archiveRow,
  computeSemanticFlags,
  detectDoubleTaxonomy,
  evaluateHabilitacion,
  buildRevalidationQueueEntry,
  runReconciliation,
  rollback,
  teardown,
} from '../agt002-company-evidence-v031-reconciliation.js';

const clone = (value) => structuredClone(value);

const CATALOGUE_V031 = Object.freeze({
  version: '0.3.1',
  mapHash: 'synthetic-hash-v031-aaaa1111',
  exclusivityGroups: [['TAXO-A1', 'TAXO-B2']],
  entries: [
    { code: 'TAXO-A1', label: 'Synthetic Sector A' },
    { code: 'TAXO-B2', label: 'Synthetic Sector B' },
    { code: 'TAXO-C3', label: 'Synthetic Sector C' },
  ],
});

const HUMAN_APPROVAL_MATCH = Object.freeze({
  version: '0.3.1',
  mapHash: 'synthetic-hash-v031-aaaa1111',
  approvedBy: 'synthetic-reviewer-001',
  approvedAt: 'synthetic-ts-0001',
  scope: 'catalogue-v031',
});

const HUMAN_APPROVAL_WRONG_VERSION = Object.freeze({
  ...HUMAN_APPROVAL_MATCH,
  version: '0.3.0',
});

const HUMAN_APPROVAL_WRONG_HASH = Object.freeze({
  ...HUMAN_APPROVAL_MATCH,
  mapHash: 'synthetic-hash-v031-zzzz9999',
});

const FREEZE_SENTINEL = Object.freeze({
  frozen: true,
  frozenAt: 'synthetic-ts-0000',
  token: 'synthetic-freeze-token-001',
});

const FREEZE_SENTINEL_UNSET = Object.freeze({
  frozen: false,
  frozenAt: null,
  token: null,
});

const CUTOVER_TS = 'synthetic-ts-0002';

const ROW_NORMAL_1 = Object.freeze({
  id: 'synthetic-row-001',
  taxonomy: ['TAXO-A1'],
  riskScore: 0.10,
});

const ROW_DOUBLE_TAXONOMY = Object.freeze({
  id: 'synthetic-row-002',
  taxonomy: ['TAXO-A1', 'TAXO-B2'],
  riskScore: 0.10,
});

const ROW_RISKY_1 = Object.freeze({
  id: 'synthetic-row-003',
  taxonomy: ['TAXO-A1'],
  riskScore: 0.95,
  flaggedReason: 'synthetic-high-risk',
});

const ROW_RISKY_2 = Object.freeze({
  id: 'synthetic-row-004',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.90,
  flaggedReason: 'synthetic-high-risk',
});

const ROW_RISKY_DOUBLE = Object.freeze({
  id: 'synthetic-row-005',
  taxonomy: ['TAXO-A1', 'TAXO-B2'],
  riskScore: 0.99,
  flaggedReason: 'synthetic-high-risk',
});

const ALL_ROWS = [ROW_NORMAL_1, ROW_DOUBLE_TAXONOMY, ROW_RISKY_1, ROW_RISKY_2, ROW_RISKY_DOUBLE];

const RISKY_CUTOVER_ROWS = [ROW_NORMAL_1, ROW_DOUBLE_TAXONOMY, ROW_RISKY_1, ROW_RISKY_2];

const HUMAN_DATA_AUTHORIZATION_EXACT_FOR_ROW_003 = Object.freeze({
  rowId: 'synthetic-row-003',
  dataHash: 'synthetic-row-datahash-003-exact',
  approvedBy: 'synthetic-reviewer-002',
  approvedAt: 'synthetic-ts-0003',
});

const HUMAN_DATA_AUTHORIZATION_INEXACT_FOR_ROW_004 = Object.freeze({
  rowId: 'synthetic-row-004',
  dataHash: 'synthetic-row-datahash-004-DOES-NOT-MATCH',
  approvedBy: 'synthetic-reviewer-002',
  approvedAt: 'synthetic-ts-0003',
});

const ROW_003_WITH_MATCHING_DATAHASH = Object.freeze({
  ...ROW_RISKY_1,
  dataHash: 'synthetic-row-datahash-003-exact',
});

const ROW_004_WITH_MISMATCHED_DATAHASH = Object.freeze({
  ...ROW_RISKY_2,
  dataHash: 'synthetic-row-datahash-004-actual',
});

const baseReconciliationInput = () => clone({
  catalogue: CATALOGUE_V031,
  humanApproval: HUMAN_APPROVAL_MATCH,
  freezeSentinel: FREEZE_SENTINEL,
  cutoverTimestamp: CUTOVER_TS,
  rows: [ROW_NORMAL_1, ROW_003_WITH_MATCHING_DATAHASH, ROW_004_WITH_MISMATCHED_DATAHASH],
  humanDataAuthorizations: [HUMAN_DATA_AUTHORIZATION_EXACT_FOR_ROW_003],
  replayToken: 'synthetic-replay-token-001',
});

test('catalogue approval requires exact v0.3.1 version, exact map hash, and an existing matching human approval', () => {
  const result = validateCatalogueApproval(clone(CATALOGUE_V031), clone(HUMAN_APPROVAL_MATCH));
  assert.equal(result, true);
});

test('catalogue approval is rejected when human approval version does not exactly match v0.3.1', () => {
  const result = validateCatalogueApproval(clone(CATALOGUE_V031), clone(HUMAN_APPROVAL_WRONG_VERSION));
  assert.equal(result, false);
});

test('catalogue approval is rejected when human approval map hash does not exactly match catalogue hash', () => {
  const result = validateCatalogueApproval(clone(CATALOGUE_V031), clone(HUMAN_APPROVAL_WRONG_HASH));
  assert.equal(result, false);
});

test('catalogue approval is rejected when no human approval record exists', () => {
  const result = validateCatalogueApproval(clone(CATALOGUE_V031), null);
  assert.equal(result, false);
});

test('freeze sentinel set before cutover timestamp permits cutover', () => {
  assert.doesNotThrow(() => assertFreezeBeforeCutover(clone(FREEZE_SENTINEL), CUTOVER_TS));
});

test('missing or unset freeze sentinel blocks cutover', () => {
  assert.throws(() => assertFreezeBeforeCutover(clone(FREEZE_SENTINEL_UNSET), CUTOVER_TS));
});

test('archive is append-only, reversible, and never deletes prior historical rows', () => {
  const archiveAfterFirst = archiveRow(clone(ROW_NORMAL_1), [], '0.3.1');
  assert.equal(archiveAfterFirst.length, 1);
  const archiveAfterSecond = archiveRow(clone(ROW_RISKY_1), archiveAfterFirst, '0.3.1');
  assert.equal(archiveAfterSecond.length, 2);
  assert.deepEqual(archiveAfterSecond[0], archiveAfterFirst[0]);
  const stillFindable = archiveAfterSecond.find((entry) => entry.id === ROW_NORMAL_1.id);
  assert.ok(stillFindable, 'first archived row must remain retrievable after later archiving');
});

test('every historical archived row carries lineage and version metadata', () => {
  const archive = archiveRow(clone(ROW_NORMAL_1), [], '0.3.1');
  for (const entry of archive) {
    assert.ok(Array.isArray(entry.lineage), 'archived row must carry a lineage array');
    assert.ok(entry.lineage.length >= 1, 'lineage must not be empty');
    assert.equal(entry.version, '0.3.1');
  }
});

test('semantic flags are computed independently, not coupled to one another', () => {
  const flagsNormal = computeSemanticFlags(clone(ROW_NORMAL_1), CATALOGUE_V031);
  const flagsDoubleOnly = computeSemanticFlags(clone(ROW_DOUBLE_TAXONOMY), CATALOGUE_V031);
  const flagsRiskyOnly = computeSemanticFlags(clone(ROW_RISKY_1), CATALOGUE_V031);
  const flagsBoth = computeSemanticFlags(clone(ROW_RISKY_DOUBLE), CATALOGUE_V031);

  assert.equal(flagsNormal.isHighRisk, false);
  assert.equal(flagsNormal.isTaxonomyConflict, false);

  assert.equal(flagsDoubleOnly.isHighRisk, false);
  assert.equal(flagsDoubleOnly.isTaxonomyConflict, true);

  assert.equal(flagsRiskyOnly.isHighRisk, true);
  assert.equal(flagsRiskyOnly.isTaxonomyConflict, false);

  assert.equal(flagsBoth.isHighRisk, true);
  assert.equal(flagsBoth.isTaxonomyConflict, true);
});

test('anti-double-taxonomy detects rows assigned two mutually exclusive taxonomy codes', () => {
  assert.equal(detectDoubleTaxonomy(clone(ROW_DOUBLE_TAXONOMY), CATALOGUE_V031), true);
  assert.equal(detectDoubleTaxonomy(clone(ROW_NORMAL_1), CATALOGUE_V031), false);
});

test('exactly two risky synthetic rows are forced vigente_para_habilitacion=false and queued when no authorization exists', () => {
  const results = RISKY_CUTOVER_ROWS
    .filter((row) => row.riskScore >= 0.9)
    .map((row) => evaluateHabilitacion(clone(row), []));

  assert.equal(results.length, 2);
  const forcedFalseAndQueued = results.filter(
    (result) => result.vigente_para_habilitacion === false && result.queuedForRevalidation === true,
  );
  assert.equal(forcedFalseAndQueued.length, 2, 'all risky rows lacking authorization must be forced false and queued');
});

test('risky row bypasses forced false and queueing only with an exact matching human data authorization', () => {
  const result = evaluateHabilitacion(clone(ROW_003_WITH_MATCHING_DATAHASH), [
    clone(HUMAN_DATA_AUTHORIZATION_EXACT_FOR_ROW_003),
  ]);
  assert.equal(result.queuedForRevalidation, false);
});

test('near-matching but inexact human data authorization does not bypass forced false or queueing', () => {
  const result = evaluateHabilitacion(clone(ROW_004_WITH_MISMATCHED_DATAHASH), [
    clone(HUMAN_DATA_AUTHORIZATION_INEXACT_FOR_ROW_004),
  ]);
  assert.equal(result.vigente_para_habilitacion, false);
  assert.equal(result.queuedForRevalidation, true);
});

test('revalidation queue entries carry complete metadata', () => {
  const entry = buildRevalidationQueueEntry(clone(ROW_RISKY_2), {
    reason: 'synthetic-high-risk-no-authorization',
    sourceCatalogueVersion: '0.3.1',
    sourceMapHash: 'synthetic-hash-v031-aaaa1111',
    queuedAt: 'synthetic-ts-0004',
  });

  assert.equal(typeof entry.id, 'string');
  assert.equal(entry.rowId, ROW_RISKY_2.id);
  assert.equal(entry.reason, 'synthetic-high-risk-no-authorization');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.requiredApprovalType, 'human-data-authorization');
  assert.equal(entry.sourceCatalogueVersion, '0.3.1');
  assert.equal(entry.sourceMapHash, 'synthetic-hash-v031-aaaa1111');
  assert.equal(entry.queuedAt, 'synthetic-ts-0004');
  assert.ok(entry.lineageRef, 'queue entry must reference lineage of the source row');
});

test('replaying the exact same input under the same replay token is idempotent', () => {
  const input = baseReconciliationInput();
  const first = runReconciliation(clone(input), null);
  const second = runReconciliation(clone(input), first.state);

  assert.deepEqual(second.result.archive, first.result.archive);
  assert.deepEqual(second.result.flags, first.result.flags);
  assert.deepEqual(second.result.revalidationQueue, first.result.revalidationQueue);
  assert.equal(second.result.status, first.result.status);
});

test('a conflicting replay under an already-used replay token is denied and audited', () => {
  const original = baseReconciliationInput();
  const first = runReconciliation(clone(original), null);

  const conflicting = clone(original);
  conflicting.catalogue.mapHash = 'synthetic-hash-v031-CONFLICTING-9999';

  const second = runReconciliation(conflicting, first.state);

  assert.equal(second.result.status, 'denied');
  const conflictAudited = second.state.auditLog.some(
    (entry) => entry.replayToken === 'synthetic-replay-token-001' && entry.type === 'replay-conflict',
  );
  assert.ok(conflictAudited, 'a denied conflicting replay must be recorded in the audit log');
});

test('rollback restores the prior version while preserving the full audit trail', () => {
  const input = baseReconciliationInput();
  const first = runReconciliation(clone(input), null);
  const originalAuditLog = clone(first.state.auditLog);

  const rolledBack = rollback(clone(first.state), '0.3.0');

  assert.equal(rolledBack.version, '0.3.0');
  for (const originalEntry of originalAuditLog) {
    assert.ok(
      rolledBack.auditLog.some((entry) => JSON.stringify(entry) === JSON.stringify(originalEntry)),
      'rollback must not remove any pre-existing audit entry',
    );
  }
  assert.ok(rolledBack.auditLog.length >= originalAuditLog.length);
});

test('teardown clears working state but preserves the audit trail', () => {
  const input = baseReconciliationInput();
  const first = runReconciliation(clone(input), null);
  const auditLogBeforeTeardown = clone(first.state.auditLog);

  const finalState = teardown(clone(first.state));

  assert.deepEqual(finalState.auditLog, auditLogBeforeTeardown);
  assert.equal(finalState.archive.length, 0);
  assert.equal(finalState.revalidationQueue.length, 0);
});

// --- Regression coverage for independent Sonnet review findings -----------------------------
// All fixtures below remain synthetic. No DANE data, no network/DB/fs/env access, no real
// timestamps, no live cutover.

const buildInputWithReplayToken = (replayToken) => clone({
  catalogue: CATALOGUE_V031,
  humanApproval: HUMAN_APPROVAL_MATCH,
  freezeSentinel: FREEZE_SENTINEL,
  cutoverTimestamp: CUTOVER_TS,
  rows: [ROW_NORMAL_1],
  humanDataAuthorizations: [],
  replayToken,
});

const buildF2Input = (row, replayToken) => clone({
  catalogue: CATALOGUE_V031,
  humanApproval: HUMAN_APPROVAL_MATCH,
  freezeSentinel: FREEZE_SENTINEL,
  cutoverTimestamp: CUTOVER_TS,
  rows: [row],
  humanDataAuthorizations: [],
  replayToken,
});

const F2_REQUIRED_SEMANTIC_FIELD_NAMES = Object.freeze([
  'catalogue_approved',
  'evidence_current',
  'requirement_matched',
  'human_validated',
  'submission_authorized',
  'class_definition_version',
  'temporal_applicability',
]);

const ROW_F2_ALL_TRUE = Object.freeze({
  id: 'synthetic-row-f2-001',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.10,
  evidenceCurrent: true,
  requirementMatched: true,
  humanValidated: true,
  submissionAuthorized: true,
  classDefinitionVersion: '0.3.1',
  temporalApplicability: 'prospective',
});

const ROW_F2_INDEPENDENT_MIX = Object.freeze({
  id: 'synthetic-row-f2-002',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.10,
  evidenceCurrent: true,
  requirementMatched: false,
  humanValidated: true,
  submissionAuthorized: false,
  classDefinitionVersion: '0.3.1',
  temporalApplicability: 'historical',
});

const ROW_F2_CATALOGUE_APPROVED_BUT_ALL_ELSE_FALSE = Object.freeze({
  id: 'synthetic-row-f2-003',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.10,
  evidenceCurrent: false,
  requirementMatched: false,
  humanValidated: false,
  submissionAuthorized: false,
  classDefinitionVersion: '0.3.1',
  temporalApplicability: 'prospective',
});

const ROW_F2_MISSING_EVIDENCE_CURRENT = Object.freeze({
  id: 'synthetic-row-f2-004',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.10,
  requirementMatched: true,
  humanValidated: true,
  submissionAuthorized: true,
  classDefinitionVersion: '0.3.1',
  temporalApplicability: 'prospective',
});

const ROW_F2_NON_BOOLEAN_HUMAN_VALIDATED = Object.freeze({
  id: 'synthetic-row-f2-005',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.10,
  evidenceCurrent: true,
  requirementMatched: true,
  humanValidated: 'yes',
  submissionAuthorized: true,
  classDefinitionVersion: '0.3.1',
  temporalApplicability: 'prospective',
});

const ROW_F2_MISSING_CLASS_DEFINITION_VERSION = Object.freeze({
  id: 'synthetic-row-f2-006',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.10,
  evidenceCurrent: true,
  requirementMatched: true,
  humanValidated: true,
  submissionAuthorized: true,
  temporalApplicability: 'prospective',
});

const ROW_F2_WRONG_CLASS_DEFINITION_VERSION = Object.freeze({
  ...ROW_F2_MISSING_CLASS_DEFINITION_VERSION,
  id: 'synthetic-row-f2-007',
  classDefinitionVersion: '0.3.0',
});

const ROW_F2_MISSING_TEMPORAL_APPLICABILITY = Object.freeze({
  id: 'synthetic-row-f2-008',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.10,
  evidenceCurrent: true,
  requirementMatched: true,
  humanValidated: true,
  submissionAuthorized: true,
  classDefinitionVersion: '0.3.1',
});

const ROW_F2_INVALID_TEMPORAL_APPLICABILITY = Object.freeze({
  ...ROW_F2_MISSING_TEMPORAL_APPLICABILITY,
  id: 'synthetic-row-f2-009',
  temporalApplicability: 'quantum-limbo',
});

test('F2-required semantic fields exist under their exact independent names on every reconciled row and on the result', () => {
  const input = buildF2Input(ROW_F2_ALL_TRUE, 'synthetic-replay-token-f2-001');
  const { result } = runReconciliation(input, null);

  assert.equal(result.status, 'reconciled');
  assert.equal(result.flags.length, 1);
  const flagEntry = result.flags[0];

  for (const key of F2_REQUIRED_SEMANTIC_FIELD_NAMES) {
    assert.ok(Object.prototype.hasOwnProperty.call(flagEntry, key), `reconciled row flags must carry ${key}`);
  }
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'catalogue_approved'), 'result must also carry catalogue_approved');

  assert.equal(flagEntry.catalogue_approved, true);
  assert.equal(flagEntry.evidence_current, true);
  assert.equal(flagEntry.requirement_matched, true);
  assert.equal(flagEntry.human_validated, true);
  assert.equal(flagEntry.submission_authorized, true);
  assert.equal(flagEntry.class_definition_version, '0.3.1');
  assert.equal(flagEntry.temporal_applicability, 'prospective');
  assert.equal(result.catalogue_approved, true);
});

test('catalogue_approved alone never implies evidence_current, requirement_matched, human_validated, or submission_authorized', () => {
  const input = buildF2Input(ROW_F2_CATALOGUE_APPROVED_BUT_ALL_ELSE_FALSE, 'synthetic-replay-token-f2-002');
  const { result } = runReconciliation(input, null);
  const flagEntry = result.flags[0];

  assert.equal(flagEntry.catalogue_approved, true, 'catalogue approval itself must still be reported true');
  assert.equal(flagEntry.evidence_current, false, 'catalogue approval must never imply evidence_current');
  assert.equal(flagEntry.requirement_matched, false, 'catalogue approval must never imply requirement_matched');
  assert.equal(flagEntry.human_validated, false, 'catalogue approval must never imply human_validated');
  assert.equal(flagEntry.submission_authorized, false, 'catalogue approval must never imply submission_authorized');
});

test('caller-supplied independent semantic field combinations are preserved exactly, never coupled to one another', () => {
  const input = buildF2Input(ROW_F2_INDEPENDENT_MIX, 'synthetic-replay-token-f2-003');
  const { result } = runReconciliation(input, null);
  const flagEntry = result.flags[0];

  assert.equal(flagEntry.evidence_current, true);
  assert.equal(flagEntry.requirement_matched, false);
  assert.equal(flagEntry.human_validated, true);
  assert.equal(flagEntry.submission_authorized, false);
  assert.equal(flagEntry.class_definition_version, '0.3.1');
  assert.equal(flagEntry.temporal_applicability, 'historical');
});

test('a missing required boolean semantic field fails closed to false, never true or undefined', () => {
  const input = buildF2Input(ROW_F2_MISSING_EVIDENCE_CURRENT, 'synthetic-replay-token-f2-004');
  const { result } = runReconciliation(input, null);
  const flagEntry = result.flags[0];

  assert.equal(flagEntry.evidence_current, false, 'a missing evidenceCurrent must fail closed to exactly false');
});

test('a non-boolean value supplied for a required semantic field fails closed to false', () => {
  const input = buildF2Input(ROW_F2_NON_BOOLEAN_HUMAN_VALIDATED, 'synthetic-replay-token-f2-005');
  const { result } = runReconciliation(input, null);
  const flagEntry = result.flags[0];

  assert.equal(flagEntry.human_validated, false, 'a non-boolean humanValidated must fail closed, never be coerced truthy');
});

test('a missing class_definition_version fails closed instead of silently passing as a valid version', () => {
  const input = buildF2Input(ROW_F2_MISSING_CLASS_DEFINITION_VERSION, 'synthetic-replay-token-f2-006');
  const { result } = runReconciliation(input, null);
  const flagEntry = result.flags[0];

  assert.ok(Object.prototype.hasOwnProperty.call(flagEntry, 'class_definition_version'), 'class_definition_version must be present even when the caller omitted it');
  assert.notEqual(flagEntry.class_definition_version, CATALOGUE_V031.version);
  assert.ok(!flagEntry.class_definition_version, 'a missing class_definition_version must fail closed, not silently validate');
});

test('a class_definition_version outside the explicit valid value fails closed', () => {
  const input = buildF2Input(ROW_F2_WRONG_CLASS_DEFINITION_VERSION, 'synthetic-replay-token-f2-007');
  const { result } = runReconciliation(input, null);
  const flagEntry = result.flags[0];

  assert.ok(Object.prototype.hasOwnProperty.call(flagEntry, 'class_definition_version'), 'class_definition_version must be present');
  assert.notEqual(flagEntry.class_definition_version, '0.3.0');
  assert.ok(!flagEntry.class_definition_version, 'an unrecognized class_definition_version must fail closed');
});

test('a missing temporal_applicability fails closed instead of silently defaulting to a valid-looking applicability', () => {
  const input = buildF2Input(ROW_F2_MISSING_TEMPORAL_APPLICABILITY, 'synthetic-replay-token-f2-008');
  const { result } = runReconciliation(input, null);
  const flagEntry = result.flags[0];

  assert.ok(Object.prototype.hasOwnProperty.call(flagEntry, 'temporal_applicability'), 'temporal_applicability must be present even when the caller omitted it');
  assert.ok(!flagEntry.temporal_applicability, 'a missing temporal_applicability must fail closed, never silently default');
});

test('a temporal_applicability value outside the explicit valid set fails closed', () => {
  const input = buildF2Input(ROW_F2_INVALID_TEMPORAL_APPLICABILITY, 'synthetic-replay-token-f2-009');
  const { result } = runReconciliation(input, null);
  const flagEntry = result.flags[0];

  assert.ok(Object.prototype.hasOwnProperty.call(flagEntry, 'temporal_applicability'), 'temporal_applicability must be present');
  assert.notEqual(flagEntry.temporal_applicability, 'quantum-limbo');
  assert.ok(!flagEntry.temporal_applicability, 'an invalid temporal_applicability must fail closed');
});

const ROW_RISKY_DATAHASH_MISSING_BOTH = Object.freeze({
  id: 'synthetic-row-datahash-missing-both',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.95,
});

const AUTH_DATAHASH_MISSING_SAME_ROW = Object.freeze({
  rowId: 'synthetic-row-datahash-missing-both',
  approvedBy: 'synthetic-reviewer-003',
  approvedAt: 'synthetic-ts-0005',
});

const ROW_RISKY_DATAHASH_EMPTY_BOTH = Object.freeze({
  id: 'synthetic-row-datahash-empty-both',
  taxonomy: ['TAXO-C3'],
  riskScore: 0.95,
  dataHash: '',
});

const AUTH_DATAHASH_EMPTY_SAME_ROW = Object.freeze({
  rowId: 'synthetic-row-datahash-empty-both',
  dataHash: '',
  approvedBy: 'synthetic-reviewer-003',
  approvedAt: 'synthetic-ts-0005',
});

test('evaluateHabilitacion must not authorize when both row.dataHash and auth.dataHash are missing (undefined must never authorize)', () => {
  const result = evaluateHabilitacion(clone(ROW_RISKY_DATAHASH_MISSING_BOTH), [clone(AUTH_DATAHASH_MISSING_SAME_ROW)]);
  assert.equal(result.vigente_para_habilitacion, false, 'a missing row.dataHash must never be treated as authorized');
  assert.equal(result.queuedForRevalidation, true);
});

test('evaluateHabilitacion must not authorize when row.dataHash and auth.dataHash are both empty strings', () => {
  const result = evaluateHabilitacion(clone(ROW_RISKY_DATAHASH_EMPTY_BOTH), [clone(AUTH_DATAHASH_EMPTY_SAME_ROW)]);
  assert.equal(result.vigente_para_habilitacion, false, 'an empty-string dataHash match must never authorize; only a non-empty exact hash may');
  assert.equal(result.queuedForRevalidation, true);
});

const RESERVED_PROTOTYPE_REPLAY_TOKENS = Object.freeze(['hasOwnProperty', '__proto__', 'constructor']);

for (const reservedToken of RESERVED_PROTOTYPE_REPLAY_TOKENS) {
  test(`replay token '${reservedToken}' works as an ordinary isolated token on first use, not a false Object.prototype collision`, () => {
    const input = buildInputWithReplayToken(reservedToken);
    const { result, state } = runReconciliation(input, null);

    assert.equal(
      result.status,
      'reconciled',
      `first use of replay token '${reservedToken}' must reconcile normally, not be mistaken for a pre-existing conflicting replay`,
    );
    assert.ok(
      !state.auditLog.some((entry) => entry.type === 'replay-conflict'),
      `no replay-conflict must be recorded on first use of replay token '${reservedToken}'`,
    );
  });

  test(`replay token '${reservedToken}' replays idempotently across repeated identical calls`, () => {
    const input = buildInputWithReplayToken(reservedToken);
    const first = runReconciliation(clone(input), null);
    const second = runReconciliation(clone(input), first.state);

    assert.equal(first.result.status, 'reconciled');
    assert.equal(second.result.status, 'reconciled');
    assert.deepEqual(second.result.archive, first.result.archive);
  });
}

test("using '__proto__' as a replay token must not pollute Object.prototype", () => {
  runReconciliation(buildInputWithReplayToken('__proto__'), null);
  const probe = {};
  assert.equal(probe.fingerprint, undefined, 'Object.prototype must not gain a fingerprint property from replay token handling');
  assert.equal(probe.result, undefined, 'Object.prototype must not gain a result property from replay token handling');
});

test('a missing replayToken causes fail-closed denial and is recorded in the audit log', () => {
  const input = buildInputWithReplayToken(undefined);
  const { result, state } = runReconciliation(input, null);

  assert.equal(result.status, 'denied', 'reconciliation must fail closed when replayToken is missing');
  assert.ok(state.auditLog.length >= 1, 'the missing-replayToken rejection must be recorded in the audit log');
});

test('an empty-string replayToken causes fail-closed denial and is recorded in the audit log', () => {
  const input = buildInputWithReplayToken('');
  const { result, state } = runReconciliation(input, null);

  assert.equal(result.status, 'denied', 'reconciliation must fail closed when replayToken is an empty string');
  assert.ok(state.auditLog.length >= 1, 'the empty-replayToken rejection must be recorded in the audit log');
});

test('a non-string replayToken causes fail-closed denial and is recorded in the audit log', () => {
  const input = buildInputWithReplayToken(42);
  const { result, state } = runReconciliation(input, null);

  assert.equal(result.status, 'denied', 'reconciliation must fail closed when replayToken is not a string');
  assert.ok(state.auditLog.length >= 1, 'the non-string replayToken rejection must be recorded in the audit log');
});

test("mutating the archive array returned in a result must not mutate the module's retained state", () => {
  const input = buildInputWithReplayToken('synthetic-replay-token-mut-001');
  const { result, state } = runReconciliation(input, null);
  const originalLength = state.archive.length;

  result.archive.push({ id: 'tampered-injected-row' });

  assert.equal(state.archive.length, originalLength, 'pushing onto the returned result.archive must not also grow the retained state.archive');
});

test("mutating the revalidationQueue array returned in a result must not mutate the module's retained state", () => {
  const input = clone({
    catalogue: CATALOGUE_V031,
    humanApproval: HUMAN_APPROVAL_MATCH,
    freezeSentinel: FREEZE_SENTINEL,
    cutoverTimestamp: CUTOVER_TS,
    rows: [ROW_RISKY_1],
    humanDataAuthorizations: [],
    replayToken: 'synthetic-replay-token-mut-002',
  });
  const { result, state } = runReconciliation(input, null);
  const originalLength = state.revalidationQueue.length;

  result.revalidationQueue.push({ id: 'tampered-injected-queue-entry' });

  assert.equal(
    state.revalidationQueue.length,
    originalLength,
    'pushing onto the returned result.revalidationQueue must not also grow the retained state.revalidationQueue',
  );
});

test('mutating a result returned from an idempotent replay must not corrupt the cached replay result for a later identical replay', () => {
  const input = baseReconciliationInput();
  const first = runReconciliation(clone(input), null);
  const second = runReconciliation(clone(input), first.state);
  assert.equal(second.result.status, 'reconciled');

  const originalArchiveLength = second.result.archive.length;
  second.result.archive.push({ id: 'tampered-cached-row' });

  const third = runReconciliation(clone(input), second.state);

  assert.equal(
    third.result.archive.length,
    originalArchiveLength,
    'a mutation applied to one idempotent replay result must not leak into a later idempotent replay of the same token',
  );
});

// --- Regression coverage for independent FINAL review findings ------------------------------
// All fixtures below remain synthetic. No DANE data, no network/DB/fs/env access, no real
// timestamps, no live cutover.

// Finding 1: catalogue approval must never bind on a mapHash comparison that is vacuously true
// because both sides are missing/null/empty/whitespace/non-string. Only a non-empty exact
// string hash match may bind approval.
const MAP_HASH_VACUOUS_CASES = [
  { label: 'both missing (property absent on both records)', omit: true },
  { label: 'both explicitly null', value: null },
  { label: 'both empty strings', value: '' },
  { label: 'both whitespace-only strings', value: '   ' },
  { label: 'both the non-string number 1111', value: 1111 },
  { label: 'both the non-string boolean true', value: true },
  { label: 'both a non-string object', value: { not: 'a-string' } },
];

for (const testCase of MAP_HASH_VACUOUS_CASES) {
  test(`catalogue approval is rejected when catalogue.mapHash and humanApproval.mapHash are ${testCase.label}`, () => {
    const catalogue = clone(CATALOGUE_V031);
    const humanApproval = clone(HUMAN_APPROVAL_MATCH);
    if (testCase.omit) {
      delete catalogue.mapHash;
      delete humanApproval.mapHash;
    } else {
      catalogue.mapHash = testCase.value;
      humanApproval.mapHash = testCase.value;
    }

    const result = validateCatalogueApproval(catalogue, humanApproval);
    assert.equal(
      result,
      false,
      `catalogue approval must never bind when both mapHash values are ${testCase.label}; only a non-empty exact string match may authorize`,
    );
  });
}

test('catalogue approval still succeeds when both sides carry the same genuine non-empty string hash', () => {
  const result = validateCatalogueApproval(clone(CATALOGUE_V031), clone(HUMAN_APPROVAL_MATCH));
  assert.equal(result, true, 'a real non-empty exact hash match must continue to authorize');
});

// Finding 2: risk handling must fail closed for any missing/null/NaN/Infinity/non-finite/
// non-number riskScore, rather than silently treating it as low risk.
const ROW_RISK_BASE = Object.freeze({ id: 'synthetic-row-risk-fail-closed', taxonomy: ['TAXO-C3'] });

const RISK_FAIL_CLOSED_CASES = [
  { label: 'missing riskScore (property absent)', omit: true },
  { label: 'null riskScore', riskScore: null },
  { label: 'NaN riskScore', riskScore: NaN },
  { label: 'Infinity riskScore', riskScore: Infinity },
  { label: 'negative Infinity riskScore', riskScore: -Infinity },
  { label: 'a numeric-looking string riskScore ("0.95")', riskScore: '0.95' },
  { label: 'a non-number boolean riskScore', riskScore: true },
  { label: 'a non-number object riskScore', riskScore: {} },
  { label: 'a non-number array riskScore', riskScore: [0.95] },
];

const buildRiskFailClosedRow = (testCase, idSuffix) => {
  const row = { ...ROW_RISK_BASE, id: `${ROW_RISK_BASE.id}-${idSuffix}` };
  if (!testCase.omit) {
    row.riskScore = testCase.riskScore;
  }
  return row;
};

for (const [index, testCase] of RISK_FAIL_CLOSED_CASES.entries()) {
  test(`computeSemanticFlags fails closed to isHighRisk=true when riskScore is ${testCase.label}`, () => {
    const row = buildRiskFailClosedRow(testCase, `flags-${index}`);
    const flags = computeSemanticFlags(row, CATALOGUE_V031);
    assert.equal(
      flags.isHighRisk,
      true,
      `an uncertain/invalid riskScore (${testCase.label}) must fail closed to high risk, never be silently treated as low risk`,
    );
  });

  test(`evaluateHabilitacion forces vigente_para_habilitacion=false and queuedForRevalidation=true when riskScore is ${testCase.label}`, () => {
    const row = buildRiskFailClosedRow(testCase, `habilitacion-${index}`);
    const result = evaluateHabilitacion(row, []);
    assert.equal(
      result.vigente_para_habilitacion,
      false,
      `an uncertain/invalid riskScore (${testCase.label}) must never be treated as safely habilitable`,
    );
    assert.equal(
      result.queuedForRevalidation,
      true,
      `an uncertain/invalid riskScore (${testCase.label}) must be queued for revalidation, not silently passed through`,
    );
  });
}

test('evaluateHabilitacion does not force false/queued when riskScore is a valid finite number below the 0.9 threshold', () => {
  const row = { id: 'synthetic-row-risk-valid-low', taxonomy: ['TAXO-C3'], riskScore: 0.10 };
  const result = evaluateHabilitacion(row, []);
  assert.equal(result.vigente_para_habilitacion, true, 'a genuinely low, valid finite riskScore must not be forced false');
  assert.equal(result.queuedForRevalidation, false, 'a genuinely low, valid finite riskScore must not be forced into the revalidation queue');
});

test('evaluateHabilitacion still forces false/queued at and above the existing 0.9 threshold for a valid finite riskScore', () => {
  const row = { id: 'synthetic-row-risk-valid-high', taxonomy: ['TAXO-C3'], riskScore: 0.9 };
  const result = evaluateHabilitacion(row, []);
  assert.equal(result.vigente_para_habilitacion, false, 'the existing >=0.9 threshold behavior must be preserved');
  assert.equal(result.queuedForRevalidation, true, 'the existing >=0.9 threshold behavior must be preserved');
});

test('evaluateHabilitacion still bypasses forced false/queued only via an exact human data authorization even when riskScore is invalid', () => {
  const authorizedRow = {
    id: 'synthetic-row-risk-invalid-but-authorized',
    taxonomy: ['TAXO-C3'],
    riskScore: NaN,
    dataHash: 'synthetic-row-datahash-invalid-risk-exact',
  };
  const matchingAuthorization = {
    rowId: 'synthetic-row-risk-invalid-but-authorized',
    dataHash: 'synthetic-row-datahash-invalid-risk-exact',
    approvedBy: 'synthetic-reviewer-004',
    approvedAt: 'synthetic-ts-0006',
  };
  const result = evaluateHabilitacion(authorizedRow, [matchingAuthorization]);
  assert.equal(
    result.vigente_para_habilitacion,
    true,
    'an exact human data authorization must still be able to override a fail-closed high-risk state, exactly as it does for numeric high risk',
  );
  assert.equal(result.queuedForRevalidation, false);
});

// --- Regression coverage for confirmed FINAL-review gaps -------------------------------------
// All fixtures below remain synthetic. No DANE data, no network/DB/fs/env access, no real
// timestamps, no live cutover.

// Gap 1: a row that is BOTH high-risk-without-exact-authorization AND taxonomy-conflicted must
// have both independent causes preserved in the durable revalidation queue output. The current
// single-reason ternary in runReconciliation picks only one reason and silently drops the other.
const buildMultiCauseInput = (replayToken) => clone({
  catalogue: CATALOGUE_V031,
  humanApproval: HUMAN_APPROVAL_MATCH,
  freezeSentinel: FREEZE_SENTINEL,
  cutoverTimestamp: CUTOVER_TS,
  rows: [ROW_RISKY_DOUBLE],
  humanDataAuthorizations: [],
  replayToken,
});

test('a row that is simultaneously high-risk-without-exact-authorization AND taxonomy-conflicted must preserve BOTH independent causes in the revalidation queue, never dropping one for the other', () => {
  const input = buildMultiCauseInput('synthetic-replay-token-multi-cause-001');
  const { result } = runReconciliation(input, null);

  const entriesForRow = result.revalidationQueue.filter((entry) => entry.rowId === ROW_RISKY_DOUBLE.id);
  const reasons = entriesForRow.map((entry) => entry.reason);

  assert.ok(
    reasons.includes('high-risk-no-authorization'),
    'the high-risk-without-exact-authorization cause must be preserved for a row that is also taxonomy-conflicted',
  );
  assert.ok(
    reasons.includes('taxonomy-conflict'),
    'the taxonomy-conflict cause must be preserved for a row that is also high-risk-without-exact-authorization',
  );
  assert.equal(
    entriesForRow.length,
    2,
    'both independent causes must each produce their own explicit queue entry, not collapse into a single entry that silently drops one cause',
  );
});

// Gap 2: archiveRow/runReconciliation retained state must be deep-isolated from later mutation
// of caller-owned nested row data (e.g. a taxonomy array). archiveRow currently does a shallow
// spread of the row, so state.archive entries keep sharing the caller's nested array/object
// references instead of snapshotting them at archive time.
test('archiveRow/runReconciliation retained state.archive must be deep-isolated from later mutation of the caller-owned row object', () => {
  const mutableRow = {
    id: 'synthetic-row-mutation-isolation-001',
    taxonomy: ['TAXO-C3'],
    riskScore: 0.10,
  };
  const input = {
    catalogue: CATALOGUE_V031,
    humanApproval: HUMAN_APPROVAL_MATCH,
    freezeSentinel: FREEZE_SENTINEL,
    cutoverTimestamp: CUTOVER_TS,
    rows: [mutableRow],
    humanDataAuthorizations: [],
    replayToken: 'synthetic-replay-token-mut-isolation-001',
  };

  const { state } = runReconciliation(input, null);
  const archivedTaxonomyBeforeMutation = clone(state.archive[0].taxonomy);

  mutableRow.taxonomy.push('TAXO-INJECTED-AFTER-CALL');

  assert.deepEqual(
    state.archive[0].taxonomy,
    archivedTaxonomyBeforeMutation,
    'mutating the caller-owned row object after reconciliation must not retroactively mutate the retained archive entry',
  );
});

test('cached replay evidence (state.replayLog result) must remain deep-isolated from later mutation of the caller-owned row object used to produce it', () => {
  const mutableRow = {
    id: 'synthetic-row-mutation-isolation-002',
    taxonomy: ['TAXO-C3'],
    riskScore: 0.10,
  };
  const firstInput = {
    catalogue: CATALOGUE_V031,
    humanApproval: HUMAN_APPROVAL_MATCH,
    freezeSentinel: FREEZE_SENTINEL,
    cutoverTimestamp: CUTOVER_TS,
    rows: [mutableRow],
    humanDataAuthorizations: [],
    replayToken: 'synthetic-replay-token-mut-isolation-002',
  };

  const first = runReconciliation(firstInput, null);
  const archivedTaxonomyBeforeMutation = clone(first.result.archive[0].taxonomy);

  mutableRow.taxonomy.push('TAXO-INJECTED-AFTER-CALL');

  const replayInput = {
    catalogue: CATALOGUE_V031,
    humanApproval: HUMAN_APPROVAL_MATCH,
    freezeSentinel: FREEZE_SENTINEL,
    cutoverTimestamp: CUTOVER_TS,
    rows: [{ id: mutableRow.id, taxonomy: ['TAXO-C3'], riskScore: 0.10 }],
    humanDataAuthorizations: [],
    replayToken: 'synthetic-replay-token-mut-isolation-002',
  };
  const second = runReconciliation(replayInput, first.state);

  assert.equal(second.result.status, 'reconciled', 'the identical-fingerprint replay must resolve idempotently from cache');
  assert.deepEqual(
    second.result.archive[0].taxonomy,
    archivedTaxonomyBeforeMutation,
    'a mutation applied to the original row object after the first call must not leak into cached replay evidence for a later identical replay',
  );
});
