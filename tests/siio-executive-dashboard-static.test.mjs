import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(main, /deriveSiioExecutiveSnapshot/, 'Dashboard must derive a period-aware executive snapshot');
assert.match(main, /Resumen ejecutivo/, 'Dashboard must expose a permanent executive summary');
assert.match(main, /Periodo financiero/, 'Dashboard must label the financial period');
assert.match(main, /Nómina agregada/, 'Dashboard must show aggregate payroll only');
assert.match(main, /Vigencia de fuentes/, 'Dashboard must expose source freshness');
assert.match(main, /Modo Junta/, 'Board report must remain a separate view');
assert.match(main, /Exportar vista de Junta/, 'Board view must provide a non-persistent export action');
assert.match(main, /window\.print\(\)/, 'Board export must use the browser print/export surface');
assert.doesNotMatch(main, /\/api\/siio\/board-reports\/generate-draft/, 'Board view must not write draft reports');
assert.match(main, /Lectura gerencial automática/, 'Dashboard must show deterministic F5 management insights');
assert.match(main, /Evidencia/, 'Each insight must expose evidence');
assert.match(main, /Acción recomendada/, 'Each insight must propose an explicit action');
assert.match(main, /managementInsights/, 'UI must consume derived conclusions instead of duplicating rules');
assert.match(main, /Reglas determinísticas activas/, 'F5 module status must reflect the active rule engine');
assert.match(main, /pendiente de validación/i, 'Unvalidated financial data must be clearly labelled');
assert.match(main, /totalPeople/, 'Payroll must be rendered from aggregate totals');
assert.doesNotMatch(main, /payroll.*cedula|nomina.*cedula/i, 'Dashboard must never render payroll IDs');
assert.match(styles, /\.siio-executive-grid/, 'Executive dashboard layout styles must exist');
assert.match(styles, /\.siio-source-freshness/, 'Source freshness styles must exist');
assert.match(styles, /\.siio-insight-list/, 'F5 management insight styles must exist');

console.log('SIIO executive dashboard static contract OK');
