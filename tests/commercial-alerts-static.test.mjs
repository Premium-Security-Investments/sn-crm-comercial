import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const mainMarkers = [
  "type Route =",
  "'alerts'",
  "#/alerts",
  "Alertas comerciales",
  "function CommercialAlerts",
  "compact-alert-command",
  "compact-alert-summary",
  "compact-alert-kpis",
  "alert-kpi-card",
  "alert-filter-tab",
  "alertFilterTabs",
  "setStatus(status === tab.status ? '' : tab.status)",
  "Ver riesgo →",
  "Ver sin agenda →",
  "Ver vencidas →",
  "Ver gestión vigente →",
  "Estado de gestión",
  "Sin próxima acción",
  "Vencidas",
  "filteredAlerts",
  "nextActionStatus(o)",
  "daysSince(o.last_interaction_at",
  "status === 'managed' && row.hasManagedAction",
  "status === 'risk' && row.isRiskPipeline",
];

for (const marker of mainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing marker: ${marker}`);
}

const cssMarkers = [
  '.alerts-dashboard',
  '.compact-alert-command',
  '.compact-alert-summary',
  '.compact-alert-kpis',
  '.alert-kpi-card',
  '.alert-filter-tab',
  '.alert-filter-tab.active',
  '.alert-filter-dot',
  '.alert-table',
  '.alert-danger',
  '.alert-amber',
  '.alert-success',
];

for (const marker of cssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing marker: ${marker}`);
}

const forbiddenMainMarkers = [
  'alert-command-meta',
  'const alertCards =',
  'className="alert-cards"',
  'empty="Todas las alertas"',
];

for (const marker of forbiddenMainMarkers) {
  assert.ok(!main.includes(marker), `main.tsx still has duplicate alert filter marker: ${marker}`);
}

const forbiddenCssMarkers = [
  '.alert-command-meta',
  '.alert-cards',
  '.alert-card',
];

for (const marker of forbiddenCssMarkers) {
  assert.ok(!css.includes(marker), `styles.css still has duplicate alert card marker: ${marker}`);
}

console.log('commercial-alerts static checks passed');
