import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = (s) => s.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const m017 = strip(readFileSync(new URL('../supabase/migrations/017_tender_tracking_workflow.sql', import.meta.url), 'utf8'));
const m032 = strip(readFileSync(new URL('../supabase/migrations/032_tender_processing_jobs.sql', import.meta.url), 'utf8'));
const m033 = strip(readFileSync(new URL('../supabase/migrations/033_tender_tracking_events_unified.sql', import.meta.url), 'utf8'));
const m034 = strip(readFileSync(new URL('../supabase/migrations/034_tender_processing_rpc.sql', import.meta.url), 'utf8'));
const m035 = strip(readFileSync(new URL('../supabase/migrations/035_tender_analysis_authorization.sql', import.meta.url), 'utf8'));

const T = '33333333-3333-4333-8333-333333333333';
const O = '55555555-5555-4555-8555-555555555555';
const U = '11111111-1111-4111-8111-111111111111';
const SNAP = '66666666-6666-4666-8666-666666666666';

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
    insert into public.psi_tender_document_snapshots (id, tender_id, opportunity_id) values ('${SNAP}', '${T}', '${O}');
  `);
  await pg.exec(m017);
  await pg.exec(m032);
  await pg.exec(m033);
  await pg.exec(m034);
  await pg.exec(m035);
  return pg;
}

async function run() {
  const pg = await db();

  // Evento humano sin created_by humano
  await assert.rejects(
    pg.query(`select public.psi_append_tender_tracking_event('${T}','case_note','human',null,null,null,null,'x',false)`),
    /humano|human/i,
  );

  // Evento system con created_by no nulo
  await assert.rejects(
    pg.query(`select public.psi_append_tender_tracking_event('${T}','snapshot_published','system','${U}',null,null,null,null,false)`),
    /system|agent/i,
  );

  // Evento singular deduplicado por (event_type, source_ref_type, source_ref_id)
  const s1 = (await pg.query(`select public.psi_append_tender_tracking_event('${T}','snapshot_published','system',null,'snapshot','${SNAP}',null,null,true) as r`)).rows[0].r;
  assert.equal(s1.status, 'created');
  const s2 = (await pg.query(`select public.psi_append_tender_tracking_event('${T}','snapshot_published','system',null,'snapshot','${SNAP}',null,null,true) as r`)).rows[0].r;
  assert.equal(s2.status, 'exists');
  assert.equal((await pg.query(`select count(*)::int c from public.psi_tender_tracking_events where event_type='snapshot_published'`)).rows[0].c, 1);

  // Import item idempotente por (job_id, source, source_document_id)
  const created = (await pg.query(`select public.psi_create_tender_processing_job('${T}','${O}','v1','k1','${U}') as r`)).rows[0].r;
  const JOB_ID = created.job_id;
  await pg.query(`select public.psi_record_tender_import_item('${JOB_ID}','SECOP II','d1',null,'Pliego','imported',false,null,null,null)`);
  await pg.query(`select public.psi_record_tender_import_item('${JOB_ID}','SECOP II','d1',null,'Pliego','unchanged',false,null,null,null)`);
  assert.equal((await pg.query(`select count(*)::int c from public.psi_tender_document_import_items where job_id='${JOB_ID}' and source_document_id='d1'`)).rows[0].c, 1);
  assert.equal((await pg.query(`select status from public.psi_tender_document_import_items where job_id='${JOB_ID}' and source_document_id='d1'`)).rows[0].status, 'unchanged');

  // Autorización de análisis: fija analysis_authorized_by e inserta analysis_queued
  await pg.exec(`update public.psi_tender_processing_jobs set status='awaiting_analysis_authorization', snapshot_id='${SNAP}' where id='${JOB_ID}';`);
  const auth = (await pg.query(`select public.psi_authorize_tender_analysis('${JOB_ID}','${U}') as r`)).rows[0].r;
  assert.equal(auth.status, 'ok');
  assert.ok((await pg.query(`select analysis_authorized_by from public.psi_tender_processing_jobs where id='${JOB_ID}'`)).rows[0].analysis_authorized_by);
  assert.equal((await pg.query(`select status from public.psi_tender_processing_jobs where id='${JOB_ID}'`)).rows[0].status, 'waiting_agent_capacity');
  assert.ok((await pg.query(`select count(*)::int c from public.psi_tender_tracking_events where event_type='analysis_queued'`)).rows[0].c >= 1);

  // Autorización exige perfil humano activo
  await assert.rejects(
    pg.query(`select public.psi_authorize_tender_analysis('${JOB_ID}', gen_random_uuid())`),
    /humano|human/i,
  );

  console.log('tender-analysis-authorization pglite integration passed');
}
run();
