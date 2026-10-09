// Vig-IA Comercial (AGT-003): cupos y modelo según la configuración vigente de la Plataforma de Agentes.
//
// Reglas (puerta única de modelos, Paso 2 parte 3; Juan Botero 2026-10-09):
// - `enabled: false` → la función está apagada: no se llama al modelo y queda un rechazo `AGT003_CAPABILITY_DISABLED`.
// - Modelo: el de la versión vigente si está en la lista cerrada; si no hay versión aprobada (valores del código) o el
//   modelo no está en la lista, el del entorno (AGT003_COPILOT_MODEL), que es el comportamiento anterior.
// - Cupo del equipo: `team_cap { per, max }`, contado en hora de Bogotá (el día empieza a medianoche de Bogotá; el mes
//   el día 1 a medianoche de Bogotá).
// - Cupo por persona (según el "Perfil de uso de IA" de quien pide):
//     · perfil con `{ per, max }` → ese cupo propio;
//     · perfil con `{ unlimited: true, safety_max }` → sin cupo propio, pero `safety_max` es su techo por persona en el
//       mismo periodo que el cupo del equipo;
//     · sin perfil, o perfil que no está en `profile_caps` → sólo el cupo del equipo.
// - Excepciones vigentes (`expires` ≥ hoy en Bogotá) de esa persona suman `extra` a su cupo por persona:
//     · con cupo propio del perfil y el MISMO periodo → cupo = perfil + extra;
//     · perfil sin límite (`unlimited`) y el mismo periodo que el equipo → techo = safety_max + extra;
//     · sin cupo por persona (sin perfil o perfil sin cupo) → no crea un cupo: el techo sigue siendo el del equipo, que
//       una excepción nunca puede superar;
//     · periodo distinto al del cupo por persona → no se aplica (se avisa con console.warn); un único contador por
//       persona no puede mezclar día y mes.
// - Orden: excepción > perfil > equipo. El cupo por persona nunca queda por encima del cupo del equipo cuando ambos son
//   del mismo periodo; y en cualquier caso la reserva comprueba los dos contadores (equipo y persona).
import { AGT003_AGENT_ID } from './platform-model-gateway.js';
import { AI_MODEL_OPTIONS, CONFIGURATION_TIMEZONE, bogotaToday } from './platform-agent-configuration.js';

export const AGT003_CAPABILITY_DISABLED_CODE = 'AGT003_CAPABILITY_DISABLED';
export const AGT003_CAPABILITY_DISABLED_MESSAGE = 'Esta función de Vig-IA está apagada por ahora. Consulta con el administrador.';

const PERIODS = new Set(['day', 'month']);

/**
 * Inicio del periodo (día o mes) en hora de Bogotá, como instante ISO UTC. Colombia no tiene horario de verano: la
 * medianoche de Bogotá es siempre las 05:00 UTC.
 */
export function bogotaPeriodStartIso(per, now = new Date()) {
  const today = bogotaToday(now);
  const day = per === 'month' ? `${today.slice(0, 7)}-01` : today;
  return new Date(`${day}T00:00:00-05:00`).toISOString();
}

export function periodWord(per) {
  return per === 'month' ? 'este mes' : 'hoy';
}

/** Modelo que se envía al puente: el aprobado si está en la lista cerrada; si no, el del entorno. */
export function resolveBridgeModel(effective, capability, environmentModel) {
  const model = effective?.source === 'platform' ? effective.configuration?.capabilities?.[capability]?.model : null;
  return typeof model === 'string' && AI_MODEL_OPTIONS.some(option => option.id === model) ? model : environmentModel;
}

/**
 * Cálculo puro del cupo de una persona para una función. Devuelve:
 * `{ enabled, team: { per, max, period_start }, actor: null | { per, max, period_start, basis }, notes: [] }`
 * `basis`: 'profile' | 'unlimited' | 'exception'.
 */
export function resolveCapabilityQuota({ capabilityConfig, aiUsageProfile = null, personId = null, now = new Date() } = {}) {
  const notes = [];
  const enabled = capabilityConfig?.enabled !== false;
  const teamCap = capabilityConfig?.team_cap;
  const team = teamCap && PERIODS.has(teamCap.per) && Number.isInteger(teamCap.max) && teamCap.max >= 0
    ? { per: teamCap.per, max: teamCap.max }
    : null;
  if (!team) throw new Error('La configuración no trae un cupo de equipo válido.');
  team.period_start = bogotaPeriodStartIso(team.per, now);

  let actor = null;
  const profileCap = typeof aiUsageProfile === 'string' ? capabilityConfig?.profile_caps?.[aiUsageProfile] : null;
  if (profileCap?.unlimited === true && Number.isInteger(profileCap.safety_max)) {
    actor = { per: team.per, max: profileCap.safety_max, basis: 'unlimited' };
  } else if (profileCap && PERIODS.has(profileCap.per) && Number.isInteger(profileCap.max)) {
    actor = { per: profileCap.per, max: profileCap.max, basis: 'profile' };
  }

  const today = bogotaToday(now);
  const exception = typeof personId === 'string'
    ? (capabilityConfig?.exceptions || []).find(item => item?.person === personId && typeof item.expires === 'string' && item.expires >= today)
    : null;
  if (exception && Number.isInteger(exception.extra)) {
    if (!actor) notes.push('exception_without_personal_cap');
    else if (exception.per !== actor.per) notes.push('exception_period_mismatch');
    else actor = { per: actor.per, max: actor.max + exception.extra, basis: 'exception' };
  }

  if (actor && actor.per === team.per && actor.max > team.max) actor.max = team.max;
  if (actor) actor.period_start = bogotaPeriodStartIso(actor.per, now);
  return { enabled, team, actor, notes };
}

/**
 * Política completa de una función para quien pide, a partir de la configuración efectiva (plataforma o código).
 * `{ enabled, model, quota, source, version_number }`. Nunca lanza: ante algo inesperado usa los valores del código.
 */
export function capabilityPolicy({ effective, fallbackEffective, capability, aiUsageProfile, personId, environmentModel, now = new Date() }) {
  const candidates = [effective, fallbackEffective].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const capabilityConfig = candidate.configuration?.capabilities?.[capability];
      if (!capabilityConfig) continue;
      const quota = resolveCapabilityQuota({ capabilityConfig, aiUsageProfile, personId, now });
      if (quota.notes.includes('exception_period_mismatch')) {
        console.warn('agt003_quota_exception_ignored', { capability, reason: 'period_mismatch' });
      }
      return {
        enabled: quota.enabled,
        model: resolveBridgeModel(candidate, capability, environmentModel),
        quota: { team: quota.team, actor: quota.actor },
        source: candidate.source,
        version_number: candidate.version_number ?? null,
      };
    } catch {
      console.warn('agt003_quota_policy_fallback', { capability });
    }
  }
  return null;
}

/** Mensajes al usuario cuando se agota un cupo (distintos para equipo y persona). */
export function copilotQuotaMessage(scope, per) {
  return scope === 'actor'
    ? `Tu cupo personal de Vig-IA de ${periodWord(per)} está agotado.`
    : `El cupo de Vig-IA del equipo para ${periodWord(per)} está agotado.`;
}

export function leadAnalysisQuotaMessage(scope, per, used, max) {
  const count = Number.isInteger(used) && Number.isInteger(max) ? ` (${used} de ${max})` : '';
  const again = per === 'month' ? 'Vuelve el próximo mes.' : 'Vuelve mañana.';
  return scope === 'actor'
    ? `Tu cupo personal de análisis profundos de ${periodWord(per)} está agotado${count}. ${again}`
    : `Se acabó el cupo de análisis profundos del equipo de ${periodWord(per)}${count}. ${again}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reservas atómicas (RPC del CRM) con compatibilidad hacia atrás.

/** La RPC no existe todavía en la base (migración sin aplicar): PostgREST PGRST202 o Postgres 42883. */
export function isMissingRpcError(error) {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function quotaParams(quota, actorId) {
  if (!quota?.team || !Number.isInteger(quota.team.max) || quota.team.max < 0 || typeof quota.team.period_start !== 'string') {
    throw new Error('El cupo del equipo no es válido.');
  }
  if (typeof actorId !== 'string' || !UUID.test(actorId)) throw new Error('La persona que pide no es válida.');
  return {
    p_actor_id: actorId,
    p_team_max: quota.team.max,
    p_team_period_start: quota.team.period_start,
    p_actor_max: quota.actor ? quota.actor.max : null,
    p_actor_period_start: quota.actor ? quota.actor.period_start : null,
  };
}

/**
 * Reserva del análisis profundo. Usa `psi_claim_agt003_lead_analysis_v2` (equipo + persona, migración 118). Si la
 * migración no está aplicada, cae a `psi_claim_agt003_lead_analysis` (114) con el cupo del equipo de la configuración y
 * su inicio de periodo en Bogotá (falla abierta, sin cupo por persona) y lo avisa con console.warn.
 * Devuelve el objeto de la RPC: { status, id?, used?, max?, scope? }.
 */
export async function claimLeadAnalysis(database, { opportunityId, actorId, profileHash, contractVersion, quota }) {
  const params = quotaParams(quota, actorId);
  const base = { p_opportunity_id: opportunityId, p_profile_hash: profileHash, p_contract_version: contractVersion };
  const v2 = await database.rpc('psi_claim_agt003_lead_analysis_v2', { ...base, ...params });
  if (!v2.error) return v2.data;
  if (!isMissingRpcError(v2.error)) throw v2.error;
  console.warn('agt003_quota_rpc_fallback', { rpc: 'psi_claim_agt003_lead_analysis_v2', reason: 'missing' });
  if (quota.team.max < 1) return { status: 'quota', scope: 'team', used: 0, max: quota.team.max };
  const v1 = await database.rpc('psi_claim_agt003_lead_analysis', {
    ...base, p_actor_id: actorId, p_monthly_max: quota.team.max, p_month_start: quota.team.period_start,
  });
  if (v1.error) throw v1.error;
  return v1.data && v1.data.status === 'quota' ? { ...v1.data, scope: 'team' } : v1.data;
}

/**
 * Reserva del copiloto. Usa `psi_claim_agt003_copilot_run_v2` (equipo + persona en hora de Bogotá, migración 117). Si
 * la migración no está aplicada, cae a `psi_claim_agt003_copilot_run` (043) con el tope del equipo leído de la
 * configuración como tope diario (esa RPC cuenta por día UTC; falla abierta, sin cupo por persona) y avisa.
 */
export async function claimCopilotRunWithQuota(database, { idempotencyKey, actorId, quota, maxConcurrent, leaseSeconds }) {
  const params = quotaParams(quota, actorId);
  const v2 = await database.rpc('psi_claim_agt003_copilot_run_v2', {
    p_idempotency_key: idempotencyKey,
    ...params,
    p_max_concurrent: maxConcurrent,
    p_lease_seconds: leaseSeconds,
  });
  if (!v2.error) return v2.data;
  if (!isMissingRpcError(v2.error)) throw v2.error;
  console.warn('agt003_quota_rpc_fallback', { rpc: 'psi_claim_agt003_copilot_run_v2', reason: 'missing' });
  if (quota.team.max < 1) return { status: 'quota', scope: 'team' };
  const v1 = await database.rpc('psi_claim_agt003_copilot_run', {
    p_idempotency_key: idempotencyKey,
    p_daily_max_runs: quota.team.max,
    p_max_concurrent: maxConcurrent,
    p_lease_seconds: leaseSeconds,
  });
  if (v1.error) throw v1.error;
  return v1.data && v1.data.status === 'quota' ? { ...v1.data, scope: 'team' } : v1.data;
}

/** Perfil de uso de IA de una persona (columna `ai_usage_profile`, migración 119). Sin columna o con error → null. */
export async function readActorAiUsageProfile(database, profileId) {
  try {
    const { data, error } = await database.from('psi_sales_profiles').select('ai_usage_profile').eq('id', profileId).maybeSingle();
    if (error) {
      if (error.code !== '42703' && error.code !== 'PGRST204') console.warn('agt003_ai_usage_profile_unavailable', { code: error.code || null });
      return null;
    }
    const value = data?.ai_usage_profile;
    return typeof value === 'string' && /^[a-z][a-z0-9_]{1,40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export const AGT003_QUOTA_TIMEZONE = CONFIGURATION_TIMEZONE;
export { AGT003_AGENT_ID };
