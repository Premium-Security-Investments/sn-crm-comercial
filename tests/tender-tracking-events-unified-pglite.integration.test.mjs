import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = (s) => s.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const base = strip(readFileSync(new URL('../supabase/migrations/017_tender_tracking_workflow.sql', import.meta.url), 'utf8'));
const ext = strip(readFileSync(new URL('../supabase/migrations/033_tender_tracking_events_unified.sql', import.meta.url), 'utf8'));
const rollback = readFileSync(new URL('../supabase/rollbacks/033_tender_tracking_events_unified_rollback.sql', import.meta.url), 'utf8');

const tender = '33333333-3333-4333-8333-333333333333';

async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null, microsoft_email text not null);
    create table public.psi_sales_opportunities (id uuid primary key, company_name text not null);
    create table public.psi_public_tenders (id uuid primary key, stable_key text not null unique, internal_status text not null default 'nueva',
      tracking_owner_id uuid, tracking_status text, tracking_next_action text, tracking_due_at timestamptz, tracking_blocker text,
      tracking_last_note text, tracking_started_at timestamptz, tracking_updated_at timestamptz);
    insert into public.psi_public_tenders (id, stable_key) values ('${tender}', 'k1');
  `);
  await pg.exec(base);
  await pg.exec(ext);
  return pg;
}

async function run() {
  const pg = await db();
  // Preserva y amplía event_type: un evento legado sigue siendo válido
  await pg.exec(`insert into public.psi_tender_tracking_events (id, tender_id, event_type, actor_kind, visibility)
    values (gen_random_uuid(), '${tender}', 'entered_tracking', 'human', 'internal');`);
  // Nuevo tipo de proceso
  await pg.exec(`insert into public.psi_tender_tracking_events (id, tender_id, event_type, actor_kind, source_ref_type, source_ref_id, metadata, visibility)
    values (gen_random_uuid(), '${tender}', 'document_import_completed', 'system', 'job', gen_random_uuid(), '{"imported":38,"failed":2}'::jsonb, 'internal');`);
  // actor_kind inválido rechazado
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_tracking_events (id, tender_id, event_type, actor_kind) values (gen_random_uuid(), '${tender}', 'snapshot_published', 'robot');`),
    /actor_kind/i);
  // event_type desconocido rechazado
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_tracking_events (id, tender_id, event_type, actor_kind) values (gen_random_uuid(), '${tender}', 'not_a_type', 'system');`),
    /event_type/i);
  // Append-only: UPDATE y DELETE bloqueados
  await assert.rejects(pg.exec(`update public.psi_tender_tracking_events set note='x' where tender_id='${tender}';`), /append-only|inmutable|immutable/i);
  await assert.rejects(pg.exec(`delete from public.psi_tender_tracking_events where tender_id='${tender}';`), /append-only|inmutable|immutable/i);
  // Rollback bloquea si ya existen eventos append-only usando columnas/tipos nuevos.
  await assert.rejects(pg.exec(rollback), /Rollback 033 bloqueado/);

  // Rollback limpio: probado en una instancia separada que nunca escribió las
  // capacidades nuevas (append-only impide borrar el evento extendido de arriba).
  const pgClean = await db();
  await pgClean.exec(`insert into public.psi_tender_tracking_events (id, tender_id, event_type, actor_kind, visibility)
    values (gen_random_uuid(), '${tender}', 'entered_tracking', 'human', 'internal');`);
  await pgClean.exec(rollback);
  const cols = (await pgClean.query(`select count(*)::int as c from information_schema.columns
    where table_schema='public' and table_name='psi_tender_tracking_events' and column_name in ('actor_kind','source_ref_type','source_ref_id','metadata','visibility')`)).rows[0].c;
  assert.equal(cols, 0);
  console.log('tender-tracking-events-unified pglite integration passed');
}
run();
