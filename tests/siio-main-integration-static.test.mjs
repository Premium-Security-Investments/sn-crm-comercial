import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync('src/main.tsx', 'utf8');
const navPermissions = fs.readFileSync('src/navPermissions.ts', 'utf8');
const dashboard = fs.readFileSync('src/siio/SiioDashboard.tsx', 'utf8');
const navigation = fs.readFileSync('src/siio/SiioNavigation.tsx', 'utf8');
const css = fs.readFileSync('src/styles.css', 'utf8');

for (const marker of [
  "| 'siio'",
  "route.page === 'siio'",
  "import { SiioDashboard } from './siio/SiioDashboard';",
  "if (route.page === 'siio') return <SiioDashboard",
  'canAccessRoute(data.currentProfile, route.page)',
  'OPPORTUNITIES_PAGE_SIZE = 25',
  'TENDERS_PAGE_SIZE = 24',
  'deduplicateTenders',
  "event.key === 'Escape'",
]) assert.ok(main.includes(marker), `missing main marker: ${marker}`);

assert.match(navPermissions, /title: 'Gerencia'[\s\S]{0,360}href: '#\/siio', label: 'SIIO Gerencial', page: 'siio'/, 'SIIO Gerencial debe vivir en el catálogo central de navegación.');
assert.match(navPermissions, /title: 'Comercial'[\s\S]{0,360}href: '#\/dashboard2', label: 'Dashboard comercial', page: 'dashboard2'/, 'Dashboard comercial debe vivir en el catálogo central de navegación.');
assert.match(main, /getVisibleNavGroups\(currentProfile\)[\s\S]{0,420}group\.items\.map\(item/, 'main debe renderizar las rutas visibles desde capacidades y no enlaces hardcoded.');
assert.doesNotMatch(main, /href="#\/(?:siio|dashboard2)"/, 'main no debe duplicar enlaces SIIO/Dashboard fuera del catálogo.');

assert.doesNotMatch(main, /function SiioDashboard/, 'SIIO dashboard must be extracted from main');
assert.match(dashboard, /SIIO — Sistema Interno de Inteligencia Operativa/);
assert.match(dashboard, /api<SiioBootstrapPayload>\('\/api\/siio\/bootstrap'\)/);
assert.match(dashboard, /isManagementRole\(currentProfile\.role\)/);
assert.match(navigation, /Resumen ejecutivo/);
assert.match(navigation, /Seguimiento gerencial/);
assert.match(navigation, /Fuentes e inteligencia/);
assert.match(navigation, /Agentes/);
assert.doesNotMatch(navigation, /F1-F6|Modo Junta/);

for (const marker of [
  '.sidebar-nav-scroll',
  'overflow-y:auto',
  'grid-template-columns:232px minmax(0,1fr)',
  '.sidebar-footer-compact',
]) assert.ok(css.includes(marker), `missing css marker: ${marker}`);

console.log('siio main integration static checks passed');
