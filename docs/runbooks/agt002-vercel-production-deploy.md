# AGT-002 Vercel production deployment

## Authoritative manual path

An AGT-002 production deployment is permitted only from the exact worktree
`/root/worktrees/siio-e6-scheduler-fix`, with a clean Git status and
`HEAD == origin/main`. These preconditions do not themselves authorize a deployment; production
deployment still requires an explicit gate for the intended release.

The only authorized command surface is:

```text
scripts/agt002-deploy-vercel-production.sh
```

Never run `vercel --prod` directly. The script provides the concurrency lock, clean-worktree and
SHA checks, duplicate-safe preflight, bounded deployment call and exact post-deploy readback that a
direct Vercel command would bypass.

## Required explicit readback URL

The production control-plane endpoint is public operational metadata, not a secret:

```text
https://seguridad-nacional-crm.vercel.app/api/agt002/control-plane
```

For a manually authorized deployment, pass it explicitly on the same command invocation; do not
depend on a value inherited invisibly from a prior shell:

```bash
cd /root/worktrees/siio-e6-scheduler-fix
git fetch origin main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL=https://seguridad-nacional-crm.vercel.app/api/agt002/control-plane \
  scripts/agt002-deploy-vercel-production.sh
```

Do not set `AGT002_DEPLOY_SKIP_FETCH=1` for a real deployment. That variable exists for the
isolated test harness; using it manually would allow comparison against a stale `origin/main`.

## Dirty-worktree prevention

Python creates `__pycache__/` directories during local tooling runs. They are ignored repository-
wide so they cannot make this deployment worktree dirty and trigger the script's intentional exit
code 3. Exit code 3 must still be treated as a hard stop for every other tracked or untracked path;
never clean, stash or discard unknown work merely to force a deployment.

## Required readback

A zero exit means either the exact SHA/version was already live or the script deployed once and
observed the exact SHA/version through the endpoint above. A Vercel `Ready` state by itself is not
enough. Preserve the script output and the live control-plane response in the release receipt.
