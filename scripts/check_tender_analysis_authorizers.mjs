import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireAction, ACTIONS } from '../access-control.js';

/** Mechanical eligibility check for who can authorize the durable pipeline's
 * automatic analysis step: reuses the same custody gate as the endpoint
 * (Task 3.4, ACTIONS.AI_ANALYSIS_RUN -> canTenderCustodyAction) instead of
 * re-deriving role/permission logic here. No names are ever hardcoded. */
function isCustodyEligible(profile) {
  try {
    requireAction(profile, ACTIONS.AI_ANALYSIS_RUN);
    return true;
  } catch {
    return false;
  }
}

export function findCustodyEligibleProfiles(profiles, isEligible = isCustodyEligible) {
  return (profiles || []).filter(isEligible).map(profile => profile.id);
}

export function diffAuthorizers(eligibleIds, expectedIds) {
  const eligible = new Set(eligibleIds);
  const expected = new Set(expectedIds);
  return {
    extra: [...eligible].filter(id => !expected.has(id)),
    missing: [...expected].filter(id => !eligible.has(id)),
    ok: eligible.size === expected.size && [...expected].every(id => eligible.has(id)),
  };
}

export function main(profilesJsonPath, expectedIdsCsv) {
  if (!profilesJsonPath || !expectedIdsCsv) {
    console.error('Uso: node scripts/check_tender_analysis_authorizers.mjs <perfiles.json> <id1,id2>');
    console.error('perfiles.json debe ser un export humano-generado de la tabla de perfiles reales (gate humano); este script no consulta Supabase.');
    process.exitCode = 2;
    return;
  }
  const profiles = JSON.parse(readFileSync(profilesJsonPath, 'utf8'));
  const expectedIds = expectedIdsCsv.split(',').map(id => id.trim()).filter(Boolean);
  const eligibleIds = findCustodyEligibleProfiles(profiles);
  const result = diffAuthorizers(eligibleIds, expectedIds);
  if (!result.ok) {
    console.error('TENDER_AUTHORIZERS_FAILED', result);
    process.exitCode = 1;
    return;
  }
  console.log('TENDER_AUTHORIZERS_OK', { eligibleIds });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2], process.argv[3]);
}
