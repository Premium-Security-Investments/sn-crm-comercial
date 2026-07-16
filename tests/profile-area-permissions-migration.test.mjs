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
  commercial: '22222222-2222-4222-8222-222222222222',
  collaborator: '33333333-3333-4333-8333-333333333333',
};

const scalar = async (db, sql) => (await db.query(sql)).rows[0];

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key,
      role text not null,
      active boolean not null default true,
      constraint legacy_sales_profile_role_check check (role in ('admin', 'gerencia', 'director', 'comercial'))
    );
    insert into public.psi_sales_profiles (id, role) values
      ('${ids.admin}', 'admin'),
      ('${ids.commercial}', 'comercial');
  `);
  await db.exec(migration);
  return db;
}

async function count(db, table) {
  return Number((await scalar(db, `select count(*)::int as count from public.${table}`)).count);
}

await (async function migratesLegacySchemaAndIsIdempotent() {
  const db = await createDatabase();
  await db.exec(migration);
  assert.equal(await count(db, 'psi_org_areas'), 6);
  assert.equal(await count(db, 'psi_org_subareas'), 18);
  assert.equal(await count(db, 'psi_access_permissions'), 1);
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

await (async function expandsRolesWithoutChangingExistingRows() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_sales_profiles (id, role) values
    ('${ids.collaborator}', 'colaborador'),
    ('44444444-4444-4444-8444-444444444444', 'junta');`);
  await assert.rejects(
    db.exec(`insert into public.psi_sales_profiles (id, role) values ('55555555-5555-4555-8555-555555555555', 'desconocido')`),
    /check constraint|violates/i,
  );
  assert.equal((await scalar(db, `select string_agg(role, ',' order by role) as roles from public.psi_sales_profiles`)).roles, 'admin,colaborador,comercial,junta');
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

await (async function preservesAuditSafelyWhenProfilesAreDeleted() {
  const db = await createDatabase();
  await db.exec(`insert into public.psi_profile_area_assignments(profile_id, area_code) values ('${ids.collaborator}', 'financiera');
    insert into public.psi_profile_permissions(profile_id, permission_code) values ('${ids.collaborator}', 'licitaciones');
    insert into public.psi_access_audit_log(actor_profile_id, target_profile_id, action, before_state, after_state)
    values ('${ids.admin}', '${ids.collaborator}', 'profile_access_changed', '{"role":"comercial"}'::jsonb, '{"role":"colaborador"}'::jsonb);
    delete from public.psi_sales_profiles where id = '${ids.collaborator}';`);
  assert.equal(await count(db, 'psi_profile_area_assignments'), 0);
  assert.equal(await count(db, 'psi_profile_permissions'), 0);
  assert.deepEqual(
    await scalar(db, `select actor_profile_id is null as actor_cleared, target_profile_id is null as target_cleared, before_state, after_state from public.psi_access_audit_log`),
    { actor_cleared: false, target_cleared: true, before_state: { role: 'comercial' }, after_state: { role: 'colaborador' } },
  );
  await db.exec(`delete from public.psi_sales_profiles where id = '${ids.admin}'`);
  assert.equal((await scalar(db, `select actor_profile_id is null as actor_cleared from public.psi_access_audit_log`)).actor_cleared, true);
  await db.close();
})();

await (async function keepsAccessTablesConservativeAndRestoresLegacyCheckOnRollback() {
  const db = await createDatabase();
  const rlsTables = ['psi_org_areas', 'psi_org_subareas', 'psi_access_permissions', 'psi_profile_area_assignments', 'psi_profile_permissions', 'psi_access_audit_log'];
  for (const table of rlsTables) {
    assert.equal((await scalar(db, `select relrowsecurity as enabled from pg_class where oid = 'public.${table}'::regclass`)).enabled, true, `${table} must enable RLS`);
  }
  await db.exec(rollback);
  assert.deepEqual(
    await scalar(db, `select
      to_regclass('public.psi_org_areas') is null as areas_removed,
      to_regclass('public.psi_access_audit_log') is null as audit_removed,
      (select count(*)::int from pg_constraint where conrelid = 'public.psi_sales_profiles'::regclass and pg_get_constraintdef(oid) like '%colaborador%') as new_role_checks_removed`),
    { areas_removed: true, audit_removed: true, new_role_checks_removed: 0 },
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
  assert.equal((await scalar(db, `select to_regclass('public.psi_org_areas') is not null as areas_still_present`)).areas_still_present, true);
  await db.close();
})();

console.log('profile area permissions migration PGlite contract passed');
