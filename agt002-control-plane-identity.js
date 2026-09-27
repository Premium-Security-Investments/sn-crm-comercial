export const SURFACE_NAMES = Object.freeze([
  'origin_main',
  'vercel_production',
  'bridge',
  'radar_pipeline',
  'reanalysis_worker',
  'workbench_scheduler',
]);

const SURFACE_NAME_SET = new Set(SURFACE_NAMES);

export function buildAgt002ControlPlaneIdentity({
  surface,
  sha = null,
  version = null,
  source = 'unobserved',
  now = () => new Date(),
} = {}) {
  if (!SURFACE_NAME_SET.has(surface)) {
    throw new Error(`Invalid AGT-002 control plane surface: ${surface}`);
  }

  const normalizedSha = typeof sha === 'string' && sha.length > 0 ? sha : null;

  let normalizedSource = source;
  if (normalizedSha === null) {
    normalizedSource = 'unobserved';
  } else if (typeof source !== 'string' || !source.trim() || source === 'unobserved') {
    throw new Error('A non-empty sha requires a non-empty source other than "unobserved"');
  }

  // A version is only ever meaningful alongside the sha it describes: a surface with no
  // observed sha reports no version either, so a stray/spoofed version input can never make an
  // otherwise-unobserved surface look reported.
  const normalizedVersion =
    normalizedSha === null ? null : typeof version === 'string' && version.length > 0 ? version : null;

  return {
    surface,
    sha: normalizedSha,
    version: normalizedVersion,
    source: normalizedSource,
    observed_at_utc: now().toISOString(),
  };
}
