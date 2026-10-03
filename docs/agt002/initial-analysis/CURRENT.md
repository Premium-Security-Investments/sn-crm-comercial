# AGT-002 Initial Analysis — Current Authorized State (P0-00)

This document describes the P0-00 guard that is authorized to run against
the AGT-002 initial-analysis worktree today. It is the single source of
truth for the frozen branch, repository root, and baseline commit literals
that the guard enforces, and for every category of violation the guard
detects. The guard implementation lives at
`scripts/agt002_initial_analysis_guard.mjs` and exports a pure function,
`runAgt002InitialAnalysisGuard(observation)`, plus a direct-execution CLI
that observes real Git state and exits fail-closed.

## Frozen identity literals

The guard compares an observation against three exact literals. None of
these are read from an environment variable or a CLI flag — they are
hardcoded in the guard module so no production invocation can point the
guard at a different branch, root, or baseline.

- Branch: `feat/agt002-initial-analysis-p0`
- Repository root: `/root/worktrees/agt002-initial-analysis-p0`
- Baseline commit: `9ec9626be21df0c7dfae5da281f8d90fda085fa1`

Any observation whose `branch`, `repoRoot`, or `baselineCommit` does not
match one of these literals exactly (case-sensitive, no trailing
whitespace, no partial match) produces a `branch_mismatch`,
`repo_root_mismatch`, or `baseline_commit_mismatch` violation, respectively.

## Guard check categories

The guard evaluates every category below on every call and accumulates all
violations it finds; it does not stop at the first failure.

1. **Branch identity** — the observed branch must equal the frozen branch
   literal exactly.
2. **Repository root identity** — the observed repository root must equal
   the frozen repo root literal exactly.
3. **Baseline commit identity** — the observed baseline commit must equal
   the frozen baseline commit literal exactly.
4. **Unexpected dirty paths** — every entry in the observed dirty-path list
   must appear on the explicit allow-list (`ALLOWED_DIRTY_PATHS`):
   `scripts/agt002_initial_analysis_guard.mjs`,
   `docs/agt002/initial-analysis/CURRENT.md`,
   `tests/agt002-initial-analysis-guard.test.mjs`, and `package.json`. Any
   other dirty path is flagged. The CLI observes Git via
   `git status --porcelain=v1 -z --untracked-files=all`, so a new untracked
   directory is expanded into one record per file inside it rather than a
   single collapsed directory path — an allow-listed file under such a
   directory is recognized as allowed while any unallowed sibling in that
   same directory is still individually flagged.
5. **Production env/secret declarations** — any changed file that looks
   like a real dotenv file (for example `.env.production`) or a named
   secret-declaration file, and whose content contains an actual
   `KEY=value` assignment with a concrete value rather than an unfilled
   stand-in such as `REPLACE_ME`, `CHANGE_ME`, or an angle-bracket token,
   is flagged. Example/sample/template files (such as `env.example`) are
   not flagged.
6. **Reanalysis references in initial-analysis source** — any changed
   production/runtime module or SQL file (`.js`, `.mjs`, `.cjs`, `.ts`,
   `.tsx`, or `.sql`) whose path identifies it as belonging to the
   initial-analysis surface is flagged if its content references a
   reanalysis operational module (`agt002-reanalysis-api.js`,
   `agt002-reanalysis-jobs.js`, `agt002-reanalysis-worker.js`,
   `agt002-reanalysis-input.js`, `agt002-reanalysis-executor.js`,
   `agt002-reanalysis-error-message.js`), the reanalysis jobs table
   (`psi_agt002_reanalysis_jobs`), or a reanalysis RPC
   (`psi_create_agt002_reanalysis_job`, `psi_claim_agt002_reanalysis_job`,
   `psi_complete_agt002_reanalysis_job`, `psi_fail_agt002_reanalysis_job`).
   The initial-analysis slice must not couple to the reanalysis operational
   surface. The guard's own source, anything under `tests/` or `docs/`, and
   any `*.test.*`/`*.spec.*` file are excluded from this scan, since they
   legitimately reference these same literals as detection data or
   fixtures rather than as a production coupling.
7. **Install manifest modifications** — any dirty path or changed file
   path ending in `.service` or `.timer`, or named exactly `crontab`, is
   flagged, since these files install or schedule long-running processes
   (systemd units, timers, cron entries) and must not change inside this
   P0 slice. Plain runner scripts (for example a `.mjs` entrypoint invoked
   by one of those manifests) are not themselves flagged.

## Bypass posture

There is no environment variable and no CLI flag that overrides the
frozen branch, repository root, or baseline commit. The only sanctioned
way to exercise the guard against non-default values is calling the
exported `runAgt002InitialAnalysisGuard` function directly with explicit
arguments, which is how the guard's own test suite exercises the rejection
paths. The CLI entrypoint always observes the real repository through
fixed-argv Git invocations (no shell interpolation) and exits non-zero on
any violation, including when a Git invocation itself fails — the guard
fails closed rather than passing on an unreadable repository.

## Package script

`npm run check:agt002-initial-analysis-guard` runs the CLI entrypoint
(`node scripts/agt002_initial_analysis_guard.mjs`) against the current
working tree.

## P0-06 — canonical persistence closure (2026-10-03)

P0-06 extends the isolated INITIAL path without changing the frozen P0-00 identity literals. Its
local contract is:

- only a claimed INITIAL job with a valid lease/fence may complete;
- the job must carry workflow, G1 authorization, frozen package and policy bindings before any
  model work starts, and the atomic completion RPC independently requires that G1 authorization to
  be `CONSUMED`;
- exactly one synthesis checkpoint exists per job and its stored output must equal the completion
  envelope;
- one atomic RPC creates the analysis run and immutable aggregate version, marks the job completed
  and advances the INITIAL workflow, or commits none of those changes;
- retrying the identical completion is idempotent, while a changed run identity, envelope, lineage
  or binding fails closed;
- a failed job never publishes a partial aggregate and malformed optional workflow metadata cannot
  prevent the job itself from reaching `FAILED`;
- completion does not reinterpret the expiry of an authorization already consumed validly before a
  long-running analysis.

The migration and rollback remain unapplied. No service manifest, timer, production environment,
REANALYSIS queue, REANALYSIS RPC or live opportunity is changed by this closure. Verification is
recorded in `docs/evidence/2026-10-03-agt002-initial-analysis-p0-06-verification.md`.

## Atomic G1/job admission closure (2026-10-03)

Migration 101 closes P0-06's remaining admission gate without changing the frozen P0-00 identity
literals. `psi_admit_authorized_agt002_initial_analysis_job` is now the only admission RPC exposed
to `service_role`: it re-verifies the exact INITIAL workflow/G1/package bindings, consumes G1 and
creates the durable job in one transaction, and reconstructs `payload.persistence` server-side.
Any admission conflict rolls the G1 consumption back; an exact replay returns the same job.

The migration and rollback remain unapplied. The legacy migration-099 admission function remains an
internal implementation primitive but is no longer executable by `service_role` while migration
101 is installed. Verification is recorded in
`docs/evidence/2026-10-03-agt002-initial-analysis-atomic-admission-verification.md`.
