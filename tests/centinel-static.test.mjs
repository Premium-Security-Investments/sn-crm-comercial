import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const mainMarkers = [
  "'centinel'",
  "#/centinel",
  "Pregúntale a Centinel",
  "function CentinelAssistant",
  "Construir reporte seguro",
  "centinelQuickActions",
  "interpretCentinelQuery",
  "CentinelResult",
  "oportunidades sin agenda",
  "pipeline por etapa",
  "cumplimiento de metas",
  "Clientes en sustentación",
  "Solo lectura",
];

for (const marker of mainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing marker: ${marker}`);
}

const cssMarkers = [
  '.centinel-dashboard',
  '.centinel-hero',
  '.centinel-orb',
  '.centinel-query-panel',
  '.centinel-textarea',
  '.centinel-chip',
  '.centinel-result-grid',
  '.centinel-result-table',
];

for (const marker of cssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing marker: ${marker}`);
}

console.log('centinel static checks passed');
