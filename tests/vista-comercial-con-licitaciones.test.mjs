import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Juan, 2026-11-15: «quiero ver Mi día como lo ve Katherine». La Vista Comercial conserva Licitaciones si la persona la
// tiene, y carga las licitaciones (a nombre de quien licita); lo comercial sigue siendo sólo lo suyo.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('la Vista Comercial conserva los permisos de Licitaciones que la persona tiene', () => {
  const nav = read('../src/navPermissions.ts');
  assert.match(nav, /COMMERCIAL_VIEW_TENDER_PERMISSIONS = \['licitaciones', 'licitaciones_custodia', 'licitaciones_lecciones', 'licitaciones_empresa'\]/);
  assert.match(nav, /COMMERCIAL_VIEW_PERMISSIONS = \['modulo_oportunidades', 'vigia_copilot_pilot', \.\.\.COMMERCIAL_VIEW_TENDER_PERMISSIONS\]/);
  assert.match(nav, /COMMERCIAL_VIEW_PERMISSIONS\.filter\(code => owned\.has\(code\)\)/, 'sólo lo que ya tiene: no concede nada');
});

test('carga las licitaciones, pero los cierres próximos y lo comercial siguen siendo sólo suyos', () => {
  const main = read('../src/main.tsx');
  assert.match(main, /o\.owner_id === selfId \|\| \(tenders && o\.service_type_code === 'licitacion_publica'\)/);
  assert.match(main, /topClosing: data\.topClosing\.filter\(o => o\.owner_id === selfId\)/);
  assert.match(main, /data\.opportunities\.filter\(o => ownerKey\(o\) === selfId\)/, 'Mi día comercial: sólo las suyas');
});
