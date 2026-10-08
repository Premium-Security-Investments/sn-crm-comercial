// Aplicador de la migración 116 (retiro de documentos de un aviso SECOP republicado y avisos atómicos en observaciones,
// AGT-002). Modos: state | apply | verify | rollback.
// Reutiliza la conexión exec_sql del aplicador AGT-002; aplica en una sola transacción con candado consultivo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createExecSql, stripTopLevelTransactionWrapper } from './agt002-initial-analysis-migrations.mjs';

const root = resolve(import.meta.dirname, '..');
const MIGRATION = 'supabase/migrations/116_agt002_retire_republished_tender_documents.sql';
const ROLLBACK = 'supabase/rollbacks/116_agt002_retire_republished_tender_documents_rollback.sql';
const LOCK = "perform pg_advisory_xact_lock(hashtextextended('agt002-republication-116', 0));";
export const STATE_SQL = `select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'psi_retire_tender_document_versions')::int as retire_functions,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'psi_append_opportunity_observation_line')::int as append_functions`;

export function statusOf(row) {
  return row.retire_functions === 1 && row.append_functions === 1 ? 'applied'
    : row.retire_functions === 0 && row.append_functions === 0 ? 'absent' : 'partial';
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
  if (mode === 'verify') { if (current.status !== 'applied') throw new Error(`Migración 116 no aplicada: ${current.status}.`); console.log('VERIFY_OK'); return; }
  if (mode === 'apply') {
    if (current.status === 'applied') { console.log('YA_APLICADA'); return; }
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, MIGRATION), 'utf8'));
    await execSql(`-- AGT002_REPUBLICATION_116:APPLY\ndo $agt116$ begin ${LOCK} end $agt116$;\n${sql}`);
    const after = await readState(execSql);
    if (after.status !== 'applied') throw new Error(`Después de aplicar quedó ${after.status}.`);
    console.log('APPLY_OK');
    return;
  }
  if (mode === 'rollback') {
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, ROLLBACK), 'utf8'));
    await execSql(`-- AGT002_REPUBLICATION_116:ROLLBACK\ndo $agt116$ begin ${LOCK} end $agt116$;\n${sql}`);
    await readState(execSql);
    console.log('ROLLBACK_OK');
    return;
  }
  throw new Error('Modo inválido. Use state, apply, verify o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) main().catch(error => { process.exitCode = 1; console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim()); });
