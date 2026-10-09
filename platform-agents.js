// Lectura de la Plataforma de Agentes (otra base de datos, esquema `platform`) para la vista IT → Agentes.
// Sólo lectura: transacción `read only`, statement_timeout de 5 s y un pool pequeño reutilizable entre invocaciones.
// Falla cerrada: sin PLATFORM_DATABASE_URL o ante cualquier error de la plataforma responde un único mensaje neutro,
// sin cadena de conexión, host ni detalle interno.
import pg from 'pg';

export const PLATFORM_AGENTS_UNAVAILABLE_MESSAGE = 'La plataforma de agentes no está conectada.';
export const PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS = 5000;
const PLATFORM_UNAVAILABLE_CODE = 'PLATFORM_AGENTS_UNAVAILABLE';

export const PLATFORM_AGENTS_SQL = `select r.agent_id, r.namespace, r.display_name, r.lifecycle_state, r.active,
       r.created_at, r.updated_at, r.retired_at,
       (select count(*) from platform.agent_policy_version p where p.agent_id = r.agent_id)::int as policy_versions,
       (select count(*) from platform.agent_configuration_version c where c.agent_id = r.agent_id)::int as configuration_versions,
       (select count(*) from platform.agent_run_open_event e where e.agent_id = r.agent_id)::int as open_runs
  from platform.agent_registry r
 order by r.agent_id`;

// Parámetros de la URL que podrían desactivar o rebajar TLS: se quitan para que el `ssl` del pool sea la única fuente.
const SSL_URL_PARAMS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword', 'uselibpqcompat'];

export function platformUnavailableError() {
  const error = new Error(PLATFORM_AGENTS_UNAVAILABLE_MESSAGE);
  error.status = 503;
  error.code = PLATFORM_UNAVAILABLE_CODE;
  return error;
}

export function isPlatformAgentsUnavailable(error) {
  return error?.code === PLATFORM_UNAVAILABLE_CODE;
}

export function platformConnectionString(rawUrl) {
  const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
  for (const param of SSL_URL_PARAMS) url.searchParams.delete(param);
  return url.toString();
}

// SSL siempre activo. Si se entrega la CA de la plataforma (PLATFORM_DATABASE_CA, PEM) se verifica el certificado;
// sin ella el canal va cifrado pero sin verificación de la cadena (la CA de Supabase no es pública).
export function platformSslConfig(env = process.env) {
  const ca = typeof env.PLATFORM_DATABASE_CA === 'string' && env.PLATFORM_DATABASE_CA.trim() ? env.PLATFORM_DATABASE_CA : null;
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };
}

let cachedPool = null;
let cachedPoolKey = null;

function getPlatformPool(env = process.env) {
  const connectionString = platformConnectionString(env.PLATFORM_DATABASE_URL);
  if (!connectionString) throw platformUnavailableError();
  if (cachedPool && cachedPoolKey === connectionString) return cachedPool;
  if (cachedPool) cachedPool.end().catch(() => {});
  const pool = new pg.Pool({
    connectionString,
    ssl: platformSslConfig(env),
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS,
    statement_timeout: PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS,
    application_name: 'siio-it-agentes',
  });
  // Un cliente inactivo que se cae no debe tumbar el proceso.
  pool.on('error', () => {});
  cachedPool = pool;
  cachedPoolKey = connectionString;
  return pool;
}

function isoOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function countOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

export function presentPlatformAgent(row) {
  return {
    id: String(row.agent_id),
    namespace: row.namespace == null ? null : String(row.namespace),
    name: row.display_name == null ? String(row.agent_id) : String(row.display_name),
    state: row.lifecycle_state == null ? null : String(row.lifecycle_state),
    active: row.active === true,
    created_at: isoOrNull(row.created_at),
    updated_at: isoOrNull(row.updated_at),
    retired_at: isoOrNull(row.retired_at),
    counts: {
      policy_versions: countOf(row.policy_versions),
      configuration_versions: countOf(row.configuration_versions),
      open_runs: countOf(row.open_runs),
    },
  };
}

export async function readPlatformAgents(pool) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    console.warn('platform_agents_unavailable', { stage: 'connect', code: error?.code || null });
    throw platformUnavailableError();
  }
  let failed = null;
  try {
    await client.query('begin read only');
    await client.query(`set local statement_timeout = ${PLATFORM_AGENTS_STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(PLATFORM_AGENTS_SQL);
    await client.query('commit');
    return { agents: (result.rows || []).map(presentPlatformAgent) };
  } catch (error) {
    failed = error;
    await client.query('rollback').catch(() => {});
    console.warn('platform_agents_unavailable', { stage: 'query', code: error?.code || null });
    throw platformUnavailableError();
  } finally {
    // Un cliente que falló se descarta en vez de volver al pool.
    client.release(failed ? true : undefined);
  }
}

export async function listPlatformAgents({ env = process.env, pool } = {}) {
  return readPlatformAgents(pool || getPlatformPool(env));
}
