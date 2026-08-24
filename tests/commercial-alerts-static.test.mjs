import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const component = fs.readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const marker of [
  "if (route.page === 'alerts') return <VigiaCommercial",
  "if (route.page === 'alerts') return 'Prioridades Comerciales';",
]) assert.ok(main.includes(marker), `main.tsx missing consolidated priorities marker: ${marker}`);

for (const forbidden of ['function CommercialAlerts', '<CommercialAlerts']) {
  assert.ok(!main.includes(forbidden), `main.tsx still contains parallel alert implementation: ${forbidden}`);
}

for (const marker of [
  'Prioridades Comerciales',
  'Impulsado por {VIGIA_VISIBLE_NAMES.commercial}',
  'Filtros de gestión',
  'Pipeline en riesgo',
  'Sin próxima acción',
  'Vencidas',
  'Prioridades con gestión vigente',
  'Sustentación estancada',
  'Tipo de cliente',
  'Cierres próximos',
  'Registrar seguimiento',
  'filtersFromAlertsHash(window.location.hash)',
  'El enlace contiene filtros inválidos o no disponibles para su alcance',
  'Motor de priorización',
  'Fuente de datos',
  'Ver oportunidad',
  'Requiere validación humana; no ejecuta acciones.',
  "filterCommercialPriorities(payload?.priorities || []",
  'summarizeCommercialPriorities(payload.priorities)',
  '.slice(0, PRIORITY_INBOX_LIMIT)',
]) assert.ok(component.includes(marker), `Prioridades Comerciales missing marker: ${marker}`);

for (const forbidden of ['Ver en Dashboard', '>Marcar revisada<', '>Útil<', '>No útil<']) {
  assert.ok(!component.includes(forbidden), `Prioridades Comerciales card must not expose: ${forbidden}`);
}

for (const marker of ['interactionFocusRequested', 'followUpRef', 'id="opportunity-follow-up"']) {
  assert.ok(main.includes(marker), `Opportunity follow-up focus missing marker: ${marker}`);
}

for (const marker of [
  '.priority-filter-panel',
  '.priority-filter-tabs',
  '.priority-filter-tab',
  '.priority-filter-grid',
  '.vigia-priority-card',
]) assert.ok(css.includes(marker), `styles.css missing consolidated priorities marker: ${marker}`);

console.log('Prioridades Comerciales consolidated UI static contract passed');
