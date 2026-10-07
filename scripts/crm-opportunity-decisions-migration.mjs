// Aplicador de la migración 110 (decisión obligatoria por oportunidad). Modos: state | apply | verify | rollback.
// Reutiliza la conexión exec_sql del aplicador AGT-002; aplica en una sola transacción con candado consultivo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createExecSql, stripTopLevelTransactionWrapper } from './agt002-initial-analysis-migrations.mjs';

const root = resolve(import.meta.dirname, '..');
const MIGRATION = 'supabase/migrations/110_crm_opportunity_decisions.sql';
const ROLLBACK = 'supabase/rollbacks/110_crm_opportunity_decisions_rollback.sql';
const LOCK = "perform pg_advisory_xact_lock(hashtextextended('crm-opportunity-decisions-110', 0));";

export const STATE_SQL = `select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'psi_sales_opportunities'
     and column_name in ('frozen_until','frozen_reason','frozen_at','frozen_by','delete_requested_at','delete_requested_by','delete_request_reason','deleted_at','deleted_by'))::int as columns,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('psi_record_opportunity_decision','psi_resolve_opportunity_delete_request'))::int as functions,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'v_psi_sales_opportunity_enriched'
     and column_name in ('frozen_until','delete_requested_at'))::int as view_columns,
  (select count(*) from public.psi_profile_permissions where permission_code = 'crm_eliminar_oportunidades')::int as delete_permission_holders,
  (select count(*) from public.psi_sales_profiles where lower(btrim(microsoft_email)) = 'directorfisica@seguridadnacional.co' and active and coalesce(identity_type, 'human') = 'human')::int as luis_fernando`;

export function statusOf(row) {
  const applied = row.columns === 9 && row.functions === 2 && row.view_columns === 2 && row.delete_permission_holders === 1;
  const absent = row.functions === 0 && row.delete_permission_holders === 0;
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
  if (mode === 'verify') { if (current.status !== 'applied') throw new Error(`Migración 110 no aplicada: ${current.status}.`); console.log('VERIFY_OK'); return; }
  if (mode === 'apply') {
    if (current.status === 'applied') { console.log('YA_APLICADA'); return; }
    if (current.row.luis_fernando !== 1) throw new Error('No se encontró exactamente un perfil activo de Luis Fernando López.');
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, MIGRATION), 'utf8'));
    await execSql(`-- CRM_DECISIONS_110:APPLY\ndo $crm110$ begin ${LOCK} end $crm110$;\n${sql}`);
    const after = await readState(execSql);
    if (after.status !== 'applied') throw new Error(`Después de aplicar quedó ${after.status}.`);
    console.log('APPLY_OK');
    return;
  }
  if (mode === 'rollback') {
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, ROLLBACK), 'utf8'));
    await execSql(`-- CRM_DECISIONS_110:ROLLBACK\ndo $crm110$ begin ${LOCK} end $crm110$;\n${sql}`);
    await readState(execSql);
    console.log('ROLLBACK_OK');
    return;
  }
  throw new Error('Modo inválido. Use state, apply, verify o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) main().catch(error => { process.exitCode = 1; console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim()); });
