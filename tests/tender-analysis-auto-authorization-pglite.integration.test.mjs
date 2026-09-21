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
// (.hermes/plans/2026-09-21-vigia-document-preselection.md) 087 replaces 036's auto-authorization
// at conversion time with the explicit human freeze of the governed document workset: creation no
// longer stamps analysis_authorized_by/at, and applying it must never touch a job a human already
// authorized under the old (036) contract.
const m087 = strip(readFileSync(new URL('../supabase/migrations/087_tender_processing_human_freeze_authorization.sql', import.meta.url), 'utf8'));

const T = '33333333-3333-4333-8333-333333333333';
const T2 = '44444444-4444-4444-8444-444444444444';
const O = '55555555-5555-4555-8555-555555555555';
const O2 = '77777777-7777-4777-8777-777777777777';
const U = '11111111-1111-4111-8111-111111111111';

async function db({ apply087 } = { apply087: true }) {
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
  `);
  await pg.exec(m017);
  await pg.exec(m032);
  await pg.exec(m033);
  await pg.exec(m034);
  await pg.exec(m035);
  await pg.exec(m036);
  if (apply087) await pg.exec(m087);
  return pg;
}

async function run() {
  // 1) Con todas las migraciones vigentes (incluida 087), una conversión manual
  // válida (psi_create_tender_processing_job) YA NO autoriza el análisis por sí
  // sola: el job nace en 'queued' con analysis_authorized_by/analysis_authorized_at
  // en null. La autorización humana ahora ocurre al congelar el paquete gobernado
  // de documentos, no en el momento de la conversión.
  {
    const pg = await db();
    const created = (await pg.query(`select public.psi_create_tender_processing_job('${T2}','${O2}','v1','k-auto-1','${U}') as r`)).rows[0].r;
    const jobId = created.job_id;
    const row = (await pg.query(`select analysis_authorized_by, analysis_authorized_at, status from public.psi_tender_processing_jobs where id='${jobId}'`)).rows[0];
    assert.equal(row.analysis_authorized_by, null, 'la conversión manual ya no debe autorizar el análisis automáticamente: eso ahora exige congelar el paquete gobernado.');
    assert.equal(row.analysis_authorized_at, null, 'sin congelamiento humano no debe registrarse una autorización.');
    assert.equal(row.status, 'queued');
  }

  // 2) Fail-closed preservado: conocer tender_id/opportunity_id no basta. Si el
  // Radar no fue convertido manualmente y no enlaza ambas filas, la función
  // SECURITY DEFINER debe rechazar el job igual que antes de 087.
  {
    const pg = await db();
    await assert.rejects(
      () => pg.query(`select public.psi_create_tender_processing_job('${T}','${O}','v1','k-not-converted','${U}') as r`),
      /conversión manual válida/i
    );
    const count = (await pg.query(`select count(*)::int c from public.psi_tender_processing_jobs where idempotency_key='k-not-converted'`)).rows[0].c;
    assert.equal(count, 0, 'un caso no convertido no debe crear job ni autorización');
  }

  // 3) No destructivo: un job histórico ya autorizado bajo el contrato de 036
  // (analysis_authorized_by/at fijados en la conversión) debe conservar
  // exactamente su estado y su autorización al aplicar 087. 087 solo cambia el
  // comportamiento de las conversiones futuras, nunca reescribe el historial.
  {
    const pg = await db({ apply087: false });
    const created = (await pg.query(`select public.psi_create_tender_processing_job('${T2}','${O2}','v1','k-historic-auth','${U}') as r`)).rows[0].r;
    const jobId = created.job_id;
    const before = (await pg.query(`select analysis_authorized_by, analysis_authorized_at, status from public.psi_tender_processing_jobs where id='${jobId}'`)).rows[0];
    assert.equal(before.analysis_authorized_by, U, 'precondición: bajo 036 la conversión sí autorizaba automáticamente.');
    assert.ok(before.analysis_authorized_at, 'precondición: bajo 036 debía registrar cuándo quedó autorizado.');
    assert.equal(before.status, 'queued');

    await pg.exec(m087);

    const after = (await pg.query(`select analysis_authorized_by, analysis_authorized_at, status from public.psi_tender_processing_jobs where id='${jobId}'`)).rows[0];
    assert.equal(after.analysis_authorized_by, before.analysis_authorized_by, '087 no debe borrar una autorización humana histórica.');
    assert.equal(String(after.analysis_authorized_at), String(before.analysis_authorized_at), '087 no debe alterar el timestamp histórico de autorización.');
    assert.equal(after.status, before.status, '087 no debe mover el estado de un job histórico ya autorizado.');
  }

  console.log('tender-analysis-human-freeze-authorization pglite integration passed');
}
run();
