import { buildAgt002ControlPlaneIdentity } from './agt002-control-plane-identity.js';

export function getAgt002VercelControlPlaneIdentity({ env = {} } = {}) {
  const vercelSha = env.VERCEL_GIT_COMMIT_SHA;
  const githubSha = env.GITHUB_SHA;

  if (typeof vercelSha === 'string' && vercelSha.length > 0) {
    return buildAgt002ControlPlaneIdentity({
      surface: 'vercel_production',
      sha: vercelSha,
      source: 'vercel_git_commit_sha',
    });
  }

  if (typeof githubSha === 'string' && githubSha.length > 0) {
    return buildAgt002ControlPlaneIdentity({
      surface: 'vercel_production',
      sha: githubSha,
      source: 'github_sha',
    });
  }

  return buildAgt002ControlPlaneIdentity({ surface: 'vercel_production' });
}
