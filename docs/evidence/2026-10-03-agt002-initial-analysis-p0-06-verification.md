# AGT-002 INITIAL P0-06 — local verification receipt

**Date:** 2026-10-03

**Branch:** `feat/agt002-initial-analysis-p0`

**Baseline:** `9ec9626be21df0c7dfae5da281f8d90fda085fa1`

**Pre-verification HEAD:** `c471acbb89f339f51636810e53ec796ffcba3d33`

**Environment:** isolated local worktree; no production migration or deployment

**Verdict:** PASS for the P0-06 focused scope; full repository suite is not green in this restricted sandbox

## Scope verified

- atomic creation of the first INITIAL analysis run and immutable aggregate version;
- terminal job transition and INITIAL workflow promotion in the same transaction;
- lease/fence ownership, one canonical first run and append-only lineage invariants;
- exact binding of the completion envelope to the durable synthesis checkpoint;
- exact/idempotent replay and rejection of divergent replay;
- consumed G1 authorization, workflow, opportunity, tender, package and policy identity bindings;
- failure persistence that does not publish partial canonical output;
- JS adapter validation and derivation of canonical envelope SHA-256;
- executor/worker handoff of the synthesis envelope and early rejection of missing persistence bindings;
- rollback shape and absence of coupling to the REANALYSIS operational surface.

## Focused evidence

Command:

```text
npm run test:agt002-initial-analysis-canonical-persistence
```

Result: seven test files passed. The PGlite suite exercised 42 database scenarios, including exact
checkpoint replay, transaction rollback, authorization consumption, workflow identity, malformed
optional failure metadata and canonical replay.

The immutable `pre_go_analysis.v1` schema hash remained:

```text
a53cac700826968ef4da71b3f4b6866db9553126078879540f6c2e28f6f9edf1
```

## Compile and bundle evidence

The type checker and bundler passed independently:

```text
./node_modules/.bin/tsc
./node_modules/.bin/vite build
```

The composite `npm run build` could not complete in this sandbox because the pre-build deployment
safety test invokes a child Node process and the environment rejects `spawnSync /usr/bin/node` with
`EPERM`. Running the underlying Katherine permission checker directly in a clean environment
completed successfully and produced its deterministic JSON result. This is recorded as an
environmental verification limitation, not as a green composite build.

## Full-suite evidence

Command:

```text
npm test
```

Result: 724 test files, 680 passed and 44 failed. The P0-06/INITIAL files passed within that run.
Observed failures were on unrelated tests whose harnesses require either binding a local HTTP socket
(`listen EPERM 127.0.0.1`) or spawning a child Node process (`spawnSync /usr/bin/node EPERM`), both
denied by this execution sandbox. Because the aggregate command exited non-zero, this receipt does
not claim that the full repository suite passed.

## Production and operational readback

- migration `100_agt002_initial_analysis_canonical_persistence.sql`: **not applied**;
- rollback: **not executed** against a shared or persistent database;
- INITIAL service/timer: **not installed or started**;
- REANALYSIS worker/timer: **not modified or restarted**;
- Cali job and checkpoints: **not modified**;
- external systems and real-data opportunities: **not written**.

## Residual gates

1. Re-run the composite build and full suite in an environment that permits the repository's local
   sockets and subprocess harnesses.
2. Keep migration 100 unapplied until an explicit environment/migration gate exists.
3. Complete the server-side INITIAL admission path so workflow authorization consumption and job
   creation are one governed transition; P0-06 validates those bindings again at completion but does
   not itself create the job.
4. Do not infer authority to recover Cali, enable timers, process another opportunity or open R1.
