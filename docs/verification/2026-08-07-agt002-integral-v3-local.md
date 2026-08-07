# AGT-002 integral analysis v3 — local implementation gate

**Date:** 2026-08-07
**Branch:** `feat/agt002-v3-foundations` (successor to the foundations branch; never `main`)
**Base:** `origin/main` at `f85907d12d92d8ab956efd2ee9d6bfd264022c12`

**Plan executed:** `docs/superpowers/plans/2026-08-06-agt002-integral-analysis-v3-implementation-plan.md`
**Design:** `docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-design.md`
**Audit:** `docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-audit.md`

**No production activation in this block:** the flag defaults off, no remote migration was applied, nothing was pushed, no PR was opened, and no deploy occurred. `AGT002_INTEGRAL_CONTRACT_V3` cannot be enabled by any request parameter — only server environment configuration.

## 1. What was implemented (Tasks 1–9 of the plan, plus two gaps the plan explicitly deferred)

Every task below was implemented test-first (RED confirmed failing for the stated reason, then GREEN, then AGT-002 regression, one commit per task):

| Task | Commit | Files | RED→GREEN |
|---|---|---|---|
| 1. Fail-closed v3 flag | `b328038` | `agt002-analysis-config.js` | yes |
| 3. Evidence/abstention/5-axis invariants (Task 2's structural validator and shape/ordering checks were already present on this branch before this session) | `b0ffb00` | `agt002-integral-analysis-v3.js` | yes |
| 4. Deterministic v2 projection | `7869fcb` | `agt002-v3-compatibility.js` | yes |
| 5. Provider schema + version dispatch | `46511b5` | `agt002-preview-contract.js`, `agt002-tender-adapter.js` | yes |
| Category origin (audit gap C-3) | `0097657` | `agt002-integral-category-manifest.js` | yes |
| 6. Engine assembles governed v3 envelope | `6587c57` | `agt002-preview-engine.js`, `agt002-preview-input.js` | yes |
| 7. Persist v3 + v2 coexistence | `7d75234` | `agt002-preview-persistence.js` + PGlite integration test | yes |
| 8. Backend wiring parity | `86c26c7` | `agt002-preview-runtime.js` | yes |
| 9. Synthetic end-to-end gate | `5831d70` | fixture + E2E test | n/a (verification-only) |
| Real five-phase UI | `4fe7651` | `TenderIntegralAnalysisV3View.tsx` + types | yes |

Task 2's structural validator (closed enums, exact keys, ordering, coverage-exactness) and Task 1's flag scaffolding were partially present in this worktree when the session started; this session verified both were green, then built Task 3's invariants directly on top and committed Task 1's pending diff.

### Category-axis origin gap (audit finding C-3), resolved

The real requirement manifest (`agt002-deep-analysis-matrix.js`) only ever carries `front ∈ {legal, financial, technical}` — there is no governed signal for `discard`/`habilitating`, and `legal` front does not correspond 1:1 to any v3 category. `agt002-integral-category-manifest.js` resolves this the two ways the design allows and no other way:

- `technical → technical` and `financial → financial_execution` are honest identity mappings (traceable, zero fabrication).
- Every other case (`front: legal`, or a reclassification) requires an explicit governed `categoryOverrides` entry (`requirement_id → category`), curated outside this module. Without one, derivation **throws — it never guesses**.

This means: today, with the empty default override map, `AGT002_INTEGRAL_CONTRACT_V3` will fail closed for any real opportunity whose requirement manifest contains a `legal`-front requirement, until a governed override source is built. That is the correct, honest behavior — not a bug to paper over.

### Five-axis origin (evidence_state) — correction: NOT resolved by the original Task 6 wiring; closed in a later same-day follow-up session

**This section originally claimed evidence_state was "architecturally resolved" by handing the model an allowlist plus the real 17-class catalog and validating cross-axis invariants. That claim was false and has been corrected below.** Cross-axis invariants (review "reviewed" rejected when presence "absent", etc.) only reject *internally inconsistent* model claims — they never checked a claim against any real per-requirement ground truth. `evidence_state` was still, in full, free model output: a model could assert `{presence:"present", review:"reviewed", validity:"valid", applicability:"applicable", compliance:"supported_pending_human_review"}` for any requirement with zero real signal behind it, and the validator accepted it as long as the five values were mutually consistent. That is exactly the audit's own P0 finding, "cumplimiento inferido por presencia" — restated, not fixed, by the original Task 6 wiring.

A follow-up focused TDD session (same day, prior to any push/deploy) closed this gap for real:

- `agt002-evidence-state-manifest.js` (new, pure): `buildAgt002EvidenceStateManifest(requirementManifest, { evidenceClasses, evidenceClassLinkByRequirementId })` derives one governed evidence_state per `requirement_id`. Each axis (`presence`/`review`/`validity`/`applicability`) is read from its own independent DB-backed column of the one real company-evidence class (of the 17) an explicit, curated `evidenceClassLinkByRequirementId` entry points at — never from another axis, never from mere document presence. `compliance` never leaves `"unknown"`: there is no real write path for it yet. No governed link, or a link to a class not observed in this run's catalog, abstains to the exact safe state `{presence:"unknown",review:"not_reviewed",validity:"unknown",applicability:"unknown",compliance:"unknown"}` — this module never throws for absence of *signal*, only for absence of *governance* (e.g. a link pointing outside the real 17-class catalog).
- `agt002-integral-analysis-v3.js`: `validationContext.evidenceStateManifest` is now a required field (1:1 coverage with `requirementManifest`, structurally validated). Every `tender_requirement` unit's `evidence_state` must equal, key for key, the governed entry for its `requirement_id` — checked *after* every existing enum/cross-axis-invariant check, so a mutation that trips an existing invariant still fails with that invariant's own message; only a well-formed, invariant-consistent but *ungoverned* claim reaches this new check. `strategic_consideration` units (no `requirement_id`) are out of scope for this governance layer and keep only the pre-existing checks.
- `agt002-preview-engine.js`: `buildIntegralV3ValidationContext` builds `evidenceStateManifest` fail-closed from the real `companyEvidenceClasses` already fetched for the run and a new `evidenceClassLinkByRequirementId` constructor option (default `{}`, mirroring `categoryOverrides`'s own honest gap). The same governed axes are also attached as `evidence_state_governed` on each `document_evidence.requirement_manifest` entry sent to the model (provider-input guidance, not trust) plus one added policy line instructing the model to reproduce them exactly — validation never relies on the model having done so.
- Tests: `tests/agt002-evidence-state-manifest.test.mjs` (new), plus governed-match RED/GREEN coverage added to `tests/agt002-integral-analysis-v3.test.mjs` and `tests/agt002-preview-engine.test.mjs` (both a real governed-link acceptance case and a mismatch-rejection case), and `evidenceStateManifest` fixtures added to every other v3 test/fixture file that hand-builds a `validationContext`.

**Known non-blocker (unchanged in spirit from the original C-3 gap statement):** with the default empty `evidenceClassLinkByRequirementId`, every real opportunity's `tender_requirement` units resolve to the safe-unknown state today — the model must emit exactly that or the run is rejected — until a governed requirement→evidence-class linkage source is curated and wired (see §5 below, same as `categoryOverrides`).

## 2. Commands and results

```text
node --test --test-concurrency=1 tests/agt002-integral-analysis-v3.test.mjs                  # pass
node --test --test-concurrency=1 tests/agt002-analysis-config.test.mjs                        # pass
node --test --test-concurrency=1 tests/agt002-v3-compatibility.test.mjs                       # pass
node --test --test-concurrency=1 tests/agt002-integral-category-manifest.test.mjs             # pass
node --test --test-concurrency=1 tests/agt002-preview-contract.test.mjs tests/agt002-tender-analysis-contract.test.mjs  # pass
node --test --test-concurrency=1 tests/agt002-preview-engine.test.mjs tests/agt002-preview-input.test.mjs               # pass
node --test --test-concurrency=1 tests/agt002-preview-persistence.test.mjs tests/agt002-v3-persistence-pglite.integration.test.mjs  # pass
node --test --test-concurrency=1 tests/agt002-preview-runtime.test.mjs                        # pass
node --test --test-concurrency=1 tests/agt002-v3-synthetic-end-to-end.test.mjs                # pass
node --test --test-concurrency=1 tests/agt002-v3-real-analysis-view.test.mjs                  # pass
node --test --test-concurrency=1 tests/agt002-*.test.mjs                                      # 137/137 pass
npm run check:backend-parity                                                                  # backend parity OK
npm run build                                                                                 # tsc + vite build OK (pre-existing chunk-size warning only)
npm audit --omit=dev                                                                          # 0 vulnerabilities
git diff --check                                                                              # clean, no whitespace errors
node --test --test-concurrency=1 tests/*.test.mjs                                             # see §3
```

## 3. Full baseline classification

Final run after the independent-review fixes: **376/377 pass, 1 known baseline failure, 0 AGT-002 failures** (`491536 ms`). The only failure is `tests/module-permissions-migration-pglite.test.mjs`: the migration grants `modulo_siio_gerencial` to the historical `director`, while the first deep-equality assertion still derives an expected list that omits it; the immediately following assertion explicitly requires that same permission. This is unrelated to AGT-002 v3 and was reproduced unchanged on the clean `main` worktree at base `f85907d` with the focused command (`0/1`, same assertion at line 98). It is therefore classified as a pre-existing baseline failure, not a regression from this block.

## 4. Independent review

A fresh, independent, read-only Claude Code **Opus** audit reviewed the complete range `431429c..HEAD` plus the uncommitted verification material against the v3 design and plan. Its initial verdict was `REQUEST_CHANGES`: one P1 (the real engine v3 envelope was rejected by its same-version adapter because the closed key/usage shapes diverged), two P2s (the synthetic gate skipped the engine and persistence trusted the carried v2 projection), and two P3 documentation/type findings.

The corrections were implemented with Claude Code Sonnet and verified RED/GREEN: the adapter now accepts the exact closed engine v3 envelope while keeping v2 unchanged; a real `runOnceV3 → validate/adapt → register` regression exercises the production boundaries and confirms the wired safe-unknown abstention; persistence recomputes the projection, rejects any mismatch before RPC, and derives `critical_open_count` from `integral_analysis`; analyzed requirement IDs must equal the governed manifest in count and order; and the TypeScript coverage type includes the company evidence catalog fields. The final Opus re-review returned `APPROVE`, with no P0/P1.

The final re-review retained one defense-in-depth P2: persistence recomputes and cross-checks the v2 projection but does not independently rerun `validateAgt002IntegralAnalysisV3`, because its API currently lacks the governed validation context. Today the only caller is the already-validating engine. Any future API/backfill caller must first add that validation context at the persistence boundary rather than treating the projection check as complete semantic validation.

Historical P0/P1 from the earlier Sonnet review also remain fixed in commit `f823703`: material statuses require the exact governed compliance axis; `human_validation_required` cannot use high confidence and requires evidence unless the unit explicitly abstains.

Self-review findings, applied inline during implementation (not deferred):
- `evidence_coverage` for v3 reuses the exact same rich shape/validator as v2 (`validateEvidenceCoverage`) rather than a separate loose shape, so chunk-text-never-persisted and allowlist-consistency guarantees carry over unchanged.
- The engine and same-version adapter now share the real v3 envelope shape: `v2_projection` is required and verified against a deterministic recomputation, while v3 usage carries `rate_limit`; the separate v2 `cost_usd` contract remains unchanged.
- `context_version_id` on the v3 envelope is engine configuration (`contextVersionId` constructor param), never derived from `previewInput`, matching the design's "governed, not model-supplied" rule.

## 5. Known non-blockers

- `companyEvidenceClassesProvider`, `categoryOverrides`, and `evidenceClassLinkByRequirementId` currently have no real caller wiring `server/index.js`/`api/[...path].js` route handlers to a DB-backed registry loader or governed override/link sources — that plumbing (loading `psi_agt002_company_evidence_registry` rows plus curated category and requirement→evidence-class governance) is the next hard gate before any canary.
- The E5 controlled case against the real Rama Judicial snapshot, and the human QA visual pass with real labels, are both still pending per the design's own rollout gate (§12) and are not claimed here.
- The remaining P2 from independent review is test quality: `tests/agt002-v3-real-analysis-view.test.mjs` verifies the optional guard structurally rather than mounting React in a browser DOM. Real authenticated visual QA remains required before activation.

## 6. No-production statement

- `AGT002_INTEGRAL_CONTRACT_V3` defaults off and was never set to true against any real environment in this session.
- No remote/Supabase migration was applied; migration 063 was already present on this branch and only exercised locally via PGlite.
- No push, no PR, no deploy, no UI activation for real users.
- No production data, no real expediente, no real model calls (all engine tests use fake/synthetic clients).
