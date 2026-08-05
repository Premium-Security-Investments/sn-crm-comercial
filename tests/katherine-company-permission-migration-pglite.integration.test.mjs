import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/060_katherine_company_profile_permission.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../supabase/rollbacks/060_katherine_company_profile_permission_rollback.sql', import.meta.url), 'utf8');
const profileId = '00000000-0000-4000-8000-000000000123';
const schema = `
create table public.psi_sales_profiles (
  id uuid primary key,
  full_name text not null,
  active boolean not null default true,
  identity_type text
);
create table public.psi_access_permissions (
  code text primary key,
  name text not null,
  description text,
  active boolean not null default true
);
create table public.psi_profile_permissions (
  profile_id uuid not null references public.psi_sales_profiles(id),
  permission_code text not null references public.psi_access_permissions(code) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key(profile_id, permission_code)
);
create table public.psi_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid,
  target_profile_id uuid,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);`;

async function dbWithBase({ companyCatalog = false, companyAssignment = false } = {}) {
  const db = new PGlite();
  await db.exec(schema);
  await db.query(`insert into public.psi_sales_profiles(id, full_name, active, identity_type) values ($1, 'Katherine Valencia Buitrago', true, 'human')`, [profileId]);
  await db.exec(`insert into public.psi_access_permissions(code,name,active) values ('licitaciones','Licitaciones',true)`);
  await db.query(`insert into public.psi_profile_permissions(profile_id,permission_code) values ($1,'licitaciones')`, [profileId]);
  if (companyCatalog) await db.exec(`insert into public.psi_access_permissions(code,name,active) values ('licitaciones_empresa','Empresa',true)`);
  if (companyAssignment) await db.query(`insert into public.psi_profile_permissions(profile_id,permission_code) values ($1,'licitaciones_empresa')`, [profileId]);
  return db;
}

test('migration 060 is idempotent, fail-closed, and rolls back only owned state', async () => {
  const db = await dbWithBase();
  try {
    await db.exec(migration);
    let result = await db.query(`select after_state from public.psi_access_audit_log where action='profile.permission.grant.deployment'`);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].after_state.assignment_created, true);
    assert.equal(result.rows[0].after_state.catalog_created, true);

    await db.exec(migration);
    result = await db.query(`select count(*)::int as count from public.psi_access_audit_log where action='profile.permission.grant.deployment'`);
    assert.equal(result.rows[0].count, 1, 'rerun must not add an ownership grant audit');

    await db.exec(`update public.psi_access_permissions set active=false where code='licitaciones_empresa'`);
    await assert.rejects(() => db.exec(migration), /refusing to reactivate/);
    await db.exec('rollback;');
    result = await db.query(`select active from public.psi_access_permissions where code='licitaciones_empresa'`);
    assert.equal(result.rows[0].active, false);

    await db.exec(`update public.psi_access_permissions set active=true where code='licitaciones_empresa'`);
    await db.exec(rollback);
    result = await db.query(`select count(*)::int as count from public.psi_profile_permissions where permission_code='licitaciones_empresa'`);
    assert.equal(result.rows[0].count, 0);
    result = await db.query(`select count(*)::int as count from public.psi_access_permissions where code='licitaciones_empresa'`);
    assert.equal(result.rows[0].count, 0, 'owned catalog should be removed when unused');
  } finally {
    await db.close();
  }
});

test('rollback 060 preserves a pre-existing assignment and catalog', async () => {
  const db = await dbWithBase({ companyCatalog: true, companyAssignment: true });
  try {
    await db.exec(migration);
    let result = await db.query(`select count(*)::int as count from public.psi_access_audit_log where action='profile.permission.grant.deployment'`);
    assert.equal(result.rows[0].count, 0, 'pre-existing assignment must not be claimed');
    await db.exec(rollback);
    result = await db.query(`select count(*)::int as count from public.psi_profile_permissions where permission_code='licitaciones_empresa'`);
    assert.equal(result.rows[0].count, 1, 'rollback must preserve unowned assignment');
    result = await db.query(`select count(*)::int as count from public.psi_access_permissions where code='licitaciones_empresa'`);
    assert.equal(result.rows[0].count, 1, 'rollback must preserve unowned catalog');
  } finally {
    await db.close();
  }
});

test('rollback 060 preserves an assignment that was manually regranted later', async () => {
  const db = await dbWithBase();
  try {
    await db.exec(migration);
    await db.exec(`delete from public.psi_profile_permissions where profile_id='${profileId}' and permission_code='licitaciones_empresa'`);
    await db.exec(`insert into public.psi_profile_permissions(profile_id,permission_code,created_at) values ('${profileId}','licitaciones_empresa',now() + interval '1 day')`);
    await db.exec(rollback);
    let result = await db.query(`select count(*)::int as count from public.psi_profile_permissions where permission_code='licitaciones_empresa'`);
    assert.equal(result.rows[0].count, 1, 'a later manual regrant is not owned by migration 060');
    result = await db.query(`select count(*)::int as count from public.psi_access_permissions where code='licitaciones_empresa'`);
    assert.equal(result.rows[0].count, 1, 'catalog must remain while the later assignment exists');
  } finally {
    await db.close();
  }
});

for (const legacySource of ['migration_060', 'deployment_060']) {
  test(`legacy ${legacySource} audit owns only the assignment, not the catalog`, async () => {
    const db = await dbWithBase({ companyCatalog: true, companyAssignment: true });
    try {
      await db.query(`insert into public.psi_access_audit_log(target_profile_id,action,before_state,after_state) values ($1,'profile.permission.grant.deployment','{}',jsonb_build_object('permission_code','licitaciones_empresa','source',$2::text))`, [profileId, legacySource]);
      await db.exec(rollback);
      let result = await db.query(`select count(*)::int as count from public.psi_profile_permissions where permission_code='licitaciones_empresa'`);
      assert.equal(result.rows[0].count, 0, `legacy ${legacySource} audit proves assignment ownership`);
      result = await db.query(`select count(*)::int as count from public.psi_access_permissions where code='licitaciones_empresa'`);
      assert.equal(result.rows[0].count, 1, 'legacy audit does not prove catalog ownership');
    } finally {
      await db.close();
    }
  });
}
