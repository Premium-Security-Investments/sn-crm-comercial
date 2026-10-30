import { buildAgt002ControlPlaneIdentity } from './agt002-control-plane-identity.js';

const FULL_LOWERCASE_SHA_RE = /^[0-9a-f]{40}$/;

// The deployer's explicit build-time env var always wins. Absent that, a full lowercase
// 40-hex sha deterministically implies the version scripts/agt002-deploy-vercel-production.sh
// derives for it (f0-<first 7 chars>), so a native Vercel-triggered deploy (which never sets
// AGT002_DEPLOYED_VERSION) still reports the correct version instead of null. Anything shorter
// or non-hex is not a real commit sha, so no version is inferred from it.
function deriveAgt002VercelVersion({ explicitVersion, sha }) {
  if (typeof explicitVersion === 'string' && explicitVersion.length > 0) {
    return explicitVersion;
  }
  return FULL_LOWERCASE_SHA_RE.test(sha) ? `f0-${sha.slice(0, 7)}` : null;
}

export function getAgt002VercelControlPlaneIdentity({ env = {} } = {}) {
  const explicitVersion = env.AGT002_DEPLOYED_VERSION;
  const candidates = [
    { sha: env.VERCEL_GIT_COMMIT_SHA, source: 'vercel_git_commit_sha' },
    { sha: env.GITHUB_SHA, source: 'github_sha' },
    { sha: env.AGT002_DEPLOYED_GIT_SHA, source: 'agt002_deployed_git_sha' },
  ];

  for (const { sha, source } of candidates) {
    if (typeof sha === 'string' && sha.length > 0) {
      return buildAgt002ControlPlaneIdentity({
        surface: 'vercel_production',
        sha,
        version: deriveAgt002VercelVersion({ explicitVersion, sha }),
        source,
      });
    }
  }

  return buildAgt002ControlPlaneIdentity({ surface: 'vercel_production' });
}
