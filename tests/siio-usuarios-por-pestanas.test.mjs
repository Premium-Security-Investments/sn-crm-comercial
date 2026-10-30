// Usuarios y permisos por pestañas (2026-10-15): casillas → rol, permisos y áreas que el servidor ya autoriza.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { accessFromTabs, tabsFromProfile, templateAccess, tabsSummary, PROFILE_TEMPLATES } from '../profile-tabs.js';
import { isModulePermissionEligible } from '../module-access.js';
import { getVisibleNavGroups, preferredLandingRoute } from '../src/navPermissions.ts';

const migration130 = readFileSync(new URL('../supabase/migrations/130_siio_usuarios_por_pestanas.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

const eligible = ({ role, permissions }) => permissions.every(code => !code.startsWith('modulo_') && code !== 'licitaciones' ? true : isModulePermissionEligible(role, code));

test('comercial: solo sus oportunidades, con Mi meta, prioridades y Vig-IA incluidos', () => {
  const result = accessFromTabs(templateAccess('comercial'));
  assert.equal(result.role, 'comercial');
  assert.deepEqual(new Set(result.permissions), new Set(['modulo_oportunidades', 'modulo_alertas_comerciales', 'modulo_vig_ia', 'modulo_metas', 'vigia_copilot_pilot']));
  assert.equal(result.can_edit_customer_segment, true);
  assert.equal(result.can_own_opportunities, false);
  assert.ok(eligible(result));
});

test('reglas del rol calculado', () => {
  assert.equal(accessFromTabs({ tabs: ['usuarios'] }).role, 'admin');
  assert.equal(accessFromTabs({ tabs: ['torre'], read_only: true }).role, 'consulta');
  assert.equal(accessFromTabs({ tabs: ['torre'] }).role, 'gerencia');
  assert.equal(accessFromTabs({ tabs: ['dashboard'] }).role, 'gerencia');
  assert.equal(accessFromTabs({ tabs: ['oportunidades'], opportunity_scope: 'todas' }).role, 'gerencia');
  assert.equal(accessFromTabs({ tabs: ['licitaciones'] }).role, 'comercial');
  assert.equal(accessFromTabs({ tabs: ['programacion'] }).role, 'colaborador');
  assert.equal(accessFromTabs({ tabs: [] }).role, 'colaborador');
});

test('todas las plantillas producen permisos válidos para su rol', () => {
  for (const template of PROFILE_TEMPLATES) {
    const result = accessFromTabs(templateAccess(template.code));
    assert.ok(eligible(result), template.code);
  }
});

test('solo consulta: no admite pestañas ni opciones que escriben; ve todas las oportunidades', () => {
  assert.throws(() => accessFromTabs({ tabs: ['metas'], read_only: true }), /Solo consulta/);
  assert.throws(() => accessFromTabs({ tabs: ['usuarios'], read_only: true }), /Solo consulta/);
  assert.throws(() => accessFromTabs({ tabs: ['oportunidades'], copilot: true, read_only: true }), /Solo consulta/);
  const result = accessFromTabs({ tabs: ['oportunidades', 'licitaciones', 'programacion'], read_only: true });
  assert.equal(result.role, 'consulta');
  assert.ok(!result.permissions.includes('modulo_vig_ia'));
  assert.ok(eligible(result));
  assert.match(migration130, /'licitaciones','modulo_programacion'\)/, 'la base admite Programación en solo consulta');
});

test('opciones sin su pestaña no tienen efecto; pestañas desconocidas se rechazan', () => {
  const result = accessFromTabs({ tabs: ['torre'], copilot: true, delete_opportunities: true, tender_custody: true });
  assert.deepEqual(result.permissions, ['modulo_siio_gerencial']);
  assert.throws(() => accessFromTabs({ tabs: ['alertas'] }), /Pestaña no válida/);
});

test('áreas: se conservan las del área comercial; quien es sólo de Licitaciones queda marcado como tal', () => {
  const existing = [{ area_code: 'comercial', subarea_code: 'seguridad_fisica' }, { area_code: 'financiera', subarea_code: null }];
  assert.deepEqual(accessFromTabs(templateAccess('comercial'), existing).areas, [{ area_code: 'comercial', subarea_code: 'seguridad_fisica' }]);
  assert.deepEqual(accessFromTabs({ tabs: ['licitaciones'] }, existing).areas, [{ area_code: 'comercial', subarea_code: 'licitaciones' }]);
  assert.deepEqual(accessFromTabs({ tabs: ['usuarios', 'oportunidades'], opportunity_scope: 'todas' }, existing).areas, []);
});

test('ida y vuelta: los perfiles actuales se leen y se vuelven a guardar con los mismos permisos', () => {
  const people = [
    { role: 'admin', can_own_opportunities: true, can_edit_customer_segment: true, permissions: ['licitaciones', 'licitaciones_custodia', 'modulo_alertas_comerciales', 'modulo_dashboard_comercial', 'modulo_metas', 'modulo_oportunidades', 'modulo_siio_gerencial', 'modulo_usuarios', 'modulo_vig_ia', 'vigia_copilot_pilot'] },
    { role: 'comercial', can_own_opportunities: false, can_edit_customer_segment: true, permissions: ['licitaciones', 'licitaciones_custodia', 'licitaciones_empresa', 'modulo_alertas_comerciales', 'modulo_metas', 'modulo_oportunidades', 'modulo_vig_ia', 'vigia_copilot_pilot'] },
    { role: 'comercial', can_own_opportunities: false, can_edit_customer_segment: true, permissions: ['modulo_alertas_comerciales', 'modulo_metas', 'modulo_oportunidades', 'modulo_vig_ia', 'vigia_copilot_pilot'] },
  ];
  for (const person of people) {
    const result = accessFromTabs(tabsFromProfile(person));
    assert.equal(result.role, person.role);
    assert.deepEqual(new Set(result.permissions), new Set(person.permissions));
    assert.equal(result.can_edit_customer_segment, person.can_edit_customer_segment);
    assert.equal(result.can_own_opportunities, person.can_own_opportunities);
  }
});

test('resumen de pestañas para la lista', () => {
  assert.deepEqual(tabsSummary(tabsFromProfile({ role: 'comercial', permissions: ['modulo_oportunidades', 'licitaciones'] })), ['Oportunidades (las suyas)', 'Licitaciones']);
});

test('menú: Programación aparece con su permiso y quien sólo tiene Programación no ve Mi día', () => {
  const programacion = { id: 'p', active: true, role: 'colaborador', permissions: ['modulo_programacion'] };
  const groups = getVisibleNavGroups(programacion);
  assert.deepEqual(groups.map(group => group.title), ['Programación']);
  assert.equal(groups[0].items[0].external, true);
  const soloLicitaciones = { id: 'l', active: true, role: 'comercial', permissions: ['licitaciones'] };
  assert.ok(!getVisibleNavGroups(soloLicitaciones).some(group => group.items.some(item => item.page === 'home')));
  assert.notEqual(preferredLandingRoute(soloLicitaciones), 'home');
});

test('pantalla: sin rol ni áreas; con pestañas, plantillas y último ingreso', () => {
  assert.ok(!ui.includes('Alcance por áreas y subáreas'));
  assert.ok(!ui.includes("['colaborador','Colaborador']"));
  for (const text of ['Pestañas que puede abrir', 'Empezar desde una plantilla', 'Solo consulta: ve, pero no cambia nada', 'Último ingreso', 'Pendiente de configurar en Programación']) assert.ok(ui.includes(text), text);
});

test('migración 130: crea el permiso, da la entrada a quien ya está en Programación y deja auditoría', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human');
    create table public.psi_access_permissions (code text primary key, name text not null, description text not null default '', active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid references public.psi_sales_profiles(id), permission_code text references public.psi_access_permissions(code), created_by uuid, primary key (profile_id, permission_code));
    create table public.psi_access_audit_log (id serial primary key, actor_profile_id uuid, target_profile_id uuid, action text not null, before_state jsonb, after_state jsonb);
    create schema programacion;
    create table programacion.accesos (profile_id uuid primary key, rol text not null, ciudad_id text, activo boolean not null default true);
    insert into public.psi_sales_profiles values ('11111111-1111-4111-8111-111111111111', true, 'human'), ('22222222-2222-4222-8222-222222222222', true, 'human');
    insert into programacion.accesos values ('11111111-1111-4111-8111-111111111111', 'admin', null, true), ('22222222-2222-4222-8222-222222222222', 'consulta', null, false);
  `);
  await pg.exec(strip(migration130));
  await pg.exec(strip(migration130));
  const granted = (await pg.query("select profile_id from public.psi_profile_permissions where permission_code = 'modulo_programacion'")).rows;
  assert.deepEqual(granted.map(row => row.profile_id), ['11111111-1111-4111-8111-111111111111'], 'solo quien tiene acceso activo');
  assert.equal((await pg.query("select count(*)::int n from public.psi_access_audit_log where action = 'profile.permission.migration_130'")).rows[0].n, 1, 'reaplicar no duplica');
  const exec = (await pg.query("select has_function_privilege('authenticated', 'public.psi_admin_persist_profile_access(text,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid)', 'execute') ok")).rows[0].ok;
  assert.equal(exec, false);
  await pg.close();
});
