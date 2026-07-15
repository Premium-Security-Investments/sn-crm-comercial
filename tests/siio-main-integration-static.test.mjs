import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync('src/main.tsx', 'utf8');
const dashboard = fs.readFileSync('src/siio/SiioDashboard.tsx', 'utf8');
const navigation = fs.readFileSync('src/siio/SiioNavigation.tsx', 'utf8');
const css = fs.readFileSync('src/styles.css', 'utf8');

for (const marker of [
  "| 'siio'",
  'href="#/siio"',
  'SIIO Gerencial',
  'href="#/dashboard2">Dashboard comercial',
  "route.page === 'siio'",
  "import { SiioDashboard } from './siio/SiioDashboard';",
  "if (route.page === 'siio') return <SiioDashboard",
  'canAccessRoute(data.currentProfile, route.page)',
  'OPPORTUNITIES_PAGE_SIZE = 25',
  'TENDERS_PAGE_SIZE = 24',
  'deduplicateTenders',
  "event.key === 'Escape'",
]) assert.ok(main.includes(marker), `missing main marker: ${marker}`);

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
