import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const main = readFileSync('src/main.tsx', 'utf8');

const markers = [
  'Buscar cliente, comercial, sede, ciudad, servicio o ID…',
  'Buscar cliente, sede, ciudad, servicio o ID…',
  'Buscar cliente, comercial, sede, ciudad o servicio…',
  'Buscar cliente, sede, ciudad o servicio…',
  'Todas las regionales',
  'Todos los servicios',
  'Pipeline activo',
  'Solo activas',
  'Limpiar filtros',
  'alertRegionalOptions',
  'alertServiceOptions',
  'consultantServiceOptions',
  'setRegional(\'\')',
  'setService(\'\')',
  'alert-filter-summary',
  'consultant-filter-summary',
];

for (const marker of markers) {
  assert.ok(main.includes(marker), `Missing unified filter marker: ${marker}`);
}

assert.ok(main.includes("const [period, setPeriod] = useState<DashboardPeriodFilter>('')"), 'Manager dashboard period filter should show the Periodo placeholder by default');
assert.ok(main.includes("if (!period || period === 'todos') return true;"), 'Empty manager period should still mean all pipeline');
assert.ok(main.includes('manager-dashboard-filters') && main.includes('filter-summary'), 'Manager dashboard should keep unified filter container and summary');
assert.ok(main.includes('const alertServiceOptions = data.services.map'), 'Alert service filter should list the full service catalog, not only services with active alerts');
assert.ok(main.includes('alerts-filters') && main.includes('Solo activas'), 'Alerts filters should keep active-only control');
assert.ok(main.includes('consultant-opportunity-filters') && main.includes('Todas las gestiones'), 'Consultant filters should preserve management-action filter');

console.log('unified filters static checks passed');
