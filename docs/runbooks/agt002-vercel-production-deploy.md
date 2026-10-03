# AGT-002 — Vercel Production Deploy Runbook

## Authorization scope

Authorized production deploys run **only** from the worktree:

```
/root/worktrees/siio-e6-scheduler-fix
```

Before deploying, confirm:

- The worktree is **clean** (no uncommitted changes, no untracked files).
- `HEAD` is **exactly equal** to freshly fetched `origin/main` (run `git fetch origin main` first, then compare `git rev-parse HEAD` to `git rev-parse origin/main`).

Do not deploy from any other clone, worktree, or branch.

## Manual execution

Manual runs must explicitly pass the control plane URL:

```
AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL=https://seguridad-nacional-crm.vercel.app/api/agt002/control-plane \
  ./scripts/agt002-deploy-vercel-production.sh
```

**Never** invoke `vercel --prod` or `vercel deploy --prod` directly. The wrapper script is the only authorized entry point because it provides:

- Locking (prevents concurrent/overlapping deploys)
- Idempotency (safe to re-run without duplicate side effects)
- SHA/version injection (ensures the deployed build is traceable to the exact commit)
- Exact production readback (verifies what was actually deployed matches what was requested)

## `__pycache__/` handling

`__pycache__/` is ignored in this repo because Python regenerates it automatically. If it is not ignored, the deploy wrapper will exit with status `3`.
