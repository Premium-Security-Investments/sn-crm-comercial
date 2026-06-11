import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const main = readFileSync('src/main.tsx', 'utf8');

const markers = [
  'Buscar cliente, comercial, sede, ciudad, servicio o ID…',
  'Buscar cliente, sede, ciudad, servicio o ID…',
  'Buscar cliente, comercial, sede, ciudad o servicio…',
  'Buscar cliente, sede, ciudad o servicio…',
  'FilterField label="Regional"',
  'FilterField label="Servicio"',
  'empty="Todas"',
  'empty="Todos"',
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

assert.ok(main.includes("const [period, setPeriod] = useState<DashboardPeriodFilter>('')"), 'Manager dashboard period filter should show Todos under the external Periodo label by default');
assert.ok(main.includes("if (!period || period === 'todos') return true;"), 'Empty manager period should still mean all pipeline');
assert.ok(main.includes('manager-dashboard-filters') && main.includes('filter-summary'), 'Manager dashboard should keep unified filter container and summary');
assert.ok(main.includes('<FilterField label="Período"><Select ariaLabel="Período"'), 'Manager dashboard filters should use external labels with short selected values');
assert.ok(!main.includes('empty="Todos los comerciales"'), 'Select values should not repeat filter names like Todos los comerciales');
assert.ok(!main.includes('empty="Todas las regionales"'), 'Select values should not repeat filter names like Todas las regionales');
assert.ok(main.includes('const alertServiceOptions = data.services.map'), 'Alert service filter should list the full service catalog, not only services with active alerts');
assert.ok(main.includes('alerts-filters') && main.includes('Solo activas'), 'Alerts filters should keep active-only control');
assert.ok(main.includes('consultant-opportunity-filters') && main.includes('FilterField label="Gestión"'), 'Consultant filters should preserve management-action filter with an external label');

console.log('unified filters static checks passed');
