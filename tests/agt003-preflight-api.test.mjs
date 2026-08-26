import assert from 'node:assert/strict';
import { createAgt003PreflightApi } from '../agt003-preflight-api.js';

const opportunityId = '11111111-1111-4111-8111-111111111111';
const profile = {
  id: 'user-comercial', active: true, identity_type: 'human', role: 'comercial',
  permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'], areas: [],
};
const resource = { area_code: 'comercial', subarea_code: 'norte', owner_id: profile.id };
const context = {
  opportunity: {
    id: opportunityId,
    title: 'Renovación sintética',
    company_name: 'Cliente Sintético',
    stage: 'Sustentación',
    service: 'Seguridad electrónica',
    owner_name: 'Comercial Sintético',
    preparation_date: '2030-02-01',
  },
  interactions: [{ id: '001', interaction_type: 'nota', occurred_at: '2030-01-15T00:00:00.000Z', notes: 'Necesidad sintética.' }],
  snapshotId: 'snapshot-preflight-synthetic-001',
};

function dependencies(overrides = {}) {
  const events = [];
  const deps = {
    isConfigured: () => true,
    getConfig: () => { events.push('config'); return { model: 'synthetic-model', policyVersion: 'agt003-preflight-policy-v1' }; },
    resolveOpportunityResource: async id => { events.push('resolve'); assert.equal(id, opportunityId); return resource; },
    loadOpportunityContext: async id => { events.push('context'); assert.equal(id, opportunityId); return context; },
    createRuntime: () => ({
      preflight: async (request, options) => {
        events.push('provider');
        assert.equal(request.snapshot_id, context.snapshotId);
        assert.equal(options.idempotencyKey, `${context.snapshotId}:agt003-preflight-policy-v1:synthetic-model`);
        return {
          response: {
            contract_version: request.contract_version,
            capability_id: request.capability_id,
            correlation_id: request.correlation_id,
            snapshot_id: request.snapshot_id,
            policy_version: 'agt003-preflight-policy-v1',
            model: 'synthetic-model',
            generated_at: '2030-02-01T10:01:00.000Z',
            actions: [{
              issue_code: 'next_action',
              title: 'Definir próximo paso',
              description: 'Acordar una fecha concreta con el cliente.',
              evidence_refs: ['evidence:opportunity:stage'],
            }],
          },
          usage: { provider: 'agent_bridge', model: 'synthetic-model', input_tokens: 1, output_tokens: 2, rate_limit: null },
        };
      },
    }),
    correlationId: () => 'corr-preflight-api-001',
    ...overrides,
  };
  return { deps, events };
}

{
  const { deps, events } = dependencies();
  const result = await createAgt003PreflightApi(deps).preflight({ profile, body: { opportunity_id: opportunityId } });
  assert.deepEqual(result, {
    status: 'completed',
    actions: [{ issue_code: 'next_action', title: 'Definir próximo paso', description: 'Acordar una fecha concreta con el cliente.', evidence_refs: ['evidence:opportunity:stage'] }],
  });
  assert.deepEqual(events, ['resolve', 'config', 'context', 'provider']);
}

for (const body of [
  {},
  { opportunity_id: opportunityId, unexpected: true },
  { opportunity_id: ` ${opportunityId}` },
]) {
  const { deps, events } = dependencies();
  await assert.rejects(
    () => createAgt003PreflightApi(deps).preflight({ profile, body }),
    error => error?.status === 400 && error?.code === 'VIGIA_PREFLIGHT_BAD_REQUEST',
  );
  assert.deepEqual(events, [], 'closed body rejects before all reads');
}

{
  const denied = { ...profile, permissions: ['modulo_oportunidades'] };
  const { deps, events } = dependencies();
  await assert.rejects(
    () => createAgt003PreflightApi(deps).preflight({ profile: denied, body: { opportunity_id: opportunityId } }),
    error => error?.status === 403 && error?.code === 'FORBIDDEN',
  );
  assert.deepEqual(events, ['resolve'], 'authorization only reads scope metadata');
}

{
  const { deps, events } = dependencies({ isConfigured: () => false });
  await assert.rejects(
    () => createAgt003PreflightApi(deps).preflight({ profile, body: { opportunity_id: opportunityId } }),
    error => error?.status === 503 && error?.code === 'VIGIA_PREFLIGHT_NOT_CONFIGURED',
  );
  assert.deepEqual(events, ['resolve'], 'configuration fails after scope and before context');
}

{
  const { deps, events } = dependencies({
    getConfig: () => { events.push('config'); throw new Error('getAgt003PreflightRuntimeConfig is not defined'); },
  });
  await assert.rejects(
    () => createAgt003PreflightApi(deps).preflight({ profile, body: { opportunity_id: opportunityId } }),
    error => {
      assert.equal(error?.status, 503);
      assert.equal(error?.code, 'VIGIA_PREFLIGHT_NOT_CONFIGURED');
      assert.equal(error.message.includes('getAgt003PreflightRuntimeConfig'), false);
      assert.equal(error.message.includes('is not defined'), false);
      return true;
    },
  );
  assert.deepEqual(events, ['resolve', 'config'], 'config failure occurs after scope authorization and before context/provider');
}

{
  const { deps, events } = dependencies({ loadOpportunityContext: async () => { events.push('context'); return null; } });
  await assert.rejects(
    () => createAgt003PreflightApi(deps).preflight({ profile, body: { opportunity_id: opportunityId } }),
    error => error?.status === 503 && error?.code === 'VIGIA_PREFLIGHT_CONTEXT_UNAVAILABLE',
  );
  assert.deepEqual(events, ['resolve', 'config', 'context']);
}

for (const [providerCode, status, publicCode] of [
  ['AGT003_PREFLIGHT_CONCURRENCY', 503, 'VIGIA_PREFLIGHT_SATURATED'],
  ['AGT003_BRIDGE_BUSY', 503, 'VIGIA_PREFLIGHT_SATURATED'],
  ['AGT003_PREFLIGHT_QUOTA', 429, 'VIGIA_PREFLIGHT_QUOTA'],
  ['AGT003_CLAUDE_SESSION_LIMIT', 503, 'VIGIA_PREFLIGHT_SESSION_LIMIT'],
  ['PRIVATE_UPSTREAM_CODE', 502, 'VIGIA_PREFLIGHT_UNAVAILABLE'],
]) {
  const { deps, events } = dependencies({
    createRuntime: () => ({ preflight: async () => { events.push('provider'); const error = new Error('detalle privado'); error.code = providerCode; throw error; } }),
  });
  await assert.rejects(
    () => createAgt003PreflightApi(deps).preflight({ profile, body: { opportunity_id: opportunityId } }),
    error => {
      assert.equal(error?.status, status);
      assert.equal(error?.code, publicCode);
      assert.equal(error.message.includes('privado'), false);
      assert.equal(error.message.includes(providerCode), false);
      return true;
    },
  );
  assert.deepEqual(events, ['resolve', 'config', 'context', 'provider']);
}

assert.throws(
  () => createAgt003PreflightApi({ isConfigured: () => true }),
  /dependencias/i,
);

console.log('AGT-003 preflight API orchestration passed');
