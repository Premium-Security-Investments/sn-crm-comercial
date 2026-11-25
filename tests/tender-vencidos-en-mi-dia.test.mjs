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
  assert.match(main, /const seesTenders = can\(data\.currentProfile, ACTIONS\.LICITACIONES_VIEW\);/);
  assert.match(main, /const tendersSection = seesTenders && <section id="mi-dia-licitaciones"/);
  assert.match(main, /<TenderMiDia request=\{api\} onOpen=\{opportunityId => go\(`#\/detail\/\$\{opportunityId\}`\)\} onGo=\{go\} onSummary=\{setTenderResumen\} \/>/);
  // Con licitaciones y clientes, va primero la sección que tenga algo hoy; si las dos o ninguna, licitaciones (25-nov).
  assert.match(main, /\{clientsFirst \? <>\{clientsSection\}\{tendersSection\}<\/> : <>\{tendersSection\}\{clientsSection\}<\/>\}/);
});
