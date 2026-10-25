// AGT-002 generic integral-manifest registry (Phase 9).
//
// A fail-closed registry of integral manifests keyed by (opportunity_id, proceso). It exists so
// that adding a future tender process is a governed, explicit act — never a copy of Manizales.
// A process can only be REGISTERED when its package passes the onboarding gate (human-approved +
// checklist complete + explicitly enabled in the caller-supplied allowlist); a registration whose
// package fails the gate, or whose package identity disagrees with the (opportunity_id, proceso)
// key or the manifest identity, makes the whole registry refuse to build. At selection time the
// registry returns `null` when the V3 flag is off, the frozen validated manifest for a registered
// key, `null` for any (opportunity_id, proceso) pair that shares NEITHER field with a registration
// (out of scope for every registered manifest — the canonical analysis proceeds without
// pilot-specific context), and a closed coded error for a pair that shares ONE field with a
// registration but not the other — with no generic fallback, ever.
//
// Manizales is the ONLY initial registration and its own module (agt002-manizales-manifest-source.js)
// is a compatible delegator over an instance of this registry. This module is pure: no I/O, clock,
// network or DB — callers inject already-validated frozen manifests.

import { validateAgt002ProcessPackage } from './agt002-process-package.js';
import { assertAgt002ProcessEnabled } from './agt002-process-onboarding-gate.js';

export const AGT002_MANIFEST_SOURCE_NOT_REGISTERED_CODE = 'AGT002_PROCESS_NOT_REGISTERED';
export const AGT002_MANIFEST_SOURCE_REGISTRATION_INVALID_CODE = 'AGT002_MANIFEST_SOURCE_REGISTRATION_INVALID';

function processKey(opportunityId, proceso) {
  return `${opportunityId}::${proceso}`;
}

function failRegistration(message) {
  const error = new Error(`AGT-002 manifest registry: ${message}`);
  error.code = AGT002_MANIFEST_SOURCE_REGISTRATION_INVALID_CODE;
  throw error;
}

export function createAgt002IntegralManifestRegistry({ registrations, enabledProcesses } = {}) {
  if (!Array.isArray(registrations) || registrations.length === 0) {
    failRegistration('se requiere al menos una registración.');
  }
  if (!Array.isArray(enabledProcesses)) {
    failRegistration('enabledProcesses debe ser un arreglo explícito (allowlist server-owned).');
  }

  const byKey = new Map();

  for (const registration of registrations) {
    if (!registration || typeof registration !== 'object') failRegistration('registración inválida.');
    const { opportunityId, proceso, manifest, package: pkg } = registration;
    if (typeof opportunityId !== 'string' || opportunityId.length === 0) failRegistration('opportunityId de registración inválido.');
    if (typeof proceso !== 'string' || proceso.length === 0) failRegistration('proceso de registración inválido.');
    if (!manifest || typeof manifest !== 'object') failRegistration('manifest de registración inválido.');

    // 1. Package shape must be valid.
    const normalizedPackage = validateAgt002ProcessPackage(pkg);

    // 2. Onboarding gate must OPEN — this throws AGT002_PROCESS_ONBOARDING_REJECTED otherwise.
    assertAgt002ProcessEnabled(normalizedPackage, { enabledProcesses });

    // 3. Identity coherence: the package and the manifest must agree with the registration key.
    if (normalizedPackage.opportunity_id !== opportunityId || normalizedPackage.proceso !== proceso) {
      failRegistration('la identidad del paquete no coincide con la clave (opportunity_id, proceso).');
    }
    if (manifest.opportunity_id !== opportunityId || manifest.proceso !== proceso) {
      failRegistration('la identidad del manifiesto no coincide con la clave (opportunity_id, proceso).');
    }

    const key = processKey(opportunityId, proceso);
    if (byKey.has(key)) failRegistration(`registración duplicada para ${key}.`);
    byKey.set(key, { manifest, package: normalizedPackage, opportunityId, proceso });
  }

  const registeredProcesses = Object.freeze([...byKey.keys()]);

  function has(opportunityId, proceso) {
    return byKey.has(processKey(opportunityId, proceso));
  }

  function select({ integralContractV3, opportunityId, process } = {}) {
    if (integralContractV3 !== true) return null;
    const entry = byKey.get(processKey(opportunityId, process));
    if (entry) return entry.manifest;

    // Partial overlap with a registration (one field matches, the other doesn't) is a
    // data-inconsistency signal, not an unrelated tender — fail closed, never a fallback.
    const partiallyOverlaps = [...byKey.values()].some(
      registered => registered.opportunityId === opportunityId || registered.proceso === process,
    );
    if (partiallyOverlaps) {
      const error = new Error(
        'AGT-002 manifest registry: proceso no registrado; V3 integral está habilitado únicamente para procesos con paquete aprobado y gate completo.',
      );
      error.code = AGT002_MANIFEST_SOURCE_NOT_REGISTERED_CODE;
      throw error;
    }

    // Fully unrelated (opportunity_id, proceso): out of scope for every registered manifest.
    // There is a single canonical analysis for every tender — no manifest applying is not an
    // error, so the canonical analysis continues without pilot-specific context.
    return null;
  }

  return Object.freeze({ select, has, registeredProcesses });
}
