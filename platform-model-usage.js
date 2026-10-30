// IT → Agentes → "Uso de IA": lectura del libro de uso de modelos (`platform.model_usage_event`) de la Plataforma de
// Agentes. Sólo lectura con PLATFORM_DATABASE_URL (rol `platform_siio_reader`), transacción `read only`, timeout de
// 5 s y falla cerrada con el mismo mensaje neutro de la vista de agentes. Día y mes en hora de Bogotá.
//
// "Usos" = llamadas que llegaron al modelo (completadas + fallidas). Los rechazos (tope agotado, puente ocupado) se
// cuentan aparte porque nunca llamaron al modelo. El costo es "equivalente": se usa la suscripción, no se paga por token.
import {
  PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS,
  getPlatformPool,
  platformUnavailableError,
} from './platform-agents.js';
import { AGT003_AGENT_ID, AGT003_COPILOT_CAPABILITY, AGT003_LEAD_ANALYSIS_CAPABILITY } from './platform-model-gateway.js';
import {
  AGT003_MODEL_FAILURE_CODES,
  AGT003_MODEL_FAILURE_IT_TEXT,
  AGT003_SHARED_FAILURE_CATEGORIES,
  classifyAgt003ModelFailure,
} from './src/vigia/model-failures.js';

export const MODEL_USAGE_SERIES_DAYS = 14;
const DEFAULT_COPILOT_DAILY_MAX = 20;
const DEFAULT_LEAD_ANALYSIS_MONTHLY_MAX = 30;

// Ventanas en hora de Bogotá. `$1` es el instante de referencia (para pruebas y para que todo use el mismo "ahora").
export const PLATFORM_MODEL_USAGE_SUMMARY_SQL = `with bounds as (
  select date_trunc('day', $1::timestamptz at time zone 'America/Bogota') at time zone 'America/Bogota' as day_start,
         date_trunc('month', $1::timestamptz at time zone 'America/Bogota') at time zone 'America/Bogota' as month_start,
         $1::timestamptz - interval '7 days' as week_start
)
select e.agent_id, e.capability,
       count(*) filter (where e.status <> 'rejected' and e.occurred_at >= b.day_start)::int as uses_today,
       count(*) filter (where e.status <> 'rejected' and e.occurred_at >= b.month_start)::int as uses_month,
       count(*) filter (where e.status = 'completed' and e.occurred_at >= b.week_start)::int as completed_7d,
       count(*) filter (where e.status = 'failed' and e.occurred_at >= b.week_start)::int as failed_7d,
       count(*) filter (where e.status = 'rejected' and e.occurred_at >= b.week_start)::int as rejected_7d,
       count(*) filter (where e.status = 'rejected' and e.failure_code like '%QUOTA' and e.occurred_at >= b.week_start)::int as quota_rejected_7d,
       count(*) filter (where e.failure_code like '%SESSION_LIMIT' and e.occurred_at >= b.week_start)::int as session_limit_7d,
       round(avg(e.latency_ms) filter (where e.status <> 'rejected' and e.occurred_at >= b.week_start))::int as avg_latency_ms_7d,
       max(e.occurred_at) filter (where e.status <> 'rejected') as last_used_at,
       coalesce(sum(e.input_tokens) filter (where e.occurred_at >= b.month_start), 0)::bigint as input_tokens_month,
       coalesce(sum(e.output_tokens) filter (where e.occurred_at >= b.month_start), 0)::bigint as output_tokens_month,
       coalesce(sum(e.cost_usd_equivalent) filter (where e.occurred_at >= b.month_start), 0)::numeric(12, 6) as cost_usd_month
  from platform.model_usage_event e
  cross join bounds b
 group by e.agent_id, e.capability
 order by e.agent_id, e.capability`;

export const PLATFORM_MODEL_USAGE_DAILY_SQL = `with bounds as (
  select (date_trunc('day', $1::timestamptz at time zone 'America/Bogota') - interval '13 days') at time zone 'America/Bogota' as series_start
)
select e.agent_id, e.capability,
       to_char((e.occurred_at at time zone 'America/Bogota')::date, 'YYYY-MM-DD') as day,
       count(*) filter (where e.status <> 'rejected')::int as uses,
       count(*) filter (where e.status = 'rejected')::int as rejected
  from platform.model_usage_event e
  cross join bounds b
 where e.occurred_at >= b.series_start
 group by 1, 2, 3
 order by 1, 2, 3`;

// Paso 3 — avisos de fallas del puente o del modelo. Una fila por agente + capacidad + estado + código en los últimos 7
// días: fallidos (con su código) y completados (para saber si hubo un uso exitoso después de la falla). Los rechazos
// (cupo, función apagada, puente ocupado) no son fallas y no entran.
export const MODEL_ALERTS_WINDOW_DAYS = 7;
export const PLATFORM_MODEL_ALERTS_SQL = `select e.agent_id, e.capability, e.status, e.failure_code,
       count(*) filter (where e.occurred_at >= $1::timestamptz - interval '24 hours')::int as count_24h,
       count(*)::int as count_7d,
       max(e.occurred_at) as last_at
  from platform.model_usage_event e
 where e.status in ('failed', 'completed')
   and e.occurred_at >= $1::timestamptz - interval '7 days'
 group by e.agent_id, e.capability, e.status, e.failure_code
 order by e.agent_id, e.capability, e.status, e.failure_code`;

function timeOf(value) {
  const iso = isoOrNull(value);
  return iso ? Date.parse(iso) : null;
}

/**
 * Avisos de IT → Agentes a partir de las filas de PLATFORM_MODEL_ALERTS_SQL, agrupados por agente y categoría.
 * - Categoría: la de src/vigia/model-failures.js (también reclasifica los códigos crudos que el Paso 1 guardó antes).
 * - Activo: no hubo un uso exitoso posterior a la última falla. Sesión vencida, puente caído y límite de la suscripción
 *   se resuelven con un uso exitoso de cualquier función del agente; "otro error" sólo con uno de la misma función.
 * - Se listan los activos y los que pasaron en las últimas 24 h (aunque ya se hayan resuelto).
 */
export function presentModelAlerts(rows = []) {
  const lastSuccessByCapability = new Map();
  const lastSuccessByAgent = new Map();
  const groups = new Map();
  for (const row of rows) {
    const agentId = String(row.agent_id);
    const capability = String(row.capability);
    const lastAt = timeOf(row.last_at);
    if (lastAt === null) continue;
    if (row.status === 'completed') {
      const key = `${agentId}\u0000${capability}`;
      lastSuccessByCapability.set(key, Math.max(lastSuccessByCapability.get(key) ?? 0, lastAt));
      lastSuccessByAgent.set(agentId, Math.max(lastSuccessByAgent.get(agentId) ?? 0, lastAt));
      continue;
    }
    if (row.status !== 'failed') continue;
    const category = classifyAgt003ModelFailure(row.failure_code);
    if (!category) continue;
    const id = `${agentId}\u0000${category}`;
    if (!groups.has(id)) groups.set(id, { agentId, category, count24h: 0, count7d: 0, lastAt: 0, byCapability: new Map() });
    const group = groups.get(id);
    group.count24h += count(row.count_24h);
    group.count7d += count(row.count_7d);
    group.lastAt = Math.max(group.lastAt, lastAt);
    group.byCapability.set(capability, Math.max(group.byCapability.get(capability) ?? 0, lastAt));
  }
  const alerts = [];
  for (const group of groups.values()) {
    const shared = AGT003_SHARED_FAILURE_CATEGORIES.includes(group.category);
    const lastSuccessAt = shared
      ? lastSuccessByAgent.get(group.agentId) ?? null
      : Math.max(0, ...[...group.byCapability.keys()].map(capability => lastSuccessByCapability.get(`${group.agentId}\u0000${capability}`) ?? 0)) || null;
    const active = shared
      ? !(lastSuccessAt && lastSuccessAt > group.lastAt)
      : [...group.byCapability.entries()].some(([capability, failedAt]) => !((lastSuccessByCapability.get(`${group.agentId}\u0000${capability}`) ?? 0) > failedAt));
    if (!active && group.count24h === 0) continue;
    const text = AGT003_MODEL_FAILURE_IT_TEXT[group.category];
    alerts.push({
      agent_id: group.agentId,
      category: group.category,
      title: text.title,
      help: text.help,
      functions: [...group.byCapability.keys()].sort().map(capability => MODEL_CAPABILITY_LABELS[capability] || 'Otra función'),
      count_24h: group.count24h,
      count_7d: group.count7d,
      last_at: new Date(group.lastAt).toISOString(),
      last_success_at: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
      active,
    });
  }
  const order = category => AGT003_MODEL_FAILURE_CODES.indexOf(category);
  return alerts.sort((a, b) => Number(b.active) - Number(a.active) || Date.parse(b.last_at) - Date.parse(a.last_at) || order(a.category) - order(b.category));
}

export const MODEL_CAPABILITY_LABELS = Object.freeze({
  [AGT003_COPILOT_CAPABILITY]: 'Próximo seguimiento',
  [AGT003_LEAD_ANALYSIS_CAPABILITY]: 'Análisis profundo',
});

function positiveIntFrom(env, key, fallback) {
  const value = Number(env?.[key]);
  return Number.isInteger(value) && value > 0 && value <= 100_000 ? value : fallback;
}

/** Topes conocidos del CRM para cada capacidad (los mismos que aplica la reserva de cupo). */
export function knownModelLimits(env = process.env) {
  return {
    [AGT003_COPILOT_CAPABILITY]: { period: 'day', max: positiveIntFrom(env, 'AGT003_COPILOT_DAILY_MAX_RUNS', DEFAULT_COPILOT_DAILY_MAX) },
    [AGT003_LEAD_ANALYSIS_CAPABILITY]: { period: 'month', max: positiveIntFrom(env, 'AGT003_LEAD_ANALYSIS_MONTHLY_MAX', DEFAULT_LEAD_ANALYSIS_MONTHLY_MAX) },
  };
}

const bogotaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Los 14 días (Bogotá) que terminan hoy, del más antiguo al más reciente. */
export function bogotaSeriesDays(now = new Date(), days = MODEL_USAGE_SERIES_DAYS) {
  const today = bogotaDay.format(now);
  const base = Date.parse(`${today}T12:00:00Z`);
  return Array.from({ length: days }, (_, index) => new Date(base - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10));
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 10_000) / 10_000 : 0;
}

function isoOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Arma la respuesta pública: siempre incluye las capacidades conocidas de AGT-003 (en cero si no hay eventos). */
// `limits` (opcional): topes vigentes por capacidad `{ period, max, source: 'configuration'|'code', version_number }`
// (configuración aprobada en la plataforma). Sin ellos, los topes conocidos del código/entorno.
export function presentModelUsage({ rows = [], dailyRows = [], alertRows = [], now = new Date(), env = process.env, limits: currentLimits } = {}) {
  const limits = currentLimits || Object.fromEntries(Object.entries(knownModelLimits(env)).map(([capability, limit]) => [capability, { ...limit, source: 'code', version_number: null }]));
  const days = bogotaSeriesDays(now);
  const key = (agentId, capability) => `${agentId}\u0000${capability}`;
  const summaries = new Map();
  const ensure = (agentId, capability) => {
    const id = key(agentId, capability);
    if (!summaries.has(id)) {
      summaries.set(id, {
        agent_id: agentId,
        capability,
        label: MODEL_CAPABILITY_LABELS[capability] || capability,
        limit: limits[capability] || null,
        today: 0,
        month: 0,
        last_7_days: { completed: 0, failed: 0, rejected: 0, quota_rejected: 0, session_limit: 0 },
        avg_latency_ms: null,
        last_used_at: null,
        month_tokens: { input: 0, output: 0 },
        month_cost_usd_equivalent: 0,
        daily: new Map(days.map(day => [day, { day, uses: 0, rejected: 0 }])),
      });
    }
    return summaries.get(id);
  };
  ensure(AGT003_AGENT_ID, AGT003_COPILOT_CAPABILITY);
  ensure(AGT003_AGENT_ID, AGT003_LEAD_ANALYSIS_CAPABILITY);
  for (const row of rows) {
    const item = ensure(String(row.agent_id), String(row.capability));
    item.today = count(row.uses_today);
    item.month = count(row.uses_month);
    item.last_7_days = {
      completed: count(row.completed_7d),
      failed: count(row.failed_7d),
      rejected: count(row.rejected_7d),
      quota_rejected: count(row.quota_rejected_7d),
      session_limit: count(row.session_limit_7d),
    };
    item.avg_latency_ms = row.avg_latency_ms_7d == null ? null : count(row.avg_latency_ms_7d);
    item.last_used_at = isoOrNull(row.last_used_at);
    item.month_tokens = { input: count(row.input_tokens_month), output: count(row.output_tokens_month) };
    item.month_cost_usd_equivalent = money(row.cost_usd_month);
  }
  for (const row of dailyRows) {
    const item = ensure(String(row.agent_id), String(row.capability));
    const point = item.daily.get(String(row.day));
    if (point) { point.uses = count(row.uses); point.rejected = count(row.rejected); }
  }
  return {
    generated_at: now.toISOString(),
    // Día de referencia de los conteos "hoy" (hora de Bogotá).
    today: bogotaDay.format(now),
    has_data: rows.length > 0 || dailyRows.length > 0,
    cost_note: 'Costo equivalente: se usa la suscripción de Claude; es lo que costaría por tokens, no un cobro.',
    // Veces que se tocó el límite de la suscripción (código de falla *_SESSION_LIMIT) en 7 días, todos los agentes.
    session_limit_7d: [...summaries.values()].reduce((total, item) => total + item.last_7_days.session_limit, 0),
    capabilities: [...summaries.values()].map(item => ({ ...item, daily: [...item.daily.values()] })),
    // Paso 3: fallas recientes del puente o del modelo por categoría (activas = sin uso exitoso posterior).
    alerts: presentModelAlerts(alertRows),
  };
}

export async function readPlatformModelUsage(pool, { now = new Date(), env = process.env, limits } = {}) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    console.warn('platform_model_usage_unavailable', { stage: 'connect', code: error?.code || null });
    throw platformUnavailableError();
  }
  let failed = null;
  try {
    await client.query('begin read only');
    await client.query(`set local statement_timeout = ${PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS}`);
    const reference = now.toISOString();
    const summary = await client.query(PLATFORM_MODEL_USAGE_SUMMARY_SQL, [reference]);
    const daily = await client.query(PLATFORM_MODEL_USAGE_DAILY_SQL, [reference]);
    const alerts = await client.query(PLATFORM_MODEL_ALERTS_SQL, [reference]);
    await client.query('commit');
    return presentModelUsage({ rows: summary.rows || [], dailyRows: daily.rows || [], alertRows: alerts.rows || [], now, env, limits });
  } catch (error) {
    failed = error;
    await client.query('rollback').catch(() => {});
    console.warn('platform_model_usage_unavailable', { stage: 'query', code: error?.code || null });
    throw platformUnavailableError();
  } finally {
    client.release(failed ? true : undefined);
  }
}

export async function listPlatformModelUsage({ env = process.env, pool, now = new Date(), limits } = {}) {
  return readPlatformModelUsage(pool || getPlatformPool(env), { now, env, limits });
}

/** Topes vigentes por capacidad a partir de la configuración efectiva (plataforma o valores del código). */
export function limitsFromEffectiveConfiguration(effective, env = process.env) {
  const fallback = knownModelLimits(env);
  const out = {};
  for (const [capability, limit] of Object.entries(fallback)) {
    const team = effective?.configuration?.capabilities?.[capability]?.team_cap;
    const fromPlatform = effective?.source === 'platform' && team && (team.per === 'day' || team.per === 'month') && Number.isInteger(team.max);
    out[capability] = fromPlatform
      ? { period: team.per, max: team.max, source: 'configuration', version_number: effective.version_number ?? null, enabled: effective.configuration.capabilities[capability].enabled !== false }
      : { ...limit, source: 'code', version_number: null, enabled: true };
  }
  return out;
}
