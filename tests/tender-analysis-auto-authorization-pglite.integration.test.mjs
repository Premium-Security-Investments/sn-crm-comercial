import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = (s) => s.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const m017 = strip(readFileSync(new URL('../supabase/migrations/017_tender_tracking_workflow.sql', import.meta.url), 'utf8'));
const m032 = strip(readFileSync(new URL('../supabase/migrations/032_tender_processing_jobs.sql', import.meta.url), 'utf8'));
const m033 = strip(readFileSync(new URL('../supabase/migrations/033_tender_tracking_events_unified.sql', import.meta.url), 'utf8'));
const m034 = strip(readFileSync(new URL('../supabase/migrations/034_tender_processing_rpc.sql', import.meta.url), 'utf8'));
const m035 = strip(readFileSync(new URL('../supabase/migrations/035_tender_analysis_authorization.sql', import.meta.url), 'utf8'));
const m036 = strip(readFileSync(new URL('../supabase/migrations/036_tender_processing_job_auto_authorization.sql', import.meta.url), 'utf8'));

const T = '33333333-3333-4333-8333-333333333333';
const T2 = '44444444-4444-4444-8444-444444444444';
const O = '55555555-5555-4555-8555-555555555555';
const O2 = '77777777-7777-4777-8777-777777777777';
const U = '11111111-1111-4111-8111-111111111111';
const SNAP = '66666666-6666-4666-8666-666666666666';

async function db({ applyM036 } = { applyM036: true }) {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null, microsoft_email text not null);
    create table public.psi_sales_opportunities (id uuid primary key, company_name text not null);
    create table public.psi_public_tenders (id uuid primary key, stable_key text not null unique, internal_status text not null default 'nueva',
      converted_opportunity_id uuid,
      tracking_owner_id uuid, tracking_status text, tracking_next_action text, tracking_due_at timestamptz, tracking_blocker text,
      tracking_last_note text, tracking_started_at timestamptz, tracking_updated_at timestamptz);
    create table public.psi_tender_document_snapshots (id uuid primary key default gen_random_uuid(), tender_id uuid, opportunity_id uuid);
    create table public.psi_tender_analysis_runs (id uuid primary key default gen_random_uuid(), tender_id uuid, opportunity_id uuid);
    create table public.psi_tender_document_versions (id uuid primary key default gen_random_uuid());
    insert into public.psi_sales_profiles values ('${U}', true, 'admin', 'a@x.co');
    insert into public.psi_sales_opportunities values ('${O}', 'ACME'), ('${O2}', 'ACME 2');
    insert into public.psi_public_tenders (id, stable_key, internal_status, converted_opportunity_id) values
      ('${T}', 'k1', 'nueva', null),
      ('${T2}', 'k2', 'convertida_oportunidad', '${O2}');
    insert into public.psi_tender_document_snapshots (id, tender_id, opportunity_id) values ('${SNAP}', '${T2}', '${O2}');
  `);
  await pg.exec(m017);
  await pg.exec(m032);
  await pg.exec(m033);
  await pg.exec(m034);
  await pg.exec(m035);
  if (applyM036) await pg.exec(m036);
  return pg;
}

async function run() {
  // 1) Una conversión manual válida (psi_create_tender_processing_job) debe
  // autorizar automáticamente el análisis: sin llamar a
  // psi_authorize_tender_analysis, el job creado ya debe traer
  // analysis_authorized_by/analysis_authorized_at fijados al mismo actor que
  // convirtió (mismo gate de custodia que exige AI_ANALYSIS_RUN). Este es el
  // "segundo clic" redundante que se elimina.
  {
    const pg = await db();
    const created = (await pg.query(`select public.psi_create_tender_processing_job('${T2}','${O2}','v1','k-auto-1','${U}') as r`)).rows[0].r;
    const jobId = created.job_id;
    const row = (await pg.query(`select analysis_authorized_by, analysis_authorized_at, status from public.psi_tender_processing_jobs where id='${jobId}'`)).rows[0];
    assert.equal(row.analysis_authorized_by, U, 'la conversión manual debe autorizar el análisis automáticamente, sin un segundo clic humano');
    assert.ok(row.analysis_authorized_at, 'debe registrar cuándo quedó autorizado');
    assert.equal(row.status, 'queued');
  }

  // 1b) Fail-closed real: conocer tender_id/opportunity_id no basta. Si el
  // Radar no fue convertido manualmente y no enlaza ambas filas, la función
  // SECURITY DEFINER debe rechazar el job antes de autoautorizarlo.
  {
    const pg = await db();
    await assert.rejects(
      () => pg.query(`select public.psi_create_tender_processing_job('${T}','${O}','v1','k-not-converted','${U}') as r`),
      /conversión manual válida/i
    );
    const count = (await pg.query(`select count(*)::int c from public.psi_tender_processing_jobs where idempotency_key='k-not-converted'`)).rows[0].c;
    assert.equal(count, 0, 'un caso no convertido no debe crear job ni autorización');
  }

  // 2) El backfill real: aplicar 036 contra una fila histórica ya varada
  // (creada antes del fix, sin analysis_authorized_by) debe avanzarla a
  // waiting_agent_capacity y fijar analysis_authorized_by = requested_by,
  // sin crear filas nuevas.
  {
    const pg = await db({ applyM036: false });
    await pg.exec(`
      insert into public.psi_tender_processing_jobs
        (id, tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by, snapshot_id)
      values
        ('99999999-9999-4999-8999-999999999999', '${T2}', '${O2}', 'v1', 'k-historic-2', 'awaiting_analysis_authorization', 'analysis', '${U}', '${SNAP}');
    `);
    const beforeCount = (await pg.query(`select count(*)::int c from public.psi_tender_processing_jobs`)).rows[0].c;
    await pg.exec(m036);
    const afterCount = (await pg.query(`select count(*)::int c from public.psi_tender_processing_jobs`)).rows[0].c;
    assert.equal(beforeCount, afterCount, 'el backfill no debe crear jobs ni runs duplicados');
    const row = (await pg.query(`select status, analysis_authorized_by, analysis_authorized_at from public.psi_tender_processing_jobs where id='99999999-9999-4999-8999-999999999999'`)).rows[0];
    assert.equal(row.status, 'waiting_agent_capacity', 'el job histórico varado debe avanzar sin un segundo clic humano');
    assert.equal(row.analysis_authorized_by, U);
    assert.ok(row.analysis_authorized_at);
  }

  // 3) Fail-closed preservado: un job histórico sin snapshot vigente (aún
  // importando documentos) NO debe avanzar de estado por el backfill, aunque
  // se le complete analysis_authorized_by para auditoría.
  {
    const pg = await db({ applyM036: false });
    await pg.exec(`
      insert into public.psi_tender_processing_jobs
        (id, tender_id, opportunity_id, pipeline_version, idempotency_key, status, current_step, requested_by, snapshot_id)
      values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${T2}', '${O2}', 'v1', 'k-historic-3', 'importing_documents', 'documents', '${U}', null);
    `);
    await pg.exec(m036);
    const row = (await pg.query(`select status from public.psi_tender_processing_jobs where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`)).rows[0];
    assert.equal(row.status, 'importing_documents', 'sin snapshot vigente el job debe seguir fail-closed, sin saltar a análisis');
  }

  console.log('tender-analysis-auto-authorization pglite integration passed');
}
run();
