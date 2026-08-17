# AGT-002 canonical reanalysis: durable asynchronous execution

**Goal:** Replace the synchronous canonical AGT-002 V3 analysis request with a durable, human-triggered queue whose worker runs directly on Hetzner, outside Vercel's 180-second function limit.

**Scope:** Local implementation only. No remote migration, production secret change, host installation, push, PR, merge, or deploy.

**Non-negotiable invariants**

- Human POST keeps authentication, `ACTIONS.AI_ANALYSIS_RUN`, fixed snapshot/context, and deterministic idempotency.
- POST returns quickly with `202 queued`; it never calls the provider in canonical-only mode.
- A Node worker executed directly on Hetzner claims at most one job per invocation and calls the existing preview engine exactly once.
- No automatic retry and no rules fallback.
- Existing canonical analysis remains unchanged on timeout, provider error, invalid output, persistence failure, or lease loss.
- Job table/RPCs are `service_role` only; frozen input and raw error details are never returned to the browser.
- The UI polls safe status and reloads the analysis exactly once only after `completed`.
- No GO/NO-GO decision, bid submission, external message, or human authorization is automated.
- `server/index.js` and `api/[...path].js` remain behaviorally identical.

## Architecture

1. `POST /api/tender-documents-analyze-agent-preview` performs the existing fast governed preparation: auth/RBAC, opportunity/tender checks, document refresh token, current document load, immutable snapshot registration, context-version registration, legal corpus/governance resolution, and deterministic idempotency key.
2. For canonical-only mode it serializes a closed, versioned `frozen_engine_input` containing the exact non-secret engine input that cannot be reconstructed later from immutable IDs without drift. This intentionally includes the snapshot document payload and company profile used at enqueue time. Treat that JSONB as sensitive operational data: it is reachable only through the service-role-only table/RPC surface and must never appear in GET responses, UI payloads, logs, or user-visible errors. Frozen legal/governance/manifest values likewise prevent drift.
3. An idempotent RPC creates/reuses one durable `psi_agt002_reanalysis_jobs` row and the POST responds `202` with safe identifiers/status.
4. `ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs` runs directly on Hetzner under a hardened systemd oneshot/timer. It uses Supabase service-role credentials from an EnvironmentFile, claims one job with a lease, reconstructs the existing preview runtime from frozen inputs, and delegates the sole analysis/persistence frontier to `runAgt002PostBridgeAnalysis`.
5. The worker marks the queue job `completed` or terminal `unavailable`; it does not retry automatically. Lease mismatch/staleness cannot overwrite terminal state.
6. `GET /api/agt002-reanalysis-status?opportunity_id=...` authenticates and returns only allowlisted state metadata. The UI polls until terminal and reloads artifacts once on completion.

## Rejected alternatives

- Reusing `psi_tender_processing_jobs`: its multi-phase import workflow is not an atomic manual reanalysis queue.
- Reusing Mesa Vig-IA jobs: different contract/model and 45-second response semantics.
- systemd `curl` to a Vercel worker endpoint: moves the trigger but leaves the expensive provider call under the same 180-second ceiling.
- Loading legal/governance context live in the worker: current loaders select `published/current`, not immutable IDs, so they can drift after enqueue.

## Task 1 — RED/GREEN: durable queue schema and RPCs

**Create**
- `supabase/migrations/068_agt002_reanalysis_jobs.sql`
- `supabase/rollbacks/068_agt002_reanalysis_jobs_rollback.sql`
- `tests/agt002-reanalysis-jobs-pglite.integration.test.mjs`
- `tests/agt002-reanalysis-rollback-safety.test.mjs`

**Requirements**
- Table fields: IDs/references, deterministic idempotency key, `frozen_engine_input` JSONB, `queued|running|completed|unavailable`, lease tuple, `requested_by`, terminal `analysis_run_id` or closed error code, timestamps.
- Frozen identity/input columns are immutable after insert.
- Partial unique active-job rule and claimable index.
- Security-definer create/claim/complete/fail RPCs with fixed `search_path`, service-role-only execution, `FOR UPDATE SKIP LOCKED`, bounded lease, and no automatic requeue/retry.
- Rollback refuses while active jobs exist and does not delete completed history silently.

**Verify RED then GREEN**
```bash
node --test tests/agt002-reanalysis-jobs-pglite.integration.test.mjs tests/agt002-reanalysis-rollback-safety.test.mjs
```

## Task 2 — RED/GREEN: persistence adapter and worker orchestration

**Create**
- `agt002-reanalysis-jobs.js`
- `agt002-reanalysis-worker.js`
- `tests/agt002-reanalysis-jobs.test.mjs`
- `tests/agt002-reanalysis-worker.test.mjs`

**Requirements**
- Closed job/frozen-input validation.
- Exactly one claim and at most one `engine.analyze` path per `runOnce`.
- Reuse `createAgt002PreviewRuntime` and `runAgt002PostBridgeAnalysis`; do not fork engine validators or canonical persistence.
- Completed job requires a real canonical run ID.
- Any safe terminal failure becomes `unavailable`, keeps prior canonical, and performs no retry/fallback.
- Raw provider/model/DB messages never persist or log.

## Task 3 — RED/GREEN: enqueue/status API and backend parity

**Create/modify**
- `agt002-reanalysis-api.js` (pure shared helpers where practical)
- `server/index.js`
- `api/[...path].js`
- `tests/agt002-reanalysis-endpoint.test.mjs`
- `tests/agt002-reanalysis-status.test.mjs`

**Requirements**
- Canonical-only POST enqueues before any bridge/provider call and returns `202`.
- Existing completed idempotency result is reused safely.
- Duplicate clicks reuse the same job and never create a second active execution.
- Status GET checks auth, permission, and opportunity access; exposes only `job_id,status,created_at,started_at,completed_at,analysis_run_id,error_code`.
- Noncanonical and disabled paths retain existing fail-closed semantics unless tests prove an intentional change.

## Task 4 — RED/GREEN: direct Hetzner worker artifact

**Create**
- `ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs`
- `ops/agt002-reanalysis-worker/agt002-reanalysis-worker.service`
- `ops/agt002-reanalysis-worker/agt002-reanalysis-worker.timer`
- `ops/agt002-reanalysis-worker/env.example`
- `ops/agt002-reanalysis-worker/README.md`
- `tests/agt002-reanalysis-worker-systemd.test.mjs`

**Requirements**
- Direct Node execution, never HTTP back into Vercel.
- Hardened oneshot unit, no overlap, explicit timeout above provider budget, secret EnvironmentFile, no secret output.
- One job per invocation; timer cadence does not imply a model call when queue is empty.
- Installation remains documentation only under this local scope.

## Task 5 — RED/GREEN: UI polling and reload-once

**Create/modify**
- `src/api.ts` types/client helpers as needed
- `src/main.tsx`
- a small pure status helper under `src/tenders/`
- `tests/agt002-reanalysis-ui.test.mjs`

**Requirements**
- Button immediately shows `queued`, then `running` while polling.
- Duplicate click is disabled while active.
- `completed` triggers exactly one artifact reload and clears polling.
- `unavailable` shows an actionable, non-technical message and keeps prior analysis visible.
- Poll cleanup on unmount/opportunity change; no infinite polling.

## Task 6 — migration runner/parity and local verification

- Register migration/rollback markers in the existing AGT-002 migration runner if required by repository convention.
- Keep API/Express mirrors identical and run backend parity after every route change.
- Run focused tests, all AGT-002 tests, build, and static secret scan.

```bash
node --test --test-concurrency=1 tests/agt002-reanalysis-*.test.mjs
npm run check:backend-parity
node --test --test-concurrency=1 tests/agt002-*.test.mjs
npm run build
git diff --check
git status --short
```

## Review gates

1. Claude Sonnet implementation under TDD.
2. Independent Claude Opus architecture/security review of the final local diff.
3. Mechanical fixes and fresh verification.
4. Stop before push, remote migration, Hetzner installation, secret configuration, or deployment; present those as a separate human gate.
