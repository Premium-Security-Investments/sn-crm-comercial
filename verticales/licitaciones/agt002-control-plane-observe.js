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
      // Why a surface is (not) observed, so the drift check can fail on "unreachable" while only
      // warning on "route not deployed yet". A trusted sha always means observed; without one the
      // collector's reason is kept, defaulting to not_configured.
      observation_status:
        identity.sha !== null
          ? 'observed'
          : typeof observation.observation_status === 'string' && observation.observation_status !== 'observed'
            ? observation.observation_status
            : 'not_configured',
      ...(Number.isInteger(observation.http_status) ? { http_status: observation.http_status } : {}),
      ...(observation.unit_status && typeof observation.unit_status === 'object'
        ? { unit_status: { available: observation.unit_status.available === true } }
        : {}),
      match_desired: computeMatch(desiredSha, identity.sha),
      match_desired_version: computeMatch(desiredVersion, identity.version),
    };
  }

  return {
    control_plane_reconciled: false,
    surfaces,
  };
}
