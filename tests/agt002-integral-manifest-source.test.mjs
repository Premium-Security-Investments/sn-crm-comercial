import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  createAgt002IntegralManifestRegistry,
  AGT002_MANIFEST_SOURCE_NOT_REGISTERED_CODE,
} from '../agt002-integral-manifest-source.js';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
} from '../agt002-manizales-integral-manifest.js';
import {
  AGT002_MANIZALES_CHECKED_IN_MANIFEST,
  selectAgt002ManizalesManifestSource,
  AGT002_MANIZALES_PROCESS_PACKAGE,
  AGT002_MANIZALES_INTEGRAL_MANIFEST_REGISTRY,
} from '../agt002-manizales-manifest-source.js';

// Phase 9 (T3): a generic manifest registry keyed by (opportunity_id, proceso). It returns null
// when the V3 flag is off, returns the frozen validated manifest for a registered + gate-passed
// process, and throws a closed coded error for any unregistered key. Manizales is the ONLY
// registered process and its selector is a compatible delegator over this registry. A process
// whose package is not human-approved / not gate-passed / not explicitly enabled CANNOT be
// registered at all (fail closed at construction). Nothing here touches production/network/DB.

const MANIZALES_MANIFEST_SOURCE = JSON.parse(readFileSync(
  new URL('../data/agt002/manizales-sa-24-2026.integral-manifest.v1.json', import.meta.url), 'utf8',
));

function manizalesPackage(overrides = {}) {
  return { ...structuredClone(AGT002_MANIZALES_PROCESS_PACKAGE), ...overrides };
}

// -----------------------------------------------------------------------------
// Generic registry: registered Manizales resolves; wrong keys fail closed; flag off => null.
// -----------------------------------------------------------------------------
{
  const registry = createAgt002IntegralManifestRegistry({
    enabledProcesses: [AGT002_INTEGRAL_MANIFEST_PROCESO],
    registrations: [{
      opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
      proceso: AGT002_INTEGRAL_MANIFEST_PROCESO,
      manifest: AGT002_MANIZALES_CHECKED_IN_MANIFEST,
      package: manizalesPackage(),
    }],
  });

  assert.deepEqual([...registry.registeredProcesses], [
    `${AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID}::${AGT002_INTEGRAL_MANIFEST_PROCESO}`,
  ]);

  // Flag off => inert null regardless of key.
  assert.equal(registry.select({ integralContractV3: false, opportunityId: 'x', process: 'y' }), null);

  // Exact pilot => the frozen manifest.
  assert.equal(
    registry.select({ integralContractV3: true, opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID, process: AGT002_INTEGRAL_MANIFEST_PROCESO }),
    AGT002_MANIZALES_CHECKED_IN_MANIFEST,
  );

  // Any unregistered (opportunity, proceso) => closed coded error, never a fallback.
  for (const [opportunityId, process] of [
    ['00000000-0000-4000-8000-000000000000', AGT002_INTEGRAL_MANIFEST_PROCESO],
    [AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID, 'SA-99-2099'],
  ]) {
    assert.throws(
      () => registry.select({ integralContractV3: true, opportunityId, process }),
      (error) => error?.code === AGT002_MANIFEST_SOURCE_NOT_REGISTERED_CODE,
    );
  }
}

// -----------------------------------------------------------------------------
// Fail-closed at construction: a package that is unapproved / not enabled / not in the explicit
// allowlist cannot be registered — the registry refuses to build.
// -----------------------------------------------------------------------------
{
  const baseRegistration = {
    opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
    proceso: AGT002_INTEGRAL_MANIFEST_PROCESO,
    manifest: AGT002_MANIZALES_CHECKED_IN_MANIFEST,
  };

  // Not in the explicit allowlist.
  assert.throws(() => createAgt002IntegralManifestRegistry({
    enabledProcesses: [], registrations: [{ ...baseRegistration, package: manizalesPackage() }],
  }), /onboarding|rejected|gate/i);

  // Unapproved package.
  assert.throws(() => createAgt002IntegralManifestRegistry({
    enabledProcesses: [AGT002_INTEGRAL_MANIFEST_PROCESO],
    registrations: [{ ...baseRegistration, package: manizalesPackage({ human_approval: { required: true, approved: false, approver: null, approved_at: null } }) }],
  }), /onboarding|rejected|approval/i);

  // Package identity that disagrees with the registration key.
  assert.throws(() => createAgt002IntegralManifestRegistry({
    enabledProcesses: [AGT002_INTEGRAL_MANIFEST_PROCESO],
    registrations: [{ ...baseRegistration, proceso: 'SA-99-2099', package: manizalesPackage() }],
  }), /proceso|identity|coincid/i);
}

// -----------------------------------------------------------------------------
// Manizales delegator preserves the exact legacy contract (byte-compatible with the old source).
// -----------------------------------------------------------------------------
{
  assert.equal(selectAgt002ManizalesManifestSource({ integralContractV3: false, opportunityId: 'other', process: 'OTHER' }), null);
  assert.equal(
    selectAgt002ManizalesManifestSource({ integralContractV3: true, opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID, process: AGT002_INTEGRAL_MANIFEST_PROCESO }),
    AGT002_MANIZALES_CHECKED_IN_MANIFEST,
  );
  assert.throws(
    () => selectAgt002ManizalesManifestSource({ integralContractV3: true, opportunityId: '00000000-0000-4000-8000-000000000000', process: AGT002_INTEGRAL_MANIFEST_PROCESO }),
    (error) => error?.code === 'AGT002_MANIZALES_PILOT_SCOPE_MISMATCH',
  );
  assert.throws(
    () => selectAgt002ManizalesManifestSource({ integralContractV3: true, opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID, process: 'SA-99-2099' }),
    (error) => error?.code === 'AGT002_MANIZALES_PILOT_SCOPE_MISMATCH',
  );

  // The Manizales module ships a real, registered registry with exactly the pilot process.
  assert.deepEqual([...AGT002_MANIZALES_INTEGRAL_MANIFEST_REGISTRY.registeredProcesses], [
    `${AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID}::${AGT002_INTEGRAL_MANIFEST_PROCESO}`,
  ]);
  assert.equal(MANIZALES_MANIFEST_SOURCE.opportunity_id, AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID);
}

console.log('agt002-integral-manifest-source: OK');
