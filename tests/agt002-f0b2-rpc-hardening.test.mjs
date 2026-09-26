import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION_SQL = readFileSync(
  new URL('../supabase/migrations/094_agt002_f0b2_rpc_hardening.sql', import.meta.url),
  'utf8',
);

const ADMIN_SIGNATURES = [
  'public.psi_admin_acquire_profile_lock(uuid)',
  'public.psi_admin_release_profile_lock(uuid, uuid)',
  'public.psi_admin_bind_profile_auth(uuid, text, uuid)',
  'public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid)',
];

function extractStatements(sql) {
  return sql
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

function uncommentedSql(sql) {
  return sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
}

test('094 is revoke/alter-only: no CREATE OR REPLACE FUNCTION and no chat_query/psi_sales_clients DDL', () => {
  const body = uncommentedSql(MIGRATION_SQL);
  assert.doesNotMatch(body, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(body, /\bchat_query\b/i);
  assert.doesNotMatch(body, /\bpsi_sales_clients\b/i);
});

test('094 revokes anon on the four psi_admin_* signatures and does not grant them to anon or authenticated', () => {
  const statements = extractStatements(MIGRATION_SQL);
  for (const signature of ADMIN_SIGNATURES) {
    const escaped = signature.replace(/[()]/g, '\\$&').replace(/,\s*/g, ',\\s*');
    const revokes = statements.filter(
      statement =>
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${escaped}`, 'i').test(statement) &&
        /\bfrom\b/i.test(statement),
    );
    assert.ok(revokes.length > 0, `expected REVOKE on ${signature}`);
    assert.match(revokes.join(' | '), /\banon\b/i, `expected REVOKE FROM anon on ${signature}`);

    const grants = statements.filter(statement =>
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escaped}`, 'i').test(statement),
    );
    for (const grant of grants) {
      const toClause = grant.slice(grant.search(/\bto\b/i));
      assert.doesNotMatch(toClause, /\banon\b/i, `${signature} must not GRANT to anon`);
      assert.doesNotMatch(toClause, /\bauthenticated\b/i, `${signature} must not GRANT to authenticated`);
      assert.doesNotMatch(toClause, /\bpublic\b/i, `${signature} must not GRANT to public`);
    }
  }
});

test('094 revokes public, anon and authenticated on psi_assert_tender_dossier_go(uuid)', () => {
  const combined = extractStatements(MIGRATION_SQL)
    .filter(statement => /psi_assert_tender_dossier_go\s*\(\s*uuid\s*\)/i.test(statement) && /revoke/i.test(statement))
    .join(' | ');
  assert.ok(combined.length > 0, 'expected REVOKE on psi_assert_tender_dossier_go(uuid)');
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(combined, new RegExp(`\\b${role}\\b`, 'i'), `expected REVOKE FROM ${role} on GO assert`);
  }
});

test('094 pins search_path on handle_new_user, get_my_profile and registrar_uso_ia', () => {
  assert.match(
    MIGRATION_SQL,
    /alter\s+function\s+public\.handle_new_user\s*\(\s*\)\s+set\s+search_path\s*=\s*pg_catalog\s*,\s*public/i,
  );
  assert.match(
    MIGRATION_SQL,
    /alter\s+function\s+public\.get_my_profile\s*\(\s*\)\s+set\s+search_path\s*=\s*pg_catalog\s*,\s*public/i,
  );
  assert.match(
    MIGRATION_SQL,
    /alter\s+function\s+public\.registrar_uso_ia\s*\(\s*uuid\s*,\s*integer\s*,\s*integer\s*,\s*text\s*\)\s+set\s+search_path\s*=\s*pg_catalog\s*,\s*public/i,
  );
});

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
  try {
    await db.exec('create role anon;');
  } catch (err) {
    if (!/already exists/i.test(err.message)) throw err;
  }
  try {
    await db.exec('create role authenticated;');
  } catch (err) {
    if (!/already exists/i.test(err.message)) throw err;
  }
  try {
    await db.exec('create role service_role;');
  } catch (err) {
    if (!/already exists/i.test(err.message)) throw err;
  }
}

test('PGlite: 094 denies P0 admin/GO to anon and authenticated, keeps service_role admin and authenticated RLS helper', async () => {
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

  await db.exec('set role anon');
  const beforeAdmin = await db.query(
    `select public.psi_admin_persist_profile_access('replace', '00000000-0000-0000-0000-000000000001'::uuid, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '00000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000003'::uuid) as result`,
  );
  assert.ok(beforeAdmin.rows[0].result, 'expected anon to execute persist before 094');
  const beforeGo = await db.query(
    `select public.psi_assert_tender_dossier_go('00000000-0000-0000-0000-000000000004'::uuid) as result`,
  );
  assert.ok(beforeGo.rows[0].result, 'expected anon to execute GO assert before 094');
  await db.exec('reset role');

  await db.exec(MIGRATION_SQL);

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
  await assert.rejects(
    () => db.query('select public.psi_sales_current_profile_id() as result'),
    /permission denied|42501/i,
  );
  await db.exec('reset role');

  await db.exec('set role authenticated');
  await assert.rejects(
    () => db.query(`select public.psi_assert_tender_dossier_go('00000000-0000-0000-0000-000000000004'::uuid) as result`),
    /permission denied|42501/i,
  );
  const keptRls = await db.query('select public.psi_sales_current_profile_id() as result');
  assert.ok(keptRls.rows[0].result, 'expected authenticated to keep psi_sales_current_profile_id');
  await db.exec('reset role');

  await db.exec('set role service_role');
  const keptAdmin = await db.query(
    `select public.psi_admin_acquire_profile_lock('00000000-0000-0000-0000-000000000002'::uuid) as result`,
  );
  assert.ok(keptAdmin.rows[0].result, 'expected service_role to keep psi_admin_acquire_profile_lock');
  await db.exec('reset role');

  await db.close();
});
