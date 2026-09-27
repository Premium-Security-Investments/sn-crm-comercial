import { buildAgt002ControlPlaneIdentity } from './agt002-control-plane-identity.js';

export function getAgt002VercelControlPlaneIdentity({ env = {} } = {}) {
  const vercelSha = env.VERCEL_GIT_COMMIT_SHA;
  const githubSha = env.GITHUB_SHA;
  // The only version input this surface ever reports: whatever the deployer injected
  // explicitly as a build-time env var. Never derived from disk/package.json content.
  const version = typeof env.AGT002_DEPLOYED_VERSION === 'string' ? env.AGT002_DEPLOYED_VERSION : null;

  if (typeof vercelSha === 'string' && vercelSha.length > 0) {
    return buildAgt002ControlPlaneIdentity({
      surface: 'vercel_production',
      sha: vercelSha,
      version,
      source: 'vercel_git_commit_sha',
    });
  }

  if (typeof githubSha === 'string' && githubSha.length > 0) {
    return buildAgt002ControlPlaneIdentity({
      surface: 'vercel_production',
      sha: githubSha,
      version,
      source: 'github_sha',
    });
  }

  return buildAgt002ControlPlaneIdentity({ surface: 'vercel_production' });
}
