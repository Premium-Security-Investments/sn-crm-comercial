import fs from 'node:fs';
import assert from 'node:assert/strict';

const component = fs.readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

const registrarIndex = component.indexOf('Registrar seguimiento');
const verOportunidadIndex = component.indexOf('Ver oportunidad');
assert.notEqual(registrarIndex, -1, 'falta la acción Registrar seguimiento en la tarjeta de prioridad');
assert.notEqual(verOportunidadIndex, -1, 'falta la acción secundaria Ver oportunidad en la tarjeta de prioridad');
assert.ok(registrarIndex < verOportunidadIndex, 'Registrar seguimiento debe preceder a Ver oportunidad como acción principal de la tarjeta');

assert.match(
  component,
  /<a className="button" href=\{`#\/detail\/\$\{priority\.id\}\?focus=interaction`\}>Registrar seguimiento<\/a>/,
  'Registrar seguimiento debe ser la acción principal de la tarjeta (className="button")'
);
assert.match(
  component,
  /<a className="button secondary" href=\{`#\/detail\/\$\{priority\.id\}`\}>Ver oportunidad<\/a>/,
  'Ver oportunidad debe seguir siendo la acción secundaria de la tarjeta (button secondary)'
);

assert.ok(!component.includes('Ver en Dashboard'), 'la tarjeta de prioridad ya no debe ofrecer Ver en Dashboard');

for (const label of ['>Marcar revisada<', '>Útil<', '>No útil<']) {
  assert.ok(!component.includes(label), `la tarjeta de prioridad ya no debe ofrecer el control local: ${label}`);
}

assert.ok(!component.includes('aria-label="Feedback local"'), 'debe eliminarse el aria-label Feedback local');
assert.ok(!component.includes('Feedback local de sesión'), 'debe eliminarse el pie Feedback local de sesión');
for (const marker of ['setFeedback', 'reviewedIds', "useState<Record<string, Feedback>>", 'type Feedback =']) {
  assert.ok(!component.includes(marker), `debe eliminarse la lógica local de feedback: ${marker}`);
}

for (const marker of ['dashboardLink', 'canOpenDashboard']) {
  assert.ok(!component.includes(marker), `debe eliminarse del componente: ${marker}`);
}

assert.ok(
  !main.includes('canOpenDashboard'),
  'main.tsx ya no debe pasar el prop muerto canOpenDashboard al invocar VigiaCommercial'
);

console.log('AGT-003 priority card actions static contract passed');
