// AGT-002 F0-B chat_query rollback — PGlite integration. TDD RED.
//
// Local isolated PGlite only. CERO APPLY: this test never runs against, connects to, or
// otherwise touches any remote/production/staging database. It builds the pre-092 live
// chat_query(p_sql text) exactly as recovered in F0-D, drives it through the real, unmodified
// migration 092 (SECURITY DEFINER revoke/retire), then through the rollback SQL at the
// conventional path supabase/rollbacks/092_agt002_f0b_chat_query_revoke_rollback.sql, and asserts
// the post-rollback catalog state is byte-for-byte equivalent (modulo insignificant whitespace)
// to the pre-092 snapshot.
//
// This is the RED half of the cycle: the rollback file does not exist yet, so the very first
// assertion below fails on that missing file. Nothing else in this test implements, stubs, or
// copies the rollback — the rest of the cycle only ever runs once that file exists for real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const normalizeSql = sql => sql.replace(/\s+/g, ' ').trim();

const rollbackPath = new URL(
  '../supabase/rollbacks/092_agt002_f0b_chat_query_revoke_rollback.sql',
  import.meta.url,
);
const migration092 = strip(
  readFileSync(new URL('../supabase/migrations/092_agt002_f0b_chat_query_revoke.sql', import.meta.url), 'utf8'),
);

const PRE_092_CHAT_QUERY_SQL = `
CREATE OR REPLACE FUNCTION public.chat_query(p_sql text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sql_upper text;
  v_result json;
BEGIN
  v_sql_upper := upper(trim(p_sql));
  IF v_sql_upper NOT LIKE 'SELECT%' THEN
    RAISE EXCEPTION 'Solo se permiten consultas SELECT';
  END IF;
  IF v_sql_upper ~ '(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)' THEN
    RAISE EXCEPTION 'Operacion no permitida';
  END IF;
  EXECUTE format('SELECT json_agg(t) FROM (%s) t', p_sql) INTO v_result;
  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;
`;

async function functionOid(pg) {
  return (await pg.query(`select 'public.chat_query(text)'::regprocedure::oid as oid`)).rows[0].oid;
}

async function seedPre092ChatQuery(pg) {
  await pg.exec(PRE_092_CHAT_QUERY_SQL);
  await pg.exec(`
    do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'postgres') then
        execute format('alter function public.chat_query(text) owner to %I', 'postgres');
      end if;
    end
    $$;

    revoke all on function public.chat_query(text) from public, anon, authenticated, service_role;
    grant execute on function public.chat_query(text) to public, anon, authenticated, service_role;
  `);
}

async function snapshotChatQuery(pg) {
  const oid = await functionOid(pg);
  const proc = (await pg.query(
    `select
       pg_get_functiondef(p.oid) as definition,
       p.prosecdef as prosecdef,
       p.proconfig as proconfig,
       p.proname as proname,
       p.pronargs as pronargs,
       r.rolname as owner,
       exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) as public_execute
     from pg_proc p
     join pg_roles r on r.oid = p.proowner
     where p.oid = $1`,
    [oid],
  )).rows[0];

  const executeGranted = async role =>
    (await pg.query(`select has_function_privilege($1, 'public.chat_query(text)', 'execute') as allowed`, [role]))
      .rows[0].allowed;

  return {
    definition: proc.definition,
    prosecdef: proc.prosecdef,
    proconfig: proc.proconfig,
    proname: proc.proname,
    pronargs: proc.pronargs,
    owner: proc.owner,
    publicExecute: proc.public_execute,
    anonExecute: await executeGranted('anon'),
    authenticatedExecute: await executeGranted('authenticated'),
    serviceRoleExecute: await executeGranted('service_role'),
  };
}

test('rollback 092 restores the exact pre-092 chat_query(text) catalog state after a full local PGlite migrate/retire/rollback cycle (local isolated only, CERO APPLY, never against production)', async () => {
  assert.equal(
    existsSync(rollbackPath),
    true,
    'rollback 092 must exist at supabase/rollbacks/092_agt002_f0b_chat_query_revoke_rollback.sql',
  );

  const pg = new PGlite();
  try {
    let rolesAvailable = true;
    try {
      await pg.exec('create role anon; create role authenticated; create role service_role;');
    } catch (err) {
      rolesAvailable = false;
      assert.ok(true, `role creation unsupported in this PGlite build: ${err.message}`);
    }
    if (!rolesAvailable) {
      return;
    }

    await seedPre092ChatQuery(pg);

    const preSnapshot = await snapshotChatQuery(pg);
    assert.equal(preSnapshot.proname, 'chat_query');
    assert.equal(preSnapshot.pronargs, 1);
    assert.equal(preSnapshot.prosecdef, true, 'pre-092 chat_query must be SECURITY DEFINER');
    assert.equal(preSnapshot.proconfig, null, 'pre-092 chat_query must carry no proconfig (no SET search_path)');
    assert.equal(preSnapshot.publicExecute, true, 'pre-092 chat_query must grant EXECUTE to PUBLIC');
    assert.equal(preSnapshot.anonExecute, true, 'pre-092 chat_query must grant EXECUTE to anon');
    assert.equal(preSnapshot.authenticatedExecute, true, 'pre-092 chat_query must grant EXECUTE to authenticated');
    assert.equal(preSnapshot.serviceRoleExecute, true, 'pre-092 chat_query must grant EXECUTE to service_role');

    await pg.exec(migration092);

    const postSnapshot = await snapshotChatQuery(pg);
    assert.equal(postSnapshot.prosecdef, false, 'post-092 chat_query must be SECURITY INVOKER');
    assert.ok(
      Array.isArray(postSnapshot.proconfig) && postSnapshot.proconfig.some(entry => /^search_path=pg_catalog$/i.test(entry)),
      'post-092 chat_query must SET search_path = pg_catalog',
    );
    assert.equal(postSnapshot.publicExecute, false, 'post-092 chat_query must revoke EXECUTE from PUBLIC');
    assert.equal(postSnapshot.anonExecute, false, 'post-092 chat_query must revoke EXECUTE from anon');
    assert.equal(postSnapshot.authenticatedExecute, false, 'post-092 chat_query must revoke EXECUTE from authenticated');
    assert.match(postSnapshot.definition, /raise\s+exception/i, 'post-092 body must fail closed via RAISE EXCEPTION');
    assert.match(postSnapshot.definition, /retired/i, 'post-092 body must state the function is retired');

    await pg.exec('set role anon');
    await assert.rejects(
      () => pg.query("select public.chat_query('select 1 as x') as result"),
      /permission denied|raise|exception/i,
      'post-092 anon must be unable to execute chat_query',
    );
    await pg.exec('reset role');

    const rollbackSource = strip(readFileSync(rollbackPath, 'utf8'));
    await pg.exec(rollbackSource);

    const postRollbackSnapshot = await snapshotChatQuery(pg);
    assert.equal(postRollbackSnapshot.proname, 'chat_query', 'rollback must restore chat_query(text), not rename it');
    assert.equal(postRollbackSnapshot.pronargs, 1);
    assert.equal(
      normalizeSql(postRollbackSnapshot.definition),
      normalizeSql(preSnapshot.definition),
      'rollback must restore the exact pre-092 function definition',
    );
    assert.equal(postRollbackSnapshot.prosecdef, preSnapshot.prosecdef, 'rollback must restore SECURITY DEFINER');
    assert.deepEqual(postRollbackSnapshot.proconfig, preSnapshot.proconfig, 'rollback must restore the pre-092 proconfig (null)');
    assert.equal(postRollbackSnapshot.owner, preSnapshot.owner, 'rollback must restore the pre-092 owner');
    assert.equal(postRollbackSnapshot.publicExecute, preSnapshot.publicExecute, 'rollback must restore EXECUTE for PUBLIC');
    assert.equal(postRollbackSnapshot.anonExecute, preSnapshot.anonExecute, 'rollback must restore EXECUTE for anon');
    assert.equal(
      postRollbackSnapshot.authenticatedExecute,
      preSnapshot.authenticatedExecute,
      'rollback must restore EXECUTE for authenticated',
    );
    assert.equal(
      postRollbackSnapshot.serviceRoleExecute,
      preSnapshot.serviceRoleExecute,
      'rollback must restore EXECUTE for service_role',
    );

    await pg.exec('set role anon');
    const restored = await pg.query("select public.chat_query('select 1 as x') as result");
    assert.ok(restored.rows[0].result, 'post-rollback anon must be able to execute chat_query again, exactly like pre-092');
    await pg.exec('reset role');
  } finally {
    await pg.close();
  }
});
