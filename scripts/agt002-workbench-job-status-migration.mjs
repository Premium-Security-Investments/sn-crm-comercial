import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// Migración 070 y su reversa. Una sola migración por corrida (dominio AGT-002 Mesa).
// 070 reemplaza EXACTAMENTE una función (la lectura gobernada de la Mesa) para exponer el
// último evento de cada trabajo; no toca tablas, columnas, índices, triggers ni permisos.
export const MIGRATION_FILE = '070_agt002_workbench_job_status.sql';
export const ROLLBACK_FILE = '070_agt002_workbench_job_status_rollback.sql';

// Marca del cuerpo de la función: `pg_get_functiondef` la devuelve porque vive dentro del
// cuerpo PL/pgSQL. Es lo que permite detectar el estado de 070 sin tocar dato alguno y sin
// depender de una tabla de migraciones que este repositorio no usa.
export const FUNCTION_MARKER = 'agt002_workbench_job_status_v1';
export const PROJECTION_MARKER = 'latest_event_type';

export const READ_RPC_SIGNATURE = 'psi_get_agt002_workbench(uuid,uuid)';

// Tablas de 045 que 070 debe encontrar intactas antes y después de aplicarse.
const WORKBENCH_TABLES = Object.freeze([
  'psi_agt002_workbench_threads',
  'psi_agt002_workbench_messages',
  'psi_agt002_workbench_message_links',
  'psi_agt002_workbench_jobs',
  'psi_agt002_workbench_job_events',
  'psi_agt002_workbench_required_actions',
  'psi_agt002_learning_proposals',
  'psi_agt002_learning_decisions',
]);

// Los otros 7 RPC de servicio de 045/046: 070 no puede alterarlos ni hacerlos desaparecer.
const UNTOUCHED_RPC_SIGNATURES = Object.freeze([
  'psi_get_or_create_agt002_workbench_thread(uuid,uuid)',
  'psi_append_agt002_workbench_message(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text,uuid,uuid)',
  'psi_retry_agt002_workbench_job(uuid,uuid,uuid)',
  'psi_review_agt002_learning_proposal(uuid,uuid,uuid,text,text,text)',
  'psi_claim_agt002_workbench_job(text,integer,integer,integer)',
  'psi_append_agt002_workbench_job_event(uuid,uuid,text,jsonb)',
  'psi_complete_agt002_workbench_job(uuid,uuid,uuid,jsonb)',
]);

// Tipos de evento que el log append-only admite (045) y que la capa JS sabe mapear.
const KNOWN_EVENT_TYPES = Object.freeze(['queued', 'released', 'claimed', 'completed', 'failed', 'stale']);

const sqlList = values => values.map(value => `('${value}')`).join(',');

// Mismo despojo de begin;/commit; de nivel superior que los demás runners: exec_sql ejecuta
// el SQL con EXECUTE dentro de un cuerpo PL/pgSQL, que no admite sentencias de control de
// transacción. Falla cerrado (throws) ante cualquier forma que no sea exactamente un único
// begin;/commit; envolvente, sin enviar nada al RPC.
export function stripTopLevelTransactionWrapper(sql) {
  const lines = sql.split(/\r?\n/);
  const beginLineIdxs = [];
  const commitLineIdxs = [];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (/^begin\s*;$/i.test(trimmed)) beginLineIdxs.push(idx);
    if (/^commit\s*;$/i.test(trimmed)) commitLineIdxs.push(idx);
  });

  if (beginLineIdxs.length === 0 && commitLineIdxs.length === 0) return sql;

  let firstContentIdx = 0;
  while (firstContentIdx < lines.length && /^\s*(--.*)?$/.test(lines[firstContentIdx])) firstContentIdx++;
  let lastContentIdx = lines.length - 1;
  while (lastContentIdx >= 0 && lines[lastContentIdx].trim() === '') lastContentIdx--;

  const wellFormed = beginLineIdxs.length === 1 && commitLineIdxs.length === 1
    && beginLineIdxs[0] === firstContentIdx && commitLineIdxs[0] === lastContentIdx
    && commitLineIdxs[0] > beginLineIdxs[0];

  if (!wellFormed) {
    throw new Error('exec_sql normalization: formato inesperado. Se esperaba exactamente un "begin;" como primera sentencia y un "commit;" como última sentencia; abortando en modo cerrado sin enviar nada a RPC.');
  }

  return [
    ...lines.slice(0, beginLineIdxs[0]),
    ...lines.slice(beginLineIdxs[0] + 1, commitLineIdxs[0]),
    ...lines.slice(commitLineIdxs[0] + 1),
  ].join('\n').trim();
}

export function readMigrationSql() {
  return stripTopLevelTransactionWrapper(readFileSync(resolve(root, 'supabase/migrations', MIGRATION_FILE), 'utf8'));
}

export function readRollbackSql() {
  return stripTopLevelTransactionWrapper(readFileSync(resolve(root, 'supabase/rollbacks', ROLLBACK_FILE), 'utf8'));
}

function dbBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function dbInt(value) {
  return Number.parseInt(value, 10) || 0;
}

// ---------------------------------------------------------------------------
// Preflight (sólo lectura). Exige la superficie 045 sobre la que 070 se apoya —en
// particular el log de eventos y su índice de cursor— y clasifica el estado de 070.
// Aborta ante cualquier estado parcial o ante 045 ausente/incompleta.
// ---------------------------------------------------------------------------

const PREREQ_045_SQL = `
select
  (select count(*) from (values ${sqlList(WORKBENCH_TABLES)}) as v(t)
     where to_regclass('public.'||t) is not null) as tables_present,
  (select count(*) from (values ${sqlList([READ_RPC_SIGNATURE, ...UNTOUCHED_RPC_SIGNATURES])}) as v(sig)
     where to_regprocedure('public.'||sig) is not null) as rpc_present,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='psi_agt002_workbench_job_events'
       and column_name in ('id','job_id','event_type','created_at')) as event_columns,
  (to_regclass('public.psi_agt002_workbench_job_events_cursor_idx') is not null) as idx_cursor;
`;

export function prerequisitesOk(row) {
  return dbInt(row.tables_present) === WORKBENCH_TABLES.length
    && dbInt(row.rpc_present) === UNTOUCHED_RPC_SIGNATURES.length + 1
    && dbInt(row.event_columns) === 4
    && dbBool(row.idx_cursor);
}

const STATE_070_SQL = `
select
  (to_regprocedure('public.${READ_RPC_SIGNATURE}') is not null) as fn_present,
  coalesce(pg_get_functiondef(to_regprocedure('public.${READ_RPC_SIGNATURE}')::oid) like '%${FUNCTION_MARKER}%',false) as marker_present,
  coalesce(pg_get_functiondef(to_regprocedure('public.${READ_RPC_SIGNATURE}')::oid) like '%${PROJECTION_MARKER}%',false) as projection_present;
`;

// absent | applied | partial. `partial` sólo puede darse si alguien editó la función a mano
// (marca sin proyección o proyección sin marca): se aborta y se exige intervención humana.
export function classifyState(row) {
  if (!dbBool(row.fn_present)) return 'partial';
  const marker = dbBool(row.marker_present);
  const projection = dbBool(row.projection_present);
  if (marker && projection) return 'applied';
  if (!marker && !projection) return 'absent';
  return 'partial';
}

export async function detectState(execSql) {
  const [row = {}] = await execSql(STATE_070_SQL);
  return classifyState(row);
}

export async function preflight(execSql) {
  const [prereq = {}] = await execSql(PREREQ_045_SQL);
  if (!prerequisitesOk(prereq)) {
    throw new Error('Prerrequisitos de la migración 045 (tablas de la Mesa, log de eventos, índice de cursor y RPC de servicio) ausentes o incompletos; abortando en modo cerrado (fail closed).');
  }
  const state = await detectState(execSql);
  if (state === 'partial') {
    throw new Error('Estado 070 PARCIAL: psi_get_agt002_workbench no coincide ni con 045 ni con 070. Abortando en modo cerrado; requiere intervención manual.');
  }
  return { state, prereq };
}

// ---------------------------------------------------------------------------
// Apply. Una sola llamada exec_sql con el 070 normalizado, atómica en el servidor
// (exec_sql envuelve la sentencia en su propia transacción). Sólo desde `absent`;
// desde `applied` es no-op. Siempre termina verificando.
// ---------------------------------------------------------------------------

export async function apply(execSql) {
  const { state } = await preflight(execSql);
  if (state === 'applied') {
    console.log('APPLY_NOOP');
    const noop = await verify(execSql);
    if (!noop.ok) throw new Error(`VERIFY_FAILED sobre 070 ya aplicada. ${describeVerifyFailure(noop)}`);
    return noop;
  }
  await execSql(readMigrationSql());
  console.log('APPLY_OK');
  const result = await verify(execSql);
  // El detalle importa: sin él, un fallo de verificación tras aplicar obliga a adivinar cuál
  // de las invariantes (definición, security definer, search_path, ACL o proyección) cedió.
  if (!result.ok) throw new Error(`VERIFY_FAILED tras apply. ${describeVerifyFailure(result)}`);
  return result;
}

// ---------------------------------------------------------------------------
// Verify (sólo lectura). Definición (marca + proyección), propiedades de seguridad
// (security definer, search_path, ACL de sólo service_role) y superficie 045 intacta.
// ---------------------------------------------------------------------------

const VERIFY_SQL = `
with t(name) as (values ${sqlList(WORKBENCH_TABLES)}),
u(sig) as (values ${sqlList(UNTOUCHED_RPC_SIGNATURES)}),
f as (select to_regprocedure('public.${READ_RPC_SIGNATURE}')::oid as oid)
select
  (select count(*) from t where to_regclass('public.'||name) is not null) as tables_present,
  (select count(*) from u where to_regprocedure('public.'||sig) is not null) as untouched_rpc_present,
  (select count(*) from u where to_regprocedure('public.'||sig) is not null
     and has_function_privilege('service_role','public.'||sig,'EXECUTE')) as untouched_rpc_service_exec,
  ((select oid from f) is not null) as fn_present,
  coalesce((select pg_get_functiondef(oid) from f) like '%${FUNCTION_MARKER}%',false) as marker_present,
  coalesce((select pg_get_functiondef(oid) from f) like '%${PROJECTION_MARKER}%',false) as projection_present,
  coalesce((select p.prosecdef from pg_proc p, f where p.oid=f.oid),false) as security_definer,
  coalesce((select p.provolatile='s' from pg_proc p, f where p.oid=f.oid),false) as stable_volatility,
  -- proconfig normaliza el separador ("search_path=public, pg_temp"), así que se compara
  -- tolerando el espacio en vez de exigir la cadena literal de la migración.
  coalesce((select exists(select 1 from unnest(p.proconfig) c
     where c ~ '^search_path=public,\\s*pg_temp$') from pg_proc p, f where p.oid=f.oid),false) as search_path_set,
  (select has_function_privilege('service_role','public.${READ_RPC_SIGNATURE}','EXECUTE')) as service_exec,
  (select count(*) from (values ('anon'),('authenticated')) r(role)
     where has_function_privilege(r.role,'public.${READ_RPC_SIGNATURE}','EXECUTE')) as role_exec,
  -- proacl NULL implica EXECUTE implícito de PUBLIC: cuenta como fuga.
  coalesce((select p.proacl is null
     or exists (select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')
     from pg_proc p, f where p.oid=f.oid),true) as public_exec;
`;

export function verifyOk(row) {
  return dbInt(row.tables_present) === WORKBENCH_TABLES.length
    && dbInt(row.untouched_rpc_present) === UNTOUCHED_RPC_SIGNATURES.length
    && dbInt(row.untouched_rpc_service_exec) === UNTOUCHED_RPC_SIGNATURES.length
    && dbBool(row.fn_present)
    && dbBool(row.marker_present)
    && dbBool(row.projection_present)
    && dbBool(row.security_definer)
    && dbBool(row.stable_volatility)
    && dbBool(row.search_path_set)
    && dbBool(row.service_exec)
    && dbInt(row.role_exec) === 0
    && !dbBool(row.public_exec);
}

// Comprobación funcional de la proyección, SÓLO de lectura y sin invocar el RPC (invocarlo
// exigiría una oportunidad con GO y un actor autorizado reales, es decir, efectos y datos de
// producción). Reproduce sobre los datos reales el mismo `order by created_at desc, id desc
// limit 1` que 070 y comprueba las dos invariantes que hacen correcta la proyección:
//   1) el lateral no pierde ni duplica trabajos (LEFT JOIN: un trabajo por fila),
//   2) ningún último evento cae fuera del conjunto que la capa JS sabe mapear.
// `jobs_without_event` se OBSERVA y se informa, pero no invalida la migración: un trabajo sin
// evento es una anomalía de datos (045 inserta `queued` en la misma transacción que el
// trabajo), y la proyección ya lo trata conservadoramente sirviéndolo con evento nulo. Con
// cero trabajos la comprobación es trivialmente correcta.
const PROJECTION_SQL = `
with latest as (
  select j.id as job_id, e.event_type
  from public.psi_agt002_workbench_jobs j
  left join lateral (
    select ev.event_type from public.psi_agt002_workbench_job_events ev
    where ev.job_id=j.id order by ev.created_at desc, ev.id desc limit 1
  ) e on true
)
select
  (select count(*) from public.psi_agt002_workbench_jobs) as jobs_total,
  (select count(*) from latest) as projected_rows,
  (select count(distinct job_id) from latest) as projected_jobs,
  (select count(*) from latest where event_type is null) as jobs_without_event,
  (select count(*) from latest where event_type is not null
     and event_type not in (${KNOWN_EVENT_TYPES.map(type => `'${type}'`).join(',')})) as unmapped_events;
`;

export function projectionOk(row) {
  const total = dbInt(row.jobs_total);
  return dbInt(row.projected_rows) === total
    && dbInt(row.projected_jobs) === total
    && dbInt(row.unmapped_events) === 0;
}

export async function checkProjection(execSql) {
  const [row = {}] = await execSql(PROJECTION_SQL);
  return { ok: projectionOk(row), row };
}

export async function verify(execSql) {
  const [row = {}] = await execSql(VERIFY_SQL);
  const definition = verifyOk(row);
  const projection = await checkProjection(execSql);
  const ok = definition && projection.ok;
  if (ok) {
    console.log('VERIFY_OK');
    if (dbInt(projection.row.jobs_without_event) > 0) {
      // Anomalía de datos, no fallo de migración: se informa para que sea investigable.
      console.log(`VERIFY_NOTE jobs_without_event=${dbInt(projection.row.jobs_without_event)}`);
    }
  }
  return { ok, row, projection: projection.row };
}

/**
 * Resumen seguro de una verificación fallida para el operador: sólo booleanos y conteos de
 * catálogo (definición, propiedades de seguridad, ACL y proyección). No contiene ninguna
 * fila de negocio, identificador de expediente ni secreto, así que puede imprimirse en el
 * log de una corrida de producción tal cual.
 */
export function describeVerifyFailure(result) {
  return JSON.stringify({ definition: result?.row || {}, projection: result?.projection || {} });
}

// ---------------------------------------------------------------------------
// Verify absent: 070 revertida (función restaurada a 045, sin marca ni proyección),
// con la misma ACL de sólo service_role y la superficie 045 intacta.
// ---------------------------------------------------------------------------

export function verifyAbsentOk(row) {
  return dbInt(row.tables_present) === WORKBENCH_TABLES.length
    && dbInt(row.untouched_rpc_present) === UNTOUCHED_RPC_SIGNATURES.length
    && dbBool(row.fn_present)
    && !dbBool(row.marker_present)
    && !dbBool(row.projection_present)
    && dbBool(row.security_definer)
    && dbBool(row.stable_volatility)
    && dbBool(row.search_path_set)
    && dbBool(row.service_exec)
    && dbInt(row.role_exec) === 0
    && !dbBool(row.public_exec);
}

export async function verifyAbsent(execSql) {
  const [row = {}] = await execSql(VERIFY_SQL);
  const ok = verifyAbsentOk(row);
  if (ok) console.log('VERIFY_ABSENT_OK');
  return { ok, row };
}

// ---------------------------------------------------------------------------
// Conteo de evidencia (sólo lectura). 070 no toca dato alguno, así que la reversa debe
// dejar EXACTAMENTE los mismos conteos: se miden antes y después como comprobación.
// ---------------------------------------------------------------------------

const EVIDENCE_SQL = `
select
  (select count(*) from public.psi_agt002_workbench_threads) as threads,
  (select count(*) from public.psi_agt002_workbench_messages) as messages,
  (select count(*) from public.psi_agt002_workbench_jobs) as jobs,
  (select count(*) from public.psi_agt002_workbench_job_events) as job_events,
  (select count(*) from public.psi_agt002_learning_proposals) as proposals,
  (select count(*) from public.psi_agt002_learning_decisions) as decisions;
`;

export async function countEvidence(execSql) {
  const [row = {}] = await execSql(EVIDENCE_SQL);
  return Object.fromEntries(
    ['threads', 'messages', 'jobs', 'job_events', 'proposals', 'decisions'].map(key => [key, dbInt(row[key])]),
  );
}

export function sameEvidence(before, after) {
  return Object.keys(before).every(key => before[key] === after[key]);
}

// ---------------------------------------------------------------------------
// Rollback. Sólo desde `applied` (desde `absent` es no-op; `partial` ya abortó en
// preflight). No destruye evidencia por construcción, y se comprueba comparando conteos.
// ---------------------------------------------------------------------------

export async function rollback(execSql) {
  const { state } = await preflight(execSql);
  if (state === 'absent') {
    console.log('ROLLBACK_NOOP');
    const res = await verifyAbsent(execSql);
    if (!res.ok) throw new Error('ROLLBACK_NOOP: el estado no clasifica como 045 esperado.');
    return res;
  }
  const before = await countEvidence(execSql);
  await execSql(readRollbackSql());
  console.log('ROLLBACK_OK');
  const after = await countEvidence(execSql);
  if (!sameEvidence(before, after)) {
    throw new Error(`ROLLBACK_FAILED: la reversa alteró evidencia AGT-002 (antes ${JSON.stringify(before)}, después ${JSON.stringify(after)}).`);
  }
  const res = await verifyAbsent(execSql);
  if (!res.ok) throw new Error('ROLLBACK_FAILED: el estado posterior no verifica como 045 restaurada con ACL intacta.');
  return res;
}

// ---------------------------------------------------------------------------
// exec_sql inyectable: única vía a exec_sql es este RPC. Nunca imprime secretos.
// ---------------------------------------------------------------------------

function loadEnvFile(envPath) {
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

export function createExecSql({ fetchImpl = fetch, envPath, baseUrl, serviceKey } = {}) {
  let base = baseUrl;
  let key = serviceKey;
  if (!base || !key) {
    loadEnvFile(envPath || process.env.ENV_FILE || resolve(root, '.env.local'));
    base = base || process.env.NEXT_PUBLIC_SUPABASE_URL;
    key = key || process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (!base || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  const endpoint = `${base.replace(/\/$/, '')}/rest/v1/rpc/exec_sql`;

  return async function execSql(sql) {
    const normalized = sql.trim().replace(/;\s*$/, '');
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: normalized }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      const error = new Error(payload?.error || `exec_sql HTTP ${response.status}`);
      error.sqlstate = payload?.sqlstate;
      throw error;
    }
    return Array.isArray(payload.rows) ? payload.rows : [];
  };
}

async function main() {
  const mode = process.argv[2] || 'preflight';
  const execSql = createExecSql();
  if (mode === 'preflight') {
    const { state } = await preflight(execSql);
    console.log(`PREFLIGHT_OK state=${state}`);
  } else if (mode === 'apply') {
    await apply(execSql);
  } else if (mode === 'verify') {
    const res = await verify(execSql);
    if (!res.ok) throw new Error(`VERIFY_FAILED. ${describeVerifyFailure(res)}`);
  } else if (mode === 'rollback') {
    await rollback(execSql);
  } else {
    throw new Error('Modo inválido. Use preflight, apply, verify o rollback.');
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) {
  main().catch(error => {
    if (!process.exitCode) process.exitCode = 1;
    console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim());
  });
}
