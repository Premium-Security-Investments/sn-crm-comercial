import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const requiredMainMarkers = [
  'GoalVsActualDashboard',
  'Avance contra meta comercial',
  'goalVsActualRows',
  'Tendencia comercial disponible',
  'trendAvailabilityNote',
  'CommercialPersonalDashboard',
  'Mi tablero comercial',
  'Mi prioridad de hoy',
  'Mis oportunidades críticas',
  'Mi avance contra meta',
  'Metas y cumplimiento',
  'data.currentProfile.role === \'comercial\'',
];

for (const marker of requiredMainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing marker: ${marker}`);
}

const requiredCssMarkers = [
  '.goal-vs-actual-grid',
  '.goal-progress-card',
  '.business-unit-rules',
  '.personal-dashboard',
  '.personal-priority-grid',
  '.trend-availability-note',
];

for (const marker of requiredCssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing marker: ${marker}`);
}

assert.ok(!main.includes('Score comercial configurable'), 'Score comercial configurable should remain paused and absent from UI copy');
assert.ok(main.includes("return <CommercialPersonalDashboard data={data} />;"), 'Commercial users should land on their personal dashboard by default');

console.log('dashboard final P0 static checks passed');
