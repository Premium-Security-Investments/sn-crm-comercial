import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// Migración 045 y su reversa. Una sola migración por corrida (dominio AGT-002 Mesa).
export const MIGRATION_FILE = '045_agt002_dossier_workbench.sql';
export const ROLLBACK_FILE = '045_agt002_dossier_workbench_rollback.sql';

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

// Firmas exactas de los 8 RPC públicos que sólo service_role puede ejecutar.
const SERVICE_RPC_SIGNATURES = Object.freeze([
  'psi_get_or_create_agt002_workbench_thread(uuid,uuid)',
  'psi_append_agt002_workbench_message(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text,uuid,uuid)',
  'psi_get_agt002_workbench(uuid,uuid)',
  'psi_retry_agt002_workbench_job(uuid,uuid,uuid)',
  'psi_review_agt002_learning_proposal(uuid,uuid,uuid,text,text,text)',
  'psi_claim_agt002_workbench_job(text,integer,integer,integer)',
  'psi_append_agt002_workbench_job_event(uuid,uuid,text,jsonb)',
  'psi_complete_agt002_workbench_job(uuid,uuid,uuid,jsonb)',
]);

// RPC terminales legacy: se conservan como definición pero NADIE los ejecuta.
const LEGACY_RPC_SIGNATURES = Object.freeze([
  'psi_append_agt002_agent_result(uuid,uuid,uuid,jsonb)',
  'psi_append_agt002_agent_artifact_version(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)',
]);

// Mismo despojo de begin;/commit; de nivel superior que los demás runners:
// exec_sql ejecuta el SQL con EXECUTE dentro de un cuerpo PL/pgSQL, que no admite
// sentencias de control de transacción. Falla cerrado (throws) ante cualquier forma
// que no sea exactamente un único begin;/commit; envolvente, sin enviar nada al RPC.
export function stripTopLevelTransactionWrapper(sql) {
  const lines = sql.split(/\r?\n/);
  const beginLineIdxs = [];
  const commitLineIdxs = [];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (/^begin\s*;$/i.test(trimmed)) beginLineIdxs.push(idx);
    if (/^commit\s*;$/i.test(trimmed)) commitLineIdxs.push(idx);
  });

  if (beginLineIdxs.length === 0 && commitLineIdxs.length === 0) {
    return sql;
  }

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
// Preflight (sólo lectura). Prueba prerrequisitos 040, independencia AGT-003 044
// y clasifica el estado de 045. Aborta ante estado parcial. exec_sql sólo se
// alcanza a través del RPC inyectado (no se consulta pg_proc por exec_sql).
// ---------------------------------------------------------------------------

const PREREQ_040_SQL = `
select
  to_regclass('public.psi_sales_opportunities')::text as t_opportunities,
  to_regclass('public.psi_public_tenders')::text as t_tenders,
  to_regclass('public.psi_sales_profiles')::text as t_profiles,
  to_regclass('public.psi_access_permissions')::text as t_permissions,
  to_regclass('public.psi_profile_permissions')::text as t_profile_permissions,
  to_regclass('public.psi_tender_go_no_go_decisions')::text as t_go,
  to_regclass('public.psi_tender_dossier_artifacts')::text as t_artifacts,
  to_regclass('public.psi_tender_dossier_artifact_versions')::text as t_versions,
  to_regclass('public.psi_tender_dossier_artifact_reviews')::text as t_reviews,
  to_regprocedure('public.psi_assert_tender_dossier_go(uuid)')::text as fn_go,
  to_regprocedure('public.psi_assert_tender_dossier_actor(uuid,boolean)')::text as fn_actor,
  to_regprocedure('public.psi_project_tender_dossier_artifact(uuid)')::text as fn_project,
  to_regprocedure('public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text)')::text as fn_review,
  to_regprocedure('public.psi_add_tender_dossier_artifact_version(uuid,uuid,uuid,text,text,jsonb)')::text as fn_add_version,
  to_regprocedure('public.psi_create_tender_dossier_artifact(uuid,uuid,text,text,boolean)')::text as fn_create_artifact;
`;

export function prerequisitesOk(row) {
  return Object.values(row).every(Boolean);
}

const AGT003_SQL = `
select
  (select count(*) from public.psi_access_permissions where code='vigia_copilot_pilot' and active) as perm_active,
  (select count(*) from public.psi_profile_permissions where permission_code='vigia_copilot_pilot') as holders;
`;

export function agt003Ok(row) {
  return dbInt(row.perm_active) === 1 && dbInt(row.holders) === 1;
}

const STATE_045_SQL = `
select
  (select count(*) from (values
    ('psi_agt002_workbench_threads'),('psi_agt002_workbench_messages'),('psi_agt002_workbench_message_links'),
    ('psi_agt002_workbench_jobs'),('psi_agt002_workbench_job_events'),('psi_agt002_workbench_required_actions'),
    ('psi_agt002_learning_proposals'),('psi_agt002_learning_decisions')) as v(t)
    where to_regclass('public.'||t) is not null) as tables_present,
  (select count(*) from (values
    ('psi_get_or_create_agt002_workbench_thread(uuid,uuid)'),
    ('psi_append_agt002_workbench_message(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text,uuid,uuid)'),
    ('psi_get_agt002_workbench(uuid,uuid)'),
    ('psi_retry_agt002_workbench_job(uuid,uuid,uuid)'),
    ('psi_review_agt002_learning_proposal(uuid,uuid,uuid,text,text,text)'),
    ('psi_claim_agt002_workbench_job(text,integer,integer,integer)'),
    ('psi_append_agt002_workbench_job_event(uuid,uuid,text,jsonb)'),
    ('psi_complete_agt002_workbench_job(uuid,uuid,uuid,jsonb)')) as v(sig)
    where to_regprocedure('public.'||sig) is not null) as rpc_present,
  (to_regprocedure('public.psi_reject_agt002_workbench_mutation()') is not null) as trigger_fn_present,
  (exists (select 1 from information_schema.columns
     where table_schema='public' and table_name='psi_tender_dossier_artifact_versions' and column_name='author_kind')) as col_author_kind,
  (exists (select 1 from information_schema.columns
     where table_schema='public' and table_name='psi_tender_dossier_artifact_versions' and column_name='origin_agent_job_id')) as col_origin_job;
`;

// absent | applied | partial
export function classifyState(row) {
  const tables = dbInt(row.tables_present);
  const rpc = dbInt(row.rpc_present);
  const triggerFn = dbBool(row.trigger_fn_present);
  const authorKind = dbBool(row.col_author_kind);
  const originJob = dbBool(row.col_origin_job);

  const nothing = tables === 0 && rpc === 0 && !triggerFn && !authorKind && !originJob;
  const everything = tables === 8 && rpc === 8 && triggerFn && authorKind && originJob;
  if (nothing) return 'absent';
  if (everything) return 'applied';
  return 'partial';
}

export async function detectState(execSql) {
  const [row = {}] = await execSql(STATE_045_SQL);
  return classifyState(row);
}

export async function preflight(execSql) {
  const [prereq = {}] = await execSql(PREREQ_040_SQL);
  if (!prerequisitesOk(prereq)) {
    throw new Error('Prerrequisitos de la migración 040 ausentes; abortando en modo cerrado (fail closed).');
  }
  const [agt003 = {}] = await execSql(AGT003_SQL);
  if (!agt003Ok(agt003)) {
    throw new Error('El estado del piloto AGT-003 (migración 044) no está presente/independiente; abortando en modo cerrado.');
  }
  const state = await detectState(execSql);
  if (state === 'partial') {
    throw new Error('Estado 045 PARCIAL: la Mesa AGT-002 quedó a medio aplicar. Abortando en modo cerrado; requiere intervención manual.');
  }
  return { state, prereq, agt003 };
}

// ---------------------------------------------------------------------------
// Apply. Envía sólo el 045 normalizado en una sola llamada exec_sql y sólo desde
// estado absent; si ya está applied, no-op. Luego verify.
// ---------------------------------------------------------------------------

export async function apply(execSql) {
  const { state } = await preflight(execSql);
  if (state === 'applied') {
    console.log('APPLY_NOOP');
    return verify(execSql);
  }
  await execSql(readMigrationSql());
  console.log('APPLY_OK');
  return verify(execSql);
}

// ---------------------------------------------------------------------------
// Verify (sólo lectura). Prueba la superficie completa de 045 e independencia 044.
// ---------------------------------------------------------------------------

const VERIFY_SQL = `
with t(name) as (values
  ('psi_agt002_workbench_threads'),('psi_agt002_workbench_messages'),('psi_agt002_workbench_message_links'),
  ('psi_agt002_workbench_jobs'),('psi_agt002_workbench_job_events'),('psi_agt002_workbench_required_actions'),
  ('psi_agt002_learning_proposals'),('psi_agt002_learning_decisions')),
srpc(sig) as (values
  ('psi_get_or_create_agt002_workbench_thread(uuid,uuid)'),
  ('psi_append_agt002_workbench_message(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text,uuid,uuid)'),
  ('psi_get_agt002_workbench(uuid,uuid)'),
  ('psi_retry_agt002_workbench_job(uuid,uuid,uuid)'),
  ('psi_review_agt002_learning_proposal(uuid,uuid,uuid,text,text,text)'),
  ('psi_claim_agt002_workbench_job(text,integer,integer,integer)'),
  ('psi_append_agt002_workbench_job_event(uuid,uuid,text,jsonb)'),
  ('psi_complete_agt002_workbench_job(uuid,uuid,uuid,jsonb)')),
lrpc(sig) as (values
  ('psi_append_agt002_agent_result(uuid,uuid,uuid,jsonb)'),
  ('psi_append_agt002_agent_artifact_version(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)')),
idef(sig) as (values
  ('psi_project_tender_dossier_artifact(uuid)'),
  ('psi_assert_agt002_workbench_actor(uuid,boolean)'),
  ('psi_assert_agt002_workbench_agent(uuid)'),
  ('psi_assert_agt002_workbench_claim(uuid,uuid)'))
select
  (select count(*) from t where to_regclass('public.'||name) is not null) as tables_present,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relrowsecurity and c.relname in (select name from t)) as rls_enabled,
  (select count(*) from t
     cross join (values ('anon'),('authenticated')) r(role)
     cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
     where has_table_privilege(r.role, 'public.'||t.name, p.priv)) as unsafe_grants,
  (select count(*) from t cross join (values ('SELECT'),('UPDATE'),('DELETE')) p(priv)
     where has_table_privilege('service_role', 'public.'||t.name, p.priv)) as service_allowed,
  (select count(*) from t cross join (values ('INSERT'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
     where has_table_privilege('service_role', 'public.'||t.name, p.priv)) as service_forbidden,
  (select count(*) from srpc where to_regprocedure('public.'||sig) is not null
     and has_function_privilege('service_role','public.'||sig,'EXECUTE')) as rpc_service_exec,
  (select count(*) from srpc
     cross join (values ('anon'),('authenticated')) r(role)
     where to_regprocedure('public.'||sig) is not null
       and has_function_privilege(r.role,'public.'||sig,'EXECUTE')) as rpc_public_exec,
  (select count(*) from lrpc
     cross join (values ('service_role'),('anon'),('authenticated')) r(role)
     where to_regprocedure('public.'||sig) is not null
       and has_function_privilege(r.role,'public.'||sig,'EXECUTE')) as legacy_exec,
  (select count(*) from lrpc where to_regprocedure('public.'||sig) is not null) as legacy_present,
  -- Prueba directa por ACL de la pseudo-rol PUBLIC (grantee OID 0), sin has_*_privilege:
  -- ninguna tabla puede tener privilegios de PUBLIC en su relacl.
  (select count(*) from t
     cross join lateral aclexplode(coalesce(
       (select c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=t.name), '{}'::aclitem[])) acl
     where acl.grantee=0) as table_public_grants,
  -- Fail-closed para funciones: proacl NULL implica EXECUTE implícito de PUBLIC. Cada RPC
  -- de servicio debe tener ACL explícita y SIN entrada EXECUTE para PUBLIC (grantee 0).
  (select count(*) from srpc where to_regprocedure('public.'||sig) is not null and (
     (select p.proacl from pg_proc p where p.oid=to_regprocedure('public.'||sig)::oid) is null
     or exists (select 1 from aclexplode(
         (select p.proacl from pg_proc p where p.oid=to_regprocedure('public.'||sig)::oid)) a
       where a.grantee=0 and a.privilege_type='EXECUTE'))) as service_public_exec,
  (select count(*) from lrpc where to_regprocedure('public.'||sig) is not null and (
     (select p.proacl from pg_proc p where p.oid=to_regprocedure('public.'||sig)::oid) is null
     or exists (select 1 from aclexplode(
         (select p.proacl from pg_proc p where p.oid=to_regprocedure('public.'||sig)::oid)) a
       where a.grantee=0 and a.privilege_type='EXECUTE'))) as legacy_public_exec,
  -- psi_project_tender_dossier_artifact (defecto de ACL de 040, endurecido en 045) y los 3
  -- helpers SECURITY DEFINER internos: presentes, ejecutables por service_role, sin EXECUTE
  -- para anon/authenticated ni para PUBLIC (proacl NULL cuenta como PUBLIC ejecutable).
  (select count(*) from idef where to_regprocedure('public.'||sig) is not null) as idef_present,
  (select count(*) from idef where to_regprocedure('public.'||sig) is not null
     and has_function_privilege('service_role','public.'||sig,'EXECUTE')) as idef_service_exec,
  (select count(*) from idef cross join (values ('anon'),('authenticated')) r(role)
     where to_regprocedure('public.'||sig) is not null
       and has_function_privilege(r.role,'public.'||sig,'EXECUTE')) as idef_role_exec,
  (select count(*) from idef where to_regprocedure('public.'||sig) is not null and (
     (select p.proacl from pg_proc p where p.oid=to_regprocedure('public.'||sig)::oid) is null
     or exists (select 1 from aclexplode(
         (select p.proacl from pg_proc p where p.oid=to_regprocedure('public.'||sig)::oid)) a
       where a.grantee=0 and a.privilege_type='EXECUTE'))) as idef_public_exec,
  (select count(*) from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and not tg.tgisinternal and tg.tgname like 'trg_%_append_only'
       and c.relname in (select name from t)) as append_only_triggers,
  (to_regclass('public.psi_agt002_workbench_threads_one_active') is not null) as idx_one_active,
  (to_regclass('public.psi_agt002_workbench_jobs_queue_idx') is not null) as idx_queue,
  (to_regclass('public.psi_agt002_workbench_job_events_cursor_idx') is not null) as idx_cursor,
  (to_regclass('public.psi_tender_dossier_artifact_versions_agent_job_unique') is not null) as idx_agent_job_unique,
  (select count(*) from pg_constraint where conrelid='public.psi_tender_dossier_artifact_versions'::regclass
     and conname in ('psi_tender_dossier_artifact_versions_author_kind_check',
       'psi_tender_dossier_artifact_versions_agent_origin_check',
       'psi_tender_dossier_artifact_versions_agent_job_fkey')) as artifact_constraints,
  (select count(*) from pg_constraint where conname='psi_agt002_workbench_messages_origin_job_fkey') as origin_job_fk,
  (exists (select 1 from information_schema.columns where table_schema='public'
     and table_name='psi_tender_dossier_artifact_versions' and column_name='author_kind')) as col_author_kind,
  (exists (select 1 from information_schema.columns where table_schema='public'
     and table_name='psi_tender_dossier_artifact_versions' and column_name='origin_agent_job_id')) as col_origin_job,
  (select count(*) from public.psi_access_permissions where code='vigia_copilot_pilot' and active) as agt003_perm,
  (select count(*) from public.psi_profile_permissions where permission_code='vigia_copilot_pilot') as agt003_holders;
`;

export function verifyOk(row) {
  return dbInt(row.tables_present) === 8
    && dbInt(row.rls_enabled) === 8
    && dbInt(row.unsafe_grants) === 0
    && dbInt(row.service_allowed) === 24
    && dbInt(row.service_forbidden) === 0
    && dbInt(row.rpc_service_exec) === 8
    && dbInt(row.rpc_public_exec) === 0
    && dbInt(row.legacy_exec) === 0
    && dbInt(row.legacy_present) === 2
    && dbInt(row.table_public_grants) === 0
    && dbInt(row.service_public_exec) === 0
    && dbInt(row.legacy_public_exec) === 0
    && dbInt(row.idef_present) === 4
    && dbInt(row.idef_service_exec) === 4
    && dbInt(row.idef_role_exec) === 0
    && dbInt(row.idef_public_exec) === 0
    && dbInt(row.append_only_triggers) === 8
    && dbBool(row.idx_one_active) && dbBool(row.idx_queue) && dbBool(row.idx_cursor)
    && dbBool(row.idx_agent_job_unique)
    && dbInt(row.artifact_constraints) === 3
    && dbInt(row.origin_job_fk) === 1
    && dbBool(row.col_author_kind) && dbBool(row.col_origin_job)
    && dbInt(row.agt003_perm) === 1 && dbInt(row.agt003_holders) === 1;
}

export async function verify(execSql) {
  const [row = {}] = await execSql(VERIFY_SQL);
  const ok = verifyOk(row);
  if (ok) console.log('VERIFY_OK');
  return { ok, row };
}

// ---------------------------------------------------------------------------
// Verify absent: prueba que 045 quedó revertida, que las funciones 040 se
// restauraron y que AGT-003 044 sigue presente e inalterado.
// ---------------------------------------------------------------------------

const VERIFY_ABSENT_SQL = `
with t(name) as (values
  ('psi_agt002_workbench_threads'),('psi_agt002_workbench_messages'),('psi_agt002_workbench_message_links'),
  ('psi_agt002_workbench_jobs'),('psi_agt002_workbench_job_events'),('psi_agt002_workbench_required_actions'),
  ('psi_agt002_learning_proposals'),('psi_agt002_learning_decisions')),
srpc(sig) as (values
  ('psi_get_or_create_agt002_workbench_thread(uuid,uuid)'),
  ('psi_append_agt002_workbench_message(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text,uuid,uuid)'),
  ('psi_get_agt002_workbench(uuid,uuid)'),
  ('psi_retry_agt002_workbench_job(uuid,uuid,uuid)'),
  ('psi_review_agt002_learning_proposal(uuid,uuid,uuid,text,text,text)'),
  ('psi_claim_agt002_workbench_job(text,integer,integer,integer)'),
  ('psi_append_agt002_workbench_job_event(uuid,uuid,text,jsonb)'),
  ('psi_complete_agt002_workbench_job(uuid,uuid,uuid,jsonb)'))
select
  (select count(*) from t where to_regclass('public.'||name) is not null) as tables_present,
  (select count(*) from srpc where to_regprocedure('public.'||sig) is not null) as rpc_present,
  (to_regprocedure('public.psi_reject_agt002_workbench_mutation()') is not null) as trigger_fn_present,
  (to_regprocedure('public.psi_append_agt002_agent_result(uuid,uuid,uuid,jsonb)') is not null
     or to_regprocedure('public.psi_append_agt002_agent_artifact_version(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)') is not null) as legacy_present,
  (exists (select 1 from information_schema.columns where table_schema='public'
     and table_name='psi_tender_dossier_artifact_versions' and column_name='author_kind')) as col_author_kind,
  (exists (select 1 from information_schema.columns where table_schema='public'
     and table_name='psi_tender_dossier_artifact_versions' and column_name='origin_agent_job_id')) as col_origin_job,
  (to_regclass('public.psi_tender_dossier_artifact_versions_agent_job_unique') is not null) as idx_agent_job_unique,
  (select count(*) from pg_constraint where conrelid='public.psi_tender_dossier_artifact_versions'::regclass
     and conname in ('psi_tender_dossier_artifact_versions_author_kind_check',
       'psi_tender_dossier_artifact_versions_agent_origin_check',
       'psi_tender_dossier_artifact_versions_agent_job_fkey')) as artifact_constraints,
  (to_regprocedure('public.psi_project_tender_dossier_artifact(uuid)') is not null) as fn_project,
  (to_regprocedure('public.psi_record_tender_dossier_artifact_review(uuid,uuid,text,text)') is not null) as fn_review,
  -- Tras el rollback psi_project queda restaurada Y endurecida: sólo service_role la ejecuta.
  (to_regprocedure('public.psi_project_tender_dossier_artifact(uuid)') is not null
     and has_function_privilege('service_role','public.psi_project_tender_dossier_artifact(uuid)','EXECUTE')) as project_service_exec,
  (select count(*) from (values ('anon'),('authenticated')) r(role)
     where to_regprocedure('public.psi_project_tender_dossier_artifact(uuid)') is not null
       and has_function_privilege(r.role,'public.psi_project_tender_dossier_artifact(uuid)','EXECUTE')) as project_role_exec,
  ((select p.proacl from pg_proc p where p.oid=to_regprocedure('public.psi_project_tender_dossier_artifact(uuid)')::oid) is null
     or exists (select 1 from aclexplode(
         (select p.proacl from pg_proc p where p.oid=to_regprocedure('public.psi_project_tender_dossier_artifact(uuid)')::oid)) a
       where a.grantee=0 and a.privilege_type='EXECUTE')) as project_public_exec,
  (select count(*) from public.psi_access_permissions where code='vigia_copilot_pilot' and active) as agt003_perm,
  (select count(*) from public.psi_profile_permissions where permission_code='vigia_copilot_pilot') as agt003_holders;
`;

export function verifyAbsentOk(row) {
  return dbInt(row.tables_present) === 0
    && dbInt(row.rpc_present) === 0
    && !dbBool(row.trigger_fn_present)
    && !dbBool(row.legacy_present)
    && !dbBool(row.col_author_kind) && !dbBool(row.col_origin_job)
    && !dbBool(row.idx_agent_job_unique)
    && dbInt(row.artifact_constraints) === 0
    && dbBool(row.fn_project) && dbBool(row.fn_review)
    && dbBool(row.project_service_exec)
    && dbInt(row.project_role_exec) === 0
    && !dbBool(row.project_public_exec)
    && dbInt(row.agt003_perm) === 1 && dbInt(row.agt003_holders) === 1;
}

export async function verifyAbsent(execSql) {
  const [row = {}] = await execSql(VERIFY_ABSENT_SQL);
  const ok = verifyAbsentOk(row);
  if (ok) console.log('VERIFY_ABSENT_OK');
  return { ok, row };
}

// ---------------------------------------------------------------------------
// Chequeo de datos cero (sólo lectura). Prueba que ninguna tabla de Mesa/aprendizaje
// tiene filas y que ninguna versión de artefacto es de origen agente.
// ---------------------------------------------------------------------------

const ZERO_DATA_SQL = `
select
  (select count(*) from public.psi_agt002_workbench_threads)
    + (select count(*) from public.psi_agt002_workbench_messages)
    + (select count(*) from public.psi_agt002_workbench_message_links)
    + (select count(*) from public.psi_agt002_workbench_jobs)
    + (select count(*) from public.psi_agt002_workbench_job_events)
    + (select count(*) from public.psi_agt002_workbench_required_actions)
    + (select count(*) from public.psi_agt002_learning_proposals)
    + (select count(*) from public.psi_agt002_learning_decisions) as workbench_rows,
  (select count(*) from public.psi_tender_dossier_artifact_versions
     where author_kind='agent' or origin_agent_job_id is not null) as agent_versions;
`;

export async function checkZeroData(execSql) {
  const [row = {}] = await execSql(ZERO_DATA_SQL);
  const workbenchRows = dbInt(row.workbench_rows);
  const agentVersions = dbInt(row.agent_versions);
  // Invariante (reviewer): esta comprobación es SÓLO de lectura y no sustituye a la guarda
  // transaccional del SQL de rollback. Es una detección temprana fail-closed; la seguridad
  // real la garantizan los locks ACCESS EXCLUSIVE/SHARE tomados dentro de la misma
  // transacción del rollback, antes de la guarda de evidencia (anti-TOCTOU). ok===true
  // exige AMBOS contadores en cero: cualquier fila de Mesa/aprendizaje o cualquier versión
  // de artefacto de origen agente aborta el rollback.
  return { ok: workbenchRows === 0 && agentVersions === 0, workbenchRows, agentVersions };
}

// ---------------------------------------------------------------------------
// Rollback. Sólo desde applied y sólo tras el chequeo de datos cero (sólo lectura).
// Si absent, no-op. Si partial (preflight aborta) o hay datos, aborta. Luego
// verifica el estado absent y que AGT-003 sigue presente.
// ---------------------------------------------------------------------------

export async function rollback(execSql) {
  const { state } = await preflight(execSql);
  if (state === 'absent') {
    console.log('ROLLBACK_NOOP');
    const res = await verifyAbsent(execSql);
    if (!res.ok) throw new Error('ROLLBACK_NOOP: el estado no clasifica como ausente esperado.');
    return res;
  }
  // state === 'applied' (partial ya abortó en preflight).
  const safety = await checkZeroData(execSql);
  if (!safety.ok) {
    throw new Error(`ROLLBACK_ABORTED: existe evidencia AGT-002 (${safety.workbenchRows} filas de Mesa/aprendizaje, ${safety.agentVersions} versiones de artefacto de origen agente). No se destruye evidencia de auditoría.`);
  }
  await execSql(readRollbackSql());
  console.log('ROLLBACK_OK');
  const res = await verifyAbsent(execSql);
  if (!res.ok) throw new Error('ROLLBACK_FAILED: el estado posterior no verifica como ausente con AGT-003 presente.');
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
    const res = await apply(execSql);
    if (!res.ok) throw new Error('VERIFY_FAILED tras apply.');
  } else if (mode === 'verify') {
    const res = await verify(execSql);
    if (!res.ok) throw new Error('VERIFY_FAILED.');
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
