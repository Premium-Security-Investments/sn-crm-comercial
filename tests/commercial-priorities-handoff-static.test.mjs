import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const priorities = fs.readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// Decisión del dueño (2026-10-07): el Dashboard comercial ya no enlaza a Prioridades Comerciales (#/alerts); su motor
// alimenta la pregunta 3 del tablero y el orden "por urgencia" de Oportunidades. La pantalla sigue abierta por enlace
// directo y conserva el contexto que reciba.
const dashboard = main.slice(main.indexOf('function ManagerDashboardV2('), main.indexOf('\nfunction MyDayHome('));
assert.doesNotMatch(dashboard, /prioritiesHashFromDashboard|href="#\/alerts/, 'el Dashboard comercial no enlaza a Prioridades Comerciales');
assert.match(main, /api<CommercialPrioritiesPayload>\('\/api\/vigia\/priorities'\)/, 'el motor de prioridades alimenta el tablero y Oportunidades');

for (const marker of [
  'Contexto recibido del Dashboard',
  'priorityContextSummary',
  'priority-context-summary',
  'setLinkedContext(false)',
  '>Limpiar contexto<',
]) {
  assert.ok(priorities.includes(marker), `Prioridades debe exponer el contexto recibido: ${marker}`);
}

const handoffFragments = [
  ...priorities.matchAll(/priority-context-summary[^\n]*/g),
].map(match => match[0]).join('\n');
assert.doesNotMatch(handoffFragments, /api\(|fetch\(|POST|PUT|PATCH|DELETE/, 'seguir o limpiar el handoff no debe ejecutar escrituras');
assert.match(styles, /@media\(max-width:640px\)\{[^}]*\.priority-context-summary\{[^}]*flex-direction:column[^}]*\}[^}]*\.priority-context-summary \.secondary-button\{[^}]*width:100%/s, 'el resumen contextual debe apilarse y mantener el botón táctil en móvil');

console.log('Prioridades contextual handoff static contract passed');
