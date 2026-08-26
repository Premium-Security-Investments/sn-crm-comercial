import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const entry = new URL('../src/vigia/opportunity-preflight-state.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  beginPreflightAnalysis,
  completePreflightAnalysis,
  createOpportunityPreflightState,
  failPreflightAnalysis,
  invalidateStalePreflight,
} = await import(moduleUrl);

const opportunityA = '11111111-1111-4111-8111-111111111111';
const opportunityB = '22222222-2222-4222-8222-222222222222';
const fingerprintA = '2026-08-26T10:00:00Z|2026-08-26T09:00:00Z';
const fingerprintB = '2026-08-26T11:00:00Z|2026-08-26T10:30:00Z';
const result = Object.freeze({
  actions: Object.freeze([
    Object.freeze({ issue_code: 'pending_terms', title: 'Aclarar términos', description: 'Valide el alcance.', evidence_refs: Object.freeze(['evidence:interaction:1']) }),
  ]),
});

let state = createOpportunityPreflightState(opportunityA, fingerprintA);
assert.deepEqual(state, { phase: 'idle', opportunityId: opportunityA, contextFingerprint: fingerprintA, sequence: 0 });
assert.equal(invalidateStalePreflight(state, opportunityA, fingerprintA), state, 'same context preserves state identity');

const first = beginPreflightAnalysis(state);
assert.equal(first.requestId, 1);
assert.deepEqual(first.state, {
  phase: 'loading', opportunityId: opportunityA, contextFingerprint: fingerprintA, sequence: 1, requestId: 1,
});

assert.equal(
  completePreflightAnalysis(first.state, { opportunityId: opportunityB, requestId: first.requestId, result, currentContextFingerprint: fingerprintA }),
  first.state,
  'completion for another opportunity is ignored',
);
assert.equal(
  completePreflightAnalysis(first.state, { opportunityId: opportunityA, requestId: 99, result, currentContextFingerprint: fingerprintA }),
  first.state,
  'completion for a stale request is ignored',
);
assert.equal(
  failPreflightAnalysis(first.state, { opportunityId: opportunityB, requestId: first.requestId, message: 'stale' }),
  first.state,
  'failure for another opportunity is ignored',
);
assert.equal(
  failPreflightAnalysis(first.state, { opportunityId: opportunityA, requestId: 99, message: 'stale' }),
  first.state,
  'failure for a stale request is ignored',
);

state = completePreflightAnalysis(first.state, {
  opportunityId: opportunityA,
  requestId: first.requestId,
  result,
  currentContextFingerprint: fingerprintA,
});
assert.equal(state.phase, 'ready');
assert.equal(state.result, result, 'ready state preserves the validated result');
assert.equal(state.contextFingerprint, fingerprintA);

const invalidatedReady = invalidateStalePreflight(state, opportunityA, fingerprintB);
assert.deepEqual(invalidatedReady, {
  phase: 'idle', opportunityId: opportunityA, contextFingerprint: fingerprintB, sequence: 2,
});
const invalidatedOpportunity = invalidateStalePreflight(state, opportunityB, fingerprintA);
assert.deepEqual(invalidatedOpportunity, {
  phase: 'idle', opportunityId: opportunityB, contextFingerprint: fingerprintA, sequence: 2,
});

const explicit = beginPreflightAnalysis(invalidatedReady, 8);
assert.equal(explicit.requestId, 8);
assert.equal(explicit.state.sequence, 8);
state = failPreflightAnalysis(explicit.state, {
  opportunityId: opportunityA,
  requestId: explicit.requestId,
  message: 'Puente no disponible',
});
assert.deepEqual(state, {
  phase: 'error', opportunityId: opportunityA, contextFingerprint: fingerprintB, sequence: 8, requestId: 8,
  message: 'Puente no disponible',
});
assert.deepEqual(invalidateStalePreflight(state, opportunityA, `${fingerprintB}-new`), {
  phase: 'idle', opportunityId: opportunityA, contextFingerprint: `${fingerprintB}-new`, sequence: 9,
});

const loading = beginPreflightAnalysis(createOpportunityPreflightState(opportunityA, fingerprintA), 4).state;
assert.equal(
  invalidateStalePreflight(loading, opportunityA, fingerprintB),
  loading,
  'context changes do not interrupt an in-flight analysis',
);
const discarded = completePreflightAnalysis(loading, {
  opportunityId: opportunityA,
  requestId: 4,
  result,
  currentContextFingerprint: fingerprintB,
});
assert.deepEqual(discarded, {
  phase: 'idle', opportunityId: opportunityA, contextFingerprint: fingerprintB, sequence: 5,
}, 'a result completed against changed context is discarded');
assert.equal('result' in discarded, false);

assert.equal(
  completePreflightAnalysis(state, { opportunityId: opportunityA, requestId: 8, result, currentContextFingerprint: fingerprintB }),
  state,
  'only loading state accepts completion',
);
assert.equal(
  failPreflightAnalysis(state, { opportunityId: opportunityA, requestId: 8, message: 'late' }),
  state,
  'only loading state accepts failure',
);

console.log('AGT-003 preflight browser state checks passed');
