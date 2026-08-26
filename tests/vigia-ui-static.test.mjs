import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const parser = fs.readFileSync(new URL('../src/vigia/dashboard-link-filters.js', import.meta.url), 'utf8');
const component = fs.readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8');
const copilotComponent = fs.readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
const ui = `${main}\n${component}\n${copilotComponent}`;
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const markers = [
  'function VigiaCommercial({ canOpenOpportunity }',
  "api<VigiaPayload>('/api/vigia/priorities')",
  'Prioridades Comerciales',
  'Prioridades explicables del CRM',
  'CRM-F1',
  'Requiere validación humana; no ejecuta acciones.',
  'Ver oportunidad',
  'Registrar seguimiento',
  'vigia-priority-card',
  'vigia-score',
  'vigia-source-status',
  "if (route.page === 'alerts') return <VigiaCommercial",
  "canOpenOpportunity={isModulePermissionEligible(data.currentProfile.role, 'modulo_oportunidades')",
  'canOpenOpportunity && <div className="vigia-card-actions">',
];
for (const marker of markers) assert.ok(ui.includes(marker), `Vig-IA UI missing marker: ${marker}`);
for (const forbidden of ['Ver en Dashboard', '>Marcar revisada<', '>Útil<', '>No útil<']) {
  assert.ok(!component.includes(forbidden), `Prioridades Comerciales card must not expose: ${forbidden}`);
}
assert.match(component, /VIGIA_VISIBLE_NAMES\.commercial/);
assert.match(component, /Impulsado por \{VIGIA_VISIBLE_NAMES\.commercial\}/);
assert.doesNotMatch(component, /Vig-IA(?! Comercial)/);
assert.match(copilotComponent, /VIGIA_VISIBLE_NAMES\.commercial/);
const copilotWithoutApprovedEmptyCopy = copilotComponent.replace(
  'Vig-IA no encontró acciones adicionales fuera de las alertas comerciales.',
  '',
);
assert.doesNotMatch(copilotWithoutApprovedEmptyCopy, /Vig-IA(?! Comercial)/);
assert.ok(!component.includes('AGT-003'), 'Vig-IA UI must not expose the internal AGT-003 identifier');
assert.ok(main.includes('parseVigiaDashboardFilters(window.location.hash'), 'dashboard consumes validated Vig-IA hash filters');
assert.ok(parser.includes("params.get('owner')") && parser.includes("params.get('stage')") && parser.includes("params.get('service')"), 'dashboard deep-link parser applies governed filters');
assert.ok(parser.includes('VIGIA_DASHBOARD_FILTER_KEYS') && parser.includes("__invalid_vigia_filter__"), 'dashboard deep-link rejects unknown or malformed filters to empty scope');
assert.ok(main.includes('Enlace de ${VIGIA_VISIBLE_NAMES.commercial} inválido o manipulado'), 'dashboard explains fail-closed deep-link state');
for (const marker of ['.vigia-commercial', '.vigia-priority-grid', '.vigia-priority-card', '.vigia-signal-list', '.vigia-feedback']) assert.ok(css.includes(marker), `styles.css missing ${marker}`);
console.log('vigia commercial UI static contract passed');
