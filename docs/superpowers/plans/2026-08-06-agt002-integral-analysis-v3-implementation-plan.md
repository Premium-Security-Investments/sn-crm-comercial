# AGT‑002 Integral Analysis Contract v3 — Implementation Plan

> **For Hermes:** Execute task-by-task with strict RED → GREEN → regression. Use direct Claude Code CLI Sonnet for implementation when available; use GPT fallback if Claude is unavailable. Preserve one independent review at the end of the block.

**Execution status (2026-08-07):** implemented locally through Tasks 1–10 plus the audited category/five-axis provenance gaps and the subsequently approved real five-phase UI. Flag remains off; no real case, remote migration, push, PR or deploy was performed. Exact evidence is in `docs/verification/2026-08-07-agt002-integral-v3-local.md`.

**Goal:** Introduce a closed, evidence-or-abstention AGT‑002 v3 contract whose canonical source is one ordered analysis unit per governed requirement, while preserving immutable v2 history and generating a deterministic v2 compatibility projection.

**Architecture:** Add pure v3 validators and projection first. Extend the existing Preview contract/engine behind a fail-closed flag. The model returns only `integral_analysis`; the engine attaches governed run/context/coverage/corpus metadata, derives the v2 projection, and persists both atomically in the existing append-only run JSON. Existing v2 readers remain unchanged; v3-aware readers receive an optional extension. No UI or production activation in this block.

**Tech Stack:** Node.js ESM, JSON-schema-shaped provider output, Node test runner, Supabase/PostgreSQL JSONB and existing RPCs, Express/Vercel parity, React TypeScript types only where needed.

**Approved design:** `docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-design.md`

**Audit:** `docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-audit.md`

---

## Execution rules

1. Work only in an isolated successor branch/worktree from `feat/agt002-v3-foundations`; never on `main`.
2. Every behavior change starts with a focused failing test and records the expected failure.
3. `AGT002_INTEGRAL_CONTRACT_V3` defaults off and accepts only the project’s existing explicit true literals.
4. Provider/model output never owns run identity, snapshot/context/corpus versions, coverage, usage or v2 projection.
5. V2 runs are immutable; no backfill and no relabeling.
6. Each manifest requirement appears exactly once in v3 or the run is rejected.
7. Evidence or abstention is mandatory; citations remain allowlisted.
8. No AI path may decide GO/NO-GO, approve, assign a person, sign, send or submit.
9. Keep `server/index.js` and `api/[...path].js` byte-identical after backend changes.
10. No remote migration, real expediente, push, PR, deploy or feature activation in this plan.

## Common verification

```bash
node --test --test-concurrency=1 tests/<focused>.test.mjs
node --test --test-concurrency=1 tests/agt002-*.test.mjs
npm run check:backend-parity
npm run build
git diff --check
node --test --test-concurrency=1 tests/*.test.mjs
```

Classify the full-suite result against the known baseline before claiming regression success.

---

### Task 1: Add fail-closed v3 feature flag

**Files:**
- Modify: `agt002-analysis-config.js`
- Modify: `tests/agt002-analysis-config.test.mjs`

**Step 1 — RED**

Add assertions that:

- unset, empty, malformed and unsupported values produce `integralContractV3: false`;
- only supported true literals enable it;
- v3 cannot be enabled unless canonical-only, context v2 and document retrieval are enabled;
- legal-corpus absence is allowed but forces legal abstention rather than false support.

Run:

```bash
node --test --test-concurrency=1 tests/agt002-analysis-config.test.mjs
```

Expected: FAIL because the new flag/property does not exist.

**Step 2 — GREEN**

Add `AGT002_INTEGRAL_CONTRACT_V3` to the existing immutable config builder and dependency checks. Do not wire behavior yet.

**Step 3 — verify and commit**

```bash
node --test --test-concurrency=1 tests/agt002-analysis-config.test.mjs
git diff --check
git add agt002-analysis-config.js tests/agt002-analysis-config.test.mjs
git commit -m "feat(agt002): add fail-closed v3 contract flag"
```

---

### Task 2: Define closed v3 constants and structural validator

**Files:**
- Create: `agt002-integral-analysis-v3.js`
- Create: `tests/agt002-integral-analysis-v3.test.mjs`

**Step 1 — RED: minimal valid fixture**

Create a synthetic manifest with one requirement in each formal category plus one strategic consideration. Test a valid payload with exact keys and `contract_version: agt002-integral-analysis-v3`.

**Step 2 — RED: closed shape and ordering**

Reject:

- any unknown key at any nesting level;
- unknown enum;
- duplicate `unit_id`, `requirement_id`, evidence ref or missing ID;
- non-increasing sequence;
- category order violation;
- strategic consideration with requirement ID;
- formal requirement without allowlisted ID;
- formal requirement categorized strategic;
- any unit missing either `commercial_impact` or `legal_assessment`, including units that must abstain in one of those components.

Run and confirm failure because module is absent.

**Step 3 — GREEN**

Implement immutable enum sets, exact-key helpers and `validateAgt002IntegralAnalysisV3(value, validationContext)`. Validation context supplies the ordered requirement manifest and company-evidence catalog/version; do not read globals or database state.

**Step 4 — verify and commit**

```bash
node --test --test-concurrency=1 tests/agt002-integral-analysis-v3.test.mjs
git diff --check
git add agt002-integral-analysis-v3.js tests/agt002-integral-analysis-v3.test.mjs
git commit -m "feat(agt002): define closed integral analysis v3 contract"
```

---

### Task 3: Enforce evidence, abstention and five-axis invariants

**Files:**
- Modify: `agt002-integral-analysis-v3.js`
- Modify: `tests/agt002-integral-analysis-v3.test.mjs`

**Step 1 — RED: evidence or abstention**

Add tests rejecting:

- compliance/non-compliance without an allowlisted relevant citation;
- citation outside source-specific allowlist;
- source type/purpose mismatch;
- `insufficient_evidence` without abstention and a missing-evidence item;
- abstention with high confidence;
- false complete coverage when input reports material omissions;
- assessed unit whose required evidence was materially omitted.

**Step 2 — RED: independent axes**

Reject reviewed evidence when absent; valid/expired evidence when absent; compliance when not reviewed; material compliance with expired/unknown validity; compliance with unknown applicability. Prove that changing presence alone never mutates other fields.

**Step 3 — RED: legal/operational controls**

Reject:

- non-curable blocker without tender/legal support;
- verified milestone without date/source;
- nominal person identifiers or `external_side_effect: true`;
- missing escalation for defined critical conditions;
- human validation other than `{required:true,status:"pending"}`;
- definitive model-produced states such as `compliant`, `sufficient` or `approved`;
- action whose `basis_unit_id` does not match its containing unit;
- raw evidence/excerpt/content and prohibited sensitive keys.

**Step 4 — GREEN**

Implement source-specific allowlist validation, cross-field invariant functions, bounded strings/arrays and sensitive-key rejection. Return the same validated object; never normalize invalid states silently.

**Step 5 — verify and commit**

```bash
node --test --test-concurrency=1 tests/agt002-integral-analysis-v3.test.mjs
git diff --check
git add agt002-integral-analysis-v3.js tests/agt002-integral-analysis-v3.test.mjs
git commit -m "feat(agt002): enforce evidence-or-abstention v3 invariants"
```

---

### Task 4: Build deterministic v2 compatibility projection

**Files:**
- Create: `agt002-v3-compatibility.js`
- Create: `tests/agt002-v3-compatibility.test.mjs`
- Read/retain: `tender-analysis-domain.js`

**Step 1 — RED**

Test exact derivation of:

- `recommendation`, `summary`, `strengths`, `weaknesses`, `blockers`, `questions`, `unverified`, `next_action`, `human_review_required`;
- stable finding IDs and ordering;
- deterministic `summary` composed from counts/unit IDs rather than model prose;
- `next_action` copied only from a validated action whose `basis_unit_id` identifies its source unit;
- one critical question per counted critical unit;
- no new evidence references;
- same output on repeated calls and irrelevant object-key reordering;
- `advance` impossible with critical abstention/material omission;
- model-supplied legacy keys rejected before projection.

**Step 2 — GREEN**

Implement `projectAgt002IntegralV3ToV2(integralAnalysis)`. Keep it pure and deterministic. Validate the projection with `validateTenderAnalysisResult` plus the existing closed finding rules.

**Step 3 — verify and commit**

```bash
node --test --test-concurrency=1 tests/agt002-v3-compatibility.test.mjs
git diff --check
git add agt002-v3-compatibility.js tests/agt002-v3-compatibility.test.mjs
git commit -m "feat(agt002): derive deterministic v2 projection from v3"
```

---

### Task 5: Add v3 provider output schema and version-dispatched validation

**Files:**
- Modify: `agt002-preview-contract.js`
- Modify: `tests/agt002-preview-contract.test.mjs`
- Modify: `agt002-tender-adapter.js`
- Modify: `tests/agt002-tender-analysis-contract.test.mjs`

**Step 1 — RED**

Require a v3 output schema that exposes only `integral_analysis` to the model and uses input-derived enums/allowlists. Test that run metadata, usage, coverage, corpus IDs and legacy fields are not provider-writable.

Test version dispatch:

- v2 validator remains byte-for-byte behavior compatible;
- v3 validator calls the pure v3 validator with manifest/allowlists;
- unknown versions fail closed;
- adapter/presenter can distinguish v2 from v3 without accepting a hybrid.

**Step 2 — GREEN**

Add new v3 schema builder and validator functions; do not weaken or broaden existing v2 exact-key functions. Use explicit dispatch keyed by configured contract version, not duck typing.

**Step 3 — contract regression**

```bash
node --test --test-concurrency=1 tests/agt002-preview-contract.test.mjs tests/agt002-tender-analysis-contract.test.mjs
```

**Step 4 — commit**

```bash
git diff --check
git add agt002-preview-contract.js agt002-tender-adapter.js tests/agt002-preview-contract.test.mjs tests/agt002-tender-analysis-contract.test.mjs
git commit -m "feat(agt002): validate provider-native v3 analysis output"
```

---

### Task 6: Assemble governed v3 envelope in the engine

**Files:**
- Modify: `agt002-preview-engine.js`
- Modify: `agt002-preview-input.js`
- Modify: `tests/agt002-preview-engine.test.mjs`
- Modify: `tests/agt002-preview-input.test.mjs`

**Step 1 — RED**

With flag off, assert the exact v2 provider schema/prompt/envelope remains unchanged.

With flag on, assert:

- provider receives the v3-only schema;
- prompt specifies ordered categories, evidence-or-abstention, five independent axes and no authority;
- engine validates against manifest and source allowlists;
- input carries the exact 17-class company-evidence manifest and all five independent statuses from `agt002-company-evidence-classes.js`, rather than the compressed dossier signal;
- engine, not provider, attaches run/snapshot/context/policy/coverage/corpus/usage;
- engine derives v2 projection after validation;
- legal corpus absent forces legal abstention/review;
- provider attempts to forge governed fields fail.

**Step 2 — GREEN**

Add explicit v2/v3 branch after prepared input and before provider call. Reuse existing evidence-ID collection and safe error mapping. Add v3-safe error codes without logging payload content.

**Step 3 — verify and commit**

```bash
node --test --test-concurrency=1 tests/agt002-preview-input.test.mjs tests/agt002-preview-engine.test.mjs
git diff --check
git add agt002-preview-engine.js agt002-preview-input.js tests/agt002-preview-engine.test.mjs tests/agt002-preview-input.test.mjs
git commit -m "feat(agt002): assemble governed v3 analysis envelope"
```

---

### Task 7: Persist v3 plus projection atomically and preserve v2

**Files:**
- Modify: `agt002-preview-persistence.js`
- Modify: `tender-analysis-foundation.js`
- Modify: `tests/agt002-preview-persistence.test.mjs`
- Create/Modify: `tests/agt002-v3-persistence-pglite.integration.test.mjs`

**Step 1 — RED: pure persistence boundary**

Test:

- v2 `CONTENT_KEYS` behavior unchanged;
- v3 permits `integral_analysis` only after validation and includes deterministic projection;
- context/corpus/coverage IDs come from governed context, not payload;
- `critical_open_count` derives from v3 and equals projected critical questions;
- validation/projection failure makes zero RPC calls;
- policy/schema version bump changes idempotency identity for same snapshot/context.

**Step 2 — RED: PGlite coexistence**

Seed one historical v2 canonical run, then record/promote v3. Assert:

- v2 JSON remains byte-identical;
- v3 supersedes v2 without mutation;
- one completed canonical run remains;
- exact replay returns original v3;
- concurrent promotions preserve uniqueness;
- current reader returns v3; historical lookup returns v2.

**Step 3 — GREEN**

Extend the allowlist and explicit version dispatch. Reuse migration 063 RPC and existing columns; do not add a migration unless a failing test proves a schema requirement. If a migration becomes necessary, stop and obtain a separate migration design/review gate before writing SQL.

**Step 4 — verify and commit**

```bash
node --test --test-concurrency=1 tests/agt002-preview-persistence.test.mjs tests/agt002-v3-persistence-pglite.integration.test.mjs
git diff --check
git add agt002-preview-persistence.js tender-analysis-foundation.js tests/agt002-preview-persistence.test.mjs tests/agt002-v3-persistence-pglite.integration.test.mjs
git commit -m "feat(agt002): persist v3 analysis with v2 compatibility"
```

---

### Task 8: Wire backend configuration without UI changes

**Files:**
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify/Create: `tests/agt002-preview-runtime.test.mjs`
- Modify: `src/tenders/types.ts` only to add optional read-only v3 types if compile requires it
- Do not modify: tender UI components

**Step 1 — RED**

Test:

- flag off calls v2 path exactly;
- flag on passes v3 mode and immutable context version;
- API returns existing v2 top-level fields plus optional `integral_analysis`;
- no request parameter can enable v3;
- GO/NO-GO routes and permission gates are unchanged;
- Express/Vercel route behavior is identical.

**Step 2 — GREEN**

Inject config into existing engine factories. Keep v3 server-controlled. Add types only for compile-time optional extension; do not render it.

**Step 3 — verify and commit**

```bash
node --test --test-concurrency=1 tests/agt002-preview-runtime.test.mjs
npm run check:backend-parity
npm run build
git diff --check
git add server/index.js 'api/[...path].js' tests/agt002-preview-runtime.test.mjs src/tenders/types.ts
git commit -m "feat(agt002): wire integral v3 contract behind server flag"
```

Omit `src/tenders/types.ts` from staging if unchanged.

---

### Task 9: Run synthetic end-to-end contract gate

**Files:**
- Create: `tests/fixtures/agt002-v3-synthetic-responder.mjs`
- Create: `tests/agt002-v3-synthetic-end-to-end.test.mjs`
- Modify: synthetic fixtures only as required

**Step 1 — RED**

Create a fully synthetic case containing:

- one discard cause;
- one habilitating license with presence but unknown applicability;
- one technical partial;
- one financial/contract-execution gap;
- one strategic consideration;
- one expired company evidence item;
- one legal citation requiring human review;
- one material missing evidence item.

Assert ordered units, evidence/abstention, derived v2 projection, critical count, persistence and historical coexistence.

**Step 2 — GREEN**

Add only fixture/responding glue needed to drive real contract/engine/persistence functions. No special test-only branches in production code.

**Step 3 — verify and commit**

```bash
node --test --test-concurrency=1 tests/agt002-v3-synthetic-end-to-end.test.mjs
git diff --check
git add tests/fixtures/agt002-v3-synthetic-responder.mjs tests/agt002-v3-synthetic-end-to-end.test.mjs
git commit -m "test(agt002): prove integral v3 synthetic flow"
```

---

### Task 10: Regression, independent review and handoff

**Files:**
- Modify: `CURRENT.md`
- Create: `docs/verification/2026-08-XX-agt002-integral-v3-local.md`
- Modify production code/tests only for review findings

**Step 1 — focused suite**

```bash
node --test --test-concurrency=1 tests/agt002-*.test.mjs
```

Require zero AGT‑002 failures.

**Step 2 — parity/build/security**

```bash
npm run check:backend-parity
npm run build
npm audit --omit=dev
git diff --check
```

**Step 3 — full baseline classification**

```bash
node --test --test-concurrency=1 tests/*.test.mjs
```

Compare failures with the recorded baseline; reproduce any disputed failure on a clean `origin/main` worktree.

**Step 4 — independent review**

Review scope:

- v2 history/behavior compatibility;
- evidence-or-abstention and five-axis invariants;
- citation allowlists and minimization;
- projection determinism;
- authority boundaries;
- idempotency/canonical concurrency;
- flag-off equivalence.

Fix P0/P1, rerun affected tests, then rerun the complete final gate once.

**Step 5 — documentation and commit**

Record exact commands, timestamps, exit codes, baseline classification, review verdict, known non-blockers and no-production statement. Update `CURRENT.md` as branch-only/not deployed.

```bash
git add CURRENT.md docs/verification/2026-08-XX-agt002-integral-v3-local.md
git commit -m "docs(agt002): record integral v3 local gate"
git status --short --branch
```

**Final gate:** clean worktree; no push/PR/deploy/migration; v3 flag remains off; next human gate chooses whether to run an E5 controlled case and then design UI.
