// Puerta única de modelos — Paso 2 (parte 3): la configuración APROBADA y vigente de la Plataforma de Agentes gobierna
// de verdad el modelo y los cupos de cada función con IA.
//
// Lectura: `platform.current_agent_configuration` con PLATFORM_DATABASE_URL (rol sólo lectura), transacción `read only`.
// Caché en memoria por instancia de ~60 s por (agente, ambiente).
//
// Falla abierta (acordada con el dueño, 2026-10-09):
// - Si la plataforma no responde (o tarda más de ~2 s), se usa la última configuración conocida EN ESTA INSTANCIA; si
//   nunca la tuvo, los valores del código (`defaultAgentConfiguration` + los topes de entorno conocidos: hoy 20/día y
//   30/mes, modelo del entorno).
// - Si la versión leída no pasa la validación, se ignora con `console.warn` y se siguen usando los valores previos
//   (la última conocida o los del código).
// - Si la plataforma responde que no hay versión vigente, rigen los valores del código.
import { agentAiFunctions, defaultAgentConfiguration, normalizeProposedConfiguration, platformConfigurationReaderPool, readOnly } from './platform-agent-configuration.js';
import { knownModelLimits } from './platform-model-usage.js';
import { gatewayEnvironment } from './platform-model-gateway.js';

export const EFFECTIVE_CONFIGURATION_TTL_MS = 60_000;
export const EFFECTIVE_CONFIGURATION_READ_TIMEOUT_MS = 2_000;

export const CURRENT_AGENT_CONFIGURATION_SQL = `select configuration_version_id::text as configuration_version_id, version_number, configuration
  from platform.current_agent_configuration
 where agent_id = $1 and environment = $2
 limit 1`;

const PROFILE_KEY = /^[a-z][a-z0-9_]{1,40}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Valida una configuración YA APROBADA leída de la plataforma, con las mismas reglas de forma que una propuesta
 * (`normalizeProposedConfiguration`), salvo dos contextos que no aplican al leer: los perfiles y personas se aceptan
 * si tienen el formato correcto (la plataforma ya los validó al aprobar) y una excepción vencida no invalida la versión
 * (simplemente deja de aplicar). Lanza si algo no tiene el formato esperado.
 */
export function normalizeApprovedConfiguration(raw, agentId) {
  let value = raw;
  if (typeof value === 'string') value = JSON.parse(value);
  if (!isPlainObject(value)) throw new Error('La configuración vigente no tiene el formato esperado.');
  const profileIds = new Set();
  const personIds = new Set();
  for (const capability of Object.values(isPlainObject(value.capabilities) ? value.capabilities : {})) {
    if (!isPlainObject(capability)) continue;
    for (const key of Object.keys(isPlainObject(capability.profile_caps) ? capability.profile_caps : {})) if (PROFILE_KEY.test(key)) profileIds.add(key);
    for (const exception of Array.isArray(capability.exceptions) ? capability.exceptions : []) {
      if (isPlainObject(exception) && typeof exception.person === 'string') personIds.add(exception.person);
    }
  }
  return normalizeProposedConfiguration(value, { agentId, profileIds, personIds, today: '0000-01-01' });
}

/** Valores del código: la misma configuración por defecto que muestra IT → Agentes (topes de entorno incluidos). */
export function codeDefaultEffectiveConfiguration(agentId, env = process.env) {
  return {
    source: 'code',
    agent_id: agentId,
    version_id: null,
    version_number: null,
    configuration: defaultAgentConfiguration(agentId, knownModelLimits(env)),
    stale: false,
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'EFFECTIVE_CONFIGURATION_TIMEOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Lector por defecto: una consulta de sólo lectura a la vista de la configuración vigente. Devuelve la fila o null. */
export async function readCurrentAgentConfigurationRow({ agentId, environment, env = process.env } = {}) {
  return readOnly(platformConfigurationReaderPool(env), 'platform_current_configuration_unavailable', async client => {
    const result = await client.query(CURRENT_AGENT_CONFIGURATION_SQL, [agentId, environment]);
    return result.rows?.[0] || null;
  });
}

/**
 * Crea un lector con caché. `readRow({ agentId, environment, env })` se puede inyectar en pruebas; `now()` también.
 * El estado (caché y última conocida) vive en el lector: uno por proceso en producción.
 */
export function createEffectiveConfigurationReader({
  readRow = readCurrentAgentConfigurationRow,
  ttlMs = EFFECTIVE_CONFIGURATION_TTL_MS,
  timeoutMs = EFFECTIVE_CONFIGURATION_READ_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();

  async function refresh(agentId, environment, env, entry) {
    const fallback = () => (entry.lastKnown ? { ...entry.lastKnown, stale: true } : { ...codeDefaultEffectiveConfiguration(agentId, env), stale: true });
    let row;
    try {
      row = await withTimeout(Promise.resolve().then(() => readRow({ agentId, environment, env })), timeoutMs);
    } catch (error) {
      console.warn('platform_effective_configuration_fallback', { agent_id: agentId, reason: 'unavailable', code: typeof error?.code === 'string' ? error.code.slice(0, 40) : null });
      return fallback();
    }
    if (!row) {
      entry.lastKnown = null;
      return codeDefaultEffectiveConfiguration(agentId, env);
    }
    try {
      const configuration = normalizeApprovedConfiguration(row.configuration, agentId);
      const value = {
        source: 'platform',
        agent_id: agentId,
        version_id: row.configuration_version_id == null ? null : String(row.configuration_version_id),
        version_number: Number.isFinite(Number(row.version_number)) ? Math.trunc(Number(row.version_number)) : null,
        configuration,
        stale: false,
      };
      entry.lastKnown = value;
      return value;
    } catch {
      console.warn('platform_effective_configuration_fallback', { agent_id: agentId, reason: 'invalid', version_id: row.configuration_version_id == null ? null : String(row.configuration_version_id).slice(0, 20) });
      return fallback();
    }
  }

  return {
    /** Configuración efectiva: `{ source: 'platform'|'code', version_id, version_number, configuration, stale }`. Nunca lanza. */
    async get(agentId, { env = process.env, environment = gatewayEnvironment(env) } = {}) {
      if (!agentAiFunctions(agentId).length) return null;
      const key = `${agentId}\u0000${environment}`;
      let entry = entries.get(key);
      if (!entry) { entry = { value: null, fetchedAt: 0, lastKnown: null, inflight: null }; entries.set(key, entry); }
      if (entry.value && now() - entry.fetchedAt < ttlMs) return entry.value;
      if (!entry.inflight) {
        entry.inflight = refresh(agentId, environment, env, entry)
          .catch(() => codeDefaultEffectiveConfiguration(agentId, env))
          .then(value => { entry.value = value; entry.fetchedAt = now(); return value; })
          .finally(() => { entry.inflight = null; });
      }
      return entry.inflight;
    },
    /** Sólo pruebas: olvida la caché (no la última conocida salvo `all`). */
    reset({ all = false } = {}) {
      if (all) entries.clear();
      else for (const entry of entries.values()) { entry.value = null; entry.fetchedAt = 0; }
    },
  };
}

let sharedReader = createEffectiveConfigurationReader();

/** Lector compartido del proceso. */
export function getEffectiveAgentConfiguration(agentId, options) {
  return sharedReader.get(agentId, options);
}

/** Sólo pruebas: reemplaza el lector compartido (null → uno nuevo con el lector por defecto). */
export function __setEffectiveConfigurationReaderForTests(reader) {
  sharedReader = reader || createEffectiveConfigurationReader();
}
