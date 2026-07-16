import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = new URL('../supabase/migrations/019_profile_area_permissions.sql', import.meta.url);
const rollbackPath = new URL('../supabase/rollbacks/019_profile_area_permissions_rollback.sql', import.meta.url);
assert.equal(existsSync(migrationPath), true, 'La migración 019 debe existir.');
assert.equal(existsSync(rollbackPath), true, 'El rollback 019 debe existir.');

const migration = readFileSync(migrationPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  gerencia: '12121212-1212-4121-8121-121212121212',
  director: '13131313-1313-4131-8131-131313131313',
  commercial: '22222222-2222-4222-8222-222222222222',
  collaborator: '33333333-3333-4333-8333-333333333333',
  junta: '44444444-4444-4444-8444-444444444444',
};

const scalar = async (db, sql) => (await db.query(sql)).rows[0];

async function createDatabase() {
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
      constraint legacy_sales_profile_role_check check (role in ('admin', 'gerencia', 'director', 'comercial'))
    );
    insert into public.psi_sales_profiles (id, role) values
      ('${ids.admin}', 'admin'),
      ('${ids.gerencia}', 'gerencia'),
      ('${ids.director}', 'director'),
      ('${ids.commercial}', 'comercial');
  `);
  await db.exec(migration);
  return db;
}

async function count(db, table) {
  return Number((await scalar(db, `select count(*)::int as count from public.${table}`)).count);
}

await (async function migratesLegacySchemaAndConvergesExistingCatalogRows() {
  const db = await createDatabase();
  await db.exec(`
    update public.psi_org_areas set name = 'Gerencia obsoleta', active = false where code = 'gerencia';
    update public.psi_org_subareas
      set area_code = 'operaciones', name = 'Licitaciones obsoletas', active = false
      where code = 'licitaciones';
    update public.psi_access_permissions
      set name = 'Permiso obsoleto', description = 'Descripción obsoleta.', active = false
      where code = 'licitaciones';
  `);
  await db.exec(migration);
  assert.equal(await count(db, 'psi_org_areas'), 6);
  assert.equal(await count(db, 'psi_org_subareas'), 20);
  assert.equal(await count(db, 'psi_access_permissions'), 1);
  assert.deepEqual(
    await scalar(db, `select name, active from public.psi_org_areas where code = 'gerencia'`),
    { name: 'Gerencia', active: true },
  );
  assert.deepEqual(
    await scalar(db, `select area_code, name, active from public.psi_org_subareas where code = 'licitaciones'`),
    { area_code: 'comercial', name: 'Licitaciones', active: true },
  );
  assert.deepEqual(
    await scalar(db, `select name, description, active from public.psi_access_permissions where code = 'licitaciones'`),
    { name: 'Licitaciones', description: 'Acceso transversal al módulo de Licitaciones.', active: true },
  );
  assert.deepEqual(
    await scalar(db, `select role as admin_role, (select role from public.psi_sales_profiles where id = '${ids.commercial}') as commercial_role from public.psi_sales_profiles where id = '${ids.admin}'`),
    { admin_role: 'admin', commercial_role: 'comercial' },
  );
  await db.close();
})();

await (async function seedsExactlyTheApprovedActiveAreaAndSubareaCatalog() {
  const db = await createDatabase();
  assert.deepEqual(
    (await db.query(`select code, name from public.psi_org_areas where active order by code`)).rows,
    [
      { code: 'comercial', name: 'Comercial' },
      { code: 'financiera', name: 'Financiera' },
      { code: 'gerencia', name: 'Gerencia' },
      { code: 'gestion_humana', name: 'Gestión Humana' },
      { code: 'operaciones', name: 'Operaciones' },
      { code: 'tecnologia_innovacion', name: 'Tecnología e Innovación' },
    ],
  );
  assert.deepEqual(
    (await db.query(`select area_code, code from public.psi_org_subareas order by area_code, code`)).rows,
    [
      ['comercial', 'licitaciones'], ['comercial', 'seguridad_fisica'], ['comercial', 'tecnologia'],
      ['financiera', 'cartera'], ['financiera', 'contabilidad'], ['financiera', 'planeacion_presupuesto'], ['financiera', 'tesoreria'],
      ['gestion_humana', 'bienestar_desarrollo'], ['gestion_humana', 'nomina'], ['gestion_humana', 'relaciones_laborales'], ['gestion_humana', 'seleccion_contratacion'], ['gestion_humana', 'sst'],
      ['operaciones', 'seguridad_electronica'], ['operaciones', 'sistemas_integrados'], ['operaciones', 'vigilancia_fisica'],
      ['tecnologia_innovacion', 'aplicaciones_datos_integraciones'], ['tecnologia_innovacion', 'ia_automatizacion'], ['tecnologia_innovacion', 'infraestructura_soporte'], ['tecnologia_innovacion', 'innovacion_productos'], ['tecnologia_innovacion', 'seguridad_informacion'],
    ].map(([area_code, code]) => ({ area_code, code })),
  );
  await db.close();
})();

await (async function acceptsEveryApprovedRoleAndRejectsUnknownRoles() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_sales_profiles (id, role) values
    ('${ids.collaborator}', 'colaborador'),
    ('${ids.junta}', 'junta');`);
  await assert.rejects(
    db.exec(`insert into public.psi_sales_profiles (id, role) values ('55555555-5555-4555-8555-555555555555', 'desconocido')`),
    /check constraint|violates/i,
  );
  assert.equal(
    (await scalar(db, `select string_agg(role, ',' order by role) as roles from public.psi_sales_profiles`)).roles,
    'admin,colaborador,comercial,director,gerencia,junta',
  );
  await db.close();
})();

await (async function enforcesAreaAndSubareaAssignments() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_profile_area_assignments(profile_id, area_code) values ('${ids.admin}', 'comercial');
    insert into public.psi_profile_area_assignments(profile_id, area_code, subarea_code) values ('${ids.admin}', 'operaciones', 'vigilancia_fisica');`);
  assert.equal(await count(db, 'psi_profile_area_assignments'), 2);
  await assert.rejects(
    db.exec(`insert into public.psi_profile_area_assignments(profile_id, area_code) values ('${ids.admin}', 'comercial')`),
    /duplicate key|unique/i,
  );
  await assert.rejects(
    db.exec(`insert into public.psi_profile_area_assignments(profile_id, area_code, subarea_code) values ('${ids.admin}', 'comercial', 'nomina')`),
    /foreign key|violates/i,
  );
  await db.close();
})();

await (async function keepsTenderPermissionIndependentAndUnique() {
  const db = await createDatabase();
  assert.deepEqual(await scalar(db, `select code, name from public.psi_access_permissions`), { code: 'licitaciones', name: 'Licitaciones' });
  await db.exec(`insert into public.psi_profile_permissions(profile_id, permission_code) values ('${ids.commercial}', 'licitaciones')`);
  await assert.rejects(
    db.exec(`insert into public.psi_profile_permissions(profile_id, permission_code) values ('${ids.commercial}', 'licitaciones')`),
    /duplicate key|unique/i,
  );
  await db.close();
})();

await (async function preservesAuditEvidenceByBlockingProfileDeletion() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_sales_profiles (id, role) values ('${ids.collaborator}', 'colaborador');
    insert into public.psi_profile_area_assignments(profile_id, area_code) values ('${ids.collaborator}', 'financiera');
    insert into public.psi_profile_permissions(profile_id, permission_code) values ('${ids.collaborator}', 'licitaciones');
    insert into public.psi_access_audit_log(actor_profile_id, target_profile_id, action, before_state, after_state)
    values ('${ids.admin}', '${ids.collaborator}', 'profile_access_changed', '{"role":"comercial"}'::jsonb, '{"role":"colaborador"}'::jsonb);`);
  await assert.rejects(
    db.exec(`delete from public.psi_sales_profiles where id = '${ids.collaborator}'`),
    /foreign key|violates/i,
    'un perfil referenciado por evidencia inmutable no se puede borrar',
  );
  assert.deepEqual(
    await scalar(db, `select actor_profile_id, target_profile_id, before_state, after_state from public.psi_access_audit_log`),
    { actor_profile_id: ids.admin, target_profile_id: ids.collaborator, before_state: { role: 'comercial' }, after_state: { role: 'colaborador' } },
  );
  await db.close();
})();

await (async function keepsAccessTablesConservativeAndRestoresLegacyCheckOnRollback() {
  const db = await createDatabase();
  const rlsTables = ['psi_org_areas', 'psi_org_subareas', 'psi_access_permissions', 'psi_profile_area_assignments', 'psi_profile_permissions', 'psi_access_audit_log'];
  for (const table of rlsTables) {
    assert.equal((await scalar(db, `select relrowsecurity as enabled from pg_class where oid = 'public.${table}'::regclass`)).enabled, true, `${table} must enable RLS`);
    assert.equal((await scalar(db, `select has_table_privilege('authenticated', 'public.${table}', 'insert') as can_insert`)).can_insert, false, `${table} must not grant authenticated direct writes`);
    assert.equal((await scalar(db, `select has_table_privilege('service_role', 'public.${table}', 'insert') as can_insert`)).can_insert, true, `${table} must remain usable by service_role`);
  }
  await db.exec(rollback);
  assert.deepEqual(
    await scalar(db, `select
      to_regclass('public.psi_org_areas') is null as areas_removed,
      to_regclass('public.psi_org_subareas') is null as subareas_removed,
      to_regclass('public.psi_access_permissions') is null as permissions_removed,
      to_regclass('public.psi_profile_area_assignments') is null as area_assignments_removed,
      to_regclass('public.psi_profile_permissions') is null as profile_permissions_removed,
      to_regclass('public.psi_access_audit_log') is null as audit_removed,
      (select count(*)::int from pg_constraint where conrelid = 'public.psi_sales_profiles'::regclass and pg_get_constraintdef(oid) like '%colaborador%') as new_role_checks_removed`),
    {
      areas_removed: true,
      subareas_removed: true,
      permissions_removed: true,
      area_assignments_removed: true,
      profile_permissions_removed: true,
      audit_removed: true,
      new_role_checks_removed: 0,
    },
  );
  assert.deepEqual(
    (await db.query(`select id, role from public.psi_sales_profiles order by id`)).rows,
    [
      { id: ids.admin, role: 'admin' },
      { id: ids.gerencia, role: 'gerencia' },
      { id: ids.director, role: 'director' },
      { id: ids.commercial, role: 'comercial' },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  await assert.rejects(
    db.exec(`insert into public.psi_sales_profiles (id, role) values ('66666666-6666-4666-8666-666666666666', 'colaborador')`),
    /check constraint|violates/i,
  );
  await db.close();
})();

await (async function blocksRollbackWhenNewRolesExist() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_sales_profiles (id, role) values ('${ids.collaborator}', 'colaborador')`);
  await assert.rejects(db.exec(rollback), /colaborador.*junta|junta.*colaborador/i);
  await db.exec('rollback');
  assert.equal((await scalar(db, `select to_regclass('public.psi_org_areas') is not null as areas_still_present`)).areas_still_present, true);
  await db.close();
})();

await (async function preservesCompositeRoleChecksAndRejectsAmbiguousLegacyRoleChecks() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key,
      role text not null,
      active boolean not null default true,
      constraint legacy_sales_profile_role_check check (role in ('admin', 'gerencia', 'director', 'comercial')),
      constraint legacy_role_requires_active check (role <> 'admin' or active)
    );
    insert into public.psi_sales_profiles (id, role) values ('${ids.admin}', 'admin');
  `);
  await db.exec(migration);
  assert.equal(
    (await scalar(db, `select count(*)::int as count from pg_constraint where conrelid = 'public.psi_sales_profiles'::regclass and conname = 'legacy_role_requires_active'`)).count,
    1,
    'un CHECK compuesto role + active no debe ser eliminado por 019',
  );
  await db.exec(rollback);
  assert.equal(
    (await scalar(db, `select count(*)::int as count from pg_constraint where conrelid = 'public.psi_sales_profiles'::regclass and conname = 'legacy_role_requires_active'`)).count,
    1,
    'el CHECK compuesto ajeno debe sobrevivir también al rollback',
  );
  await db.close();

  const ambiguous = new PGlite();
  await ambiguous.exec(`
    create role authenticated;
    create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key,
      role text not null,
      active boolean not null default true,
      constraint legacy_role_check_one check (role in ('admin', 'gerencia', 'director', 'comercial')),
      constraint legacy_role_check_two check (role <> 'desconocido')
    );
  `);
  await assert.rejects(ambiguous.exec(migration), /ambig.*role|role.*ambig/i);
  await ambiguous.exec('rollback');
  assert.deepEqual(
    (await ambiguous.query(`select conname from pg_constraint where conrelid = 'public.psi_sales_profiles'::regclass and contype = 'c' order by conname`)).rows,
    [{ conname: 'legacy_role_check_one' }, { conname: 'legacy_role_check_two' }],
    'un legado ambiguo debe permanecer intacto cuando el forward aborta',
  );
  assert.equal((await scalar(ambiguous, `select to_regclass('public.psi_org_areas') is null as untouched`)).untouched, true);
  await ambiguous.close();
})();

await (async function preflightsHistoricalRolesBeforeChangingTheSchema() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key,
      role text,
      active boolean not null default true,
      constraint legacy_role_active_guard check (role <> 'admin' or active)
    );
    insert into public.psi_sales_profiles (id, role) values
      ('77777777-7777-4777-8777-777777777777', 'historico_no_aprobado'),
      ('88888888-8888-4888-8888-888888888888', null);
  `);
  await assert.rejects(
    db.exec(migration),
    /historico_no_aprobado.*NULL|NULL.*historico_no_aprobado/i,
    'el preflight debe nombrar los valores bloqueantes y pedir normalización',
  );
  await db.exec('rollback');
  assert.equal((await scalar(db, `select to_regclass('public.psi_org_areas') is null as untouched`)).untouched, true);
  assert.equal(
    (await scalar(db, `select count(*)::int as count from pg_constraint where conrelid = 'public.psi_sales_profiles'::regclass and conname = 'legacy_role_active_guard'`)).count,
    1,
  );
  await db.close();
})();

await (async function makesAuditEvidenceImmutableForServiceRoleAndOwners() {
  const db = await createDatabase();
  for (const privilege of ['select', 'insert']) {
    assert.equal((await scalar(db, `select has_table_privilege('service_role', 'public.psi_access_audit_log', '${privilege}') as allowed`)).allowed, true);
  }
  for (const privilege of ['update', 'delete', 'truncate']) {
    assert.equal((await scalar(db, `select has_table_privilege('service_role', 'public.psi_access_audit_log', '${privilege}') as allowed`)).allowed, false);
  }
  await db.exec(`set role service_role;
    insert into public.psi_access_audit_log(actor_profile_id, action) values ('${ids.admin}', 'access_granted');
    select * from public.psi_access_audit_log;`);
  await assert.rejects(
    db.exec(`update public.psi_access_audit_log set action = 'altered'`),
    /permission denied|immutable|prohibit/i,
    'service_role no puede actualizar evidencia',
  );
  await assert.rejects(
    db.exec(`delete from public.psi_access_audit_log`),
    /permission denied|immutable|prohibit/i,
    'service_role no puede borrar evidencia',
  );
  await db.exec('reset role');
  await assert.rejects(
    db.exec(`update public.psi_access_audit_log set action = 'altered'`),
    /immutable|prohibit/i,
    'el trigger debe proteger inclusive al propietario/BYPASSRLS',
  );
  await assert.rejects(db.exec(`delete from public.psi_access_audit_log`), /immutable|prohibit/i);
  assert.deepEqual(await scalar(db, `select action from public.psi_access_audit_log`), { action: 'access_granted' });
  await db.close();
})();

await (async function blocksDestructiveRollbackWhenFunctionalAccessDataExists() {
  const cases = [
    ['psi_profile_area_assignments', `insert into public.psi_profile_area_assignments(profile_id, area_code) values ('${ids.admin}', 'comercial')`],
    ['psi_profile_permissions', `insert into public.psi_profile_permissions(profile_id, permission_code) values ('${ids.admin}', 'licitaciones')`],
    ['psi_access_audit_log', `insert into public.psi_access_audit_log(actor_profile_id, action) values ('${ids.admin}', 'access_granted')`],
  ];
  for (const [table, seed] of cases) {
    const db = await createDatabase();
    await db.exec(seed);
    await assert.rejects(db.exec(rollback), new RegExp(`${table}.*datos|datos.*${table}`, 'i'));
    await db.exec('rollback');
    assert.equal((await scalar(db, `select to_regclass('public.${table}') is not null as remains`)).remains, true);
    assert.equal(await count(db, table), 1, `${table} y sus datos deben sobrevivir un rollback bloqueado`);
    await db.close();
  }
})();

await (async function rollsBackOnlyWhenAccessDataIsEmptyAndRemoves019AuditObjects() {
  const db = await createDatabase();
  await db.exec(rollback);
  assert.deepEqual(
    await scalar(db, `select
      to_regclass('public.psi_org_areas') is null as areas_removed,
      to_regclass('public.psi_org_subareas') is null as subareas_removed,
      to_regclass('public.psi_access_permissions') is null as permissions_removed,
      to_regclass('public.psi_profile_area_assignments') is null as assignments_removed,
      to_regclass('public.psi_profile_permissions') is null as profile_permissions_removed,
      to_regclass('public.psi_access_audit_log') is null as audit_removed,
      to_regprocedure('public.psi_access_audit_log_prevent_mutation()') is null as audit_function_removed`),
    { areas_removed: true, subareas_removed: true, permissions_removed: true, assignments_removed: true, profile_permissions_removed: true, audit_removed: true, audit_function_removed: true },
  );
  await db.close();
})();

await (async function cascadesSubareaAreaCorrectionsIntoAssignmentsDuringSeedReconciliation() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_profile_area_assignments(profile_id, area_code, subarea_code)
    values ('${ids.admin}', 'comercial', 'licitaciones');
    update public.psi_org_subareas set area_code = 'operaciones' where code = 'licitaciones';`);
  assert.deepEqual(
    await scalar(db, `select area_code, subarea_code from public.psi_profile_area_assignments`),
    { area_code: 'operaciones', subarea_code: 'licitaciones' },
  );
  await db.exec(migration);
  assert.deepEqual(await scalar(db, `select area_code, subarea_code from public.psi_profile_area_assignments`), { area_code: 'comercial', subarea_code: 'licitaciones' });
  await db.close();
})();

await (async function rejectsBlankCatalogCodesAndBlankAuditActions() {
  const db = await createDatabase();
  await assert.rejects(db.exec(`insert into public.psi_org_areas(code, name) values ('   ', 'Vacía')`), /check constraint|violates/i);
  await assert.rejects(db.exec(`insert into public.psi_org_subareas(code, area_code, name) values (' ', 'comercial', 'Vacía')`), /check constraint|violates/i);
  await assert.rejects(db.exec(`insert into public.psi_access_permissions(code, name) values ('', 'Vacío')`), /check constraint|violates/i);
  await assert.rejects(db.exec(`insert into public.psi_access_audit_log(action) values ('  ')`), /check constraint|violates/i);
  await db.close();
})();

console.log('profile area permissions migration PGlite contract passed');
