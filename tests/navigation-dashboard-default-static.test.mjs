import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const nav = fs.readFileSync(new URL('../src/navPermissions.ts', import.meta.url), 'utf8');

assert.ok(main.includes("return { page: 'dashboard' };"), 'default route / should render dashboard gerencial');
assert.ok(!main.includes("['#/','Inicio']"), 'Inicio should be removed from sidebar nav');
assert.match(main, /getVisibleNavGroups\(currentProfile\)[\s\S]{0,420}group\.items\.map\(item/, 'Sidebar debe renderizar el catálogo visible por capacidades.');
const navRenderer = main.slice(main.indexOf('function Nav('), main.indexOf('function RouterView'));
assert.doesNotMatch(navRenderer, /href="#\/(?:dashboard2|alerts|opportunities|goals|users|tenders)/, 'El renderer del sidebar no debe tener enlaces de producto hardcoded.');

const expectedGroups = ['Gerencia', 'Comercial', 'Licitaciones', 'Administración'];
let lastGroupIndex = -1;
for (const group of expectedGroups) {
  const idx = nav.indexOf(`title: '${group}'`);
  assert.ok(idx > lastGroupIndex, `El grupo ${group} debe existir y aparecer después del anterior en el catálogo.`);
  lastGroupIndex = idx;
}

const expectedItems = [
  ["#/siio", 'SIIO Gerencial', 'siio'],
  ["#/dashboard2", 'Dashboard comercial', 'dashboard2'],
  ["#/alerts", 'Prioridades Comerciales', 'alerts'],
  ["#/opportunities", 'Oportunidades', 'opportunities'],
  ["#/tenders?view=radar", 'Radar', 'tenders'],
  ["#/goals", 'Metas y cumplimiento', 'goals'],
  ["#/users", 'Usuarios y permisos', 'users'],
];
let lastItemIndex = -1;
for (const [href, label, page] of expectedItems) {
  const marker = `href: '${href}', label: '${label}', page: '${page}'`;
  const idx = nav.indexOf(marker);
  assert.ok(idx > lastItemIndex, `${marker} debe aparecer después del item anterior en el catálogo.`);
  lastItemIndex = idx;
}

assert.ok(!nav.includes("['#/new','Crear oportunidad']"), 'Crear oportunidad no debe ser ítem permanente del sidebar; debe quedar como acción contextual.');
assert.ok(!nav.includes("label: 'Vig-IA', page: 'centinel'"), 'Vig-IA comercial no debe permanecer como pestaña duplicada en Gerencia.');
assert.ok(main.includes("if (page === 'centinel' || page === 'vig-ia') return { page: 'alerts' };"), 'Las rutas históricas de Vig-IA deben converger en Prioridades Comerciales.');
assert.ok(main.includes("if (route.page === 'alerts') return 'Prioridades Comerciales';"), 'El título visible debe ser Prioridades Comerciales.');
assert.match(nav, /tenders: 'licitaciones'/, 'La ruta Licitaciones debe quedar vinculada a su capability central.');
assert.match(nav, /\.filter\(item => canAccessRoute\(profile, item\.page\)\)/, 'El catálogo debe filtrar cada enlace por capability antes de renderizarlo.');
assert.doesNotMatch(main, /tenderSubnav|nav-subitems/, 'El sidebar no debe duplicar tabs internas de Licitaciones.');

console.log('navigation domain grouping static checks passed');
