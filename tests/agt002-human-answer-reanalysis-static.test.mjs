import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { computeAgt002PreviewIdempotencyKey } from '../agt002-preview-persistence.js';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

for (const [label, source] of [['server/index.js', server], ['api/[...path].js', api]]) {
  const routeStart = source.indexOf("app.post('/api/tender-question-responses'");
  const routeEnd = source.indexOf("\n});", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, `${label}: human-answer route must exist`);
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /await\s+reanalyzeAgt002AfterHumanAnswer\(/);

  const helperStart = source.indexOf('async function reanalyzeAgt002AfterHumanAnswer');
  const helperEnd = source.indexOf('\n}\n', helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /enqueueAgt002CanonicalReanalysis\(database,/);
  assert.match(helper, /error\?\.code\s*===\s*'55000'/);
  assert.match(helper, /otro trabajo AGT-002 activo/);
  assert.match(helper, /findLatestAgt002ReanalysisStatusForOpportunity\(database, opportunityId\)/);
  assert.match(helper, /status:\s*'busy'/);
  assert.match(helper, /humanEvidence/);
  assert.match(helper, /identity_type\s*===\s*'agent'/);
  assert.doesNotMatch(helper, /createAgt002PreviewRuntime|runAgt002PostBridgeAnalysis|engine\.analyze/);
  assert.doesNotMatch(helper, /go_no_go|callTenderGoNoGoDecision/i);

  const enqueueStart = source.indexOf('async function enqueueAgt002CanonicalReanalysis');
  const enqueueEnd = source.indexOf('\n}\n', enqueueStart);
  const enqueue = source.slice(enqueueStart, enqueueEnd);
  assert.match(enqueue, /registerAgt002ContextVersion/);
  assert.match(enqueue, /context_version_id/);
  assert.match(enqueue, /human_evidence: humanEvidence/);
  assert.match(enqueue, /buildAgt002FrozenEngineInput/);
  assert.match(enqueue, /createAgt002ReanalysisJob/);

  const guardStart = source.indexOf('function requireHumanTenderIdentity');
  const guardEnd = source.indexOf('\n}', guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /identity_type\s*!==\s*'human'/);
  const humanGuardIndex = route.indexOf('requireHumanTenderIdentity(currentProfile)');
  const responseWriteIndex = route.indexOf("database.rpc('psi_record_tender_question_response");
  assert.ok(humanGuardIndex >= 0 && humanGuardIndex < responseWriteIndex, `${label}: human guard must run before write`);

  const evidenceStart = source.indexOf('function agt002HumanEvidenceFromResponses');
  const evidenceEnd = source.indexOf('\n}\n', evidenceStart);
  const buildEvidence = Function(`"use strict"; return (${source.slice(evidenceStart, evidenceEnd + 2)});`)();
  const original = {
    id: 'answer-old', question_id: 'q-1', question_text: 'Pregunta', status: 'resolved',
    response: 'Respuesta', evidence_notes: 'Soporte', responded_by: 'human-1', responded_by_name: 'Humana',
    responded_at: '2026-07-30T10:00:00.000Z', analysis_run_id: 'run-old',
  };
  const retry = { ...original, id: 'answer-new', responded_at: '2026-07-30T10:01:00.000Z' };
  const deduplicated = buildEvidence([retry, original]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].answer_id, original.id);
  assert.equal(buildEvidence([{ ...retry, response: 'Respuesta corregida' }, original]).length, 2);
}

const base = { snapshotId: 'snap-1', policyVersion: 'policy-1', model: 'model-1' };
const noContext = computeAgt002PreviewIdempotencyKey(base);
const contextA = computeAgt002PreviewIdempotencyKey({ ...base, contextVersionId: 'ctx-a' });
const contextARetry = computeAgt002PreviewIdempotencyKey({ ...base, contextVersionId: 'ctx-a' });
const contextB = computeAgt002PreviewIdempotencyKey({ ...base, contextVersionId: 'ctx-b' });
assert.notEqual(contextA, noContext);
assert.equal(contextA, contextARetry);
assert.notEqual(contextA, contextB);

console.log('AGT-002 durable human-answer reanalysis wiring passed');
