import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const MIGRATION_026 = resolve(root, 'supabase/migrations/026_tender_document_versions.sql');
const MIGRATION_027 = resolve(root, 'supabase/migrations/027_tender_decision_current_analysis.sql');
const ROLLBACK_027 = resolve(root, 'supabase/rollbacks/027_tender_decision_current_analysis_rollback.sql');
const ROLLBACK_026 = resolve(root, 'supabase/rollbacks/026_tender_document_versions_rollback.sql');

// Read-only. Distinguishes prerequisites from 022 (GO/NO GO decisions) and
// 025 (analysis foundation) that must exist before 026/027 can be applied.
// psi_record_tender_go_no_go is checked under both its pre-027 (025-era,
// 7-arg) and post-027 (8-arg) overloads: 027 drops the 7-arg overload
// outright when applied, so an environment where 027 is already live would
// otherwise fail this fail-closed check even though prerequisites are
// genuinely satisfied — only one of the two overloads existing at a time is
// ever expected; requiring exactly the 025 one made preflight unusable once
// 027 landed.
export const PREREQUISITES_SQL = `
select
  to_regclass('public.psi_tender_go_no_go_decisions')::text as t_go_no_go_decisions,
  to_regclass('public.psi_tender_document_snapshots')::text as t_snapshots,
  to_regclass('public.psi_tender_analysis_runs')::text as t_runs,
  to_regclass('public.psi_sales_opportunities')::text as t_opportunities,
  to_regclass('public.psi_public_tenders')::text as t_tenders,
  to_regclass('public.psi_sales_profiles')::text as t_profiles,
  to_regclass('public.psi_sales_interactions')::text as t_interactions,
  to_regprocedure('public.psi_safe_jsonb(text)')::text as fn_safe_jsonb,
  to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb)')::text as fn_go_no_go_025,
  to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)')::text as fn_go_no_go_027;
`;

export function prerequisitesOk(row) {
  return Boolean(row.t_go_no_go_decisions) && Boolean(row.t_snapshots) && Boolean(row.t_runs)
    && Boolean(row.t_opportunities) && Boolean(row.t_tenders) && Boolean(row.t_profiles)
    && Boolean(row.t_interactions) && Boolean(row.fn_safe_jsonb)
    && (Boolean(row.fn_go_no_go_025) || Boolean(row.fn_go_no_go_027));
}

// Read-only. Structural markers for 026 and 027, each independently gated
// on the exact table/function/trigger/grant shape the migrations create.
// has_function_privilege() raises "function ... does not exist" instead of
// returning false when the signature is absent (unlike to_regprocedure, which
// is forgiving) — every grant check below is therefore guarded by the
// corresponding to_regprocedure(...) is not null check so a pending/partial
// state can never surface as a raised error.
export const STATE_SQL = `
select
  to_regclass('public.psi_company_procurement_documents')::text as t_company_docs,
  to_regclass('public.psi_tender_document_versions')::text as t_tender_doc_versions,
  to_regprocedure('public.psi_is_public_https_url(text)')::text as fn_is_public_https_url,
  to_regprocedure('public.psi_record_company_procurement_document(text,text,date,date,text,text,text,bigint,uuid,uuid)')::text as fn_record_company_doc,
  to_regprocedure('public.psi_record_tender_document_version(uuid,uuid,text,text,text,text,text,text,bigint,text,text,text,uuid)')::text as fn_record_tender_doc_version,
  case when to_regprocedure('public.psi_record_company_procurement_document(text,text,date,date,text,text,text,bigint,uuid,uuid)') is not null
    then has_function_privilege('service_role', 'public.psi_record_company_procurement_document(text,text,date,date,text,text,text,bigint,uuid,uuid)', 'EXECUTE')
    else false end as grant_company_doc,
  case when to_regprocedure('public.psi_record_tender_document_version(uuid,uuid,text,text,text,text,text,text,bigint,text,text,text,uuid)') is not null
    then has_function_privilege('service_role', 'public.psi_record_tender_document_version(uuid,uuid,text,text,text,text,text,text,bigint,text,text,text,uuid)', 'EXECUTE')
    else false end as grant_tender_doc_version,
  to_regclass('public.psi_tender_document_state')::text as t_document_state,
  to_regprocedure('public.psi_begin_tender_document_refresh(uuid,uuid)')::text as fn_begin_refresh,
  to_regprocedure('public.psi_record_tender_document_snapshot(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid)')::text as fn_record_snapshot_8arg,
  to_regprocedure('public.psi_record_tender_go_no_go(uuid,uuid,uuid,text,uuid,text,jsonb,text)')::text as fn_go_no_go_8arg,
  (select count(*)::int from pg_trigger where tgname = 'psi_invalidate_tender_state_from_legacy_upload' and tgrelid = to_regclass('public.psi_sales_interactions') and not tgisinternal) as trg_legacy,
  (select count(*)::int from pg_trigger where tgname = 'psi_invalidate_tender_state_from_typed_version' and tgrelid = to_regclass('public.psi_tender_document_versions') and not tgisinternal) as trg_typed,
  case when to_regprocedure('public.psi_begin_tender_document_refresh(uuid,uuid)') is not null
    then has_function_privilege('service_role', 'public.psi_begin_tender_document_refresh(uuid,uuid)', 'EXECUTE')
    else false end as grant_begin_refresh,
  case when to_regprocedure('public.psi_tender_analysis_foundation_ready()') is not null
    then has_function_privilege('service_role', 'public.psi_tender_analysis_foundation_ready()', 'EXECUTE')
    else false end as grant_foundation_ready,
  (select relrowsecurity from pg_class where oid = to_regclass('public.psi_company_procurement_documents')) as rls_company_docs,
  (select relrowsecurity from pg_class where oid = to_regclass('public.psi_tender_document_versions')) as rls_tender_doc_versions,
  (select relrowsecurity from pg_class where oid = to_regclass('public.psi_tender_document_state')) as rls_document_state,
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'psi_company_procurement_documents' and lower(grantee) in ('anon', 'authenticated', 'public')) as grants_company_docs_unsafe,
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'psi_tender_document_versions' and lower(grantee) in ('anon', 'authenticated', 'public')) as grants_tender_doc_versions_unsafe,
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'psi_tender_document_state' and lower(grantee) in ('anon', 'authenticated', 'public')) as grants_document_state_unsafe;
`;

// Pure function: classifies the exact row shape returned by STATE_SQL into
// per-migration booleans plus an overall pending/partial/applied status.
//
// Structural presence (objects/triggers/service_role grants — did the
// migration's CREATE/GRANT statements run) is tracked separately from
// security posture (RLS enabled, no anon/authenticated/public grants
// leaked). This split matters because Supabase's default ACLs grant anon
// full privileges automatically at CREATE time: a migration that forgets an
// explicit `revoke ... from anon` leaves structurally-complete objects with
// unsafe grants. Collapsing that into "not applied" the same way as
// "nothing was created" made `status` read as 'pending' even though every
// table/function/trigger existed — and rollback() (which only drops
// structure it believes is present) silently no-op'd on that false
// 'pending' reading while reporting success. `status` is therefore derived
// from structural presence for the pending/partial boundary: 'pending' only
// when neither migration's structure exists at all; 'partial' whenever any
// structure is present but the pair isn't fully (structurally +
// security-wise) applied — covering both the real single-transaction
// intermediate state (026 done, 027 not yet) and structure-present-but-
// insecure states alike, so rollback() always has real work to do whenever
// status isn't 'pending'.
export function classify(row) {
  const structural026 = Boolean(row.t_company_docs) && Boolean(row.t_tender_doc_versions)
    && Boolean(row.fn_is_public_https_url) && Boolean(row.fn_record_company_doc) && Boolean(row.fn_record_tender_doc_version)
    && row.grant_company_doc === true && row.grant_tender_doc_version === true;
  const secure026 = row.rls_company_docs === true && row.rls_tender_doc_versions === true
    && Number(row.grants_company_docs_unsafe) === 0 && Number(row.grants_tender_doc_versions_unsafe) === 0;
  const migration026 = structural026 && secure026;

  const structural027 = Boolean(row.t_document_state) && Boolean(row.fn_begin_refresh)
    && Boolean(row.fn_record_snapshot_8arg) && Boolean(row.fn_go_no_go_8arg)
    && Number(row.trg_legacy) === 1 && Number(row.trg_typed) === 1
    && row.grant_begin_refresh === true && row.grant_foundation_ready === true;
  const secure027 = row.rls_document_state === true && Number(row.grants_document_state_unsafe) === 0;
  const migration027 = structural027 && secure027;

  let status;
  if (migration026 && migration027) status = 'applied';
  else if (!structural026 && !structural027) status = 'pending';
  else status = 'partial';
  return { migration026, migration027, status, structural026, structural027 };
}

export async function readStatus(execSql) {
  const [row] = await execSql(STATE_SQL);
  const result = classify(row);
  console.log(`STATUS ${JSON.stringify({ status: result.status, migration_026: result.migration026, migration_027: result.migration027 })}`);
  return result;
}

// Read-only. Fails closed: throws instead of guessing when 022/025 are missing.
export async function preflight(execSql) {
  const [row] = await execSql(PREREQUISITES_SQL);
  if (!prerequisitesOk(row)) {
    throw new Error('Prerrequisitos de 022/025 ausentes; abortando en modo cerrado (fail closed).');
  }
  return row;
}

// Read-only. Never executes migration or rollback SQL.
export async function verify(execSql) {
  const result = await readStatus(execSql);
  if (result.status !== 'applied') {
    throw new Error(`Verificación falló: el estado estructural actual es "${result.status}", se esperaba "applied".`);
  }
  console.log('VERIFY_OK');
  return result;
}

// Reverse (LIFO) order: 027's rollback runs before 026's. Each rollback file
// has its own fail-closed guard enforcing this order independently.
// Gated on structural presence (not the fully-secure migration026/027
// flags): a migration whose structure exists but whose grants/RLS are
// invalid must still be rolled back, or this becomes the exact no-op that
// silently reported ROLLBACK_OK without touching anything.
export async function rollback(execSql) {
  const before = await readStatus(execSql);
  if (before.structural027) {
    await execSql(readFileSync(ROLLBACK_027, 'utf8'));
  }
  if (before.structural026) {
    await execSql(readFileSync(ROLLBACK_026, 'utf8'));
  }
  const after = await readStatus(execSql);
  if (after.status !== 'pending') {
    throw new Error('Rollback incompleto: aún quedan artefactos estructurales de 026/027.');
  }
  console.log('ROLLBACK_OK');
  return after;
}

export async function apply(execSql) {
  const before = await readStatus(execSql);
  if (before.status === 'applied') {
    console.log('APPLY_SKIPPED_ALREADY_READY');
    return before;
  }
  if (before.status === 'partial') {
    throw new Error('Estado parcial detectado (026/027 a medio aplicar); ejecute rollback antes de reintentar apply.');
  }
  await preflight(execSql);
  try {
    await execSql(readFileSync(MIGRATION_026, 'utf8'));
    await execSql(readFileSync(MIGRATION_027, 'utf8'));
    const result = await verify(execSql);
    console.log('APPLY_OK');
    return result;
  } catch (error) {
    console.error(`APPLY_FAILED ${error.sqlstate || ''} ${error.message}`.trim());
    console.error('AUTO_ROLLBACK_START');
    await rollback(execSql);
    console.error('AUTO_ROLLBACK_OK');
    process.exitCode = 1;
    throw error;
  }
}

// Production's exec_sql RPC runs the SQL it receives via `EXECUTE` inside a
// PL/pgSQL function body; Postgres does not allow transaction-control
// statements (BEGIN/COMMIT/...) through EXECUTE (SQLSTATE 0A000). 026/027's
// migration/rollback files are still written as self-contained top-level
// transactions (for direct psql/PGlite application), so this strips only the
// exact top-level `begin;` ... `commit;` wrapper before the SQL goes out over
// RPC — never touching the canonical files on disk, never touching internal
// (bare, semicolon-less) PL/pgSQL `begin ... end;` blocks, and failing closed
// (throwing) on anything that isn't the exact expected shape rather than
// guessing what to strip. Atomicity is preserved because each migration/
// rollback file is still sent as exactly one RPC call, and a single top-level
// SQL statement already runs inside its own implicit transaction.
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
    throw new Error('exec_sql normalization: formato inesperado. Se esperaba exactamente un "begin;" como primera sentencia y un "commit;" como última sentencia (wrapper transaccional top-level de un archivo de migración/rollback); abortando en modo cerrado sin enviar nada a RPC.');
  }

  return [
    ...lines.slice(0, beginLineIdxs[0]),
    ...lines.slice(beginLineIdxs[0] + 1, commitLineIdxs[0]),
    ...lines.slice(commitLineIdxs[0] + 1),
  ].join('\n').trim();
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

// fetchImpl/baseUrl/serviceKey are test-only injection points; the CLI entry
// point below always calls this with no arguments, which preserves the exact
// original .env.local-loading behavior.
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
    const normalized = stripTopLevelTransactionWrapper(sql.trim()).trim().replace(/;\s*$/, '');
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
    if (!Array.isArray(payload.rows)) {
      console.error(`EXEC_SQL_SHAPE ${JSON.stringify({ status: response.status, keys: Object.keys(payload || {}), ok: payload?.ok, rowsType: typeof payload?.rows, hasError: Boolean(payload?.error), sqlstate: payload?.sqlstate || null })}`);
    }
    return Array.isArray(payload.rows) ? payload.rows : [];
  };
}

async function main() {
  const mode = process.argv[2] || 'status';
  const execSql = createExecSql();
  if (mode === 'status') await readStatus(execSql);
  else if (mode === 'preflight') await preflight(execSql);
  else if (mode === 'verify') await verify(execSql);
  else if (mode === 'rollback') await rollback(execSql);
  else if (mode === 'apply') await apply(execSql);
  else throw new Error('Modo inválido. Use status, preflight, apply, verify o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) {
  main().catch(error => {
    if (!process.exitCode) process.exitCode = 1;
    console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim());
  });
}
