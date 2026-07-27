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

testDiffEligibilityExactMatch();
testDiffEligibilityDetectsExtraProfile();
testDiffEligibilityDetectsMissingProfile();
testDiffEligibilityDetectsBothExtraAndMissing();
testFindEligibleProfilesUsesInjectedPredicate();
testFindEligibleProfilesDefaultNeverThrowsOnMinimalProfile();
console.log('agt002-hetzner-bridge-rbac-audit.test.mjs OK');
