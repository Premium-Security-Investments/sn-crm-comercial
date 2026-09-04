# AGT-002: Durable semantic checkpoints and batched integral analysis

> **Execution note:** Implement with TDD in this worktree. Keep the existing canonical persistence RPC as the only publication boundary. Do not run a real provider canary until the migration and rollback have been exercised, all targeted/full tests pass, and the runtime is deployed from the verified commit.

## Goal

Make large AGT-002 tender analyses complete without one oversized final model turn and without losing already validated provider work when a later stage fails or a worker is reclaimed.

The completed system must:

- cover every source unit during semantic discovery;
- checkpoint each validated discovery batch durably;
- checkpoint the merged semantic manifest durably;
- partition the governed requirement frontier into deterministic contiguous analysis batches;
- checkpoint each validated analysis batch durably;
- merge and validate the complete V3 analysis server-side;
- call the existing canonical append-only persistence boundary exactly once after all work is complete;
- preserve the prior canonical analysis on every failure;
- reuse only checkpoints with an exact immutable identity match;
- expose only safe stage/counter/hash metadata in logs and job status;
- never store raw prompts, raw source text, credentials, or rejected provider output in checkpoint tables.

## Incident motivating the change

The 2026-09-03 Procuraduría canary completed all 35 semantic-discovery batches. Two 285-second timeouts on one batch were recovered by the existing deterministic third attempt. After discovery, the local prompt preflight rejected the single integral-analysis request before calling the provider:

- rejection stage: `envelope`
- validation code: `v3_prompt_budget_exceeded`
- public worker result: `invalid_output`
- persistence attempts: `0`
- prior canonical analysis: preserved

The 35 successful discovery outputs lived only in process memory and cannot be recovered from the database or logs. This design prevents that loss prospectively; it cannot reconstruct those historical outputs.

A separate canary caveat must also be removed: retry jobs must retain the canonical analysis idempotency key. A rehashed retry key cannot pass `registerAgt002PreviewAnalysis`, which independently recomputes the key from snapshot, policy, model, and context. `job_id` distinguishes queue executions; the analysis idempotency key identifies the same governed analysis across attempts.

## Non-goals

- Do not weaken any V3 unit, evidence, legal, ordering, omission, or coverage invariant.
- Do not publish partial analysis.
- Do not make `strategic_consideration` mandatory. Batched mode will initially emit only the required `tender_requirement` units; strategic units are optional in the existing V3 contract and are excluded until a separately governed global synthesis design exists.
- Do not change the meaning of `GO`/`NO GO`; all output remains preliminary and human-reviewed.
- Do not promise exactly-once provider billing. A crash after provider acceptance but before checkpoint commit is not transactionally eliminable without provider-side idempotency. The system provides exactly-once durable acceptance and reuses the same provider idempotency key on retry.
- Do not alter the existing Manizales exact-manifest path or legacy/non-V3 paths.

## Existing authorities to preserve

- Semantic inventory and manifest validation: `tender-requirement-inventory.js`, `tender-semantic-manifest.js`.
- Discovery batching and stable batch identity: `tender-semantic-discovery-batches.js`.
- V3 governed analysis invariants: `agt002-integral-analysis-v3.js`.
- Model wire schema and governed assembly: `agt002-preview-contract.js`.
- Prompt budget: `agt002-v3-prompt-budget.js`.
- Final envelope and semantic-frontier finalization: `agt002-preview-engine.js`.
- Final canonical persistence: `agt002-preview-persistence.js` and `public.psi_record_agt002_canonical_analysis_run`.
- Queue lease fencing: `supabase/migrations/079_agt002_lease_heartbeat.sql` and `agt002-reanalysis-executor.js`.

## Architecture

### 1. Stable workset identity

Create one durable workset keyed by the canonical analysis `idempotency_key`. Bind it to all immutable inputs that can affect a result:

- opportunity, tender, snapshot, context version;
- model and reasoning effort;
- top-level V3 policy version;
- semantic-discovery policy/schema/planner versions;
- integral-analysis batch wire-policy/schema/planner versions;
- inventory hash and snapshot hash once discovery inventory is built;
- company-evidence identity and legal-corpus identity already present in frozen engine input;
- frozen-engine-input hash.

A repeated create with the same canonical key returns the existing workset only when every bound field agrees byte-for-byte. Any conflict fails closed. Never derive a fresh analysis key merely because a previous queue job became terminal.

### 2. Durable checkpoints

Use a child table keyed by `(workset_id, stage, batch_index)` where stage is closed to:

- `semantic_discovery_batch`
- `semantic_manifest`
- `integral_analysis_plan`
- `integral_analysis_batch`

Each completed row stores only:

- stage and batch index;
- deterministic batch/request hash;
- stage contract/policy/planner version;
- canonical validated JSON output;
- SHA-256 of that JSON;
- normalized accepted usage counts;
- provider idempotency key;
- created timestamp.

Checkpoint rows are immutable. The write RPC uses insert-or-compare semantics: an exact replay returns the existing row; a different payload under the same identity fails closed. Re-read every loaded checkpoint as untrusted data and run the same current validator/assembler against the current inventory/batch before reuse.

Raw model strings, prompts, source text, rejected output, credentials, and arbitrary error messages are prohibited.

### 3. Lease fencing and resumability

Every workset/checkpoint mutation RPC receives `job_id` and `worker_id` and requires:

- job status `running`;
- matching `lease_owner`;
- unexpired job lease;
- job canonical idempotency key equal to the workset key;
- frozen identity equal to workset identity.

The worker must heartbeat immediately before each provider attempt and immediately before every checkpoint/final persistence write.

For execution mode `durable_batched_v1`, expired running queue jobs may be reclaimed automatically as `queued` with a bounded `resume_count`; legacy jobs retain the existing terminal-expiry behavior. After the resume cap, mark the queue job unavailable but retain validated checkpoints for a future explicit job with the same canonical identity.

Provider calls are at-least-once across the crash window. Retries use the same deterministic provider idempotency key. Checkpoint acceptance is exactly once.

### 4. Discovery resumption

Extend `discoverTenderSemanticManifest` with optional async checkpoint hooks. Preserve behavior byte-for-byte when hooks are absent.

For each deterministic discovery batch:

1. compute the existing batch hash and provider idempotency key;
2. load an exact completed checkpoint;
3. if present, revalidate/canonicalize it against that batch's current units and label-owner index;
4. otherwise heartbeat, run the provider with the existing bounded retry loop, parse and canonicalize;
5. heartbeat, persist the validated batch output and usage;
6. merge all validated batch outputs using the existing global conflict/retraction/completion logic.

After the merged manifest passes `assembleTenderSemanticManifest` and the non-empty frontier boundary, persist one `semantic_manifest` checkpoint containing the validated manifest, category overrides, safe retraction counts, discovery ledger, and aggregate accepted discovery usage. On resume, validate this checkpoint against the rebuilt inventory and source documents; if valid, skip all discovery calls.

### 5. Deterministic integral-analysis batching

Add a pure planner that consumes the full governed V3 validation context and projected preview input.

Rules:

- preserve the exact existing requirement-manifest order;
- produce contiguous, non-overlapping slices covering every requirement exactly once;
- cap requirements per batch with a versioned constant chosen for useful per-requirement depth;
- build the actual batch wire schema and model input before accepting a slice;
- run the existing deterministic prompt-budget estimator on that exact request;
- if one requirement cannot fit alone, fail closed with a new allowlisted code and no provider call;
- include batch index/count, first/last governed requirement ids, request hash, and planner version in the plan;
- persist the complete validated plan before the first analysis call.

Start with a conservative `AGT002_INTEGRAL_ANALYSIS_BATCH_MAX_REQUIREMENTS` (recommended initial fixture value: 20) and a separately versioned input-token ceiling. The implementation must benchmark fixture envelopes and may choose a lower tested value; do not raise the current 120,000-token single-turn limit as the fix.

### 6. Batch input projection

For one analysis batch, construct a new object without mutating the full preview input:

- slice `requirement_manifest` to the batch ids;
- slice the governed `evidenceStateManifest` to the same ids;
- keep only `selected_chunks` whose `requirement_ids` intersect the batch ids;
- rewrite each retained chunk's `requirement_ids` to the intersection;
- derive the batch `citation_allowlist` from retained evidence refs;
- slice `coverage_manifest.by_requirement` to the batch ids;
- recompute document/type coverage counters from retained chunks rather than copying inconsistent global counters;
- keep omitted entries for batch requirement ids plus global document gaps (`requirement_id = null`);
- keep the global material-omission flag. Existing V3 semantics require every unit to abstain whenever material omissions are true;
- keep company evidence and legal evidence identities/content as governed context;
- replace full semantic inventory/manifest with the existing safe frontier summary;
- include a server-owned batch descriptor stating that this is a slice and that every listed requirement must appear exactly once.

The full preview input and full manifest remain available only for global merge/finalization and durable final evidence coverage.

### 7. Batch wire contract and server-owned fields

Do not ask each model batch to invent globally coordinated identity/order.

Add a dedicated closed batch wire schema that permits only `tender_requirement` units and excludes these server-owned fields:

- `unit_id`
- `sequence`
- `category`
- `evidence_state`
- top-level `contract_version`
- top-level `coverage`

Require exactly one model unit per batch requirement, with the exact `requirement_id` allowlist and all existing analytical fields/invariants. Disallow `strategic_consideration` in this wire contract.

The server assembles:

- deterministic `unit_id` from the governed requirement id;
- global `sequence` from the requirement's position in the full manifest;
- category from the governed category map;
- evidence state from the governed evidence-state manifest.

Refactor existing validation rather than duplicate rules:

- expose/reuse unit-shape and unit-invariant validation for a governed batch context;
- validate exact local requirement coverage for every batch;
- after concatenating batches in plan order, build the existing governed V3 `coverage` block from the full context;
- run the unchanged full `validateAgt002IntegralAnalysisV3` over the merged object.

This final pass remains authoritative for global ordering, duplicate ids, exact coverage, legal/evidence allowlists, omission abstention, and every cross-field invariant.

### 8. Final envelope and publication

After global validation:

1. aggregate accepted usage from each unique discovery and analysis checkpoint exactly once;
2. finalize `tender_semantic_manifest.analyzed_coverage` with the merged analysis;
3. build `evidence_coverage` from the original full preview input, never a batch projection;
4. build the V2 compatibility projection from the complete merged V3 result;
5. run existing envelope/domain validation;
6. heartbeat and call the unchanged `registerAgt002PreviewAnalysis` path;
7. mark the workset published only after the canonical RPC returns successfully;
8. complete the queue job with the returned analysis run id.

No checkpoint may set `canonical=true`, demote an old run, or appear in current-analysis reads.

### 9. Observability

Add safe events/counters only:

- workset created/reused;
- checkpoint hit/miss/accepted/conflict;
- stage, batch index/count, attempt, batch/request hash prefix;
- requirements in batch;
- prompt-budget original/final/minimum estimated token counts;
- aggregate accepted usage;
- resume count;
- final persistence attempt count/outcome.

Never log labels, source-unit ids, requirement ids, evidence refs, prompt text, model output, credentials, or arbitrary exception messages.

## Database changes

### Migration 081

Create `supabase/migrations/081_agt002_durable_batched_analysis.sql` and rollback companion.

Add service-role-only tables:

- `psi_agt002_analysis_worksets`
- `psi_agt002_analysis_checkpoints`

Add closed checks, foreign keys, unique keys, JSON object checks, non-negative usage checks, timestamps, and immutable-update/delete triggers. Allow only the narrow publication marker transition through a security-definer RPC.

Add security-definer RPCs:

- `psi_get_or_create_agt002_analysis_workset(...)`
- `psi_get_agt002_analysis_workset(...)`
- `psi_list_agt002_analysis_checkpoints(...)`
- `psi_record_agt002_analysis_checkpoint(...)`
- `psi_mark_agt002_analysis_workset_published(...)`

All writes are lease-fenced. Read RPCs return only rows for the supplied canonical identity and are executable only by `service_role`.

Extend `psi_agt002_reanalysis_jobs` minimally for safe progress/resume:

- `execution_mode text not null default 'single_turn_v1'`
- `phase text null` with closed values
- safe integer progress counters
- `resume_count integer not null default 0`

Update enqueue/claim/heartbeat/complete/fail RPCs and immutable trigger allowlists. Old rows and old frozen schema stay valid and retain current behavior. New runtime jobs use `durable_batched_v1`; UI callers cannot choose or forge the mode.

Rollback must refuse if durable-batched worksets/jobs exist unless they are terminal and explicitly archived, so rollback cannot silently strand resumable work.

## Implementation tasks

### Task 1: Database contracts first

**Files**

- Create: `supabase/migrations/081_agt002_durable_batched_analysis.sql`
- Create: `supabase/rollbacks/081_agt002_durable_batched_analysis_rollback.sql`
- Create: `tests/agt002-durable-batched-analysis-migration.test.mjs`
- Update: `tests/agt002-reanalysis-lease-heartbeat-migration.test.mjs`

**Steps**

1. Write failing static/runtime migration tests for grants, RLS/table revocation, immutability, exact replay, conflicting replay, lease fencing, stable key reuse, and bounded reclaim.
2. Implement tables/RPCs/triggers.
3. Apply migrations 068→081 to an isolated PostgreSQL/Supabase test database.
4. Exercise forward, RPC behavior, rollback refusal, cleanup, rollback, and forward reapply.
5. Verify anonymous/authenticated roles cannot read/write artifacts.

### Task 2: Runtime checkpoint adapter

**Files**

- Create: `agt002-analysis-checkpoints.js`
- Create: `tests/agt002-analysis-checkpoints.test.mjs`
- Update: `agt002-reanalysis-executor.js`
- Update: `agt002-preview-runtime.js`

**Steps**

1. Write failing tests for exact identity, hit/miss, validation on read, insert-or-compare, conflict, lease loss, and sanitized errors.
2. Implement the Supabase RPC adapter.
3. Inject optional checkpoint hooks only for queue jobs in `durable_batched_v1`.
4. Preserve byte-identical behavior when no adapter is supplied.

### Task 3: Checkpoint semantic discovery

**Files**

- Update: `tender-semantic-discovery.js`
- Update: `tender-semantic-discovery-batches.js`
- Create/update: `tests/tender-semantic-discovery.test.mjs`
- Create/update: `tests/tender-semantic-discovery-batches.test.mjs`

**Steps**

1. Add failing tests proving completed batches are skipped, loaded outputs are revalidated, conflicts fail closed, aggregate usage counts each checkpoint once, and a validated merged manifest skips all provider calls.
2. Add optional load/store callbacks around each already-computed batch identity.
3. Persist only parsed/canonical validated outputs and safe ledger metadata.
4. Persist/revalidate the merged semantic-manifest checkpoint.
5. Keep existing no-hook tests byte-identical.

### Task 4: Pure integral batch planner and projection

**Files**

- Create: `agt002-integral-analysis-batches.js`
- Create: `tests/agt002-integral-analysis-batches.test.mjs`
- Update: `agt002-v3-prompt-budget.js` only if a pure report helper must be exported

**Steps**

1. Write failing tests for deterministic contiguous exact coverage, max requirement count, request hashes, filtered chunks/allowlists/coverage, global gaps, material omissions, singleton-too-large failure, and input immutability.
2. Implement pure batch planning and projection.
3. Assert concatenated batch ids equal the full governed manifest exactly.
4. Record only safe budget counts in plan metadata.

### Task 5: Dedicated batch wire schema and validation

**Files**

- Update: `agt002-preview-contract.js`
- Update: `agt002-integral-analysis-v3.js`
- Create: `tests/agt002-integral-analysis-batch-contract.test.mjs`
- Update: `tests/agt002-integral-analysis-v3.test.mjs`

**Steps**

1. Write failing tests rejecting model-owned id/sequence/category/evidence-state/coverage/contract metadata and all strategic units.
2. Extract reusable unit validation without weakening the full validator.
3. Build deterministic server-owned ids and global sequences.
4. Validate each batch's exact local coverage.
5. Merge batches and run the unchanged full V3 validator; add negative tests for missing/duplicate/reordered requirements, cross-batch id collision, evidence outside allowlist, and omission violations.

### Task 6: Engine orchestration

**Files**

- Update: `agt002-preview-engine.js`
- Update: `agt002-preview-runtime.js`
- Update: `agt002-analysis-observability.js`
- Create/update: `tests/agt002-preview-engine.test.mjs`
- Create/update: `tests/agt002-preview-runtime.test.mjs`

**Steps**

1. Add failing end-to-end unit tests for discovery resume, analysis resume, provider timeout/retry, lease loss before call/write, plan mismatch, full merge, and zero persistence on partial failure.
2. Replace the single discovered-frontier `runOnceV3` call with `runBatchedV3`; keep Manizales and legacy paths unchanged.
3. Heartbeat at every provider/checkpoint/persistence boundary.
4. Aggregate checkpoint usage and finalize the full envelope once.
5. Emit safe phase/progress/budget events.

### Task 7: Queue/runtime state machine

**Files**

- Update: `agt002-reanalysis-job.js`
- Update: `agt002-reanalysis-executor.js`
- Update: `agt002-reanalysis-worker.js`
- Update: `scripts/agt002-reanalysis-worker.mjs`
- Update: `tests/agt002-reanalysis-job.test.mjs`
- Update: `tests/agt002-reanalysis-executor.test.mjs`
- Update: `tests/agt002-reanalysis-worker.test.mjs`

**Steps**

1. Add frozen-input schema v2 / server-owned execution mode while accepting historical v1.
2. Ensure retries keep the canonical analysis key; never rehash it.
3. Add safe phase/progress parsing.
4. Implement bounded automatic reclaim only for durable mode.
5. Prove terminal failures preserve checkpoints and prior canonical analysis.

### Task 8: Persistence and compatibility regression

**Files**

- Update tests only unless a real defect is found:
  - `tests/agt002-preview-persistence.test.mjs`
  - `tests/agt002-v3-compatibility.test.mjs`
  - `tests/agt002-post-bridge-observability.test.mjs`

**Steps**

1. Prove the merged result passes current `registerAgt002PreviewAnalysis` without RPC signature changes.
2. Prove one canonical insert, one demotion, correct supersedes link, and idempotent replay.
3. Prove partial checkpoints are invisible to current-analysis readers.
4. Prove V2 projection and critical-open count use the complete merge.

### Task 9: Verification and controlled rollout

1. Run targeted tests after each task.
2. Run `npm test`.
3. Run migration-forward/rollback integration tests.
4. Run security/static secret scans and inspect `git diff --check`.
5. Obtain independent code review before deployment.
6. Commit and push verified code; deploy from that exact SHA.
7. Verify systemd worker/timer, runtime health, and DB migration version.
8. Enqueue one Procuraduría canary with the canonical stable idempotency key and medium effort.
9. Verify checkpoints accumulate and a deliberate worker restart resumes without repeating completed batches.
10. Let the canary finish; verify full requirement coverage, final V3 validation, one canonical append, prior run demotion only after success, and unchanged human-review gate.
11. Keep rollback ready until post-deploy observations pass.

## Required test commands

Use the repository's actual package scripts discovered at implementation time. At minimum:

```bash
node --test tests/agt002-analysis-checkpoints.test.mjs
node --test tests/tender-semantic-discovery-batches.test.mjs tests/tender-semantic-discovery.test.mjs
node --test tests/agt002-integral-analysis-batches.test.mjs tests/agt002-integral-analysis-batch-contract.test.mjs
node --test tests/agt002-integral-analysis-v3.test.mjs tests/agt002-preview-engine.test.mjs
node --test tests/agt002-reanalysis-job.test.mjs tests/agt002-reanalysis-executor.test.mjs tests/agt002-reanalysis-worker.test.mjs
node --test tests/agt002-preview-persistence.test.mjs tests/agt002-v3-compatibility.test.mjs
npm test
git diff --check
git status --short
```

## Acceptance criteria

- A fixture whose single-turn governed skeleton exceeds 120,000 estimated input tokens produces a deterministic multi-batch plan instead of `v3_prompt_budget_exceeded`.
- Every governed requirement appears exactly once in the final merged V3 analysis, in institutional order.
- Every batch request fits its tested prompt and requirement-count budgets.
- Killing the worker after any committed discovery or analysis checkpoint and reclaiming the job does not repeat completed provider batches.
- A checkpoint with any identity/hash/content mismatch is rejected before reuse.
- A partial or failed run performs zero canonical persistence attempts and leaves the prior canonical run unchanged.
- A complete run performs one final canonical persistence call and produces the same durable V3/V2 envelope semantics as the current single-turn path.
- All checkpoint tables/RPCs are service-role only and contain no raw prompt/source/rejected content.
- Logs contain only closed stage/counter/hash metadata.
- Legacy, non-V3, and Manizales paths remain regression-green.

## Operational decision for the current Procuraduría run

Do not enqueue another canary on the current code. The already completed 35 discovery outputs are unrecoverable, and another run would repeat them before hitting the same deterministic 120,000-token preflight. Implement and deploy this plan first. The first post-deploy run must repeat discovery once to populate durable checkpoints; subsequent restarts or retries with the same canonical identity can resume safely.
