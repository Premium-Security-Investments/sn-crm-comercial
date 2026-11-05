// Migración 185 (F16 de la auditoría del piloto Fiscalía): crear un documento de la oferta y subirle versiones ya no
// exige el GO; basta que la licitación esté abierta para la Mesa (140). Un NO GO vigente o una licitación archivada lo
// siguen cerrando. Lo creado antes del GO queda en el expediente y la siembra del GO no lo pisa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const dossier = read('migrations/040_tender_dossier_workspace.sql');
const m140 = read('migrations/140_agt002_workbench_before_go.sql');
const assertOpen = m140.slice(m140.indexOf('create or replace function public.psi_assert_agt002_workbench_open'), m140.indexOf('create or replace function public.psi_get_or_create_agt002_workbench_thread'));
const m185 = read('migrations/185_tender_documentos_antes_del_go.sql');
const r185 = read('rollbacks/185_tender_documentos_antes_del_go_rollback.sql');

const O = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';
const K = '11111111-1111-4111-8111-111111111111';

async function db({ con185 = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', role text not null, full_name text, microsoft_email text);
    create table public.psi_access_permissions (code text primary key, name text not null default '', description text, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null, permission_code text not null, created_at timestamptz not null default now(), created_by uuid, primary key(profile_id, permission_code));
    create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text, stage_code text, archived_at timestamptz);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_tender_go_no_go_decisions (id uuid primary key default gen_random_uuid(), opportunity_id uuid, tender_id uuid, decision text, decided_at timestamptz default now(), supersedes_decision_id uuid);
    insert into public.psi_access_permissions(code) values ('licitaciones'),('licitaciones_custodia');
    insert into public.psi_sales_profiles(id,role,full_name) values ('${K}','comercial','Katherine');
    insert into public.psi_profile_permissions(profile_id,permission_code) values ('${K}','licitaciones');
    insert into public.psi_sales_opportunities(id,stage_code) values ('${O}','prospecto');
    insert into public.psi_public_tenders(id,converted_opportunity_id) values ('${T}','${O}');
  `);
  await pg.exec(dossier);
  await pg.exec(assertOpen);
  if (con185) await pg.exec(m185);
  return pg;
}
const crear = (pg, key = 'observaciones_pliego', title = 'Observaciones al pliego') =>
  pg.query(`select public.psi_create_tender_dossier_artifact($1,$2,$3,$4,false) as r`, [O, K, key, title]);
const version = (pg, artifactId) =>
  pg.query(`select public.psi_add_tender_dossier_artifact_version($1,$2,$3,'texto','OBSERVACIÓN 1…',null) as r`, [O, artifactId, K]);

test('caso Fiscalía: por decidir, sin GO, se crea «Observaciones al pliego» y se le sube una versión', async () => {
  const pg = await db();
  const artifact = (await crear(pg)).rows[0].r.artifact;
  assert.equal(artifact.title, 'Observaciones al pliego');
  assert.ok((await version(pg, artifact.id)).rows[0].r.version_id);
  await pg.close();
});

test('sin la 185 (como hoy) el mismo pedido se rechaza por falta de GO', async () => {
  const pg = await db({ con185: false });
  await assert.rejects(crear(pg), /requiere una decisión GO vigente/);
  await pg.close();
});

test('un NO GO vigente o una licitación archivada siguen cerrando los documentos', async () => {
  const pg = await db();
  await pg.exec(`insert into psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision) values ('${O}','${T}','no_go')`);
  await assert.rejects(crear(pg), /NO GO vigente/);
  await pg.exec(`delete from psi_tender_go_no_go_decisions; update psi_sales_opportunities set archived_at = now()`);
  await assert.rejects(crear(pg), /sólo está disponible para licitaciones activas/);
  await pg.close();
});

test('con el GO, lo creado antes sigue ahí y la siembra no lo pisa', async () => {
  const pg = await db();
  const antes = (await crear(pg)).rows[0].r.artifact;
  await pg.exec(`insert into psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision) values ('${O}','${T}','go'); update psi_sales_opportunities set stage_code = 'en_preparacion'`);
  const otra = (await crear(pg)).rows[0].r.artifact;
  assert.equal(otra.id, antes.id, 'misma clave, mismo documento');
  const filas = (await pg.query(`select count(*)::int n from psi_tender_dossier_artifacts where opportunity_id = $1`, [O])).rows[0].n;
  assert.equal(filas, 1);
  await pg.close();
});

test('permisos sólo para service_role, y la reversa vuelve a exigir el GO', async () => {
  const pg = await db();
  for (const fn of ['psi_create_tender_dossier_artifact', 'psi_add_tender_dossier_artifact_version']) {
    const grants = (await pg.query(`select grantee from information_schema.routine_privileges where routine_name=$1 and privilege_type='EXECUTE'`, [fn])).rows.map(row => row.grantee);
    assert.ok(grants.includes('service_role'));
    for (const role of ['anon', 'authenticated', 'PUBLIC']) assert.ok(!grants.includes(role), `${fn}: ${role}`);
  }
  await pg.exec(r185);
  await assert.rejects(crear(pg), /requiere una decisión GO vigente/);
  await pg.close();
});
