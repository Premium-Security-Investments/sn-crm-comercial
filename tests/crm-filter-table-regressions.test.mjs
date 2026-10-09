import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const opportunityStart = main.indexOf('function OpportunityList');
const opportunityEnd = main.indexOf('function findTenderOwner', opportunityStart);
const opportunity = main.slice(opportunityStart, opportunityEnd);
assert.match(opportunity, /const \[period, setPeriod\] = useState<DashboardPeriodFilter>\(hashQueryParam\('period'\)/, 'Oportunidades conserva el periodo desde la URL');
assert.match(opportunity, /matchesDashboardPeriod\(o, period\)/, 'Oportunidades aplica el periodo a filas y métricas');
assert.match(opportunity, /\[q, owner, regional, stage, service, customerSegmentFilter, period, onlyActive, sortConfig\.key, sortConfig\.direction, urgencySort\]/, 'cambiar periodo (o el orden por urgencia) reinicia la paginación');
assert.match(opportunity, /empty="Periodo"/, 'Oportunidades renderiza el selector de periodo');
assert.match(opportunity, /setPeriod\(''\)/, 'Limpiar restablece el periodo');
assert.match(styles, /\.filters\.opportunity-filters\.compact-dashboard-filters\{grid-template-columns:minmax\(210px,1\.45fr\) repeat\(5,minmax\(120px,1fr\)\)\}/, 'Oportunidades usa seis columnas explícitas y dos filas con especificidad efectiva');
assert.match(styles, /@media\(max-width:1240px\)\{\.filters\.opportunity-filters\.compact-dashboard-filters\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\}/, 'Oportunidades conserva tres columnas en tablet con la misma especificidad');
assert.match(styles, /@media\(max-width:760px\)\{\.filters\.opportunity-filters\.compact-dashboard-filters,\.opportunity-insight-grid\{grid-template-columns:1fr\}\}/, 'Oportunidades conserva una columna en móvil con la misma especificidad');

// Dashboard comercial de tres preguntas (decisión del dueño, 2026-10-07): sin barra de filtros; las ventas por comercial y
// trimestre viven en un <details> con acumulado, meta y cumplimiento en ese orden.
const dashboardStart = main.indexOf('function ManagerDashboardV2');
const dashboard = main.slice(dashboardStart, main.indexOf('\nfunction MyDayHome(', dashboardStart));
assert.doesNotMatch(dashboard, /v2-filter-strip/, 'el tablero de tres preguntas no tiene barra de filtros');
assert.match(dashboard, /<th>Ventas \{year\}<\/th><th>Meta \{year\}<\/th><th>Cumplimiento<\/th>/, 'la tabla ordena acumulado del año, meta y cumplimiento');
assert.match(dashboard, /fmtMoneyCompact\(row\.accumulated\)[\s\S]{0,180}row\.budget[\s\S]{0,180}row\.compliance/, 'las celdas siguen el orden de los encabezados');

console.log('CRM filter and table regressions passed');