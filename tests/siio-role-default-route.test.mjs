import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const mod = await loadModule('../src/navPermissions.ts');

assert.equal(mod.isInitialAppHash(''), true, 'empty hash is a root landing');
assert.equal(mod.isInitialAppHash('#'), true, 'bare hash is a root landing');
assert.equal(mod.isInitialAppHash('#/'), true, 'root hash is a root landing');
assert.equal(mod.isInitialAppHash('#/dashboard2'), false, 'an explicit route must never be treated as a root landing');
assert.equal(mod.isInitialAppHash('#/siio?view=resumen'), false, 'an explicit SIIO deep link must never be treated as a root landing');

const admin = { role: 'admin', active: true, permissions: ['modulo_siio_gerencial'] };
const gerencia = { role: 'gerencia', active: true, permissions: ['modulo_siio_gerencial'] };
const comercial = { role: 'comercial', active: true, permissions: ['modulo_oportunidades'] };
const directorWithDashboard = { role: 'director', active: true, permissions: ['modulo_dashboard_comercial'] };
const unauthorized = { role: 'director', active: true, permissions: [] };
const onlyUsersModule = { role: 'admin', active: true, permissions: ['modulo_usuarios'] };
const onlyGoalsModule = { role: 'gerencia', active: true, permissions: ['modulo_metas'] };

assert.equal(mod.preferredLandingRoute(admin), 'siio', 'admin with SIIO access must land on SIIO');
assert.equal(mod.preferredLandingRoute(gerencia), 'siio', 'gerencia with SIIO access must land on SIIO');
assert.notEqual(mod.preferredLandingRoute(comercial), 'siio', 'comercial must never land on SIIO');
assert.equal(mod.preferredLandingRoute(comercial), 'opportunities', 'comercial without dashboard access lands on its real authorized route');
assert.equal(mod.preferredLandingRoute(directorWithDashboard), 'dashboard2', 'a profile authorized for dashboard but not SIIO lands on dashboard2');
assert.notEqual(mod.preferredLandingRoute(directorWithDashboard), 'siio', 'director must never land on SIIO');
assert.equal(mod.preferredLandingRoute(onlyUsersModule), 'users', 'a profile authorized only for user administration must land on its own real route, not an unauthorized module');
assert.equal(mod.preferredLandingRoute(onlyGoalsModule), 'goals', 'a profile authorized only for goals must land on its own real route, not an unauthorized module');
assert.equal(mod.preferredLandingRoute(unauthorized), 'home', 'a profile with no authorized landing route must never be routed into an unauthorized module');

const main = readFileSync('src/main.tsx', 'utf8');
assert.match(main, /isInitialAppHash\(window\.location\.hash\)/, 'the initial landing redirect must be conditioned by isInitialAppHash so an explicit route is never replaced');
assert.match(main, /preferredLandingRoute\(/, 'main must compute the preferred landing route from the resolved profile');
assert.match(main, /window\.location\.replace\(/, 'the landing redirect must not push a new history entry');
assert.match(main, /page === 'home'\) return \{ page: 'home' \}/, 'main must resolve an explicit #/home hash instead of treating the permission-safe fallback as an invalid route');

console.log('SIIO role-aware initial landing contract OK');
