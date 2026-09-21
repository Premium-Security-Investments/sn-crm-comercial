import { strict as assert } from 'node:assert';

// AGT-002 governed workset — operational batch-capacity preflight.
//
// `agt002-governed-workset-capacity.js` implements this module's minimal public API, specified
// below. It sits in front of the existing durable batch planner (agt002-integral-analysis-batches.js
// plans REQUIREMENT batches once a run is already enqueued) and the governed workset freeze flow
// (agt002-governed-document-worksets.js freezes up to a handful of documents — see
// .hermes/plans/2026-09-17-agt002-governed-document-worksets.md, whose Phase 7 validation run is a
// real DANE four-document run). Before a governed workset is frozen/enqueued, this module answers
// one closed, server-owned, deterministic question: given the SERVER-RESOLVED size of the governed
// package (never a client-declared size), how many operational analysis batches would it need, and
// does that fit the route's server-owned operational capacity? APTO/NO_APTO — never a raw
// exception, never a partial answer, never a client-influenced ceiling.
//
//   AGT002_GOVERNED_WORKSET_MAX_BATCHES -> Object.frozen({ [route]: positiveInteger, ... })
//
//     The route-scoped, server-owned policy. Not environment-derived, not client-derived: a closed,
//     immutable map baked into this module. `AGT002_GOVERNED_WORKSET_FREEZE_ROUTE` is the one
//     production route key this preflight currently guards, mapped to a max operational batch count
//     of 64.
//
//   evaluateAgt002GovernedWorksetCapacity({ route, evidence, policy }) -> {
//     version, route, verdict, max_batch_count, predicted_batch_count, source_char_count,
//     chars_per_batch, document_count,
//   }
//
//     Pure, deterministic, never throws for a well-formed call. `policy` defaults to
//     AGT002_GOVERNED_WORKSET_MAX_BATCHES. `evidence` must be SERVER-RESOLVED size evidence
//     (`source_char_count`, `chars_per_batch`, `document_count`) — never trusted from a client
//     payload. `predicted_batch_count` is `ceil(source_char_count / chars_per_batch)`. `verdict` is
//     `'APTO'` when `predicted_batch_count <= max_batch_count` (the policy-resolved ceiling for
//     `route`), else `'NO_APTO'`. Any `max_batch_count` (or any other override-shaped field) carried
//     inside `evidence` is inert: the returned `max_batch_count` always comes from `policy[route]`.
//     Missing/malformed evidence or an invalid/missing route-scoped policy fails closed — throws an
//     Error carrying a closed `.code` (`AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE` or
//     `AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE`) and a sanitized `.report`, never a partial or
//     best-effort verdict.
//
//   AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES -> Object.frozen({ [route]: positiveInteger, ... })
//
//     A second, distinct, server-owned closed policy map — never environment/client-derived —
//     scoping the ceiling that governs durable, checkpointed batch execution.
//     `AGT002_GOVERNED_WORKSET_FREEZE_ROUTE` is capped at 184 durable operational batches here,
//     well above (but not unlimited relative to) the classic `AGT002_GOVERNED_WORKSET_MAX_BATCHES`
//     ceiling of 64 for the same route.
//
//   resolveAgt002GovernedWorksetDurableMaxBatchCount(route, durablePolicy) -> positiveInteger
//
//     A narrowly-scoped validator with the same closed route/policy-map validation as the internal
//     classic-ceiling resolver, exported only so tests can exercise an absent/malformed durable
//     policy map failing closed. `preflightAgt002GovernedWorksetCapacity` always calls this with its
//     own immutable `AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES`, never with a caller-supplied map
//     — there is no caller-facing durable-policy configuration path.
//
//   preflightAgt002GovernedWorksetCapacity({ route, evidence, executionMode, checkpointing })
//     -> { ...same closed fields as evaluateAgt002GovernedWorksetCapacity, durable_max_batch_count,
//          effective_max_batch_count, execution_mode, checkpointing, durable_checkpointing_required }
//
//     Extends the same closed route/evidence validation above with an explicit execution-mode axis:
//       - `executionMode: 'durable_batched_v1'` with `checkpointing: true` is evaluated against the
//         route's own durable ceiling (`AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES[route]`, 184 for
//         the production freeze route) instead of the classic legacy ceiling, because durable,
//         checkpointed batch processing can safely run more batches than the legacy in-memory
//         ceiling — but the durable ceiling is a real, enforced cap, not an unlimited escape hatch.
//         `predicted_batch_count <= durable ceiling` is `'APTO'`; exceeding the durable ceiling is
//         still `'NO_APTO'`. Every count and every ceiling is reported byte-honestly (never
//         clamped/hidden): `max_batch_count` (classic), `durable_max_batch_count`, and
//         `effective_max_batch_count` (whichever ceiling actually governed this verdict), plus a
//         `durable_checkpointing_required: true` flag whenever the durable ceiling — not the
//         classic one — is what let an over-classic-ceiling source pass.
//       - `executionMode: 'durable_batched_v1'` without `checkpointing === true`, and
//         `executionMode: 'single_turn_v1'`, get no durable eligibility boost at all: both are
//         evaluated exactly like the legacy ceiling comparison, so an oversized source is still
//         `'NO_APTO'` and `effective_max_batch_count` equals the classic ceiling — durable batching
//         without checkpointing, and single-turn execution, are not actually safe to run past the
//         classic ceiling.
//       - Any `executionMode` other than `'single_turn_v1'` and `'durable_batched_v1'` (including
//         wrong-case or non-string values) fails closed with the new
//         `AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE`, never a best-effort/permissive
//         verdict for a mode this preflight doesn't recognize.
//       - Unlike `evaluateAgt002GovernedWorksetCapacity` (which honors an explicit `policy`
//         override as legitimate route-scoped configuration), `preflightAgt002GovernedWorksetCapacity`
//         is a closed, fully server-owned decision: a caller-supplied `policy` or `durablePolicy`
//         override, and any override-shaped field smuggled inside `evidence` (`max_batch_count`,
//         `durable_max_batch_count`, `effective_max_batch_count`, ...), must be completely inert.
//     The existing `evaluateAgt002GovernedWorksetCapacity` legacy/default path is unchanged by any
//     of the above.

import {
  AGT002_GOVERNED_WORKSET_CAPACITY_VERSION,
  AGT002_GOVERNED_WORKSET_FREEZE_ROUTE,
  AGT002_GOVERNED_WORKSET_MAX_BATCHES,
  AGT002_GOVERNED_WORKSET_APTO,
  AGT002_GOVERNED_WORKSET_NO_APTO,
  AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE,
  AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE,
  evaluateAgt002GovernedWorksetCapacity,
} from '../agt002-governed-workset-capacity.js';

// Namespace import for the durable-execution-mode surface (preflight function, its dedicated
// invalid-execution-mode code, the durable policy map, and the durable-policy resolver): keeps the
// sanity checks below as ordinary, diagnostic `assert` failures rather than a module-link
// SyntaxError that would abort the whole file if any of these were ever removed.
import * as Agt002GovernedWorksetCapacityModule from '../agt002-governed-workset-capacity.js';

const ROUTE = AGT002_GOVERNED_WORKSET_FREEZE_ROUTE;
const MAX_BATCHES = 64;
const CHARS_PER_BATCH = 20_000;

const EXECUTION_MODE_DURABLE_BATCHED_V1 = 'durable_batched_v1';
const EXECUTION_MODE_SINGLE_TURN_V1 = 'single_turn_v1';

// The durable execution mode's own server-owned ceiling for the production freeze route: distinct
// from, and well above, the classic legacy ceiling of 64 — but a real, enforced cap, not unlimited.
const DURABLE_MAX_BATCHES = 184;

// A large governed source whose server-resolved extracted text totals 3,678,381 characters.
// ceil(3,678,381 / 20,000) = 184 predicted batches — beyond the route's legacy ceiling of 64, and
// exactly at the durable policy's own 184-batch ceiling: the shape that durable, checkpointed
// batch processing exists to handle.
const DURABLE_SOURCE_CHAR_COUNT = 3_678_381;
const DURABLE_PREDICTED_BATCH_COUNT = 184;

// One character past the durable ceiling: 3,680,001 chars -> ceil(3,680,001 / 20,000) = 185
// predicted batches, one over the durable policy's 184-batch cap for this route. Proves the
// durable ceiling is a real, enforced cap rather than an unlimited escape hatch.
const DURABLE_OVER_CEILING_SOURCE_CHAR_COUNT = 3_680_001;
const DURABLE_OVER_CEILING_PREDICTED_BATCH_COUNT = 185;

// A real DANE-shaped governed workset: four documents whose server-resolved extracted text totals
// 3,104,762 characters. ceil(3,104,762 / 20,000) = 156 predicted batches — far beyond the route's
// server-owned ceiling of 64.
const DANE_LIKE_SOURCE_CHAR_COUNT = 3_104_762;
const DANE_LIKE_DOCUMENT_COUNT = 4;
const DANE_LIKE_PREDICTED_BATCH_COUNT = 156;

function baseEvidence(overrides = {}) {
  return {
    source_char_count: DANE_LIKE_SOURCE_CHAR_COUNT,
    chars_per_batch: CHARS_PER_BATCH,
    document_count: DANE_LIKE_DOCUMENT_COUNT,
    ...overrides,
  };
}

function assertFailsClosed(fn, expectedCode, description) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, expectedCode, `${description} must fail closed with code ${expectedCode}`);
    assert.ok(error.report && typeof error.report === 'object' && !Array.isArray(error.report), `${description} must carry a sanitized report object`);
    return true;
  }, description);
}

// ---------------------------------------------------------------------------------------------
// (0) Sanity: exported constants/policy/function have the expected shape.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(typeof AGT002_GOVERNED_WORKSET_CAPACITY_VERSION, 'string');
  assert.ok(AGT002_GOVERNED_WORKSET_CAPACITY_VERSION.length > 0);
  assert.equal(typeof AGT002_GOVERNED_WORKSET_FREEZE_ROUTE, 'string');
  assert.ok(AGT002_GOVERNED_WORKSET_FREEZE_ROUTE.length > 0);
  assert.equal(AGT002_GOVERNED_WORKSET_APTO, 'APTO');
  assert.equal(AGT002_GOVERNED_WORKSET_NO_APTO, 'NO_APTO');
  assert.equal(typeof AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE, 'string');
  assert.equal(typeof AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE, 'string');
  assert.equal(typeof evaluateAgt002GovernedWorksetCapacity, 'function');

  // The route-scoped, server-owned policy: a closed, immutable map, not environment/client-derived.
  assert.ok(AGT002_GOVERNED_WORKSET_MAX_BATCHES && typeof AGT002_GOVERNED_WORKSET_MAX_BATCHES === 'object');
  assert.ok(Object.isFrozen(AGT002_GOVERNED_WORKSET_MAX_BATCHES), 'the server-owned policy map must be frozen so no caller can mutate it at runtime');
  assert.equal(AGT002_GOVERNED_WORKSET_MAX_BATCHES[ROUTE], MAX_BATCHES, 'the production freeze route must be policy-capped at 64 operational batches');
}

// ---------------------------------------------------------------------------------------------
// (1) Oversized DANE-like package: 3,104,762 chars across 4 documents at a 20,000 chars/batch
//     budget predicts 156 batches, which exceeds the route's max of 64 -> NO_APTO, with every
//     required evidence field (predicted batch count, safe max count, source char count) reported.
// ---------------------------------------------------------------------------------------------
{
  const evidence = baseEvidence();
  const result = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence });

  assert.equal(result.predicted_batch_count, DANE_LIKE_PREDICTED_BATCH_COUNT, 'ceil(3,104,762 / 20,000) must be 156');
  assert.ok(result.predicted_batch_count > MAX_BATCHES, 'fixture sanity: the DANE-like package must genuinely exceed the route ceiling');
  assert.equal(result.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'a package predicted to need more batches than the route allows must be rejected as NO_APTO');
  assert.equal(result.max_batch_count, MAX_BATCHES);
  assert.equal(result.source_char_count, DANE_LIKE_SOURCE_CHAR_COUNT);
  assert.equal(result.chars_per_batch, CHARS_PER_BATCH);
  assert.equal(result.document_count, DANE_LIKE_DOCUMENT_COUNT);
  assert.equal(result.route, ROUTE);
  assert.equal(result.version, AGT002_GOVERNED_WORKSET_CAPACITY_VERSION);
}

// ---------------------------------------------------------------------------------------------
// (2) A package that genuinely fits the route's operational capacity is APTO, carrying the same
//     closed set of evidence fields.
// ---------------------------------------------------------------------------------------------
{
  const evidence = baseEvidence({ source_char_count: 500_000, document_count: 2 });
  const result = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence });

  assert.equal(result.predicted_batch_count, 25, 'ceil(500,000 / 20,000) must be 25');
  assert.equal(result.verdict, AGT002_GOVERNED_WORKSET_APTO);
  assert.equal(result.max_batch_count, MAX_BATCHES);
  assert.equal(result.source_char_count, 500_000);
  assert.equal(result.document_count, 2);
}

// ---------------------------------------------------------------------------------------------
// (3) Boundary: predicted_batch_count exactly equal to max_batch_count is APTO (<=, not <);
//     one char over that boundary flips to NO_APTO.
// ---------------------------------------------------------------------------------------------
{
  const exactBoundaryEvidence = baseEvidence({ source_char_count: MAX_BATCHES * CHARS_PER_BATCH });
  const exactBoundary = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: exactBoundaryEvidence });
  assert.equal(exactBoundary.predicted_batch_count, MAX_BATCHES);
  assert.equal(exactBoundary.verdict, AGT002_GOVERNED_WORKSET_APTO, 'predicted_batch_count exactly at the ceiling must still be APTO');

  const overBoundaryEvidence = baseEvidence({ source_char_count: MAX_BATCHES * CHARS_PER_BATCH + 1 });
  const overBoundary = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: overBoundaryEvidence });
  assert.equal(overBoundary.predicted_batch_count, MAX_BATCHES + 1);
  assert.equal(overBoundary.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'one character over the ceiling must flip the verdict to NO_APTO');
}

// ---------------------------------------------------------------------------------------------
// (4) Any `max_batch_count` (or other override-shaped field) inside client/evidence data is inert:
//     the resolved ceiling always comes from the server-owned policy, never from the payload being
//     evaluated. Proven against the oversized DANE-like package specifically: a client attempt to
//     raise the ceiling to 999,999 must not turn a NO_APTO into an APTO.
// ---------------------------------------------------------------------------------------------
{
  const honestEvidence = baseEvidence();
  const spoofedEvidence = baseEvidence({ max_batch_count: 999_999 });

  const honestResult = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: honestEvidence });
  const spoofedResult = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: spoofedEvidence });

  assert.equal(spoofedResult.max_batch_count, MAX_BATCHES, 'a client-declared max_batch_count inside evidence must never override the server-owned policy ceiling');
  assert.equal(spoofedResult.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'the spoofed ceiling must not turn an oversized DANE-like package into APTO');
  assert.deepEqual(spoofedResult, honestResult, 'the evaluation must be byte-identical whether or not evidence carries a spoofed max_batch_count');

  // The returned result never even echoes the spoofed field back.
  assert.equal(Object.prototype.hasOwnProperty.call(spoofedResult, 'max_batch_count'), true);
  assert.notEqual(spoofedResult.max_batch_count, 999_999);
}

// ---------------------------------------------------------------------------------------------
// (5) The returned evidence carries only a closed, safe set of fields — no raw evidence dump, no
//     policy internals beyond the resolved ceiling for this route.
// ---------------------------------------------------------------------------------------------
{
  const result = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: baseEvidence() });
  const expectedKeys = [
    'version', 'route', 'verdict', 'max_batch_count', 'predicted_batch_count', 'source_char_count', 'chars_per_batch', 'document_count',
  ];
  assert.deepEqual(Object.keys(result).sort(), [...expectedKeys].sort(), 'the preflight result must expose exactly the closed set of safe fields');
}

// ---------------------------------------------------------------------------------------------
// (6) Missing/malformed SERVER-RESOLVED size evidence fails closed — never a partial or
//     best-effort verdict.
// ---------------------------------------------------------------------------------------------
{
  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: undefined }), AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE, 'undefined evidence');
  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: null }), AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE, 'null evidence');
  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: 'not-an-object' }), AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE, 'string evidence');
  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: [] }), AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE, 'array evidence');
  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ route: ROUTE }), AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE, 'omitted evidence');

  const malformedSourceCharCounts = [undefined, null, 'a lot', -1, 0, NaN, Infinity, 1.5, '3104762'];
  for (const value of malformedSourceCharCounts) {
    assertFailsClosed(
      () => evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: baseEvidence({ source_char_count: value }) }),
      AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE,
      `malformed source_char_count ${JSON.stringify(value)}`,
    );
  }

  const malformedCharsPerBatch = [undefined, null, 'many', -1, 0, NaN, Infinity, 1.5];
  for (const value of malformedCharsPerBatch) {
    assertFailsClosed(
      () => evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: baseEvidence({ chars_per_batch: value }) }),
      AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE,
      `malformed chars_per_batch ${JSON.stringify(value)}`,
    );
  }

  const malformedDocumentCounts = [undefined, null, 'four', -1, 0, NaN, Infinity, 1.5];
  for (const value of malformedDocumentCounts) {
    assertFailsClosed(
      () => evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: baseEvidence({ document_count: value }) }),
      AGT002_GOVERNED_WORKSET_EVIDENCE_INVALID_CODE,
      `malformed document_count ${JSON.stringify(value)}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// (7) Invalid/missing route-scoped policy fails closed — never falls back to an implicit or
//     unlimited ceiling.
// ---------------------------------------------------------------------------------------------
{
  const evidence = baseEvidence();

  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ route: undefined, evidence }), AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE, 'undefined route');
  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ route: null, evidence }), AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE, 'null route');
  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ route: '', evidence }), AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE, 'empty-string route');
  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ route: 'agt002.unknown_route', evidence }), AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE, 'a route absent from the policy map');
  assertFailsClosed(() => evaluateAgt002GovernedWorksetCapacity({ evidence }), AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE, 'omitted route');

  const malformedPolicies = [
    undefined,
    null,
    'not-a-policy-map',
    42,
    [],
    { [ROUTE]: 0 },
    { [ROUTE]: -64 },
    { [ROUTE]: 1.5 },
    { [ROUTE]: '64' },
    { [ROUTE]: null },
    { [ROUTE]: undefined },
    { [ROUTE]: NaN },
    { [ROUTE]: Infinity },
    {},
  ];
  for (const policy of malformedPolicies) {
    assertFailsClosed(
      () => evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence, policy }),
      AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE,
      `malformed route-scoped policy ${JSON.stringify(policy)}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// (8) A caller-supplied policy overriding the default is honored for a well-formed map — proves
//     the ceiling is genuinely route-scoped configuration, not a hardcoded constant baked into the
//     comparison — while still failing closed on malformed entries (case 7) and never accepting an
//     override sourced from `evidence` (case 4).
// ---------------------------------------------------------------------------------------------
{
  const customPolicy = Object.freeze({ [ROUTE]: 200 });
  const result = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence: baseEvidence(), policy: customPolicy });
  assert.equal(result.max_batch_count, 200);
  assert.equal(result.verdict, AGT002_GOVERNED_WORKSET_APTO, '156 predicted batches must fit under an explicit 200-batch route policy');
}

// ---------------------------------------------------------------------------------------------
// (9) Determinism and input immutability: repeat calls over the same input produce a
//     byte-identical result, and evaluation never mutates the evidence object it was given.
// ---------------------------------------------------------------------------------------------
{
  const evidence = Object.freeze(baseEvidence());
  const first = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence });
  const second = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence });
  assert.deepEqual(first, second, 'evaluating the same input twice must produce a byte-identical result');
}

// ---------------------------------------------------------------------------------------------
// (10) Sanity: the durable-execution-mode preflight surface has the expected shape.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(
    typeof Agt002GovernedWorksetCapacityModule.preflightAgt002GovernedWorksetCapacity,
    'function',
    'agt002-governed-workset-capacity.js must export preflightAgt002GovernedWorksetCapacity({ route, evidence, policy, executionMode, checkpointing })',
  );
  assert.equal(
    typeof Agt002GovernedWorksetCapacityModule.AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE,
    'string',
    'agt002-governed-workset-capacity.js must export a closed AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE diagnostic code',
  );
  assert.ok(
    Agt002GovernedWorksetCapacityModule.AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE.length > 0,
  );

  // The durable execution mode's own server-owned ceiling policy: a closed, immutable map,
  // distinct from the classic AGT002_GOVERNED_WORKSET_MAX_BATCHES map, capping the production
  // freeze route at 184 durable, checkpointed operational batches.
  const durablePolicy = Agt002GovernedWorksetCapacityModule.AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES;
  assert.ok(
    durablePolicy && typeof durablePolicy === 'object' && !Array.isArray(durablePolicy),
    'agt002-governed-workset-capacity.js must export a server-owned AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES policy map',
  );
  assert.ok(Object.isFrozen(durablePolicy), 'the durable policy map must be frozen so no caller can mutate it at runtime');
  assert.equal(durablePolicy[ROUTE], DURABLE_MAX_BATCHES, 'the production freeze route must be durable-policy-capped at 184 operational batches');
  assert.notEqual(durablePolicy, AGT002_GOVERNED_WORKSET_MAX_BATCHES, 'the durable ceiling policy must be a map distinct from the classic ceiling policy');
}

// ---------------------------------------------------------------------------------------------
// (11) The existing/default/legacy evaluation path is unchanged: a 3,678,381-char source at
//      20,000 chars/batch predicts 184 batches, exceeding the route's legacy ceiling of 64 ->
//      NO_APTO, exactly as evaluateAgt002GovernedWorksetCapacity already behaves for any oversized
//      source.
// ---------------------------------------------------------------------------------------------
{
  const evidence = baseEvidence({ source_char_count: DURABLE_SOURCE_CHAR_COUNT });
  const result = evaluateAgt002GovernedWorksetCapacity({ route: ROUTE, evidence });

  assert.equal(result.predicted_batch_count, DURABLE_PREDICTED_BATCH_COUNT, 'ceil(3,678,381 / 20,000) must be 184');
  assert.ok(result.predicted_batch_count > MAX_BATCHES, 'fixture sanity: this durable-sized source must genuinely exceed the legacy route ceiling');
  assert.equal(result.max_batch_count, MAX_BATCHES);
  assert.equal(result.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'the existing default/legacy evaluation path must still reject this oversized source, unchanged');
}

// ---------------------------------------------------------------------------------------------
// (12) executionMode: 'durable_batched_v1' with checkpointing: true is eligible/accepted for a
//      source predicted at exactly the durable ceiling of 184 batches (3,678,381 chars / 20,000)
//      — beyond the classic legacy ceiling of 64, but exactly at (not merely under) the durable
//      policy's own 184-batch ceiling. The result must report the true predicted_batch_count
//      byte-honestly, plus the classic ceiling, the durable ceiling, and the effective ceiling
//      actually applied, plus a clear flag that durable checkpointed processing is required/
//      enabled, never silently hiding the overage behind an APTO verdict.
// ---------------------------------------------------------------------------------------------
{
  const { preflightAgt002GovernedWorksetCapacity } = Agt002GovernedWorksetCapacityModule;
  const evidence = baseEvidence({ source_char_count: DURABLE_SOURCE_CHAR_COUNT });

  const result = preflightAgt002GovernedWorksetCapacity({
    route: ROUTE,
    evidence,
    executionMode: EXECUTION_MODE_DURABLE_BATCHED_V1,
    checkpointing: true,
  });

  assert.equal(result.verdict, AGT002_GOVERNED_WORKSET_APTO, 'durable batched execution with checkpointing enabled must be eligible/accepted at exactly the durable ceiling of 184 batches');
  assert.equal(result.predicted_batch_count, DURABLE_PREDICTED_BATCH_COUNT, 'preflight must report the true predicted batch count, never a clamped or hidden value');
  assert.equal(result.max_batch_count, MAX_BATCHES, 'preflight must still report the route policy-owned classic/legacy ceiling for context');
  assert.equal(result.durable_max_batch_count, DURABLE_MAX_BATCHES, 'preflight must report the route policy-owned durable ceiling that governed this verdict');
  assert.equal(result.effective_max_batch_count, DURABLE_MAX_BATCHES, 'the effective ceiling actually applied under durable checkpointed execution must be the durable ceiling, not the classic one');
  assert.equal(result.source_char_count, DURABLE_SOURCE_CHAR_COUNT);
  assert.equal(result.chars_per_batch, CHARS_PER_BATCH);
  assert.equal(result.route, ROUTE);
  assert.equal(result.execution_mode, EXECUTION_MODE_DURABLE_BATCHED_V1, 'the accepted verdict must clearly echo which execution mode made it eligible');
  assert.equal(result.checkpointing, true, 'the accepted verdict must clearly echo that checkpointing was enabled');
  assert.equal(
    result.durable_checkpointing_required,
    true,
    'the preflight must clearly flag that durable checkpointed processing is required to cover the overage, rather than hiding it behind a bare APTO',
  );
}

// ---------------------------------------------------------------------------------------------
// (13) executionMode: 'durable_batched_v1' without checkpointing === true gets no eligibility
//      boost at all: the same oversized source remains rejected, whether checkpointing is
//      explicitly false or simply omitted.
// ---------------------------------------------------------------------------------------------
{
  const { preflightAgt002GovernedWorksetCapacity } = Agt002GovernedWorksetCapacityModule;
  const evidence = baseEvidence({ source_char_count: DURABLE_SOURCE_CHAR_COUNT });

  const checkpointingFalse = preflightAgt002GovernedWorksetCapacity({
    route: ROUTE,
    evidence,
    executionMode: EXECUTION_MODE_DURABLE_BATCHED_V1,
    checkpointing: false,
  });
  assert.equal(checkpointingFalse.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'durable execution mode with checkpointing explicitly false must remain rejected');
  assert.equal(checkpointingFalse.predicted_batch_count, DURABLE_PREDICTED_BATCH_COUNT);
  assert.equal(checkpointingFalse.max_batch_count, MAX_BATCHES);
  assert.equal(checkpointingFalse.effective_max_batch_count, MAX_BATCHES, 'without checkpointing, the effective ceiling must remain the classic one, never the durable ceiling');
  assert.equal(checkpointingFalse.durable_checkpointing_required, false);

  const checkpointingOmitted = preflightAgt002GovernedWorksetCapacity({
    route: ROUTE,
    evidence,
    executionMode: EXECUTION_MODE_DURABLE_BATCHED_V1,
  });
  assert.equal(checkpointingOmitted.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'omitting checkpointing under durable execution mode must not be treated as an implicit opt-in, and must remain rejected');
  assert.equal(checkpointingOmitted.predicted_batch_count, DURABLE_PREDICTED_BATCH_COUNT);
  assert.equal(checkpointingOmitted.max_batch_count, MAX_BATCHES);
  assert.equal(checkpointingOmitted.effective_max_batch_count, MAX_BATCHES, 'omitted checkpointing must apply the classic ceiling as the effective ceiling');

  const checkpointingTruthyButNotBooleanTrue = preflightAgt002GovernedWorksetCapacity({
    route: ROUTE,
    evidence,
    executionMode: EXECUTION_MODE_DURABLE_BATCHED_V1,
    checkpointing: 'yes',
  });
  assert.equal(checkpointingTruthyButNotBooleanTrue.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'a non-boolean-true checkpointing value must not be treated as an implicit opt-in, and must remain rejected');
}

// ---------------------------------------------------------------------------------------------
// (14) Any executionMode other than the legacy default and 'durable_batched_v1' fails closed —
//      never a best-effort/permissive verdict for a mode this preflight doesn't recognize.
// ---------------------------------------------------------------------------------------------
{
  const { preflightAgt002GovernedWorksetCapacity, AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE } = Agt002GovernedWorksetCapacityModule;
  const evidence = baseEvidence({ source_char_count: DURABLE_SOURCE_CHAR_COUNT });

  assertFailsClosed(
    () => preflightAgt002GovernedWorksetCapacity({ route: ROUTE, evidence, executionMode: 'durable_batched_v2', checkpointing: true }),
    AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE,
    'an unrecognized execution mode string',
  );
  assertFailsClosed(
    () => preflightAgt002GovernedWorksetCapacity({ route: ROUTE, evidence, executionMode: 'DURABLE_BATCHED_V1', checkpointing: true }),
    AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE,
    'a wrong-case execution mode string must not be normalized/accepted',
  );
  assertFailsClosed(
    () => preflightAgt002GovernedWorksetCapacity({ route: ROUTE, evidence, executionMode: '', checkpointing: true }),
    AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE,
    'an empty-string execution mode',
  );
  assertFailsClosed(
    () => preflightAgt002GovernedWorksetCapacity({ route: ROUTE, evidence, executionMode: 123, checkpointing: true }),
    AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE,
    'a non-string execution mode',
  );
  assertFailsClosed(
    () => preflightAgt002GovernedWorksetCapacity({ route: ROUTE, evidence, executionMode: null, checkpointing: true }),
    AGT002_GOVERNED_WORKSET_EXECUTION_MODE_INVALID_CODE,
    'a null execution mode',
  );
}

// ---------------------------------------------------------------------------------------------
// (15) executionMode: 'single_turn_v1' never gets the durable eligibility boost: the same
//      184-batch source that durable_batched_v1 + checkpointing accepts in (12) remains rejected
//      against the classic ceiling of 64, with effective_max_batch_count reported as the classic
//      ceiling — never the durable one.
// ---------------------------------------------------------------------------------------------
{
  const { preflightAgt002GovernedWorksetCapacity } = Agt002GovernedWorksetCapacityModule;
  const evidence = baseEvidence({ source_char_count: DURABLE_SOURCE_CHAR_COUNT });

  const result = preflightAgt002GovernedWorksetCapacity({
    route: ROUTE,
    evidence,
    executionMode: EXECUTION_MODE_SINGLE_TURN_V1,
  });

  assert.equal(result.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'single_turn_v1 must remain rejected against the classic ceiling for an oversized source');
  assert.equal(result.predicted_batch_count, DURABLE_PREDICTED_BATCH_COUNT);
  assert.equal(result.max_batch_count, MAX_BATCHES);
  assert.equal(result.durable_max_batch_count, DURABLE_MAX_BATCHES, 'the durable ceiling must still be reported for context even though it did not govern this verdict');
  assert.equal(result.effective_max_batch_count, MAX_BATCHES, 'single_turn_v1 must apply the classic ceiling as the effective ceiling, never the durable one');
  assert.equal(result.durable_checkpointing_required, false);
}

// ---------------------------------------------------------------------------------------------
// (16) The durable ceiling is a real, enforced cap — not an unlimited escape hatch. One character
//      past the durable ceiling (3,680,001 chars -> 185 predicted batches, one over the durable
//      policy's 184-batch cap for this route) must remain NO_APTO even with
//      executionMode: 'durable_batched_v1' and checkpointing: true.
// ---------------------------------------------------------------------------------------------
{
  const { preflightAgt002GovernedWorksetCapacity } = Agt002GovernedWorksetCapacityModule;
  const evidence = baseEvidence({ source_char_count: DURABLE_OVER_CEILING_SOURCE_CHAR_COUNT });

  const result = preflightAgt002GovernedWorksetCapacity({
    route: ROUTE,
    evidence,
    executionMode: EXECUTION_MODE_DURABLE_BATCHED_V1,
    checkpointing: true,
  });

  assert.equal(result.predicted_batch_count, DURABLE_OVER_CEILING_PREDICTED_BATCH_COUNT, 'ceil(3,680,001 / 20,000) must be 185');
  assert.equal(result.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'durable checkpointed execution must still reject a source that exceeds even the durable policy ceiling of 184 batches');
  assert.equal(result.max_batch_count, MAX_BATCHES, 'the classic ceiling must still be reported for context even though the durable ceiling is the one that governed this verdict');
  assert.equal(result.durable_max_batch_count, DURABLE_MAX_BATCHES);
  assert.equal(result.effective_max_batch_count, DURABLE_MAX_BATCHES, 'the effective ceiling applied must be the durable ceiling, which this source genuinely exceeds');
}

// ---------------------------------------------------------------------------------------------
// (17) Preflight never honors a caller-supplied override of either ceiling policy: unlike
//      evaluateAgt002GovernedWorksetCapacity (case 8), which accepts an explicit `policy` override
//      as legitimate route-scoped configuration, preflightAgt002GovernedWorksetCapacity is a
//      closed, fully server-owned decision — a caller-shaped `policy` or `durablePolicy` override,
//      and any override-shaped field smuggled inside `evidence`, must be completely inert. Proven
//      against a source that genuinely exceeds the real durable ceiling: a spoofed override must
//      not turn that NO_APTO into APTO.
// ---------------------------------------------------------------------------------------------
{
  const { preflightAgt002GovernedWorksetCapacity } = Agt002GovernedWorksetCapacityModule;
  const overCeilingEvidence = baseEvidence({ source_char_count: DURABLE_OVER_CEILING_SOURCE_CHAR_COUNT });
  const spoofedEvidence = baseEvidence({
    source_char_count: DURABLE_OVER_CEILING_SOURCE_CHAR_COUNT,
    max_batch_count: 999_999,
    durable_max_batch_count: 999_999,
    effective_max_batch_count: 999_999,
  });

  const honestResult = preflightAgt002GovernedWorksetCapacity({
    route: ROUTE,
    evidence: overCeilingEvidence,
    executionMode: EXECUTION_MODE_DURABLE_BATCHED_V1,
    checkpointing: true,
  });

  const spoofedResult = preflightAgt002GovernedWorksetCapacity({
    route: ROUTE,
    evidence: spoofedEvidence,
    executionMode: EXECUTION_MODE_DURABLE_BATCHED_V1,
    checkpointing: true,
    policy: Object.freeze({ [ROUTE]: 999_999 }),
    durablePolicy: Object.freeze({ [ROUTE]: 999_999 }),
  });

  assert.equal(honestResult.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'fixture sanity: the over-ceiling durable source must genuinely exceed the real 184-batch durable ceiling');
  assert.equal(spoofedResult.verdict, AGT002_GOVERNED_WORKSET_NO_APTO, 'a caller-supplied policy/durablePolicy override, and any override-shaped field smuggled inside evidence, must never turn an over-ceiling NO_APTO into APTO');
  assert.deepEqual(spoofedResult, honestResult, 'preflight must be byte-identical whether or not the call carries spoofed evidence fields or caller-supplied policy/durablePolicy overrides');
  assert.equal(spoofedResult.max_batch_count, MAX_BATCHES);
  assert.equal(spoofedResult.durable_max_batch_count, DURABLE_MAX_BATCHES);
  assert.equal(spoofedResult.effective_max_batch_count, DURABLE_MAX_BATCHES);
}

// ---------------------------------------------------------------------------------------------
// (18) Fail-closed durable-policy validation: the narrowly-scoped
//      resolveAgt002GovernedWorksetDurableMaxBatchCount validator that
//      preflightAgt002GovernedWorksetCapacity always calls internally (with the module's own
//      immutable AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES, never a caller-supplied map) fails
//      closed on an absent/malformed durable policy map — proving the internal validation itself
//      is closed, without exposing any caller-facing durable-policy configuration path (case 17
//      already proves preflightAgt002GovernedWorksetCapacity itself never accepts one).
// ---------------------------------------------------------------------------------------------
{
  const { resolveAgt002GovernedWorksetDurableMaxBatchCount } = Agt002GovernedWorksetCapacityModule;
  assert.equal(
    typeof resolveAgt002GovernedWorksetDurableMaxBatchCount,
    'function',
    'agt002-governed-workset-capacity.js must export resolveAgt002GovernedWorksetDurableMaxBatchCount(route, durablePolicy)',
  );

  const malformedDurablePolicies = [
    undefined,
    null,
    'not-a-policy-map',
    42,
    [],
    { [ROUTE]: 0 },
    { [ROUTE]: -184 },
    { [ROUTE]: 1.5 },
    { [ROUTE]: '184' },
    { [ROUTE]: null },
    { [ROUTE]: undefined },
    { [ROUTE]: NaN },
    { [ROUTE]: Infinity },
    {},
  ];
  for (const durablePolicy of malformedDurablePolicies) {
    assertFailsClosed(
      () => resolveAgt002GovernedWorksetDurableMaxBatchCount(ROUTE, durablePolicy),
      AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE,
      `malformed durable route-scoped policy ${JSON.stringify(durablePolicy)}`,
    );
  }

  assertFailsClosed(
    () => resolveAgt002GovernedWorksetDurableMaxBatchCount(undefined, Agt002GovernedWorksetCapacityModule.AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES),
    AGT002_GOVERNED_WORKSET_POLICY_INVALID_CODE,
    'undefined route against the real durable policy map',
  );

  assert.equal(
    resolveAgt002GovernedWorksetDurableMaxBatchCount(ROUTE, Agt002GovernedWorksetCapacityModule.AGT002_GOVERNED_WORKSET_DURABLE_MAX_BATCHES),
    DURABLE_MAX_BATCHES,
    'the real server-owned durable policy map must resolve to 184 for the production freeze route',
  );
}

console.log('tests/agt002-governed-workset-capacity.test.mjs OK');
