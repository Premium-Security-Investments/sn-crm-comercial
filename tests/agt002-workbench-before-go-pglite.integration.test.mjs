// Migración 140 (Juan, 2026-10-20): la Mesa con Vig-IA también antes del GO. Fija la validación nueva: GO vigente o
// licitación por decidir (sin decisión, sin archivar, en prospecto) abren la Mesa; NO GO vigente, archivada, cerrada o
// sin licitación la cierran; y las dos funciones de la 045 usan esa validación y no la del GO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/140_agt002_workbench_before_go.sql', import.meta.url), 'utf8');
const assertOnly = migration.slice(migration.indexOf('create or replace function public.psi_assert_agt002_workbench_open'), migration.indexOf('create or replace function public.psi_get_or_create_agt002_workbench_thread'));

async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_opportunities (id uuid primary key, stage_code text, archived_at timestamptz);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (id uuid primary key default gen_random_uuid(), opportunity_id uuid, tender_id uuid, decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
  `);
  await pg.exec(assertOnly);
  return pg;
}
const O = '10000000-0000-4000-8000-000000000001';
const T = '20000000-0000-4000-8000-000000000001';
const open = (pg, id = O) => pg.query(`select public.psi_assert_agt002_workbench_open('${id}') as t`);

test('por decidir (prospecto, sin decisión, sin archivar) abre la Mesa', async () => {
  const pg = await db();
  await pg.exec(`insert into psi_sales_opportunities values ('${O}', 'prospecto', null); insert into psi_public_tenders values ('${T}', '${O}');`);
  assert.equal((await open(pg)).rows[0].t, T);
  await pg.close();
});

test('un GO vigente abre la Mesa aunque la etapa ya no sea prospecto', async () => {
  const pg = await db();
  await pg.exec(`insert into psi_sales_opportunities values ('${O}', 'en_preparacion', null); insert into psi_public_tenders values ('${T}', '${O}');
    insert into psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision) values ('${O}', '${T}', 'go');`);
  assert.equal((await open(pg)).rows[0].t, T);
  await pg.close();
});

test('NO GO vigente, archivada, cerrada o sin licitación cierran la Mesa', async () => {
  const pg = await db();
  await pg.exec(`insert into psi_sales_opportunities values ('${O}', 'prospecto', null); insert into psi_public_tenders values ('${T}', '${O}');
    insert into psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision) values ('${O}', '${T}', 'no_go');`);
  await assert.rejects(open(pg), /NO GO vigente/);
  await pg.exec(`delete from psi_tender_go_no_go_decisions; update psi_sales_opportunities set archived_at = now();`);
  await assert.rejects(open(pg), /sólo está disponible para licitaciones activas/);
  await pg.exec(`update psi_sales_opportunities set archived_at = null, stage_code = 'perdido';`);
  await assert.rejects(open(pg), /sólo está disponible para licitaciones activas/);
  await assert.rejects(open(pg, '10000000-0000-4000-8000-0000000000ff'), /No existe una licitación vinculada/);
  await pg.close();
});

test('las dos funciones de la Mesa usan la validación nueva; la del expediente no cambia', () => {
  const thread = migration.slice(migration.indexOf('function public.psi_get_or_create_agt002_workbench_thread'), migration.indexOf('function public.psi_append_agt002_workbench_message'));
  const append = migration.slice(migration.indexOf('function public.psi_append_agt002_workbench_message'));
  for (const body of [thread, append]) {
    assert.match(body, /public\.psi_assert_agt002_workbench_open\(p_opportunity_id\)/);
    assert.doesNotMatch(body, /psi_assert_tender_dossier_go/);
  }
  assert.doesNotMatch(migration, /create or replace function public\.psi_assert_tender_dossier_go/);
  const rollback = readFileSync(new URL('../supabase/rollbacks/140_agt002_workbench_before_go_rollback.sql', import.meta.url), 'utf8');
  assert.match(rollback, /psi_assert_tender_dossier_go\(p_opportunity_id\)/);
  assert.match(rollback, /drop function if exists public\.psi_assert_agt002_workbench_open\(uuid\)/);
});
