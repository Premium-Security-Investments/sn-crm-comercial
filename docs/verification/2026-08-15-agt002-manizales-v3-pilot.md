# AGT-002 — Manizales V3 complete pilot verification

## Scope and safety

- Branch: `feat/agt002-manizales-v3-complete-pilot`
- Baseline HEAD: `6281f2d9f74d1a319a7df95fa6ae6c7e4d567446`
- Pilot: Rama Judicial Manizales, process `SA-24-2026`
- Opportunity: `54190e51-15fb-46af-b0aa-8f13461a3110`
- Production access in this phase: strictly read-only and metadata-only.
- No push, deploy, migration, production write, submission, signature, award decision or automatic GO/NO-GO.
- Human GO/NO-GO remains mandatory.

## Baseline before implementation

### Focused AGT-002 suite

Command: `node --test --test-concurrency=1 tests/agt002-*.test.mjs`

Result: **317 passed, 0 failed**.

### Global suite

Command: `node --test --test-concurrency=1 tests/*.test.mjs`

The command exceeded the ten-minute execution budget. The partial log exposed three pre-existing failures outside this pilot:

1. `tests/agt002-copilot-analysis-integration.test.mjs` — missing temporary preview file.
2. `tests/agt002-legacy-compatibility.test.mjs` — assertion drift in pre-existing compatibility behavior.
3. `tests/agt002-production-reconcile.test.mjs` — pre-existing static guard mismatch.

These failures existed before pilot implementation and are tracked as baseline evidence; they must not be counted as pilot regressions.

### Other baseline checks

- `npm run check:backend-parity`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- `tests/agt002-analysis-config.test.mjs`: passed; V3 flag remains fail-closed and depends on canonical-only, context V2 and document retrieval.

## Read-only production reconciliation

Command executed without `--write` using the historical production environment path, whose values were neither printed nor persisted.

Observed sanitary metadata:

- `read_only: true`
- `metadata_only: true`
- company evidence classes: **17/17**
- legal corpus: `legal-corpus-v1.1`
- registry sections: **68**
- pre-GO sections: **15**
- curated proposals: **20**
- status: `draft_for_human_review`

The existing read-only guard forbids `insert`, `update`, `upsert`, `delete`, `rpc`, `storage`, `functions` and `schema` calls.

## Historical V2 production baseline

The latest completed historical V2 run was retrieved read-only from `psi_tender_analysis_runs`:

- run id: `4f5f8bcf-6de2-45d9-b74a-4588a514bdf3`
- schema: `2.0-preview.1`
- policy: `agt002-preview-policy-v2`
- producer: `AGT-002`
- canonical: `false`
- critical open count: **3**
- array counts: strengths 3, weaknesses 3, blockers 2, questions 3, unverified 3

The committed fixture is metadata-only and contains controlled dimension markers and counts, not the original analysis prose:

`tests/fixtures/agt002-manizales-v2-production-baseline.json`

Controlled dimensions present in the source V2 run:

- closing or extension
- SuperVigilancia operating licence
- experience
- SST
- insurance package
- financial capacity
- documentary package
- CCTV / technical scope
- economic viability

## Known dishonest coverage surface

`src/tenders/components/TenderIntegralAnalysisV3View.tsx:95` computes coverage as only:

`analyzed_requirement_ids.length / expected_requirement_ids.length`

That ratio is contract-envelope coverage, not the full Manizales procurement coverage. It is the exact UI surface that must be replaced so a `4 / 4` display cannot imply full analysis of the 68-section registry or the 15+20 closed source ledgers.

## Phase 0 gate

Status: **PASS**.

The baseline is reproducible, the live data observation was read-only, the real V2 comparison source is preserved sanitised, and all publication/deployment gates remain closed.

## Phase 2 — Mechanical corrections pass

### Scope and safety

- Start commit: `66045ac`.
- No runtime/server/UI/persistence change; no network, DB, env, push, deploy or migration.
- New pure module `agt002-manizales-manifest-corrections.js`: deterministic, idempotent, downgrade/abstention only. The Phase-1 validator (`validateAgt002ManizalesIntegralManifest`) was **not** weakened; the corrected artifact re-passes it unchanged.

### Tests

- `tests/agt002-manizales-manifest-corrections.test.mjs`: **21 passed** (contract surface, purity, no-op + idempotency on the conformant artifact, the nine rules each firing on an injected defect with downgrade-only outcomes, corrections-artifact determinism).
- `tests/agt002-manizales-integral-manifest.test.mjs` + `tests/agt002-manizales-integral-manifest-generate-static.test.mjs`: pass (60 total with the corrections suite).
- Generator run twice at fixed timestamp `2026-08-15T00:00:00.000Z`: manifest JSON, consolidated MD and corrections JSON all **byte-identical**; the regenerated manifest/MD are byte-identical to the Phase-1 committed artifacts.

### Corrections applied

**Total: 0.** The Phase-1 artifact is already conformant to all nine rules, so the pass is a no-op and a second pass yields zero corrections (idempotent). By rule: citation-quote-equality 0, vigencia-precedence 0, atomization 0, duplicate-collapse 0, phase-reconciliation 0, materiality-derivation 0, subsanability-normalization 0, candidate-evidence-validity 0, suspicious-association 0. Recorded in `docs/governance/manizales-sa-24-2026.integral-manifest-corrections.json`.

- Before/after entry counts: **25 → 25** (no atomization/duplicate change).
- Analyzable: **20 → 20**; unresolved_visible: **5 → 5** (4 governed_runtime excerpt-bound + 1 lifecycle gate).

### Independent QA sample (10 deterministic entries)

Verified manually against the citation bounds and source excerpts **available in the artifact** (excerpt-bound; not a full-PDF verification):

| entry | category | analyzable | verdict | note |
|---|---|---|---|---|
| financial-working-capital | habilitating | false | PASS (abstains) | governed excerpt span, no covering fragment → unresolved_visible, human review |
| legal-rce-policy | habilitating | false | PASS (abstains) | governed excerpt span → unresolved_visible |
| legal-collective-life-policy | habilitating | false | PASS (abstains) | governed excerpt span → unresolved_visible |
| technical-video-surveillance-scope | technical | false | PASS (abstains) | governed excerpt span, evidence class null (never fabricated) |
| lifecycle:cierre-prorroga | null | false | PASS (abstains) | lifecycle gate, category null → unresolved_visible |
| proposal:2.3:indices-capacidad-organizacional | habilitating | true | PASS | quote == source slice [93564,93645) |
| proposal:2.4:experiencia-rup-unspsc-sumatoria | habilitating | true | PASS | quote == source slice [94814,94859) |
| proposal:3.1:calidad-lenguaje-senas | technical | true | PASS | quote == source slice [117449,117505) |
| proposal:3.4:puntaje-emprendimiento-empresa-mujeres | technical | true | PASS | quote == source slice [122367,122415) |
| proposal:3.6:oferta-economica-anexo-9 | financial_execution | true | PASS | quote == source slice [123997,124040) |

All 10 show consistent analyzability↔grounding and status↔analyzability; no promotion. Limitation: verification is bounded to the excerpt fragments stored in `source_text_by_document_id`; the underlying PDFs were not re-read.

### Phase 2 gate

Status: **PASS**. Deterministic, idempotent, downgrade-only corrections pass added under strict TDD; zero corrections needed on the conformant artifact; all Phase-1 invariants (17 documents, 68 registry refs, 15/20 ledgers, 4 governed runtime entries, closure gate, citation/provenance hashes) preserved; publication/deployment gates remain closed.

## Phases 5–7 — Real canary, V2/V3 comparison and persistence gate

### Real V3 canary (non-persisting)

The controlled Manizales canary completed with exit code 0 and a sanitised summary only:

- `ok=true`, `valid_contract=true`, contract `agt002-integral-analysis-v3`;
- one provider call;
- exactly 20 expected, analyzed and returned requirement units, in manifest order;
- all six contract/invariant checks true;
- 20 abstained units, 20 pending human validations, 20 legal statuses `not_verified`;
- `material_omissions=false` and zero omission reasons;
- `persistence_count=0` and no persistence writer supplied.

This proves model→bridge→parse→server assembly→semantic validation on the real provider path without creating a canonical analysis run.

### V2/V3 no-loss comparison

`tests/agt002-manizales-v2-v3-comparison.test.mjs` loads the sanitised historical V2 baseline and executes the V3 local runner against the checked-in governed manifest. Result: **7/7 passed**.

- all 9 historical V2 dimensions map to V3 requirements;
- zero historical dimensions lost;
- V3 coverage is strictly larger: 20 analyzable requirements vs 9 historical dimensions;
- source ledgers remain 15/15 requirements and 20/20 documents;
- abstention and human review remain visible; no unit asserts automatic compliance.

Limitation recorded from independent QA: the automated comparison uses a deterministic synthetic responder; the separate real canary above validates the provider path.

### Final mechanical QA

- `node --test --test-concurrency=1 tests/agt002-*.test.mjs`: **410/410 passed** after adding migration 067.
- Full repository suite: **655/660 passed**, with no new regressions. Three failures match the Phase-0 documented baseline (`centinel-static`, `commercial-alerts-static`, `module-permissions-migration-pglite`); the other two (`tender-preparation-honest-affordances-static`, `vigia-opportunity-copilot-ui-static`) fail identically against clean `HEAD` blobs and none of their source files are changed by this release.
- Backend parity: pass.
- TypeScript `--noEmit`: pass.
- Production build: pass (pre-existing Vite chunk-size warning only).
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: pass.
- Independent Claude Sonnet review: no P0/P1. One runtime P2 noted: a synthetic abstention created for a missing model unit uses the conservative safe-unknown evidence state rather than promoting a server evidence-state conclusion; this is downgrade-only and requires human validation.

### Migration 067

`067_agt002_integral_v3_persistence.sql` preserves the 063 RPC signature, idempotency, opportunity locking, canonical promotion, `supersedes_run_id`, published-corpus gate and grants. Before any lock or demotion it rejects:

- schema `3.0.0` without a structurally complete integral V3 payload;
- `integral_analysis` carried under a V2 schema;
- mismatch between `coverage.legal_corpus_version_id` and the attributable RPC corpus UUID.

The rollback restores the exact 063 RPC behavior without touching rows, the 063 unique index or `supersedes_run_id`. The PGlite migration lifecycle covers apply, reapply, V2 compatibility, valid V3 promotion, malformed V3 rejection before supersession, corpus coherence, replay/conflict behavior and rollback.

### Pre-deployment gate

Status: **PASS**. Code, canary, compatibility and migration are ready for commit/push and the authorized production rollout. No production write or deployment is represented by this section.
