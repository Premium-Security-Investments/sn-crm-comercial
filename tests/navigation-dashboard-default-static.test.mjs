import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.ok(main.includes("return { page: 'dashboard' };"), 'default route / should render dashboard gerencial');
assert.ok(!main.includes("['#/','Inicio']"), 'Inicio should be removed from sidebar nav');
assert.ok(main.includes('nav-section-title'), 'Sidebar debe agrupar navegación por dominios con títulos visibles.');

const expectedGroups = ['Gerencia', 'Comercial', 'Licitaciones', 'Administración'];
let lastGroupIndex = -1;
for (const group of expectedGroups) {
  const idx = main.indexOf(`>${group}<`);
  assert.ok(idx > lastGroupIndex, `El grupo ${group} debe existir y aparecer después del anterior.`);
  lastGroupIndex = idx;
}

const expectedOrder = [
  "href=\"#/dashboard2\">Dashboard comercial",
  "href=\"#/alerts\">Alertas comerciales",
  "href=\"#/opportunities\">Oportunidades",
  "href=\"#/goals\">Metas y cumplimiento",
  "href=\"#/users\">Usuarios y permisos",
];
let lastIndex = -1;
for (const marker of expectedOrder) {
  const idx = main.indexOf(marker);
  assert.ok(idx > lastIndex, `${marker} should appear after previous nav marker`);
  lastIndex = idx;
}

assert.ok(!main.includes("['#/new','Crear oportunidad']"), 'Crear oportunidad no debe ser ítem permanente del sidebar; debe quedar como acción contextual.');
for (const marker of ["['#/tenders?view=radar','Radar de oportunidades']", "['#/tenders?view=seguimiento','Seguimiento']", "['#/tenders?view=expedientes','Expedientes']", "['#/tenders?view=perfiles','Perfiles de búsqueda']"]) {
  assert.ok(main.includes(marker), `Licitaciones debe conservar subruta ${marker}`);
}
assert.ok(main.includes('canViewTenders(currentProfile)'), 'Licitaciones tab should be gated by role/person.');

console.log('navigation domain grouping static checks passed');
