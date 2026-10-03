# AGT-002 Cali — resumed-attempt ledger local fix receipt

**Date:** 2026-10-03

**Branch:** `fix/agt002-resume-attempt-ledger-20261003`

**Baseline / pre-verification HEAD:** `223a085be330f099863a876ed3ccfdb56efe51a9`

**Environment:** isolated local worktree; no deployment, service restart, provider call or job retry

**Verdict:** VERIFIED_ISOLATED for the resumed-attempt ledger defect; not integrated or deployed

## Incident binding

The controlled Cali recovery attempt reclaimed the durable job with `resume_count = 1`, but its
append-only analysis-attempt identity was still in `running`. The resumed executor reused the
correct original attempt key and then emitted `queued -> running`; migration 050 correctly rejected
both events because `running -> queued` and `running -> running` are illegal direct transitions.

The deployed worker files involved in this path were byte-identical to baseline
`223a085be330f099863a876ed3ccfdb56efe51a9`. The release SHA reported by the host was not available
as a local Git object, so this fix is deliberately based on the verified byte-identical source
rather than claiming an unproven Git ancestry.

## Local change

- the durable executor now forwards the existing `resumeCount` without deriving a new identity;
- only a reclaimed invocation (`resumeCount > 0`) reads the latest event for the exact
  `(opportunity_id, snapshot_id, attempt_key)` identity;
- a stale `queued` or `running` projection is closed through migration 050's already-supported
  `retry_wait` state with closed code `AGT002_LEASE_LOST`;
- the ordinary `queued -> running` lifecycle then resumes under the same attempt key;
- fresh invocations and terminal/retry projections retain their prior behavior;
- ledger observation remains best-effort and does not alter the analysis engine result.

No migration was added and no existing state-machine rule was weakened.

## Focused evidence

The following seven suites passed together:

```text
node --test \
  tests/agt002-post-bridge-observability.test.mjs \
  tests/agt002-reanalysis-executor.test.mjs \
  tests/agt002-reanalysis-worker.test.mjs \
  tests/agt002-reanalysis-jobs.test.mjs \
  tests/agt002-analysis-checkpoints.test.mjs \
  tests/agt002-batched-v3-orchestration.test.mjs \
  tests/agt002-canonical-analysis-protection.test.mjs
```

The migration-050 PGlite apply/rollback test also passed and exercised the exact legal recovery
sequence:

```text
running -> retry_wait -> queued -> running
```

```text
node tests/agt002-canonical-analysis-pglite.integration.test.mjs
```

`git diff --check`, `corepack pnpm exec tsc --noEmit`, and
`corepack pnpm exec vite build` passed.

## Verification limitations

- `npm run build` reached its existing deployment-safety test, whose Node `spawnSync` call is
  denied by this sandbox with `EPERM`. Running the type checker and bundler independently passed.
- The unrelated heavy durable-batched PGlite suite was killed with exit 137 by the environment;
  this receipt does not claim it green.

## Production and operational readback

- the Cali job remains paused in production with no live worker and no timer enabled;
- no provider/model request was issued by this local verification;
- no migration, release, deploy, service restart or retry was performed;
- the canonical Cali output remains unpublished.

## State ladder and residual gates

Current state: **verified_isolated**.

Remaining gates are: review/integration, deploy the reviewed release, verify service/release
readback, then obtain one explicit production authorization for the controlled Cali retry with the
existing stop-on-first-failure rule. Until all of those gates pass, Cali must remain paused.
