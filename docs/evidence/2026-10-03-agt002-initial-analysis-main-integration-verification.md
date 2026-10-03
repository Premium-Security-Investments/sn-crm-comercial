# AGT-002 INITIAL — current-main integration verification

**Date:** 2026-10-03

**Branch:** `feat/agt002-initial-analysis-p0`

**Integrated baseline:** `356143900cb367eb1c17a050a9fe5d750654da7a`

**Verified pre-receipt HEAD:** `cd1e381a6c6329cb8be591c5539c911edc60790d`

**Environment:** isolated local worktree; no production migration, deployment, service change, or
real INITIAL admission

**Verdict:** VERIFIED_ISOLATED on current `origin/main`; ready for review, not deployed

## Integration result

- The production baseline above was merged cleanly into the branch.
- The production recovery lineage remains intact: migration `097` is unchanged and migration
  `098_agt002_checkpoint_generation_2_recovery.sql` remains reserved for the Cali generation-2
  recovery.
- The five unapplied INITIAL migrations and matching rollbacks were renumbered contiguously to
  `099` through `103`; every code, test, SQL comment, rollback diagnostic, and evidence reference
  was updated with the same mapping.
- A local recovery branch preserves the pre-integration state at
  `backup/agt002-initial-p0-pre-099-103-20261003`.
- `git diff --check origin/main...HEAD` passed and the worktree was clean after validation.

## Verification evidence

After merging current `origin/main`, all renumbered INITIAL layers passed together:

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

```text
corepack pnpm exec tsc --noEmit
PASS

corepack pnpm exec vite build
PASS — 149 modules transformed
```

## Boundary statement

This receipt does not authorize or claim a production deployment. Migrations `099`–`103` remain
unapplied; INITIAL admission and model-call switches remain outside this integration action;
REANALYSIS and the targeted Cali recovery were not modified by this branch work.
