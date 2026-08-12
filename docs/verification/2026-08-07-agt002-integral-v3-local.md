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

- The E5 controlled case against the real Rama Judicial snapshot, and the human QA visual pass with real labels, are both still pending per the design's own rollout gate (§12) and are not claimed here.
- The remaining P2 from independent review is test quality: `tests/agt002-v3-real-analysis-view.test.mjs` verifies the optional guard structurally rather than mounting React in a browser DOM. Real authenticated visual QA remains required before activation.

## 6. No-production statement

- `AGT002_INTEGRAL_CONTRACT_V3` defaults off and was never set to true against any real environment in this session.
- No remote/Supabase migration was applied; migrations 063 and the new 064 were exercised only locally via PGlite.
- No push, no PR, no deploy, no UI activation for real users.
- No production data, no real expediente, no real model calls (all engine tests use fake/synthetic clients).

## 7. Autonomous technical closure — 2026-08-07 07:14 COT

A final disk/VCS audit found no inherited uncommitted changes. `origin/main` is now `39bef1d`, two commits ahead of this branch's merge-base `f85907d`; no integration, push, PR, merge or deployment was performed.

Fresh sequential evidence for the closure is recorded in `CURRENT.md`. The complete suite remained `376/377`, with the sole failure at `tests/module-permissions-migration-pglite.test.mjs:98`; the same focused test failed identically (`0/1`) from a clean archive of current `origin/main` (`39bef1d`), so it remains baseline rather than an AGT-002 regression.

Additional closure assertions now make the authority boundary explicit: absent `legal_corpus_version_id`, only `not_applicable`/`not_verified` legal assessments and zero legal-corpus references are accepted; autonomous `go`, `no_go`, `approve`, `sign`, `send` and `submit` action types are rejected by the closed enum; every accepted action remains side-effect-free and human validation stays pending. The real five-phase view continues to consume only `analysis.integral_analysis` and contains no fixture `UNITS` or Rama Judicial hardcode.

Release classification is **NOT READY for a real canary** until the governed DB-backed evidence source, human-curated category/evidence links, and authenticated visual QA all exist. The canary runbook is documentation only and was not executed.

## 8. Follow-up (2026-08-07, continuation session): governance overrides source + real server wiring

Resumed a session interrupted mid-flight; the worktree carried two already-committed, already-GREEN commits (`efad172` raw registry-row loader, `9ce504b` `evidenceClassLinkByRequirementId` forwarding fix) plus uncommitted source. Audited both commits and the uncommitted material (a governed source module, migration `064` + rollback, unit + PGlite tests) against the design and this document's own §5 gate before continuing — all consistent with the established fail-closed discipline, no fabrication found, tests GREEN as committed/left.

Closed, test-first, in this continuation:

- **Governance overrides source** (`agt002-integral-governance-overrides.js`, migration `064`/`psi_agt002_integral_governance_overrides`, rollback, `tests/agt002-integral-governance-overrides.test.mjs`, `tests/agt002-integral-governance-overrides-pglite.integration.test.mjs`): a per-`opportunity_id` (since `requirement_id` is not globally stable — `agt002-deep-analysis-matrix.js`) human-curated source for both `categoryOverrides` and `evidenceClassLinkByRequirementId`. Every row requires `rationale`, `source_reference` and `curated_by`; malformed/incomplete/cross-kind-inconsistent rows fail closed, never guessed. Migration-only write surface: RLS enabled, only `service_role` SELECT granted, zero write grants for any role — curation happens outside runtime, mirroring migration `061`'s own discipline. Ships with zero seed rows.
- **Real server wiring** (`server/index.js`/`api/[...path].js`, `tests/agt002-integral-v3-server-wiring.test.mjs`, RED confirmed before implementation): closed the exact gap this document's §5 previously named. A new `loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)` helper (mirrors `loadAgt002LegalCorpusContextIfEnabled`'s own conditional-load pattern) returns `null` with zero DB round-trips when `AGT002_INTEGRAL_CONTRACT_V3` is off, and otherwise loads `loadAgt002CompanyEvidenceRegistryEntries(database)` plus `loadAgt002IntegralGovernanceOverrides(database, opportunityId)` in parallel. All three canonical flows (reanalysis after human answer, worker-triggered auto analysis, manual agent-preview endpoint) call it before constructing the runtime and forward `companyEvidenceRegistryEntries`, `categoryOverrides`, `evidenceClassLinkByRequirementId` and `contextVersionId: contextVersion?.id ?? null` into `createAgt002PreviewRuntime`. The runtime itself remains DB-free (asserted by the wiring test). `server/index.js` and `api/[...path].js` stay byte-identical (`npm run check:backend-parity` / `tests/backend-parity.test.mjs`).
- **Rama Judicial expediente (`54190e51-15fb-46af-b0aa-8f13461a3110`), deliberately left uncurated and documented**: see `docs/verification/2026-08-07-agt002-rama-judicial-governance-gap.md`. No `category_override`/`evidence_class_link` row was authored for this opportunity — this session has no real Supabase connection (`.env.local` carries only `VERCEL_OIDC_TOKEN`), no access to the real pliego text, and no access to the opportunity's real extracted `requirement_id` set. Authoring a row without those would be exactly the keyword/presence/intuition fabrication this task forbids. The governance table remains at zero curated rows for this opportunity; every `tender_requirement` unit will abstain to the safe-unknown five-axis state and any `legal`-front requirement will fail closed at category derivation, exactly as designed.

Sequential gates re-run after this block: focal loader/runtime/governance/wiring tests all GREEN; `tests/agt002-*.test.mjs` **140/140**; relevant PGlite **3/3** (`064`, v3/v2 coexistence `063`, workbench hardening); backend parity **OK**; build **OK** with only the pre-existing >500 kB chunk warning; `npm audit --omit=dev` **0 vulnerabilities**; `git diff --check` clean; full suite **379/380**. The sole failure remains the known unrelated baseline at `tests/module-permissions-migration-pglite.test.mjs:98` (the expected list omits `modulo_siio_gerencial`, while the migration and immediately following assertion require it); there are zero AGT-002 failures.

**Release classification unchanged: NOT READY for a real canary.** The DB wiring gate from §5 is now closed, but the human-curation gate (real `category_override`/`evidence_class_link` rows for a real target opportunity, with real QA visual) is not — and, per the above, could not be honestly closed for Rama Judicial from this session.

## 9. Follow-up audit: persisted governance binding + minimum-exposure guard

An independent Claude Code Opus review against `b99a805`, this verification record,
the v3 design and the canary gates found no P0/P1, and identified three P2 hardening
gaps. They were closed test-first without any remote write, migration, model/canary run,
push, PR, merge or deploy:

- `categoryOverrides` and `evidenceClassLinkByRequirementId` now travel with their exact
  curated `governance_provenance` (`rationale`, `source_reference`, `curated_by`,
  `curated_at`, `version`) through server/runtime/engine and into the persisted v3 run.
  A non-empty map without matching provenance fails before any provider call; persistence
  and the closed tender adapter rebuild and validate the provenance before accepting it.
- `curated_at` must be a parseable timestamp and `version` a positive integer; malformed
  or missing values fail closed. Individual provenance records and the map are frozen.
- Both runtime reads of `psi_agt002_company_evidence_registry` are protected by explicit
  per-reader column allowlists that reject `select(*)`, duplicates, empty columns and any
  column outside the metadata-only set. RLS/ACL remain unchanged and read-only.

Fresh final gates: focal files **8/8**; `tests/agt002-*.test.mjs` **140/140**;
relevant PGlite files **3/3**; backend parity **OK**; build **OK** (only the existing
chunk-size warning); `git diff --check` and byte parity Express/Vercel **OK**; full suite
**379/380**. The sole full-suite failure is still
`tests/module-permissions-migration-pglite.test.mjs`, reproduced **0/1** from a clean
`b99a805` archive. `npm audit --omit=dev` now reports one high transitive advisory for
`nanoid@3.3.16` via Vite/PostCSS; `package.json` and `package-lock.json` are unchanged
from `b99a805`, so it is classified as baseline dependency exposure, not introduced by
this block. Final independent Opus review: passed, no security concerns or logic errors.

**Release classification remains NOT READY for a real canary.** Rama Judicial remains
deliberately uncurated: no read-only traceable pliego/requirement signal was available,
so no map was inferred. Human-curated real mappings, the controlled E5 case and
authenticated visual QA remain mandatory.
