# AGT-002 INITIAL — current-main integration verification

**Date:** 2026-10-03

**Branch:** `feat/agt002-initial-analysis-p0`

**Integrated baseline:** `641dd4d2028185a2109fd58d8de2bfd4999d11a2`

**Verified pre-receipt HEAD:** `5793880bf37cc4d58c9f922c476adb10039d8b42`

**Environment:** isolated local worktree; no production migration, deployment, service change, or
real INITIAL admission

**Verdict:** VERIFIED_ISOLATED on current `origin/main`; ready for review, not deployed

## Integration result

- The branch was rebased cleanly onto the production baseline above.
- The production recovery migration remains
  `097_agt002_checkpoint_generation_recovery.sql`.
- The five unapplied INITIAL migrations and matching rollbacks were renumbered contiguously to
  `098` through `102`; every code, test, SQL comment, rollback diagnostic, and evidence reference
  was updated with the same mapping.
- A local recovery branch preserves the pre-integration state at
  `backup/agt002-initial-analysis-p0-pre-main-20261003`.
- `git diff --check origin/main...HEAD` passed and the worktree was clean after validation.

## Verification evidence

Before rebasing, all renumbered INITIAL layers passed together:

```text
corepack pnpm run test:agt002-evidence-packages
120 passed, 0 failed

corepack pnpm run test:agt002-initial-workflow
113 passed, 0 failed

corepack pnpm run test:agt002-initial-analysis-jobs
78 passed, 0 failed, 1 intentionally skipped fixture boundary

corepack pnpm run test:agt002-initial-analysis-canonical-persistence
105 passed, 0 failed
```

After rebasing onto current `origin/main`, the deepest chain and build gates were repeated:

```text
corepack pnpm run test:agt002-initial-analysis-canonical-persistence
105 passed, 0 failed

corepack pnpm exec tsc --noEmit
PASS

corepack pnpm exec vite build
PASS — 149 modules transformed
```

## Boundary statement

This receipt does not authorize or claim a production deployment. Migrations `098`–`102` remain
unapplied; INITIAL admission and model-call switches remain outside this integration action;
REANALYSIS and the targeted Cali recovery were not modified by this branch work.
