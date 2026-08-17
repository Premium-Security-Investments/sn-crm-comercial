import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  AGT002_PROCESS_PACKAGE_SCHEMA_VERSION,
  AGT002_PROCESS_PACKAGE_KEYS,
  validateAgt002ProcessPackage,
} from '../agt002-process-package.js';

// Phase 9 (T3): the process package is the closed, human-authored descriptor that binds a
// tender process (opportunity_id + proceso) to its checked-in manifest and records the human
// approval + onboarding-gate + explicit-enablement facts the fail-closed registry keys off.
// It is a *descriptor* only — it grants nothing on its own; enablement is decided by the gate.
// Nothing here touches production, network or DB.

function validPackage(overrides = {}) {
  return {
    schema_version: AGT002_PROCESS_PACKAGE_SCHEMA_VERSION,
    opportunity_id: '54190e51-15fb-46af-b0aa-8f13461a3110',
    proceso: 'SA-24-2026',
    manifest_ref: {
      artifact_type: 'agt002_manizales_integral_manifest',
      contract_version: 'agt002-manizales-integral-manifest@1',
      path: 'data/agt002/manizales-sa-24-2026.integral-manifest.v1.json',
    },
    human_approval: { required: true, approved: true, approver: 'jmb@valienta.com', approved_at: '2026-08-15T00:00:00.000Z' },
    onboarding_gate: { checklist: [{ id: 'manifest_validated', passed: true }] },
    enablement: { flag: 'AGT002_INTEGRAL_CONTRACT_V3', explicitly_enabled: true },
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// A well-formed package validates and returns a frozen normalized copy (never the input).
// -----------------------------------------------------------------------------
{
  const input = validPackage();
  const normalized = validateAgt002ProcessPackage(input);
  assert.notEqual(normalized, input, 'must return a copy, not the caller object');
  assert.ok(Object.isFrozen(normalized), 'the normalized package must be frozen');
  assert.equal(normalized.opportunity_id, input.opportunity_id);
  assert.equal(normalized.proceso, input.proceso);
  assert.deepEqual(Object.keys(normalized).sort(), [...AGT002_PROCESS_PACKAGE_KEYS].sort());
}

// -----------------------------------------------------------------------------
// Closed shape: unknown top-level keys and missing required keys fail closed.
// -----------------------------------------------------------------------------
{
  assert.throws(() => validateAgt002ProcessPackage({ ...validPackage(), surprise: true }), /process package|paquete/i);
  const { proceso, ...withoutProceso } = validPackage();
  assert.throws(() => validateAgt002ProcessPackage(withoutProceso), /proceso/i);
  assert.throws(() => validateAgt002ProcessPackage(null), /process package|paquete/i);
  assert.throws(() => validateAgt002ProcessPackage({ ...validPackage(), schema_version: 'wrong@9' }), /schema_version/i);
}

// -----------------------------------------------------------------------------
// Type/shape guards on nested descriptor fields.
// -----------------------------------------------------------------------------
{
  assert.throws(() => validateAgt002ProcessPackage(validPackage({ opportunity_id: 'not-a-uuid' })), /opportunity_id/i);
  assert.throws(() => validateAgt002ProcessPackage(validPackage({ manifest_ref: { path: 'x' } })), /manifest_ref/i);
  assert.throws(() => validateAgt002ProcessPackage(validPackage({ human_approval: { required: true } })), /human_approval/i);
  assert.throws(() => validateAgt002ProcessPackage(validPackage({ onboarding_gate: { checklist: 'no' } })), /onboarding_gate|checklist/i);
  assert.throws(() => validateAgt002ProcessPackage(validPackage({ enablement: { flag: 'X' } })), /enablement/i);
}

// -----------------------------------------------------------------------------
// A candidate (unapproved / not-enabled) package is STILL a valid descriptor — validity is
// about shape, not about being granted. The template file must validate as a descriptor.
// -----------------------------------------------------------------------------
{
  const candidate = validateAgt002ProcessPackage(validPackage({
    human_approval: { required: true, approved: false, approver: null, approved_at: null },
    enablement: { flag: 'AGT002_INTEGRAL_CONTRACT_V3', explicitly_enabled: false },
  }));
  assert.equal(candidate.human_approval.approved, false);
  assert.equal(candidate.enablement.explicitly_enabled, false);

  const template = JSON.parse(readFileSync(
    new URL('../data/agt002/processes/_template/process.package.template.json', import.meta.url), 'utf8',
  ));
  const normalizedTemplate = validateAgt002ProcessPackage(template);
  assert.equal(normalizedTemplate.human_approval.approved, false, 'template default must be unapproved');
  assert.equal(normalizedTemplate.enablement.explicitly_enabled, false, 'template default must be not explicitly enabled');
}

console.log('agt002-process-package: OK');
