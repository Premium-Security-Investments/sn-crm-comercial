// Rol "Directivo de solo consulta": ve todo lo directivo y no escribe nada. Cubre la matriz de acciones, la barrera
// global del servidor (cualquier método que no sea de lectura → 403) y la navegación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, can, isReadOnlyRole } from '../access-control.js';
import { eligibleModulePermissions, isModulePermissionEligible } from '../module-access.js';
import { canAccessRoute, canWriteGoals, getVisibleNavGroups, isDirectiveViewerRole, isManagementRole, isReadOnlyProfile, preferredLandingRoute } from '../src/navPermissions.ts';

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
const server = await import('../server/index.js');
for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }

const READ_MODULES = ['modulo_siio_gerencial', 'modulo_dashboard_comercial', 'modulo_alertas_comerciales', 'modulo_oportunidades', 'licitaciones'];
const consulta = (overrides = {}) => ({ id: 'consulta-1', role: 'consulta', active: true, identity_type: 'human', areas: [], permissions: READ_MODULES, ...overrides });
const crm = { area_code: 'comercial', subarea_code: null, owner_id: 'otro-comercial' };
const siioAssignment = { area_code: 'gerencia', subarea_code: null, assignee_id: 'alguien' };

test('el catálogo de módulos de consulta es de sólo lectura', () => {
  assert.deepEqual(eligibleModulePermissions('consulta'), READ_MODULES);
  for (const code of ['modulo_metas', 'modulo_usuarios', 'modulo_vig_ia']) assert.equal(isModulePermissionEligible('consulta', code), false, code);
  assert.equal(isReadOnlyRole('consulta'), true);
  for (const role of ['admin', 'gerencia', 'director', 'comercial', 'colaborador', 'junta', null, undefined]) assert.equal(isReadOnlyRole(role), false, String(role));
});

test('consulta lee todo lo directivo', () => {
  const profile = consulta();
  for (const [action, resource] of [
    [ACTIONS.MODULE_DASHBOARD_VIEW, {}], [ACTIONS.MODULE_OPPORTUNITIES_VIEW, {}], [ACTIONS.MODULE_SIIO_VIEW, {}], [ACTIONS.MODULE_ALERTS_VIEW, {}],
    [ACTIONS.NAV_GERENCIAL_VIEW, {}], [ACTIONS.NAV_COMERCIAL_VIEW, {}], [ACTIONS.NAV_LICITACIONES_VIEW, {}],
    [ACTIONS.CRM_PIPELINE_SUMMARY_VIEW, {}], [ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, crm],
    [ACTIONS.LICITACIONES_VIEW, {}], [ACTIONS.SIIO_AREA_VIEW, { area_code: 'gerencia' }], [ACTIONS.SIIO_ASSIGNMENT_VIEW, siioAssignment],
    [ACTIONS.BOARD_PUBLICATION_VIEW, { status: 'borrador' }],
  ]) assert.equal(can(profile, action, resource), true, action);
});

test('consulta no escribe ni opera nada, aunque reciba permisos de operación por error', () => {
  const profile = consulta({ permissions: [...READ_MODULES, 'licitaciones_custodia', 'licitaciones_empresa', 'crm_eliminar_oportunidades', 'vigia_copilot_pilot', 'modulo_vig_ia', 'modulo_metas', 'modulo_usuarios'] });
  for (const [action, resource] of [
    [ACTIONS.CRM_OPPORTUNITY_CREATE, crm], [ACTIONS.CRM_OPPORTUNITY_EDIT, crm], [ACTIONS.CRM_OPPORTUNITY_REASSIGN, crm],
    [ACTIONS.USERS_MANAGE, {}], [ACTIONS.MODULE_GOALS_VIEW, {}], [ACTIONS.MODULE_USERS_VIEW, {}], [ACTIONS.MODULE_VIGIA_VIEW, {}],
    [ACTIONS.LICITACIONES_WORKBENCH_USE, {}], [ACTIONS.LICITACIONES_WORKBENCH_CUSTODY, {}], [ACTIONS.LICITACIONES_CONVERT, {}],
    [ACTIONS.LICITACIONES_CONFIGURE, {}], [ACTIONS.LICITACIONES_COMPANY_PROFILE_UPDATE, {}], [ACTIONS.LICITACIONES_SYNC, {}],
    [ACTIONS.LICITACIONES_DISCARD_PROPOSE, {}], [ACTIONS.LICITACIONES_DISCARD_APPROVE, {}], [ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND, {}],
    [ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, {}], [ACTIONS.SIIO_SUBJECT_CREATE, { area_code: 'gerencia' }], [ACTIONS.SIIO_SUBJECT_EDIT, { area_code: 'gerencia' }],
    [ACTIONS.SIIO_ASSIGNMENT_UPDATE, siioAssignment], [ACTIONS.SIIO_CLOSE_REQUEST, siioAssignment], [ACTIONS.SIIO_CLOSE_APPROVE, siioAssignment],
    [ACTIONS.BOARD_DRAFT_EDIT, {}], [ACTIONS.BOARD_APPROVE, {}], [ACTIONS.BOARD_PUBLISH, {}],
    [ACTIONS.AI_ANALYSIS_RUN, {}], [ACTIONS.AI_COMMERCIAL_DRAFT_RUN, crm],
    [ACTIONS.LICITACIONES_ACTIONABLE_REVIEW_CONTRIBUTE, crm], [ACTIONS.LICITACIONES_ACTIONABLE_REVIEW_RESOLVE, crm],
    [ACTIONS.LICITACIONES_KNOWLEDGE_PROPOSE, crm], [ACTIONS.LICITACIONES_KNOWLEDGE_REVIEW, crm], [ACTIONS.LICITACIONES_KNOWLEDGE_PUBLISH, crm],
  ]) assert.equal(can(profile, action, resource), false, action);
});

test('la barrera global del servidor rechaza cualquier método de escritura del rol consulta', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) assert.equal(server.assertReadOnlyRoleMethod(consulta(), method), true, method);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
    assert.throws(() => server.assertReadOnlyRoleMethod(consulta(), method), error => error.status === 403
      && error.code === 'READ_ONLY_PROFILE'
      && error.message === 'Su perfil es de solo consulta; no puede modificar información.', method);
  }
  for (const role of ['admin', 'gerencia', 'comercial']) assert.equal(server.assertReadOnlyRoleMethod({ role }, 'POST'), true, role);
});

test('getAuthContext aplica la barrera antes de devolver el perfil, para todas las rutas (CRM, SIIO, AGT-002)', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = source.indexOf('export async function getAuthContext(req)');
    const end = source.indexOf('\nfunction sendAuthError', start);
    const body = source.slice(start, end);
    assert.ok(body.indexOf("profile.active !== true") < body.indexOf('assertReadOnlyRoleMethod(profile, req?.method)'), file);
    assert.ok(body.indexOf('assertReadOnlyRoleMethod(profile, req?.method)') < body.indexOf('return { user: userData.user'), file);
  }
});

test('el alcance de lectura de consulta es global, pero no hereda permisos de escritura de gerencia', () => {
  const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(source, /const globalCrmScopeRoles = new Set\(\['gerencia', 'admin'\]\);/);
  assert.match(source, /const globalCrmReadScopeRoles = new Set\(\[\.\.\.globalCrmScopeRoles, 'consulta'\]\);/);
  assert.match(source, /async function resolveVigiaOwnerScope\(database, profile\) \{\n  if \(globalCrmReadScopeRoles\.has/);
  assert.match(source, /if \(!globalCrmScopeRoles\.has\(currentProfile\?\.role\)\) \{ const error = new Error\('Solo gerencia\/admin puede modificar metas\.'\)/);
  const payload = {
    summary: [], stages: [], services: [], lossReasons: [], stalled: [], topClosing: [], monthlyKpis: [], goals: [], totals: {},
    opportunities: [{ id: 'o1', owner_id: 'c1', stage_code: 'prospecto' }, { id: 'o2', owner_id: 'c2', stage_code: 'prospecto' }],
    profiles: [{ id: 'c1', full_name: 'Uno', role: 'comercial', active: true }, { id: 'c2', full_name: 'Dos', role: 'comercial', active: true }, { id: 'a0020000-0000-4000-8000-000000000002', full_name: 'Vig-IA', role: 'comercial', active: true, identity_type: 'agent' }],
    profileAssignments: [],
  };
  const filtered = server.filterBootstrapForProfile(payload, consulta());
  assert.deepEqual(filtered.opportunities.map(row => row.id), ['o1', 'o2']);
  assert.deepEqual(filtered.profiles.map(row => row.id), ['c1', 'c2'], 'la identidad técnica no aparece entre los perfiles');
  assert.ok(filtered.profiles.every(row => row.is_commercial === true));
});

test('normaliza el rol y rechaza permisos de operación para consulta al administrar usuarios', () => {
  const catalog = { areas: [], subareas: [], permissions: [...READ_MODULES, 'licitaciones_custodia', 'modulo_metas'].map(code => ({ code, name: code, description: '' })) };
  assert.deepEqual(server.normalizeProfileAccessRequest({ areas: [], permissions: READ_MODULES }, catalog, 'consulta').permissions, READ_MODULES);
  assert.throws(() => server.normalizeProfileAccessRequest({ areas: [], permissions: ['licitaciones_custodia'] }, catalog, 'consulta'), /solo consulta/);
  assert.throws(() => server.normalizeProfileAccessRequest({ areas: [], permissions: ['modulo_metas'] }, catalog, 'consulta'), /no aplica para este rol/);
});

test('las identidades técnicas no se editan como usuarios', () => {
  assert.throws(() => server.assertEditableHumanProfile({ id: 'a', identity_type: 'agent' }), error => error.status === 403 && error.message === 'Identidad técnica no editable');
  assert.equal(server.assertEditableHumanProfile({ id: 'h', identity_type: 'human' }), true);
  assert.equal(server.assertEditableHumanProfile({ id: 'h', identity_type: null }), true);
});

test('navegación de consulta: SIIO, Dashboard comercial, Oportunidades y Radar; nunca rutas de escritura', () => {
  const profile = consulta();
  assert.deepEqual(getVisibleNavGroups(profile), [
    { title: 'Gerencia', items: [{ href: '#/siio', label: 'SIIO Gerencial', page: 'siio' }] },
    { title: 'Comercial', items: [{ href: '#/dashboard2', label: 'Dashboard comercial', page: 'dashboard2' }, { href: '#/opportunities', label: 'Oportunidades', page: 'opportunities' }] },
    { title: 'Licitaciones', items: [{ href: '#/tenders?view=radar', label: 'Radar', page: 'tenders' }] },
  ]);
  for (const page of ['new', 'edit', 'users', 'goals']) assert.equal(canAccessRoute(profile, page), false, page);
  for (const page of ['detail', 'opportunities', 'dashboard2', 'siio', 'tenders', 'consultant']) assert.equal(canAccessRoute(profile, page), true, page);
  assert.equal(isReadOnlyProfile(profile), true);
  assert.equal(isDirectiveViewerRole('consulta'), true);
  assert.equal(isManagementRole('consulta'), false, 'consulta no es rol de gestión: no edita segmentos');
  assert.equal(canWriteGoals(profile), false);
  assert.equal(preferredLandingRoute(profile), 'siio');
});

test('la interfaz oculta las acciones de escritura al rol de solo consulta', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const detail = main.slice(main.indexOf('function OpportunityDetail('), main.indexOf('const tenderDocumentTypeOptions'));
  assert.match(detail, /const readOnly = isReadOnlyProfile\(data\.currentProfile\);/);
  assert.match(detail, /\{canAccessRoute\(data\.currentProfile, 'edit'\) && <button onClick=\{\(\) => go\(`#\/edit\/\$\{o\.id\}`\)\}>Editar<\/button>\}/);
  assert.match(detail, /\{!readOnly && o\.service_type_code === 'licitacion_publica' && o\.stage_code !== 'descartado'/, 'sin botones de salida de licitación');
  assert.match(detail, /\{!readOnly && o\.service_type_code !== 'licitacion_publica' && !isTerminalStage\(o\.stage_code\) && <OpportunityDecisionPanel/);
  assert.match(detail, /\{!readOnly && <div id="opportunity-follow-up"[\s\S]{0,200}<FollowUpForm/);
  assert.match(main, /\{!siioShell && canAccessRoute\(currentProfile, 'new'\) && <NewOpportunityButton data=\{viewData\} \/>\}/);
  assert.match(main, /if \(!blocking\) return <button onClick=\{\(\) => go\('#\/new'\)\}>Nueva oportunidad<\/button>;/);
  assert.match(main, /\['consulta','Directivo de solo consulta'\]/, 'el selector de rol de Usuarios incluye consulta');
  assert.match(main, /consulta: 'Directivo de solo consulta'/);
  const siio = readFileSync(new URL('../src/siio/SiioDashboard.tsx', import.meta.url), 'utf8');
  assert.match(siio, /\{!readOnly && <button type="button" onClick=\{\(\) => setBoardDraftOpen\(true\)\}>Preparar informe de Junta<\/button>\}/);
  const tenderPermissions = readFileSync(new URL('../src/tenders/permissions.ts', import.meta.url), 'utf8');
  assert.match(tenderPermissions, /export function isTenderReadOnlyProfile/);
  for (const file of ['../src/tenders/TenderRadarView.tsx', '../src/tenders/TenderTrackingView.tsx']) {
    assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /const readOnly = isTenderReadOnlyProfile\(data\.currentProfile\);/, file);
  }
});

test('Vista Admin / Vista Comercial: selector en Sesión activa, guardado por persona con try/catch y sólo presentación', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /try \{ return window\.localStorage\.getItem\(`\$\{VIEW_MODE_STORAGE_PREFIX\}\$\{profileId\}`\) === 'comercial' \? 'comercial' : 'admin'; \} catch \{ return 'admin'; \}/);
  assert.match(main, /try \{ window\.localStorage\.setItem\(/);
  assert.match(main, /<div className="session-card">[\s\S]{0,400}canUseCommercialView\(realProfile\)[\s\S]{0,300}Vista Admin[\s\S]{0,300}Vista Comercial/);
  assert.match(main, /opportunities: data\.opportunities\.filter\(own\)/, 'en Vista Comercial sólo sus oportunidades');
  assert.match(main, /<RouterView route=\{route\} data=\{viewData\} refresh=\{refresh\} \/>/);
  assert.doesNotMatch(main, /viewMode[^\n]*api\(/, 'el modo nunca viaja al servidor');
});
