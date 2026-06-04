import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [src, server, api]) {
  assert(file.includes('currentProfile'), 'La app/API debe exponer y usar currentProfile para permisos por rol.');
}

assert(src.includes('LoginScreen'), 'Frontend debe tener pantalla LoginScreen.');
assert(src.includes('supabaseBrowser.auth.signInWithPassword'), 'Frontend debe autenticar con Supabase Auth email/clave.');
assert(src.includes('supabaseBrowser.auth.signOut'), 'Frontend debe permitir cerrar sesión.');
assert(src.includes("'users'"), 'Frontend debe incluir ruta users para administración.');
assert(src.includes('UsersAdmin'), 'Frontend debe incluir módulo UsersAdmin.');
assert(src.includes('canManageUsers'), 'Frontend debe ocultar administración a roles no autorizados.');
assert(src.includes('Authorization'), 'Frontend debe enviar Authorization Bearer a la API.');
assert(src.includes("['director','Directivo']"), 'Frontend debe mostrar el rol director como Directivo para usuarios ejecutivos.');
assert(src.includes('currentProfile={data.currentProfile}'), 'Formulario de seguimiento debe recibir currentProfile para preseleccionar quien registra.');
assert(src.includes('created_by: currentProfile.id'), 'Formulario de seguimiento debe preseleccionar al usuario logueado, no el primer perfil alfabético.');

for (const file of [server, api]) {
  assert(file.includes('getAuthContext'), 'API debe validar sesión Supabase en getAuthContext.');
  assert(file.includes('filterBootstrapForProfile'), 'API debe filtrar bootstrap según perfil/rol.');
  assert(file.includes('payload.opportunities.filter(o => o.owner_id === currentProfile.id)'), 'API debe limitar oportunidades de comerciales a su propio owner_id.');
  assert(file.includes('opportunity.owner_id !== profile.id'), 'API debe impedir que comerciales abran/modifiquen oportunidades de otros.');
  assert(file.includes("app.get('/api/users'"), 'API debe exponer GET /api/users para admin.');
  assert(file.includes("app.post('/api/users'"), 'API debe exponer POST /api/users para crear usuarios.');
  assert(file.includes('auth.admin.createUser'), 'API debe crear usuarios con Supabase Auth admin.');
  assert(file.includes('normalizeUserRole'), 'API debe normalizar aliases de rol como directivo -> director.');
  assert(file.includes("raw === 'directivo'"), 'API debe aceptar Directivo como alias compatible del rol director.');
  assert(file.includes("role === 'comercial'"), 'API debe tratar comercial como rol restringido.');
}

console.log('auth-roles static checks passed');
