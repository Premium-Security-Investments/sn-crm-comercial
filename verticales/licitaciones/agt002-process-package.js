// AGT-002 process package descriptor (Phase 9).
//
// A *process package* is the closed, human-authored descriptor that binds one tender process
// — keyed by (opportunity_id, proceso) — to its checked-in integral manifest and records the
// governance facts the fail-closed registry keys off: an explicit human approval, an onboarding
// checklist, and an explicit server-owned enablement flag. The package GRANTS nothing on its
// own; it is only a descriptor. Whether a process is actually enabled is decided by the
// onboarding gate (see agt002-process-onboarding-gate.js) over these fields. Validation here is
// about SHAPE only: a candidate (unapproved / not-enabled) package is still a valid descriptor.
//
// This module is pure: no I/O, no clock, no network, no DB.

export const AGT002_PROCESS_PACKAGE_SCHEMA_VERSION = 'agt002-process-package@1';
export const AGT002_PROCESS_PACKAGE_INVALID_CODE = 'AGT002_PROCESS_PACKAGE_INVALID';

export const AGT002_PROCESS_PACKAGE_KEYS = Object.freeze([
  'schema_version',
  'opportunity_id',
  'proceso',
  'manifest_ref',
  'human_approval',
  'onboarding_gate',
  'enablement',
]);

const MANIFEST_REF_KEYS = ['artifact_type', 'contract_version', 'path'];
const HUMAN_APPROVAL_KEYS = ['required', 'approved', 'approver', 'approved_at'];
const ENABLEMENT_KEYS = ['flag', 'explicitly_enabled'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) {
  const error = new Error(`AGT-002 process package (paquete): ${message}`);
  error.code = AGT002_PROCESS_PACKAGE_INVALID_CODE;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(object, keys, label) {
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: forma no cerrada; se esperaban exactamente [${expected.join(', ')}].`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${label} debe ser una cadena no vacía.`);
}

function assertStringOrNull(value, label) {
  if (value !== null && typeof value !== 'string') fail(`${label} debe ser una cadena o null.`);
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} debe ser booleano.`);
}

export function validateAgt002ProcessPackage(pkg) {
  if (!isPlainObject(pkg)) fail('el paquete debe ser un objeto.');
  assertExactKeys(pkg, AGT002_PROCESS_PACKAGE_KEYS, 'process package');

  if (pkg.schema_version !== AGT002_PROCESS_PACKAGE_SCHEMA_VERSION) {
    fail(`schema_version inesperado; se esperaba ${AGT002_PROCESS_PACKAGE_SCHEMA_VERSION}.`);
  }
  if (typeof pkg.opportunity_id !== 'string' || !UUID_RE.test(pkg.opportunity_id)) {
    fail('opportunity_id debe ser un UUID.');
  }
  assertNonEmptyString(pkg.proceso, 'proceso');

  // manifest_ref — closed reference to the checked-in manifest artifact.
  if (!isPlainObject(pkg.manifest_ref)) fail('manifest_ref debe ser un objeto.');
  assertExactKeys(pkg.manifest_ref, MANIFEST_REF_KEYS, 'manifest_ref');
  assertNonEmptyString(pkg.manifest_ref.artifact_type, 'manifest_ref.artifact_type');
  assertNonEmptyString(pkg.manifest_ref.contract_version, 'manifest_ref.contract_version');
  assertNonEmptyString(pkg.manifest_ref.path, 'manifest_ref.path');

  // human_approval — the explicit human sign-off record. required must be literally true.
  if (!isPlainObject(pkg.human_approval)) fail('human_approval debe ser un objeto.');
  assertExactKeys(pkg.human_approval, HUMAN_APPROVAL_KEYS, 'human_approval');
  if (pkg.human_approval.required !== true) fail('human_approval.required debe ser true.');
  assertBoolean(pkg.human_approval.approved, 'human_approval.approved');
  assertStringOrNull(pkg.human_approval.approver, 'human_approval.approver');
  assertStringOrNull(pkg.human_approval.approved_at, 'human_approval.approved_at');
  if (pkg.human_approval.approved === true) {
    assertNonEmptyString(pkg.human_approval.approver, 'human_approval.approver (aprobado)');
    assertNonEmptyString(pkg.human_approval.approved_at, 'human_approval.approved_at (aprobado)');
  }

  // onboarding_gate — the checklist the gate evaluates. Closed item shape.
  if (!isPlainObject(pkg.onboarding_gate)) fail('onboarding_gate debe ser un objeto.');
  assertExactKeys(pkg.onboarding_gate, ['checklist'], 'onboarding_gate');
  if (!Array.isArray(pkg.onboarding_gate.checklist)) fail('onboarding_gate.checklist debe ser un arreglo.');
  const seenIds = new Set();
  for (const item of pkg.onboarding_gate.checklist) {
    if (!isPlainObject(item)) fail('onboarding_gate.checklist: cada ítem debe ser un objeto.');
    assertExactKeys(item, ['id', 'passed'], 'onboarding_gate.checklist item');
    assertNonEmptyString(item.id, 'onboarding_gate.checklist item.id');
    assertBoolean(item.passed, 'onboarding_gate.checklist item.passed');
    if (seenIds.has(item.id)) fail(`onboarding_gate.checklist: id de ítem duplicado ${item.id}.`);
    seenIds.add(item.id);
  }

  // enablement — the explicit server-owned flag record.
  if (!isPlainObject(pkg.enablement)) fail('enablement debe ser un objeto.');
  assertExactKeys(pkg.enablement, ENABLEMENT_KEYS, 'enablement');
  assertNonEmptyString(pkg.enablement.flag, 'enablement.flag');
  assertBoolean(pkg.enablement.explicitly_enabled, 'enablement.explicitly_enabled');

  return Object.freeze({
    schema_version: pkg.schema_version,
    opportunity_id: pkg.opportunity_id,
    proceso: pkg.proceso,
    manifest_ref: Object.freeze({
      artifact_type: pkg.manifest_ref.artifact_type,
      contract_version: pkg.manifest_ref.contract_version,
      path: pkg.manifest_ref.path,
    }),
    human_approval: Object.freeze({
      required: pkg.human_approval.required,
      approved: pkg.human_approval.approved,
      approver: pkg.human_approval.approver,
      approved_at: pkg.human_approval.approved_at,
    }),
    onboarding_gate: Object.freeze({
      checklist: Object.freeze(pkg.onboarding_gate.checklist.map(item => Object.freeze({ id: item.id, passed: item.passed }))),
    }),
    enablement: Object.freeze({
      flag: pkg.enablement.flag,
      explicitly_enabled: pkg.enablement.explicitly_enabled,
    }),
  });
}
