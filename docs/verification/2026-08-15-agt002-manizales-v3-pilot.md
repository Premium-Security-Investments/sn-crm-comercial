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
