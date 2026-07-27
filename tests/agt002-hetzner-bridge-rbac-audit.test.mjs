import assert from 'node:assert/strict';
import { diffEligibility, findEligibleProfiles } from '../agt002-hetzner-bridge-rbac-audit.js';

function testDiffEligibilityExactMatch() {
  assert.deepEqual(diffEligibility(['a', 'b'], ['b', 'a']), { extra: [], missing: [], ok: true });
}

function testDiffEligibilityDetectsExtraProfile() {
  assert.deepEqual(diffEligibility(['a', 'b', 'c'], ['a', 'b']), { extra: ['c'], missing: [], ok: false });
}

function testDiffEligibilityDetectsMissingProfile() {
  assert.deepEqual(diffEligibility(['a'], ['a', 'b']), { extra: [], missing: ['b'], ok: false });
}

function testDiffEligibilityDetectsBothExtraAndMissing() {
  const result = diffEligibility(['a', 'x'], ['a', 'b']);
  assert.deepEqual(result, { extra: ['x'], missing: ['b'], ok: false });
}

function testFindEligibleProfilesUsesInjectedPredicate() {
  const profiles = [{ id: '1', role: 'admin' }, { id: '2', role: 'ventas' }, { id: '3', role: 'gerencia' }];
  const isEligible = (profile) => profile.role === 'admin' || profile.role === 'gerencia';
  assert.deepEqual(findEligibleProfiles(profiles, isEligible), ['1', '3']);
}

function testFindEligibleProfilesDefaultNeverThrowsOnMinimalProfile() {
  const profiles = [{ id: 'x', role: 'other' }];
  assert.doesNotThrow(() => findEligibleProfiles(profiles));
  assert.deepEqual(findEligibleProfiles(profiles), []);
}

// Production parity: the real AI_ANALYSIS_RUN gate (via the default predicate)
// must yield exactly the ratified custody set. Only profiles holding explicit
// tender custody (licitaciones + licitaciones_custodia) may spend AGT-002 quota,
// regardless of role. Katherine (comercial, custody) is eligible; Luis (admin,
// no custody) is not; Juan (admin, custody) is.
function humanProfile(id, role, permissions) {
  return { id, role, active: true, identity_type: 'human', areas: [], permissions };
}

function testDefaultEligibilityMatchesRatifiedCustodySet() {
  const juan = humanProfile('juan-botero', 'admin', ['licitaciones', 'licitaciones_custodia']);
  const katherine = humanProfile('katherine-valencia', 'comercial', ['licitaciones', 'licitaciones_custodia']);
  const luis = humanProfile('luis-lopez', 'admin', ['licitaciones']);
  const inactiveCustodian = humanProfile('inactive-custodian', 'comercial', ['licitaciones', 'licitaciones_custodia']);
  inactiveCustodian.active = false;
  const nonHumanAgent = { id: 'agt-002', active: true, identity_type: 'agent', areas: [], permissions: [] };

  const eligible = findEligibleProfiles([juan, katherine, luis, inactiveCustodian, nonHumanAgent]);
  const expected = ['juan-botero', 'katherine-valencia'];
  assert.deepEqual([...eligible].sort(), [...expected].sort());
  assert.deepEqual(diffEligibility(eligible, expected), { extra: [], missing: [], ok: true });
}

testDiffEligibilityExactMatch();
testDiffEligibilityDetectsExtraProfile();
testDiffEligibilityDetectsMissingProfile();
testDiffEligibilityDetectsBothExtraAndMissing();
testFindEligibleProfilesUsesInjectedPredicate();
testFindEligibleProfilesDefaultNeverThrowsOnMinimalProfile();
testDefaultEligibilityMatchesRatifiedCustodySet();
console.log('agt002-hetzner-bridge-rbac-audit.test.mjs OK');
