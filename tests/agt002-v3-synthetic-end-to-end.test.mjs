import { strict as assert } from 'node:assert';
import { validateAgt002IntegralAnalysisV3 } from '../agt002-integral-analysis-v3.js';
import { projectAgt002IntegralV3ToV2, computeAgt002IntegralV3CriticalOpenCount } from '../agt002-v3-compatibility.js';
import { registerAgt002PreviewAnalysis } from '../agt002-preview-persistence.js';
import {
  buildAgt002V3SyntheticIntegralAnalysis, buildAgt002V3SyntheticValidationContext,
} from './fixtures/agt002-v3-synthetic-responder.mjs';

// Task 9: fully synthetic end-to-end gate driving the REAL contract validator, the real
// deterministic v2 projection, and the real persistence module together — proving ordered
// units, evidence-or-abstention, the derived v2 projection, the critical count, and v2/v3
// historical coexistence, all in one case covering every required scenario: a discard
// cause, a habilitating item with unknown applicability (forced abstention/pending human
// validation), a technical partial with a critical missing evidence item and a
// not-verified legal citation requiring human review, a non-curable financial/execution
// gap, and an optional strategic consideration. Nothing here is a real expediente.

const ids = {
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: '55555555-5555-4555-8555-555555555555',
  contextVersion: '77777777-7777-4777-8777-777777777777',
  runV2: '88888888-8888-4888-8888-888888888888',
  runV3: '99999999-9999-4999-8999-999999999999',
};

function fakeDatabase() {
  const rpcCalls = [];
  const runs = new Map();
  return {
    rpcCalls,
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      if (name !== 'psi_record_agt002_canonical_analysis_run') throw new Error(`unexpected RPC ${name}`);
      const existing = runs.get(params.p_idempotency_key);
      if (existing) return { data: existing, error: null };
      const isFirst = runs.size === 0;
      const data = {
        id: isFirst ? ids.runV2 : ids.runV3, snapshot_id: params.p_snapshot_id, producer: 'AGT-002', method: 'agent_ai',
        status: 'completed', canonical: true, critical_open_count: params.p_critical_open_count,
        context_version_id: params.p_context_version_id ?? null, legal_corpus_version_id: params.p_legal_corpus_version_id ?? null,
      };
      runs.set(params.p_idempotency_key, data);
      return { data, error: null };
    },
  };
}

async function run() {
  const validationContext = buildAgt002V3SyntheticValidationContext();
  const integralAnalysis = buildAgt002V3SyntheticIntegralAnalysis();

  // 1. Ordered units + evidence-or-abstention + five-axis invariants, via the real validator.
  const validated = validateAgt002IntegralAnalysisV3(integralAnalysis, validationContext);
  assert.equal(validated, integralAnalysis);
  assert.deepEqual(validated.analysis_units.map(unit => unit.category), ['discard', 'habilitating', 'technical', 'financial_execution', 'strategic']);
  assert.deepEqual(validated.analysis_units.map(unit => unit.sequence), [1, 2, 3, 4, 5]);

  // The habilitating unit with unknown applicability must never claim a favorable
  // outcome: it stays pending human validation, never "supported"/definitive.
  const habUnit = validated.analysis_units.find(unit => unit.unit_id === 'UNIT-HAB');
  assert.equal(habUnit.conclusion.status, 'human_validation_required');
  assert.equal(habUnit.evidence_state.applicability, 'unknown');

  // The technical unit's material missing evidence item is critical, and its legal
  // assessment is not_verified with human review required (no legal corpus published).
  const techUnit = validated.analysis_units.find(unit => unit.unit_id === 'UNIT-TECH');
  assert.equal(techUnit.missing_evidence[0].critical, true);
  assert.equal(techUnit.legal_assessment.status, 'not_verified');
  assert.equal(techUnit.legal_assessment.human_legal_review_required, true);

  // The financial/execution unit is a non-curable blocker with a supporting tender
  // document citation, not just an assertion.
  const finUnit = validated.analysis_units.find(unit => unit.unit_id === 'UNIT-FIN');
  assert.equal(finUnit.blocking.effect, 'blocker');
  assert.equal(finUnit.blocking.curability, 'not_curable');
  assert.equal(finUnit.evidence_refs[0].source_type, 'tender_document');

  // 2. Derived v2 projection is deterministic and exact.
  const projection = projectAgt002IntegralV3ToV2(validated);
  assert.equal(projection.recommendation, 'do_not_advance', 'a sustained non-curable blocker forbids advancing');
  assert.deepEqual(projection.strengths.map(item => item.id), ['UNIT-DISCARD::strength']);
  assert.deepEqual(projection.blockers.map(item => item.id), ['UNIT-FIN::blocker']);
  assert.deepEqual(projection.weaknesses.map(item => item.id).sort(), ['UNIT-FIN::weakness', 'UNIT-HAB::weakness', 'UNIT-TECH::weakness'].sort());
  assert.deepEqual(projection.unverified.map(item => item.id).sort(), ['UNIT-HAB::unverified', 'UNIT-TECH::unverified'].sort());
  const questionIds = projection.questions.map(item => item.id).sort();
  assert.deepEqual(questionIds, ['UNIT-FIN::question', 'UNIT-HAB::question', 'UNIT-STRAT::question', 'UNIT-TECH::question'].sort());
  assert.equal(projection.next_action, 'Persona autorizada decide continuidad ante brecha financiera no subsanable.');
  assert.equal(projection.human_review_required, true);

  // 3. Critical count: exactly one projected critical question per counted critical unit.
  const criticalOpenCount = computeAgt002IntegralV3CriticalOpenCount(validated);
  const criticalQuestions = projection.questions.filter(item => item.critical);
  assert.equal(criticalOpenCount, 2, 'UNIT-TECH (critical missing evidence) and UNIT-FIN (unresolved blocker + critical impact) must count');
  assert.equal(criticalQuestions.length, criticalOpenCount);
  assert.deepEqual(criticalQuestions.map(item => item.id).sort(), ['UNIT-FIN::question', 'UNIT-TECH::question']);

  // 4. Persistence: a v2 historical run stays retrievable after the v3 case is recorded,
  // proving coexistence at the application layer (real PGlite promotion mechanics are
  // covered separately by tests/agt002-v3-persistence-pglite.integration.test.mjs).
  const database = fakeDatabase();
  const historicalV2Envelope = {
    schema_version: '2.0-preview.1', agent_id: 'AGT-002', producer: 'AGT-002', run_id: ids.runV2,
    snapshot_id: ids.snapshot, policy_version: 'agt002-preview-policy-v1', status: 'completed', method: 'agent_ai',
    recommendation: 'pause', summary: 'Historical v2 run.', strengths: [], weaknesses: [], blockers: [], questions: [], unverified: [],
    next_action: 'x', human_review_required: true,
    usage: { provider: 'codex_app_server', model: 'v2-model', input_tokens: 1, output_tokens: 1, rate_limit: null },
  };
  const v2Registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: historicalV2Envelope,
    canonicalOnly: true, context_version_id: ids.contextVersion,
  });

  const v3Envelope = {
    schema_version: '3.0.0', agent_id: 'AGT-002', run_id: ids.runV3, policy_version: 'agt002-integral-v3-policy-1',
    snapshot_id: ids.snapshot, context_version_id: ids.contextVersion, status: 'completed', method: 'agent_ai',
    integral_analysis: validated, legal_corpus_version_id: null, human_review_required: true, v2_projection: projection,
    usage: { provider: 'codex_app_server', model: 'v3-model', input_tokens: 5, output_tokens: 5, rate_limit: null },
  };
  const v3Registered = await registerAgt002PreviewAnalysis(database, {
    opportunity_id: ids.opportunity, tender_id: ids.tender, snapshot_id: ids.snapshot, envelope: v3Envelope,
    canonicalOnly: true, context_version_id: ids.contextVersion,
  });

  assert.notEqual(v3Registered.run_id, v2Registered.run_id, 'v2 and v3 runs must never collide under the same idempotency key');
  assert.equal(v3Registered.result.integral_analysis.analysis_units.length, 5);
  assert.equal(v3Registered.result.recommendation, projection.recommendation);
  assert.equal(v3Registered.critical_open_count, criticalOpenCount);
  assert.equal(database.rpcCalls.length, 2, 'exactly one RPC call per registration — no partial/duplicate persistence');

  // The historical v2 run's own recorded payload is untouched by the v3 registration
  // that came after it (application-level proof; byte-identical DB row proof lives in
  // the PGlite coexistence test).
  assert.deepEqual(v2Registered.result.recommendation, 'pause');
  assert.equal(Object.hasOwn(v2Registered.result, 'integral_analysis'), false);

  console.log('AGT-002 integral v3 synthetic end-to-end gate passed');
}

await run();
