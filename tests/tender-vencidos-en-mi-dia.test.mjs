import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Mejora 1, parte C (Juan, 2026-11-05: sólo en la plataforma): en «Mi día» de quien trabaja licitaciones, una línea
// por licitación con algo vencido que puede tumbar la oferta o algo que no se subsana todavía abierto.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const componentPath = '../src/tenders/components/TenderMyDayOverdue.tsx';

test('la tarjeta usa el tablero (misma regla) y sólo sale si hay algo que puede tumbar una oferta', () => {
  assert.ok(existsSync(new URL(componentPath, import.meta.url)), 'falta TenderMyDayOverdue.tsx');
  const component = read(componentPath);
  assert.match(component, /loadTenderOpenBoard\(request\)/);
  assert.match(component, /process\.vencidos\.vencidos_que_tumban > 0 \|\| process\.vencidos\.no_subsanables_abiertos > 0/);
  assert.match(component, /if \(!rows\.length\) return null;/);
});

test('en Mi día la ve sólo quien tiene Licitaciones; los demás comerciales no', () => {
  const main = read('../src/main.tsx');
  assert.match(main, /\{can\(data\.currentProfile, ACTIONS\.LICITACIONES_VIEW\) && <TenderMyDayOverdue request=\{api\} onOpen=\{opportunityId => go\(`#\/detail\/\$\{opportunityId\}`\)\} \/>\}/);
  const myDay = main.slice(main.indexOf('function MyDayHome('));
  assert.ok(myDay.indexOf('<TenderMyDayOverdue') < myDay.indexOf('my-day-lead-analysis'), 'va arriba, después del encabezado');
});
