// AGT-006 · Usuarios y permisos → "Acceso a Programación" (migración 129).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration129 = strip(readFileSync(new URL('../supabase/migrations/129_programacion_access_admin.sql', import.meta.url), 'utf8'));
const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';

async function createDatabase({ withProgramacion = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    create table public.psi_sales_profiles (id uuid primary key, identity_type text default 'human');
    create table public.psi_access_audit_log (id serial primary key, actor_profile_id uuid, target_profile_id uuid, action text not null, before_state jsonb, after_state jsonb);
    insert into public.psi_sales_profiles values ('${ADMIN}', 'human'), ('${PERSON}', 'human'), ('${AGENT}', 'agent');
  `);
  if (withProgramacion) {
    await pg.exec(`
      create schema programacion;
      create table programacion.ciudades (id text primary key, nombre text not null);
      insert into programacion.ciudades values ('pereira', 'Pereira'), ('medellin', 'Medellín');
      create table programacion.accesos (
        profile_id uuid primary key references public.psi_sales_profiles(id),
        rol text not null check (rol in ('admin', 'coordinador', 'nomina', 'consulta')),
        ciudad_id text references programacion.ciudades(id),
        activo boolean not null default true,
        creado_por uuid,
        creado_en timestamptz not null default now(),
        actualizado_en timestamptz not null default now()
      );
      insert into programacion.accesos (profile_id, rol, ciudad_id) values ('${ADMIN}', 'admin', null);
    `);
  }
  await pg.exec(migration129);
  return pg;
}
const set = (pg, profile, rol, ciudad) => pg.query('select public.psi_admin_set_programacion_access($1, $2, $3, $4) as r', [profile, rol, ciudad, ADMIN]).then(x => x.rows[0].r);
const audits = pg => pg.query("select before_state, after_state from public.psi_access_audit_log where action = 'profile.programacion_access.set' order by id").then(x => x.rows);

test('da, cambia y quita el acceso, con auditoría solo cuando cambia', async () => {
  const pg = await createDatabase();
  assert.deepEqual(await set(pg, PERSON, 'coordinador', 'pereira'), { profile_id: PERSON, rol: 'coordinador', ciudad_id: 'pereira', activo: true });
  await set(pg, PERSON, 'coordinador', 'pereira');
  assert.equal((await audits(pg)).length, 1, 'repetir el mismo acceso no audita');
  const row = (await pg.query('select rol, ciudad_id, activo, creado_por from programacion.accesos where profile_id = $1', [PERSON])).rows[0];
  assert.deepEqual(row, { rol: 'coordinador', ciudad_id: 'pereira', activo: true, creado_por: ADMIN });
  await set(pg, PERSON, 'nomina', '');
  assert.equal((await pg.query('select ciudad_id from programacion.accesos where profile_id = $1', [PERSON])).rows[0].ciudad_id, null, 'vacío = todas las ciudades');
  await set(pg, PERSON, null, null);
  assert.equal((await pg.query('select activo from programacion.accesos where profile_id = $1', [PERSON])).rows[0].activo, false);
  await set(pg, PERSON, null, null);
  assert.equal((await audits(pg)).length, 3);
  const list = (await pg.query('select public.psi_admin_programacion_access_list() as r')).rows[0].r;
  assert.equal(list.ciudades.length, 2);
  assert.equal(list.accesos.length, 2);
});

test('sin acceso previo y "sin acceso" no crea fila ni audita', async () => {
  const pg = await createDatabase();
  await set(pg, PERSON, null, null);
  assert.equal((await pg.query('select count(*)::int n from programacion.accesos where profile_id = $1', [PERSON])).rows[0].n, 0);
  assert.equal((await audits(pg)).length, 0);
});

test('rechaza rol o ciudad inválidos, agentes y quitar al último administrador', async () => {
  const pg = await createDatabase();
  await assert.rejects(set(pg, PERSON, 'jefe', null), /Rol de Programación inválido/);
  await assert.rejects(set(pg, PERSON, 'consulta', 'cali'), /Ciudad de Programación inválida/);
  await assert.rejects(set(pg, AGENT, 'consulta', null), /identidades de agentes/);
  await assert.rejects(set(pg, ADMIN, 'coordinador', null), /último administrador/);
  await assert.rejects(set(pg, ADMIN, null, null), /último administrador/);
  await set(pg, PERSON, 'admin', null);
  await set(pg, ADMIN, 'coordinador', 'pereira');
});

test('solo service_role puede ejecutar las funciones', async () => {
  const pg = await createDatabase();
  for (const fn of ['psi_admin_programacion_access_list()', 'psi_admin_set_programacion_access(uuid,text,text,uuid)']) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await pg.query(`select has_function_privilege('${role}', 'public.${fn}', 'execute') ok`)).rows[0].ok, false, `${role} ${fn}`);
    }
    assert.equal((await pg.query(`select has_function_privilege('service_role', 'public.${fn}', 'execute') ok`)).rows[0].ok, true);
  }
});

test('sin esquema programacion la migración no falla ni crea funciones', async () => {
  const pg = await createDatabase({ withProgramacion: false });
  assert.equal((await pg.query("select count(*)::int n from pg_proc where proname like 'psi_admin_%programacion%'")).rows[0].n, 0);
});

test('servidor y pantalla: el campo solo se envía y guarda cuando la lista cargó', () => {
  assert.match(serverSource, /app\.get\('\/api\/programacion-access'[\s\S]{0,300}requireAction\(currentProfile, ACTIONS\.USERS_MANAGE/);
  assert.match(serverSource, /programacionAccess\.present \? await persistProgramacionAccess/);
  assert.equal(serverSource.match(/programacion_access_warning: programacionAccessWarning/g)?.length, 2, 'POST y PATCH devuelven el aviso');
  assert.match(uiSource, /progAccess\.status === 'ready' \? \{ \.\.\.payloadBase, programacion_access: programacionAccess \?\? null \} : payloadBase/);
  assert.match(uiSource, /<label>Acceso a Programación<select/);
});
