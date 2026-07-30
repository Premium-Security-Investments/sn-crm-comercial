# AGT-002 / Vig-IA Analysis Improvement Program — Implementation Plan

> **For Hermes:** Execute this plan phase-by-phase with strict test-first development. Use direct Claude Code CLI for substantive technical blocks, verify every result mechanically, and preserve one independent review at the end of the full program.

**Goal:** Make Vig-IA the immediate, observable, evidence-grounded, canonical analysis engine from tender conversion through human GO/NO-GO and into the post-GO workbench.

**Architecture:** Keep the existing durable job/snapshot/run architecture and evolve it incrementally. Conversion persists an idempotent job and dispatches bounded work immediately; the scheduler becomes reconciliation. Deterministic code produces objective validations only, while versioned Vig-IA runs consume structured opportunity/company context, retrieved document evidence, and a versioned official legal corpus.

**Tech Stack:** Node.js ESM, Express/Vercel handlers, React 19 + TypeScript + Vite, Supabase/PostgreSQL RPCs and RLS, PGlite integration tests, Node test runner, systemd scheduler, Vercel, Hetzner bridge.

**Approved design:** `docs/superpowers/specs/2026-07-29-agt002-vigia-analysis-improvement-program-design.md`

---

## Execution rules

1. Work only on `plan/agt002-vigia-analysis-improvements` or an isolated successor worktree; never implement on `main`.
2. Every behavior change follows RED → verify expected failure → GREEN → regression → commit.
3. Keep `server/index.js` and `api/[...path].js` byte-identical after backend changes.
4. Every SQL migration has a matching safe rollback and PGlite/static safety tests.
5. Preserve historical snapshots, rules runs, analysis runs, decisions, documents, and human evidence.
6. Feature flags default off/fail-closed until the phase gate is satisfied.
7. No rule result may be relabeled as a Vig-IA run.
8. No AI path may decide GO/NO-GO, approve, sign, send, or submit.
9. Never expose secrets or complete sensitive documents in logs.
10. Each production phase must include preflight, deploy, verification, and rollback evidence.

## Common verification commands

```bash
node --test tests/<focused-test>.test.mjs
npm run check:backend-parity
npm run build
git diff --check
node --test tests/*.test.mjs
```

The final suite command must be classified against baseline failures before claiming regression success.

---

# B0 — Baseline and transverse controls

### Task 1: Capture and classify the current regression baseline

**Objective:** Establish fresh evidence of pre-existing failures before behavior changes.

**Files:**
- Create: `docs/verification/2026-07-29-agt002-baseline.md`
- Read: `package.json`, `/tmp/agt002-unlimited-regression.log` when present

**Steps:**
1. Run `node --test tests/*.test.mjs > /tmp/agt002-program-baseline.log 2>&1`; record exit code.
2. Extract failing test names and classify each as pre-existing, environment-dependent, or newly reproducible.
3. Run `npm run check:backend-parity`, `npm run build`, and `git diff --check` separately.
4. Write commands, timestamps, exit codes, and failure names; do not copy secrets.
5. Commit: `docs(agt002): record analysis improvement baseline`.

**Gate:** No later phase may hide or add an unclassified failure.

### Task 2: Add fail-closed feature-flag parsing

**Objective:** Centralize all program flags with defaults off and explicit boolean parsing.

**Files:**
- Create: `agt002-analysis-config.js`
- Create: `tests/agt002-analysis-config.test.mjs`

**RED:** Test that unset/malformed values are `false`, and only supported true literals enable:
`TENDER_IMMEDIATE_DISPATCH`, `TENDER_CONTINUOUS_DRAIN`, `AGT002_CANONICAL_ONLY`, `AGT002_CONTEXT_V2`, `AGT002_DOCUMENT_RETRIEVAL`, `AGT002_LEGAL_CORPUS`.

Run: `node --test tests/agt002-analysis-config.test.mjs`
Expected: FAIL because the module does not exist.

**GREEN:** Implement one parser and immutable config builder; reject contradictory states such as retrieval/legal corpus without context v2.

Run focused test, then `git diff --check`.

Commit: `feat(agt002): add fail-closed analysis program flags`.

### Task 3: Wire flags without changing behavior

**Objective:** Inject configuration into worker and API factories while every flag remains off.

**Files:**
- Modify: `tender-processing-worker.js`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `tests/tender-processing-worker.test.mjs`
- Modify: `tests/tender-processing-worker-endpoint-static.test.mjs`

**RED:** Add tests proving absent flags preserve one-unit processing and existing routes.

**GREEN:** Pass `analysisConfig` through existing dependency injection; do not branch into new behavior yet.

Verify: focused tests + backend parity + build.

Commit: `refactor(agt002): inject analysis program configuration`.

**B0 phase gate:** Baseline documented; flags off preserve behavior; focused tests, parity, build, and diff check pass.

---

# E1 — Immediate operation and visible progress

### Task 4: Define bounded continuous-drain semantics

**Objective:** Specify time/item budgets independently from business quotas.

**Files:**
- Modify: `tender-processing-worker.js`
- Modify: `tests/tender-processing-worker.test.mjs`

**RED:** Tests must prove drain stops on terminal state, `maxUnits`, deadline, lease loss, or non-recoverable error; `0` business quota must not mean infinite request time.

**GREEN:** Add pure budget helpers and a `runUntilYield` loop behind `TENDER_CONTINUOUS_DRAIN`.

Verify focused tests.

Commit: `feat(tenders): add bounded worker drain loop`.

### Task 5: Release or renew leases after successful units

**Objective:** Prevent successful work from idling behind a 90-second lease.

**Files:**
- Create: `supabase/migrations/049_tender_processing_immediate_runtime.sql`
- Create: `supabase/rollbacks/049_tender_processing_immediate_runtime_rollback.sql`
- Modify: `tender-processing-worker-rpc.js`
- Modify: `tests/tender-processing-worker-rpc.test.mjs`
- Create: `tests/tender-processing-immediate-runtime-pglite.integration.test.mjs`
- Create: `tests/tender-processing-immediate-runtime-rollback-safety.test.mjs`

**RED:** PGlite test claims a job, completes one unit, then asserts the same authorized execution can immediately claim/continue while a second worker cannot steal an active lease.

**GREEN:** Add the minimal RPC/state transition for `continue`, `yield`, and terminal release. Preserve service-role-only execution and existing retry semantics.

Verify migration apply, behavior, rollback safety, and restored old signature after rollback.

Commit: `feat(tenders): release successful processing leases`.

### Task 6: Drain multiple document units in one invocation

**Objective:** Process consecutive documents while budgets and lease ownership remain valid.

**Files:**
- Modify: `tender-processing-worker.js`
- Modify: `tender-processing-worker-rpc.js`
- Modify: `tests/tender-processing-worker.test.mjs`
- Modify: `tests/tender-processing-rpc-pglite.integration.test.mjs`

**RED:** Use three queued documents; expect one invocation with drain enabled to process all three and with drain disabled to process exactly one.

**GREEN:** Loop through official state transitions; refresh progress after each unit and yield before platform timeout.

Verify focused unit + PGlite tests.

Commit: `feat(tenders): continuously drain processing jobs`.

### Task 7: Dispatch after durable conversion

**Objective:** Start bounded processing immediately after conversion without making conversion depend on completion.

**Files:**
- Modify: `tender-tracking-rpc.js`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify/Create: `tests/tender-tracking-rpc.test.mjs`
- Modify: `tests/tender-processing-worker-endpoint-static.test.mjs`

**RED:** Test sequence: conversion RPC succeeds and returns durable opportunity/job IDs before an injected dispatch promise resolves; dispatch receives the idempotency key once.

**GREEN:** After durable conversion response data exists, schedule an authenticated/internal bounded worker call behind `TENDER_IMMEDIATE_DISPATCH`; dispatch failure leaves the durable job for reconciliation and does not undo conversion.

Verify focused tests + parity.

Commit: `feat(tenders): dispatch processing after durable conversion`.

### Task 8: Make scheduler reconciliation explicit

**Objective:** Retain scheduler as recovery instead of primary ordinary trigger.

**Files:**
- Modify: `ops/tender-worker-scheduler/run-tender-worker.sh`
- Modify: `ops/tender-worker-scheduler/README.md` or create if absent
- Modify/Create: `tests/tender-worker-scheduler-ops-static.test.mjs`

**RED:** Static tests require reconciliation wording, bounded drain parameters, authentication, fail-fast configuration, and no embedded secret.

**GREEN:** Update script/docs without changing timer frequency unless measurements justify it.

Verify static test and `systemd-analyze verify` against copied units.

Commit: `ops(tenders): make worker scheduler a reconciler`.

### Task 9: Expand status payload with real phases and counts

**Objective:** Expose persisted progress rather than inferred UI state.

**Files:**
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `tests/tender-processing-status-static.test.mjs`
- Modify: `tests/tender-processing-status-item-errors-static.test.mjs`

**RED:** Require response fields for phase, discovered/imported/unchanged/failed/pending, snapshot state, agent state, retry state, and latest safe error.

**GREEN:** Build payload only from persisted job/items/snapshot/run state; never claim completion from in-memory dispatch.

Verify focused tests + parity.

Commit: `feat(tenders): expose persisted processing progress`.

### Task 10: Auto-refresh documents and analysis on completion

**Objective:** Remove the manual browser refresh requirement.

**Files:**
- Modify: `src/main.tsx`
- Create/Modify: `tests/tender-processing-auto-refresh-ui.test.mjs`

**RED:** Static/component contract detects transition from active to completed and requires calls that reload documents, snapshots, analysis, and open questions exactly once.

**GREEN:** Track previous status; on terminal transition invoke existing loaders, handle unmount/race, and keep retry UI for failed states.

Verify UI test + build.

Commit: `fix(tenders): refresh opportunity evidence after processing`.

### Task 11: Render phase progress and honest errors

**Objective:** Show visible, compact, non-duplicated progress.

**Files:**
- Modify: `src/main.tsx`
- Create: `src/tenders/components/TenderProcessingProgress.tsx`
- Create: `tests/tender-processing-progress-ui.test.mjs`

**RED:** Require labels for queue, documents, snapshot, Vig-IA, retry/attention; prohibit success wording when agent state is pending/failed.

**GREEN:** Extract compact component and wire persisted status.

Verify UI test + build.

Commit: `feat(tenders): show Vig-IA processing progress`.

**E1 phase gate:** Local integration proves conversion→first worker without scheduler; multi-document drain; lease exclusion; UI terminal refresh; rollback 049 verified; baseline has no new failure.

---

# E2 — Vig-IA canonicality

### Task 12: Formalize canonical producer and agent states

**Objective:** Represent `queued`, `running`, `completed`, `retry_wait`, `needs_attention`, and `unavailable` without rule fallback.

**Files:**
- Create: `supabase/migrations/050_agt002_canonical_analysis.sql`
- Create: `supabase/rollbacks/050_agt002_canonical_analysis_rollback.sql`
- Create: `tests/agt002-canonical-analysis-pglite.integration.test.mjs`
- Create: `tests/agt002-canonical-analysis-rollback-safety.test.mjs`

**RED:** Attempt to record a post-activation canonical run with producer other than AGT-002/Vig-IA; expect rejection. Historical rows remain readable.

**GREEN:** Add append-only producer/state constraints and service-role RPCs without deleting historical rule runs.

Verify apply/rollback/PGlite.

Commit: `feat(agt002): enforce canonical Vig-IA analysis runs`.

### Task 13: Separate objective validations from analysis output

**Objective:** Preserve useful deterministic facts without producing a competing recommendation.

**Files:**
- Create: `agt002-objective-validations.js`
- Create: `tests/agt002-objective-validations.test.mjs`
- Modify: `agt002-preview-input.js`

**RED:** Validate that output may contain extracted dates/amounts/missing docs/integrity checks but cannot contain recommendation, GO/NO-GO, commercial fit, legal conclusion, or next action.

**GREEN:** Build a closed validation contract and replace `deep_analysis` input with `objective_validations` when canonical-only is enabled.

Verify focused tests.

Commit: `refactor(agt002): separate validations from Vig-IA reasoning`.

### Task 14: Remove deterministic fallback from canonical route

**Objective:** Fail honestly when the agent is unavailable.

**Files:**
- Modify: `agt002-preview-engine.js`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `tests/agt002-preview-engine.test.mjs`
- Modify: `tests/agt002-preview-runtime.test.mjs`
- Modify: `tests/agt002-preview-persistence.test.mjs`

**RED:** With bridge unavailable and canonical flag on, expect retry/unavailable state and zero canonical rule run; with flag off, preserve historical behavior for rollback.

**GREEN:** Return typed agent failure, persist job state, and schedule retry/backoff. Never persist `buildTenderDeepAnalysis` as canonical.

Verify focused suite + parity.

Commit: `fix(agt002): remove silent rules fallback`.

### Task 15: Remove deterministic analysis action from opportunity UI

**Objective:** Present one Vig-IA analysis action postconversion.

**Files:**
- Modify: `src/tenders/components/TenderAnalysisSection.tsx`
- Modify: `src/main.tsx`
- Modify: `tests/agt002-preview-surface.test.mjs`

**RED:** Assert no “Generar análisis preliminar”/generic “Actualizar análisis” route remains; require Vig-IA labels by state.

**GREEN:** Remove `onGenerate` surface and deterministic button; retain one action mapped to the agent route.

Verify UI/static tests + build.

Commit: `feat(agt002): make Vig-IA the only visible analysis action`.

### Task 16: Protect completed Vig-IA analysis from overwrite/degradation

**Objective:** Prevent later validation or failed attempts from replacing current canonical analysis.

**Files:**
- Modify: `tender-analysis-foundation.js`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Create: `tests/agt002-canonical-analysis-protection.test.mjs`

**RED:** Persist completed Vig-IA run, then rule result and failed retry; current analysis must still point to the completed Vig-IA run.

**GREEN:** Update current-pointer selection to canonical completed versions only; expose latest attempt separately.

Verify focused tests + parity.

Commit: `fix(agt002): protect current canonical analysis`.

**E2 phase gate:** Canonical flag on in local tests; no competing UI action; unavailable agent creates no fake completion; historical rule runs preserved; rollback 050 verified.

---

# E3 — Structured opportunity and company context v2

### Task 17: Define closed context-v2 contract

**Objective:** Create allowlisted, versioned opportunity/company/commercial schemas.

**Files:**
- Create: `agt002-context-v2.js`
- Create: `tests/agt002-context-v2.test.mjs`

**RED:** Test full approved fields, source metadata, redaction, unknown-key rejection, deterministic ordering, and size limits.

**GREEN:** Implement pure builders for `opportunity`, `company_dossier`, `commercial_context`, and `human_evidence` with `context_version`.

Commit: `feat(agt002): define analysis context v2 contract`.

### Task 18: Load complete opportunity context

**Objective:** Supply modality, budget, dates, place, duration, source, owner, status, conversion reason, and authorized notes.

**Files:**
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Create: `tests/agt002-opportunity-context-v2.test.mjs`

**RED:** Inject a representative opportunity and require every allowlisted field with source/provenance; unknown DB fields excluded.

**GREEN:** Add a narrow loader using existing tables/RPCs; no broad `select('*')` in the model path.

Verify test + parity.

Commit: `feat(agt002): load structured opportunity context`.

### Task 19: Normalize Seguridad Nacional procurement dossier

**Objective:** Align real `psi_company_procurement_profile` fields with the model contract.

**Files:**
- Create: `agt002-company-dossier.js`
- Create: `tests/agt002-company-dossier.test.mjs`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`

**RED:** Test RUP, UNSPSC, services, licenses, financial/organizational capacity, experience, certifications, recurring documents, restrictions, source and expiry; prohibit invented legacy fields.

**GREEN:** Map existing profile/document records into canonical evidence items and explicit `not_verified` gaps.

Verify focused test + parity.

Commit: `feat(agt002): normalize company procurement dossier`.

### Task 20: Add requirement-to-company-evidence crosswalk

**Objective:** Classify each requirement against company evidence without deciding GO/NO-GO.

**Files:**
- Create: `agt002-requirement-evidence.js`
- Create: `tests/agt002-requirement-evidence.test.mjs`
- Modify: `agt002-preview-contract.js`

**RED:** Cover `cumplido_con_evidencia`, `cumplimiento_parcial`, `no_cumplido`, `sin_evidencia_suficiente`, `requiere_validacion_humana`; every positive classification needs citations.

**GREEN:** Add closed output section and citation validation.

Commit: `feat(agt002): crosswalk tender requirements and company evidence`.

### Task 21: Integrate context v2 into Vig-IA input

**Objective:** Replace partial opportunity and misaligned company fields behind flag.

**Files:**
- Modify: `agt002-preview-input.js`
- Modify: `agt002-preview-engine.js`
- Modify: `tests/agt002-preview-input.test.mjs`
- Modify: `tests/agt002-preview-contract.test.mjs`

**RED:** Require `context_version: 2`, complete structured sections, objective validations, and no `deep_analysis` recommendation.

**GREEN:** Wire builders behind `AGT002_CONTEXT_V2`; keep v1 path for rollback until production verification.

Verify preview suite.

Commit: `feat(agt002): supply context v2 to Vig-IA`.

### Task 22: Version context and preserve human evidence

**Objective:** Make analyses reproducible and human answers durable.

**Files:**
- Create: `supabase/migrations/051_agt002_context_versions.sql`
- Create: `supabase/rollbacks/051_agt002_context_versions_rollback.sql`
- Create: `tests/agt002-context-versions-pglite.integration.test.mjs`
- Modify: `tender-analysis-foundation.js`

**RED:** Record two human answers and two analyses; each run must reference immutable context version and answers effective at that time.

**GREEN:** Add append-only context version storage/RPC and run reference; preserve existing question-response tables.

Verify PGlite + rollback safety.

Commit: `feat(agt002): version analysis context and human evidence`.

**E3 phase gate:** Context v2 contains complete allowlisted opportunity and company evidence, explicit gaps, human evidence version, no secrets, and no GO authority.

---

# E4 — Complete document evidence and retrieval

### Task 23: Define chunk and evidence-reference contracts

**Objective:** Represent document/version/page/section/hash/text and closed citation IDs.

**Files:**
- Create: `agt002-document-chunks.js`
- Create: `tests/agt002-document-chunks.test.mjs`

**RED:** Test deterministic chunk IDs, overlap boundaries, max size, page/section metadata, empty/illegible documents, and stable ordering.

**GREEN:** Implement pure chunker over extracted text; no model call.

Commit: `feat(agt002): define document chunk contract`.

### Task 24: Persist versioned chunks append-only

**Objective:** Store chunks tied to document versions and snapshots.

**Files:**
- Create: `supabase/migrations/052_tender_document_chunks.sql`
- Create: `supabase/rollbacks/052_tender_document_chunks_rollback.sql`
- Create: `tests/tender-document-chunks-pglite.integration.test.mjs`
- Create: `tests/tender-document-chunks-rollback-safety.test.mjs`

**RED:** Same version/hash deduplicates; new version appends; snapshot cannot cite chunks from another opportunity; RLS/service-role boundaries hold.

**GREEN:** Add tables, indexes, checks, and narrow RPCs. Rollback revokes/disables new interfaces without deleting evidence.

Commit: `feat(tenders): persist versioned document chunks`.

### Task 25: Chunk every current snapshot document

**Objective:** Remove 12-document/3,000-character ingestion ceiling from evidence preparation.

**Files:**
- Modify: `tender-processing-worker.js`
- Modify: `tests/tender-processing-worker.test.mjs`
- Create: `tests/tender-processing-chunking.integration.test.mjs`

**RED:** Snapshot with 14 documents must produce chunk coverage for all 14, including adenda precedence metadata.

**GREEN:** Add chunking phase after extraction and before snapshot completion; failed/illegible docs become explicit gaps.

Commit: `feat(tenders): chunk complete tender snapshots`.

### Task 26: Implement deterministic retrieval budgets

**Objective:** Select evidence by requirement coverage and relevance with explicit omissions.

**Files:**
- Create: `agt002-document-retrieval.js`
- Create: `tests/agt002-document-retrieval.test.mjs`

**RED:** Require coverage across document types/requirements, deterministic tie-breaking, max tokens/chunks, and omission report; latest adenda overrides base for current requirement while preserving both citations.

**GREEN:** Implement lexical/structured retrieval first; do not add external vector infrastructure unless tests prove need.

Commit: `feat(agt002): retrieve bounded tender evidence`.

### Task 27: Integrate retrieved evidence into Vig-IA

**Objective:** Replace arbitrary document prefix truncation with closed evidence packets.

**Files:**
- Modify: `agt002-preview-input.js`
- Modify: `agt002-preview-contract.js`
- Modify: `tests/agt002-preview-input.test.mjs`
- Modify: `tests/agt002-preview-contract.test.mjs`

**RED:** For 14 documents, require coverage manifest, selected chunks, omitted chunks/reasons, snapshot ID, and citation allowlist.

**GREEN:** Wire retrieval behind `AGT002_DOCUMENT_RETRIEVAL`; reject citations outside allowlist.

Commit: `feat(agt002): ground analysis in retrieved evidence`.

### Task 28: Display evidence coverage and omissions

**Objective:** Prevent false “complete analysis” claims.

**Files:**
- Modify: `src/tenders/components/TenderAnalysisSection.tsx`
- Create: `tests/agt002-evidence-coverage-ui.test.mjs`

**RED:** Require used/covered/omitted counts, evidence links, and warning when material omissions exist.

**GREEN:** Render compact evidence panel without exposing full sensitive text.

Verify UI test + build.

Commit: `feat(agt002): show analysis evidence coverage`.

**E4 phase gate:** Representative 14-document snapshot has 14-document coverage, valid citations, explicit omissions, version precedence, and bounded model context.

---

# E5 — Versioned official Colombian legal corpus

### Task 29: Define legal-source and citation contracts

**Objective:** Model official, versioned, verifiable legal sources.

**Files:**
- Create: `agt002-legal-corpus.js`
- Create: `tests/agt002-legal-corpus.test.mjs`

**RED:** Require norm/type/number/year/article/current text/authority/effective dates/modifications/official URL/topic/sector/verified-at/corpus-version; reject non-HTTPS, non-official, stale/unverified sources from verified conclusions.

**GREEN:** Implement validation, normalization, and citation helpers.

Commit: `feat(agt002): define official legal corpus contract`.

### Task 30: Persist legal corpus versions and sources

**Objective:** Store corpus append-only and tie each run to a version.

**Files:**
- Create: `supabase/migrations/053_agt002_legal_corpus.sql`
- Create: `supabase/rollbacks/053_agt002_legal_corpus_rollback.sql`
- Create: `tests/agt002-legal-corpus-pglite.integration.test.mjs`
- Create: `tests/agt002-legal-corpus-rollback-safety.test.mjs`

**RED:** Published version immutable; draft updates create a new version; run references exact version; public/anon cannot mutate.

**GREEN:** Add version/source/topic tables and service-role RPCs; no destructive rollback.

Commit: `feat(agt002): persist versioned legal corpus`.

### Task 31: Add curated official source manifest

**Objective:** Seed only verified official Colombian sources relevant to contracting and private security.

**Files:**
- Create: `data/agt002/legal-corpus-v1.json`
- Create: `scripts/validate_agt002_legal_corpus.mjs`
- Create: `tests/agt002-legal-corpus-manifest.test.mjs`

**RED:** Manifest validator rejects missing article text, unofficial domain, missing verification date, duplicate source ID, unknown modification status, or absent applicability tags.

**GREEN:** Curate source records from Función Pública/SUIN/Colombia Compra Eficiente/Supervigilancia official pages. Mark unresolved jurisprudence or vigencia as human review, never verified law.

Verify validator with network-independent fixture; separately record live URL checks with date.

Commit: `data(agt002): add verified Colombian legal corpus v1`.

### Task 32: Retrieve applicable legal evidence

**Objective:** Select applicable legal provisions by process stage, modality, requirement, and private-security sector.

**Files:**
- Create: `agt002-legal-retrieval.js`
- Create: `tests/agt002-legal-retrieval.test.mjs`

**RED:** Require deterministic selection, version tag, official citations, and `requires_human_legal_review` when applicability/vigencia is uncertain.

**GREEN:** Implement tagged retrieval; do not let model memory create sources.

Commit: `feat(agt002): retrieve applicable official legal evidence`.

### Task 33: Integrate legal evidence and abstention into Vig-IA

**Objective:** Separate tender requirement, legal obligation, company evidence, inference, and legal review.

**Files:**
- Modify: `agt002-preview-input.js`
- Modify: `agt002-preview-contract.js`
- Modify: `tests/agt002-preview-contract.test.mjs`

**RED:** Legal claim without corpus citation fails validation; uncertain source must render “No verificado jurídicamente; requiere revisión humana.”

**GREEN:** Add legal packet behind `AGT002_LEGAL_CORPUS`, corpus version, citation allowlist, and abstention state.

Commit: `feat(agt002): ground legal findings in official corpus`.

### Task 34: Display legal sources and review status

**Objective:** Make verified law and human-review items visibly distinct.

**Files:**
- Modify: `src/tenders/components/TenderAnalysisSection.tsx`
- Create: `tests/agt002-legal-findings-ui.test.mjs`

**RED:** Require official source link, article/version/verified date, and distinct non-verified warning.

**GREEN:** Render legal evidence without implying legal authority.

Verify UI test + build.

Commit: `feat(agt002): display verified legal evidence`.

**E5 phase gate:** Corpus v1 validates; every legal claim cites a versioned official source or abstains; live links checked and timestamped; rollback 053 verified.

---

# E6 — Continuity into workbench and immutable human authority

### Task 35: Link pre-GO context and analysis to workbench dossier

**Objective:** Carry the same case context into the post-GO Mesa without duplication.

**Files:**
- Modify: `agt002-tender-adapter.js`
- Modify: `agt002-workbench-context.js`
- Modify: `tests/agt002-tender-adapter.test.mjs`
- Modify: `tests/agt002-workbench-context.test.mjs`

**RED:** GO transition must retain opportunity, snapshot, canonical analysis run, context version, evidence coverage, corpus version, and open questions.

**GREEN:** Extend adapter allowlist and existing dossier references; do not copy raw documents into workbench messages.

Commit: `feat(agt002): carry analysis context into workbench`.

### Task 36: Reanalyze after human answers without losing history

**Objective:** Make answers new evidence and create append-only analysis versions.

**Files:**
- Modify: `server/index.js`
- Mirror: `api/[...path].js`
- Modify: `tests/tender-question-responses.test.mjs`
- Create: `tests/agt002-human-evidence-reanalysis.test.mjs`

**RED:** Submit answer, rerun analysis, require a new context/run version while old run remains readable and decision unchanged.

**GREEN:** Trigger idempotent refresh from existing question-response workflow; never rewrite prior run.

Commit: `feat(agt002): reanalyze with versioned human evidence`.

### Task 37: Prove AI authority boundaries mechanically

**Objective:** Ensure no AI/worker/scheduler route can decide or act externally.

**Files:**
- Create: `tests/agt002-authority-boundaries.test.mjs`
- Modify: `tests/agt002-workbench-contract.test.mjs`
- Modify: `tests/tender-offer-gate.test.mjs` if present

**RED:** Static/runtime tests fail if agent routes call GO/NO-GO RPC, approval, signature, email/send, submission, or status transition reserved for humans.

**GREEN:** Extract/retain explicit human-only route guards and producer checks; no new autonomous action.

Commit: `test(agt002): enforce immutable human authority`.

### Task 38: Add end-to-end case lifecycle integration

**Objective:** Exercise conversion → evidence → Vig-IA → human GO → workbench continuity.

**Files:**
- Create: `tests/agt002-analysis-program-end-to-end.integration.test.mjs`

**RED:** Test initially fails at missing integrated lifecycle fixture.

**GREEN:** Build isolated PGlite/fake-agent fixture proving persistence, versions, citations, no duplicate jobs/runs, and human-only decision.

Commit: `test(agt002): cover full analysis lifecycle`.

**E6 phase gate:** One test case traverses full lifecycle; history preserved; workbench context continuous; authority test proves no AI decision/action path.

---

# Cross-cutting observability, rollout, and production

### Task 39: Add safe program metrics

**Objective:** Measure latency, coverage, retries, leases, model usage, and gaps without sensitive payloads.

**Files:**
- Create: `agt002-analysis-observability.js`
- Create: `tests/agt002-analysis-observability.test.mjs`
- Modify: `tender-processing-worker.js`
- Modify: `server/index.js`
- Mirror: `api/[...path].js`

**RED:** Require structured event names and safe fields; prohibit document text, prompt, token, credentials, connection strings, and unbounded errors.

**GREEN:** Emit conversion→job→claim→snapshot→agent→run timings and counts.

Commit: `feat(agt002): add safe analysis observability`.

### Task 40: Complete full local verification

**Objective:** Produce fresh mechanical evidence before push/PR.

**Steps:**
1. Run all phase-focused tests.
2. Run migration apply/rollback tests 049–053.
3. Run `npm run check:backend-parity`.
4. Run `npm run build`.
5. Run `git diff --check`.
6. Run `node --test tests/*.test.mjs`; compare against Task 1 baseline.
7. Inspect `git diff --stat` and `git status`.
8. Create `docs/verification/2026-07-29-agt002-program-local-verification.md` with exact outputs/exit codes.

Commit: `docs(agt002): record full local verification`.

### Task 41: Perform the single independent final review

**Objective:** Review the complete implementation once, after local verification.

**Review scope:** design/spec compliance, security, SQL/RLS, lease/idempotency, canonicality, context/evidence completeness, legal citation integrity, UI truthfulness, human authority, rollback, tests.

**Executor:** Claude Opus via direct Claude Code CLI, read-only, with JSON/modelUsage evidence.

**Acceptance:** Fix Critical/Important findings or regressions only; do not trigger a second broad review. Re-run affected tests and full verification after fixes.

### Task 42: Push, PR, CI, and merge

**Objective:** Integrate only verified code.

**Steps:**
1. Rebase/update from current `origin/main`; resolve with tests.
2. Push branch.
3. Open PR referencing design, plan, migrations, flags, and verification.
4. Wait for CI; diagnose any failure rather than rerunning blindly.
5. Merge only after required checks pass.
6. Record merged commit and CI URLs in session evidence, not durable memory.

### Task 43: Apply production migrations with verification

**Objective:** Apply 049–053 in order with preflight and rollback readiness.

**Steps per migration:**
1. Verify exact production state/readiness with read-only query.
2. Confirm backup/rollback file and dependency order.
3. Apply one migration through the approved runner.
4. Run its read-only verification.
5. Stop and rollback/disable flag on mismatch.
6. Never print credentials.

### Task 44: Deploy application and worker/scheduler artifacts

**Objective:** Ship merged code while flags remain off.

**Steps:**
1. Deploy Vercel from merged `main`; require successful build and live URL.
2. Install/update Hetzner bridge/worker/scheduler artifacts from merged commit.
3. Verify service units, authentication failures, health method, and scheduler cycles.
4. Confirm flags off preserve current production behavior.

### Task 45: Activate phased canary

**Objective:** Enable one dependency-complete phase at a time.

**Order:**
1. `TENDER_IMMEDIATE_DISPATCH` + `TENDER_CONTINUOUS_DRAIN`.
2. `AGT002_CANONICAL_ONLY`.
3. `AGT002_CONTEXT_V2`.
4. `AGT002_DOCUMENT_RETRIEVAL`.
5. `AGT002_LEGAL_CORPUS`.

**For each flag:** verify one controlled case, metrics, persisted DB evidence, UI state, retries, and no authority violation. On failure, disable only the affected flag and preserve durable jobs/evidence.

### Task 46: Verify production end-to-end and close

**Objective:** Prove the program is live and operating as designed.

**Evidence required:**
- conversion dispatch timestamp;
- first claim latency;
- multi-document progress;
- snapshot and chunk coverage;
- canonical Vig-IA run and producer;
- no deterministic competing action;
- structured opportunity/company context version;
- evidence citations and omissions;
- legal corpus version/citations or abstention;
- UI automatic refresh;
- human GO/NO-GO only;
- workbench continuity after GO;
- scheduler reconciliation;
- rollback flags documented.

Create: `docs/verification/2026-07-29-agt002-program-production-verification.md` and deploy it only if it contains no secrets or personal data.

---

# Phase dependency and gate matrix

| Phase | Depends on | Activation gate | Rollback |
|---|---|---|---|
| B0 | approved design | baseline + flags-off parity | revert config wiring |
| E1 | B0 | lease/drain/idempotency + UI refresh verified | flags off + rollback 049 |
| E2 | E1 | no fake fallback + canonical protection | canonical flag off + rollback 050 |
| E3 | E2 | complete/redacted/versioned context | context flag off + rollback 051 |
| E4 | E3 | all-doc coverage + bounded retrieval | retrieval flag off + rollback 052 |
| E5 | E4 | official corpus validation + citations/abstention | legal flag off + rollback 053 |
| E6 | E2–E5 | lifecycle + authority tests | disable new adapters, preserve evidence |
| Production | all | full verification + single final review + CI | phased flags off; safe SQL rollback only if required |

# Requirement-to-task traceability

| Requirement | Tasks |
|---|---|
| Immediate idempotent processing after conversion | 4–8 |
| Lease release/renewal and continuous bounded progress | 4–6 |
| Scheduler as reconciler | 7–8 |
| Visible progress and automatic reload | 9–11 |
| Vig-IA only canonical analysis | 12–16 |
| No deterministic fallback or anchoring | 13–16 |
| Explicit agent unavailable/retry states | 12, 14, 16 |
| Complete structured opportunity context | 17–18, 21–22 |
| Canonical Seguridad Nacional dossier | 17, 19–22 |
| Requirement ↔ company evidence | 20–21 |
| Full documents, chunking, retrieval, coverage | 23–28 |
| Versioned official legal corpus | 29–34 |
| Legal citations or human-review abstention | 29, 32–34 |
| Human evidence and append-only reanalysis | 22, 36 |
| Continuity into post-GO workbench | 35–38 |
| Human-only GO/NO-GO/approve/sign/send/submit | 37–38 |
| Observability without secrets | 39 |
| Migration/rollback safety | 5, 12, 22, 24, 30, 40, 43 |
| Backend parity | 3, 7, 9, 14, 16, 18–19, 36, 39–40 |
| Single final review | 41 |
| Push, merge, deploy, activate, verify | 42–46 |

# Final definition of done

The program is done only when Tasks 1–46 are complete, all applicable flags are enabled in production, a controlled production case has persisted evidence for every required layer, the UI reflects it without refresh, no unresolved Critical/Important finding remains, and rollback controls are confirmed.