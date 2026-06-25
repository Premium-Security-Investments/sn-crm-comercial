import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const main = readFileSync('src/main.tsx', 'utf8');

const markers = [
  'Buscar cliente, sede, ciudad o ID…',
  'empty="Comerciales"',
  'empty="Regiones"',
  'empty="Etapas"',
  'empty="Productos"',
  'empty="Clientes"',
  'empty="Gestiones"',
  'Pipeline activo',
  'compact-dashboard-filters',
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
assert.ok(main.includes('alerts-filters') && main.includes('Pipeline activo'), 'Alerts filters should use the dashboard active-pipeline label');
assert.ok(main.includes('consultant-opportunity-filters') && main.includes('empty="Gestiones"'), 'Consultant filters should preserve management-action filter with compact copy');
for (const marker of ['Todos los comerciales', 'Todos los servicios', 'Todos los tipos de cliente', 'Solo activas', 'Limpiar filtros', 'Buscar cliente, comercial']) {
  assert.ok(!main.includes(marker), `Filter UI still has inconsistent long copy: ${marker}`);
}

console.log('unified filters static checks passed');
