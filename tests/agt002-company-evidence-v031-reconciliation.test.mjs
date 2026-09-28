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
