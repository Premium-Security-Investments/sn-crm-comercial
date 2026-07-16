import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration019Path = new URL('../supabase/migrations/019_profile_area_permissions.sql', import.meta.url);
const migration020Path = new URL('../supabase/migrations/020_profile_access_admin_rpc.sql', import.meta.url);
const rollback020Path = new URL('../supabase/rollbacks/020_profile_access_admin_rpc_rollback.sql', import.meta.url);
assert.equal(existsSync(migration020Path), true, 'La migración transaccional 020 debe existir.');
assert.equal(existsSync(rollback020Path), true, 'El rollback transaccional 020 debe existir.');

const db = new PGlite();
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  target: '22222222-2222-4222-8222-222222222222',
};
await db.exec(`
  create role authenticated;
  create role service_role;
  alter role service_role bypassrls;
  grant service_role to current_user;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  insert into auth.users(id,email) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin@example.com'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','target@example.com');
  create table public.psi_sales_profiles (
    id uuid primary key default gen_random_uuid(),
    full_name text not null,
    microsoft_email text not null unique,
    role text not null,
    active boolean not null default true,
    commercial_area text,
    can_edit_customer_segment boolean not null default false,
    created_at timestamptz not null default now(),
    constraint legacy_sales_profile_role_check check (role in ('admin', 'gerencia', 'director', 'comercial'))
  );
  insert into public.psi_sales_profiles(id,full_name,microsoft_email,role,active) values
    ('${ids.admin}','Admin','admin@example.com','admin',true),
    ('${ids.target}','Comercial','target@example.com','comercial',true);

  create table public.psi_public_tenders (id uuid primary key default gen_random_uuid());
  create table public.psi_tender_radar_runs (id uuid primary key default gen_random_uuid());
  create table public.psi_company_procurement_profile (id uuid primary key default gen_random_uuid());
  create table public.psi_tender_search_profiles (id uuid primary key default gen_random_uuid());
  create table public.psi_tender_tracking_events (id uuid primary key default gen_random_uuid());
  alter table public.psi_public_tenders enable row level security;
  alter table public.psi_tender_radar_runs enable row level security;
  alter table public.psi_company_procurement_profile enable row level security;
  alter table public.psi_tender_search_profiles enable row level security;
  alter table public.psi_tender_tracking_events enable row level security;
  create policy psi_public_tenders_select on public.psi_public_tenders for select to authenticated using (true);
  create policy psi_public_tenders_modify on public.psi_public_tenders for all to authenticated using (true) with check (true);
  create policy psi_tender_radar_runs_select on public.psi_tender_radar_runs for select to authenticated using (true);
  create policy psi_tender_radar_runs_insert on public.psi_tender_radar_runs for insert to authenticated with check (true);
  create policy psi_company_procurement_profile_select on public.psi_company_procurement_profile for select to authenticated using (true);
  create policy psi_company_procurement_profile_modify on public.psi_company_procurement_profile for all to authenticated using (true) with check (true);
  create policy psi_tender_search_profiles_select on public.psi_tender_search_profiles for select to authenticated using (true);
  create policy psi_tender_search_profiles_modify on public.psi_tender_search_profiles for all to authenticated using (true) with check (true);
  create policy psi_tender_tracking_events_select on public.psi_tender_tracking_events for select to authenticated using (true);
  create policy psi_tender_tracking_events_insert on public.psi_tender_tracking_events for insert to authenticated with check (true);
  grant select, insert, update, delete on public.psi_public_tenders, public.psi_tender_radar_runs,
    public.psi_company_procurement_profile, public.psi_tender_search_profiles, public.psi_tender_tracking_events to authenticated;

  create function public.psi_discard_tender_opportunity(uuid, uuid, text, timestamptz)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
  declare v_actor_tender_manager boolean;
  begin
    select exists (
      select 1 from public.psi_sales_profiles p
      where p.id = $2 and p.active = true
        and (p.role in ('admin', 'director', 'gerencia') or lower(p.microsoft_email) = 'directora.licitaciones@seguridadnacional.co')
    ) into v_actor_tender_manager;
    return jsonb_build_object('allowed', v_actor_tender_manager);
  end;
  $$;
`);
await db.exec(readFileSync(migration019Path, 'utf8'));
await db.exec(readFileSync(migration020Path, 'utf8'));
for (const table of ['psi_public_tenders', 'psi_tender_radar_runs', 'psi_company_procurement_profile', 'psi_tender_search_profiles', 'psi_tender_tracking_events']) {
  for (const privilege of ['select', 'insert', 'update', 'delete']) {
    assert.equal((await db.query(`select has_table_privilege('authenticated',$1,$2) as allowed`, [`public.${table}`, privilege])).rows[0].allowed, false, `${table}: authenticated no conserva ${privilege}`);
  }
  assert.equal(Number((await db.query(`select count(*)::int as count from pg_policies where schemaname='public' and tablename=$1`, [table])).rows[0].count), 0, `${table}: 020 retira políticas directas legacy`);
}
const convergedTenderRpc = (await db.query(`select pg_get_functiondef('public.psi_discard_tender_opportunity(uuid,uuid,text,timestamptz)'::regprocedure) as definition`)).rows[0].definition;
assert.doesNotMatch(convergedTenderRpc, /microsoft_email|directora\.licitaciones/i, '020 elimina autorización por email de RPCs 018 ya instalados');
assert.match(convergedTenderRpc, /psi_profile_has_tender_permission\(p\.id, true\)/, '020 converge RPCs 018 a perfil + permiso explícito');
assert.equal((await db.query(`select has_function_privilege('authenticated','public.psi_discard_tender_opportunity(uuid,uuid,text,timestamptz)','execute') as allowed`)).rows[0].allowed, false, '020 revoca ejecución directa authenticated de RPCs Licitaciones');
assert.equal((await db.query(`select has_function_privilege('service_role','public.psi_discard_tender_opportunity(uuid,uuid,text,timestamptz)','execute') as allowed`)).rows[0].allowed, true, '020 conserva ejecución backend service_role');
assert.equal((await db.query(`select public.psi_profile_has_tender_permission($1,true) as allowed`, [ids.admin])).rows[0].allowed, false, 'rol gerencial sin permiso explícito no autoriza Licitaciones');
assert.equal((await db.query(`select auth_user_id from public.psi_sales_profiles where id=$1`, [ids.target])).rows[0].auth_user_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '020 vincula perfiles históricos al sujeto Auth por UUID');
assert.equal((await db.query(`select has_function_privilege('authenticated','public.psi_admin_bind_profile_auth(uuid,text,uuid)','execute') as allowed`)).rows[0].allowed, false);
assert.equal((await db.query(`select has_function_privilege('service_role','public.psi_admin_bind_profile_auth(uuid,text,uuid)','execute') as allowed`)).rows[0].allowed, true);
assert.equal((await db.query(`select has_table_privilege('authenticated','public.psi_sales_profiles','update') as allowed`)).rows[0].allowed, false, 'authenticated no puede forjar auth_user_id ni otros cambios de perfil');
assert.equal((await db.query(`select has_table_privilege('service_role','public.psi_sales_profiles','update') as allowed`)).rows[0].allowed, true);
assert.equal((await db.query(`select has_table_privilege('authenticated','public.psi_profile_auth_subject_claims','select') as allowed`)).rows[0].allowed, false);
assert.equal((await db.query(`select has_table_privilege('authenticated','public.psi_profile_auth_subject_claims','insert') as allowed`)).rows[0].allowed, false);
await db.exec(`insert into public.psi_profile_area_assignments(profile_id,area_code,subarea_code,created_by)
  values ('${ids.target}','comercial','seguridad_fisica','${ids.admin}')`);

const acquireLock = async () => (await db.query(`select public.psi_admin_acquire_profile_lock($1) as operation_id`, [ids.admin])).rows[0].operation_id;
const releaseLock = async operationId => db.query(`select public.psi_admin_release_profile_lock($1,$2)`, [operationId, ids.admin]);
const operationId = await acquireLock();
assert.match(operationId, /^[0-9a-f-]{36}$/i);
await assert.rejects(acquireLock(), /curso|lock|bloquead|busy/i, 'solo una administración de perfiles puede tocar Auth a la vez');

const profileSnapshot = row => ({
  id: row.id,
  full_name: row.full_name,
  microsoft_email: row.microsoft_email,
  role: row.role,
  active: row.active,
  commercial_area: row.commercial_area,
  can_edit_customer_segment: row.can_edit_customer_segment,
});
const getProfile = async id => profileSnapshot((await db.query(`select * from public.psi_sales_profiles where id=$1`, [id])).rows[0]);
const getAreas = async id => (await db.query(`select area_code,subarea_code from public.psi_profile_area_assignments where profile_id=$1 order by area_code,subarea_code`, [id])).rows;
const getPermissions = async id => (await db.query(`select permission_code from public.psi_profile_permissions where profile_id=$1 order by permission_code`, [id])).rows;
const callRpc = async ({ mode='patch', targetId=ids.target, expected, profile, areas, permissions, op=operationId }) =>
  (await db.query(
    `select public.psi_admin_persist_profile_access($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8) as result`,
    [mode, targetId, JSON.stringify(expected), JSON.stringify(profile), JSON.stringify(areas), JSON.stringify(permissions), ids.admin, op],
  )).rows[0].result;

const before = await getProfile(ids.target);
const after = { ...before, full_name: 'Directora', role: 'director', commercial_area: null };
const afterAreas = [{ area_code: 'operaciones', subarea_code: null }];
const afterPermissions = ['licitaciones'];
await assert.rejects(
  callRpc({ expected: before, profile: after, areas: afterAreas, permissions: afterPermissions, op: '99999999-9999-4999-8999-999999999999' }),
  /lock.*(pertenece|expiró)|bloque/i,
  'el RPC rechaza una operación que no posee el lock',
);

await db.exec(`
  create function public.test_fail_profile_access_audit() returns trigger language plpgsql as $$
  begin raise exception 'forced audit failure'; end; $$;
  create trigger test_fail_profile_access_audit before insert on public.psi_access_audit_log
    for each row execute function public.test_fail_profile_access_audit();
`);
await assert.rejects(
  callRpc({ expected: before, profile: after, areas: afterAreas, permissions: afterPermissions }),
  /forced audit failure/i,
  'un fallo de auditoría aborta la transacción completa',
);
assert.deepEqual(await getProfile(ids.target), before, 'perfil revierte atómicamente');
assert.deepEqual(await getAreas(ids.target), [{ area_code: 'comercial', subarea_code: 'seguridad_fisica' }], 'áreas revierten atómicamente');
assert.deepEqual(await getPermissions(ids.target), [], 'permisos revierten atómicamente');
assert.equal(Number((await db.query(`select count(*)::int as count from public.psi_access_audit_log`)).rows[0].count), 0, 'audit fallido no deja evidencia parcial');

await assert.rejects(
  callRpc({ mode: 'post', targetId: null, expected: null, profile: { ...after, id: undefined, microsoft_email: 'new@example.com' }, areas: afterAreas, permissions: afterPermissions }),
  /forced audit failure/i,
);
assert.equal(Number((await db.query(`select count(*)::int as count from public.psi_sales_profiles where microsoft_email='new@example.com'`)).rows[0].count), 0, 'creación y acceso revierten juntos');

await db.exec(`drop trigger test_fail_profile_access_audit on public.psi_access_audit_log;`);
const saved = await callRpc({ expected: before, profile: after, areas: afterAreas, permissions: afterPermissions });
assert.equal(saved.role, 'director');
assert.deepEqual(await getAreas(ids.target), afterAreas);
assert.deepEqual(await getPermissions(ids.target), [{ permission_code: 'licitaciones' }]);
assert.equal((await db.query(`select public.psi_profile_has_tender_permission($1,true) as allowed`, [ids.target])).rows[0].allowed, true, 'perfil directivo activo con permiso explícito sí autoriza Licitaciones');
assert.equal(Number((await db.query(`select count(*)::int as count from public.psi_access_audit_log`)).rows[0].count), 1);
assert.equal((await db.query(`select auth_user_id from public.psi_sales_profiles where id=$1`, [ids.target])).rows[0].auth_user_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'editar sin cambiar email preserva vínculo Auth');

const beforeEmailChange = await getProfile(ids.target);
const changedEmail = { ...beforeEmailChange, microsoft_email: 'target-renamed@example.com' };
await assert.rejects(
  callRpc({ expected: beforeEmailChange, profile: changedEmail, areas: afterAreas, permissions: afterPermissions }),
  /correo.*inmutable|identidad.*inmutable|email.*immutable/i,
  'un perfil existente no puede reasignarse a otra identidad cambiando el email',
);
assert.equal((await db.query(`select microsoft_email from public.psi_sales_profiles where id=$1`, [ids.target])).rows[0].microsoft_email, 'target@example.com');
assert.equal((await db.query(`select auth_user_id from public.psi_sales_profiles where id=$1`, [ids.target])).rows[0].auth_user_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'editar perfil nunca limpia ni reemplaza el vínculo Auth');
await db.query(`insert into auth.users(id,email) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','target@example.com')`);
await db.query(`update public.psi_sales_profiles set auth_user_id=null where id=$1`, [ids.target]);
const replacementBind = (await db.query(`select public.psi_admin_bind_profile_auth($1,$2,$3) as bound`, [ids.target, 'target@example.com', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'])).rows[0].bound;
assert.equal(replacementBind, false, 'el claim histórico impide que un segundo Auth UID adopte el mismo perfil incluso si el vínculo activo fue alterado');
const originalBind = (await db.query(`select public.psi_admin_bind_profile_auth($1,$2,$3) as bound`, [ids.target, 'target@example.com', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])).rows[0].bound;
assert.equal(originalBind, true, 'solo el Auth UID reclamado originalmente puede restaurar su vínculo activo');
assert.equal(Number((await db.query(`select count(*)::int as count from public.psi_profile_auth_subject_claims where profile_id=$1`, [ids.target])).rows[0].count), 1, 'cada perfil conserva exactamente un claim histórico');

const staleExpected = await getProfile(ids.target);
await db.exec(`update public.psi_sales_profiles set role='colaborador',active=false where id='${ids.target}'`);
await assert.rejects(
  callRpc({ expected: staleExpected, profile: { ...staleExpected, role: 'admin', active: true }, areas: [], permissions: [] }),
  /concurrente|obsoleto|stale/i,
  'un snapshot obsoleto no puede revertir una revocación concurrente',
);
assert.equal((await getProfile(ids.target)).role, 'colaborador');
assert.equal((await getProfile(ids.target)).active, false);

assert.equal((await db.query(`select has_function_privilege('authenticated','public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid)','execute') as allowed`)).rows[0].allowed, false);
assert.equal((await db.query(`select has_function_privilege('service_role','public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid)','execute') as allowed`)).rows[0].allowed, true);
assert.equal((await db.query(`select has_function_privilege('authenticated','public.psi_admin_acquire_profile_lock(uuid)','execute') as allowed`)).rows[0].allowed, false);
await releaseLock(operationId);
const nextOperationId = await acquireLock();
assert.notEqual(nextOperationId, operationId, 'liberar permite una nueva operación con propietario distinto');
await db.query(`update public.psi_profile_admin_lock set expires_at=now()-interval '1 second' where operation_id=$1`, [nextOperationId]);
const replacementOperationId = await acquireLock();
assert.notEqual(replacementOperationId, nextOperationId, 'un lease expirado se reemplaza sin bloqueo permanente');
await releaseLock(replacementOperationId);

await db.exec(readFileSync(rollback020Path, 'utf8'));
assert.equal((await db.query(`select to_regprocedure('public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid)') as proc`)).rows[0].proc, null);
assert.equal((await db.query(`select to_regprocedure('public.psi_admin_acquire_profile_lock(uuid)') as proc`)).rows[0].proc, null);
assert.equal((await db.query(`select to_regprocedure('public.psi_admin_bind_profile_auth(uuid,text,uuid)') as proc`)).rows[0].proc, null);
assert.equal((await db.query(`select to_regclass('public.psi_profile_auth_subject_claims') as relation`)).rows[0].relation, null);
assert.equal((await db.query(`select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='psi_sales_profiles' and column_name='auth_user_id'`)).rows[0].count, 0, 'rollback retira el vínculo Auth agregado por 020');
await db.close();
console.log('profile administration transaction PGlite checks passed');
