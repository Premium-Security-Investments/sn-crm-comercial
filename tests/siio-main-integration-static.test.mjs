import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync('src/main.tsx', 'utf8');
const css = fs.readFileSync('src/styles.css', 'utf8');

for (const marker of [
  "| 'siio'",
  'href="#/siio"',
  'SIIO Gerencial',
  'Sistema Integrado de Información Operativa',
  'href="#/dashboard2">Dashboard comercial',
  "route.page === 'siio'",
  '<SiioDashboard',
  "type SiioTab = 'inicio' | 'frentes' | 'registros' | 'decisiones' | 'archivo' | 'razonamiento' | 'agentes' | 'junta'",
  'function SiioDashboard',
  'function SiioExecutiveHome',
  "if (route.page === 'siio') return <SiioDashboard",
  'canAccessRoute(data.currentProfile, route.page)',
  'OPPORTUNITIES_PAGE_SIZE = 25',
  'TENDERS_PAGE_SIZE = 24',
  'deduplicateTenders',
  "event.key === 'Escape'",
]) assert.ok(main.includes(marker), `missing main marker: ${marker}`);

for (const marker of [
  '.sidebar-nav-scroll',
  'overflow-y:auto',
  'grid-template-columns:232px minmax(0,1fr)',
  '.sidebar-footer-compact',
]) assert.ok(css.includes(marker), `missing css marker: ${marker}`);

console.log('siio main integration static checks passed');
