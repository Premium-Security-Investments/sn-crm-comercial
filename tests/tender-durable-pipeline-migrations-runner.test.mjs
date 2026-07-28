import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const modulePath = new URL('../scripts/tender-durable-pipeline-migrations.mjs', import.meta.url);
const mod = await import(modulePath);
const { stripTopLevelTransactionWrapper, MIGRATION_FILES, ROLLBACK_FILES, apply, rollback, verify, preflight } = mod;

// stripTopLevelTransactionWrapper elimina begin;/commit; de nivel superior de 032.
{
  const raw = readFileSync(new URL('../supabase/migrations/032_tender_processing_jobs.sql', import.meta.url), 'utf8');
  const stripped = stripTopLevelTransactionWrapper(raw);
  assert.doesNotMatch(stripped.trim().split(/\r?\n/)[0], /^begin;$/i);
  assert.doesNotMatch(stripped.trim(), /\bcommit;\s*$/i);
  assert.match(stripped, /create table if not exists public\.psi_tender_processing_jobs/);
}

// MIGRATION_FILES lista todo el pipeline durable, incluyendo autorización automática y límites de retry.
assert.deepEqual(MIGRATION_FILES, [
  '032_tender_processing_jobs.sql',
  '033_tender_tracking_events_unified.sql',
  '034_tender_processing_rpc.sql',
  '035_tender_analysis_authorization.sql',
  '036_tender_processing_job_auto_authorization.sql',
  '037_tender_retry_limits.sql',
]);

// ROLLBACK_FILES es el inverso (orden LIFO de aplicación).
assert.deepEqual(ROLLBACK_FILES, [
  '037_tender_retry_limits_rollback.sql',
  '036_tender_processing_job_auto_authorization_rollback.sql',
  '035_tender_analysis_authorization_rollback.sql',
  '034_tender_processing_rpc_rollback.sql',
  '033_tender_tracking_events_unified_rollback.sql',
  '032_tender_processing_jobs_rollback.sql',
]);

// apply(fakeExec) detecta una instalación limpia y aplica las seis migraciones en orden.
{
  const calls = [];
  const state = { m032: false, m033: false, m034: false, m035: false, m036: false, m037: false };
  const fakeExec = async (sql) => {
    calls.push(sql);
    return /as m032/i.test(sql) ? [state] : [];
  };
  await apply(fakeExec);
  assert.equal(calls.length, MIGRATION_FILES.length + 1);
  assert.match(calls[1], /psi_tender_processing_jobs/);
  assert.match(calls[2], /psi_tender_tracking_events/);
  assert.match(calls[3], /psi_create_tender_processing_job/);
  assert.match(calls[4], /psi_append_tender_tracking_event/);
  assert.match(calls[5], /converted_opportunity_id/);
  assert.match(calls[6], /p_next_attempt_at/);
}

// apply incremental: producción con 032-035 presentes solo recibe 036-037.
{
  const calls = [];
  const state = { m032: true, m033: true, m034: true, m035: true, m036: false, m037: false };
  const fakeExec = async (sql) => {
    calls.push(sql);
    return /as m032/i.test(sql) ? [state] : [];
  };
  await apply(fakeExec);
  assert.equal(calls.length, 3);
  assert.match(calls[1], /converted_opportunity_id/);
  assert.match(calls[2], /p_next_attempt_at/);
}

// rollback(fakeExec) invoca fakeExec una vez por rollback, en orden LIFO.
{
  const calls = [];
  const fakeExec = async (sql) => { calls.push(sql); return []; };
  await rollback(fakeExec);
  assert.equal(calls.length, ROLLBACK_FILES.length);
  assert.match(calls[0], /drop function if exists public\.psi_record_tender_import_item/);
  assert.match(calls[1], /analysis_authorized_by/);
  assert.match(calls[5], /psi_tender_processing_jobs/);
}

// verify(execSql) consulta el estado estructural sin ejecutar migraciones/rollbacks.
{
  const fakeExec = async () => ([{
    t_jobs: 'public.psi_tender_processing_jobs',
    t_items: 'public.psi_tender_document_import_items',
    fn_count: '8',
    fn_retry_record: 'psi_record_tender_import_item(uuid,text,text,text,text,text,boolean,uuid,text,text,timestamp with time zone)',
  }]);
  const result = await verify(fakeExec);
  assert.equal(result.ok, true);
}

// verify falla cerrado si 037 no instaló la firma durable de 11 argumentos.
{
  const fakeExec = async () => ([{
    t_jobs: 'public.psi_tender_processing_jobs',
    t_items: 'public.psi_tender_document_import_items',
    fn_count: '8',
    fn_retry_record: null,
  }]);
  const result = await verify(fakeExec);
  assert.equal(result.ok, false);
}

// preflight(execSql) falla cerrado si faltan prerrequisitos.
{
  const fakeExec = async () => ([{ t_tenders: null, t_opportunities: null, t_profiles: null }]);
  await assert.rejects(preflight(fakeExec), /prerrequisito/i);
}

// main() nunca se ejecuta al importar el módulo (solo como CLI directo).
{
  const source = readFileSync(new URL('../scripts/tender-durable-pipeline-migrations.mjs', import.meta.url), 'utf8');
  assert.match(source, /import\.meta\.url === /);
}

console.log('tender durable pipeline migrations runner contract passed');
