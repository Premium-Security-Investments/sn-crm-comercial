// AGT-002 process onboarding gate (Phase 9).
//
// The fail-closed rail that decides whether a tender process may be enabled for the V3 integral
// contract. The default answer is REJECTED. A process is enabled only when ALL of the following
// hold on its process package (agt002-process-package.js):
//
//   1. human_approval.approved === true            — an explicit human sign-off,
//   2. every REQUIRED onboarding checklist item is present and passed === true,
//   3. enablement.explicitly_enabled === true AND the proceso is present in the caller-supplied
//      explicit allowlist (a server-owned constant, never a request/model field).
//
// Any missing precondition — or a malformed package — yields `enabled: false` with named
// reasons; it never silently enables. This module is pure: no I/O, clock, network or DB.

import { validateAgt002ProcessPackage } from './agt002-process-package.js';

export const AGT002_PROCESS_ONBOARDING_REJECTED_CODE = 'AGT002_PROCESS_ONBOARDING_REJECTED';

// The required onboarding checklist. Every id here must be present and passed for the gate to
// open. Adding an id here strictly tightens the gate (older packages missing it fail closed).
export const AGT002_PROCESS_ONBOARDING_CHECKLIST_IDS = Object.freeze([
  'manifest_validated',
  'manifest_scope_server_owned',
  'human_review_policy_ack',
  'canary_preflight_reviewed',
]);

export function evaluateAgt002ProcessOnboardingGate(pkg, { enabledProcesses } = {}) {
  let normalized;
  try {
    normalized = validateAgt002ProcessPackage(pkg);
  } catch {
    // A package whose shape we cannot even validate is never enabled.
    return Object.freeze({ enabled: false, reasons: Object.freeze(['invalid_package']) });
  }

  const reasons = [];

  if (normalized.human_approval.approved !== true) {
    reasons.push('human_approval_missing');
  }

  const passedById = new Map(normalized.onboarding_gate.checklist.map(item => [item.id, item.passed === true]));
  const checklistComplete = AGT002_PROCESS_ONBOARDING_CHECKLIST_IDS.every(id => passedById.get(id) === true);
  if (!checklistComplete) {
    reasons.push('onboarding_checklist_incomplete');
  }

  if (normalized.enablement.explicitly_enabled !== true) {
    reasons.push('not_explicitly_enabled');
  }

  if (!Array.isArray(enabledProcesses) || !enabledProcesses.includes(normalized.proceso)) {
    reasons.push('process_not_in_explicit_allowlist');
  }

  return Object.freeze({ enabled: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function assertAgt002ProcessEnabled(pkg, options = {}) {
  const result = evaluateAgt002ProcessOnboardingGate(pkg, options);
  if (!result.enabled) {
    const error = new Error(
      `AGT-002 onboarding gate: proceso rechazado (fail-closed). Razones: ${result.reasons.join(', ')}.`,
    );
    error.code = AGT002_PROCESS_ONBOARDING_REJECTED_CODE;
    error.reasons = result.reasons;
    throw error;
  }
  return result;
}
