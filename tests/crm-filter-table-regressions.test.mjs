import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const opportunityStart = main.indexOf('function OpportunityList');
const opportunityEnd = main.indexOf('function findTenderOwner', opportunityStart);
const opportunity = main.slice(opportunityStart, opportunityEnd);
assert.match(opportunity, /const \[period, setPeriod\] = useState<DashboardPeriodFilter>\(hashQueryParam\('period'\)/, 'Oportunidades conserva el periodo desde la URL');
assert.match(opportunity, /matchesDashboardPeriod\(o, period\)/, 'Oportunidades aplica el periodo a filas y métricas');
assert.match(opportunity, /\[q, owner, regional, stage, service, customerSegmentFilter, period, onlyActive, sortConfig\.key, sortConfig\.direction\]/, 'cambiar periodo reinicia la paginación');
assert.match(opportunity, /empty="Período"/, 'Oportunidades renderiza el selector de periodo');
assert.match(opportunity, /setPeriod\(''\)/, 'Limpiar restablece el periodo');

const dashboardStart = main.indexOf('function ManagerDashboardV2');
const dashboardEnd = main.indexOf('function ', dashboardStart + 30);
const dashboard = main.slice(dashboardStart, dashboardEnd === -1 ? main.length : dashboardEnd);
assert.match(dashboard, /const \[customerSegmentFilter, setCustomerSegmentFilter\] = useState<CustomerSegment \| ''>\(''\)/, 'Dashboard V2 declara el filtro de tipo de cliente');
assert.match(dashboard, /!customerSegmentFilter \|\| o\.customer_segment === customerSegmentFilter/, 'Dashboard V2 aplica tipo de cliente a todo el alcance');
assert.match(dashboard, /customerSegmentFilter[^\]]*\]\);/, 'Dashboard V2 invalida memorias cuando cambia tipo de cliente');
assert.match(dashboard, /options=\{customerSegmentOptions\} empty="Clientes"/, 'Dashboard V2 renderiza tipo de cliente');
assert.match(dashboard, /setCustomerSegmentFilter\(''\)/, 'Limpiar restablece tipo de cliente');
assert.match(dashboard, /Boolean\(period \|\| q \|\| owner \|\| regional \|\| stage \|\| customerSegmentFilter \|\| onlyActive\)/, 'el resumen reconoce tipo de cliente como filtro activo');

assert.match(main, /<th>Ventas acumuladas<\/th><th>Presupuesto<\/th><th>Cumplimiento individual<\/th>/, 'la tabla ordena acumulado, presupuesto y cumplimiento');
assert.match(main, /fmtMoney\(row\.accumulated\)[\s\S]{0,180}fmtMoney\(row\.budget\)[\s\S]{0,180}row\.compliance/, 'las celdas siguen el orden de los encabezados');
assert.match(styles, /\.crm-readable-table\.v2-sales-table table\{[^}]*min-width:15\d{2}px/, 'la tabla reserva ancho suficiente con especificidad que sobrevive al breakpoint móvil');
assert.match(styles, /\.v2-sales-table th:nth-child\(10\)[^}]*width:1\d{2}px/, 'Ventas acumuladas tiene ancho explícito');
assert.match(styles, /\.v2-sales-table th:nth-child\(11\)[^}]*width:1\d{2}px/, 'Presupuesto tiene ancho explícito');
assert.match(styles, /\.v2-sales-table th:nth-child\(12\)[^}]*width:1\d{2}px/, 'Cumplimiento tiene ancho explícito');

console.log('CRM filter and table regressions passed');