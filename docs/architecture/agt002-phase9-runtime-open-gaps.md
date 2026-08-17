# AGT-002 Phase 9 — runtime open gaps

Scope: the ARQUITECTURA/RUNTIME block (plan tasks 3, 4, 7, 8). This file records the runtime gaps
that Phase 9 deliberately did **not** force closed because doing so would change durable retry /
claim semantics, and documents the safe path for a follow-up change that carries its own
verification. Fail-closed and minimal-change principles govern everything below.

## Closed in Phase 9

- **Prompt budget dormant (task 7, gap 1) — CLOSED.** `budgetAgt002V3PromptRequest` was wired into
  `runOnceV3` (agt002-preview-engine.js) but left at its default-off, reachable only by a canary
  script, so no production path ever enabled it. Phase 9 activates it inside the shared
  `createAgt002PreviewRuntime` V3 block (`agt002-preview-runtime.js`), so both `server/index.js` and
  `api/[...path].js` inherit it identically (backend parity by construction). A request under budget
  stays byte-identical; an oversized request is deterministically reduced or fails closed with
  `AGT002_V3_PROMPT_BUDGET_EXCEEDED` before any provider call — strictly safer than shipping an
  over-window prompt. Test: `tests/agt002-v3-prompt-budget-runtime-activation.test.mjs`.
  - **Caveat (governance, not a code gap):** the engine default cap
    `AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS = 81_284` is a conservative floor anchored to the
    observed prod plateau, **not** a measured `gpt-5.3-codex-spark` context window. Reconfirm or raise
    it against the real model window before any authorized live `--execute`. Enabling the budget in
    code takes effect only on a future authorized deploy; this session performs no deploy.

## OPEN — not forced

### Durable worker post-bridge stage diagnostics (task 7, gap 2)

**Gap.** Three runtime flows construct the AGT-002 preview engine:

| Flow | Location | Post-bridge stage diagnostics |
|---|---|---|
| Human-answer reanalysis (`reanalyzeAgt002AfterHumanAnswer`) | `server/index.js` (~2802) | YES — delegates to `runAgt002PostBridgeAnalysis` |
| Canonical agent-preview endpoint (canonicalOnly) | `server/index.js` (~4096) | YES — delegates to `runAgt002PostBridgeAnalysis` |
| **Durable worker auto-analysis (`requestAgt002`)** | `server/index.js` (~3388-3488) | **NO** |

The durable worker path runs `engine.analyze(...)` inline (`server/index.js:3472`) and, on failure,
appends a single generic attempt event:

```js
await appendAttempt(idempotencyKey, 'unavailable', {
  error_code: error?.code || 'AGT002_UNAVAILABLE',
  error_message: 'Vig-IA no completó el análisis; se reintentará.',
});
```

It never calls `runAgt002PostBridgeAnalysis`, never wires the bridge telemetry hooks
(`onBridgeInvocationStarted` / `onBridgeResponseReceived`), never calls
`classifyAgt002PostBridgeFailure`, and never emits the `reanalysis_post_bridge_outcome`
observability event. So for an auto-analysis failure, transport vs provider vs `json_parse` vs
`model_output_validation` vs `envelope_build` vs `persistence` are all indistinguishable — they
collapse to one `AGT002_UNAVAILABLE`.

**Why it was NOT forced (semantic/risk).** `runAgt002PostBridgeAnalysis` owns a specific lifecycle:
it releases the claim itself, emits exactly one terminal event, and does **not** retry. The durable
worker's lifecycle is materially different and is relied upon by the job driver:

1. **Retry.** On failure the worker returns `{ status: 'error', error }` (`server/index.js:3481`),
   and the durable job driver (`tender-processing-worker.js`) schedules a **retry** with backoff. The
   attempt message literally says `"se reintentará"`. The orchestrator's single-shot, no-retry model
   would silently remove that durable retry.
2. **Claim ownership.** The worker releases the claim in its own `finally`
   (`server/index.js:3483-3486`). Handing claim release to the orchestrator would double-manage the
   claim (release-after-release / lease races).

Swapping the wrapper in would therefore change durable retry and claim semantics — outside the
minimal, fail-closed remit of this phase — so per plan task 7 ("implementar la corrección mínima
conservando paridad") and the explicit instruction to not force a semantics-changing integration,
it is deferred.

**Recommended safe follow-up (own verification required).** Do NOT adopt the full orchestrator in
the worker. Instead, keep the worker's claim/retry lifecycle intact and only ENRICH the diagnostic,
in three behavior-preserving steps, mirrored byte-identically in `api/[...path].js`:

1. Wire the two observational bridge hooks when constructing the worker runtime
   (`server/index.js:3458`), exactly as the canonical endpoint does at `server/index.js:4076-4077`.
   They never change what is sent/returned.
2. In the `catch` (`server/index.js:3476`), compute
   `classifyAgt002PostBridgeFailure({ phase, error, integralContractV3 })` from the same closed
   catalog the orchestrator uses, and record its `{ stage, error_code }` on the still-`'unavailable'`
   attempt event (status unchanged ⇒ retry unchanged), plus emit one
   `reanalysis_post_bridge_outcome` observability event with the classified stage. No PII/payloads.
3. Add a static parity test (like `tests/agt002-canonical-post-bridge-observability-static.test.mjs`)
   asserting the worker path records a classified stage and that `server/index.js` ==
   `api/[...path].js`.

This closes the observability gap without touching the durable retry/claim contract. It was not
implemented in Phase 9 because it could not be executed/verified in this session (the environment
gates `node`, so tests could not be run), and an unverified change to the durable worker is exactly
the kind of risk this phase must not take.

## Verification note for this phase

`node`, `npm`, and other interpreters are gated behind interactive approval in this session, so the
new/focal tests, `npm run check:backend-parity`, `tsc --noEmit`, and `vite build` could **not** be
executed here. The changes were verified statically against the code and existing tests. The
orchestrator must run, from the app root:

```
node --test tests/agt002-process-package.test.mjs tests/agt002-process-onboarding-gate.test.mjs \
  tests/agt002-integral-manifest-source.test.mjs tests/agt002-v3-contract-json-agreement.test.mjs \
  tests/agt002-v3-critical-questions-subset.test.mjs tests/agt002-v3-prompt-budget-runtime-activation.test.mjs \
  tests/agt002-v3-compatibility.test.mjs tests/agt002-v3-synthetic-end-to-end.test.mjs \
  tests/agt002-manizales-v3-manifest-wiring.test.mjs tests/agt002-preview-runtime.test.mjs \
  tests/agt002-manizales-manifest-scope-envelope.test.mjs
node --test tests/agt002-*.test.mjs
npm run check:backend-parity
npx tsc --noEmit
npm run build
```
