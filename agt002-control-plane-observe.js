import { SURFACE_NAMES, buildAgt002ControlPlaneIdentity } from './agt002-control-plane-identity.js';

function computeMatch(desired, observed) {
  if (observed === null) return null;
  if (typeof desired !== 'string' || desired.length === 0) return null;
  return desired === observed;
}

export function observeAgt002Surfaces({
  desiredSha = null,
  desiredVersion = null,
  observations = {},
  now = () => new Date(),
} = {}) {
  const surfaces = {};

  for (const surface of SURFACE_NAMES) {
    const observation = observations[surface] ?? {};
    const identity = buildAgt002ControlPlaneIdentity({
      surface,
      sha: observation.sha ?? null,
      version: observation.version ?? null,
      source: observation.source ?? 'unobserved',
      now,
    });
    surfaces[surface] = {
      ...identity,
      match_desired: computeMatch(desiredSha, identity.sha),
      match_desired_version: computeMatch(desiredVersion, identity.version),
    };
  }

  return {
    control_plane_reconciled: false,
    surfaces,
  };
}
