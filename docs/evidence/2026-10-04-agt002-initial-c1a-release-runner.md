# AGT-002 INITIAL C1A release runner — verification receipt

**Date:** 2026-10-04  
**Branch:** `feat/agt002-c1a-r1-program-20261004`  
**Baseline:** `origin/main@c06786d7f551b352694fc1f3e501b5603fa8c47d`  
**Environment:** isolated local worktree; no production migration, deployment, service change or
job admission  
**Verdict:** `VERIFIED_ISOLATED`; C1A E2 remains pending production connectivity and readback

## Delivered release control

- Added one governed runner for the complete INITIAL database chain `099 -> 104`.
- Read-only `state` and `preflight` classify absent, contiguous partial, applied and drift states.
- Structural markers cover the tables, RPCs, post-102 columns, the post-103 removal of direct
  service-role admission and the server-owned 104 function body.
- Security readback checks RLS, public/anon/authenticated grants, required service-role access and
  denial of the legacy admission primitive.
- `apply` takes an advisory lock, rechecks the observed structure and applies only the contiguous
  missing suffix atomically before an independent verify.
- `rollback` is whole-chain, reverse order and retains every migration's evidence-preserving guard.
- Added the C1A runbook with flags off, timer off, backup/restore, exact SHA and post-change readback
  requirements.

## Verification

- TDD RED: runner contract failed with `ERR_MODULE_NOT_FOUND` before implementation.
- Runner contract: PASS.
- Real PGlite chain `099`–`104`: runner reports `applied`, all migrations true, zero unsafe grants,
  zero missing RLS and zero missing service access: PASS.
- From the pre-INITIAL PGlite schema, the runner applies the six real migrations in one atomic batch,
  verifies the secure final state, rolls back the empty chain in reverse order and reads `absent`:
  PASS.
- Existing canonical persistence PGlite integration and server-owned 104 behavior: PASS.
- Five authoritative INITIAL package gates (evidence packages, workflow/G1, jobs, canonical
  persistence and E0 closure): 28/28 PASS.
- The first read-only operator invocation exposed that the production-style environment uses
  `SUPABASE_URL` while the runner initially accepted only `NEXT_PUBLIC_SUPABASE_URL`. A RED/green
  contract now accepts either name without trying to load a missing local dotenv file.
- No secrets were read or written and no remote operation ran.

## Operational disposition

The operator path is now reproducible, but E2 is not accepted until a production preflight,
backup/restore receipt, migration application, application deployment with both flags off and exact
post-deploy readback all succeed. The current environment cannot reach that target, so no command
from the mutating portions of the runbook has been executed. A read-only state request ended in
`fetch failed` during the current DNS outage and produced no database result or mutation.
