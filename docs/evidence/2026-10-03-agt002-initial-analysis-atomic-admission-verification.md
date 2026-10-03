# AGT-002 INITIAL — atomic G1/job admission local verification receipt

**Date:** 2026-10-03

**Branch:** `feat/agt002-initial-analysis-p0`

**Baseline:** `9ec9626be21df0c7dfae5da281f8d90fda085fa1`

**Pre-verification HEAD:** `978b6282db6730940dacf9c61a57be8d90ec0581`

**Environment:** isolated local worktree; no production migration, deployment or service change

**Verdict:** VERIFIED_ISOLATED for the atomic admission residual gate; not integrated or deployed

## Scope closed

Migration 103 introduces one service-role-only admission boundary that:

- independently re-verifies the authorization, INITIAL workflow, opportunity, tender, frozen
  package/hash and G1 scope;
- consumes the G1 authorization and admits the durable INITIAL job in one PostgreSQL transaction;
- rolls the consumption back if job admission conflicts or fails;
- strips any caller-provided `payload.persistence` member and reconstructs the six completion
  bindings server-side;
- preserves exact replay idempotency under one job idempotency key;
- revokes `service_role` execution of the migration-101 admission primitive so the atomic G1 gate
  cannot be bypassed through the supported service surface;
- adds a data-preserving rollback that removes only the wrapper and restores the prior grant.

The JS API and queue adapter now accept the full closed authorization/job identity and issue one
RPC call. INITIAL and REANALYSIS remain separate; no REANALYSIS object is referenced by the new
runtime or SQL surface.

## Focused evidence

```text
npm run test:agt002-initial-analysis-jobs
```

Result: six test files passed, including unit/API mapping, migration static safety, worker
compatibility and the migration-101 PGlite regression.

```text
node --test tests/agt002-initial-analysis-canonical-persistence-pglite.integration.test.mjs
```

Result: the full migration-102/103 PGlite integration file passed. Its new migration-103 scenarios
verified the exposed grants, atomic happy path, server-built persistence envelope, exact replay,
rollback of G1 consumption on job conflict, scope mismatch, expired grant and rollback 103.

```text
node --test \
  tests/agt002-initial-analysis-persistence.test.mjs \
  tests/agt002-initial-analysis-canonical-persistence-migration.test.mjs \
  tests/agt002-initial-analysis-executor.test.mjs \
  tests/agt002-initial-analysis-worker.test.mjs \
  tests/agt002-initial-analysis-worker-ops.test.mjs
```

Result: five test files passed.

`git diff --check`, `corepack pnpm exec tsc --noEmit`, and
`corepack pnpm exec vite build` passed.

## Guard limitation

The P0-00 CLI guard did not produce a valid repository observation in this restricted sandbox
because its internal `spawnSync('git', ...)` calls are denied and therefore fail closed with empty
branch/root/baseline values. Independently, the current implementation files are intentionally
uncommitted and fall outside the guard's frozen dirty-path allow-list; the guard is not claimed
green. Its constants or allow-list were not weakened.

## Production and operational readback

- migrations 099 through 103 remain unapplied by this worktree;
- no INITIAL service or timer was installed or started;
- no real opportunity, workflow, authorization, job or canonical run was written;
- no commit, push, merge or release was performed;
- no REANALYSIS worker, Cali job or production timer was modified.

## State ladder and residual gates

Current state: **verified_isolated**.

The P0-06 residual atomic-admission gate is locally closed. Remaining INITIAL work is the user-facing
status/report surface, production observability and fail-closed controls, followed by the synthetic
E0 integration and release evidence. Integration, migration application and deployment remain
separate explicit gates.
