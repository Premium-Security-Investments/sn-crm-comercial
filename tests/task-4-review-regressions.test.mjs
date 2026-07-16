import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isModulePermissionEligible } from '../module-access.js';
import { ACTIONS, can } from '../access-control.js';

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
const { filterBootstrapForProfile } = await import('../server/index.js');

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const director = { id: 'director', role: 'director', active: true, areas: [{ area_code: 'comercial', subarea_code: 'norte' }], permissions: ['modulo_dashboard_comercial', 'modulo_siio_gerencial'] };

assert.equal(isModulePermissionEligible('director', 'modulo_siio_gerencial'), true, 'director conserva elegibilidad explícita para SIIO; el scope se compone en Task 4B');
assert.equal(isModulePermissionEligible('junta', 'modulo_siio_gerencial'), true, 'junta sólo es elegible para el módulo ejecutivo SIIO');
assert.deepEqual(isModulePermissionEligible('junta', 'modulo_dashboard_comercial'), false, 'junta no recibe otros módulos automáticos');
assert.equal(can(director, ACTIONS.MODULE_SIIO_VIEW), true, 'el módulo explícito habilita la puerta de entrada del director sin sustituir el scope posterior');

const payload = {
  summary: [{ stage_code: 'prospecto' }],
  opportunities: [{ id: 'own', owner_id: 'director', area_code: 'comercial', subarea_code: 'norte' }, { id: 'other', owner_id: 'other', area_code: 'comercial', subarea_code: 'sur' }],
  profiles: [{ id: 'director', full_name: 'Directora', microsoft_email: 'secret@example.test', active: true, permissions: ['x'], areas: [{ area_code: 'comercial' }] }, { id: 'other', full_name: 'Otra', microsoft_email: 'other@example.test' }],
  profileAssignments: [{ profile_id: 'director', area_code: 'comercial', subarea_code: 'norte' }, { profile_id: 'other', area_code: 'comercial', subarea_code: 'sur' }],
  stages: [], services: [], lossReasons: [], stalled: [{ id: 'other', owner_id: 'other' }], topClosing: [{ id: 'other', owner_id: 'other' }], monthlyKpis: [{ owner_id: 'other' }], goals: [{ user_id: 'other' }], totals: { count: 1 },
};
const scoped = filterBootstrapForProfile(payload, director);
assert.deepEqual(scoped.opportunities.map(row => row.id), ['own'], 'director no usa shortcut global de CRM');
assert.deepEqual(scoped.summary, [], 'director no recibe agregados CRM globales');
assert.deepEqual(scoped.profiles, [{ id: 'director', full_name: 'Directora' }], 'bootstrap perfila DTO mínimo sin PII ni configuración de acceso');
assert.deepEqual(scoped.monthlyKpis, [], 'director no recibe KPI fuera de sus owners visibles');
assert.deepEqual(scoped.goals, [], 'director no recibe metas fuera de sus owners visibles');

assert.match(source, /const BOOTSTRAP_PROFILE_SELECT = 'id,full_name';/, 'bootstrap define DTO mínimo de perfiles');
assert.doesNotMatch(source.slice(source.indexOf("app.get('/api/bootstrap'"), source.indexOf("app.get('/api/opportunities/:id'")), /microsoft_email|can_edit_customer_segment/, 'bootstrap no consulta PII/configuración de perfiles');
assert.match(source, /psi_profile_area_assignments'\)\.select\('profile_id,area_code,subarea_code'\)/, 'bootstrap deriva el scope de owners desde asignaciones canónicas del servidor');
assert.match(source, /export const HTTP_ACTION_MATRIX = Object\.freeze\(/, 'HTTP method+route matrix canónica es auditable');
for (const route of ['POST /api/opportunities', 'PUT /api/opportunity', 'GET /api/goals', 'GET /api/tenders', 'GET /api/users']) {
  assert.match(source, new RegExp(`['"]${route.replace('/', '\\/')}['"]`), `${route} está cubierto por matriz HTTP`);
}

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
console.log('Task 4 review regressions passed');
