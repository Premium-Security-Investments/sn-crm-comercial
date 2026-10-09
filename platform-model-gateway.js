// Puerta única de modelos — Paso 1: registro central (Fase 2 de la Plataforma de Agentes, Juan Botero 2026-10-09).
//
// Envuelve el `run()` del cliente del puente de Vig-IA sin cambiar su comportamiento ni sus errores: mide la latencia
// y deja un evento por uso en `platform.model_usage_event` llamando a `platform.record_model_usage(...)`.
//
// Reglas:
// - Sólo metadatos: agente, capacidad, ambiente, proveedor, modelo, estado, código de falla, latencia, tokens, costo
//   equivalente, id de correlación y hora. NUNCA la entrada, la salida, la política/prompt ni datos del cliente.
// - Mejor esfuerzo: el registro nunca hace fallar ni demora más de ~2 s la respuesta al usuario. Sin
//   PLATFORM_GATEWAY_DATABASE_URL no registra nada. Los errores sólo van a `console.warn`, sin datos sensibles.
// - SSL obligatorio (mismo patrón que platform-agents.js) y pool pequeño reutilizable entre invocaciones.
import pg from 'pg';
import { platformConnectionString, platformSslConfig } from './platform-agents.js';
import { estimateLeadAnalysisCostUsd } from './src/vigia/lead-analysis.js';

export const MODEL_GATEWAY_RECORD_TIMEOUT_MS = 1500;
export const MODEL_GATEWAY_PROVIDER = 'claude_subscription';
export const AGT003_AGENT_ID = 'AGT-003';
export const AGT003_COPILOT_CAPABILITY = 'agt003.opportunity-copilot.preview';
export const AGT003_LEAD_ANALYSIS_CAPABILITY = 'agt003.lead-deep-analysis';

export const RECORD_MODEL_USAGE_SQL = 'select platform.record_model_usage($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)';

// Rechazos que no llegan al proveedor: el puente ocupado (lo dice el propio puente) y los topes del CRM.
export const MODEL_GATEWAY_REJECTION_CODES = Object.freeze(new Set([
  'AGT003_BRIDGE_BUSY',
  'VIGIA_COPILOT_QUOTA',
  'VIGIA_COPILOT_SATURATED',
  'AGT003_LEAD_ANALYSIS_QUOTA',
]));

const FAILURE_CODE = /^[A-Z0-9_]{1,96}$/;
const CORRELATION_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const CAPABILITY = /^agt00[0-6][.][a-z0-9][a-z0-9_.-]{0,118}$/;
const UNKNOWN_FAILURE = 'MODEL_GATEWAY_UNKNOWN_ERROR';

/** Código de falla en el formato del libro (`^[A-Z0-9_]{1,96}$`). */
export function normalizeFailureCode(value) {
  const raw = typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 96) : '';
  return FAILURE_CODE.test(raw) ? raw : UNKNOWN_FAILURE;
}

/** Id de correlación seguro o null (nunca se inventa uno a partir de datos del cliente). */
export function safeCorrelationId(value) {
  return typeof value === 'string' && CORRELATION_ID.test(value) ? value : null;
}

/** Ambiente del libro: `VERCEL_ENV` (production/preview/development) o `production`. */
export function gatewayEnvironment(env = process.env) {
  const value = typeof env?.VERCEL_ENV === 'string' ? env.VERCEL_ENV.trim().toLowerCase() : '';
  return /^[a-z0-9_-]{1,32}$/.test(value) ? value : 'production';
}

function tokenOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function modelOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 128);
  return trimmed ? trimmed : null;
}

/** Costo equivalente (misma tarifa del análisis profundo) para cualquier capacidad; null sin tokens. */
export function costUsdEquivalent(usage) {
  const input = tokenOrNull(usage?.input_tokens);
  const output = tokenOrNull(usage?.output_tokens);
  if (input === null || output === null) return null;
  return estimateLeadAnalysisCostUsd({ input_tokens: input, output_tokens: output });
}

/**
 * Construye el evento con la lista cerrada de campos del libro. Cualquier otra propiedad del llamador se ignora: así
 * es imposible que el contenido del modelo o del cliente llegue al registro.
 */
export function buildModelUsageEvent({
  agentId = AGT003_AGENT_ID, capability, environment, model, status, failureCode, latencyMs, usage, correlationId, occurredAt,
} = {}) {
  if (typeof capability !== 'string' || !CAPABILITY.test(capability)) throw new Error('Capacidad de modelo no válida.');
  if (!['completed', 'failed', 'rejected'].includes(status)) throw new Error('Estado de uso de modelo no válido.');
  const latency = Number.isFinite(latencyMs) ? Math.min(3_600_000, Math.max(0, Math.round(latencyMs))) : null;
  return {
    agent_id: agentId,
    capability,
    environment: environment || gatewayEnvironment(),
    provider: MODEL_GATEWAY_PROVIDER,
    model: modelOrNull(model),
    status,
    failure_code: status === 'completed' ? null : normalizeFailureCode(failureCode),
    latency_ms: latency,
    input_tokens: status === 'completed' ? tokenOrNull(usage?.input_tokens) : null,
    output_tokens: status === 'completed' ? tokenOrNull(usage?.output_tokens) : null,
    cost_usd_equivalent: status === 'completed' ? costUsdEquivalent(usage) : null,
    correlation_id: safeCorrelationId(correlationId),
    occurred_at: (occurredAt instanceof Date ? occurredAt : new Date()).toISOString(),
  };
}

export function modelUsageParams(event) {
  return [
    event.agent_id, event.capability, event.environment, event.provider, event.model, event.status, event.failure_code,
    event.latency_ms, event.input_tokens, event.output_tokens, event.cost_usd_equivalent, event.correlation_id, event.occurred_at,
  ];
}

let cachedPool = null;
let cachedPoolKey = null;

function getGatewayPool(env = process.env) {
  const connectionString = platformConnectionString(env.PLATFORM_GATEWAY_DATABASE_URL);
  if (!connectionString) return null;
  if (cachedPool && cachedPoolKey === connectionString) return cachedPool;
  if (cachedPool) cachedPool.end().catch(() => {});
  const pool = new pg.Pool({
    connectionString,
    ssl: platformSslConfig(env),
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: MODEL_GATEWAY_RECORD_TIMEOUT_MS,
    statement_timeout: MODEL_GATEWAY_RECORD_TIMEOUT_MS,
    query_timeout: MODEL_GATEWAY_RECORD_TIMEOUT_MS,
    application_name: 'siio-model-gateway',
  });
  pool.on('error', () => {});
  cachedPool = pool;
  cachedPoolKey = connectionString;
  return pool;
}

/**
 * Registra un evento. Nunca lanza y nunca tarda más que `timeoutMs` (el registro sigue en segundo plano si se pasa).
 * Devuelve `recorded` | `skipped` | `failed` | `timeout` sólo para pruebas y observabilidad local.
 */
export async function recordModelUsage(event, { env = process.env, pool, timeoutMs = MODEL_GATEWAY_RECORD_TIMEOUT_MS } = {}) {
  let target;
  try { target = pool || getGatewayPool(env); } catch { target = null; }
  if (!target) return 'skipped';
  let timer;
  const write = Promise.resolve()
    .then(() => target.query(RECORD_MODEL_USAGE_SQL, modelUsageParams(event)))
    .then(() => 'recorded', error => {
      console.warn('platform_model_usage_not_recorded', { capability: event?.capability || null, status: event?.status || null, code: typeof error?.code === 'string' ? error.code.slice(0, 16) : null });
      return 'failed';
    });
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      console.warn('platform_model_usage_not_recorded', { capability: event?.capability || null, status: event?.status || null, code: 'timeout' });
      resolve('timeout');
    }, timeoutMs);
  });
  try {
    return await Promise.race([write, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function safeRecord(recordUsage, fields) {
  try {
    await recordUsage(buildModelUsageEvent(fields));
  } catch {
    console.warn('platform_model_usage_not_recorded', { capability: fields?.capability || null, status: fields?.status || null, code: 'build' });
  }
}

/** Registra un rechazo (tope agotado, puente ocupado) sin llamar al modelo. Nunca lanza. */
export async function recordModelRejection({ capability, model, failureCode, correlationId, env = process.env, recordUsage } = {}) {
  const record = recordUsage || (event => recordModelUsage(event, { env }));
  await safeRecord(record, { capability, environment: gatewayEnvironment(env), model, status: 'rejected', failureCode, latencyMs: null, correlationId });
}

/**
 * Envuelve un cliente del puente (`{ run }`). El resultado y los errores del puente se devuelven tal cual.
 * `recordUsage(event)` permite inyectar un doble en pruebas.
 */
export function createModelGatewayClient({ client, capability, agentId = AGT003_AGENT_ID, env = process.env, recordUsage, now = () => Date.now() } = {}) {
  if (!client || typeof client.run !== 'function') throw new Error('La puerta de modelos requiere un cliente con run().');
  if (typeof capability !== 'string' || !CAPABILITY.test(capability)) throw new Error('Capacidad de modelo no válida.');
  const record = recordUsage || (event => recordModelUsage(event, { env }));
  const environment = gatewayEnvironment(env);
  return {
    async run(options = {}) {
      const startedAt = now();
      const base = { agentId, capability, environment, model: options?.model, correlationId: options?.idempotencyKey };
      let result;
      try {
        result = await client.run(options);
      } catch (error) {
        const code = normalizeFailureCode(error?.code);
        await safeRecord(record, {
          ...base,
          status: MODEL_GATEWAY_REJECTION_CODES.has(code) ? 'rejected' : 'failed',
          failureCode: code,
          latencyMs: now() - startedAt,
        });
        throw error;
      }
      await safeRecord(record, { ...base, status: 'completed', latencyMs: now() - startedAt, usage: result?.usage });
      return result;
    },
  };
}
