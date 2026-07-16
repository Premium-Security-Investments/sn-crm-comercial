import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { MODULE_PERMISSION_CODES, eligibleModulePermissions } from '../module-access.js';

const migrationPath = new URL('../supabase/migrations/021_explicit_user_modules.sql', import.meta.url);
const rollbackPath = new URL('../supabase/rollbacks/021_explicit_user_modules_rollback.sql', import.meta.url);
assert.equal(existsSync(migrationPath), true, 'La migración 021 debe existir.');
assert.equal(existsSync(rollbackPath), true, 'El rollback 021 debe existir.');

const db = new PGlite();
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  gerencia: '22222222-2222-4222-8222-222222222222',
  director: '33333333-3333-4333-8333-333333333333',
  comercial: '44444444-4444-4444-8444-444444444444',
  colaborador: '55555555-5555-4555-8555-555555555555',
  junta: '66666666-6666-4666-8666-666666666666',
  future: '77777777-7777-4777-8777-777777777777',
};

await db.exec(`
  create role authenticated;
  create role service_role;
  alter role service_role bypassrls;
  grant service_role to current_user;
  create table public.psi_sales_profiles (
    id uuid primary key,
    full_name text not null,
    microsoft_email text not null unique,
    role text not null,
    active boolean not null default true
  );
  create table public.psi_access_permissions (
    code text primary key,
    name text not null,
    description text,
    active boolean not null default true
  );
  create table public.psi_profile_permissions (
    profile_id uuid not null references public.psi_sales_profiles(id) on delete cascade,
    permission_code text not null references public.psi_access_permissions(code) on delete restrict,
    created_at timestamptz not null default now(),
    primary key (profile_id, permission_code)
  );
  insert into public.psi_sales_profiles(id,full_name,microsoft_email,role) values
    ('${ids.admin}','Admin','admin@example.test','admin'),
    ('${ids.gerencia}','Gerencia','gerencia@example.test','gerencia'),
    ('${ids.director}','Director','director@example.test','director'),
    ('${ids.comercial}','Comercial','comercial@example.test','comercial'),
    ('${ids.colaborador}','Colaborador','colaborador@example.test','colaborador'),
    ('${ids.junta}','Junta','directora.licitaciones@seguridadnacional.co','junta');
  insert into public.psi_access_permissions(code,name,description) values
    ('licitaciones','Licitaciones','Permiso existente');
  insert into public.psi_profile_permissions(profile_id,permission_code) values
    ('${ids.admin}','licitaciones'),
    ('${ids.comercial}','licitaciones');
  revoke all on public.psi_access_permissions, public.psi_profile_permissions from public;
  revoke all on public.psi_access_permissions, public.psi_profile_permissions from authenticated;
  grant all on public.psi_access_permissions, public.psi_profile_permissions to service_role;
`);

// Reproduce a profile committed after the migration's initial snapshot but while
// its first backfill INSERT is running. Without one materialized snapshot, later
// backfill statements can see this admin and grant it their modules.
await db.exec(`
  create function public.insert_future_profile_during_backfill()
  returns trigger
  language plpgsql
  as $$
  begin
    if not exists (select 1 from public.psi_sales_profiles where id = '${ids.future}') then
      insert into public.psi_sales_profiles(id,full_name,microsoft_email,role)
      values ('${ids.future}','Futuro','future@example.test','admin');
    end if;
    return new;
  end;
  $$;
  create trigger insert_future_profile_during_backfill
  before insert on public.psi_profile_permissions
  for each row execute function public.insert_future_profile_during_backfill();
`);

await db.exec(readFileSync(migrationPath, 'utf8'));

await db.exec(`drop trigger insert_future_profile_during_backfill on public.psi_profile_permissions;`);

const catalog = await db.query(`select code, active from public.psi_access_permissions where code = any($1::text[]) order by code`, [MODULE_PERMISSION_CODES]);
assert.deepEqual(catalog.rows.map(row => row.code), [...MODULE_PERMISSION_CODES].sort(), '021 registra todos los módulos del catálogo compartido');
assert.ok(catalog.rows.every(row => row.active === true), 'todos los módulos quedan activos');

const permissionsFor = async profileId => (await db.query(
  `select permission_code from public.psi_profile_permissions where profile_id=$1 order by permission_code`, [profileId],
)).rows.map(row => row.permission_code);

assert.deepEqual(await permissionsFor(ids.admin), [...eligibleModulePermissions('admin')].sort(), 'admin histórico conserva todos los módulos elegibles incluido Usuarios');
assert.deepEqual(await permissionsFor(ids.gerencia), [...eligibleModulePermissions('gerencia')].filter(code => code !== 'licitaciones').sort(), 'gerencia recibe solo visibilidad legacy dentro de su techo');
assert.deepEqual(await permissionsFor(ids.director), [...eligibleModulePermissions('director')].filter(code => code !== 'licitaciones').sort(), 'director recibe solo visibilidad legacy dentro de su techo');
assert.equal((await permissionsFor(ids.director)).includes('modulo_siio_gerencial'), true, 'director histórico recibe el módulo explícito; el scope se aplica por acción');
assert.deepEqual(await permissionsFor(ids.comercial), [...eligibleModulePermissions('comercial')].sort(), 'comercial conserva Licitaciones existente y recibe sus módulos legacy');
assert.deepEqual(await permissionsFor(ids.colaborador), [...eligibleModulePermissions('colaborador')].sort(), 'colaborador recibe únicamente módulos legacy compatibles');
assert.deepEqual(await permissionsFor(ids.junta), ['modulo_siio_gerencial'], 'junta recibe únicamente SIIO ejecutivo; el email no concede Licitaciones ni otros módulos');

assert.deepEqual(await permissionsFor(ids.future), [], 'un perfil creado después del snapshot inicial y durante el backfill no recibe módulos');
assert.equal(Number((await db.query(`select count(*)::int as count from pg_trigger where tgrelid='public.psi_profile_permissions'::regclass and not tgisinternal`)).rows[0].count), 0, 'no existe trigger que conceda módulos');
for (const table of ['psi_access_permissions', 'psi_profile_permissions']) {
  for (const privilege of ['insert', 'update', 'delete']) {
    assert.equal((await db.query(`select has_table_privilege('authenticated',$1,$2) as allowed`, [`public.${table}`, privilege])).rows[0].allowed, false, `${table}: authenticated no tiene ${privilege}`);
  }
}

await db.exec(readFileSync(rollbackPath, 'utf8'));
assert.deepEqual(await permissionsFor(ids.comercial), ['licitaciones'], 'rollback conserva Licitaciones existente');
assert.equal(Number((await db.query(`select count(*)::int as count from public.psi_access_permissions where code like 'modulo_%'`)).rows[0].count), 0, 'rollback solo retira catálogo modulo_*');
await db.close();
console.log('module permissions migration PGlite contract passed');
