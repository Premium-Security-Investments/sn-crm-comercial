// Aplicador de la migración 112 (las cinco vistas comerciales de AGT-003 dejan de ser legibles con la llave pública).
// Modos: state | apply | verify | rollback. Reutiliza la conexión exec_sql del aplicador AGT-002 (ENV_FILE soportado);
// aplica en una sola transacción con candado consultivo.
// rollback REABRE LA FUGA: exige el argumento --confirmo-reabrir-fuga.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createExecSql, stripTopLevelTransactionWrapper } from './agt002-initial-analysis-migrations.mjs';

const root = resolve(import.meta.dirname, '..');
const MIGRATION = 'supabase/migrations/112_agt003_commercial_views_no_public_access.sql';
const ROLLBACK = 'supabase/rollbacks/112_agt003_commercial_views_no_public_access_rollback.sql';
const LOCK = "perform pg_advisory_xact_lock(hashtextextended('agt003-views-security-112', 0));";
const ROLLBACK_CONFIRMATION = '--confirmo-reabrir-fuga';

export const COMMERCIAL_VIEWS = Object.freeze([
  'v_psi_sales_opportunity_enriched',
  'v_psi_sales_pipeline_summary',
  'v_psi_sales_kpis_by_commercial_month',
  'v_psi_sales_stalled_sustentacion',
  'v_psi_sales_top3_closing',
]);

export const STATE_SQL = `select v.view_name,
  (c.oid is not null) as present,
  case when c.oid is null then null else has_table_privilege('anon', c.oid, 'SELECT') end as anon_select,
  case when c.oid is null then null else has_table_privilege('authenticated', c.oid, 'SELECT') end as authenticated_select,
  case when c.oid is null then null else has_table_privilege('service_role', c.oid, 'SELECT') end as service_role_select,
  case when c.oid is null then null else coalesce(c.reloptions @> array['security_invoker=true']
    or c.reloptions @> array['security_invoker=on'], false) end as security_invoker
from unnest(array[${COMMERCIAL_VIEWS.map(name => `'${name}'`).join(', ')}]::text[]) with ordinality as v(view_name, ord)
left join pg_class c on c.oid = to_regclass('public.' || v.view_name) and c.relkind = 'v'
order by v.ord`;

export function viewStatusOf(row) {
  if (!row.present) return 'missing';
  if (!row.anon_select && !row.authenticated_select && row.security_invoker && row.service_role_select) return 'applied';
  if (row.anon_select && row.authenticated_select && !row.security_invoker) return 'absent';
  return 'partial';
}

export function statusOf(rows) {
  const statuses = rows.map(viewStatusOf);
  if (rows.length !== COMMERCIAL_VIEWS.length || statuses.includes('missing')) return 'missing';
  if (statuses.every(status => status === 'applied')) return 'applied';
  if (statuses.every(status => status === 'absent')) return 'absent';
  return 'partial';
}

async function readState(execSql) {
  const rows = await execSql(STATE_SQL);
  const status = statusOf(rows);
  console.log(JSON.stringify({ status, views: rows.map(row => ({ ...row, status: viewStatusOf(row) })) }));
  return { status, rows };
}

async function main() {
  const mode = process.argv[2] || 'state';
  const execSql = createExecSql();
  const current = await readState(execSql);
  if (mode === 'state') return;
  if (mode === 'verify') { if (current.status !== 'applied') throw new Error(`Migración 112 no aplicada: ${current.status}.`); console.log('VERIFY_OK'); return; }
  if (mode === 'apply') {
    if (current.status === 'applied') { console.log('YA_APLICADA'); return; }
    if (current.status === 'missing') throw new Error('Falta alguna de las cinco vistas comerciales: no se aplica 112.');
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, MIGRATION), 'utf8'));
    await execSql(`-- AGT003_VIEWS_112:APPLY\ndo $agt003v112$ begin ${LOCK} end $agt003v112$;\n${sql}`);
    const after = await readState(execSql);
    if (after.status !== 'applied') throw new Error(`Después de aplicar quedó ${after.status}.`);
    console.log('APPLY_OK');
    return;
  }
  if (mode === 'rollback') {
    if (!process.argv.includes(ROLLBACK_CONFIRMATION)) {
      throw new Error(`El rollback de 112 REABRE LA FUGA (anon vuelve a leer todas las oportunidades). Repita con ${ROLLBACK_CONFIRMATION} si de verdad es necesario.`);
    }
    if (current.status === 'missing') throw new Error('Falta alguna de las cinco vistas comerciales: no se revierte 112.');
    const sql = stripTopLevelTransactionWrapper(readFileSync(resolve(root, ROLLBACK), 'utf8'));
    await execSql(`-- AGT003_VIEWS_112:ROLLBACK\ndo $agt003v112$ begin ${LOCK} end $agt003v112$;\n${sql}`);
    await readState(execSql);
    console.log('ROLLBACK_OK (ATENCIÓN: las vistas vuelven a ser legibles con la llave pública)');
    return;
  }
  throw new Error('Modo inválido. Use state, apply, verify o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) main().catch(error => { process.exitCode = 1; console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim()); });
