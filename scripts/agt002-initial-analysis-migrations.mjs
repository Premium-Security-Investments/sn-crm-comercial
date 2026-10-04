import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export const MIGRATION_ORDER = Object.freeze(['099', '100', '101', '102', '103', '104']);
export const ROLLBACK_ORDER = Object.freeze([...MIGRATION_ORDER].reverse());

const FILES = Object.freeze({
  '099': '099_agt002_evidence_packages.sql',
  '100': '100_agt002_initial_workflow_and_g1.sql',
  '101': '101_agt002_initial_analysis_jobs.sql',
  '102': '102_agt002_initial_analysis_canonical_persistence.sql',
  '103': '103_agt002_initial_analysis_atomic_admission.sql',
  '104': '104_agt002_initial_analysis_server_owned_execution.sql',
});

const TABLES = Object.freeze([
  'psi_agt002_evidence_packages',
  'psi_agt002_evidence_package_versions',
  'psi_agt002_evidence_package_members',
  'psi_agt002_evidence_package_batches',
  'psi_agt002_workflow_instances',
  'psi_agt002_workflow_events',
  'psi_agt002_analysis_authorizations',
  'psi_agt002_initial_analysis_jobs',
  'psi_agt002_initial_analysis_checkpoints',
  'psi_agt002_initial_analysis_run_lineage',
  'psi_agt002_pre_go_analysis_versions',
]);

const SERVICE_FUNCTIONS = Object.freeze([
  'psi_resolve_agt002_evidence_package_candidate(uuid,uuid,uuid)',
  'psi_freeze_agt002_evidence_package(uuid,uuid,text,jsonb,text,text,text,uuid)',
  'psi_append_agt002_workflow_event(uuid,text,uuid,text,text,text,text,jsonb,jsonb,timestamp with time zone,uuid,text)',
  'psi_create_agt002_workflow_instance(uuid,uuid,text,text,uuid,text,text,uuid)',
  'psi_grant_agt002_g1_analysis_authorization(uuid,uuid,text,timestamp with time zone,text,uuid)',
  'psi_consume_agt002_analysis_authorization(uuid,uuid,uuid,uuid,uuid,text,text,uuid)',
  'psi_claim_agt002_initial_analysis_job(text,integer)',
  'psi_renew_agt002_initial_analysis_job_lease(uuid,uuid,integer,integer)',
  'psi_store_agt002_initial_analysis_checkpoint(uuid,uuid,integer,integer,text,text,jsonb,text,jsonb)',
  'psi_load_agt002_initial_analysis_checkpoint(uuid,integer,text)',
  'psi_complete_agt002_initial_analysis_job(uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,text)',
  'psi_fail_agt002_initial_analysis_job(uuid,uuid,integer,text)',
  'psi_admit_authorized_agt002_initial_analysis_job(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid)',
]);

const LEGACY_ADMISSION = 'psi_admit_agt002_initial_analysis_job(uuid,uuid,text,jsonb,text)';
const AUDITED_FUNCTIONS = Object.freeze([...SERVICE_FUNCTIONS, LEGACY_ADMISSION]);
const q = value => `'${value.replaceAll("'", "''")}'`;
const allTables = names => names.map(name => `to_regclass('public.${name}') is not null`).join(' and ');
const allFunctions = signatures => signatures.map(signature => `to_regprocedure('public.${signature}') is not null`).join(' and ');

const MARKERS = Object.freeze({
  m099: `(${allTables(TABLES.slice(0, 4))} and ${allFunctions(SERVICE_FUNCTIONS.slice(0, 2))})`,
  m100: `(${allTables(TABLES.slice(4, 7))} and ${allFunctions(SERVICE_FUNCTIONS.slice(2, 6))})`,
  m101: `(${allTables(TABLES.slice(7, 8))} and ${allFunctions([
    LEGACY_ADMISSION,
    ...SERVICE_FUNCTIONS.slice(6, 8),
  ])})`,
  m102: `(${allTables(TABLES.slice(8))} and ${allFunctions(SERVICE_FUNCTIONS.slice(8, 12))}
    and exists (select 1 from information_schema.columns where table_schema='public' and table_name='psi_tender_analysis_runs' and column_name='analysis_kind')
    and exists (select 1 from information_schema.columns where table_schema='public' and table_name='psi_agt002_initial_analysis_jobs' and column_name='analysis_run_id'))`,
  m103: `(to_regprocedure('public.${SERVICE_FUNCTIONS[12]}') is not null
    and (to_regprocedure('public.${LEGACY_ADMISSION}') is null
      or not has_function_privilege('service_role', to_regprocedure('public.${LEGACY_ADMISSION}'), 'EXECUTE')))`,
  m104: `(exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.${SERVICE_FUNCTIONS[12]}')
    and pg_get_functiondef(p.oid) like '%analysisRunId%'
    and pg_get_functiondef(p.oid) like '%sourceBatchIndexes%'))`,
});

const tableList = TABLES.map(q).join(', ');
const functionOids = SERVICE_FUNCTIONS.map(signature => `to_regprocedure('public.${signature}')`).join(', ');
const auditedFunctionOids = AUDITED_FUNCTIONS.map(signature => `to_regprocedure('public.${signature}')`).join(', ');
const MISSING_PREREQUISITES_EXPR = `(
  (not exists (select 1 from pg_roles where rolname='service_role'))::int
  + (not exists (select 1 from pg_roles where rolname='authenticated'))::int
  + (not exists (select 1 from pg_roles where rolname='anon'))::int
  + (to_regclass('public.psi_sales_opportunities') is null)::int
  + (to_regclass('public.psi_public_tenders') is null)::int
  + (to_regclass('public.psi_sales_profiles') is null)::int
  + (to_regclass('public.psi_profile_permissions') is null)::int
  + (to_regclass('public.psi_access_permissions') is null)::int
  + (to_regclass('public.psi_tender_document_versions') is null)::int
  + (to_regclass('public.psi_tender_document_extractions') is null)::int
  + (to_regclass('public.psi_tender_analysis_runs') is null)::int
)`;

export const PREREQUISITES_SQL = `-- AGT002_INITIAL_RUNNER:PREREQUISITES
select ${MISSING_PREREQUISITES_EXPR}::int as missing_prerequisites;`;

export const STATE_SQL = `-- AGT002_INITIAL_RUNNER:STATE
select
  ${MARKERS.m099} as m099,
  ${MARKERS.m100} as m100,
  ${MARKERS.m101} as m101,
  ${MARKERS.m102} as m102,
  ${MARKERS.m103} as m103,
  ${MARKERS.m104} as m104,
  (select count(*)::int from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) a
    left join pg_roles r on r.oid=a.grantee
    where n.nspname='public' and c.relname in (${tableList})
      and (a.grantee=0 or lower(r.rolname) in ('anon','authenticated')))::int
  + (select count(*)::int from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
    left join pg_roles r on r.oid=a.grantee
    where p.oid = any(array[${auditedFunctionOids}]) and a.privilege_type='EXECUTE'
      and (a.grantee=0 or lower(r.rolname) in ('anon','authenticated')))::int as unsafe_grants,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (${tableList}) and not c.relrowsecurity)::int as rls_missing,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (${tableList})
      and not has_table_privilege('service_role', c.oid, 'SELECT'))::int
  + (select count(*)::int from unnest(array[${functionOids}]) fn(oid)
    where fn.oid is not null and not has_function_privilege('service_role', fn.oid, 'EXECUTE'))::int
  + (case when to_regprocedure('public.${LEGACY_ADMISSION}') is not null
      and has_function_privilege('service_role', to_regprocedure('public.${LEGACY_ADMISSION}'), 'EXECUTE')
    then 1 else 0 end)::int as missing_service_access;`;

const asBool = value => value === true || value === 'true' || value === 't' || value === 1 || value === '1';

export function classifyChainState(row) {
  const values = MIGRATION_ORDER.map(id => asBool(row?.[`m${id}`]));
  const firstFalse = values.indexOf(false);
  const hasGap = firstFalse >= 0 && values.slice(firstFalse + 1).some(Boolean);
  const insecure = Number(row?.unsafe_grants || 0) !== 0
    || Number(row?.rls_missing || 0) !== 0
    || Number(row?.missing_service_access || 0) !== 0;
  if (hasGap || insecure) return 'drift';
  if (firstFalse === 0) return 'absent';
  if (firstFalse > 0) return 'partial';
  return 'applied';
}

export function stripTopLevelTransactionWrapper(sql) {
  const lines = sql.split(/\r?\n/);
  const begins = [];
  const commits = [];
  lines.forEach((line, index) => {
    if (/^begin\s*;$/i.test(line.trim())) begins.push(index);
    if (/^commit\s*;$/i.test(line.trim())) commits.push(index);
  });
  if (begins.length === 0 && commits.length === 0) return sql;
  let first = 0;
  while (first < lines.length && /^\s*(--.*)?$/.test(lines[first])) first += 1;
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last -= 1;
  if (begins.length !== 1 || commits.length !== 1 || begins[0] !== first || commits[0] !== last || last <= first) {
    throw new Error('INITIAL migration runner: wrapper transaccional top-level inesperado; abortando fail-closed.');
  }
  return [...lines.slice(0, first), ...lines.slice(first + 1, last), ...lines.slice(last + 1)].join('\n').trim();
}

const markerSnapshotPredicate = row => MIGRATION_ORDER
  .map(id => `(${MARKERS[`m${id}`]}) is ${asBool(row?.[`m${id}`]) ? 'true' : 'false'}`)
  .join(' and ');

const loadMigrations = () => Object.fromEntries(MIGRATION_ORDER.map(id => [
  id,
  readFileSync(resolve(root, 'supabase/migrations', FILES[id]), 'utf8'),
]));

const loadRollbacks = () => Object.fromEntries(ROLLBACK_ORDER.map(id => [
  id,
  readFileSync(resolve(root, 'supabase/rollbacks', FILES[id].replace('.sql', '_rollback.sql')), 'utf8'),
]));

export function buildAtomicApplySql(migrations, observed) {
  const pending = MIGRATION_ORDER.filter(id => !asBool(observed?.[`m${id}`]));
  return `-- AGT002_INITIAL_RUNNER:ATOMIC_APPLY
do $agt002_initial_apply$
begin
  perform pg_advisory_xact_lock(hashtextextended('agt002-initial-analysis-migrations-099-104', 0));
  if ${MISSING_PREREQUISITES_EXPR} <> 0 then
    raise exception 'AGT002_INITIAL_PREREQUISITES_CHANGED';
  end if;
  if not (${markerSnapshotPredicate(observed)}) then
    raise exception 'AGT002_INITIAL_STATE_CHANGED';
  end if;
end
$agt002_initial_apply$;
${pending.map(id => `-- AGT002_INITIAL_MIGRATION:${id}\n${stripTopLevelTransactionWrapper(migrations[id])}`).join('\n')}`;
}

export function buildAtomicRollbackSql(rollbacks) {
  return `-- AGT002_INITIAL_RUNNER:ATOMIC_ROLLBACK
do $agt002_initial_rollback$
begin
  perform pg_advisory_xact_lock(hashtextextended('agt002-initial-analysis-migrations-099-104', 0));
  if not (${MIGRATION_ORDER.map(id => MARKERS[`m${id}`]).join(' and ')}) then
    raise exception 'AGT002_INITIAL_ROLLBACK_STATE_DRIFT';
  end if;
end
$agt002_initial_rollback$;
${ROLLBACK_ORDER.map(id => `-- AGT002_INITIAL_ROLLBACK:${id}\n${stripTopLevelTransactionWrapper(rollbacks[id])}`).join('\n')}`;
}

export async function readState(execSql) {
  const [row] = await execSql(STATE_SQL);
  if (!row) throw new Error('No se pudo leer el estado de migraciones INITIAL.');
  const status = classifyChainState(row);
  const evidence = {
    status,
    migrations: Object.fromEntries(MIGRATION_ORDER.map(id => [id, asBool(row[`m${id}`])])),
    unsafe_grants: Number(row.unsafe_grants || 0),
    rls_missing: Number(row.rls_missing || 0),
    missing_service_access: Number(row.missing_service_access || 0),
  };
  console.log(`STATE ${JSON.stringify(evidence)}`);
  return evidence;
}

export async function preflight(execSql) {
  const [prerequisites] = await execSql(PREREQUISITES_SQL);
  if (Number(prerequisites?.missing_prerequisites) !== 0) {
    throw new Error('Preflight INITIAL falló: faltan prerrequisitos; abortando fail-closed.');
  }
  const current = await readState(execSql);
  if (current.status === 'drift') throw new Error('Preflight INITIAL detectó drift; no se aplicará SQL.');
  console.log('PREFLIGHT_OK');
  return current;
}

export async function verify(execSql) {
  const current = await readState(execSql);
  if (current.status !== 'applied') throw new Error(`Verificación INITIAL falló: estado ${current.status}; se esperaba applied.`);
  console.log('VERIFY_OK');
  return current;
}

export async function apply(execSql) {
  const current = await preflight(execSql);
  if (current.status === 'applied') return { ...current, skipped: true };
  const observed = Object.fromEntries(MIGRATION_ORDER.map(id => [`m${id}`, current.migrations[id]]));
  await execSql(buildAtomicApplySql(loadMigrations(), observed));
  const result = await verify(execSql);
  console.log('APPLY_OK');
  return result;
}

export async function rollback(execSql) {
  const current = await verify(execSql);
  await execSql(buildAtomicRollbackSql(loadRollbacks()));
  const finalState = await readState(execSql);
  if (finalState.status !== 'absent') throw new Error(`Rollback INITIAL no quedó absent: ${finalState.status}.`);
  console.log('ROLLBACK_OK');
  return { ok: true, previous: current.status, status: finalState.status };
}

function loadEnvFile(path) {
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    process.env[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}

export function createExecSql({ fetchImpl = fetch, envPath, baseUrl, serviceKey } = {}) {
  let base = baseUrl;
  let key = serviceKey;
  if (!base || !key) {
    loadEnvFile(envPath || process.env.ENV_FILE || resolve(root, '.env.local'));
    base ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
    key ||= process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (!base || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  const endpoint = `${base.replace(/\/$/, '')}/rest/v1/rpc/exec_sql`;
  return async sql => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: sql.trim().replace(/;\s*$/, '') }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || (payload.rows !== null && !Array.isArray(payload.rows))) {
      const marker = String(payload?.error || '').match(/AGT002_[A-Z0-9_]+/)?.[0];
      const error = new Error(marker || `exec_sql rechazó la operación (HTTP ${response.status}).`);
      error.sqlstate = typeof payload?.sqlstate === 'string' ? payload.sqlstate : undefined;
      throw error;
    }
    return payload.rows === null ? [] : payload.rows;
  };
}

async function main() {
  const mode = process.argv[2] || 'state';
  const execSql = createExecSql();
  if (mode === 'state') await readState(execSql);
  else if (mode === 'preflight') await preflight(execSql);
  else if (mode === 'apply') await apply(execSql);
  else if (mode === 'verify') await verify(execSql);
  else if (mode === 'rollback') await rollback(execSql);
  else throw new Error('Modo inválido. Use state, preflight, apply, verify o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) {
  main().catch(error => {
    process.exitCode = 1;
    console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim());
  });
}
