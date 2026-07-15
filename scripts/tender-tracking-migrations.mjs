import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = process.env.ENV_FILE || resolve(root, '.env.local');
for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const at = line.indexOf('=');
  const key = line.slice(0, at).trim();
  const value = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
  process.env[key] = value;
}
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !serviceKey) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
const endpoint = `${base.replace(/\/$/, '')}/rest/v1/rpc/exec_sql`;

async function execSql(sql) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: sql.trim().replace(/;\s*$/, '') }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(payload?.error || `exec_sql HTTP ${response.status}`);
    error.sqlstate = payload?.sqlstate;
    throw error;
  }
  if (!Array.isArray(payload.rows)) {
    console.error(`EXEC_SQL_SHAPE ${JSON.stringify({ status: response.status, keys: Object.keys(payload || {}), ok: payload?.ok, rowsType: typeof payload?.rows, hasError: Boolean(payload?.error), sqlstate: payload?.sqlstate || null })}`);
  }
  return Array.isArray(payload.rows) ? payload.rows : [];
}

const preflightSql = `
select
  (select count(*) from public.psi_public_tenders) as tender_count,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='psi_public_tenders' and column_name like 'tracking_%') as tracking_column_count,
  to_regclass('public.psi_tender_tracking_events')::text as events_table,
  (select count(*) from (select converted_opportunity_id from public.psi_public_tenders where converted_opportunity_id is not null group by converted_opportunity_id having count(*) > 1) x) as duplicate_converted,
  (select count(*) from (select external_source from public.psi_sales_opportunities where external_source like 'secop_radar:%' group by external_source having count(*) > 1) x) as duplicate_external;
`;
const verifySql = `
select
  (select count(*) from public.psi_public_tenders) as tender_count,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='psi_public_tenders' and column_name like 'tracking_%') as tracking_column_count,
  to_regclass('public.psi_tender_tracking_events')::text as events_table,
  (select count(*) from public.psi_tender_tracking_events) as event_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('psi_update_tender_tracking','psi_transition_tender_tracking','psi_convert_tender_to_opportunity','psi_discard_tender_opportunity')) as function_count,
  (select count(*) from pg_indexes where schemaname='public' and indexname in ('psi_public_tenders_converted_opportunity_id_unique','psi_sales_opportunities_secop_radar_external_source_unique','idx_public_tenders_tracking_queue','idx_tender_tracking_events_tender_created')) as index_count,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='psi_public_tenders' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')) as authenticated_tender_write_grants,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='psi_tender_tracking_events' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')) as authenticated_event_write_grants;
`;

function printRow(label, row) {
  const safe = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, value]));
  console.log(`${label} ${JSON.stringify(safe)}`);
}
async function preflight() {
  const [row] = await execSql(preflightSql);
  printRow('PREFLIGHT', row);
  if (Number(row.duplicate_converted) !== 0 || Number(row.duplicate_external) !== 0) throw new Error('Preflight bloqueado por duplicados.');
  return row;
}
async function verify() {
  const [row] = await execSql(verifySql);
  printRow('VERIFY', row);
  const ok = Number(row.tracking_column_count) === 8 && Boolean(row.events_table) && Number(row.function_count) === 4 && Number(row.index_count) === 4 && Number(row.authenticated_tender_write_grants) === 0 && Number(row.authenticated_event_write_grants) === 0;
  if (!ok) throw new Error('La verificación estructural posterior no coincide con el contrato esperado.');
}
async function rollback() {
  await execSql(readFileSync(resolve(root, 'supabase/rollbacks/017_018_tender_tracking_rollback.sql'), 'utf8'));
  const [row] = await execSql(preflightSql);
  printRow('ROLLBACK_VERIFY', row);
  if (Number(row.tracking_column_count) !== 0 || row.events_table) throw new Error('Rollback incompleto.');
}

const mode = process.argv[2] || 'preflight';
if (mode === 'preflight') await preflight();
else if (mode === 'verify') await verify();
else if (mode === 'rollback') await rollback();
else if (mode === 'apply') {
  const before = await preflight();
  const cleanBefore = Number(before.tracking_column_count) === 0 && !before.events_table;
  try {
    await execSql(readFileSync(resolve(root, 'supabase/migrations/017_tender_tracking_workflow.sql'), 'utf8'));
    await execSql(readFileSync(resolve(root, 'supabase/migrations/018_tender_tracking_rpc.sql'), 'utf8'));
    await verify();
    console.log('APPLY_OK');
  } catch (error) {
    console.error(`APPLY_FAILED ${error.sqlstate || ''} ${error.message}`.trim());
    if (cleanBefore) {
      console.error('AUTO_ROLLBACK_START');
      await rollback();
      console.error('AUTO_ROLLBACK_OK');
    }
    process.exitCode = 1;
  }
} else throw new Error('Modo inválido. Use preflight, apply, verify o rollback.');
