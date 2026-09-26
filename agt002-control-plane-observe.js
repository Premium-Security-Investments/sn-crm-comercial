import { SURFACE_NAMES, buildAgt002ControlPlaneIdentity } from './agt002-control-plane-identity.js';

function computeMatchDesired(desiredSha, sha) {
  if (sha === null) return null;
  if (typeof desiredSha !== 'string' || desiredSha.length === 0) return null;
  return desiredSha === sha;
}

export function observeAgt002Surfaces({ desiredSha = null, observations = {}, now = () => new Date() } = {}) {
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
      match_desired: computeMatchDesired(desiredSha, identity.sha),
    };
  }

  return {
    control_plane_reconciled: false,
    surfaces,
  };
}
