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
  duplicateTenderEmail: '77777777-7777-4777-8777-777777777777',
};

const scalar = async (db, sql) => (await db.query(sql)).rows[0];

async function createLegacyDatabase({ hasCommercialArea = true, hasMicrosoftEmail = true, rows } = {}) {
  const db = new PGlite();
  const columns = [
    'id uuid primary key',
    'role text not null',
    'active boolean not null default true',
    hasMicrosoftEmail && 'microsoft_email text',
    hasCommercialArea && 'commercial_area text',
    "constraint legacy_sales_profile_role_check check (role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador'))",
  ].filter(Boolean);
  const insertColumns = ['id', 'role', 'active', hasMicrosoftEmail && 'microsoft_email', hasCommercialArea && 'commercial_area'].filter(Boolean);
  const seedRows = rows ?? [
    [ids.seguridadFisica, 'comercial', true, hasMicrosoftEmail && 'fisica@seguridadnacional.co', hasCommercialArea && 'seguridad_fisica'],
    [ids.tecnologia, 'comercial', true, hasMicrosoftEmail && 'tecnologia@seguridadnacional.co', hasCommercialArea && 'tecnologia'],
    [ids.licitacion, 'comercial', true, hasMicrosoftEmail && 'licitacion@seguridadnacional.co', hasCommercialArea && 'licitacion_publica'],
    [ids.historicalTenderEmail, 'colaborador', true, hasMicrosoftEmail && '  Directora.Licitaciones@SeguridadNacional.co  ', hasCommercialArea && null],
    [ids.unrelated, 'comercial', true, hasMicrosoftEmail && 'sin-acceso@seguridadnacional.co', hasCommercialArea && null],
    [ids.inactive, 'colaborador', false, hasMicrosoftEmail && 'inactiva@seguridadnacional.co', hasCommercialArea && 'tecnologia'],
  ].map((row) => row.filter((value, index) => index < 3 || (index === 3 && hasMicrosoftEmail) || (index === 4 && hasCommercialArea)));
  const quote = (value) => value === null ? 'null' : typeof value === 'boolean' ? String(value) : `'${value.replaceAll("'", "''")}'`;

  await db.exec(`
    create role authenticated;
    create role service_role;
    alter role service_role bypassrls;
    grant service_role to current_user;
    create table public.psi_sales_profiles (${columns.join(',\n')});
    insert into public.psi_sales_profiles (${insertColumns.join(', ')}) values
      ${seedRows.map((row) => `(${row.map(quote).join(', ')})`).join(',\n      ')};
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

async function exclusiveRoleChecks(db) {
  return (await db.query(`
    select conname
    from pg_constraint
    where conrelid = 'public.psi_sales_profiles'::regclass
      and contype = 'c'
      and conkey = array[(
        select attnum
        from pg_attribute
        where attrelid = 'public.psi_sales_profiles'::regclass
          and attname = 'role'
          and not attisdropped
      )]::smallint[]
    order by conname
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
  assert.deepEqual(await exclusiveRoleChecks(db), [{ conname: 'psi_sales_profiles_role_check' }], 'la primera ejecución deja exactamente un CHECK exclusivo de role con el nombre canónico');

  const firstAssignments = await assignmentsByProfile(db);
  const firstPermissions = await permissionsByProfile(db);
  await db.exec(migration);
  assert.deepEqual(await assignmentsByProfile(db), firstAssignments, 're-ejecutar 019 no debe duplicar assignments');
  assert.deepEqual(await permissionsByProfile(db), firstPermissions, 're-ejecutar 019 no debe duplicar permissions');
  assert.deepEqual(await exclusiveRoleChecks(db), [{ conname: 'psi_sales_profiles_role_check' }], 'la segunda ejecución conserva exactamente un CHECK exclusivo de role con el nombre canónico');
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

await (async function backfillsOnlyTheLegacyColumnsAvailableInPartialSchemas() {
  const cases = [
    {
      name: 'solo commercial_area',
      options: { hasCommercialArea: true, hasMicrosoftEmail: false },
      assignments: 4,
      permissions: [{ profile_id: ids.licitacion, permission_code: 'licitaciones' }],
    },
    {
      name: 'solo microsoft_email',
      options: { hasCommercialArea: false, hasMicrosoftEmail: true },
      assignments: 0,
      permissions: [{ profile_id: ids.historicalTenderEmail, permission_code: 'licitaciones' }],
    },
    {
      name: 'microsoft_email presente sin coincidencias históricas',
      options: {
        hasCommercialArea: false,
        hasMicrosoftEmail: true,
        rows: [[ids.unrelated, 'colaborador', true, 'sin-acceso@seguridadnacional.co']],
      },
      assignments: 0,
      permissions: [],
    },
    {
      name: 'sin columnas legacy',
      options: { hasCommercialArea: false, hasMicrosoftEmail: false },
      assignments: 0,
      permissions: [],
    },
  ];

  for (const scenario of cases) {
    const db = await createLegacyDatabase(scenario.options);
    await db.exec(migration);
    assert.equal((await assignmentsByProfile(db)).length, scenario.assignments, `${scenario.name}: solo commercial_area debe generar assignments`);
    assert.deepEqual(await permissionsByProfile(db), scenario.permissions, `${scenario.name}: el permiso histórico depende solo de microsoft_email`);
    assert.deepEqual(await exclusiveRoleChecks(db), [{ conname: 'psi_sales_profiles_role_check' }], `${scenario.name}: 019 deja un único CHECK exclusivo de role`);
    await db.close();
  }
})();

await (async function rejectsAmbiguousHistoricalTenderEmailBeforeDestructiveDdlAndRollsBack() {
  const db = await createLegacyDatabase({
    rows: [
      [ids.historicalTenderEmail, 'colaborador', true, ' Directora.Licitaciones@SeguridadNacional.co ', null],
      [ids.duplicateTenderEmail, 'colaborador', true, 'DIRECTORA.LICITACIONES@SEGURIDADNACIONAL.CO', null],
    ],
  });
  const beforeProfiles = (await db.query(`select id, role, active, microsoft_email, commercial_area from public.psi_sales_profiles order by id`)).rows;

  await assert.rejects(
    db.exec(migration),
    /directora\.licitaciones@seguridadnacional\.co.*2.*(?:normalic|desdupli)|2.*directora\.licitaciones@seguridadnacional\.co.*(?:normalic|desdupli)/i,
    'dos perfiles que normalizan al correo histórico deben bloquear la migración',
  );
  await db.exec('rollback');
  assert.equal((await scalar(db, `select to_regclass('public.psi_org_areas') is null as absent`)).absent, true, 'el abort debe ocurrir antes de crear tablas 019');
  assert.deepEqual(
    (await db.query(`select id, role, active, microsoft_email, commercial_area from public.psi_sales_profiles order by id`)).rows,
    beforeProfiles,
    'el abort debe dejar los perfiles legado intactos',
  );
  assert.deepEqual(await exclusiveRoleChecks(db), [{ conname: 'legacy_sales_profile_role_check' }], 'el abort no puede reemplazar el CHECK legado');
  await db.close();
})();

assert.match(
  migration,
  /commercial_area.*compatibilidad temporal|compatibilidad temporal.*commercial_area/is,
  '019 debe documentar commercial_area como compatibilidad temporal/read-only',
);

const transactionStart = migration.search(/\bbegin\s*;/i);
const firstPreflight = migration.search(/--\s*Abort before any DDL|\bdo\s+\$\$/i);
const profileLock = migration.search(/\block\s+table\s+public\.psi_sales_profiles\s+in\s+share\s+row\s+exclusive\s+mode\s*;/i);
assert.notEqual(profileLock, -1, '019 debe bloquear psi_sales_profiles durante el preflight y backfill legado');
assert.ok(transactionStart !== -1 && transactionStart < profileLock, 'el lock debe ocurrir después de BEGIN');
assert.ok(firstPreflight !== -1 && profileLock < firstPreflight, 'el lock debe ocurrir antes del primer preflight o DO');

console.log('profile access backfill PGlite contract passed');
