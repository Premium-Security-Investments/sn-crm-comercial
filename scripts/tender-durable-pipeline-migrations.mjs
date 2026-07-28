import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export const MIGRATION_FILES = [
  '032_tender_processing_jobs.sql',
  '033_tender_tracking_events_unified.sql',
  '034_tender_processing_rpc.sql',
  '035_tender_analysis_authorization.sql',
  '036_tender_processing_job_auto_authorization.sql',
  '037_tender_retry_limits.sql',
];

export const ROLLBACK_FILES = [
  '037_tender_retry_limits_rollback.sql',
  '036_tender_processing_job_auto_authorization_rollback.sql',
  '035_tender_analysis_authorization_rollback.sql',
  '034_tender_processing_rpc_rollback.sql',
  '033_tender_tracking_events_unified_rollback.sql',
  '032_tender_processing_jobs_rollback.sql',
];

// Same top-level begin;/commit; stripping as scripts/tender-document-state-migrations.mjs:
// exec_sql runs SQL via EXECUTE inside a PL/pgSQL function body, which does not allow
// transaction-control statements. Fails closed (throws) on any shape that isn't exactly
// one top-level begin;/commit; wrapper rather than guessing what to strip.
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

function readMigration(fileName) {
  return stripTopLevelTransactionWrapper(readFileSync(resolve(root, 'supabase/migrations', fileName), 'utf8'));
}

function readRollback(fileName) {
  return stripTopLevelTransactionWrapper(readFileSync(resolve(root, 'supabase/rollbacks', fileName), 'utf8'));
}

const PREREQUISITES_SQL = `
select
  to_regclass('public.psi_public_tenders')::text as t_tenders,
  to_regclass('public.psi_sales_opportunities')::text as t_opportunities,
  to_regclass('public.psi_sales_profiles')::text as t_profiles,
  to_regclass('public.psi_tender_tracking_events')::text as t_tracking_events,
  to_regclass('public.psi_tender_document_snapshots')::text as t_snapshots,
  to_regclass('public.psi_tender_analysis_runs')::text as t_runs,
  to_regclass('public.psi_tender_document_versions')::text as t_versions;
`;

export function prerequisitesOk(row) {
  return Boolean(row.t_tenders) && Boolean(row.t_opportunities) && Boolean(row.t_profiles)
    && Boolean(row.t_tracking_events) && Boolean(row.t_snapshots) && Boolean(row.t_runs) && Boolean(row.t_versions);
}

// Read-only. Fails closed: throws instead of guessing when 017/022/025/026/027/028 are missing.
export async function preflight(execSql) {
  const [row] = await execSql(PREREQUISITES_SQL);
  if (!prerequisitesOk(row)) {
    throw new Error('Prerrequisitos ausentes (017/022/025/026/027/028); abortando en modo cerrado (fail closed).');
  }
  return row;
}

const VERIFY_SQL = `
select
  to_regclass('public.psi_tender_processing_jobs')::text as t_jobs,
  to_regclass('public.psi_tender_document_import_items')::text as t_items,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'psi_create_tender_processing_job', 'psi_claim_tender_processing_job', 'psi_update_tender_processing_job',
      'psi_append_tender_tracking_event', 'psi_record_tender_import_item', 'psi_authorize_tender_analysis'
    )) as fn_count,
  to_regprocedure('public.psi_record_tender_import_item(uuid,text,text,text,text,text,boolean,uuid,text,text,timestamptz)')::text as fn_retry_record;
`;

// Read-only. Never executes migration or rollback SQL.
export async function verify(execSql) {
  const [row] = await execSql(VERIFY_SQL);
  const ok = Boolean(row.t_jobs) && Boolean(row.t_items) && Number(row.fn_count) >= 6
    && Boolean(row.fn_retry_record);
  if (!ok) {
    return { ok: false, row };
  }
  console.log('VERIFY_OK');
  return { ok: true, row };
}

export async function apply(execSql) {
  for (const fileName of MIGRATION_FILES) {
    await execSql(readMigration(fileName));
  }
  console.log('APPLY_OK');
}

export async function rollback(execSql) {
  for (const fileName of ROLLBACK_FILES) {
    await execSql(readRollback(fileName));
  }
  console.log('ROLLBACK_OK');
}

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

function createExecSql({ fetchImpl = fetch, envPath, baseUrl, serviceKey } = {}) {
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
  if (mode === 'preflight') await preflight(execSql);
  else if (mode === 'apply') { await preflight(execSql); await apply(execSql); await verify(execSql); }
  else if (mode === 'verify') await verify(execSql);
  else if (mode === 'rollback') await rollback(execSql);
  else throw new Error('Modo inválido. Use preflight, apply, verify o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) {
  main().catch(error => {
    if (!process.exitCode) process.exitCode = 1;
    console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim());
  });
}
