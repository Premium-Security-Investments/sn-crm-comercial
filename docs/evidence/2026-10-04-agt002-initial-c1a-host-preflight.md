# AGT-002 INITIAL C1A host preflight — verification receipt

**Date:** 2026-10-04  
**Observed at:** `2026-10-04T10:41:48.585Z`  
**First host baseline:** `origin/main@90bf8662debf56d29a44ddf4a6515b62c9c93ec1`

**Integrated baseline:** `origin/main@526c4a5e97ea1b1a971e485177b39cfe758d1e00`
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

## Independent provider readbacks after integration

PR #284 was merged after every required remote check passed. GitHub independently reported the PR
closed and merged at `2026-10-04T10:51:05Z`, with merge commit
`526c4a5e97ea1b1a971e485177b39cfe758d1e00`; protected `main` pointed to that same signed commit.
The fixed host worktree could not fetch it because direct DNS remained unavailable, so the host SHA
gate is still blocked even though the provider-side identity is known.

Read-only Supabase management-plane queries, bound to project ref `tyfzjqzcpgwcjnxozaaf`, established:

- project `noxguard-control` was `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.111`, region `us-east-2`;
- all 11 runner prerequisites were present (`missing_prerequisites=0`);
- migrations `099` through `104` were all absent, with no gap;
- `unsafe_grants=0`, `rls_missing=0` and `missing_service_access=0`; and
- physical backup `1863369048`, created `2026-10-04T04:58:38.408Z`, was `COMPLETED`.

This closes the previously unobserved database posture: the chain is a secure clean `absent` state.
It does not authorize applying it. The backup exists on the exact project, but the provider
connection exposes no non-destructive restore-to-new-project operation, PITR is disabled, and a
normal database branch would copy schema without production data. Therefore the required isolated
restore test remains open; no restore was attempted against production.

Vercel independently reported production deployment `dpl_DHQkK1NY8N6H9QcZfRrFCYMdgbfb` as
`READY`, target `production`, ref `main`, SHA
`526c4a5e97ea1b1a971e485177b39cfe758d1e00`, with its alias assigned and no alias error. The public
control-plane response body was still unreachable from this host, so this provider readback does not
replace the endpoint gate.

Both production-only Vercel kill switches were absent. They were created with literal value `false`
and independently read back with target exactly `production`:

- `AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED=false`;
- `AGT002_MODEL_CALLS_ENABLED=false`.

Vercel applies project environment changes only to subsequent deployments. No deployment was
triggered by this operation, so these values are prepared for the future gated flags-OFF deploy and
are not attributed retroactively to the currently running artifact.

## Updated decision

The decision remains `BLOCKED`; `authorizes=NOTHING`; `canary_authorized=false`. The database state,
provider-side production SHA, completed physical backup and future-deployment kill-switch posture are
now known. The remaining mandatory blockers are:

- a fresh fetch and exact SHA readback from the fixed deployment host;
- the protected INITIAL host environment with complete server-only configuration and literal OFF
  switches;
- observable INITIAL service/timer state through the host service manager;
- an isolated restore test bound to the completed backup;
- the public control-plane response body; and
- one integrated host preflight receipt in which every check passes simultaneously.

No migration, deployment, service installation, model/provider call, job admission or canary was
performed by these readbacks. C1A therefore remains before E2.
