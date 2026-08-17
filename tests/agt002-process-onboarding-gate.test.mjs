import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  AGT002_PROCESS_ONBOARDING_CHECKLIST_IDS,
  evaluateAgt002ProcessOnboardingGate,
  assertAgt002ProcessEnabled,
} from '../agt002-process-onboarding-gate.js';

// Phase 9 (T3): the process-onboarding gate is the fail-closed rail that decides whether a
// tender process may be enabled for V3. Default is REJECTED. Enablement requires ALL of:
// (1) an explicit human approval on the package, (2) every required onboarding checklist item
// passed, and (3) an explicit server-owned enablement flag (explicitly_enabled) with the
// proceso present in the explicit allowlist. Nothing here touches production, network or DB.

function approvedPackage(overrides = {}) {
  return {
    schema_version: 'agt002-process-package@1',
    opportunity_id: '54190e51-15fb-46af-b0aa-8f13461a3110',
    proceso: 'SA-24-2026',
    manifest_ref: {
      artifact_type: 'agt002_manizales_integral_manifest',
      contract_version: 'agt002-manizales-integral-manifest@1',
      path: 'data/agt002/manizales-sa-24-2026.integral-manifest.v1.json',
    },
    human_approval: { required: true, approved: true, approver: 'jmb@valienta.com', approved_at: '2026-08-15T00:00:00.000Z' },
    onboarding_gate: { checklist: AGT002_PROCESS_ONBOARDING_CHECKLIST_IDS.map(id => ({ id, passed: true })) },
    enablement: { flag: 'AGT002_INTEGRAL_CONTRACT_V3', explicitly_enabled: true },
    ...overrides,
  };
}

const ENABLED = { enabledProcesses: ['SA-24-2026'] };

// -----------------------------------------------------------------------------
// Default fail-closed: no options at all => rejected with every reason.
// -----------------------------------------------------------------------------
{
  const result = evaluateAgt002ProcessOnboardingGate(approvedPackage());
  assert.equal(result.enabled, false, 'default (no enabledProcesses allowlist) must be rejected');
  assert.ok(result.reasons.includes('process_not_in_explicit_allowlist'));
}

// -----------------------------------------------------------------------------
// Fully-satisfied package + explicit allowlist => enabled.
// -----------------------------------------------------------------------------
{
  const result = evaluateAgt002ProcessOnboardingGate(approvedPackage(), ENABLED);
  assert.equal(result.enabled, true, 'human_approved + gate passed + explicit flag => enabled');
  assert.deepEqual(result.reasons, []);
  // assert form does not throw and returns the evaluation.
  const asserted = assertAgt002ProcessEnabled(approvedPackage(), ENABLED);
  assert.equal(asserted.enabled, true);
}

// -----------------------------------------------------------------------------
// Each missing precondition, in isolation, flips to rejected with a named reason.
// -----------------------------------------------------------------------------
{
  const noApproval = evaluateAgt002ProcessOnboardingGate(
    approvedPackage({ human_approval: { required: true, approved: false, approver: null, approved_at: null } }),
    ENABLED,
  );
  assert.equal(noApproval.enabled, false);
  assert.ok(noApproval.reasons.includes('human_approval_missing'), 'unapproved package is rejected');

  const incompleteChecklist = evaluateAgt002ProcessOnboardingGate(
    approvedPackage({ onboarding_gate: { checklist: [{ id: AGT002_PROCESS_ONBOARDING_CHECKLIST_IDS[0], passed: false }] } }),
    ENABLED,
  );
  assert.equal(incompleteChecklist.enabled, false);
  assert.ok(incompleteChecklist.reasons.includes('onboarding_checklist_incomplete'), 'a failed/absent checklist item rejects');

  const notFlagged = evaluateAgt002ProcessOnboardingGate(
    approvedPackage({ enablement: { flag: 'AGT002_INTEGRAL_CONTRACT_V3', explicitly_enabled: false } }),
    ENABLED,
  );
  assert.equal(notFlagged.enabled, false);
  assert.ok(notFlagged.reasons.includes('not_explicitly_enabled'), 'explicitly_enabled=false rejects');

  const notInAllowlist = evaluateAgt002ProcessOnboardingGate(approvedPackage(), { enabledProcesses: ['OTHER-1'] });
  assert.equal(notInAllowlist.enabled, false);
  assert.ok(notInAllowlist.reasons.includes('process_not_in_explicit_allowlist'), 'proceso absent from allowlist rejects');
}

// -----------------------------------------------------------------------------
// assert form throws a closed, coded error carrying the reasons.
// -----------------------------------------------------------------------------
{
  assert.throws(
    () => assertAgt002ProcessEnabled(approvedPackage({ human_approval: { required: true, approved: false, approver: null, approved_at: null } }), ENABLED),
    (error) => error?.code === 'AGT002_PROCESS_ONBOARDING_REJECTED' && Array.isArray(error?.reasons) && error.reasons.includes('human_approval_missing'),
  );
  // A malformed package is rejected, never silently enabled.
  const malformed = evaluateAgt002ProcessOnboardingGate({ not: 'a package' }, ENABLED);
  assert.equal(malformed.enabled, false);
  assert.ok(malformed.reasons.includes('invalid_package'));
}

// -----------------------------------------------------------------------------
// The checked-in template must be REJECTED by default (proves the rail is fail-closed
// for any brand-new process copied from the template without human sign-off).
// -----------------------------------------------------------------------------
{
  const template = JSON.parse(readFileSync(
    new URL('../data/agt002/processes/_template/process.package.template.json', import.meta.url), 'utf8',
  ));
  const result = evaluateAgt002ProcessOnboardingGate(template, { enabledProcesses: [template.proceso] });
  assert.equal(result.enabled, false, 'the template process package must default to rejected');
  assert.ok(result.reasons.includes('human_approval_missing'));
  assert.ok(result.reasons.includes('not_explicitly_enabled'));
}

console.log('agt002-process-onboarding-gate: OK');
