// Vig-IA Comercial (AGT-003) — cupos y modelo según la configuración aprobada de la Plataforma de Agentes.
// Lógica pura (equipo / perfil / sin límite + techo / excepciones vigentes y vencidas / bordes de día y mes en Bogotá)
// y reservas con dobles (RPC v2 y caída a la RPC original cuando la migración no está aplicada).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bogotaPeriodStartIso,
  capabilityPolicy,
  claimCopilotRunWithQuota,
  claimLeadAnalysis,
  copilotQuotaMessage,
  isMissingRpcError,
  leadAnalysisQuotaMessage,
  readActorAiUsageProfile,
  resolveBridgeModel,
  resolveCapabilityQuota,
} from '../agt003-ai-quota.js';
import { defaultAgentConfiguration } from '../platform-agent-configuration.js';
import { codeDefaultEffectiveConfiguration } from '../platform-agent-effective-configuration.js';

const COPILOT = 'agt003.opportunity-copilot.preview';
const LEAD = 'agt003.lead-deep-analysis';
const ANA = '33333333-3333-4333-8333-333333333333';
const LUIS = '55555555-5555-4555-8555-555555555555';
// 2026-10-09 10:00 en Bogotá.
const NOW = new Date('2026-10-09T15:00:00Z');

function quiet(fn) {
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args); };
  try { return { value: fn(), warnings }; } finally { console.warn = warn; }
}
async function quietAsync(fn) {
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args); };
  try { return { value: await fn(), warnings }; } finally { console.warn = warn; }
}

function capability(overrides = {}) {
  return { enabled: true, model: 'sonnet', fallback: 'notify', team_cap: { per: 'day', max: 20 }, ...overrides };
}

test('día y mes en hora de Bogotá: bordes de medianoche, fin de mes y fin de año', () => {
  // 23:59:59 del 9 de octubre en Bogotá (04:59:59Z del 10) sigue siendo el día 9.
  assert.equal(bogotaPeriodStartIso('day', new Date('2026-10-10T04:59:59Z')), '2026-10-09T05:00:00.000Z');
  // Medianoche de Bogotá exacta: empieza el día 10.
  assert.equal(bogotaPeriodStartIso('day', new Date('2026-10-10T05:00:00Z')), '2026-10-10T05:00:00.000Z');
  // En UTC ya es 1 de noviembre, en Bogotá todavía 31 de octubre: el mes sigue siendo octubre.
  assert.equal(bogotaPeriodStartIso('month', new Date('2026-11-01T04:30:00Z')), '2026-10-01T05:00:00.000Z');
  assert.equal(bogotaPeriodStartIso('month', new Date('2026-11-01T05:00:00Z')), '2026-11-01T05:00:00.000Z');
  assert.equal(bogotaPeriodStartIso('month', new Date('2027-01-01T04:00:00Z')), '2026-12-01T05:00:00.000Z');
  assert.equal(bogotaPeriodStartIso('day', new Date('2027-01-01T04:00:00Z')), '2026-12-31T05:00:00.000Z');
});

test('sólo cupo del equipo: sin perfil o con un perfil que no está en profile_caps', () => {
  const cap = capability({ profile_caps: { comercial: { per: 'day', max: 5 } } });
  for (const aiUsageProfile of [null, 'gerencia']) {
    const quota = resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile, personId: ANA, now: NOW });
    assert.equal(quota.enabled, true);
    assert.deepEqual(quota.team, { per: 'day', max: 20, period_start: '2026-10-09T05:00:00.000Z' });
    assert.equal(quota.actor, null);
  }
});

test('cupo por perfil propio (día o mes) y nunca por encima del equipo en el mismo periodo', () => {
  const cap = capability({ profile_caps: { comercial: { per: 'day', max: 5 }, junta: { per: 'month', max: 40 }, alto: { per: 'day', max: 900 } } });
  assert.deepEqual(resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'comercial', now: NOW }).actor,
    { per: 'day', max: 5, basis: 'profile', period_start: '2026-10-09T05:00:00.000Z' });
  assert.deepEqual(resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'junta', now: NOW }).actor,
    { per: 'month', max: 40, basis: 'profile', period_start: '2026-10-01T05:00:00.000Z' }, 'periodo distinto: no se recorta, se cuentan ambos');
  assert.equal(resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'alto', now: NOW }).actor.max, 20, 'recortado al equipo');
});

test('perfil sin límite: sin cupo propio pero con techo de seguridad en el periodo del equipo', () => {
  const cap = capability({ team_cap: { per: 'month', max: 30 }, profile_caps: { gerencia: { unlimited: true, safety_max: 10 } } });
  assert.deepEqual(resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'gerencia', now: NOW }).actor,
    { per: 'month', max: 10, basis: 'unlimited', period_start: '2026-10-01T05:00:00.000Z' });
});

test('excepciones: vigente suma, vencida no, el último día cuenta en hora de Bogotá', () => {
  const cap = capability({
    profile_caps: { comercial: { per: 'day', max: 5 }, gerencia: { unlimited: true, safety_max: 8 } },
    exceptions: [
      { person: ANA, extra: 3, per: 'day', expires: '2026-10-09' },
      { person: LUIS, extra: 4, per: 'day', expires: '2026-10-08' },
    ],
  });
  // Excepción > perfil.
  assert.deepEqual(resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'comercial', personId: ANA, now: NOW }).actor,
    { per: 'day', max: 8, basis: 'exception', period_start: '2026-10-09T05:00:00.000Z' });
  // Vence hoy en Bogotá: a las 23:59 de Bogotá (04:59Z del día siguiente) sigue vigente; a medianoche ya no.
  assert.equal(resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'comercial', personId: ANA, now: new Date('2026-10-10T04:59:00Z') }).actor.max, 8);
  assert.equal(resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'comercial', personId: ANA, now: new Date('2026-10-10T05:00:00Z') }).actor.max, 5);
  // Vencida ayer: no suma.
  assert.equal(resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'comercial', personId: LUIS, now: NOW }).actor.max, 5);
  // Perfil sin límite: el techo de seguridad + extra.
  assert.equal(resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'gerencia', personId: ANA, now: NOW }).actor.max, 11);
  // La excepción tampoco supera el equipo.
  const big = capability({ team_cap: { per: 'day', max: 6 }, profile_caps: { comercial: { per: 'day', max: 5 } }, exceptions: [{ person: ANA, extra: 50, per: 'day', expires: '2099-01-01' }] });
  assert.equal(resolveCapabilityQuota({ capabilityConfig: big, aiUsageProfile: 'comercial', personId: ANA, now: NOW }).actor.max, 6);
});

test('excepción sin cupo por persona no crea cupo (el techo es el equipo); periodo distinto se ignora con aviso', () => {
  const cap = capability({
    profile_caps: { comercial: { per: 'day', max: 5 } },
    exceptions: [{ person: ANA, extra: 3, per: 'month', expires: '2099-01-01' }, { person: LUIS, extra: 3, per: 'day', expires: '2099-01-01' }],
  });
  const noProfile = resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: null, personId: LUIS, now: NOW });
  assert.equal(noProfile.actor, null);
  assert.deepEqual(noProfile.notes, ['exception_without_personal_cap']);
  const mismatch = resolveCapabilityQuota({ capabilityConfig: cap, aiUsageProfile: 'comercial', personId: ANA, now: NOW });
  assert.equal(mismatch.actor.max, 5);
  assert.deepEqual(mismatch.notes, ['exception_period_mismatch']);
  const { value, warnings } = quiet(() => capabilityPolicy({ effective: { source: 'platform', version_number: 2, configuration: { capabilities: { [COPILOT]: cap } } }, capability: COPILOT, aiUsageProfile: 'comercial', personId: ANA, environmentModel: 'sonnet', now: NOW }));
  assert.equal(value.quota.actor.max, 5);
  assert.equal(warnings[0][0], 'agt003_quota_exception_ignored');
});

test('modelo: el aprobado si está en la lista cerrada; si no, o sin versión aprobada, el del entorno', () => {
  const platform = { source: 'platform', configuration: { capabilities: { [COPILOT]: capability({ model: 'sonnet' }), [LEAD]: capability({ model: 'opus' }) } } };
  assert.equal(resolveBridgeModel(platform, COPILOT, 'env-model'), 'sonnet');
  assert.equal(resolveBridgeModel(platform, LEAD, 'env-model'), 'env-model', 'fuera de la lista cerrada → por defecto');
  assert.equal(resolveBridgeModel(codeDefaultEffectiveConfiguration('AGT-003', {}), COPILOT, 'env-model'), 'env-model', 'valores del código → modelo del entorno');
});

test('política: apagada, valores del código (20/día y 30/mes) y caída a los valores del código si la vigente no sirve', () => {
  const defaults = codeDefaultEffectiveConfiguration('AGT-003', {});
  const copilot = capabilityPolicy({ effective: defaults, capability: COPILOT, environmentModel: 'sonnet', now: NOW });
  assert.equal(copilot.source, 'code');
  assert.deepEqual(copilot.quota.team, { per: 'day', max: 20, period_start: '2026-10-09T05:00:00.000Z' });
  const lead = capabilityPolicy({ effective: defaults, capability: LEAD, environmentModel: 'sonnet', now: NOW });
  assert.deepEqual(lead.quota.team, { per: 'month', max: 30, period_start: '2026-10-01T05:00:00.000Z' });
  const configuration = defaultAgentConfiguration('AGT-003');
  configuration.capabilities[COPILOT].enabled = false;
  assert.equal(capabilityPolicy({ effective: { source: 'platform', version_number: 3, configuration }, capability: COPILOT, environmentModel: 'sonnet' }).enabled, false);
  const broken = { source: 'platform', configuration: { capabilities: { [COPILOT]: { enabled: true, team_cap: { per: 'week', max: 1 } } } } };
  const { value } = quiet(() => capabilityPolicy({ effective: broken, fallbackEffective: defaults, capability: COPILOT, environmentModel: 'sonnet', now: NOW }));
  assert.equal(value.source, 'code');
  assert.equal(value.quota.team.max, 20);
});

test('mensajes: cupo del equipo y cupo personal, hoy o este mes', () => {
  assert.equal(copilotQuotaMessage('team', 'day'), 'El cupo de Vig-IA del equipo para hoy está agotado.');
  assert.equal(copilotQuotaMessage('actor', 'day'), 'Tu cupo personal de Vig-IA de hoy está agotado.');
  assert.equal(copilotQuotaMessage('actor', 'month'), 'Tu cupo personal de Vig-IA de este mes está agotado.');
  assert.equal(leadAnalysisQuotaMessage('team', 'month', 30, 30), 'Se acabó el cupo de análisis profundos del equipo de este mes (30 de 30). Vuelve el próximo mes.');
  assert.equal(leadAnalysisQuotaMessage('actor', 'day', 2, 2), 'Tu cupo personal de análisis profundos de hoy está agotado (2 de 2). Vuelve mañana.');
});

function fakeRpc(handlers) {
  const calls = [];
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params });
      const handler = handlers[name];
      if (!handler) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      return handler(params);
    },
  };
}
const QUOTA = {
  team: { per: 'day', max: 20, period_start: '2026-10-09T05:00:00.000Z' },
  actor: { per: 'day', max: 5, period_start: '2026-10-09T05:00:00.000Z', basis: 'profile' },
};

test('reserva del copiloto: RPC v2 con equipo y persona; sin migración cae a la original con el tope del equipo', async () => {
  const v2 = fakeRpc({ psi_claim_agt003_copilot_run_v2: () => ({ data: { status: 'quota', scope: 'actor', used: 5, max: 5 }, error: null }) });
  const result = await claimCopilotRunWithQuota(v2, { idempotencyKey: 'a'.repeat(64), actorId: ANA, quota: QUOTA, maxConcurrent: 1, leaseSeconds: 45 });
  assert.equal(result.scope, 'actor');
  assert.deepEqual(v2.calls[0].params, {
    p_idempotency_key: 'a'.repeat(64), p_actor_id: ANA, p_team_max: 20, p_team_period_start: '2026-10-09T05:00:00.000Z',
    p_actor_max: 5, p_actor_period_start: '2026-10-09T05:00:00.000Z', p_max_concurrent: 1, p_lease_seconds: 45,
  });

  const v1 = fakeRpc({ psi_claim_agt003_copilot_run: () => ({ data: { status: 'quota' }, error: null }) });
  const { value, warnings } = await quietAsync(() => claimCopilotRunWithQuota(v1, { idempotencyKey: 'a'.repeat(64), actorId: ANA, quota: { ...QUOTA, team: { ...QUOTA.team, max: 7 } }, maxConcurrent: 1, leaseSeconds: 45 }));
  assert.deepEqual(value, { status: 'quota', scope: 'team' });
  assert.deepEqual(v1.calls.map(call => call.name), ['psi_claim_agt003_copilot_run_v2', 'psi_claim_agt003_copilot_run']);
  assert.equal(v1.calls[1].params.p_daily_max_runs, 7, 'tope del equipo leído de la configuración');
  assert.equal(warnings[0][0], 'agt003_quota_rpc_fallback');

  const zero = fakeRpc({});
  const closed = await quietAsync(() => claimCopilotRunWithQuota(zero, { idempotencyKey: 'a'.repeat(64), actorId: ANA, quota: { team: { ...QUOTA.team, max: 0 }, actor: null }, maxConcurrent: 1, leaseSeconds: 45 }));
  assert.deepEqual(closed.value, { status: 'quota', scope: 'team' });
  assert.equal(zero.calls.length, 1, 'cupo 0 sin RPC nueva: no se reserva con la original');

  const failing = fakeRpc({ psi_claim_agt003_copilot_run_v2: () => ({ data: null, error: { code: '22023', message: 'x' } }) });
  await assert.rejects(claimCopilotRunWithQuota(failing, { idempotencyKey: 'a'.repeat(64), actorId: ANA, quota: QUOTA, maxConcurrent: 1, leaseSeconds: 45 }));
  assert.equal(failing.calls.length, 1, 'otros errores no caen a la RPC original');
  await assert.rejects(claimCopilotRunWithQuota(v2, { idempotencyKey: 'a'.repeat(64), actorId: 'no-uuid', quota: QUOTA, maxConcurrent: 1, leaseSeconds: 45 }));
  assert.equal(isMissingRpcError({ code: '42883' }), true);
});

test('reserva del análisis profundo: RPC v2 y caída a la original (114) con el cupo y el periodo de la configuración', async () => {
  const base = { opportunityId: '00000000-0000-4000-8000-000000000001', actorId: ANA, profileHash: 'a'.repeat(64), contractVersion: '1.0' };
  const v2 = fakeRpc({ psi_claim_agt003_lead_analysis_v2: () => ({ data: { status: 'claimed', id: 'x', used: 1, max: 30 }, error: null }) });
  const monthly = { team: { per: 'month', max: 30, period_start: '2026-10-01T05:00:00.000Z' }, actor: null };
  assert.equal((await claimLeadAnalysis(v2, { ...base, quota: monthly })).status, 'claimed');
  assert.equal(v2.calls[0].params.p_actor_max, null);
  assert.equal(v2.calls[0].params.p_actor_period_start, null);
  assert.equal(v2.calls[0].params.p_team_period_start, '2026-10-01T05:00:00.000Z');

  const v1 = fakeRpc({ psi_claim_agt003_lead_analysis: () => ({ data: { status: 'quota', used: 30, max: 30 }, error: null }) });
  const { value } = await quietAsync(() => claimLeadAnalysis(v1, { ...base, quota: monthly }));
  assert.deepEqual(value, { status: 'quota', used: 30, max: 30, scope: 'team' });
  assert.deepEqual(v1.calls[1].params, { ...{ p_opportunity_id: base.opportunityId, p_profile_hash: base.profileHash, p_contract_version: '1.0' }, p_actor_id: ANA, p_monthly_max: 30, p_month_start: '2026-10-01T05:00:00.000Z' });
});

test('perfil de uso de IA de quien pide: columna ausente o error → null (sólo cupo del equipo)', async () => {
  const fake = result => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) });
  assert.equal(await readActorAiUsageProfile(fake({ data: { ai_usage_profile: 'comercial' }, error: null }), ANA), 'comercial');
  assert.equal(await readActorAiUsageProfile(fake({ data: { ai_usage_profile: 'Mal Valor' }, error: null }), ANA), null);
  assert.equal(await readActorAiUsageProfile(fake({ data: null, error: { code: '42703' } }), ANA), null);
  const { value } = await quietAsync(() => readActorAiUsageProfile(fake({ data: null, error: { code: '57014' } }), ANA));
  assert.equal(value, null);
});
