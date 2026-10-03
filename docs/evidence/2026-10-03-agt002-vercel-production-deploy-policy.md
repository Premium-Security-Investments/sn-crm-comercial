# AGT-002 Vercel production deploy policy — verification receipt

## Identity

- Date: 2026-10-03 UTC
- Actor/tool: Codex
- Repository/worktree: `sn-crm-comercial` at `/root/worktrees/siio-e6-scheduler-fix`
- Branch: `main`
- Pre-change HEAD and baseline: `223a085be330f099863a876ed3ccfdb56efe51a9`
- Authorized scope: document the manual production deployment path, ignore Python cache directories
  and record the public control-plane URL; no production deployment authorized

## Result

- State reached: `verified_isolated`; production remains `not_authorized`
- Added the authoritative runbook `docs/runbooks/agt002-vercel-production-deploy.md`
- Added the manual policy directly to `scripts/agt002-deploy-vercel-production.sh`
- Added `__pycache__/` to the repository `.gitignore`
- Added `AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL` with its public production endpoint to
  `.env.local.example`
- Added an automated static contract test for all four requirements
- No Vercel command, deployment, service restart or production mutation was performed

## Evidence

Before the edits, the target worktree was clean, on `main`, and both `HEAD` and the locally observed
`origin/main` resolved to `223a085be330f099863a876ed3ccfdb56efe51a9`.

Focused checks:

```text
node --test tests/agt002-vercel-production-deploy-policy.test.mjs
```

Result: PASS, exit 0.

```text
bash -n scripts/agt002-deploy-vercel-production.sh
git check-ignore -v tools/example/__pycache__/module.cpython-312.pyc
git diff --check
```

Results: PASS. Git attributed the sample cache path to `.gitignore:7:__pycache__/`.

Repository evidence also confirms that both Node and Vercel handlers expose
`GET /api/agt002/control-plane`, while the repository's canonical production host is
`https://seguridad-nacional-crm.vercel.app/`.

## Drift and limitations

- The execution sandbox could not resolve the public production hostname, so this receipt does not
  claim a live HTTP readback of the URL.
- The worktree is now intentionally dirty with the documented policy changes. Therefore it fails
  the production script's clean-worktree precondition until these changes are reviewed, committed
  and integrated normally.
- No existing uncommitted user changes were present before this task.

## Next gate

- Exact action: review the published source-control change and decide whether to merge it.
- Authority required: human review/merge approval.
- Preconditions for any later deployment: explicit production authorization, exact worktree
  `/root/worktrees/siio-e6-scheduler-fix`, fresh `origin/main`, clean status, `HEAD == origin/main`,
  explicit control-plane URL, and invocation only through the governed script.
- Deployment and live readback remain a separate gate and were not performed here.
