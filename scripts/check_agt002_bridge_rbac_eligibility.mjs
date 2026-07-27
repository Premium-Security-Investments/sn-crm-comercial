import { readFileSync } from 'node:fs';
import { diffEligibility, findEligibleProfiles } from '../agt002-hetzner-bridge-rbac-audit.js';

function main() {
  const profilesPath = process.argv[2];
  const expectedIdsArg = process.argv[3];
  if (!profilesPath || !expectedIdsArg) {
    console.error('Uso: node scripts/check_agt002_bridge_rbac_eligibility.mjs <perfiles.json> <id1,id2>');
    console.error('perfiles.json debe ser un export humano-generado de la tabla de perfiles reales (Fase 3, gate humano); este script no consulta Supabase.');
    process.exit(2);
  }
  const profiles = JSON.parse(readFileSync(profilesPath, 'utf8'));
  const expectedIds = expectedIdsArg.split(',').map((id) => id.trim()).filter(Boolean);
  const eligibleIds = findEligibleProfiles(profiles);
  const result = diffEligibility(eligibleIds, expectedIds);
  if (!result.ok) {
    console.error('AGT002_BRIDGE_RBAC_AUDIT_FAILED', result);
    process.exit(1);
  }
  console.log('AGT002_BRIDGE_RBAC_AUDIT_OK', { eligibleIds });
}

main();
