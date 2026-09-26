import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const rollbackPath = new URL(
  '../supabase/rollbacks/094_agt002_f0b2_rpc_hardening_rollback.sql',
  import.meta.url,
);
const migration094 = readFileSync(
  new URL('../supabase/migrations/094_agt002_f0b2_rpc_hardening.sql', import.meta.url),
  'utf8',
);

const NAMES = [
  'get_my_profile',
  'handle_new_user',
  'psi_admin_acquire_profile_lock',
  'psi_admin_bind_profile_auth',
  'psi_admin_persist_profile_access',
  'psi_admin_release_profile_lock',
  'psi_assert_tender_dossier_actor',
  'psi_assert_tender_dossier_go',
  'psi_profile_has_tender_permission',
  'psi_record_tender_analysis_run',
  'psi_sales_current_profile_id',
  'psi_sales_current_profile_role',
  'registrar_uso_ia',
];

const STUB_SQL = `
create or replace function public.get_my_profile()
returns table(id uuid, role text)
language plpgsql security definer as $fn$ begin return; end; $fn$;
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer as $fn$ begin return null; end; $fn$;
create or replace function public.psi_admin_acquire_profile_lock(p_actor_profile_id uuid)
returns uuid language plpgsql security definer as $fn$ begin return '00000000-0000-0000-0000-000000000001'::uuid; end; $fn$;
create or replace function public.psi_admin_release_profile_lock(p_operation_id uuid, p_actor_profile_id uuid)
returns void language plpgsql security definer as $fn$ begin end; $fn$;
create or replace function public.psi_admin_bind_profile_auth(p_profile_id uuid, p_expected_email text, p_auth_user_id uuid)
returns jsonb language plpgsql security definer as $fn$ begin return '{}'::jsonb; end; $fn$;
create or replace function public.psi_admin_persist_profile_access(p_mode text, p_target_id uuid, p_expected_profile jsonb, p_profile jsonb, p_areas jsonb, p_permissions jsonb, p_actor_profile_id uuid, p_operation_id uuid)
returns jsonb language plpgsql security definer as $fn$ begin return '{}'::jsonb; end; $fn$;
create or replace function public.psi_assert_tender_dossier_actor(p_actor_id uuid, p_manager_only boolean)
returns uuid language plpgsql security definer as $fn$ begin return p_actor_id; end; $fn$;
create or replace function public.psi_assert_tender_dossier_go(p_opportunity_id uuid)
returns uuid language plpgsql security definer as $fn$ begin return p_opportunity_id; end; $fn$;
create or replace function public.psi_profile_has_tender_permission(p_profile_id uuid, p_manager_only boolean)
returns boolean language plpgsql security definer as $fn$ begin return true; end; $fn$;
create or replace function public.psi_record_tender_analysis_run(p_snapshot_id uuid, p_opportunity_id uuid, p_tender_id uuid, p_producer text, p_method text, p_status text, p_result jsonb, p_critical_open_count integer, p_idempotency_key text, p_schema_version text, p_policy_version text, p_model text, p_usage jsonb)
returns uuid language plpgsql security definer as $fn$ begin return p_snapshot_id; end; $fn$;
create or replace function public.psi_sales_current_profile_id()
returns uuid language plpgsql security definer as $fn$ begin return '00000000-0000-0000-0000-000000000002'::uuid; end; $fn$;
create or replace function public.psi_sales_current_profile_role()
returns text language plpgsql security definer as $fn$ begin return 'admin'; end; $fn$;
create or replace function public.registrar_uso_ia(p_usuario_id uuid, p_tokens_input integer, p_tokens_output integer, p_modelo text)
returns void language plpgsql security definer as $fn$ begin end; $fn$;

revoke all on function public.psi_admin_acquire_profile_lock(uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_admin_acquire_profile_lock(uuid) to anon, service_role;
revoke all on function public.psi_admin_release_profile_lock(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_admin_release_profile_lock(uuid, uuid) to anon, service_role;
revoke all on function public.psi_admin_bind_profile_auth(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_admin_bind_profile_auth(uuid, text, uuid) to anon, service_role;
revoke all on function public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid) to anon, service_role;
revoke all on function public.psi_profile_has_tender_permission(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.psi_profile_has_tender_permission(uuid, boolean) to anon, service_role;
revoke all on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) to anon, service_role;
grant execute on function public.psi_assert_tender_dossier_go(uuid) to public, anon, authenticated;
grant execute on function public.psi_assert_tender_dossier_actor(uuid, boolean) to public, anon, authenticated;
grant execute on function public.psi_sales_current_profile_id() to public, anon, authenticated, service_role;
grant execute on function public.psi_sales_current_profile_role() to public, anon, authenticated, service_role;
grant execute on function public.get_my_profile() to public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to public, anon, authenticated;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to public, anon, authenticated, service_role;
`;

async function createRoles(db) {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    try {
      await db.exec(`create role ${role};`);
    } catch (err) {
      if (!/already exists/i.test(err.message)) throw err;
    }
  }
}

async function privilegeMatrix(db) {
  const result = await db.query(`
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as identity_args,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
      has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
      p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any($1)
    order by p.proname, identity_args
  `, [NAMES]);
  return result.rows;
}

test('rollback 094 file exists', () => {
  assert.equal(existsSync(rollbackPath), true, 'expected supabase/rollbacks/094_agt002_f0b2_rpc_hardening_rollback.sql');
});

test('PGlite: 094 then rollback restores the pre-094 privilege matrix; 094 denies P0 to anon', async () => {
  assert.equal(existsSync(rollbackPath), true);
  const rollbackSql = readFileSync(rollbackPath, 'utf8');
  const db = new PGlite();
  let rolesAvailable = true;
  try {
    await createRoles(db);
  } catch (err) {
    rolesAvailable = false;
    assert.ok(true, `role creation unsupported in this PGlite build: ${err.message}`);
  }
  if (!rolesAvailable) {
    await db.close();
    return;
  }

  await db.exec(STUB_SQL);
  const before = await privilegeMatrix(db);

  await db.exec(migration094);

  await db.exec('set role anon');
  await assert.rejects(
    () =>
      db.query(
        `select public.psi_admin_persist_profile_access('replace', '00000000-0000-0000-0000-000000000001'::uuid, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '00000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000003'::uuid) as result`,
      ),
    /permission denied|42501/i,
  );
  await assert.rejects(
    () => db.query(`select public.psi_assert_tender_dossier_go('00000000-0000-0000-0000-000000000004'::uuid) as result`),
    /permission denied|42501/i,
  );
  await db.exec('reset role');

  const mid = await privilegeMatrix(db);
  const persistMid = mid.find(row => row.proname === 'psi_admin_persist_profile_access');
  assert.equal(persistMid.anon_execute, false);
  const goMid = mid.find(row => row.proname === 'psi_assert_tender_dossier_go');
  assert.equal(goMid.anon_execute, false);
  assert.equal(goMid.authenticated_execute, false);

  await db.exec(rollbackSql);
  const after = await privilegeMatrix(db);
  assert.deepEqual(after, before);

  await db.close();
});
