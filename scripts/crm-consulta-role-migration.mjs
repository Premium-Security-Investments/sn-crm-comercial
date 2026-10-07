// Aplicador de la migración 111 (rol Directivo de solo consulta y último ingreso al CRM). Modos: state | apply | verify | rollback.
// Reutiliza la conexión exec_sql del aplicador AGT-002; aplica en una sola transacción con candado consultivo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createExecSql, stripTopLevelTransactionWrapper } from './agt002-initial-analysis-migrations.mjs';

const root = resolve(import.meta.dirname, '..');
const MIGRATION = 'supabase/migrations/111_crm_consulta_role_last_seen.sql';
const ROLLBACK = 'supabase/rollbacks/111_crm_consulta_role_last_seen_rollback.sql';
const LOCK = "perform pg_advisory_xact_lock(hashtextextended('crm-consulta-role-111', 0));";

export const STATE_SQL = `select
  (select count(*) from pg_constraint where conrelid = 'public.psi_sales_profiles'::regclass and conname = 'psi_sales_profiles_role_check'
     and pg_get_constraintdef(oid) like '%consulta%')::int as role_check,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname = 'psi_admin_persist_profile_access' and pg_get_functiondef(p.oid) like '%consulta%')::int as persist_rpc,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'psi_profile_last_seen')::int as last_seen_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname = 'psi_touch_profile_last_seen')::int as touch_function,
  (select count(*) from pg_indexes where schemaname = 'public'
     and indexname in ('idx_psi_sales_interactions_created_by_created_at','idx_psi_sales_opportunity_audit_logs_decision_actor'))::int as indexes,
  (select count(*) from public.psi_sales_profiles where role = 'consulta')::int as consulta_profiles,
  (select count(*) from public.psi_sales_profiles where lower(btrim(microsoft_email)) = 'directorfisica@seguridadnacional.co'
     and active and role = 'admin' and coalesce(identity_type, 'human') = 'human')::int as luis_fernando,
  (select count(*) from public.psi_sales_profiles where lower(btrim(microsoft_email)) = 'directorfisica@seguridadnacional.co'
     and can_own_opportunities = true)::int as luis_fernando_can_own`;

export function statusOf(row) {
  const applied = row.role_check === 1 && row.persist_rpc === 1 && row.last_seen_table === 1 && row.touch_function === 1 && row.indexes === 2
    && row.luis_fernando_can_own === 1;
  const absent = row.role_check === 0 && row.persist_rpc === 0 && row.last_seen_table === 0 && row.touch_function === 0 && row.indexes === 0;
  return applied ? 'applied' : absent ? 'absent' : 'partial';
}

async function readState(execSql) {
  const [row] = await execSql(STATE_SQL);
  const status = statusOf(row);
  console.log(JSON.stringify({ status, ...row }));
  return { status, row };
}

async function main() {
  const mode = process.argv[2] || 'state';
  const execSql = createExecSql();
  const current = await readState(execSql);
  if (mode === 'state') return;
  if (mode === 'verify') { if (current.status !== 'applied') throw new Error(`Migración 111 no aplicada: ${current.status}.`); console.log('VERIFY_OK'); return; }
  if (mode === 'apply') {
    if (current.status === 'applied') { console.log('YA_APLICADA'); return; }
    if (current.row.luis_fernando !== 1) throw new Error('No se encontró exactamente un perfil humano activo admin de Luis Fernando López.');
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, MIGRATION), 'utf8'));
    await execSql(`-- CRM_CONSULTA_111:APPLY\ndo $crm111$ begin ${LOCK} end $crm111$;\n${sql}`);
    const after = await readState(execSql);
    if (after.status !== 'applied') throw new Error(`Después de aplicar quedó ${after.status}.`);
    console.log('APPLY_OK');
    return;
  }
  if (mode === 'rollback') {
    if (current.row.consulta_profiles > 0) throw new Error('Hay perfiles con rol consulta: cámbieles el rol antes de revertir 111.');
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, ROLLBACK), 'utf8'));
    await execSql(`-- CRM_CONSULTA_111:ROLLBACK\ndo $crm111$ begin ${LOCK} end $crm111$;\n${sql}`);
    await readState(execSql);
    console.log('ROLLBACK_OK');
    return;
  }
  throw new Error('Modo inválido. Use state, apply, verify o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) main().catch(error => { process.exitCode = 1; console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim()); });
