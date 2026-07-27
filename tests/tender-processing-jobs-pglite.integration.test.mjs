import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/032_tender_processing_jobs.sql', import.meta.url), 'utf8')
  .replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const rollback = readFileSync(new URL('../supabase/rollbacks/032_tender_processing_jobs_rollback.sql', import.meta.url), 'utf8');

const ids = {
  tender: '33333333-3333-4333-8333-333333333333',
  opp: '55555555-5555-4555-8555-555555555555',
  actor: '11111111-1111-4111-8111-111111111111',
};

async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null, microsoft_email text not null);
    create table public.psi_sales_opportunities (id uuid primary key, company_name text not null);
    create table public.psi_public_tenders (id uuid primary key, stable_key text not null unique);
    create table public.psi_tender_document_snapshots (id uuid primary key);
    create table public.psi_tender_analysis_runs (id uuid primary key);
    create table public.psi_tender_document_versions (id uuid primary key);
    insert into public.psi_sales_profiles values ('${ids.actor}', true, 'admin', 'a@x.co');
    insert into public.psi_sales_opportunities values ('${ids.opp}', 'ACME');
    insert into public.psi_public_tenders values ('${ids.tender}', 'k1');
  `);
  await pg.exec(migration);
  return pg;
}

async function run() {
  const pg = await db();
  // Un job queued por oportunidad
  await pg.exec(`insert into public.psi_tender_processing_jobs
    (id, tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by)
    values (gen_random_uuid(), '${ids.tender}', '${ids.opp}', 'v1', 'k-a', 'queued', 'documents', '${ids.actor}');`);

  // Índice parcial: un segundo job ACTIVO para la misma oportunidad debe fallar
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_processing_jobs
      (id, tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by)
      values (gen_random_uuid(), '${ids.tender}', '${ids.opp}', 'v1', 'k-b', 'discovering_documents', 'documents', '${ids.actor}');`),
    /psi_tender_processing_jobs_one_active/,
  );

  // Lease completo o nulo: poblar solo lease_id sin expiración debe fallar el check
  await assert.rejects(
    pg.exec(`update public.psi_tender_processing_jobs set lease_id = gen_random_uuid() where idempotency_key='k-a';`),
    /lease/i,
  );

  // Contadores no negativos
  await assert.rejects(
    pg.exec(`update public.psi_tender_processing_jobs set documents_failed = -1 where idempotency_key='k-a';`),
    /documents_failed/i,
  );

  // idempotency_key único
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_processing_jobs
      (id, tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by)
      values (gen_random_uuid(), '${ids.tender}', '${ids.opp}', 'v1', 'k-a', 'cancelled', 'documents', '${ids.actor}');`),
    /idempotency_key/i,
  );

  // Import items: unique (job_id, source, source_document_id)
  const job = (await pg.query(`select id from public.psi_tender_processing_jobs where idempotency_key='k-a'`)).rows[0].id;
  await pg.exec(`insert into public.psi_tender_document_import_items
    (id, job_id, tender_id, opportunity_id, source, source_document_id, name, status)
    values (gen_random_uuid(), '${job}', '${ids.tender}', '${ids.opp}', 'SECOP II', 'doc-1', 'Pliego', 'pending');`);
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_document_import_items
      (id, job_id, tender_id, opportunity_id, source, source_document_id, name, status)
      values (gen_random_uuid(), '${job}', '${ids.tender}', '${ids.opp}', 'SECOP II', 'doc-1', 'Pliego dup', 'pending');`),
    /import_items/i,
  );

  // Estado inválido rechazado por CHECK
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_document_import_items
      (id, job_id, tender_id, opportunity_id, source, source_document_id, name, status)
      values (gen_random_uuid(), '${job}', '${ids.tender}', '${ids.opp}', 'SECOP II', 'doc-2', 'X', 'bogus');`),
    /status/i,
  );

  // Rollback bloquea jobs activos (fail-closed); cancelar antes de retirar la tabla.
  await pg.exec(`update public.psi_tender_processing_jobs set status='cancelled' where idempotency_key='k-a';`);
  await pg.exec(rollback);
  const remaining = (await pg.query(`select to_regclass('public.psi_tender_processing_jobs') as t`)).rows[0].t;
  assert.equal(remaining, null);

  console.log('tender-processing-jobs pglite integration passed');
}
run();
