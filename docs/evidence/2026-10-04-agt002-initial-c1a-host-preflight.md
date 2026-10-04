# AGT-002 INITIAL C1A host preflight — verification receipt

**Date:** 2026-10-04  
**Observed at:** `2026-10-04T10:41:48.585Z`  
**Target baseline:** `origin/main@90bf8662debf56d29a44ddf4a6515b62c9c93ec1`  
**Command surface:** `scripts/agt002-initial-analysis-c1a-preflight.mjs`  
**Verdict:** `BLOCKED`; `authorizes=NOTHING`; canary remains unauthorized

## Purpose

The C1A pre-change evidence had previously been distributed among manual commands. This change adds
one fail-closed, non-production-mutating preflight that collects a sanitized receipt before migrations
`099`–`104` or the flags-OFF deployment can begin. It does not contain an apply, deploy, service
installation, worker execution or canary path.

The receipt requires all of the following at the same time:

- a clean fixed deployment worktree after a fresh `git fetch origin main`, with exact SHA equality;
- a protected INITIAL environment owned by root, complete and free of placeholder values, with both
  kill switches literally `false`;
- INITIAL service, timer and worker process proven off;
- an actual provider backup receipt bound to the exact database host, integrity verification and a
  passing isolated restore test;
- a live production control-plane observation; and
- a successful read-only INITIAL database preflight with a secure absent, contiguous partial or fully
  applied migration chain.

Secret values are reduced to configuration booleans. The receipt exposes only the Supabase hostname,
flag literals, SHAs, control-plane version, service states and migration security counters.

## Verification

- TDD RED: the contract first failed with `ERR_MODULE_NOT_FOUND`.
- C1A preflight contract: 19/19 PASS.
- Existing INITIAL migration runner contract: PASS.
- Existing production deployment policy and executable tests: PASS.
- Full AGT-002 suite on the core implementation: 2,695 PASS, 0 FAIL, 11 SKIP (2,706 tests total).
- Production build, TypeScript and deployment-safety gate passed on the core implementation. After
  the final static-unit/process-pattern hardening, its focused contract passed 19/19; a repeated local
  build reached the unrelated deployment-safety subprocess check and then received the managed
  executor's known empty-output `spawnSync EPERM`. The same child script exits 0 when invoked
  directly; remote CI remains the final build readback for this revision.
- Placeholder credentials/model identifiers are rejected.
- An unavailable process table, systemd bus, database readback or control plane is not treated as an
  OFF/healthy observation.
- A passing receipt still emits `canary_authorized=false` and is limited to migrations `099`–`104`
  plus deployment with both flags OFF.

## Real host readback

The first real invocation returned four positive checks:

- fixed repository path;
- clean deployment worktree;
- exact `HEAD == origin/main == 90bf8662debf56d29a44ddf4a6515b62c9c93ec1`; and
- zero matching INITIAL worker processes, with the process table observed.

It stopped on the remaining gates:

- fresh GitHub fetch unavailable in the current DNS/network context;
- `/etc/psi-agt002-initial-analysis/env` absent, so target identity, required runtime configuration and
  the two literal OFF values cannot be proven;
- systemd service/timer state unavailable because this execution context cannot connect to the bus;
- no C1A backup/restore receipt supplied;
- production control plane not reachable; and
- no database preflight result.

No migration, deploy, environment write, service change, provider call, job admission or canary was
performed. C1A remains before E2 and R1 implementation remains unopened.
