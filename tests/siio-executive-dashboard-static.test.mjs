import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../src/siio/SiioDashboard.tsx', import.meta.url), 'utf8');
const executive = readFileSync(new URL('../src/siio/SiioExecutiveView.tsx', import.meta.url), 'utf8');
const tracking = readFileSync(new URL('../src/siio/SiioManagementTrackingView.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(executive, /deriveSiioExecutiveSnapshot/, 'Dashboard must derive a period-aware executive snapshot');
assert.match(executive, /Resumen ejecutivo/, 'Dashboard must expose a permanent executive summary');
assert.match(executive, /Periodo financiero/, 'Dashboard must label the financial period');
assert.match(executive, /Nómina agregada/, 'Dashboard must show aggregate payroll only');
assert.match(executive, /Vigencia de fuentes/, 'Dashboard must expose source freshness');
assert.match(executive, /Recomendaciones principales/, 'Dashboard must show derived management recommendations');
assert.match(executive, /navigateSiioView\('seguimiento'/, 'Actionable executive controls must drill into tracking');
assert.match(executive, /navigateSiioView\('inteligencia'/, 'Source controls must drill into intelligence');
assert.match(tracking, /deriveTrackingItems/, 'Tracking must derive deduplicated records and decisions');
assert.match(tracking, /filterTrackingItems/, 'Tracking must apply contextual route filters');
assert.match(tracking, /Todos.*Decisiones.*Bloqueos.*Riesgos.*Compromisos/s, 'Tracking must expose its five internal kinds');
assert.match(dashboard, /SiioExecutiveView/, 'SIIO dashboard must compose the extracted executive view');
assert.match(dashboard, /SiioManagementTrackingView/, 'SIIO dashboard must compose the extracted tracking view');
assert.doesNotMatch(executive, /payroll.*cedula|nomina.*cedula/i, 'Dashboard must never render payroll IDs');
assert.doesNotMatch(executive, /salary|salario individual/i, 'Dashboard must never render individual salaries');
assert.match(styles, /\.siio-executive-grid/, 'Executive dashboard layout styles must exist');
assert.match(styles, /\.siio-source-freshness/, 'Source freshness styles must exist');
assert.match(styles, /\.siio-insight-list/, 'F5 management insight styles must exist');

console.log('SIIO executive dashboard static contract OK');
