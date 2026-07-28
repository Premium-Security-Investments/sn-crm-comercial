import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = (s) => s.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const m017 = strip(readFileSync(new URL('../supabase/migrations/017_tender_tracking_workflow.sql', import.meta.url), 'utf8'));
const m032 = strip(readFileSync(new URL('../supabase/migrations/032_tender_processing_jobs.sql', import.meta.url), 'utf8'));
const m033 = strip(readFileSync(new URL('../supabase/migrations/033_tender_tracking_events_unified.sql', import.meta.url), 'utf8'));
const m034 = strip(readFileSync(new URL('../supabase/migrations/034_tender_processing_rpc.sql', import.meta.url), 'utf8'));
const m035 = strip(readFileSync(new URL('../supabase/migrations/035_tender_analysis_authorization.sql', import.meta.url), 'utf8'));
const m037 = strip(readFileSync(new URL('../supabase/migrations/037_tender_retry_limits.sql', import.meta.url), 'utf8'));

const T = '33333333-3333-4333-8333-333333333333';
const O = '55555555-5555-4555-8555-555555555555';
const U = '11111111-1111-4111-8111-111111111111';

async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null, microsoft_email text not null);
    create table public.psi_sales_opportunities (id uuid primary key, company_name text not null);
    create table public.psi_public_tenders (id uuid primary key, stable_key text not null unique, internal_status text not null default 'nueva',
      tracking_owner_id uuid, tracking_status text, tracking_next_action text, tracking_due_at timestamptz, tracking_blocker text,
      tracking_last_note text, tracking_started_at timestamptz, tracking_updated_at timestamptz);
    create table public.psi_tender_document_snapshots (id uuid primary key default gen_random_uuid(), tender_id uuid, opportunity_id uuid);
    create table public.psi_tender_analysis_runs (id uuid primary key default gen_random_uuid(), tender_id uuid, opportunity_id uuid);
    create table public.psi_tender_document_versions (id uuid primary key default gen_random_uuid());
    insert into public.psi_sales_profiles values ('${U}', true, 'admin', 'a@x.co');
    insert into public.psi_sales_opportunities values ('${O}', 'ACME');
    insert into public.psi_public_tenders (id, stable_key) values ('${T}', 'k1');
  `);
  await pg.exec(m017);
  await pg.exec(m032);
  await pg.exec(m033);
  await pg.exec(m034);
  await pg.exec(m035);
  await pg.exec(m037);
  return pg;
}

async function run() {
  const pg = await db();

  const a = (await pg.query(`select public.psi_create_tender_processing_job('${T}','${O}','v1','k1','${U}') as r`)).rows[0].r;
  assert.equal(a.status, 'created');
  const b = (await pg.query(`select public.psi_create_tender_processing_job('${T}','${O}','v1','k1','${U}') as r`)).rows[0].r;
  assert.equal(a.job_id, b.job_id);
  assert.equal(b.status, 'existing');

  assert.equal((await pg.query(`select count(*)::int c from public.psi_tender_processing_jobs where opportunity_id='${O}' and status not in ('completed','cancelled')`)).rows[0].c, 1);
  assert.ok((await pg.query(`select count(*)::int c from public.psi_tender_tracking_events where event_type='pipeline_queued'`)).rows[0].c >= 1);
  assert.ok((await pg.query(`select count(*)::int c from public.psi_tender_tracking_events where event_type='converted'`)).rows[0].c >= 1);

  const claim1 = (await pg.query(`select public.psi_claim_tender_processing_job(60) as r`)).rows[0].r;
  assert.equal(claim1.status, 'claimed');
  assert.equal(claim1.job_id, a.job_id);

  const claim2 = (await pg.query(`select public.psi_claim_tender_processing_job(60) as r`)).rows[0].r;
  assert.equal(claim2.status, 'empty');

  await pg.exec(`update public.psi_tender_processing_jobs set lease_expires_at = now() - interval '1 second' where id='${a.job_id}';`);
  const claim3 = (await pg.query(`select public.psi_claim_tender_processing_job(60) as r`)).rows[0].r;
  assert.equal(claim3.status, 'claimed');
  assert.equal(claim3.job_id, a.job_id);

  const upd = (await pg.query(`select public.psi_update_tender_processing_job('${a.job_id}', '${claim3.lease_id}', '{"status":"discovering_documents","current_step":"documents"}'::jsonb) as r`)).rows[0].r;
  assert.equal(upd.status, 'ok');
  assert.equal((await pg.query(`select status from public.psi_tender_processing_jobs where id='${a.job_id}'`)).rows[0].status, 'discovering_documents');

  await assert.rejects(pg.query(`select public.psi_update_tender_processing_job('${a.job_id}', gen_random_uuid(), '{"status":"needs_attention"}'::jsonb)`), /lease/i);

  const retryAt = '2030-01-01T00:00:00Z';
  for (let i = 0; i < 2; i += 1) {
    await pg.query(`select public.psi_record_tender_import_item(
      '${a.job_id}','SECOP II','doc-retry','https://example/doc','Pliego.pdf','failed_retryable',true,null,
      'TENDER_DOC_SOURCE_UNAVAILABLE','mantenimiento','${retryAt}'::timestamptz
    )`);
  }
  let item = (await pg.query(`select attempt_count, next_attempt_at from public.psi_tender_document_import_items where job_id='${a.job_id}' and source_document_id='doc-retry'`)).rows[0];
  assert.equal(item.attempt_count, 2);
  assert.equal(new Date(item.next_attempt_at).toISOString(), '2030-01-01T00:00:00.000Z');

  await pg.query(`select public.psi_record_tender_import_item(
    '${a.job_id}','SECOP II','doc-retry','https://example/doc','Pliego.pdf','imported',true,null,
    null,null,null
  )`);
  item = (await pg.query(`select attempt_count, next_attempt_at from public.psi_tender_document_import_items where job_id='${a.job_id}' and source_document_id='doc-retry'`)).rows[0];
  assert.equal(item.attempt_count, 2, 'la recuperación conserva el historial de intentos');
  assert.equal(item.next_attempt_at, null, 'la recuperación limpia el backoff');

  console.log('tender-processing-rpc pglite integration passed');
}
run();
