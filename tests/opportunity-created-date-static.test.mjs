import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

const requiredMainMarkers = [
  'function todayDateInputValue()',
  "new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0,10)",
  'const creationDateValue = existing?.created_at ? String(existing.created_at).slice(0,10) : todayDateInputValue();',
  'Fecha creación oportunidad',
  'value={creationDateValue}',
  'readOnly',
  'disabled',
  'Se asigna automáticamente con la fecha del día en que se crea la oportunidad.',
  // AGT-003 — refinamiento posterior de la ficha comercial: "Más información" dejó de usar el
  // componente genérico `Info` (seis tarjetas grandes) y pasó a `FichaField` en grupos compactos
  // (ver `agt003-first-analysis-refinement-static`); el campo y su valor se conservan igual.
  '<FichaField label="Fecha creación" value={fmtDate(o.created_at)}/>',
];

for (const marker of requiredMainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing created-date marker: ${marker}`);
}

assert.ok(!api.includes('created_at: body.created_at'), 'API must not trust client-provided created_at for opportunity creation/update');
assert.ok(!server.includes('created_at: body.created_at'), 'Server must not trust client-provided created_at for opportunity creation/update');
assert.ok(main.indexOf('Fecha creación oportunidad') < main.indexOf('Valor oferta'), 'Creation date should appear in the main creation form before commercial value fields');

console.log('opportunity created date static checks passed');
