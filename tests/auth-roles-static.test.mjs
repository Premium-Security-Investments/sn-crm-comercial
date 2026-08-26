import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const apiClient = readFileSync(new URL('../src/apiClient.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function restoreEnvironment(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

for (const file of [src, server, api]) {
  assert.ok(file.includes('currentProfile'), 'La app/API debe exponer y usar currentProfile para permisos por rol.');
}

assert(src.includes('LoginScreen'), 'Frontend debe tener pantalla LoginScreen.');
assert(src.includes('supabaseBrowser.auth.signInWithPassword'), 'Frontend debe autenticar con Supabase Auth email/clave.');
assert(src.includes('supabaseBrowser.auth.signOut'), 'Frontend debe permitir cerrar sesión.');
assert(src.includes("'users'"), 'Frontend debe incluir ruta users para administración.');
assert(src.includes('UsersAdmin'), 'Frontend debe incluir módulo UsersAdmin.');
assert(src.includes('canManageUsers'), 'Frontend debe ocultar administración a roles no autorizados.');
assert(apiClient.includes('Authorization') && apiClient.includes('Bearer ${currentAccessToken}'), 'Frontend debe enviar Authorization Bearer a la API.');
assert(src.includes("['director','Directivo']"), 'Frontend debe mostrar el rol director como Directivo para usuarios ejecutivos.');
assert(src.includes('currentProfile={data.currentProfile}'), 'Formulario de seguimiento debe recibir currentProfile como identidad autenticada.');
const followUpStart = src.indexOf('function FollowUpForm(');
const followUpEnd = src.indexOf('\nconst publicActuationOptions', followUpStart);
assert.notEqual(followUpStart, -1, 'FollowUpForm debe existir.');
assert.notEqual(followUpEnd, -1, 'Debe poder aislarse FollowUpForm.');
const followUp = src.slice(followUpStart, followUpEnd);
assert.doesNotMatch(followUp, /profiles\s*:/, 'FollowUpForm no debe recibir la lista de perfiles.');
assert.doesNotMatch(followUp, /<Select[^>]*created_by|profiles\.map/, 'Registrado por no debe permitir seleccionar otra identidad.');
assert.match(followUp, /<label>Registrado por<input[^>]*value=\{currentProfile\.full_name\}[^>]*readOnly[^>]*\/><\/label>/, 'Registrado por debe mostrar el perfil autenticado como identidad fija.');
assert.doesNotMatch(followUp, /created_by\s*:/, 'El frontend no debe enviar created_by en el payload del seguimiento.');

for (const file of [server, api]) {
  assert(file.includes('getAuthContext'), 'API debe validar sesión Supabase en getAuthContext.');
  assert(file.includes('filterBootstrapForProfile'), 'API debe filtrar bootstrap según perfil/rol.');
  assert(file.includes('canReadCrmRow'), 'API debe derivar lectura CRM mediante la política central de filas.');
  assert(file.includes('requireOpportunityAction'), 'API debe autorizar mutaciones CRM con la política central de acciones.');
  assert(file.includes("app.get('/api/users'"), 'API debe exponer GET /api/users para admin.');
  assert(file.includes("app.post('/api/users'"), 'API debe exponer POST /api/users para crear usuarios.');
  assert(file.includes('auth.admin.createUser'), 'API debe crear usuarios con Supabase Auth admin.');
  assert(file.includes('normalizeUserRole'), 'API debe normalizar aliases de rol como directivo -> director.');
  assert(file.includes("raw === 'directivo'"), 'API debe aceptar Directivo como alias compatible del rol director.');
  assert(file.includes("role === 'comercial'"), 'API debe tratar comercial como rol restringido.');
  assert.equal((file.match(/const created_by = currentProfile\.id;/g) || []).length, 2, 'Ambas rutas de interacción deben derivar el autor del perfil autenticado.');
}

assert.match(server, /psi_profile_area_assignments'\)\.select\('profile_id,area_code,subarea_code'\)/, 'El bootstrap debe derivar alcance desde asignaciones canónicas del servidor.');
assert.doesNotMatch(server, /payload\.opportunities\.filter\(o => o\.owner_id === currentProfile\.id\)/, 'El alcance no debe volver al filtro inline de owner_id.');

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
try {
  const { filterBootstrapForProfile } = await import('../server/index.js');
  const payload = {
    summary: [{ stage_code: 'prospecto', opportunities_count: 3 }],
    opportunities: [
      { id: 'own', owner_id: 'commercial', stage_code: 'prospecto', offer_value: 10, weighted_pipeline_value: 5 },
      { id: 'north', owner_id: 'north-owner', stage_code: 'prospecto', offer_value: 20, weighted_pipeline_value: 10 },
      { id: 'south', owner_id: 'south-owner', stage_code: 'aprobado', offer_value: 30, weighted_pipeline_value: 30 },
    ],
    profiles: [{ id: 'commercial', full_name: 'Comercial' }, { id: 'director', full_name: 'Directora' }, { id: 'north-owner', full_name: 'Norte' }, { id: 'south-owner', full_name: 'Sur' }],
    profileAssignments: [
      { profile_id: 'commercial', area_code: 'comercial', subarea_code: 'norte' },
      { profile_id: 'director', area_code: 'comercial', subarea_code: 'norte' },
      { profile_id: 'north-owner', area_code: 'comercial', subarea_code: 'norte' },
      { profile_id: 'south-owner', area_code: 'comercial', subarea_code: 'sur' },
    ],
    stages: [{ code: 'prospecto', name: 'Prospecto' }], services: [], lossReasons: [],
    stalled: [], topClosing: [], monthlyKpis: [], goals: [], totals: { count: 3, pipeline: 60, weighted: 45, approved: 30 },
  };
  const commercial = { id: 'commercial', role: 'comercial', active: true, areas: [], permissions: ['modulo_oportunidades'] };
  const director = { id: 'director', role: 'director', active: true, areas: [{ area_code: 'comercial', subarea_code: 'norte' }], permissions: ['modulo_dashboard_comercial'] };

  assert.deepEqual(filterBootstrapForProfile(payload, commercial).opportunities.map(row => row.id), ['own'], 'Comercial sólo recibe sus oportunidades por la acción de ownership central.');
  assert.deepEqual(filterBootstrapForProfile(payload, director).opportunities.map(row => row.id), ['own', 'north'], 'Director recibe sólo su owner y owners de su subárea comercial derivada del servidor, nunca la subárea sur.');
} finally {
  restoreEnvironment(savedEnv);
}

console.log('auth-roles static and centralized scope checks passed');
