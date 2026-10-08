// Aplicador de la migración 113 (campos del perfil del cliente, AGT-003). Modos: state | apply | verify | rollback.
// Reutiliza la conexión exec_sql del aplicador AGT-002; aplica en una sola transacción con candado consultivo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createExecSql, stripTopLevelTransactionWrapper } from './agt002-initial-analysis-migrations.mjs';

const root = resolve(import.meta.dirname, '..');
const MIGRATION = 'supabase/migrations/113_agt003_client_profile_fields.sql';
const ROLLBACK = 'supabase/rollbacks/113_agt003_client_profile_fields_rollback.sql';
const LOCK = "perform pg_advisory_xact_lock(hashtextextended('agt003-client-profile-113', 0));";
export const PROFILE_COLUMNS = ['company_website', 'company_nit', 'decision_maker_title', 'decision_maker_linkedin',
  'current_security_provider', 'current_security_provider_none', 'current_contract_end_date'];

export const STATE_SQL = `select count(*)::int as columns from information_schema.columns
  where table_schema = 'public' and table_name = 'psi_sales_opportunities'
    and column_name in (${PROFILE_COLUMNS.map(c => `'${c}'`).join(', ')})`;

export function statusOf(row) {
  return row.columns === PROFILE_COLUMNS.length ? 'applied' : row.columns === 0 ? 'absent' : 'partial';
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
  if (mode === 'verify') { if (current.status !== 'applied') throw new Error(`Migración 113 no aplicada: ${current.status}.`); console.log('VERIFY_OK'); return; }
  if (mode === 'apply') {
    if (current.status === 'applied') { console.log('YA_APLICADA'); return; }
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, MIGRATION), 'utf8'));
    await execSql(`-- AGT003_CLIENT_PROFILE_113:APPLY\ndo $agt113$ begin ${LOCK} end $agt113$;\n${sql}`);
    const after = await readState(execSql);
    if (after.status !== 'applied') throw new Error(`Después de aplicar quedó ${after.status}.`);
    console.log('APPLY_OK');
    return;
  }
  if (mode === 'rollback') {
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, ROLLBACK), 'utf8'));
    await execSql(`-- AGT003_CLIENT_PROFILE_113:ROLLBACK\ndo $agt113$ begin ${LOCK} end $agt113$;\n${sql}`);
    await readState(execSql);
    console.log('ROLLBACK_OK');
    return;
  }
  throw new Error('Modo inválido. Use state, apply, verify o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) main().catch(error => { process.exitCode = 1; console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim()); });
