import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Mejora 1, parte C (Juan, 2026-11-05: sólo en la plataforma): en «Mi día» de quien trabaja licitaciones, una línea
// por licitación con algo vencido que puede tumbar la oferta o algo que no se subsana todavía abierto.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
// Desde el 2026-11-15 (Mi día de licitaciones, maqueta aprobada) lo crítico va dentro de la vista de alertas: lo que no se
// subsana, abierto, y lo que causa rechazo con su fecha encima, cada uno con su proceso.
test('lo crítico del expediente sale con la misma regla que Preparar', () => {
  const server = read('../server/index.js');
  assert.match(server, /checklist\.filter\(isOpenDossierItem\)\.map\(item => \(\{ item, consecuencia: dossierItemConsequence\(item\) \}\)\)/);
  assert.match(server, /consecuencia === 'no_subsanable'\n        \|\| \(consecuencia === 'causa_rechazo'/);
});

test('en Mi día la ve sólo quien tiene Licitaciones; los demás comerciales no', () => {
  const main = read('../src/main.tsx');
  assert.match(main, /\{can\(data\.currentProfile, ACTIONS\.LICITACIONES_VIEW\) && <TenderMiDia request=\{api\} onOpen=\{opportunityId => go\(`#\/detail\/\$\{opportunityId\}`\)\} onGo=\{go\} \/>\}/);
  const myDay = main.slice(main.indexOf('function MyDayHome('));
  assert.ok(myDay.indexOf('<TenderMiDia') < myDay.indexOf('my-day-lead-analysis'), 'va arriba, después del encabezado');
});
