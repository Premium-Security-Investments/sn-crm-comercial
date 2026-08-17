# AGT-002 Manizales SA-24-2026 — Complete V3 Governed-Manifest Pilot

> **Superseded execution status (2026-08-17):** this file is the historical pre-gate plan and preserves its original proposals verbatim. Its proposed `067_agt002_manizales_integral_manifest*` names were never the final artifacts: the Manizales governance manifest shipped as `supabase/migrations/066_agt002_manizales_integral_governance.sql`; V3 persistence shipped and was applied as `supabase/migrations/067_agt002_integral_v3_persistence.sql`, with rollback `supabase/rollbacks/067_agt002_integral_v3_persistence_rollback.sql`. Production truth and rollback procedure now live in `CURRENT.md` §0 and `docs/evidence/2026-08-17-agt002-v3-production-closeout.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (preferred) or `superpowers:executing-plans` to run this plan task-by-task. Every behavior change is RED → GREEN → focal regression → local commit. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is executable by agents with **no prior context**: every path, function, command and exit criterion is stated inline. Do **not** improvise scope.

**Pilot:** Rama Judicial — Dirección Seccional de Administración Judicial de Manizales, proceso **SA-24-2026**, `opportunity_id = 54190e51-15fb-46af-b0aa-8f13461a3110`, vigente pliego `document_id = db9752a1-e9ee-49af-b321-883d0c23cf0a` ("9. Pliego de Condiciones Definitivo SA-24-2026.pdf"). **This is the only pilot.** Stop all cosmetics and generalization; every task below is scoped to this one expediente.

**Goal:** Connect a **single, complete, versioned Manizales manifest** to the AGT-002 V3 runtime so that V3 analyzes **every material, scorable or economic** SA-24-2026 requirement that can affect GO, strategy or the offer (not only today's 4 governed extractors), mechanically corrects the existing offline artifacts, proves V3 ≥ V2 coverage without losing any critical dimension, and reserves **exactly one** final human gate for publication/deploy. Coverage accounting is **exhaustive and lossless** through two closed source ledgers: the **`section_ledger` (exactly 15 pre-GO sections, 15/15)** and the **`proposal_ledger` (exactly 20 proposals, 20/20)**. Every ledger item carries an explicit `disposition` — `analyzed_candidate`, `excluded_with_reason`, or `unresolved_visible` — plus `produced_requirement_ids` tracing it forward into the atomized `entries[]`; **no source item silently disappears**. The atomized requirements in `entries[]` may number **more than 20** (a source item split) or **fewer** (merged), and each carries `source_refs[]` back to its ledger item. A `category:null` on a material/scorable/economic requirement keeps it **visible** (`unresolved_visible`, `human_review_required:true`), never silent. The 15 pre-GO sections are a **baseline, not a ceiling** (see G11). Until the final gate, every produced artifact stays `validated_candidate`/`draft` — **never** `human_approved` — and proposals are **never** converted into compliance.

**Architecture:** Add pure, deterministic modules first (manifest builder/validator, mechanical corrector), each with its own RED→GREEN tests. Consolidate the three existing offline artifacts (68-section registry, 15 pre-GO relevant sections carried as the closed `section_ledger`, 20 proposals in 10 sections carried as the closed `proposal_ledger`) plus the 4 runtime governed requirements — of which exactly **3 carry `066` category/evidence bindings** (`financial-working-capital`, `legal-rce-policy`, `legal-collective-life-policy`) and the 4th (`technical-video-surveillance-scope`) has a runtime material policy but **no `066` binding** — into one versioned artifact under `data/agt002/`. Requirements/analysis may cite **any of the 17 vigente/authoritative sources** (vigente pliego, adendas, comunicaciones, anexos, …) via `source_citations[]` with precedence/vigencia rules and preserved `version`/`hash`; proposals extracted from the vigente pliego must cite the vigente pliego (see G12). Extend the V3 runtime injection path (`agt002-preview-input.js` → `agt002-preview-engine.js` → `agt002-preview-runtime.js`) to accept the manifest as a **`manizalesManifestSource`** (strictly bound to `opportunity_id=54190e51-…`/`SA-24-2026`, **fail-closed** for any other tender — no generic classifier) and its `categoryOverrides` / `evidenceClassLinkByRequirementId`, expanding coverage beyond the 4 governed runtime reqs without letting any AI path assert compliance. Keep the closed `integral_analysis.coverage` contract **unchanged**; carry honest coverage as a **server-owned top-level `manifest_scope`** envelope field, validated in `agt002-tender-adapter.js` and `agt002-preview-persistence.js` and **never written by the model** (see G13). Drive a local synthetic run, a **single controlled real-provider canary (local, no persistence, no production write)** run **before** the final gate — which **ephemerally consumes, in memory, the authorized chunks/texts of the 17 documents and the company evidence** through the existing read-only retrieval, storing/logging **no raw content, only a sanitized summary** — and a V2/V3 comparative gate against a **sanitized read-only fixture of the real production V2** (the last real historical V2 run, not assumed canonical). The flag `AGT002_INTEGRAL_CONTRACT_V3` stays **off** in every shared environment. The single final human gate authorizes **only** publish/apply-migration/push/PR/merge/deploy; every earlier step (including the real-provider canary and local migration/PGlite testing) is autonomous and asks Juan for nothing.

**Tech Stack:** Node.js ESM, `node --test` runner, `@electric-sql/pglite` in-memory Postgres, Supabase/PostgreSQL JSONB + existing RPCs, Express/Vercel byte-parity (`server/index.js` ≡ `api/[...path].js`), React + TypeScript (read-only types + one view), `tsc && vite build`.

**Design/reference inputs (read before starting):**
- `docs/runbooks/agt002-integral-v3-canary.md` — the fail-closed canary procedure and preconditions (authoritative).
- `docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-design.md` and `...-audit.md` — the V3 contract and its known gaps.
- `docs/superpowers/plans/2026-08-06-agt002-integral-analysis-v3-implementation-plan.md` — prior V3 block (Tasks 1–10).
- `supabase/migrations/066_agt002_manizales_integral_governance.sql` — the **already human-approved** 6 bindings for the 4 governed requirements (Juan Botero, 2026-08-12). This pilot **extends** the manifest around that set; it does not relitigate it.
- Existing offline artifacts:
  - `docs/governance/registro/manizales-sa-24-2026.registry.json` (68 sections)
  - `docs/governance/analisis/manizales-sa-24-2026.pre-go-analysis.json` (15 pre-GO relevant)
  - `docs/governance/propuestas/manizales-sa-24-2026.section-proposals.json` (20 proposals / 10 sections)
  - `docs/governance/analisis/manizales-sa-24-2026.pre-go-production-reconcile.json` (read-only production crossing)

---

## Global constraints (non-negotiable — an agent that cannot satisfy one STOPS and reports)

- **G1** — Only Manizales SA-24-2026. No other opportunity, no generic classifier, no cosmetic UI work beyond the coverage-honesty fix in Phase 4.
- **G2** — `AGT002_INTEGRAL_CONTRACT_V3` stays **off** in every shared/committed env (`agt002-analysis-config.js` literal-`true`/`1` only). It is enabled **only** inside a single controlled local/canary process, then turned back off.
- **G3** — No AI/automated path may decide GO/NO-GO, approve, assign a person, sign, send, submit, or represent an award. `human_validation.required:true, status:"pending"` per unit is preserved.
- **G4** — Until the single final gate, every artifact this plan produces carries `status:"validated_candidate"` or `"draft"` and `human_approval_required:true`; **never** emit `human_approved`. Proposals stay proposals — the compliance axis abstains to `unknown` (see `agt002-evidence-state-manifest.js` `AGT002_EVIDENCE_STATE_SAFE_UNKNOWN`); no proposal becomes "cumple".
- **G5** — Production is **read-only** only (metadata-only), exclusively through the existing guarded reconcile path (`scripts/agt002-manizales-pre-go-production-reconcile.mjs`, `createReadOnlyClientGuard`). No production writes, no remote migration, no push, PR, merge or deploy. The single controlled real-provider canary (Phase 5) is a **local** process that calls the AI provider read-only and **persists nothing / writes no production**; it is not a production write. It may **ephemerally consume, in memory only, the authorized chunks/texts of the 17 documents and the company evidence** through the **existing read-only retrieval path** (no new access), and must store/log **no raw content — only a sanitized, metadata-only summary** (reuse `assertNoOpenPii` / the reconcile sanitizer). Raw document/evidence text never lands in an artifact, log, or fixture. Do **not** run `git commit` as part of executing this plan unless a task explicitly says "local commit" (all commits here are local-only); never push.
- **G6** — Never delete or relabel V2 runs; V2 history is immutable. V3 supersedes V2 via existing canonical promotion (migration 063), never by mutation.
- **G7** — `server/index.js` and `api/[...path].js` stay **byte-identical** after any backend change (`npm run check:backend-parity`).
- **G8** — No secrets in any artifact. Every generated JSON/MD is scanned (Phase 8) and must contain no tokens, keys, `.env` values, service-role JWTs, HMAC secrets, or open PII (reuse `assertNoOpenPii` / `assertSanitaryReconcileMetadataOnly`).
- **G9** — If the pilot fails any quantitative or qualitative success criterion (Phase 8 §Success), **stop and report a technical NO-GO**; do not deploy, do not open the gate.
- **G10** — If any task discovers a required schema change beyond the reserved `067`, **stop** and route it to a separate migration design/review gate (do not write SQL inline). The reserved migration `067` (Phase 7) **may be designed and tested locally** against PGlite before the gate (idempotent/fail-closed shape proven in-memory); it is **never applied to production**. Only the final human gate authorizes applying it (or any push/PR/merge/deploy).
- **G11** — The 15 pre-GO relevant sections are a **baseline, not a ceiling**. The cierre/prórroga of V2 (section **1.8 / comunicaciones**, closing date / extension) is preserved as a **vigencia/lifecycle gate** even if honoring it expands scope beyond the 15 or the section can only be carried as a **visible material omission** (`unresolved_visible`); it is never dropped.
- **G12** — Sources are **not** limited to the pliego. Proposals **extracted from** the vigente pliego must cite the vigente pliego; requirements/analysis may cite **any of the 17 vigente/authoritative sources** (adendas, comunicaciones, anexos, …) via `source_citations[]`, applying precedence/vigencia rules and preserving each source's `version`/`hash`. Only current (vigente) sources ground an `analyzable` entry; superseded sources are flagged `stale`.
- **G13** — The closed `integral_analysis.coverage` contract is **not modified**. Honest coverage travels as a **server-owned top-level `manifest_scope`** field on the envelope and persisted result, validated in `agt002-tender-adapter.js` and `agt002-preview-persistence.js` and **never written by the model** (not inside `integral_analysis`); the UI reads `analysis.manifest_scope`.

## Common verification (run after every GREEN)

```bash
# focal test for the task
node --test --test-concurrency=1 tests/<focal>.test.mjs
# AGT-002 focused suite (must stay green vs. the Phase 0 baseline)
node --test --test-concurrency=1 tests/agt002-*.test.mjs
# backend parity + build + whitespace/conflict check
npm run check:backend-parity
npm run build
git diff --check
```

Full-suite baseline classification happens in Phase 0 and again in Phase 8; classify any failure against that baseline before claiming regression.

---

## File map

**New — pure logic + generators (created by this plan):**
- `agt002-manizales-integral-manifest.js` — pure builder + validator of the complete versioned manifest.
- `agt002-manizales-manifest-corrections.js` — deterministic mechanical corrector (citations, vigencia, atomization, duplicates, phase, materiality, subsanability, candidate evidence, suspicious associations).
- `scripts/agt002-manizales-integral-manifest-generate.mjs` — offline generator that consolidates the three artifacts + governed set into the versioned artifact + a coverage/correction MD.
- `scripts/agt002-manizales-v3-local-run.mjs` — offline/canary driver that builds the V3 validation context from the manifest and runs the engine (synthetic responder for the local pass; a **single controlled real-provider canary** locally, no persistence / no production write, before the final gate). The real canary **ephemerally consumes in memory** the authorized chunks/texts of the 17 documents + company evidence via the existing read-only retrieval and emits **only a sanitized summary** (no raw content stored or logged).
- `scripts/agt002-manizales-v3-visual-qa.mjs` — autonomous visual-QA driver: launches the app with the real Manizales manifest labels, drives the browser, and captures screenshots of `TenderIntegralAnalysisV3View` for independent-agent review (does **not** depend on Juan).
- `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json` — the versioned artifact (checked in, like `data/agt002/legal-corpus-v1.1.json`).
- `docs/governance/manizales-sa-24-2026.integral-manifest-consolidated.md` + `docs/governance/manizales-sa-24-2026.integral-manifest-corrections.json` — the consolidated single-gate human package.
- `docs/verification/2026-08-15-agt002-manizales-v3-pilot.md` — the evidence/verification record.

**New — fixtures:**
- `tests/fixtures/agt002-manizales-v2-production-baseline.json` — a **sanitized, metadata-only fixture of the real production V2 run** obtained read-only via the guarded reconcile path (never a synthetic V2 of just the 4 requirements). Preserves the V2 cierre/prórroga questions, licencia (SuperVigilancia), and paquete documental dimensions; scrubbed with `assertNoOpenPii`.

**New — tests:**
- `tests/agt002-manizales-integral-manifest.test.mjs`
- `tests/agt002-manizales-manifest-corrections.test.mjs`
- `tests/agt002-manizales-integral-manifest-generate-static.test.mjs`
- `tests/agt002-manizales-v3-manifest-wiring.test.mjs`
- `tests/agt002-manizales-v3-local-run.integration.test.mjs`
- `tests/agt002-manizales-manifest-scope-envelope.test.mjs` — asserts `manifest_scope` is a top-level, server-owned envelope field accepted by `agt002-tender-adapter.js` and persisted by `agt002-preview-persistence.js`, and **rejected** if a model/provider payload tries to set it.
- `tests/agt002-manizales-v2-v3-comparison.test.mjs`
- `tests/agt002-manizales-coverage-honesty.test.mjs`
- `tests/agt002-manizales-migration-067-pglite.integration.test.mjs` — designs/tests the reserved `067` locally against PGlite (idempotent/fail-closed), proving it **without** applying it to production.

**Modified — runtime wiring (backend, byte-parity applies):**
- `agt002-preview-input.js` — accept the injected `manizalesManifestSource` (manifest → `requirement_manifest`) instead of only the 4-req deep-analysis matrix; fail closed if its `opportunity_id`/`proceso` is not the SA-24-2026 pilot.
- `agt002-preview-engine.js` — thread the manifest source and its category/evidence-class maps into `buildIntegralV3ValidationContext`; assemble the honest, server-owned **top-level `manifest_scope`** envelope field (analyzable vs full pre-GO scope + dispositions). Do **not** modify the closed `integral_analysis.coverage` contract.
- `agt002-preview-runtime.js` — accept the `manizalesManifestSource` injection (strictly bound to the SA-24-2026 pilot; **fail closed** for any other `opportunity_id`/`proceso` — no generic source) and forward to the engine.
- `agt002-tender-adapter.js` — extend the closed envelope key allow-list + validation to accept the server-owned top-level `manifest_scope`, and **reject** any provider/model attempt to populate it (server-owned only).
- `agt002-preview-persistence.js` — persist the top-level `manifest_scope` alongside `integral_analysis` (add to the persisted content contract), re-derived/validated server-side, never taken from the model payload.
- `server/index.js` + `api/[...path].js` — read-only manifest source selection behind the flag (kept byte-identical).

**Modified — coverage honesty (frontend types + one view):**
- `src/tenders/types.ts` — add an optional read-only `manifest_scope` to the analysis type (top-level, alongside `integral_analysis`), typing the pre-GO manifest section counts + dispositions. Do **not** change the `TenderIntegralAnalysisV3` coverage type.
- `src/tenders/components/TenderIntegralAnalysisV3View.tsx` — read `analysis.manifest_scope`; render the atomized/analyzable requirement count ("analizables N / M") as a **separate** figure from the closed source-ledger tally ("Secciones 15/15 · Propuestas 20/20" with dispositions) and the distinct "secciones pre-GO del manifiesto" (68 registradas) figure; forbid a bare `4 / 4`.

**Read-only (never modified by this plan):**
- `agt002-integral-analysis-v3.js`, `agt002-integral-category-manifest.js`, `agt002-evidence-state-manifest.js`, `agt002-company-evidence-classes.js`, `agt002-v3-compatibility.js`, `agt002-deep-analysis-matrix.js`, `tender-requirement-extraction.js`, `supabase/migrations/066_*`, all V2 code paths. Touch these only if a failing test proves a defect, and only after recording it as a review finding.

**Reserved (drafted + locally PGlite-tested before the gate; applied to production ONLY behind the human gate):**
- `supabase/migrations/067_agt002_manizales_integral_manifest.sql` — the forward migration, **written and exercised locally against PGlite** (idempotent/fail-closed, same `begin; … commit;` transactional shape as `066`: zero rows → insert the exact reviewed set; exact set → no-op; drift → `raise exception … abort`) so its correctness is proven before the gate; **never applied to production** until the single final human gate authorizes it.
- `supabase/migrations/067_agt002_manizales_integral_manifest.rollback.sql` — the **explicit, verifiable rollback file** (exact path, not an ambiguous "+ rollback"): a single `begin; … commit;` transaction that deletes **exactly** the `version=1`/`current=true` reviewed manifest rows for `opportunity_id=54190e51-…` and **aborts on any drift** (row count ≠ the reviewed set), restoring the pre-`067` state. Exercised locally against PGlite (apply → idempotent re-apply no-op → drift aborts → rollback restores) in `tests/agt002-manizales-migration-067-pglite.integration.test.mjs`; never run against production before the gate.

---

## Interfaces between tasks (stable contracts agents rely on)

- **Source ledgers** (the two closed, exhaustive source accountings — every source item is listed exactly once and **none may disappear**):
  ```
  section_ledger:  [ { section_ref, label, disposition, disposition_reason|null, produced_requirement_ids:[requirement_id,...] } ]   // EXACTLY 15 items
  proposal_ledger: [ { proposal_ref, label, disposition, disposition_reason|null, produced_requirement_ids:[requirement_id,...] } ]  // EXACTLY 20 items
  ```
  Each ledger item carries a mandatory `disposition ∈ {analyzed_candidate, excluded_with_reason, unresolved_visible}`; `disposition_reason` is required (documentary basis) when `disposition==="excluded_with_reason"`. `produced_requirement_ids` traces the item **forward** into `entries[]`: an `analyzed_candidate`/`unresolved_visible` item must produce ≥1 requirement id; only an `excluded_with_reason` item may produce `[]`. No source item is dropped — the 15 and the 20 are each accounted in full.
- **Manifest entry** — an **atomized requirement**, emitted by `buildManizalesIntegralManifest`, consumed by the corrector, the wiring and the local-run driver. The `entries[]` count is **independent** of the ledgers: it may be **> 20** (a source item split by atomization) or **< 20** (source items merged), and every entry traces **back** to its origin via `source_refs[]`:
  ```
  {
    requirement_id: string,              // stable; governed ids keep their names (e.g. "financial-working-capital"),
                                         //   proposal-derived ids keep "proposal:<ref>:<slug>"; split ids get suffixes
    origin: "governed_runtime" | "pre_go_proposal" | "registry_section",
    source_refs: [                       // ≥1 back-reference to its real source; split ⇒ siblings share a ref; merge ⇒ one entry lists many refs
      { source: "section_ledger" | "proposal_ledger" | "governed_runtime" | "registry_supplement", ref }
    ],
    // section/proposal refs resolve to the closed 15/20 ledgers; governed_runtime refs resolve to the 4 runtime governed requirement ids;
    // registry_supplement refs resolve to a registered section outside the 15-section baseline (e.g. §1.8 cierre/prórroga). No empty or invented refs.
    item_ref: string|null,               // pliego numeral (e.g. "2.3"); null for the governed runtime reqs and for entries with no single numeral
    label: string,
    category: "discard"|"habilitating"|"technical"|"financial_execution"|null, // null ⇒ requires human curation; a null on a material/scorable/economic req stays VISIBLE (unresolved_visible), never silent
    disposition: "analyzed_candidate"|"excluded_with_reason"|"unresolved_visible", // per-entry analysis disposition; 15/20 source accounting lives in the ledgers above
    disposition_reason: string|null,     // required when disposition==="excluded_with_reason"
    human_review_required: boolean,      // true whenever the entry cannot be safely auto-resolved (null category on a material/scorable/economic req, demoted citation, ambiguous fase, etc.)
    fase: string,                        // registry/pre-GO phase (habilitante|puntuable|...)
    materiality: "material"|"ordinary"|"undetermined",
    subsanability: "subsanable_candidate"|"no_subsanable_candidate"|"no_determinada_requiere_humano",
    evidence_class_id: <one of the 17>|null,   // candidate link; null ⇒ abstains (safe-unknown)
    source_citations: [                  // one OR MORE of the 17 vigente/authoritative sources (pliego, adendas, comunicaciones, anexos); NOT limited to the pliego (G12)
      { document_id, version, hash, is_vigente: boolean, precedence: number, char_start, char_end, quote }
    ],                                   // [] ⇒ abstains; a pliego-extracted proposal MUST include the vigente pliego citation
    analyzable: boolean,                 // true only when category≠null AND ≥1 vigente source_citation resolves (quote matches sliced text)
    status: "validated_candidate"|"draft",
    provenance: { artifact, version }
  }
  ```
- **Manifest envelope:** `{ artifact_type:"agt002_manizales_integral_manifest", contract_version:"agt002-manizales-integral-manifest@1", opportunity_id, proceso:"SA-24-2026", version:1, status:"validated_candidate", human_approval_required:true, generated_at, coverage:{ registry_sections:68, pre_go_relevant:15, proposals:20, proposal_sections:10, governed_runtime:4, governed_bindings_066:3, analyzable:<N>, atomized_entries:<E>, dispositions:{ analyzed_candidate:<a>, excluded_with_reason:<e>, unresolved_visible:<u> } }, section_ledger:[…15…], proposal_ledger:[…20…], entries:[…E…], corrections_applied:[...] }`. The validator asserts `section_ledger.length===15` and `proposal_ledger.length===20`, every ledger item carries a valid `disposition` with per-ledger tallies summing to 15 and 20 respectively, and every `produced_requirement_ids` resolves to a real entry. Every entry has ≥1 `source_refs[]` item resolved by source type: `section_ledger`→one of the closed 15, `proposal_ledger`→one of the closed 20, `governed_runtime`→one of the 4 runtime governed ids, `registry_supplement`→a real section in the 68-section registry outside the baseline ledger. Thus the 15/15 and 20/20 source ledgers remain closed while `entries.length` and supplemental scope may grow beyond them; no source or supplemental gate is silent.
- **Manizales manifest source** (injected into runtime): `{ opportunity_id:"54190e51-15fb-46af-b0aa-8f13461a3110", proceso:"SA-24-2026", requirementManifest:[{requirement_id, front|category, label, sources[]}], categoryOverrides:{[requirement_id]:category}, evidenceClassLinkByRequirementId:{[requirement_id]:evidence_class_id} }` — the exact shapes `deriveAgt002IntegralCategoryManifest` and `buildAgt002EvidenceStateManifest` already require, **strictly bound to the Manizales pilot**. The runtime **fails closed** (throws, no fallback) if the injected source's `opportunity_id`/`proceso` is anything other than the SA-24-2026 pilot — there is no generic/other-tender path.
- **Coverage-honesty field** (Phase 4, G13): the closed `integral_analysis.coverage` contract is **unchanged** (`expected_requirement_ids`/`analyzed_requirement_ids`, 1:1). Honest scope is a **new server-owned top-level envelope field** `manifest_scope:{ registry_sections, pre_go_relevant, proposal_sections, analyzable_requirement_ids, atomized_entry_count, dispositions:{ analyzed_candidate, excluded_with_reason, unresolved_visible }, section_ledger_accounted:15, proposal_ledger_accounted:20 }`. `analyzable_requirement_ids` is the analyzable subset of the atomized `entries[]`; `atomized_entry_count` is `entries.length` (may be more or fewer than 20); `section_ledger_accounted`/`proposal_ledger_accounted` are the closed 15/20 source tallies. It sits **beside** `integral_analysis` (not inside it), is assembled by the engine and validated in `agt002-tender-adapter.js` + `agt002-preview-persistence.js`, is **rejected if present in any model/provider payload**, and the UI reads it as `analysis.manifest_scope` — so analyzable coverage can never be rendered as total coverage, and the 15/15 + 20/20 source ledgers are shown distinctly from the atomized/analyzable requirement count.

---

## Phase 0 — Baseline, guardrails, read-only production snapshot  *(model: Sonnet)*

**Exit criteria:** recorded green/known-fail baseline; flag confirmed off; production reconcile captured read-only; nothing mutated.

- [ ] **T0.1** — Capture the AGT-002 suite baseline. Run and save output to `docs/verification/2026-08-15-agt002-manizales-v3-pilot.md` (create it):
  ```bash
  # Run each suite to completion and persist the FULL log (no tail/head/cat truncation).
  node --test --test-concurrency=1 tests/agt002-*.test.mjs 2>&1 | tee /tmp/agt002-baseline.txt
  node --test --test-concurrency=1 tests/*.test.mjs 2>&1 | tee /tmp/full-suite-baseline.txt
  npm run check:backend-parity && npm run build && git diff --check
  ```
  Record exit codes, any pre-existing failures (classify from the full saved logs, not a truncated view), and the exact HEAD (`git rev-parse HEAD`).
- [ ] **T0.2** — Confirm the flag is off and dependencies gate correctly: assert `buildAgt002AnalysisConfig({})` yields `AGT002_INTEGRAL_CONTRACT_V3:false` and that enabling it without `AGT002_CANONICAL_ONLY/CONTEXT_V2/DOCUMENT_RETRIEVAL` throws (already covered by `tests/agt002-analysis-config.test.mjs` — just run it green).
- [ ] **T0.3** — Read-only production snapshot (metadata-only): run the existing guarded reconcile **without** `--write`:
  ```bash
  node scripts/agt002-manizales-pre-go-production-reconcile.mjs --env-file .env.local
  ```
  Confirm it uses `createReadOnlyClientGuard` (throws on any write/rpc/storage) and that the 17 evidence classes + published legal-corpus version load. Do not pass `--write`. Record the summary counts in the verification doc.
- [ ] **T0.4** — Record the **as-is** coverage lie: note that `TenderIntegralAnalysisV3View.tsx:95` renders `analyzed/expected` and that both equal the 4 governed requirements, so a real Manizales run would show "4 / 4" while 68 sections / 20 proposals exist unanalyzed. This is the defect Phase 4 fixes (via the top-level `manifest_scope`, G13).
- [ ] **T0.5** — Capture the **real production V2 baseline** read-only for the Phase 6 comparison. Using the guarded reconcile path (`createReadOnlyClientGuard`, no `--write`), select the **last real historical V2 run** for SA-24-2026 (`opportunity_id = 54190e51-...`) — the most recent actual V2 run by `created_at`/`version` in the schema-`2.x` history — and **do not assume it is still canonical** (V3 may already have superseded it via migration 063; the query targets the latest real V2 run, not "the current canonical"). Export it as **metadata-only**, sanitize it with `assertNoOpenPii`/`assertSanitaryReconcileMetadataOnly`, and save it to `tests/fixtures/agt002-manizales-v2-production-baseline.json`. **Preserve** the V2 cierre/prórroga questions, licencia (SuperVigilancia) and paquete documental dimensions. This is **read-only** and must **never** be a synthetic V2 of just the 4 requirements (G5, finding 7). Record the selected source run id (and whether it is still canonical) + sanitization result in the verification doc.

---

## Phase 1 — Complete versioned Manizales manifest (pure builder + validator)  *(model: Opus for the builder/validator logic; Sonnet for the generator glue)*

**Exit criteria:** one deterministic artifact consolidates registry(68) + the closed `section_ledger`(exactly 15) + the closed `proposal_ledger`(exactly 20, in 10 sections) + governed(4 runtime, 3 with `066` bindings); **every** one of the 15 `section_ledger` and 20 `proposal_ledger` items is accounted for exactly once with an explicit `disposition` and `produced_requirement_ids` tracing it forward into `entries[]` (15/15, 20/20 — no source item disappears); the atomized `entries[]` may number **more or fewer than 20** and each carries `source_refs[]` back to its ledger item; the cierre/prórroga lifecycle gate (§1.8/comunicaciones) is present even if only as `unresolved_visible` (G11); `source_citations[]` may reference any of the 17 vigente/authoritative sources with `version`/`hash` (G12); validator rejects duplicates, unknown categories, unresolved/superseded citations on `analyzable` entries, a ledger of the wrong length, a missing/invalid `disposition`, an entry whose `source_refs[]` do not resolve, a ledger item whose `produced_requirement_ids` do not resolve, and any `human_approved` status; artifact re-generates byte-identically from fixed inputs.

- [ ] **T1.1 (RED)** — Create `tests/agt002-manizales-integral-manifest.test.mjs`. Assert `buildManizalesIntegralManifest({ registry, preGoAnalysis, sectionProposals, governedOverrides })` (imported from `agt002-manizales-integral-manifest.js`, not yet existing) returns the envelope shape in *Interfaces* above with `coverage.registry_sections===68`, `coverage.proposals===20`, `coverage.proposal_sections===10`, `coverage.governed_runtime===4`, `coverage.governed_bindings_066===3`, `section_ledger.length===15`, `proposal_ledger.length===20`, and `status==="validated_candidate"`. Run:
  ```bash
  node --test --test-concurrency=1 tests/agt002-manizales-integral-manifest.test.mjs
  ```
  Expected: FAIL (module absent).
- [ ] **T1.2 (RED)** — Add closed-shape/invariant assertions to the same test:
  - unknown top-level or entry key → reject;
  - duplicate `requirement_id` across origins → reject;
  - **exhaustive ledger accounting**: `section_ledger.length===15` and `proposal_ledger.length===20`; every ledger item appears exactly once with a valid `disposition` ∈ `{analyzed_candidate,excluded_with_reason,unresolved_visible}`; a missing/extra/duplicated ledger item → reject; the per-ledger disposition tallies must sum to 15 and 20 respectively; `disposition==="excluded_with_reason"` without a `disposition_reason` → reject; an `analyzed_candidate`/`unresolved_visible` ledger item with empty `produced_requirement_ids` → reject; a `produced_requirement_id` that does not resolve to an `entries[]` item → reject; every entry needs ≥1 source ref resolved according to its source type (`section_ledger`, `proposal_ledger`, one of the 4 `governed_runtime` ids, or a real 68-registry `registry_supplement` section); an empty, unknown or unresolved source ref → reject (so `entries.length` may be ≷20 by split/merge and supplemental gates may extend scope, while the closed ledgers remain exactly 15/20);
  - a material/scorable/economic requirement with `category:null` must carry `disposition:"unresolved_visible"` and `human_review_required:true` (never dropped/silent) — a `null` category paired with `disposition:"excluded_with_reason"` for a material/scorable/economic item → reject;
  - `item_ref` is `string|null` (`null` for the governed runtime reqs and entries with no single numeral) — a non-string/non-null `item_ref` → reject;
  - the cierre/prórroga entry (§1.8/comunicaciones) is present (analyzed or `unresolved_visible`), never absent (G11);
  - an entry whose `evidence_class_id` is set but not one of the 17 (`AGT002_COMPANY_EVIDENCE_CLASS_IDS`) → reject;
  - a `category` outside `{discard,habilitating,technical,financial_execution,null}` → reject;
  - any entry `status==="human_approved"` → reject (G4);
  - `source_citations` may reference **any of the 17 vigente/authoritative sources**, each with `document_id`, `version`, `hash`, `is_vigente`, `precedence`; a proposal whose `origin` is the vigente pliego must include the vigente-pliego citation (G12);
  - `analyzable===true` requires both `category!==null` and **at least one** resolved `source_citations[]` entry whose source `is_vigente===true` and whose `[char_start,char_end)` bounds a non-empty `quote` that matches the sliced source text; a citation into a superseded source → not analyzable;
  - the 3 `066`-governed entries inherit their category/evidence-class from the `066` bindings verified in that file (`financial-working-capital→habilitating/rup`, `legal-rce-policy→habilitating/rce_policy`, `legal-collective-life-policy→habilitating/collective_life_policy`); the 4th runtime governed requirement `technical-video-surveillance-scope` has **no `066` binding** — its category is resolved by the deterministic candidate mapping (T1.3, `técnico`→`technical`) and its `evidence_class_id` stays a **candidate** (or `null`/`unresolved_visible`), never asserted as a governed fact (there is **no** `technical_certifications` class in the 17 — it must not be invented).
- [ ] **T1.3 (GREEN)** — Implement `agt002-manizales-integral-manifest.js`: pure functions `buildManizalesIntegralManifest(...)` and `validateManizalesIntegralManifest(value)`. No DB, no globals, no network — inputs are the parsed JSON artifacts + the governed-override set (passed in, mirrored verbatim from `066`: the 3 bound requirements; the 4th runtime governed req carries no `066` binding). Map `requirement_kind`/`fase`/`frente`/cita → `category` with a **deterministic candidate mapping** over the 4 existing categories (no blanket `puntuable`/`regla_entidad`→`null`):
  - `descarte`/`rechazo` (discard/rejection causes) → `discard`;
  - `jurídico`/`financiero`/`organizacional`/`experiencia`/`subsanabilidad` → `habilitating`;
  - `calidad`/`técnico`/`social` puntuable → `technical`;
  - `precio`/`oferta`/`viabilidad económica` → `financial_execution`;
  - **only the irreducibly ambiguous** (no fase/frente/cita resolves) stays `category:null` + `disposition:"unresolved_visible"` + `human_review_required:true`.
  Assign each entry a `disposition` (`analyzed_candidate` when analyzable; `excluded_with_reason` + a **documentary** `disposition_reason` only for a genuine discard cause; otherwise `unresolved_visible`). Every **material/scorable/economic** requirement must reach the canary as an `analyzed_candidate`, or — if it cannot be resolved — remain `unresolved_visible` and **force a technical NO-GO** (never silently excluded); exclusion is permitted **only** with a documented documental reason. Carry `subsanability`, `materiality` (from `agt002-pre-go-analysis.js` `GOVERNED_REQUIREMENT_MATERIAL_POLICY` for the 4 runtime governed reqs, `undetermined` for proposals until curated), and `source_citations[]` verbatim (preserving each source's `version`/`hash`/`is_vigente`/`precedence`). Populate the closed `section_ledger` (15) and `proposal_ledger` (20), each item with its `disposition` + `produced_requirement_ids`. Set each entry's `source_refs[]` by actual origin: baseline section/proposal entries point to their ledger items; the 4 existing requirements point to `governed_runtime`; cierre/prórroga or another justified expansion beyond the baseline points to `registry_supplement` and must resolve to the 68-section registry. Ensure the cierre/prórroga §1.8 lifecycle gate is emitted even when only `unresolved_visible` (G11). Never fabricate a category or evidence link — leave `null`, keep the entry visible (`human_review_required:true`), and set `analyzable:false`.
- [ ] **T1.4 (RED→GREEN)** — Create `scripts/agt002-manizales-integral-manifest-generate.mjs` + `tests/agt002-manizales-integral-manifest-generate-static.test.mjs` (static-style: `readFileSync` the script and assert it reads the three artifact paths, writes `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json` + `docs/governance/manizales-sa-24-2026.integral-manifest-consolidated.md`, sets `status:"validated_candidate"`, and calls `assertNoOpenPii`). Then run the generator:
  ```bash
  node scripts/agt002-manizales-integral-manifest-generate.mjs 2026-08-15T00:00:00.000Z
  node --test --test-concurrency=1 tests/agt002-manizales-integral-manifest-generate-static.test.mjs
  ```
- [ ] **T1.5** — Determinism check: run the generator twice with the same `generatedAt`; assert byte-identical artifact (`git diff --exit-code data/agt002/manizales-sa-24-2026.integral-manifest.v1.json` after regeneration). Local commit: `feat(agt002): complete versioned Manizales integral manifest`.

---

## Phase 2 — Mechanical corrections pass  *(model: Opus — this is the correctness-critical review logic; QA independent verify at end)*

**Exit criteria:** a deterministic corrector flags and mechanically fixes the nine defect classes required by scope; every correction is logged with a reason and citation; no correction promotes a proposal to compliance or to `human_approved`.

Correct/normalize the following (constraint 5), each as an idempotent rule with a recorded `correction` entry `{ requirement_id, rule, before, after, basis_citation }`:

- [ ] **T2.1 (RED)** — `tests/agt002-manizales-manifest-corrections.test.mjs` asserting `applyManizalesManifestCorrections(manifest)` (from `agt002-manizales-manifest-corrections.js`) handles:
  1. **Citations** — every `analyzable` entry has ≥1 `source_citations[]` entry whose `[char_start,char_end)` lies inside the cited source's body and whose `quote` matches the sliced text; a mismatch is demoted to `analyzable:false` + `human_review_required` (never silently "fixed" to a guess). Citations may target any of the 17 vigente/authoritative sources (pliego, adendas, comunicaciones, anexos), but a pliego-`origin` proposal must retain its vigente-pliego citation (G12).
  2. **Vigencia / precedence** — a citation into a superseded/`is_vigente:false` source (per registry `provenance` and source precedence) is flagged `stale`; the entry keeps its **vigente** citations and, if none remain, is demoted to `analyzable:false` + `unresolved_visible`. Only vigente sources ground `analyzable`; the vigente pliego `db9752a1-...` and any vigente adenda/comunicación/anexo are current per their `precedence`.
  3. **Atomización** — a single proposal covering two distinct obligations (detected by ≥2 disjoint citations or an "y/además" compound) is split into atomic entries with suffixed ids; the test proves count grows and ids stay unique.
  4. **Duplicados** — same-normalized-label + same `item_ref` collapses to one, keeping the strongest citation; recorded.
  5. **Fase** — `fase` reconciled against `REGISTRO_FASE_POR_CAPITULO` (from `agt002-contractual-registry-taxonomy.js`); mismatch → corrected + logged.
  6. **Materialidad** — set from `AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES`; anything not classifiable stays `undetermined` (never guessed material/ordinary).
  7. **Subsanabilidad** — normalized to `AGT002_PROPOSAL_SUBSANABILITY`; a "regla_entidad" without company evidence maps to `no_determinada_requiere_humano`.
  8. **Evidencia candidata** — `evidence_class_id` validated against the 17; a suspicious/weak link (e.g. name-matched, no citation) is downgraded to `null` (abstains) + logged.
  9. **Asociaciones sospechosas** — cross-check each `evidence_class_id` against `applicability_gate.owner`/`fase`; an implausible pairing (e.g. `oferta_economica` linked to `supervigilancia_operating_license`) is flagged `suspicious_association` and the link removed.
- [ ] **T2.2 (GREEN)** — Implement `agt002-manizales-manifest-corrections.js` as pure, idempotent rules (running twice yields the same result and an empty second-pass correction list). Never emit `human_approved`; never set the compliance axis; downgrades are safe (abstain), never upgrades.
- [ ] **T2.3** — Wire the corrector into the generator (T1.4) so the artifact carries `corrections_applied[]`; write the human-readable summary to `docs/governance/manizales-sa-24-2026.integral-manifest-corrections.json`. Regenerate; assert determinism again.
- [ ] **T2.4 (QA)** — Independent QA agent verifies a 10-entry sample by hand against the vigente pliego citations; record verdict in the verification doc. Local commit: `feat(agt002): mechanical corrections for Manizales manifest`.

---

## Phase 3 — Connect the manifest to the V3 runtime (expand beyond 4, no compliance)  *(model: Opus for engine/input wiring; Sonnet for server mirror)*

**Exit criteria:** with the flag on **in-process only**, the engine builds its V3 validation context from the injected Manizales manifest (analyzable entries), coverage `expected_requirement_ids` equals the manifest's analyzable set in order, proposals abstain on compliance, and flag-off behavior is byte-unchanged. Persistence coexists with V2.

- [ ] **T3.1 (RED)** — `tests/agt002-manizales-v3-manifest-wiring.test.mjs`: with the flag **off**, `buildAgt002PreviewInput(...)` and `createAgt002PreviewEngine(...)` produce the exact current output (the 4-req deep-analysis path) — no drift. With the flag **on** and a `manizalesManifestSource` injected (whose `opportunity_id=54190e51-…`/`proceso=SA-24-2026`), assert (and assert that a source carrying any **other** `opportunity_id`/`proceso` makes the runtime **throw/fail closed**, never fall back to a generic path):
  - `buildAgt002PreviewInput` emits a `requirement_manifest` whose ids equal the manifest's analyzable `requirement_id`s (superset of the 4 governed), each with resolved `sources[]` (document version + hash) from the citation;
  - `deriveAgt002IntegralCategoryManifest` receives the manifest `categoryOverrides` (so `legal`-front proposals get an explicit category and never fail closed);
  - `buildAgt002EvidenceStateManifest` receives `evidenceClassLinkByRequirementId`, and any proposal with `evidence_class_id:null` maps to `AGT002_EVIDENCE_STATE_SAFE_UNKNOWN` (compliance `unknown` — G4);
  - the engine still injects run/snapshot/context/coverage/corpus/usage itself (provider cannot forge them).
- [ ] **T3.2 (GREEN)** — Extend `agt002-preview-input.js`: add an optional `manizalesManifestSource` param to `buildAgt002PreviewInput`; when present and V3 is active, first assert its `opportunity_id`/`proceso` is the SA-24-2026 pilot (**throw/fail closed otherwise**), then build `document_evidence.requirement_manifest` from it (reusing `buildAgt002RequirementManifest` shape and resolving citations to `sources[]`) instead of only the deep-analysis matrix. When absent, behavior is identical to today (the 4-req path). Extend `agt002-preview-engine.js` `buildIntegralV3ValidationContext` to thread `categoryOverrides`/`evidenceClassLinkByRequirementId` from the injected source. No new provider-writable fields.
- [ ] **T3.3 (GREEN)** — Extend `agt002-preview-runtime.js` `createAgt002PreviewRuntime({...})` to accept `manizalesManifestSource` and forward it to `createEngine(...)`, mirroring the existing `companyEvidenceRegistryEntries`/`categoryOverrides` injection (lines around the `AGT002_INTEGRAL_CONTRACT_V3` block). Fail closed if V3 is on and the source is malformed **or** its `opportunity_id`/`proceso` is not the SA-24-2026 pilot (no generic/other-tender fallback).
- [ ] **T3.4 (GREEN)** — Mirror the server selection in `server/index.js` and `api/[...path].js`: behind the flag, load the manifest **read-only** (from the checked-in artifact for local/canary; the DB path stays reserved for Phase 7). Keep the two files **byte-identical**:
  ```bash
  npm run check:backend-parity
  ```
- [ ] **T3.5 (RED→GREEN, PGlite)** — `tests/agt002-manizales-v3-local-run.integration.test.mjs`: seed a historical V2 canonical run, then register a V3 run driven by the manifest (real validator + real `projectAgt002IntegralV3ToV2` + real `registerAgt002PreviewAnalysis`, following `tests/agt002-v3-synthetic-end-to-end.test.mjs` and `tests/agt002-v3-persistence-pglite.integration.test.mjs`). Assert V2 row stays byte-identical (G6), exactly one canonical remains, coverage `expected_requirement_ids` = manifest analyzable set, every proposal unit has compliance `unknown` and `human_validation.status:"pending"`. Local commit: `feat(agt002): wire Manizales manifest into V3 runtime`.

---

## Phase 4 — Coverage honesty (no misleading 4/4) via server-owned top-level `manifest_scope`  *(model: Opus for adapter/persistence validation; Sonnet for UI; autonomous visual QA)*

**Exit criteria:** the closed `integral_analysis.coverage` contract is unchanged; a new **server-owned top-level `manifest_scope`** field distinguishes analyzable requirements from the full pre-GO manifest scope (with 15/15 + 20/20 dispositions), is validated in the adapter and persistence, is rejected from any model/provider payload, and the UI reads `analysis.manifest_scope` and never presents analyzable coverage as total coverage. Autonomous visual QA (browser + screenshots) confirms it.

- [ ] **T4.1 (RED)** — `tests/agt002-manizales-coverage-honesty.test.mjs` (mixed: validator-level + static UI). Assert:
  - the closed `integral_analysis.coverage` shape is **unchanged** (no new keys inside it);
  - the V3 envelope carries a **top-level** `manifest_scope:{ registry_sections, pre_go_relevant, proposal_sections, analyzable_requirement_ids, atomized_entry_count, dispositions:{ analyzed_candidate, excluded_with_reason, unresolved_visible }, section_ledger_accounted:15, proposal_ledger_accounted:20 }` **beside** `integral_analysis`;
  - `src/tenders/types.ts` types this optional top-level field (not on `TenderIntegralAnalysisV3`);
  - `src/tenders/components/TenderIntegralAnalysisV3View.tsx` reads `analysis.manifest_scope` and renders **separately**: a "Requisitos analizables N / M" figure (analyzable subset of the atomized `atomized_entry_count`), a distinct "Secciones pre-GO del manifiesto: 15 (68 registradas)" figure, and the closed-ledger tally "Secciones 15/15 · Propuestas 20/20" with its disposition breakdown — the atomized/analyzable requirement count is shown as a **distinct** figure from the 15/15 + 20/20 source ledgers; and contains **no** template that can print `expected/analyzed` as a standalone total (guard: assert the component references `manifest_scope`).
- [ ] **T4.2 (RED) — server-owned invariant** — `tests/agt002-manizales-manifest-scope-envelope.test.mjs`: assert `agt002-tender-adapter.js` accepts a top-level `manifest_scope` in its closed key allow-list and validates its shape, **rejects** an envelope where `manifest_scope` is missing when V3+manifest is active, and **rejects** any attempt to source `manifest_scope` from the model/provider payload (it must be re-derived server-side). Assert `agt002-preview-persistence.js` persists `manifest_scope` alongside `integral_analysis` (extend the persisted content contract) and never copies a model-supplied value.
- [ ] **T4.3 (GREEN)** — Assemble the top-level `manifest_scope` in `agt002-preview-engine.js` envelope assembly (derive from the injected manifest coverage/dispositions; the provider cannot write it), **without** altering `integral_analysis.coverage`. Extend `agt002-tender-adapter.js` (allow-list + validation, server-owned reject) and `agt002-preview-persistence.js` (persist it). Add the optional top-level type to `src/tenders/types.ts`. Update `TenderIntegralAnalysisV3View.tsx` (line ~95/105) to read `analysis.manifest_scope` and render the distinct figures. Do not touch V2 views. Keep `server/index.js` ≡ `api/[...path].js`.
- [ ] **T4.4** — `npm run build` + `npm run check:backend-parity` green. Local commit: `feat(agt002): honest Manizales V3 coverage via server-owned manifest_scope`.
- [ ] **T4.5 (autonomous visual QA)** — Run `scripts/agt002-manizales-v3-visual-qa.mjs`: launch the app locally with the real Manizales manifest labels, drive the browser, and capture screenshots of `TenderIntegralAnalysisV3View` into `docs/verification/screenshots/`. A **separate independent QA agent** (no prior context, autonomous — does **not** depend on Juan) reviews the screenshots against the rule "analyzable N/M and pre-GO scope shown distinctly; no bare 4/4; 15/15 + 20/20 dispositions visible" and records a pass/fail verdict in the verification doc. This is fully automated here; the only human involvement remains the single final gate.

---

## Phase 5 — V3 local/canary run over all approvable requirements  *(model: Opus for the driver correctness; Sonnet for reconcile glue)*

**Exit criteria:** a local run analyzes every `analyzable` manifest requirement, crosses documents + the 17 evidence classes, and raises questions **only** for material exceptions; a read-only production reconcile confirms evidence state without writes.

- [ ] **T5.1 (RED→GREEN)** — Create `scripts/agt002-manizales-v3-local-run.mjs`: builds the V3 validation context from the manifest, runs `engine.analyze(...)` with a **synthetic responder** locally (reuse `tests/fixtures/agt002-v3-synthetic-responder.mjs` patterns; no real bridge), and prints, per requirement: category, evidence_state (5 axes), compliance `unknown` for proposals, and any `missing_evidence`. Add `tests/agt002-manizales-v3-local-run.integration.test.mjs` coverage (may share with T3.5) asserting all analyzable ids are present and ordered, and that questions are emitted only for units with a material impediment (`AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES`) or a critical `missing_evidence`.
- [ ] **T5.2** — Cross with real evidence read-only: extend/rerun `scripts/agt002-manizales-pre-go-production-reconcile.mjs --env-file .env.local` (no `--write`) to confirm each manifest `evidence_class_id` resolves against the 17 production classes; record the crossing (metadata-only) in the verification doc. **Never** write production.
- [ ] **T5.3** — Exceptions-only questions: assert the number of generated human questions equals the count of material exceptions, not one-per-requirement (avoids the "20-item approval" burden, constraint 6). Local commit: `feat(agt002): Manizales V3 local canary driver`.
- [ ] **T5.4 (single controlled real-provider canary — executed here, before the gate)** — Run the single controlled real-bridge canary per `docs/runbooks/agt002-integral-v3-canary.md` §"Controlled single-run", **exactly once**, as a **local controlled process**: enable `AGT002_INTEGRAL_CONTRACT_V3` via a **local** flag in a throwaway in-process env, `MAX_CONCURRENT=1`, one `engine.analyze` against the real provider over the manifest. The run **ephemerally consumes, in memory only, the authorized chunks/texts of the 17 documents and the company evidence** through the **existing read-only retrieval** (no new access path); it stores/logs **no raw content — only a sanitized, metadata-only summary** (reuse `assertNoOpenPii`/the reconcile sanitizer). Verify on the engine output the **real** `integral_analysis.contract_version` (do **not** expect a `schema_version` field on the engine output — the engine emits `contract_version`), coverage 1:1 for the analyzable set, evidence-or-abstention, `v2_projection.human_review_required===true`, and the top-level `manifest_scope` present. The persisted `schema_version:"3.0.0"` is exercised **only** via a **persistence dry-run / mock RPC** (never a production write) if the persistence path is exercised at all. **Persist nothing and write no production** (do not call `registerAgt002PreviewAnalysis`/RPCs against production; use the read-only guard); then turn the flag **off**. The user's authorization already covers running this necessary test. Record the canary output (sanitized summary only, no raw content) in the verification doc. The final human gate (Phase 7) is **not** required for this canary — it is reserved solely for publish/apply-migration/push/PR/merge/deploy.

---

## Phase 6 — V2 vs V3 comparative gate (V3 must not lose, must gain)  *(model: Opus)*

**Exit criteria:** a real comparative test proves V3 covers every V2-critical dimension and strictly increases coverage while adding value.

- [ ] **T6.1 (RED)** — `tests/agt002-manizales-v2-v3-comparison.test.mjs`. Load the **sanitized real production V2 baseline** from `tests/fixtures/agt002-manizales-v2-production-baseline.json` (captured read-only in T0.5 — **not** a synthetic V2 of the 4 requirements) and build the V3 result (via the manifest path). Assert V3 does **not** lose any of these dimensions present in the production V2 baseline (each must appear as an analyzable unit or an explicit abstention with `human_review_required`/`unresolved_visible`, never silently dropped):
  - cierre/prórroga (closing date / extension),
  - licencia (SuperVigilancia / communications),
  - experiencia (accredited experience / RUP),
  - capacidad financiera (working capital, organizational indices),
  - capacidad técnica (video-surveillance scope),
  - capacidad económica (oferta económica),
  - SST / paquete documental (SST program, documentary package).
- [ ] **T6.2 (GREEN)** — Assert quantitative gain (measured against the real V2 baseline, **not** a bare `>4` threshold): `V3.manifest_scope.analyzable_requirement_ids.length > (number of distinct requirement dimensions in the production V2 baseline fixture)` and `V3.manifest_scope.pre_go_relevant >= 15` with `manifest_scope.section_ledger_accounted===15` and `manifest_scope.proposal_ledger_accounted===20`. Assert value-add: every dimension in the V2 baseline is matched by a V3 unit or explicit abstention, at least the pre-GO sections not covered by V2 appear as `human_review_required`/`unresolved_visible` units, and no V3 unit asserts compliance for a proposal (G4). If V3 loses any V2-baseline dimension or does not strictly increase coverage → **technical NO-GO** (G9). Local commit: `test(agt002): Manizales V2/V3 comparative gate`.

---

## Phase 7 — Consolidated single human-gate package  *(model: Sonnet to assemble; human to decide)*

**Exit criteria:** one consolidated package, not 20 item approvals; a single reserved gate authorizes publication/deploy; nothing is `human_approved` before it.

- [ ] **T7.1** — Assemble `docs/governance/manizales-sa-24-2026.integral-manifest-consolidated.md`: the complete manifest, corrections log, coverage figures, V2/V3 comparison result, local-canary evidence, and the exact list of what the gate would authorize (publish artifact + optionally seed the expanded overrides). Status stays `validated_candidate`. Present **one** decision, not 20.
- [ ] **T7.2 (draft + local PGlite test; production apply gate-only)** — Write the forward migration `supabase/migrations/067_agt002_manizales_integral_manifest.sql` following `066`'s fail-closed/idempotent transactional shape (`begin; … commit;`: zero rows → insert reviewed set; exact set → no-op; drift → `raise exception` abort) **and** its companion rollback at the exact path `supabase/migrations/067_agt002_manizales_integral_manifest.rollback.sql` (a `begin; … commit;` transaction that deletes exactly the `version=1`/`current=true` reviewed rows for `opportunity_id=54190e51-…` and aborts on any drift) — not an ambiguous "+ rollback". **Prove both locally against PGlite** via `tests/agt002-manizales-migration-067-pglite.integration.test.mjs` (apply → idempotent re-apply no-op → drift aborts → rollback file restores the pre-`067` state). This local design/testing is allowed before the gate (G10). Neither file is **ever applied to production** here; the SQL travels as a proven proposal in the consolidated package, and only the single final human gate authorizes applying it. **No production `INSERT`/migration/push runs in this plan.**
- [ ] **T7.3** — State the human gate explicitly in the verification doc: "Publication/deploy requires Juan Botero's single explicit authorization; until then flag off, no migration, no push/PR/merge/deploy." Local commit: `docs(agt002): consolidated Manizales V3 single-gate package`.

---

## Phase 8 — Regression, security, independent QA, evidence, release-readiness GO / technical NO-GO  *(model: Opus finalize; independent QA agent)*

> **Scope of the decision:** the GO/NO-GO in this phase is a **`release readiness GO` / `technical NO-GO`** decision about whether the pilot's code + artifacts are safe to publish/deploy behind the single human gate. It is **never** a commercial decision about the SA-24-2026 tender itself (no bid GO/NO-GO, no award, no submission) — that authority stays entirely with Juan and is out of this plan's scope (G3).

**Exit criteria:** full gate green vs baseline; no secrets; independent review clean; explicit **release-readiness GO or technical NO-GO** recorded.

- [ ] **T8.1** — Focused + full suite:
  ```bash
  node --test --test-concurrency=1 tests/agt002-*.test.mjs      # zero AGT-002 failures
  node --test --test-concurrency=1 tests/*.test.mjs             # classify vs Phase 0 baseline
  npm run check:backend-parity && npm run build && git diff --check
  npm audit --omit=dev
  ```
- [ ] **T8.2 (secrets scan, G8)** — Scan every produced artifact (`data/agt002/manizales-sa-24-2026.integral-manifest.v1.json`, the two `docs/governance/manizales-*` files, `tests/fixtures/agt002-manizales-v2-production-baseline.json`, the `docs/verification/screenshots/*`, and the verification doc) for tokens/keys/JWTs/HMAC/`.env` values and open PII; reuse `assertNoOpenPii` and the reconcile sanitizer. Record clean result. Confirm `.gitignore` still excludes `.env*`.
- [ ] **T8.3 (independent QA — separate agent, no prior context)** — Review scope: manifest completeness vs the 68/15/20 artifacts; each correction rule's soundness; category/evidence-link plausibility; V2/V3 non-loss; coverage-honesty UI; authority boundaries (no compliance, no `human_approved`, no GO/NO-GO); flag-off equivalence; byte-parity; V2 immutability. Fix P0/P1, rerun affected tests, rerun the final gate once.
- [ ] **T8.4** — Record in `docs/verification/2026-08-15-agt002-manizales-v3-pilot.md`: exact commands, timestamps, exit codes, baseline classification, QA verdict, secrets-scan result, and the **GO / technical NO-GO** decision against the criteria below. Update `CURRENT.md` as branch-only/not deployed. Local commit: `docs(agt002): record Manizales V3 pilot gate`.

### Success criteria

**Quantitative:**
- Manifest consolidates exactly registry=68, pre-GO relevant=15, proposals=20 in 10 sections, governed runtime=4 (3 with bindings `066`); all atomized `requirement_id`s are unique.
- **Lossless accounting**: `section_ledger` contains exactly 15/15 source sections and `proposal_ledger` exactly 20/20 source proposals; every item carries an explicit `disposition`, every produced id resolves to an atomized entry and every entry traces back through `source_refs[]`; none disappears; the cierre/prórroga §1.8 lifecycle gate is present.
- Every material/scorable/economic source item is either represented by an `analyzed_candidate` in the canary or remains visibly unresolved and forces technical NO-GO; exclusion is accepted only with a documentary reason.
- `V3.manifest_scope.analyzable_requirement_ids.length` is strictly greater than the number of distinct dimensions in the sanitized real production V2 baseline; coverage `expected==analyzed` (1:1) for the full analyzable set in order, and the closed `integral_analysis.coverage` contract is unchanged (honest scope is carried by the server-owned top-level `manifest_scope`).
- V2/V3 comparison against the sanitized production V2 baseline: 0 lost critical dimensions; coverage strictly increased.
- Corrector idempotent (empty second-pass correction list); artifact re-generates byte-identically. Migration `067` proven locally against PGlite (apply/idempotent/drift-abort/rollback) and **not** applied to production.
- AGT-002 focused suite: 0 new failures vs Phase 0 baseline; parity + build + `git diff --check` green; `npm audit --omit=dev` no new criticals.

**Qualitative:**
- No proposal converted to compliance; compliance axis `unknown` for all proposals; no artifact `human_approved`.
- Coverage UI cannot render a misleading 4/4; pre-GO scope + 15/15 and 20/20 dispositions shown distinctly via `analysis.manifest_scope`; autonomous visual QA passed (no dependency on Juan).
- `manifest_scope` is server-owned (rejected from any model/provider payload); `integral_analysis.coverage` unchanged.
- Single controlled real-provider canary executed once locally, persisted nothing, wrote no production; flag off afterward.
- Flag off in every shared env; no production write, migration apply, push, PR, merge or deploy without the single final human gate (which authorizes only those).
- V2 history intact; production V2 baseline captured read-only; `server/index.js` ≡ `api/[...path].js`.

**If any quantitative criterion fails → technical NO-GO (G9): stop, record, do not open the gate, do not deploy.**

---

## Rollback

- All work is local-branch only; no push/PR/deploy occurs, so rollback = `git reset`/branch discard. New artifacts (`data/agt002/manizales-sa-24-2026.integral-manifest.v1.json`, `docs/governance/manizales-*`) are additive and deletable with no runtime effect (flag off).
- Runtime wiring is behind `AGT002_INTEGRAL_CONTRACT_V3` (default off) and the optional `manizalesManifestSource` injection (pilot-bound, fail-closed for any other tender): with either absent, `buildAgt002PreviewInput`/engine behave exactly as today (proven by the flag-off tests in T3.1), so reverting is a no-op for production.
- No migration is applied **to production**; migration `067` is exercised **only** against local PGlite and stays an un-applied proposal for production, so there is nothing to roll back in the real database. If the gate is opened and `067` later applied to production, its companion rollback file `supabase/migrations/067_agt002_manizales_integral_manifest.rollback.sql` (transactional delete of exactly the reviewed `version=1`/`current=true` rows, drift-abort) plus the `066`-style forward drift-abort guard are the exact recovery path.
- V2 runs are never mutated/deleted, so V2 remains the live canonical if V3 is never activated.

## Observability

- Reuse `agt002-analysis-observability.js` / `agt002-post-bridge-observability.js` counters; the engine already routes V3 rejections through `recordOutputRejected` with the closed `AGT002_V3_SAFE_VALIDATION_CODES` — assert no payload content is logged.
- The local-run driver prints per-requirement category + 5-axis evidence_state + missing_evidence and a coverage summary (analyzable vs pre-GO scope) for human inspection.
- The consolidated package + verification doc are the durable audit trail; corrections log gives per-fix provenance.

## Evidence to deliver
1. `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json` (versioned, `validated_candidate`).
2. `docs/governance/manizales-sa-24-2026.integral-manifest-consolidated.md` + `...-corrections.json`.
3. `docs/verification/2026-08-15-agt002-manizales-v3-pilot.md` (baseline, commands, exit codes, QA verdict, secrets scan, V2/V3 comparison, GO/NO-GO).
4. Green focal + AGT-002 suites, parity, build, `git diff --check`, `npm audit --omit=dev` logs.
5. Read-only production reconcile summary (metadata-only).
6. Reserved (gate-only) `supabase/migrations/067_agt002_manizales_integral_manifest.sql` proposal text — un-applied.

## Model / role assignment
- **Opus:** Phase 1 builder/validator, Phase 2 correction rules, Phase 3 engine/input wiring, Phase 5 driver, Phase 6 comparative gate, Phase 8 finalize — correctness-critical, invariant-heavy.
- **Sonnet:** Phase 0 baseline, generator/glue/static tests, Phase 4 UI, server mirror, Phase 7 package assembly.
- **Independent QA (separate agent, no prior context):** Phase 2 sample verify and Phase 8 full review — must be adversarial and must not have written the code it reviews.
