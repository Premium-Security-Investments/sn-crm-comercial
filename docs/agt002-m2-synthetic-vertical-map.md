# AGT-002 F3/M2 — synthetic vertical concept map

`agt002-m2-synthetic-vertical.js` is an isolated, in-memory, pure module. It has no
production/runtime integration and performs no external action of any kind — `requestExternalAction`
is unconditionally denied regardless of sentinel, phase, or decision state. It is not wired into any
AGT-002/AGT-003 pipeline, worker, or route, and it makes no filesystem, network, or database calls
(enforced by the static-isolation test in `tests/agt002-m2-synthetic-vertical.test.mjs`).

This maps each plan concept to an existing repository contract where one exists. Where none exists,
the concept is a **new isolated in-memory synthetic concept** — no database object, table, RPC, or
runtime wiring is invented or implied by this slice.

| Plan concept | Existing repository contract? | Notes |
|---|---|---|
| Source | New isolated in-memory synthetic concept | No existing table/RPC is reused. Modeled by `recordSource`; a `source_id` (must carry the `synthetic-` prefix) and a `fixture://`-locator, never a real document or URL. |
| Conversion | New isolated in-memory synthetic concept | Modeled by `convertSource`. Not the repo's real tender-conversion pipeline (e.g. semantic discovery / chunking workers) — no shared code, schema, or state with those. |
| Expediente | New isolated in-memory synthetic concept | Modeled by `openExpediente`. Distinct from any real "expediente"/case table that may exist elsewhere in the repo; this module imports nothing from the rest of the codebase and shares no identifiers with it. |
| Workset | New isolated in-memory synthetic concept | Modeled by `openWorkset`, analogous in spirit to the repo's governed-workset-selection feature but not the same code path, table, or RPC — this module never reads or writes that feature's state. |
| Analysis | New isolated in-memory synthetic concept | Modeled by `recordAnalysis`. `available: false` records an `unavailability_reason` instead of a `findings_hash`; this is a local invariant of this module, not a mirror of any real analysis-availability contract. |
| Recommendation | New isolated in-memory synthetic concept | Modeled by `buildRecommendation`. Taxonomy is the closed, exported `AGT002_M2_TAXONOMIES` catalog (`favorable`, `unfavorable`, `pending`, `ambiguous`) — a synthetic catalog local to this file, not a shared taxonomy table. |
| Human decision | New isolated in-memory synthetic concept | Modeled by `decide`. The identity check (`validateHumanIdentity`) follows the same closed-catalog convention used elsewhere in AGT-002 (role ids are never treated as a person), but is reimplemented locally here — no shared function or table is called. |
| Transition sentinel | New isolated in-memory synthetic concept | `AGT002_M2_PHASE_TRANSITION_SENTINEL` is a fixed exported string local to this module; every phase-advancing call must present it exactly, or the call is denied with `phase_transition.sentinel_invalid`. Out-of-order calls (including replays of an already-completed phase) are separately denied with `phase_transition.out_of_order`. |
| Unavailable-analysis attestation | New isolated in-memory synthetic concept | Modeled by `validateUnavailableAnalysisAttestation`, invoked only when a `GO` is decided while `analysis.available === false`. The attestation is bound to the exact deciding actor: `attested_by` must equal the deciding `actor` on `principal_id`, `principal_kind`, and `durable_ref.locator`, or the decision is denied with `attestation.actor_mismatch`. Its `reason` must be a structured `{ code, detail }` object with non-empty strings (`attestation.reason_missing` / `attestation.reason_invalid` otherwise); the accepted reason is stored frozen and unchanged. |
| Taxonomy abstention | New isolated in-memory synthetic concept | `pending`/`ambiguous` recommendations make `decide` return `ABSTAINED` with reason `decision.abstained` instead of forcing a verdict — no decision record is produced. |
| External-action denial | New isolated in-memory synthetic concept | `requestExternalAction` always returns `DENIED` with reason `external_action.always_denied` and is audited, regardless of sentinel or chain state. |
| Governed learning | New isolated in-memory synthetic concept | Modeled by `submitLearning`: an in-memory `methodology` object (`version`, `rules`) can only be patched when `approved === true` and the approver passes the same local human-identity validation used at the decision gate. |
| Teardown / reconstruction | New isolated in-memory synthetic concept | `teardown` clears this instance's isolated chain records only; the audit log (the compliance ledger) survives untouched. `verifyAgt002M2ChainIntegrity` / `recomputeAgt002M2RecordHash` are pure functions that reconstruct and verify the hash chain from a `getChain()` snapshot — no external store is read. |

No claim is made anywhere in this document, the module, or its tests that this slice is wired into
any production route, worker, migration, or database object. All ids are synthetic-prefixed,
all locators are `fixture://`, and the static-isolation test asserts the module imports nothing
beyond `node:crypto`.
