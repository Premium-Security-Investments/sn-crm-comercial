import assert from 'node:assert/strict';
import { createAgt003CopilotApi } from '../agt003-copilot-api.js';

const opportunityId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const claimId = '33333333-3333-4333-8333-333333333333';
const profile = {
  id: 'user-comercial', active: true, identity_type: 'human', role: 'comercial',
  permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'], areas: [],
};
const resource = { area_code: 'comercial', subarea_code: 'norte', owner_id: profile.id };
const opportunity = {
  id: opportunityId,
  owner_id: profile.id,
  title: 'Renovación sintética',
  company_name: 'Cliente Sintético',
  stage: 'Sustentación',
  service: 'Seguridad electrónica',
  owner_name: 'Comercial Sintético',
};
const context = {
  opportunity,
  interactions: [{ id: 'interaction-1', interaction_type: 'nota', occurred_at: '2030-01-01T00:00:00.000Z', notes: 'Necesidad sintética.' }],
  snapshotId: 'snapshot-001',
};
const config = { model: 'synthetic-model', policyVersion: 'policy-v1', dailyMaxRuns: 20, maxConcurrent: 2, leaseSeconds: 45 };
const output = {
  contract_version: '2.0-draft.1',
  capability_id: 'agt003.opportunity-copilot.preview',
  correlation_id: 'corr-001',
  snapshot_id: context.snapshotId,
  policy_version: config.policyVersion,
  model: config.model,
  generated_at: '2030-01-01T00:00:01.000Z',
  human_review_required: true,
  brief: {
    executive_summary: 'Resumen sintético sujeto a revisión humana.',
    facts: [{ statement: 'La oportunidad está en Sustentación.', evidence_refs: [`evidence:opportunity:${opportunityId}:stage`] }],
    assumptions: [], risks: [], recommended_actions: ['Revisar con el comercial.'],
    suggested_message: { channel: 'email', subject: 'Seguimiento', body: 'Borrador sintético para revisión humana.' },
    recommended_asset_ids: [], warnings: [],
  },
};
const usage = { provider: 'agent_bridge', model: config.model, input_tokens: 12, output_tokens: 34, rate_limit: null };

function dependencies(overrides = {}) {
  const events = [];
  const deps = {
    isConfigured: () => true,
    getConfig: () => config,
    resolveOpportunityResource: async id => { events.push('resolve'); assert.equal(id, opportunityId); return resource; },
    loadOpportunityContext: async id => { events.push('context'); assert.equal(id, opportunityId); return context; },
    loadApprovedAssets: async () => { events.push('assets'); return []; },
    claimRun: async input => { events.push('claim'); assert.equal(input.idempotencyKey.length, 64); return { status: 'claimed', claim_id: claimId }; },
    findRunByKey: async () => { events.push('find-key'); return null; },
    findRunById: async id => { events.push('find-id'); assert.equal(id, runId); return { run_id: runId, opportunity_id: opportunityId, status: 'completed', output }; },
    createRuntime: () => ({ draft: async (request, options) => { events.push('provider'); assert.equal(request.snapshot_id, context.snapshotId); assert.equal(options.idempotencyKey.length, 64); return { response: { ...output, correlation_id: request.correlation_id }, usage }; } }),
    recordRun: async input => { events.push('persist'); assert.equal(input.claimId, claimId); return { run_id: runId, status: 'completed', output: input.response }; },
    recordFailure: async input => { events.push('failure'); return { run_id: runId, status: 'failed', failure_code: input.failureCode }; },
    releaseClaim: async () => { events.push('release'); return true; },
    recordFeedback: async input => { events.push('feedback'); return { id: 'feedback-1', ...input }; },
    correlationId: () => 'corr-001',
    ...overrides,
  };
  return { deps, events };
}

{
  const { deps, events } = dependencies();
  const api = createAgt003CopilotApi(deps);
  const result = await api.generate({ profile, body: { opportunity_id: opportunityId } });
  assert.equal(result.run_id, runId);
  assert.equal(result.status, 'completed');
  assert.equal(result.reused, false);
  assert.equal(result.human_review_required, true);
  assert.deepEqual(events, ['resolve', 'context', 'assets', 'claim', 'provider', 'persist']);
}

for (const body of [
  {},
  { opportunity_id: opportunityId, send_now: true },
  { opportunity_id: ` ${opportunityId}` },
]) {
  const { deps, events } = dependencies();
  await assert.rejects(() => createAgt003CopilotApi(deps).generate({ profile, body }), /cuerpo|oportunidad/i);
  assert.deepEqual(events, [], 'invalid body is rejected before any database lookup');
}

{
  const denied = { ...profile, permissions: ['modulo_oportunidades'] };
  const { deps, events } = dependencies();
  await assert.rejects(
    () => createAgt003CopilotApi(deps).generate({ profile: denied, body: { opportunity_id: opportunityId } }),
    error => error?.status === 403 && error?.code === 'FORBIDDEN',
  );
  assert.deepEqual(events, ['resolve'], 'scope metadata is the only read before authorization denial');
}

{
  const outsider = { ...profile, id: 'other-commercial' };
  const { deps, events } = dependencies();
  await assert.rejects(
    () => createAgt003CopilotApi(deps).generate({ profile: outsider, body: { opportunity_id: opportunityId } }),
    error => error?.status === 403,
  );
  assert.deepEqual(events, ['resolve']);
}

{
  const { deps, events } = dependencies({
    claimRun: async () => { events.push('claim'); return { status: 'existing' }; },
    findRunByKey: async () => { events.push('find-key'); return { run_id: runId, status: 'completed', output }; },
  });
  const result = await createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId } });
  assert.equal(result.reused, true);
  assert.deepEqual(events, ['resolve', 'context', 'assets', 'claim', 'find-key']);
}

for (const [claimStatus, expectedStatus] of [['in_progress', 409], ['quota', 429], ['saturated', 503]]) {
  const { deps, events } = dependencies({ claimRun: async () => { events.push('claim'); return { status: claimStatus }; } });
  await assert.rejects(
    () => createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId } }),
    error => error?.status === expectedStatus,
  );
  assert.equal(events.includes('provider'), false, `${claimStatus} must never invoke provider`);
}

{
  const { deps, events } = dependencies({
    createRuntime: () => ({ draft: async () => { events.push('provider'); const error = new Error('secret provider detail'); error.code = 'REMOTE_TIMEOUT'; throw error; } }),
  });
  await assert.rejects(
    () => createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId } }),
    error => error?.status === 502 && error?.code === 'VIGIA_COPILOT_UNAVAILABLE' && !error.message.includes('secret'),
  );
  assert.deepEqual(events, ['resolve', 'context', 'assets', 'claim', 'provider', 'failure']);
}

{
  const { deps, events } = dependencies({ isConfigured: () => false });
  await assert.rejects(
    () => createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId } }),
    error => error?.status === 503 && error?.code === 'VIGIA_COPILOT_NOT_CONFIGURED',
  );
  assert.deepEqual(events, ['resolve'], 'configuration is checked after scope but before CRM context');
}

{
  const { deps, events } = dependencies();
  const result = await createAgt003CopilotApi(deps).feedback({
    profile,
    body: { run_id: runId, opportunity_id: opportunityId, rating: 'useful', comment: 'Útil con ajustes menores.' },
  });
  assert.equal(result.rating, 'useful');
  assert.deepEqual(events, ['find-id', 'resolve', 'feedback']);
}

for (const body of [
  { run_id: runId, opportunity_id: opportunityId, rating: 'useful', unexpected: true },
  { run_id: runId, opportunity_id: opportunityId, rating: 'invalid' },
]) {
  const { deps, events } = dependencies();
  await assert.rejects(() => createAgt003CopilotApi(deps).feedback({ profile, body }), /cuerpo|rating/i);
  assert.deepEqual(events, []);
}

{
  const { deps, events } = dependencies({ findRunById: async () => { events.push('find-id'); return { run_id: runId, opportunity_id: opportunityId, status: 'failed', output: null }; } });
  await assert.rejects(
    () => createAgt003CopilotApi(deps).feedback({ profile, body: { run_id: runId, opportunity_id: opportunityId, rating: 'discarded' } }),
    error => error?.status === 409,
  );
  assert.deepEqual(events, ['find-id']);
}

console.log('AGT-003 copilot API orchestration passed');
