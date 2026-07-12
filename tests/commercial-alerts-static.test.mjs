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
  "alerts-filter-panel",
  "filters alerts-filters v2-dashboard-filters",
  "empty=\"Comerciales\"",
  "empty=\"Regiones\"",
  "empty=\"Etapas\"",
  "empty=\"Productos\"",
  "empty=\"Clientes\"",
  "Pipeline activo",
  ">Limpiar<",
  "const ALERT_INBOX_LIMIT = 20",
  "const [reviewedAlertIds, setReviewedAlertIds]",
  "const actionInboxRows = sortedFilteredAlerts.filter(row => !reviewedAlertIds.has(row.opportunity.id)).slice(0, ALERT_INBOX_LIMIT)",
  "Panel title=\"Bandeja de acción\"",
  "Mostrando las 20 alertas más críticas",
  "alert-action-inbox",
  "alert-action-card",
  "Ver oportunidad",
  "Registrar seguimiento",
  "Marcar revisada",
  "setReviewedAlertIds",
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
  '.alert-action-inbox',
  '.alert-action-card',
  '.alert-action-card.alert-row-overdue',
  '.alert-action-card.alert-row-missing',
  '.alert-action-card .alert-action-footer',
  '.alert-action-card .alert-action-buttons',
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
  'crm-readable-table alert-readable-table',
  'className="money-cell numeric-value"',
  'className="date-cell"',
  'className="days-cell numeric-value"',
  'className="action-suggestion-cell"',
  '<Panel title="Bandeja de alertas">',
];

const alertComponentStart = main.indexOf('function CommercialAlerts');
const alertComponentEnd = main.indexOf('type CentinelOwnerSummaryRow', alertComponentStart);
const alertComponent = main.slice(alertComponentStart, alertComponentEnd);

for (const marker of forbiddenMainMarkers) {
  assert.ok(!alertComponent.includes(marker), `CommercialAlerts still has table/log alert marker: ${marker}`);
}

const forbiddenCssMarkers = [
  '.alert-command-meta',
  '.alert-cards',
  '.alert-card{',
  '.alert-readable-table table',
];

for (const marker of forbiddenCssMarkers) {
  assert.ok(!css.includes(marker), `styles.css still has duplicate alert/table marker: ${marker}`);
}

const alertFilterStart = main.indexOf('<Panel title="Filtros de gestión" className="alerts-filter-panel">');
const alertFilterEnd = main.indexOf('</Panel>', alertFilterStart);
const alertFilterMarkup = main.slice(alertFilterStart, alertFilterEnd);
assert.ok(alertFilterStart >= 0 && alertFilterMarkup.includes('filters alerts-filters v2-dashboard-filters'), 'Alert filters should reuse the compact dashboard filter layout');
for (const marker of ['empty="Comerciales"', 'empty="Regiones"', 'empty="Etapas"', 'empty="Productos"', 'empty="Clientes"', 'Pipeline activo', '>Limpiar<']) {
  assert.ok(alertFilterMarkup.includes(marker), `Alert filter markup missing compact dashboard-style marker: ${marker}`);
}
for (const marker of ['empty="Todos los comerciales"', 'empty="Todas las regionales"', 'empty="Todas las etapas"', 'empty="Todos los servicios"', 'empty="Todos los tipos de cliente"', 'Solo activas', '>Limpiar filtros<']) {
  assert.ok(!alertFilterMarkup.includes(marker), `Alert filter markup still has inconsistent copy: ${marker}`);
}

console.log('commercial-alerts action inbox static checks passed');
