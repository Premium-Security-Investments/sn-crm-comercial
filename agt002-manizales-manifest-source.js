import { readFileSync } from 'node:fs';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
  AGT002_INTEGRAL_MANIFEST_ARTIFACT_TYPE,
  AGT002_INTEGRAL_MANIFEST_CONTRACT_VERSION,
  validateAgt002ManizalesIntegralManifest,
} from './agt002-manizales-integral-manifest.js';
import {
  createAgt002IntegralManifestRegistry,
  AGT002_MANIFEST_SOURCE_NOT_REGISTERED_CODE,
} from './agt002-integral-manifest-source.js';
import { AGT002_PROCESS_ONBOARDING_CHECKLIST_IDS } from './agt002-process-onboarding-gate.js';
import { AGT002_PROCESS_PACKAGE_SCHEMA_VERSION } from './agt002-process-package.js';

const SOURCE_URL = new URL('./data/agt002/manizales-sa-24-2026.integral-manifest.v1.json', import.meta.url);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const checkedInManifest = deepFreeze(validateAgt002ManizalesIntegralManifest(
  JSON.parse(readFileSync(SOURCE_URL, 'utf8')),
));

if (checkedInManifest.opportunity_id !== AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID
  || checkedInManifest.proceso !== AGT002_INTEGRAL_MANIFEST_PROCESO) {
  throw new Error('El manifiesto integral empacado no corresponde al piloto Manizales SA-24-2026.');
}

// The Manizales process is the single human-approved, gate-passed, explicitly-enabled process.
// NOTE: `human_approval.approved: true` here records the governance decision to ENABLE the
// Manizales process for the V3 pilot — it is a separate fact from the manifest artifact's own
// `human_approved: false` (which marks the manifest CONTENT as a validated candidate still
// pending per-entry human validation). The gate reads this package; the manifest keeps
// abstaining per unit regardless.
export const AGT002_MANIZALES_PROCESS_PACKAGE = Object.freeze({
  schema_version: AGT002_PROCESS_PACKAGE_SCHEMA_VERSION,
  opportunity_id: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  proceso: AGT002_INTEGRAL_MANIFEST_PROCESO,
  manifest_ref: Object.freeze({
    artifact_type: AGT002_INTEGRAL_MANIFEST_ARTIFACT_TYPE,
    contract_version: AGT002_INTEGRAL_MANIFEST_CONTRACT_VERSION,
    path: 'data/agt002/manizales-sa-24-2026.integral-manifest.v1.json',
  }),
  human_approval: Object.freeze({
    required: true,
    approved: true,
    approver: 'Juan Botero',
    // Day-level precision is intentional: the production approval is documented for this date;
    // no unsupported hour/minute is invented.
    approved_at: '2026-08-17',
  }),
  onboarding_gate: Object.freeze({
    checklist: Object.freeze(AGT002_PROCESS_ONBOARDING_CHECKLIST_IDS.map(id => Object.freeze({ id, passed: true }))),
  }),
  enablement: Object.freeze({
    flag: 'AGT002_INTEGRAL_CONTRACT_V3',
    explicitly_enabled: true,
  }),
});

// Server-owned explicit allowlist. Enabling a new process requires adding it here (a code
// change), on top of an approved package and a complete gate. Never a request/model field.
export const AGT002_MANIZALES_ENABLED_PROCESSES = Object.freeze([AGT002_INTEGRAL_MANIFEST_PROCESO]);

export const AGT002_MANIZALES_INTEGRAL_MANIFEST_REGISTRY = createAgt002IntegralManifestRegistry({
  enabledProcesses: AGT002_MANIZALES_ENABLED_PROCESSES,
  registrations: [{
    opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
    proceso: AGT002_INTEGRAL_MANIFEST_PROCESO,
    manifest: checkedInManifest,
    package: AGT002_MANIZALES_PROCESS_PACKAGE,
  }],
});

export function selectAgt002ManizalesManifestSource({ integralContractV3, opportunityId, process }) {
  if (integralContractV3 !== true) return null;
  try {
    return AGT002_MANIZALES_INTEGRAL_MANIFEST_REGISTRY.select({ integralContractV3, opportunityId, process });
  } catch (error) {
    // A fully unrelated (opportunity_id, proceso) never reaches this catch — the registry
    // returns null for it, and the single canonical analysis continues without pilot context.
    // Only a partial overlap (one field matches Manizales, the other doesn't) throws here; it
    // surfaces as the Manizales pilot-scope-mismatch code/message the runtime and tests pin.
    if (error?.code === AGT002_MANIFEST_SOURCE_NOT_REGISTERED_CODE) {
      const scopeError = new Error('AGT-002 V3 integral está habilitado únicamente para el piloto Manizales SA-24-2026.');
      scopeError.code = 'AGT002_MANIZALES_PILOT_SCOPE_MISMATCH';
      throw scopeError;
    }
    throw error;
  }
}

export const AGT002_MANIZALES_CHECKED_IN_MANIFEST = checkedInManifest;
