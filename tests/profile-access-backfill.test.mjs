import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = new URL('../supabase/migrations/019_profile_area_permissions.sql', import.meta.url);
const migration = readFileSync(migrationPath, 'utf8');

const ids = {
  seguridadFisica: '11111111-1111-4111-8111-111111111111',
  tecnologia: '22222222-2222-4222-8222-222222222222',
  licitacion: '33333333-3333-4333-8333-333333333333',
  historicalTenderEmail: '44444444-4444-4444-8444-444444444444',
  unrelated: '55555555-5555-4555-8555-555555555555',
  inactive: '66666666-6666-4666-8666-666666666666',
};

const scalar = async (db, sql) => (await db.query(sql)).rows[0];

async function createLegacyDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role service_role;
    alter role service_role bypassrls;
    grant service_role to current_user;
    create table public.psi_sales_profiles (
      id uuid primary key,
      role text not null,
      active boolean not null default true,
      microsoft_email text,
      commercial_area text,
      constraint legacy_sales_profile_role_check check (role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador'))
    );
    insert into public.psi_sales_profiles (id, role, active, microsoft_email, commercial_area) values
      ('${ids.seguridadFisica}', 'comercial', true, 'fisica@seguridadnacional.co', 'seguridad_fisica'),
      ('${ids.tecnologia}', 'comercial', true, 'tecnologia@seguridadnacional.co', 'tecnologia'),
      ('${ids.licitacion}', 'comercial', true, 'licitacion@seguridadnacional.co', 'licitacion_publica'),
      ('${ids.historicalTenderEmail}', 'colaborador', true, '  Directora.Licitaciones@SeguridadNacional.co  ', null),
      ('${ids.unrelated}', 'comercial', true, 'sin-acceso@seguridadnacional.co', null),
      ('${ids.inactive}', 'colaborador', false, 'inactiva@seguridadnacional.co', 'tecnologia');
  `);
  return db;
}

async function assignmentsByProfile(db) {
  return (await db.query(`
    select profile_id, area_code, subarea_code
    from public.psi_profile_area_assignments
    order by profile_id, area_code, subarea_code
  `)).rows;
}

async function permissionsByProfile(db) {
  return (await db.query(`
    select profile_id, permission_code
    from public.psi_profile_permissions
    order by profile_id, permission_code
  `)).rows;
}

await (async function backfillsLegacyCommercialAreaAndHistoricalTenderPermissionIdempotently() {
  const db = await createLegacyDatabase();
  const beforeProfiles = (await db.query(`
    select id, role, active, microsoft_email, commercial_area
    from public.psi_sales_profiles
    order by id
  `)).rows;

  await db.exec(migration);

  assert.deepEqual(await assignmentsByProfile(db), [
    { profile_id: ids.seguridadFisica, area_code: 'comercial', subarea_code: 'seguridad_fisica' },
    { profile_id: ids.tecnologia, area_code: 'comercial', subarea_code: 'tecnologia' },
    { profile_id: ids.licitacion, area_code: 'comercial', subarea_code: 'licitaciones' },
    { profile_id: ids.inactive, area_code: 'comercial', subarea_code: 'tecnologia' },
  ].sort((left, right) => left.profile_id.localeCompare(right.profile_id)));
  assert.deepEqual(await permissionsByProfile(db), [
    { profile_id: ids.licitacion, permission_code: 'licitaciones' },
    { profile_id: ids.historicalTenderEmail, permission_code: 'licitaciones' },
  ].sort((left, right) => left.profile_id.localeCompare(right.profile_id)));
  assert.equal(
    (await scalar(db, `select count(*)::int as count from public.psi_profile_area_assignments where profile_id = '${ids.historicalTenderEmail}'`)).count,
    0,
    'la excepción histórica por correo no debe ampliar el alcance organizacional',
  );
  assert.equal(
    (await scalar(db, `select count(*)::int as count from public.psi_profile_area_assignments where profile_id = '${ids.unrelated}'`)).count,
    0,
    'commercial_area NULL/no relevante no debe producir asignaciones',
  );
  assert.equal(
    (await scalar(db, `select count(*)::int as count from public.psi_profile_permissions where profile_id = '${ids.unrelated}'`)).count,
    0,
    'un perfil sin área ni excepción histórica no debe recibir permisos',
  );
  assert.deepEqual(
    await scalar(db, `select active, commercial_area from public.psi_sales_profiles where id = '${ids.inactive}'`),
    { active: false, commercial_area: 'tecnologia' },
    'los perfiles inactivos conservan su configuración legado; runtime sigue controlando active',
  );
  assert.deepEqual(
    (await db.query(`select id, role, active, microsoft_email, commercial_area from public.psi_sales_profiles order by id`)).rows,
    beforeProfiles,
    'el backfill no debe mutar columnas del perfil legado',
  );
  assert.equal((await scalar(db, `select count(*)::int as count from public.psi_access_audit_log`)).count, 0, 'un backfill no debe fingir actor humano en auditoría');

  const firstAssignments = await assignmentsByProfile(db);
  const firstPermissions = await permissionsByProfile(db);
  await db.exec(migration);
  assert.deepEqual(await assignmentsByProfile(db), firstAssignments, 're-ejecutar 019 no debe duplicar assignments');
  assert.deepEqual(await permissionsByProfile(db), firstPermissions, 're-ejecutar 019 no debe duplicar permissions');
  assert.equal(
    (await scalar(db, `
      select count(*)::int as count
      from (
        select profile_id, area_code, subarea_code, count(*)
        from public.psi_profile_area_assignments
        group by profile_id, area_code, subarea_code
        having count(*) > 1
      ) duplicates
    `)).count,
    0,
    'no deben existir assignments duplicados',
  );
  assert.equal(
    (await scalar(db, `
      select count(*)::int as count
      from (
        select profile_id, permission_code, count(*)
        from public.psi_profile_permissions
        group by profile_id, permission_code
        having count(*) > 1
      ) duplicates
    `)).count,
    0,
    'no deben existir permissions duplicados',
  );
  assert.equal((await scalar(db, `select count(*)::int as count from public.psi_access_audit_log`)).count, 0, 'el segundo backfill tampoco debe escribir auditoría');
  await db.close();
})();

assert.match(
  migration,
  /commercial_area.*compatibilidad temporal|compatibilidad temporal.*commercial_area/is,
  '019 debe documentar commercial_area como compatibilidad temporal/read-only',
);

console.log('profile access backfill PGlite contract passed');
