import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const hotfix = readFileSync(
  new URL('../supabase/remediations/2026-07-29_tender_dossier_projector_acl_hotfix.sql', import.meta.url),
  'utf8',
);

assert.match(hotfix, /^begin;/mi);
assert.match(hotfix, /to_regprocedure\('public\.psi_project_tender_dossier_artifact\(uuid\)'\) is null/i);
assert.match(hotfix, /revoke all on function public\.psi_project_tender_dossier_artifact\(uuid\) from public, anon, authenticated/i);
assert.match(hotfix, /grant execute on function public\.psi_project_tender_dossier_artifact\(uuid\) to service_role/i);
assert.match(hotfix, /commit;\s*$/i);
assert.doesNotMatch(hotfix, /\b(create|drop|alter)\s+(table|type|schema)\b/i);
assert.doesNotMatch(hotfix, /psi_agt002|vigia_copilot_pilot|psi_profile_permissions/i);

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create or replace function public.psi_project_tender_dossier_artifact(p_artifact_id uuid)
  returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
    select jsonb_build_object('id', p_artifact_id)
  $$;
`);

async function aclState() {
  return (await db.query(`
    select
      has_function_privilege('anon','public.psi_project_tender_dossier_artifact(uuid)','EXECUTE') as anon_exec,
      has_function_privilege('authenticated','public.psi_project_tender_dossier_artifact(uuid)','EXECUTE') as authenticated_exec,
      has_function_privilege('service_role','public.psi_project_tender_dossier_artifact(uuid)','EXECUTE') as service_exec,
      ((select p.proacl from pg_proc p where p.oid='public.psi_project_tender_dossier_artifact(uuid)'::regprocedure::oid) is null
        or exists (
          select 1 from aclexplode((select p.proacl from pg_proc p where p.oid='public.psi_project_tender_dossier_artifact(uuid)'::regprocedure::oid)) a
          where a.grantee=0 and a.privilege_type='EXECUTE'
        )) as public_exec;
  `)).rows[0];
}

const before = await aclState();
assert.equal(before.anon_exec, true, '040 deja EXECUTE implícito de PUBLIC heredado por anon');
assert.equal(before.authenticated_exec, true);
assert.equal(before.public_exec, true);

await db.exec(hotfix);
const after = await aclState();
assert.equal(after.anon_exec, false);
assert.equal(after.authenticated_exec, false);
assert.equal(after.public_exec, false);
assert.equal(after.service_exec, true);

// Idempotencia real: una segunda aplicación conserva exactamente la superficie segura.
await db.exec(hotfix);
assert.deepEqual(await aclState(), after);

// Fail closed si la función objetivo no existe.
const absent = new PGlite();
await absent.exec('create role anon; create role authenticated; create role service_role;');
await assert.rejects(absent.exec(hotfix), /no existe|42883/i);

await absent.close();
await db.close();
console.log('PGlite tender dossier projector ACL hotfix passed');
