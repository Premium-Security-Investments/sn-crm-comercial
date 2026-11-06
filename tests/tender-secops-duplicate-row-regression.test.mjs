import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = new URL('../server/tender-official-rows.js', import.meta.url);
assert.ok(existsSync(modulePath), 'RED: falta el módulo compartido de colapso de filas oficiales de SECOP.');
const helper = await import(`${pathToFileURL(modulePath.pathname)}?secop-duplicate-row-regression=${Date.now()}`);

const rowA = { numero_de_proceso: 'CO-1', estado_del_proceso: 'Publicado', detalle: { entidad: 'Alcaldía', items: [1, 2] } };
const rowAReordered = { detalle: { items: [1, 2], entidad: 'Alcaldía' }, estado_del_proceso: 'Publicado', numero_de_proceso: 'CO-1' };
const rowBConflicting = { numero_de_proceso: 'CO-1', estado_del_proceso: 'Cancelado', detalle: { entidad: 'Alcaldía', items: [1, 2] } };

assert.equal(
  helper.canonicalizeTenderRowJson(rowA),
  helper.canonicalizeTenderRowJson(rowAReordered),
  'La canonicalización recursiva debe ignorar el orden de las llaves en todos los niveles.',
);
assert.notEqual(
  helper.canonicalizeTenderRowJson(rowA),
  helper.canonicalizeTenderRowJson(rowBConflicting),
  'Filas con contenido distinto no deben canonicalizarse igual.',
);

const exactDuplicates = helper.collapseDuplicateTenderRows([rowA, rowAReordered]);
assert.equal(exactDuplicates.rows.length, 1, 'SECOP II con dos copias idénticas de la misma fila debe colapsar a una sola.');
assert.equal(exactDuplicates.duplicatesCollapsed, 1);

const conflicting = helper.collapseDuplicateTenderRows([rowA, rowBConflicting]);
assert.equal(conflicting.rows.length, 2, 'Filas en conflicto para el mismo proceso deben seguir siendo ambiguas.');
assert.equal(conflicting.duplicatesCollapsed, 0);

const single = helper.collapseDuplicateTenderRows([rowA]);
assert.equal(single.rows.length, 1);
assert.equal(single.duplicatesCollapsed, 0);

for (const relative of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  assert.match(source, /from '\.\.\/server\/tender-official-rows\.js'/, `${relative} debe importar el colapso compartido de filas de SECOP.`);
  assert.match(source, /collapseDuplicateTenderRows\(rows\)/, `${relative} debe colapsar duplicados exactos antes de exigir una sola fila vigente.`);
  assert.match(source, /tender_conversion_secop_duplicate_rows_collapsed/, `${relative} debe registrar el diagnóstico cuando colapsa duplicados.`);
  assert.match(source, /if \(collapsedRows\.length !== 1\)/, `${relative} debe seguir exigiendo ambigüedad real tras colapsar duplicados exactos.`);
}

console.log('SECOP duplicate row collapse regression passed');
