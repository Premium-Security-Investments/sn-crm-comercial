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
  "Estado de gestión",
  "Acciones críticas",
  "Sin próxima acción",
  "Vencidas",
  "Sustentación estancada",
  "Bajo cumplimiento",
  "alertCards",
  "filteredAlerts",
  "isOperationalAlert",
  "alertOpportunityCount(data.opportunities)",
  "alertas operativas visibles",
  "Sin regional/sede",
  "nextActionStatus(o)",
  "daysSince(o.last_interaction_at",
];

for (const marker of mainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing marker: ${marker}`);
}

const cssMarkers = [
  '.alerts-dashboard',
  '.alert-cards',
  '.alert-card',
  '.alert-table',
  '.alerts-dashboard .alert-row td',
  '.alerts-dashboard .alert-filter-summary',
  'min-width:1180px',
  '.alert-danger',
  '.alert-amber',
  '.alert-success',
];

for (const marker of cssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing marker: ${marker}`);
}

console.log('commercial-alerts static checks passed');
