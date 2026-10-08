// Aplicador de la migración 115 (mensaje sugerido usado o descartado, AGT-003). Modos: state | apply | verify | rollback.
// Reutiliza la conexión exec_sql del aplicador AGT-002; aplica en una sola transacción con candado consultivo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createExecSql, stripTopLevelTransactionWrapper } from './agt002-initial-analysis-migrations.mjs';

const root = resolve(import.meta.dirname, '..');
const MIGRATION = 'supabase/migrations/115_agt003_lead_analysis_message_events.sql';
const ROLLBACK = 'supabase/rollbacks/115_agt003_lead_analysis_message_events_rollback.sql';
const LOCK = "perform pg_advisory_xact_lock(hashtextextended('agt003-lead-message-115', 0));";
export const STATE_SQL = `select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'psi_agt003_lead_analysis_message_events')::int as table_count,
  (select count(*) from pg_trigger where tgname = 'psi_agt003_lead_analysis_message_events_guard')::int as triggers`;

export function statusOf(row) {
  return row.table_count === 1 && row.triggers === 1 ? 'applied' : row.table_count === 0 && row.triggers === 0 ? 'absent' : 'partial';
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
  if (mode === 'verify') { if (current.status !== 'applied') throw new Error(`Migración 115 no aplicada: ${current.status}.`); console.log('VERIFY_OK'); return; }
  if (mode === 'apply') {
    if (current.status === 'applied') { console.log('YA_APLICADA'); return; }
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, MIGRATION), 'utf8'));
    await execSql(`-- AGT003_LEAD_MESSAGE_115:APPLY\ndo $agt115$ begin ${LOCK} end $agt115$;\n${sql}`);
    const after = await readState(execSql);
    if (after.status !== 'applied') throw new Error(`Después de aplicar quedó ${after.status}.`);
    console.log('APPLY_OK');
    return;
  }
  if (mode === 'rollback') {
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, ROLLBACK), 'utf8'));
    await execSql(`-- AGT003_LEAD_MESSAGE_115:ROLLBACK\ndo $agt115$ begin ${LOCK} end $agt115$;\n${sql}`);
    await readState(execSql);
    console.log('ROLLBACK_OK');
    return;
  }
  throw new Error('Modo inválido. Use state, apply, verify o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) main().catch(error => { process.exitCode = 1; console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim()); });
