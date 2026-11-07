// Migración 190 — carga inicial de las 21 lecciones de AGT-002 (encargo del 2026-11-06, PR e): entran todas como
// `propuesta`, ninguna activa, en el orden del archivo de semillas; volver a correrla no duplica.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const JUAN = '60b26173-1226-476b-a958-cf2917661432';

test('las 21 semillas entran en propuesta, a nombre de Juan, sin activar ninguna; la segunda corrida no duplica', async () => {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', role text not null, full_name text);
    create table public.psi_access_permissions (code text primary key, name text not null default '', description text, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null, permission_code text not null, created_at timestamptz not null default now(), created_by uuid, primary key(profile_id, permission_code));
    create table public.psi_sales_opportunities (id uuid primary key);
    insert into public.psi_access_permissions(code) values ('licitaciones');
    insert into public.psi_sales_profiles(id,role,full_name) values ('${JUAN}','admin','Juan Botero');
    insert into public.psi_profile_permissions(profile_id,permission_code) values ('${JUAN}','licitaciones');
  `);
  await pg.exec(read('migrations/189_agt002_lecciones_empresa.sql'));
  await pg.exec(read('migrations/190_agt002_lecciones_semilla.sql'));
  await pg.exec(read('migrations/190_agt002_lecciones_semilla.sql'));
  const rows = (await pg.query(`select code, status, category, statement, actor_id, proposed_by_model, source_kind from psi_tender_lessons_current order by code`)).rows;
  assert.equal(rows.length, 21);
  assert.ok(rows.every(row => row.status === 'propuesta' && row.actor_id === JUAN && row.proposed_by_model && row.source_kind === 'carga_inicial'));
  assert.equal(rows[0].code, 'L-01');
  assert.match(rows[0].statement, /^Agencia no es sucursal/);
  assert.equal(rows[0].category, 'sede_agencia');
  assert.equal(rows[20].code, 'L-21');
  assert.equal(rows[20].category, 'competencia');
  assert.equal(new Set(rows.map(row => row.category)).size, 12);
  await pg.close();
});
