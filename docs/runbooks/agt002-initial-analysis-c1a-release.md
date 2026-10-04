# AGT-002 INITIAL C1A controlled release

This runbook advances the reduced INITIAL path from isolated E0 to an E2 deployment with execution
off. It never authorizes or performs a canary by itself. The authoritative program receipt is
`docs/evidence/2026-10-04-agt002-r1-continuous-program-authorization.md`.

## Fixed release boundary

- Database chain: migrations `099` through `104`, in ascending order.
- Application deployment: the exact reviewed `origin/main` SHA, through
  `scripts/agt002-deploy-vercel-production.sh` only.
- Worker unit: `ops/agt002-initial-analysis-worker/agt002-initial-analysis-worker.service`.
- Scheduler: remains disabled and inactive through E2, E3 and the single E4 canary.
- Kill switches: both remain exactly `false` during migration and deployment:
  `AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED=false` and `AGT002_MODEL_CALLS_ENABLED=false`.

Stop if the repository SHA, database target, flags, worker state, backup receipt or any readback is
missing or ambiguous.

## 1. Pre-change evidence

Record without secrets:

1. reviewed commit SHA and clean worktree;
2. exact Supabase project/host identity;
3. current Vercel control-plane response;
4. timer/service enabled and active state;
5. sanitized values of the two kill switches;
6. database backup identifier and a verified restore procedure;
7. current structural state from the migration runner.

The backup evidence is a protected JSON receipt produced from the actual provider backup and an
isolated restore test. Do not create it from an assumption or from the migration runner itself. Its
closed shape is:

```json
{
  "schema_version": "agt002-c1a-backup-receipt-v1",
  "backup_id": "provider-backup-id",
  "created_at_utc": "2026-10-04T12:00:00.000Z",
  "database_host": "exact-project-ref.supabase.co",
  "integrity_verified": true,
  "restore_procedure_id": "isolated-restore-procedure-id",
  "restore_tested_at_utc": "2026-10-04T12:20:00.000Z",
  "restore_result": "PASS"
}
```

Run the consolidated, read-only host preflight from the fixed deployment worktree. It performs a
fresh `git fetch origin main`, observes the control plane and database, verifies that the INITIAL
service/timer/process are off, checks the protected environment without emitting secrets, and binds
the backup receipt to the exact database hostname:

```bash
cd /root/worktrees/siio-e6-scheduler-fix
AGT002_C1A_BACKUP_RECEIPT_FILE=/absolute/protected/agt002-c1a-backup-receipt.json \
  npm run preflight:agt002-initial-c1a
```

Only `decision: READY_FOR_E2` is a valid pre-change result. `BLOCKED`, an unobserved check, a
non-zero exit, or a missing field authorizes nothing. Even a passing receipt authorizes only
migrations `099`–`104` plus deployment with both flags OFF; it explicitly leaves the canary
unauthorized.

Use an explicit protected environment file for database access:

```bash
ENV_FILE=/absolute/protected/path npm run migrate:agt002-initial-analysis -- state
ENV_FILE=/absolute/protected/path npm run migrate:agt002-initial-analysis -- preflight
```

`preflight` is read-only. It accepts only a clean absent state, a secure contiguous prefix, or the
fully applied secure chain. Missing prerequisites, a gap, unsafe grants, missing RLS or incorrect
service-role access stop the release.

## 2. Apply and verify 099–104

Only after the pre-change evidence and backup/restore gate are complete:

```bash
ENV_FILE=/absolute/protected/path npm run migrate:agt002-initial-analysis -- apply
ENV_FILE=/absolute/protected/path npm run migrate:agt002-initial-analysis -- verify
```

The runner takes one transaction-scoped advisory lock, confirms that the structural state has not
changed since preflight, applies only the missing contiguous suffix in one transaction and performs
an independent readback. Preserve the emitted `STATE`, `PREFLIGHT_OK`, `APPLY_OK` and `VERIFY_OK`
records.

The rollback command is intentionally whole-chain and fail-closed:

```bash
ENV_FILE=/absolute/protected/path npm run migrate:agt002-initial-analysis -- rollback
```

Use it only for a failed empty installation. The SQL refuses destructive rollback once package,
workflow, job, checkpoint, lineage, run or server-owned execution evidence exists. Never delete
that evidence to force rollback.

## 3. Deploy with execution off

Follow `docs/runbooks/agt002-vercel-production-deploy.md` from its required deployment worktree.
Before invoking it, independently confirm the two kill switches are `false`, and confirm the INITIAL
timer and service are disabled/inactive. A direct `vercel --prod` invocation is prohibited.

After deployment, read back:

- exact application SHA/version from the public control plane;
- migration runner `verify` result;
- both kill switches still `false`;
- timer disabled/inactive and no INITIAL worker process;
- zero INITIAL jobs, workflows, authorizations, checkpoints, lineages and aggregate versions created
  by the release operation.

Any mismatch is stop-on-fail. Do not open E3 or create a canary job.

## 4. Handoff to E3/E4

E2 closes only when all readbacks match the receipt. E3 may then select cases read-only. E4 is a
separate single INITIAL canary with one opportunity, one click, concurrency one and no timer. Its
identity and terminal disposition must be recorded before F1 can open.

### Bounded admission for the selected E4 identity

E3 must produce one protected JSON manifest (mode `0400` or `0600`, with no group/other access)
using schema `agt002-initial-analysis-admission-v1`. It binds exactly one opportunity, tender,
authorized Licitaciones actor, G1 expiry, policy version, scope and explicit current document
versions. It must not contain credentials, extracted text, storage paths or more than one
opportunity.

After the canary window has independently read back both kill switches as `true`, admit only that
manifest from the immutable release:

```bash
node scripts/agt002-initial-analysis-admit.mjs \
  --manifest /absolute/protected/agt002-initial-analysis-e4-manifest.json
```

The command computes every package/workflow/authorization/job idempotency key server-side. It
freezes the exact evidence, records and immediately consumes G1, and creates one queued INITIAL
job. It does not claim or execute the job, scan for another opportunity, start a service, or enable
a timer. Preserve the sanitized `agt002_initial_analysis_admitted` receipt, then invoke the worker
unit exactly once and verify the admitted job reaches one terminal state. An ambiguous admission
must be resolved by readback under the same identities; never submit a different manifest as a
blind retry.

After the terminal readback, restore both kill switches to `false`, confirm the worker and timer
are inactive, and record the canonical run, lineage, aggregate version and report projection (or
the closed failure code). F1 remains closed until this disposition is complete.
