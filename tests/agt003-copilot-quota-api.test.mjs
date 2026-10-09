// Copiloto Vig-IA (AGT-003) con la política vigente de la plataforma (dobles, sin base ni puente reales): función
// apagada, cupo del equipo vs. cupo personal, modelo aprobado enviado al puente y compatibilidad sin política.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgt003CopilotApi } from '../agt003-copilot-api.js';
import { claimAgt003CopilotRun } from '../agt003-copilot-persistence.js';

const OPPORTUNITY = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const profile = { id: ACTOR, active: true, identity_type: 'human', role: 'comercial', permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'], areas: [] };
const QUOTA = {
  team: { per: 'day', max: 20, period_start: '2026-10-09T05:00:00.000Z' },
  actor: { per: 'month', max: 5, period_start: '2026-10-01T05:00:00.000Z', basis: 'profile' },
};

function build({ policy, claim = { status: 'quota', scope: 'team' } } = {}) {
  const seen = { claims: [], rejections: [], runtimes: [] };
  const api = createAgt003CopilotApi({
    isConfigured: () => true,
    getConfig: () => ({ model: 'env-model', policyVersion: 'p1', dailyMaxRuns: 20, maxConcurrent: 1, leaseSeconds: 45 }),
    ...(policy === undefined ? {} : { resolvePolicy: async args => { seen.policyArgs = args; return policy; } }),
    resolveOpportunityResource: async () => ({ area_code: 'comercial', subarea_code: null, owner_id: ACTOR }),
    loadOpportunityContext: async () => ({
      opportunity: { id: OPPORTUNITY, title: 'Oportunidad', company_name: 'Empresa', stage: 'Contacto', service: 'Seguridad', owner_name: 'Humano', preparation_date: '2030-02-01' },
      interactions: [],
      snapshotId: 'snapshot-1',
    }),
    loadApprovedAssets: async () => [],
    claimRun: async options => { seen.claims.push(options); return typeof claim === 'function' ? claim(options) : claim; },
    findRunByKey: async () => null,
    findRunById: async () => null,
    createRuntime: options => { seen.runtimes.push(options); return { async draft() { throw Object.assign(new Error('x'), { code: 'AGT003_BRIDGE_BUSY' }); } }; },
    recordRun: async () => { throw new Error('no'); },
    recordFailure: async () => { throw new Error('no'); },
    releaseClaim: async () => {},
    recordFeedback: async () => {},
    recordRejection: async payload => { seen.rejections.push(payload); },
    correlationId: () => '99999999-9999-4999-8999-999999999999',
  });
  return { api, seen };
}
const body = { opportunity_id: OPPORTUNITY, contact_channel: 'email' };

test('función apagada: mensaje claro, rechazo AGT003_CAPABILITY_DISABLED y sin reserva ni modelo', async () => {
  const { api, seen } = build({ policy: { enabled: false, model: 'sonnet', quota: QUOTA } });
  await assert.rejects(api.generate({ profile, body }), error => error.status === 503 && error.code === 'AGT003_CAPABILITY_DISABLED' && /apagada/.test(error.message));
  assert.equal(seen.claims.length, 0);
  assert.equal(seen.runtimes.length, 0);
  assert.deepEqual(seen.rejections, [{ failureCode: 'AGT003_CAPABILITY_DISABLED', model: 'sonnet', correlationId: '99999999-9999-4999-8999-999999999999' }]);
  assert.equal(seen.policyArgs.profile, profile, 'la política se calcula para quien pide');
});

test('cupo del equipo agotado: VIGIA_COPILOT_QUOTA con mensaje del equipo', async () => {
  const { api, seen } = build({ policy: { enabled: true, model: 'sonnet', quota: QUOTA }, claim: { status: 'quota', scope: 'team' } });
  await assert.rejects(api.generate({ profile, body }), error => error.status === 429 && error.code === 'VIGIA_COPILOT_QUOTA' && error.message === 'El cupo de Vig-IA del equipo para hoy está agotado.');
  assert.equal(seen.claims[0].actorId, ACTOR);
  assert.deepEqual(seen.claims[0].quota, QUOTA);
  assert.equal(seen.rejections[0].failureCode, 'VIGIA_COPILOT_QUOTA');
  assert.equal(seen.rejections[0].model, 'sonnet', 'el modelo registrado es el aprobado');
});

test('cupo personal agotado: VIGIA_COPILOT_PERSONAL_QUOTA con mensaje personal del periodo', async () => {
  const { api, seen } = build({ policy: { enabled: true, model: 'sonnet', quota: QUOTA }, claim: { status: 'quota', scope: 'actor' } });
  await assert.rejects(api.generate({ profile, body }), error => error.status === 429 && error.code === 'VIGIA_COPILOT_PERSONAL_QUOTA' && error.message === 'Tu cupo personal de Vig-IA de este mes está agotado.');
  assert.equal(seen.rejections[0].failureCode, 'VIGIA_COPILOT_PERSONAL_QUOTA');
  assert.equal(seen.runtimes.length, 0, 'no se llama al modelo');
});

test('modelo aprobado: se envía al puente y entra en la clave de idempotencia', async () => {
  const keys = {};
  for (const model of ['sonnet', 'env-model']) {
    const { api, seen } = build({ policy: { enabled: true, model, quota: QUOTA }, claim: { status: 'claimed', claim_id: 'c1' } });
    await assert.rejects(api.generate({ profile, body }), error => error.code === 'VIGIA_COPILOT_SATURATED');
    assert.deepEqual(seen.runtimes, [{ model }]);
    keys[model] = seen.claims[0].idempotencyKey;
  }
  assert.notEqual(keys.sonnet, keys['env-model']);
});

test('sin política (compatibilidad): reserva original con el tope del entorno y mensaje del equipo', async () => {
  const { api, seen } = build({ claim: { status: 'quota' } });
  await assert.rejects(api.generate({ profile, body }), error => error.code === 'VIGIA_COPILOT_QUOTA' && /equipo para hoy/.test(error.message));
  assert.equal(seen.claims[0].quota, undefined);
  assert.equal(seen.claims[0].dailyMaxRuns, 20);
});

test('persistencia: con cupo usa la reserva v2 y conserva el alcance; sin cupo, la original', async () => {
  const calls = [];
  const database = { async rpc(name, params) { calls.push({ name, params }); return name.endsWith('_v2') ? { data: { status: 'quota', scope: 'actor', used: 5, max: 5 }, error: null } : { data: { status: 'claimed', claim_id: 'c1' }, error: null }; } };
  assert.deepEqual(await claimAgt003CopilotRun(database, { idempotencyKey: 'a'.repeat(64), maxConcurrent: 1, leaseSeconds: 45, actorId: ACTOR, quota: QUOTA }), { status: 'quota', scope: 'actor' });
  assert.deepEqual(await claimAgt003CopilotRun(database, { idempotencyKey: 'a'.repeat(64), dailyMaxRuns: 20, maxConcurrent: 1, leaseSeconds: 45 }), { status: 'claimed', claim_id: 'c1' });
  assert.deepEqual(calls.map(call => call.name), ['psi_claim_agt003_copilot_run_v2', 'psi_claim_agt003_copilot_run']);
});
