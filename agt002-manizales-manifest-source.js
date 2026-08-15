import { readFileSync } from 'node:fs';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
  validateAgt002ManizalesIntegralManifest,
} from './agt002-manizales-integral-manifest.js';

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

export function selectAgt002ManizalesManifestSource({ integralContractV3, opportunityId, process }) {
  if (integralContractV3 !== true) return null;
  if (opportunityId !== AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID
    || process !== AGT002_INTEGRAL_MANIFEST_PROCESO) {
    const error = new Error('AGT-002 V3 integral está habilitado únicamente para el piloto Manizales SA-24-2026.');
    error.code = 'AGT002_MANIZALES_PILOT_SCOPE_MISMATCH';
    throw error;
  }
  return checkedInManifest;
}

export const AGT002_MANIZALES_CHECKED_IN_MANIFEST = checkedInManifest;
