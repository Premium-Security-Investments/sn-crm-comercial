import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const mainMarkers = [
  'function detailRoute',
  'function editRoute',
  'function safeReturnRoute',
  'function returnRouteLabel',
  "return 'Centro de monitoreo'",
  "return 'Bandeja de alertas'",
  '← Volver a {returnLabel}',
  'Editar caso',
  "go(detailRoute(o.id))",
  "go(detailRoute(saved.id, safeReturnRoute('#/opportunities')))",
  "href={detailRoute(o.id, '#/dashboard')}",
  "href={detailRoute(o.id, '#/dashboard2')}",
];

for (const marker of mainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing monitoring navigation marker: ${marker}`);
}

assert.ok(css.includes('.hero-actions'), 'detail hero should expose explicit action group styling');
assert.ok(css.includes('.hero-actions .secondary'), 'return button should be legible on hero background');

console.log('monitoring return navigation static checks passed');
