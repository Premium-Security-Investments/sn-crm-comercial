import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  AGT002_CONTRACTUAL_REGISTRY_TAXONOMY_VERSION,
  REGISTRO_FASES,
  REGISTRO_FASE_POR_CAPITULO,
  REGISTRO_CATEGORIAS,
  REGISTRO_DIMENSIONES,
  REGISTRO_DIMENSION_ESTADOS,
  REGISTRO_LIMITES_PROBATORIOS,
  assertRegistroFase,
  assertRegistroCategoria,
  faseParaNumeralCapitulo,
  scrubOpenPii,
  findOpenPiiPaths,
  assertNoOpenPii,
} from '../agt002-contractual-registry-taxonomy.js';

test('taxonomy version is stable and vocabularies are frozen', () => {
  assert.equal(AGT002_CONTRACTUAL_REGISTRY_TAXONOMY_VERSION, 'agt002-contractual-registry-taxonomy@1');
  assert.ok(Object.isFrozen(REGISTRO_FASES));
  assert.ok(Object.isFrozen(REGISTRO_CATEGORIAS));
  assert.ok(Object.isFrozen(REGISTRO_DIMENSIONES));
});

test('cumplimiento is always non-evaluable (human gate)', () => {
  assert.deepEqual(REGISTRO_DIMENSION_ESTADOS.cumplimiento, ['no_evaluado']);
});

test('the four required dimensions are tracked separately', () => {
  assert.deepEqual([...REGISTRO_DIMENSIONES], ['presencia', 'vigencia', 'aplicabilidad', 'cumplimiento']);
});

test('fase maps from the leading integer of the numeral (robust to OCR roman labels)', () => {
  assert.equal(faseParaNumeralCapitulo(2), 'habilitante');
  assert.equal(faseParaNumeralCapitulo(3), 'puntuable');
  assert.equal(faseParaNumeralCapitulo(6), 'postadjudicacion');
  assert.equal(REGISTRO_FASE_POR_CAPITULO[1], 'generalidad');
  // Unknown capitulo integers fall back to generalidad, never throw.
  assert.equal(faseParaNumeralCapitulo(99), 'generalidad');
});

test('membership assertions reject values outside the closed vocabulary', () => {
  assert.equal(assertRegistroFase('habilitante'), 'habilitante');
  assert.throws(() => assertRegistroFase('inventada'));
  assert.equal(assertRegistroCategoria('financiero'), 'financiero');
  assert.throws(() => assertRegistroCategoria('inventada'));
});

test('probative limits include the Pereira-as-pattern guardrail', () => {
  const joined = REGISTRO_LIMITES_PROBATORIOS.join(' ');
  assert.match(joined, /Pereira se usa sólo como patrón/);
  assert.match(joined, /no decide cumplimiento/);
  assert.match(joined, /Presentado no equivale a aceptado/);
});

test('scrubOpenPii redacts cedula/NIT/email but preserves thresholds', () => {
  assert.equal(scrubOpenPii('cédula 79.123.456 del representante'), 'cédula «id» del representante');
  assert.equal(scrubOpenPii('NIT 800.165.850-4'), 'NIT «id»');
  assert.equal(scrubOpenPii('correo a@b.com'), 'correo «correo»');
  // Thresholds must survive.
  assert.equal(scrubOpenPii('Capital de trabajo mayor o igual al 50%'), 'Capital de trabajo mayor o igual al 50%');
  assert.equal(scrubOpenPii('sumatoria igual o mayor a 1000 SMMLV'), 'sumatoria igual o mayor a 1000 SMMLV');
  assert.equal(scrubOpenPii('Liquidez mayor o igual a 1.5'), 'Liquidez mayor o igual a 1.5');
});

test('findOpenPiiPaths / assertNoOpenPii detect unredacted PII recursively', () => {
  assert.deepEqual(findOpenPiiPaths({ a: 'ok', b: { c: 'cc 12.345.678' } }), ['b.c']);
  assert.deepEqual(findOpenPiiPaths({ a: 'ok', b: ['x', 'y@z.com'] }), ['b[1]']);
  assert.deepEqual(findOpenPiiPaths({ a: 'ok', b: 'clean 50%' }), []);
  assert.throws(() => assertNoOpenPii({ leak: 'e@mail.com' }));
  assert.doesNotThrow(() => assertNoOpenPii({ ok: 'Capital de trabajo 50%' }));
});
