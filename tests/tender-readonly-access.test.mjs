import { strict as assert } from 'node:assert';
import { ACTIONS, can } from '../access-control.js';
import {
  canAccessRoute,
  canViewTenders,
  getVisibleNavGroups,
  preferredLandingRoute,
} from '../src/navPermissions.ts';
import { CAPABILITY_PERMISSION_CODES } from '../module-access.js';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.VERCEL = '1';
const {
  clientProfileForTenderUi,
  ensureOpportunityAccess,
  requireOpportunityDetailModule,
  requireTenderReadonlyBoundary,
} = await import('../server/index.js');

const readonlyProfile = {
  id: 'qa-hermes',
  role: 'colaborador',
  active: true,
  identity_type: 'human',
  areas: [],
  permissions: ['licitaciones_lectura'],
};

const tenderOpportunity = {
  area_code: 'comercial',
  subarea_code: null,
  owner_id: 'another-profile',
  service_type_code: 'licitacion_publica',
};
const commercialOpportunity = {
  ...tenderOpportunity,
  service_type_code: 'seguridad_fisica',
};

assert.ok(CAPABILITY_PERMISSION_CODES.includes('licitaciones_lectura'), 'el permiso de lectura debe pertenecer al catálogo de capacidades');
assert.equal(canViewTenders(readonlyProfile), true, 'el perfil QA debe ver Licitaciones');
assert.equal(canAccessRoute(readonlyProfile, 'tenders'), true, 'el perfil QA debe entrar al Radar');
assert.equal(canAccessRoute(readonlyProfile, 'detail'), true, 'el perfil QA debe poder abrir el detalle enlazado desde Licitaciones');
assert.equal(preferredLandingRoute(readonlyProfile), 'tenders', 'Licitaciones debe ser su única pantalla inicial');
assert.deepEqual(
  getVisibleNavGroups(readonlyProfile).map(group => ({ title: group.title, labels: group.items.map(item => item.label) })),
  [{ title: 'Licitaciones', labels: ['Radar'] }],
  'la navegación QA debe exponer únicamente Licitaciones',
);

assert.equal(can(readonlyProfile, ACTIONS.NAV_LICITACIONES_VIEW), true);
assert.equal(can(readonlyProfile, ACTIONS.LICITACIONES_VIEW), true);
assert.equal(can(readonlyProfile, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, tenderOpportunity), true, 'puede leer únicamente oportunidades de licitación');
assert.equal(can(readonlyProfile, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, commercialOpportunity), false, 'no puede leer oportunidades comerciales ordinarias');
assert.equal(can(readonlyProfile, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, { ...tenderOpportunity, service_type_code: null }), false, 'el tipo faltante debe fallar cerrado');
assert.equal(requireOpportunityDetailModule(readonlyProfile), true, 'el backend debe permitir llegar al guard de recurso para detalles de licitación');

for (const [method, requestPath] of [
  ['POST', '/api/tender-question-responses'],
  ['PUT', '/api/tenders/item'],
  ['DELETE', '/api/tender-documents/item'],
  ['POST', '/api/agt002-reanalysis'],
]) {
  assert.throws(
    () => requireTenderReadonlyBoundary(readonlyProfile, method, requestPath),
    error => error?.status === 403 && error?.code === 'FORBIDDEN' && /solo lectura/i.test(error.message),
    `${method} ${requestPath} debe quedar bloqueado antes de llegar al handler`,
  );
}
assert.equal(requireTenderReadonlyBoundary(readonlyProfile, 'GET', '/api/tender-documents'), true, 'las consultas permanecen habilitadas');
assert.equal(requireTenderReadonlyBoundary(readonlyProfile, 'POST', '/api/opportunity-interactions'), true, 'la barrera no altera rutas CRM; sus guards propios siguen vigentes');
assert.equal(
  requireTenderReadonlyBoundary({ ...readonlyProfile, permissions: ['licitaciones'] }, 'POST', '/api/tender-documents-upload'),
  true,
  'el permiso operativo existente conserva las escrituras autorizadas',
);
assert.deepEqual(
  clientProfileForTenderUi(readonlyProfile, { TENDER_PUBLIC_UI_ENABLED: 'false' }).permissions,
  [],
  'el feature flag debe ocultar también la capability de lectura',
);

for (const action of [
  ACTIONS.CRM_OPPORTUNITY_EDIT,
  ACTIONS.CRM_OPPORTUNITY_CREATE,
  ACTIONS.CRM_OPPORTUNITY_REASSIGN,
  ACTIONS.LICITACIONES_WORKBENCH_USE,
  ACTIONS.LICITACIONES_WORKBENCH_CUSTODY,
  ACTIONS.LICITACIONES_CONVERT,
  ACTIONS.LICITACIONES_CONFIGURE,
  ACTIONS.LICITACIONES_COMPANY_PROFILE_UPDATE,
  ACTIONS.LICITACIONES_SYNC,
  ACTIONS.LICITACIONES_DISCARD_PROPOSE,
  ACTIONS.LICITACIONES_DISCARD_APPROVE,
  ACTIONS.LICITACIONES_GO_NO_GO_RECOMMEND,
  ACTIONS.LICITACIONES_GO_NO_GO_APPROVE,
  ACTIONS.AI_ANALYSIS_RUN,
]) {
  assert.equal(can(readonlyProfile, action, tenderOpportunity), false, `${action} debe permanecer bloqueada para QA`);
}

const forgedAgent = { ...readonlyProfile, identity_type: 'agent' };
assert.equal(can(forgedAgent, ACTIONS.LICITACIONES_VIEW), false, 'una identidad agente no hereda el permiso humano de lectura');
assert.equal(can(forgedAgent, ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW, tenderOpportunity), false, 'una identidad agente no abre detalles con este permiso');

function accessDatabase(opportunity) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const rows = table === 'psi_sales_opportunities' ? opportunity : [];
      const query = {
        select() { return query; },
        eq() { return query; },
        single() { return Promise.resolve({ data: rows, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
}

const tenderDb = accessDatabase({
  id: 'tender-opportunity',
  owner_id: 'another-profile',
  customer_segment: null,
  service_type_code: 'licitacion_publica',
});
assert.equal(
  (await ensureOpportunityAccess(tenderDb, 'tender-opportunity', readonlyProfile)).id,
  'tender-opportunity',
  'el guard servidor debe autorizar el detalle de una licitación por su tipo canónico',
);
assert.deepEqual(tenderDb.calls, ['psi_sales_opportunities'], 'la lectura QA no necesita heredar scope del owner comercial');

const nonTenderDb = accessDatabase({
  id: 'commercial-opportunity',
  owner_id: 'another-profile',
  customer_segment: null,
  service_type_code: 'seguridad_fisica',
});
await assert.rejects(
  () => ensureOpportunityAccess(nonTenderDb, 'commercial-opportunity', readonlyProfile),
  error => error?.status === 403 && error?.code === 'FORBIDDEN',
  'el guard servidor debe bloquear una oportunidad que no sea licitación',
);

console.log('tender readonly access tests passed');
