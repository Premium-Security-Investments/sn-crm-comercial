import { strict as assert } from 'node:assert';
import { ACTIONS } from '../access-control.js';
const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const restoreEnv = () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};
process.once('exit', restoreEnv);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

const {
  MODULE_ENDPOINT_ACTIONS,
  bootstrapCapabilities,
  filterBootstrapForProfile,
  requireModuleAction,
} = await import('../server/index.js');

const profile = (role, permissions = [], overrides = {}) => ({
  id: `${role}-profile`,
  role,
  active: true,
  areas: [],
  permissions,
  ...overrides,
});

const scenarios = {
  commercialWithoutModules: profile('comercial'),
  opportunitiesOnly: profile('comercial', ['modulo_oportunidades']),
  goalsOnly: profile('comercial', ['modulo_metas']),
  dashboardOnly: profile('gerencia', ['modulo_dashboard_comercial']),
  vigiaOnly: profile('gerencia', ['modulo_vig_ia']),
  siioOnly: profile('gerencia', ['modulo_siio_gerencial']),
  adminWithoutUsers: profile('admin'),
  adminWithUsers: profile('admin', ['modulo_usuarios']),
  tenderOnly: profile('comercial', ['licitaciones']),
};

assert.deepEqual(MODULE_ENDPOINT_ACTIONS, {
  opportunities: ACTIONS.MODULE_OPPORTUNITIES_VIEW,
  goals: ACTIONS.MODULE_GOALS_VIEW,
  siio: ACTIONS.MODULE_SIIO_VIEW,
  vigia: ACTIONS.MODULE_VIGIA_VIEW,
  tenders: ACTIONS.LICITACIONES_VIEW,
  users: ACTIONS.MODULE_USERS_VIEW,
}, 'la tabla auditable endpoint→módulo debe centralizar las familias protegidas');

for (const endpoint of [
  '/api/opportunities/:id',
  'POST /api/opportunities',
  'PUT /api/opportunities/:id',
  'POST /api/opportunities/:id/interactions',
]) {
  assert.throws(
    () => requireModuleAction(scenarios.commercialWithoutModules, 'opportunities'),
    error => error?.status === 403 && error?.code === 'FORBIDDEN' && !/opportunit|comercial|profile/i.test(error.message),
    `${endpoint} debe denegar 403 antes de leer o procesar datos sin Oportunidades`,
  );
  assert.equal(requireModuleAction(scenarios.opportunitiesOnly, 'opportunities'), true, `${endpoint} permite entrada con Oportunidades`);
}

for (const endpoint of ['GET /api/goals', 'PUT /api/goals']) {
  assert.throws(() => requireModuleAction(scenarios.commercialWithoutModules, 'goals'), error => error?.status === 403 && error?.code === 'FORBIDDEN', `${endpoint} deniega sin Metas`);
  assert.equal(requireModuleAction(scenarios.goalsOnly, 'goals'), true, `${endpoint} permite entrada con Metas; el rol/recurso conserva la decisión posterior`);
}

for (const endpoint of ['/api/siio/bootstrap', '/api/siio/records', '/api/siio/board-reports']) {
  assert.throws(() => requireModuleAction(scenarios.dashboardOnly, 'siio'), error => error?.status === 403 && error?.code === 'FORBIDDEN', `${endpoint} deniega SIIO ausente`);
  assert.equal(requireModuleAction(scenarios.siioOnly, 'siio'), true, `${endpoint} permite entrada con SIIO; requireSiioAccess conserva la restricción de rol`);
}

assert.throws(() => requireModuleAction(scenarios.dashboardOnly, 'vigia'), error => error?.status === 403 && error?.code === 'FORBIDDEN', '/api/vigia/priorities exige Vig-IA explícito');
assert.equal(requireModuleAction(scenarios.vigiaOnly, 'vigia'), true, '/api/vigia/priorities permite Vig-IA explícito');
assert.equal(bootstrapCapabilities(scenarios.vigiaOnly).vigia, true, 'capacidad Vig-IA se deriva del módulo explícito');

for (const endpoint of ['/api/users', '/api/access-catalog']) {
  assert.throws(() => requireModuleAction(scenarios.adminWithoutUsers, 'users'), error => error?.status === 403 && error?.code === 'FORBIDDEN', `${endpoint} exige Usuarios explícito además de admin`);
  assert.equal(requireModuleAction(scenarios.adminWithUsers, 'users'), true, `${endpoint} permite módulo Usuarios; USERS_MANAGE conserva admin-only`);
}

assert.throws(() => requireModuleAction(scenarios.commercialWithoutModules, 'tenders'), error => error?.status === 403 && error?.code === 'FORBIDDEN', '/api/tenders exige licitaciones existente');
assert.equal(requireModuleAction(scenarios.tenderOnly, 'tenders'), true, '/api/tenders permite licitaciones explícito');
assert.throws(() => requireModuleAction(profile('comercial', ['modulo_oportunidades'], { active: false }), 'opportunities'), error => error?.status === 403, 'perfil inactivo falla cerrado');
assert.throws(() => requireModuleAction(profile('comercial', ['modulo_siio_gerencial']), 'siio'), error => error?.status === 403, 'módulo incompatible con rol falla cerrado');
assert.throws(() => requireModuleAction(scenarios.opportunitiesOnly, 'unknown-module'), error => error?.status === 403 && error?.code === 'FORBIDDEN', 'familia desconocida falla cerrada');

const payload = {
  summary: [{ stage_code: 'prospecto', opportunities_count: 2 }],
  opportunities: [{ id: 'own', owner_id: 'comercial-profile', stage_code: 'prospecto', offer_value: 10, weighted_pipeline_value: 5 }, { id: 'other', owner_id: 'other-profile', stage_code: 'aprobado', offer_value: 20, weighted_pipeline_value: 20 }],
  profiles: [{ id: 'comercial-profile', full_name: 'Comercial' }, { id: 'other-profile', full_name: 'Otro' }],
  stages: [{ code: 'prospecto', name: 'Prospecto' }],
  services: [{ code: 'seguridad', name: 'Seguridad' }],
  lossReasons: [{ code: 'precio', name: 'Precio' }],
  stalled: [{ id: 'own', owner_id: 'comercial-profile' }, { id: 'other', owner_id: 'other-profile' }],
  topClosing: [{ id: 'own', owner_id: 'comercial-profile' }, { id: 'other', owner_id: 'other-profile' }],
  monthlyKpis: [{ owner_id: 'comercial-profile' }, { owner_id: 'other-profile' }],
  goals: [{ user_id: 'comercial-profile' }, { user_id: 'other-profile' }],
  totals: { count: 2, pipeline: 30, weighted: 25, approved: 20 },
};
const emptyBootstrap = filterBootstrapForProfile(payload, scenarios.commercialWithoutModules);
for (const key of ['summary', 'opportunities', 'profiles', 'stages', 'services', 'lossReasons', 'stalled', 'topClosing', 'monthlyKpis', 'goals']) assert.deepEqual(emptyBootstrap[key], [], `sin módulos no expone ${key}`);
assert.deepEqual(emptyBootstrap.totals, { count: 0, pipeline: 0, weighted: 0, approved: 0 }, 'sin módulos no expone totales comerciales');
assert.equal(emptyBootstrap.currentProfile, scenarios.commercialWithoutModules, 'currentProfile siempre permanece disponible');

const opportunitiesBootstrap = filterBootstrapForProfile(payload, scenarios.opportunitiesOnly);
assert.deepEqual(opportunitiesBootstrap.opportunities.map(row => row.id), ['own'], 'Oportunidades conserva scope de ownership');
assert.equal(opportunitiesBootstrap.stages.length, 1, 'Oportunidades conserva catálogo de etapas');
assert.equal(opportunitiesBootstrap.services.length, 1, 'Oportunidades conserva catálogo de servicios');
assert.equal(opportunitiesBootstrap.lossReasons.length, 1, 'Oportunidades conserva catálogo de motivos de pérdida');
for (const key of ['summary', 'stalled', 'topClosing', 'monthlyKpis', 'goals']) assert.deepEqual(opportunitiesBootstrap[key], [], `Oportunidades no recibe ${key} exclusivo de otros módulos`);

const goalsBootstrap = filterBootstrapForProfile(payload, scenarios.goalsOnly);
assert.deepEqual(goalsBootstrap.opportunities, [], 'Metas no expone registros de oportunidades');
assert.deepEqual(goalsBootstrap.goals.map(row => row.user_id), ['comercial-profile'], 'Metas conserva scope propio');
assert.deepEqual(goalsBootstrap.monthlyKpis.map(row => row.owner_id), ['comercial-profile'], 'Metas conserva KPI propio');
assert.equal(goalsBootstrap.profiles.length, 1, 'Metas conserva etiquetas de perfiles necesarias');
assert.equal(goalsBootstrap.services.length, 1, 'Metas conserva catálogo de servicios necesario');

const dashboardBootstrap = filterBootstrapForProfile(payload, scenarios.dashboardOnly);
assert.equal(bootstrapCapabilities(scenarios.dashboardOnly).dashboard, true, 'capacidad Dashboard se deriva de módulo explícito');
assert.deepEqual(dashboardBootstrap.opportunities, payload.opportunities, 'Dashboard conserva agregados/fuentes compartidas que consume');
assert.deepEqual(dashboardBootstrap.summary, payload.summary, 'Dashboard conserva resumen compartido');
assert.deepEqual(dashboardBootstrap.stalled, payload.stalled, 'Dashboard conserva alertas agregadas');
assert.deepEqual(dashboardBootstrap.topClosing, payload.topClosing, 'Dashboard conserva cierres agregados');

console.log('backend module route guard and capability bootstrap contract passed');

