// The surfaces the drift watchdog compares against main. Only what is actually live today:
// GitHub main, Vercel production, the Hetzner bridge, and the host jobs that run from a pinned
// release under /opt/psi-comercial/releases/<sha> (one surface per systemd unit, because the units
// of the Radar daily chain are pinned to different releases and a single sha cannot describe them).
export const SURFACE_NAMES = Object.freeze([
  'origin_main',
  'vercel_production',
  'bridge',
  'initial_analysis_worker',
  'auto_initial',
  'radar_daily_import',
  'radar_daily_scan',
  'radar_daily_reconciliation',
  'radar_daily_top5',
  'radar_requests',
]);

// Surfaces the host retired (timer disabled / replaced by the CRM daily Radar). They are no longer
// watched for drift, but their legacy --control-plane reporters still build an identity, so the
// name stays valid here.
export const RETIRED_SURFACE_NAMES = Object.freeze(['radar_pipeline', 'reanalysis_worker', 'workbench_scheduler']);

const SURFACE_NAME_SET = new Set([...SURFACE_NAMES, ...RETIRED_SURFACE_NAMES]);

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
