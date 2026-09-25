import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgt003CopilotRequest } from '../agt003-copilot-input.js';
import { createAgt003CopilotApi } from '../agt003-copilot-api.js';
import { AGT003_COPILOT_POLICY } from '../agt003-copilot-engine.js';
import { computeAgt003CopilotIdempotencyKey } from '../agt003-copilot-persistence.js';

const opportunity = {
  id: 'opp-channel-001',
  title: 'Renovación de contrato',
  company_name: 'Cliente Canal S.A.S.',
  stage: 'Sustentación',
  service: 'Seguridad electrónica',
  owner_name: 'Comercial Canal',
};

function baseBuildInput(overrides = {}) {
  return {
    opportunity,
    interactions: [],
    approvedAssets: [],
    correlationId: 'corr-channel-001',
    snapshotId: 'snapshot-channel-001',
    ...overrides,
  };
}

// 1) INPUT ---------------------------------------------------------------

test('agt003-copilot-input: build sin contactChannel lanza', () => {
  assert.throws(() => buildAgt003CopilotRequest(baseBuildInput()), /contact_channel|canal/i);
});

test('agt003-copilot-input: contactChannel whatsapp queda en el request sin commercial_intent', () => {
  const request = buildAgt003CopilotRequest(baseBuildInput({ contactChannel: 'whatsapp' }));
  assert.equal(request.contact_channel, 'whatsapp');
  assert.equal(Object.hasOwn(request, 'commercial_intent'), false);
});

test('agt003-copilot-input: contactChannel email con commercialIntent se recorta y no entra a facts', () => {
  const request = buildAgt003CopilotRequest(baseBuildInput({
    contactChannel: 'email',
    commercialIntent: '  cerrar agenda  ',
  }));
  assert.equal(request.commercial_intent, 'cerrar agenda');
  assert.ok(!request.opportunity.facts.some(fact => fact.field === 'commercial_intent'));
});

test('agt003-copilot-input: commercialIntent de 501 caracteres lanza', () => {
  assert.throws(
    () => buildAgt003CopilotRequest(baseBuildInput({ contactChannel: 'email', commercialIntent: 'x'.repeat(501) })),
    /intent|intenci[oó]n|500/i,
  );
});

test('agt003-copilot-input: commercialIntent en blanco se omite', () => {
  const request = buildAgt003CopilotRequest(baseBuildInput({ contactChannel: 'email', commercialIntent: '   ' }));
  assert.equal(Object.hasOwn(request, 'commercial_intent'), false);
});

// 2) API -------------------------------------------------------------------

const opportunityId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const claimId = '33333333-3333-4333-8333-333333333333';
const profile = {
  id: 'user-comercial', active: true, identity_type: 'human', role: 'comercial',
  permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'], areas: [],
};
const resource = { area_code: 'comercial', subarea_code: 'norte', owner_id: profile.id };
const apiOpportunity = {
  id: opportunityId,
  owner_id: profile.id,
  title: 'Renovación sintética',
  company_name: 'Cliente Sintético',
  stage: 'Sustentación',
  service: 'Seguridad electrónica',
  owner_name: 'Comercial Sintético',
};
const context = {
  opportunity: apiOpportunity,
  interactions: [],
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
    claimRun: async input => { events.push('claim'); return { status: 'claimed', claim_id: claimId }; },
    findRunByKey: async () => { events.push('find-key'); return null; },
    findRunById: async id => { events.push('find-id'); return { run_id: runId, opportunity_id: opportunityId, status: 'completed', output }; },
    createRuntime: () => ({ draft: async request => { events.push('provider'); return { response: { ...output, correlation_id: request.correlation_id }, usage }; } }),
    recordRun: async input => { events.push('persist'); return { run_id: runId, status: 'completed', output: input.response }; },
    recordFailure: async input => { events.push('failure'); return { run_id: runId, status: 'failed', failure_code: input.failureCode }; },
    releaseClaim: async () => { events.push('release'); return true; },
    recordFeedback: async input => { events.push('feedback'); return { id: 'feedback-1', ...input }; },
    correlationId: () => 'corr-001',
    ...overrides,
  };
  return { deps, events };
}

test('agt003-copilot-api: generate sin canal es rechazado antes de cualquier lookup', async () => {
  const { deps, events } = dependencies();
  await assert.rejects(
    () => createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId } }),
    /cuerpo|canal|contact_channel/i,
  );
  assert.deepEqual(events, []);
});

test('agt003-copilot-api: generate con canal inválido "sms" es rechazado', async () => {
  const { deps, events } = dependencies();
  await assert.rejects(
    () => createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId, contact_channel: 'sms' } }),
    /cuerpo|canal|contact_channel/i,
  );
  assert.deepEqual(events, []);
});

test('agt003-copilot-api: generate con campo inesperado junto al canal es rechazado', async () => {
  const { deps, events } = dependencies();
  await assert.rejects(
    () => createAgt003CopilotApi(deps).generate({ profile, body: { opportunity_id: opportunityId, contact_channel: 'email', extra: true } }),
    /cuerpo|canal|contact_channel/i,
  );
  assert.deepEqual(events, []);
});

test('agt003-copilot-api: generate con commercial_intent de 501 caracteres es rechazado', async () => {
  const { deps, events } = dependencies();
  await assert.rejects(
    () => createAgt003CopilotApi(deps).generate({
      profile,
      body: { opportunity_id: opportunityId, contact_channel: 'email', commercial_intent: 'x'.repeat(501) },
    }),
    /intent|500|intenci/i,
  );
  assert.deepEqual(events, []);
});

// 3) ENGINE POLICY -----------------------------------------------------------

test('agt003-copilot-engine: la política menciona whatsapp y asunto nulo para whatsapp', () => {
  assert.match(AGT003_COPILOT_POLICY, /whatsapp/i);
  assert.match(AGT003_COPILOT_POLICY, /whatsapp[\s\S]{0,200}(asunto|subject)[\s\S]{0,80}(null|nulo)|( asunto|subject)[\s\S]{0,200}whatsapp[\s\S]{0,80}(null|nulo)/i);
});

test('agt003-copilot-engine: la política trata commercial_intent como instrucción del comercial, no evidencia CRM', () => {
  assert.match(AGT003_COPILOT_POLICY, /(commercial_intent|intenci[oó]n comercial)/i);
  assert.match(AGT003_COPILOT_POLICY, /(commercial_intent|intenci[oó]n comercial)[\s\S]{0,200}(no es evidencia|no proviene del crm|instrucci[oó]n del comercial)/i);
});

test('agt003-copilot-engine: la política prohíbe inventar el canal', () => {
  assert.match(AGT003_COPILOT_POLICY, /no inventes el canal|nunca inventes el canal/i);
});

// 4) IDEMPOTENCIA --------------------------------------------------------------

test('agt003-copilot-persistence: la clave de idempotencia difiere entre email y whatsapp', () => {
  const email = computeAgt003CopilotIdempotencyKey({
    snapshotId: 'snapshot-001', policyVersion: 'policy-v1', model: 'model-x', contactChannel: 'email', intentPresent: false,
  });
  const whatsapp = computeAgt003CopilotIdempotencyKey({
    snapshotId: 'snapshot-001', policyVersion: 'policy-v1', model: 'model-x', contactChannel: 'whatsapp', intentPresent: false,
  });
  assert.notEqual(email, whatsapp);
});

test('agt003-copilot-persistence: la clave de idempotencia difiere si intentPresent cambia', () => {
  const withoutIntent = computeAgt003CopilotIdempotencyKey({
    snapshotId: 'snapshot-001', policyVersion: 'policy-v1', model: 'model-x', contactChannel: 'email', intentPresent: false,
  });
  const withIntent = computeAgt003CopilotIdempotencyKey({
    snapshotId: 'snapshot-001', policyVersion: 'policy-v1', model: 'model-x', contactChannel: 'email', intentPresent: true,
  });
  assert.notEqual(withoutIntent, withIntent);
});
