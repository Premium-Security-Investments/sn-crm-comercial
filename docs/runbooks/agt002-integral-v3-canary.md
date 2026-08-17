# AGT-002 integral analysis v3 — fail-closed canary runbook

## Status update, 2026-08-17 (phase 9 documentation pass)

This runbook was written while `AGT002_INTEGRAL_CONTRACT_V3` was hard-off everywhere (§"Status and hard-off gate" below, kept verbatim as historical record). Since then, the Manizales SA-24-2026 governed pilot (`feat/agt002-manizales-v3-complete-pilot`, merged to `main` as `960a96702e869531aad94545c137e1b3fe28c0b0`) ran exactly this procedure end to end for that one process and completed it — see `docs/verification/2026-08-15-agt002-manizales-v3-pilot.md`. Per Juan Botero's confirmation in this session (external to this repository, not mechanically re-verified here — no network access to Vercel/Supabase from this sandbox), `AGT002_INTEGRAL_CONTRACT_V3=true` in production today, scoped to Manizales only by the fail-closed check in `agt002-manizales-manifest-source.js` (any other `opportunity_id`/`process` throws `AGT002_MANIZALES_PILOT_SCOPE_MISMATCH` before reaching the provider — mechanically confirmed by reading that file in this session).

**What this means for using this runbook going forward:** the "Status and hard-off gate" section below no longer describes the flag's live production state for Manizales, but its procedure and preconditions remain the correct template for onboarding any *additional* process — see `docs/runbooks/agt002-process-onboarding-gate.md`, which layers the process-package/registry gate on top of this canary procedure. Do not read the paragraph below as claiming the flag is off in production today.

## Status and hard-off gate (as originally written — historical for Manizales)

This branch does **not** activate `AGT002_INTEGRAL_CONTRACT_V3` anywhere, apply any remote migration, deploy, or run against real evidence. The flag stays off until every precondition below is satisfied and a human explicitly enables it for exactly one controlled run.

```text
AGT002_INTEGRAL_CONTRACT_V3=true      # only this literal enables it; anything else stays off
AGT002_CANONICAL_ONLY=true            # required dependency — config throws otherwise
AGT002_CONTEXT_V2=true                # required dependency — config throws otherwise
AGT002_DOCUMENT_RETRIEVAL=true        # required dependency — config throws otherwise
AGT002_LEGAL_CORPUS=true|unset        # optional — absence forces legal abstention per unit, never blocks the flag
```

See `agt002-analysis-config.js` for the exact dependency checks and `docs/verification/2026-08-07-agt002-integral-v3-local.md` for what was implemented and tested locally.

## Preconditions before enabling the flag anywhere

1. **Category governance exists and is curated for the target opportunity.** `agt002-integral-category-manifest.js` fails closed for any requirement whose `front` is `legal` (no honest 1:1 mapping exists) unless an explicit `categoryOverrides` entry is supplied. The mechanism exists (migration `064`, `psi_agt002_integral_governance_overrides`, loaded read-only by `loadAgt002IntegralV3GovernanceIfEnabled` in `server/index.js`/`api/[...path].js`), but the table ships with **zero seed rows by design** — populating it for a real opportunity is a separate, human-curated act, scoped per `opportunity_id`, done outside runtime (no `INSERT`/`UPDATE`/`DELETE` grant exists on this table for any role). Before a real run, either:
   - the target opportunity's requirement manifest contains only `technical`/`financial` fronts, or
   - real, human-curated `category_override` rows exist for that opportunity's actual `requirement_id`s, each with a traceable `rationale`/`source_reference` to the real pliego clause.
   Do not invent overrides ad hoc to make a run pass — that is exactly the fabrication this module exists to prevent. See `docs/verification/2026-08-07-agt002-rama-judicial-governance-gap.md` for why this remains uncurated for the Rama Judicial opportunity today.
2. **Company-evidence registry source is wired (done) — but its `evidenceClassLinkByRequirementId` companion is not curated for the target opportunity by default.** `createAgt002PreviewRuntime({ companyEvidenceRegistryEntries, categoryOverrides, evidenceClassLinkByRequirementId, ... })` now receives real, read-only DB data from `psi_agt002_company_evidence_registry` (migration 061) and `psi_agt002_integral_governance_overrides` (migration 064) on all three canonical flows (`tests/agt002-integral-v3-server-wiring.test.mjs`). With the default empty `evidenceClassLinkByRequirementId` (no curated rows for the opportunity), every `tender_requirement` unit still abstains its five axes to the safe-unknown state — that is fail-closed by design, not a bug.
3. **`contextVersionId` is a real governed context version row**, not `null`, for any canonical registration (existing invariant, unchanged by v3; now forwarded from the server layer on all three flows).
4. **Local gates are green**: `node --test --test-concurrency=1 tests/agt002-*.test.mjs`, `npm run check:backend-parity`, `npm run build`, `npm audit --omit=dev`, `git diff --check`.
5. **QA visual with real labels** of `TenderIntegralAnalysisV3View` has been performed by a human against the target environment before any user is exposed to it — the design (`docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-design.md` §12) makes this a hard release gate, not a nice-to-have.

## Controlled single-run canary procedure

1. Enable `AGT002_INTEGRAL_CONTRACT_V3=true` **only** in the environment used for the controlled run — never a shared/production toggle flipped ahead of the actual test.
2. Confirm the daily/concurrency limits are the same conservative single-run values already used for E6 (`MAX_CONCURRENT=1`, a low `DAILY_MAX_RUNS`), so a misconfiguration cannot fan out into repeated calls.
3. Run exactly one `engine.analyze(...)` call against the target opportunity's real snapshot.
4. Verify, in order, before treating the run as valid:
   - the returned envelope has `schema_version: "3.0.0"` and `status: "completed"`;
   - `integral_analysis.coverage.expected_requirement_ids` exactly matches the governed requirement manifest, in order (1:1 coverage — no extra, missing, or reordered requirement);
   - every unit with a favorable/partial/gap conclusion cites at least one allowlisted evidence reference; every abstained unit has at least one `missing_evidence` entry;
   - `legal_corpus_version_id` is either a real published corpus UUID or `null` — if `null`, every unit's `legal_assessment.status` is `not_applicable` or `not_verified` with `human_legal_review_required: true` (never a bare "supported" claim);
   - `v2_projection.human_review_required === true` and no field claims a definitive `compliant`/`sufficient`/`approved` state (structurally impossible per the contract, but verify the rendered UI doesn't paraphrase it that way either).
5. Persist via `registerAgt002PreviewAnalysis` with `canonicalOnly: true`; confirm exactly one canonical run exists for the opportunity afterward and the prior canonical (if any) is demoted, not deleted.
6. Turn `AGT002_INTEGRAL_CONTRACT_V3` back off for that environment once the controlled run is verified, unless a human has separately authorized continued availability.

## What this runbook deliberately does not authorize

- Enabling the flag for any user-facing environment continuously.
- Skipping the company-evidence registry or category-override **curation** "just this once" — the DB wiring exists, but an empty/uncurated override table for the target opportunity is not a substitute for real curated rows.
- Treating a successful contract validation as a substitute for human review — `human_validation.required: true` / `status: pending` on every unit is the contract's own statement that no AI output here is a final answer.
- Any GO/NO-GO decision, approval, signature, send, or submission — those remain exclusively human actions in their own existing components, unrelated to this contract.
