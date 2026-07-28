import { strict as assert } from 'node:assert';
import { diffAuthorizers, findCustodyEligibleProfiles } from '../scripts/check_tender_analysis_authorizers.mjs';

function humanProfile(id, permissions) {
  return { id, identity_type: 'human', active: true, role: 'comercial', permissions };
}

function run() {
  const custodyA = humanProfile('id-1', ['licitaciones', 'licitaciones_custodia']);
  const custodyB = humanProfile('id-2', ['licitaciones', 'licitaciones_custodia']);
  const noCustody = humanProfile('id-3', ['licitaciones']);
  const profiles = [custodyA, custodyB, noCustody];

  const eligible = findCustodyEligibleProfiles(profiles);
  assert.deepEqual(eligible.slice().sort(), ['id-1', 'id-2']);

  assert.equal(diffAuthorizers(['id-1', 'id-2'], ['id-1', 'id-2']).ok, true);

  const custodyC = humanProfile('id-4', ['licitaciones', 'licitaciones_custodia']);
  const eligibleWithExtra = findCustodyEligibleProfiles([...profiles, custodyC]);
  const diff = diffAuthorizers(eligibleWithExtra, ['id-1', 'id-2']);
  assert.equal(diff.ok, false);
  assert.ok(diff.extra.includes('id-4'));

  console.log('tender-analysis-authorizers-audit passed');
}
run();
