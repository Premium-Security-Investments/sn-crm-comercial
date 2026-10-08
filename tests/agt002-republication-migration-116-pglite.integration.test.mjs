// AGT-002 · migración 116 (procesos SECOP II republicados) — ejecuta el SQL real en PGlite: retiro de versiones
// documentales como historial y append atómico de avisos en observaciones, más su rollback.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIGRATION = sql('../supabase/migrations/116_agt002_retire_republished_tender_documents.sql');
const ROLLBACK = sql('../supabase/rollbacks/116_agt002_retire_republished_tender_documents_rollback.sql');
const OPP = '00000000-0000-4000-8000-000000000001';
const OTHER_OPP = '00000000-0000-4000-8000-000000000009';
const TENDER = '00000000-0000-4000-8000-000000000002';
const VIGIA = 'a0020000-0000-4000-8000-000000000002';
const INACTIVE = '00000000-0000-4000-8000-000000000003';

async function database() {
  const db = new PGlite();
  // Esquema mínimo de las tablas y la función que la migración usa (definidas en 005/026/057).
  await db.exec(`
    create role service_role; create role authenticated; create role anon;
    create table public.psi_sales_profiles(id uuid primary key, active boolean, identity_type text);
    create table public.psi_public_tenders(id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_sales_opportunities(id uuid primary key, observaciones text);
    create table public.psi_tender_document_versions(id serial primary key, opportunity_id uuid, source text, name text, current boolean);
    create function public.psi_normalize_tender_document_name(p_name text) returns text language sql immutable
      as $$ select lower(regexp_replace(btrim(p_name), '\\s+', ' ', 'g')) $$;
    insert into public.psi_sales_profiles values ('${VIGIA}', true, 'agent'), ('${INACTIVE}', false, 'human');
    insert into public.psi_public_tenders values ('${TENDER}', '${OPP}');
    insert into public.psi_sales_opportunities values ('${OPP}', 'Link fuente: https://x'), ('${OTHER_OPP}', null);
    insert into public.psi_tender_document_versions(opportunity_id, source, name, current) values
      ('${OPP}', 'secop ii', 'Aviso anterior.pdf', true),
      ('${OPP}', 'secop ii', 'Pliego.pdf', true),
      ('${OPP}', 'secop ii', 'Pliego v0.pdf', false),
      ('${OPP}', 'manual', 'Propuesta interna.docx', true),
      ('${OTHER_OPP}', 'secop ii', 'Otro.pdf', true);
  `);
  await db.exec(MIGRATION);
  return db;
}

const retire = (db, keep, actor = VIGIA, tender = TENDER) => db.query(
  'select public.psi_retire_tender_document_versions($1, $2, $3, $4, $5) as retired', [OPP, tender, 'SECOP II', keep, actor],
);

test('psi_retire_tender_document_versions: sólo retira (current=false) la fuente oficial fuera del conjunto nuevo', async () => {
  const db = await database();
  assert.equal((await retire(db, ['PLIEGO.pdf ', 'Anexo nuevo.pdf'])).rows[0].retired, 1);
  const rows = (await db.query('select opportunity_id, source, name, current from public.psi_tender_document_versions order by id')).rows;
  assert.deepEqual(rows.map(row => [row.name, row.current]), [
    ['Aviso anterior.pdf', false], ['Pliego.pdf', true], ['Pliego v0.pdf', false], ['Propuesta interna.docx', true], ['Otro.pdf', true],
  ], 'nada se borra; las cargas manuales y otras oportunidades no se tocan');
  assert.equal((await retire(db, ['Pliego.pdf'])).rows[0].retired, 0, 'idempotente');
  await assert.rejects(retire(db, []), /no puede estar vacío/);
  await assert.rejects(retire(db, ['', '  ']), /no puede estar vacío/);
  await assert.rejects(retire(db, ['Pliego.pdf'], INACTIVE), /actor/);
  await assert.rejects(retire(db, ['Pliego.pdf'], VIGIA, '00000000-0000-4000-8000-0000000000ff'), /no corresponde/);
});

test('psi_append_opportunity_observation_line: agrega una sola vez, sin reescribir lo existente', async () => {
  const db = await database();
  const append = (opportunity, line) => db.query('select public.psi_append_opportunity_observation_line($1, $2) as appended', [opportunity, line]);
  assert.equal((await append(OPP, 'Aviso A')).rows[0].appended, true);
  assert.equal((await append(OPP, 'Aviso A')).rows[0].appended, false);
  assert.equal((await append(OPP, 'Aviso B')).rows[0].appended, true);
  assert.equal((await append(OTHER_OPP, 'Aviso A')).rows[0].appended, true, 'observaciones vacías');
  const rows = (await db.query('select id, observaciones from public.psi_sales_opportunities order by id')).rows;
  assert.deepEqual(rows.map(row => row.observaciones), ['Link fuente: https://x\nAviso A\nAviso B', 'Aviso A']);
  await assert.rejects(append(OPP, 'dos\nlíneas'), /sin saltos/);
  await assert.rejects(append(OPP, '   '), /no vacía/);
});

test('las funciones quedan sólo para service_role y el rollback las elimina', async () => {
  const db = await database();
  const grants = (await db.query(`select routine_name, grantee from information_schema.routine_privileges
    where routine_name in ('psi_retire_tender_document_versions', 'psi_append_opportunity_observation_line') and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC')
    order by routine_name, grantee`)).rows;
  assert.deepEqual(grants.map(row => `${row.routine_name}:${row.grantee}`), [
    'psi_append_opportunity_observation_line:service_role', 'psi_retire_tender_document_versions:service_role',
  ]);
  await db.exec(ROLLBACK);
  const left = (await db.query(`select proname from pg_proc where proname in ('psi_retire_tender_document_versions', 'psi_append_opportunity_observation_line')`)).rows;
  assert.deepEqual(left, []);
  const versions = (await db.query('select count(*)::int as n from public.psi_tender_document_versions')).rows[0].n;
  assert.equal(versions, 5, 'el rollback no toca las versiones');
});
