import { buildAgt002ControlPlaneIdentity } from './agt002-control-plane-identity.js';

export function buildRadarPipelineIdentity({ headSha = null, version = null } = {}) {
  if (!headSha) {
    return buildAgt002ControlPlaneIdentity({ surface: 'radar_pipeline' });
  }
  return buildAgt002ControlPlaneIdentity({
    surface: 'radar_pipeline',
    sha: headSha,
    version,
    source: 'radar_pipeline_git_head',
  });
}

export function buildReanalysisWorkerIdentity({ releaseSha = null, version = null } = {}) {
  if (!releaseSha) {
    return buildAgt002ControlPlaneIdentity({ surface: 'reanalysis_worker' });
  }
  return buildAgt002ControlPlaneIdentity({
    surface: 'reanalysis_worker',
    sha: releaseSha,
    version,
    source: 'reanalysis_worker_release_sha',
  });
}

export function buildWorkbenchSchedulerIdentity({ runnerSha256 = null, checkoutSha = null } = {}) {
  if (!checkoutSha) {
    return buildAgt002ControlPlaneIdentity({ surface: 'workbench_scheduler' });
  }
  return buildAgt002ControlPlaneIdentity({
    surface: 'workbench_scheduler',
    sha: checkoutSha,
    version: runnerSha256 || null,
    source: 'workbench_scheduler_checkout_sha',
  });
}
