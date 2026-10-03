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

const ROUTE = AGT002_GOVERNED_WORKSET_FREEZE_ROUTE;
const MAX_BATCHES = 64;
const CHARS_PER_BATCH = 20_000;

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

console.log('tests/agt002-governed-workset-capacity.test.mjs OK');
