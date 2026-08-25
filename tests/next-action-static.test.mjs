import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const mainMarkers = [
  'function nextActionStatus',
  'Programar próxima gestión',
  '<small>Próxima gestión</small>',
  '<small>Último seguimiento</small>',
  // AGT-003 — refinamiento posterior de la ficha comercial (ver `agt003-first-analysis-refinement-static`):
  // el copy de las tarjetas de prioridad pasó al módulo puro `opportunity-ficha-presentation`, con estados
  // visuales y copy natural en lugar de la concatenación `${action.label} · ${action.detail}` y `día(s)`.
  'priorityNextAction.detail',
  'followUpAgeLabel(o.last_interaction_at)',
  'next_action_at: existing?.next_action_at',
  'consultant-opportunity-filters',
  'filteredOpportunities',
  'Pipeline activo',
  'Gestión pendiente',
  'action-${action.code}',
];

for (const marker of mainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing marker: ${marker}`);
}

const cssMarkers = [
  '.consultant-opportunity-filters',
  '.check-filter',
  '.action-overdue',
  '.action-missing',
  '.action-today',
  '.action-soon',
];

for (const marker of cssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing marker: ${marker}`);
}

assert.ok(main.includes('value={String(form.next_action_at || \'\').slice(0,16)}'), 'OpportunityForm should expose next_action_at as editable datetime');
assert.ok(main.includes('Próxima gestión (opcional)<input type="datetime-local"'), 'Follow-up form should label next action clearly');

console.log('next-action static checks passed');
