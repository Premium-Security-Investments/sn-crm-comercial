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

  return {
    surface,
    sha: normalizedSha,
    version: version ?? null,
    source: normalizedSource,
    observed_at_utc: now().toISOString(),
  };
}
