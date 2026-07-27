import { requireAction, ACTIONS } from './access-control.js';

export function diffEligibility(eligibleIds, expectedIds) {
  const eligible = new Set(eligibleIds);
  const expected = new Set(expectedIds);
  return {
    extra: [...eligible].filter((id) => !expected.has(id)),
    missing: [...expected].filter((id) => !eligible.has(id)),
    ok: eligible.size === expected.size && [...expected].every((id) => eligible.has(id)),
  };
}

function defaultIsEligible(profile) {
  try {
    requireAction(profile, ACTIONS.AI_ANALYSIS_RUN);
    return true;
  } catch {
    return false;
  }
}

export function findEligibleProfiles(profiles, isEligible = defaultIsEligible) {
  return profiles.filter(isEligible).map((profile) => profile.id);
}
