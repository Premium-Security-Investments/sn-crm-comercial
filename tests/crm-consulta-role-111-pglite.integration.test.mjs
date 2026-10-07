// CRM comercial — migración 111 (rol Directivo de solo consulta y último ingreso) sobre PostgreSQL aislado (PGlite).
// Cubre el CHECK de rol, el RPC de administración de perfiles (permisos de solo lectura, identidades técnicas), la marca
// de último ingreso (una vez por día, sólo humanos activos) y el rollback que se niega con perfiles consulta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = sql => sql.replace(/^\s*begin;\s*$/gim, '').replace(/^\s*commit;\s*$/gim, '');
const migration = strip(readFileSync(new URL('../supabase/migrations/111_crm_consulta_role_last_seen.sql', import.meta.url), 'utf8'));
const rollback = strip(readFileSync(new URL('../supabase/rollbacks/111_crm_consulta_role_last_seen_rollback.sql', import.meta.url), 'utf8'));

const ADMIN = '11111111-1111-4111-8111-111111111111';
const HUMAN = '22222222-2222-4222-8222-222222222222';
const AGENT = 'a0020000-0000-4000-8000-000000000002';
const INACTIVE = '33333333-3333-4333-8333-333333333333';
const OPERATION = '44444444-4444-4444-8444-444444444444';
const LUIS = '56db0b00-4dab-4f34-a20d-54c22d76c942';
const JUAN = '55555555-5555-4555-8555-555555555555';

async function freshDb({ luis = 'una' } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (
      id uuid primary key default gen_random_uuid(), full_name text, microsoft_email text, role text, active boolean,
      commercial_area text, can_edit_customer_segment boolean default false, identity_type text default 'human',
      can_own_opportunities boolean not null default false,
      created_at timestamptz default now(),
      constraint psi_sales_profiles_role_check check (role in ('admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta')));
    create table public.psi_profile_admin_lock (lock_name text primary key, operation_id uuid not null unique, actor_profile_id uuid not null, expires_at timestamptz not null);
    create table public.psi_org_areas (code text primary key, name text, active boolean default true);
    create table public.psi_org_subareas (code text primary key, area_code text, name text, active boolean default true);
    create table public.psi_access_permissions (code text primary key, name text, description text, active boolean default true);
    create table public.psi_profile_area_assignments (profile_id uuid, area_code text, subarea_code text, created_by uuid);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text, created_by uuid, primary key (profile_id, permission_code));
    create table public.psi_access_audit_log (id bigserial primary key, actor_profile_id uuid, target_profile_id uuid, action text, before_state jsonb, after_state jsonb);
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(), opportunity_id uuid, created_by uuid, interaction_type text, notes text, created_at timestamptz default now());
    create table public.psi_sales_opportunity_audit_logs (id uuid primary key default gen_random_uuid(), opportunity_id uuid, changed_by uuid, field_name text, created_at timestamptz default now());
    insert into public.psi_sales_profiles (id, full_name, microsoft_email, role, active, identity_type) values
      ('${ADMIN}', 'Admin', 'admin@x.co', 'admin', true, 'human'),
      ('${HUMAN}', 'Comercial', 'comercial@x.co', 'comercial', true, null),
      ('${AGENT}', 'Vig-IA', 'vigia@x.co', 'comercial', true, 'agent'),
      ('${INACTIVE}', 'Inactivo', 'inactivo@x.co', 'comercial', false, 'human');
    insert into public.psi_sales_profiles (id, full_name, microsoft_email, role, active, identity_type, can_own_opportunities) values
      ('${JUAN}', 'Juan Botero', 'juanbotero@premiumsecurity.ai', 'admin', true, 'human', true);
    insert into public.psi_org_areas (code, name) values ('comercial', 'Comercial');
    insert into public.psi_access_permissions (code, name, description) values
      ('modulo_siio_gerencial','SIIO',''), ('modulo_dashboard_comercial','Dashboard',''), ('modulo_alertas_comerciales','Alertas',''),
      ('modulo_oportunidades','Oportunidades',''), ('licitaciones','Licitaciones',''), ('modulo_metas','Metas',''),
      ('licitaciones_custodia','Custodia',''), ('crm_eliminar_oportunidades','Eliminar','');
    insert into public.psi_profile_admin_lock values ('global', '${OPERATION}', '${ADMIN}', now() + interval '10 minutes');
  `);
  if (luis !== 'ninguna') await pg.query(`insert into public.psi_sales_profiles (id, full_name, microsoft_email, role, active, identity_type) values ($1, 'Luis Fernando Lopez', 'DirectorFisica@seguridadnacional.co ', 'admin', true, 'human')`, [LUIS]);
  if (luis === 'dos') await pg.query(`insert into public.psi_sales_profiles (full_name, microsoft_email, role, active, identity_type) values ('Duplicado', 'directorfisica@seguridadnacional.co', 'admin', true, null)`);
  await pg.exec(migration);
  return pg;
}

const persist = (pg, { mode = 'post', targetId = null, expected = null, profile, permissions }) => pg.query(
  `select public.psi_admin_persist_profile_access($1, $2, $3::jsonb, $4::jsonb, '[]'::jsonb, $5::jsonb, $6, $7) as r`,
  [mode, targetId, expected === null ? null : JSON.stringify(expected), JSON.stringify(profile), JSON.stringify(permissions), ADMIN, OPERATION],
);
const consultaProfile = email => ({ full_name: 'Asesor de Junta', microsoft_email: email, role: 'consulta', active: true });
const touch = async (pg, id) => (await pg.query('select public.psi_touch_profile_last_seen($1) as r', [id])).rows[0].r;

test('el CHECK de rol admite consulta y sigue rechazando roles desconocidos', async () => {
  const pg = await freshDb();
  await pg.query(`insert into public.psi_sales_profiles (full_name, microsoft_email, role, active) values ('A', 'a@x.co', 'consulta', true)`);
  await assert.rejects(pg.query(`insert into public.psi_sales_profiles (full_name, microsoft_email, role, active) values ('B', 'b@x.co', 'superusuario', true)`), /psi_sales_profiles_role_check/);
});

test('el RPC crea un perfil consulta con módulos de lectura y Licitaciones, y le niega permisos de operación', async () => {
  const pg = await freshDb();
  const { rows } = await persist(pg, { profile: consultaProfile('asesor@x.co'), permissions: ['modulo_siio_gerencial', 'modulo_dashboard_comercial', 'modulo_alertas_comerciales', 'modulo_oportunidades', 'licitaciones'] });
  assert.equal(rows[0].r.role, 'consulta');
  const granted = await pg.query(`select permission_code from public.psi_profile_permissions where profile_id = $1 order by 1`, [rows[0].r.id]);
  assert.equal(granted.rows.length, 5);
  await assert.rejects(persist(pg, { profile: consultaProfile('otro@x.co'), permissions: ['licitaciones', 'licitaciones_custodia'] }), /solo consulta/);
  await assert.rejects(persist(pg, { profile: consultaProfile('otro2@x.co'), permissions: ['crm_eliminar_oportunidades'] }), /solo consulta/);
  await assert.rejects(persist(pg, { profile: consultaProfile('otro3@x.co'), permissions: ['modulo_metas'] }), /solo consulta/);
  await assert.rejects(persist(pg, { profile: { ...consultaProfile('x@x.co'), role: 'colaborador' }, permissions: ['licitaciones'] }), /Licitaciones no aplica/);
});

test('el RPC no administra identidades técnicas (agentes)', async () => {
  const pg = await freshDb();
  const expected = { id: AGENT, full_name: 'Vig-IA', microsoft_email: 'vigia@x.co', role: 'comercial', active: true, commercial_area: null, can_edit_customer_segment: false };
  await assert.rejects(persist(pg, { mode: 'patch', targetId: AGENT, expected, profile: { full_name: 'Vig-IA', microsoft_email: 'vigia@x.co', role: 'consulta', active: true }, permissions: [] }), /Identidad técnica no editable/);
  const { rows } = await pg.query('select role, active from public.psi_sales_profiles where id = $1', [AGENT]);
  assert.deepEqual(rows[0], { role: 'comercial', active: true });
});

test('el último ingreso se escribe una vez por día de Bogotá y sólo para humanos activos', async () => {
  const pg = await freshDb();
  assert.equal(await touch(pg, HUMAN), true, 'primera visita del día escribe');
  assert.equal(await touch(pg, HUMAN), false, 'segunda visita del mismo día no escribe');
  const first = (await pg.query('select last_seen_day, last_seen_at from public.psi_profile_last_seen where profile_id = $1', [HUMAN])).rows[0];
  const today = (await pg.query(`select (now() at time zone 'America/Bogota')::date as d`)).rows[0].d;
  assert.equal(String(first.last_seen_day), String(today));
  await pg.query(`update public.psi_profile_last_seen set last_seen_day = last_seen_day - 1 where profile_id = $1`, [HUMAN]);
  assert.equal(await touch(pg, HUMAN), true, 'un día nuevo vuelve a escribir');
  assert.equal(await touch(pg, AGENT), false, 'una identidad técnica nunca registra ingreso');
  assert.equal(await touch(pg, INACTIVE), false, 'un perfil inactivo nunca registra ingreso');
  assert.equal(await touch(pg, null), false);
  const { rows } = await pg.query('select profile_id from public.psi_profile_last_seen');
  assert.deepEqual(rows.map(row => row.profile_id), [HUMAN]);
});

test('la tabla de último ingreso queda cerrada a anon/authenticated y crea los índices de comportamiento', async () => {
  const pg = await freshDb();
  const grants = await pg.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = 'psi_profile_last_seen' and grantee in ('anon','authenticated')`);
  assert.equal(grants.rows.length, 0);
  const rls = await pg.query(`select relrowsecurity from pg_class where relname = 'psi_profile_last_seen'`);
  assert.equal(rls.rows[0].relrowsecurity, true);
  const indexes = await pg.query(`select indexname from pg_indexes where indexname in ('idx_psi_sales_interactions_created_by_created_at','idx_psi_sales_opportunity_audit_logs_decision_actor') order by 1`);
  assert.equal(indexes.rows.length, 2);
  const execute = await pg.query(`select has_function_privilege('authenticated', 'public.psi_touch_profile_last_seen(uuid)', 'execute') as auth, has_function_privilege('service_role', 'public.psi_touch_profile_last_seen(uuid)', 'execute') as svc`);
  assert.deepEqual(execute.rows[0], { auth: false, svc: true });
});

test('el rollback se niega mientras exista un perfil consulta y luego deja el esquema como antes', async () => {
  const pg = await freshDb();
  await persist(pg, { profile: consultaProfile('asesor@x.co'), permissions: ['modulo_dashboard_comercial'] });
  await assert.rejects(pg.exec(rollback), /perfiles con rol consulta/);
  await pg.query(`update public.psi_sales_profiles set role = 'junta' where role = 'consulta'`);
  await pg.exec(rollback);
  await assert.rejects(pg.query(`insert into public.psi_sales_profiles (full_name, microsoft_email, role, active) values ('C', 'c@x.co', 'consulta', true)`), /psi_sales_profiles_role_check/);
  const table = await pg.query(`select to_regclass('public.psi_profile_last_seen') as t`);
  assert.equal(table.rows[0].t, null);
  await assert.rejects(persist(pg, { profile: consultaProfile('nuevo@x.co'), permissions: [] }), /Rol no válido/);
});

const canOwn = async (pg, id) => (await pg.query('select can_own_opportunities as v from public.psi_sales_profiles where id = $1', [id])).rows[0].v;

test('habilita la vista comercial sólo de Luis Fernando y exige exactamente un perfil admin humano activo', async () => {
  const pg = await freshDb();
  assert.equal(await canOwn(pg, LUIS), true);
  assert.equal(await canOwn(pg, JUAN), true, 'Juan ya estaba habilitado (086) y no se toca');
  for (const id of [ADMIN, HUMAN, AGENT, INACTIVE]) assert.equal(await canOwn(pg, id), false, id);
  await assert.rejects(freshDb({ luis: 'ninguna' }), /exactamente un perfil humano activo admin; encontrados 0/);
  await assert.rejects(freshDb({ luis: 'dos' }), /encontrados 2/);
});

test('el RPC guarda "oportunidades propias" auditado y lo prohíbe para consulta', async () => {
  const pg = await freshDb();
  const { rows } = await persist(pg, { profile: { full_name: 'Gerente', microsoft_email: 'gerente@x.co', role: 'gerencia', active: true, can_own_opportunities: true }, permissions: [] });
  assert.equal(rows[0].r.can_own_opportunities, true);
  const audit = await pg.query(`select before_state, after_state from public.psi_access_audit_log where target_profile_id = $1`, [rows[0].r.id]);
  assert.equal(audit.rows[0].before_state.can_own_opportunities, false);
  assert.equal(audit.rows[0].after_state.can_own_opportunities, true);
  const expected = { id: rows[0].r.id, full_name: 'Gerente', microsoft_email: 'gerente@x.co', role: 'gerencia', active: true, commercial_area: null, can_edit_customer_segment: false };
  await persist(pg, { mode: 'patch', targetId: rows[0].r.id, expected, profile: { full_name: 'Gerente', microsoft_email: 'gerente@x.co', role: 'gerencia', active: true }, permissions: [] });
  assert.equal(await canOwn(pg, rows[0].r.id), true, 'si no viene el campo se conserva');
  await persist(pg, { mode: 'patch', targetId: rows[0].r.id, expected, profile: { full_name: 'Gerente', microsoft_email: 'gerente@x.co', role: 'consulta', active: true }, permissions: [] });
  assert.equal(await canOwn(pg, rows[0].r.id), false, 'pasar a consulta retira las oportunidades propias');
  await assert.rejects(persist(pg, { profile: { ...consultaProfile('c2@x.co'), can_own_opportunities: true }, permissions: [] }), /no puede tener oportunidades propias/);
});

test('el rollback devuelve a false sólo la vista comercial de Luis Fernando', async () => {
  const pg = await freshDb();
  await pg.exec(rollback);
  assert.equal(await canOwn(pg, LUIS), false);
  assert.equal(await canOwn(pg, JUAN), true);
});
