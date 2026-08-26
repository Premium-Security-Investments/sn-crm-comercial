import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  AGT002_DECISION_AXES,
  AGT002_MATERIAL_CATEGORY_TO_AXIS,
  assertAgt002MaterialCategoryAxisCoverage,
} from '../agt002-decision-axis-policy.js';
import {
  AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES,
  AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES,
  resolveAgt002RequirementMaterialPolicy,
} from '../agt002-pre-go-analysis.js';

test('AGT002_DECISION_AXES is exactly the five fixed axes and frozen', () => {
  assert.deepEqual(AGT002_DECISION_AXES, [
    'legal', 'experiencia_financiera', 'imposibilidad_tecnica_grave', 'plazo', 'viabilidad_economica',
  ]);
  assert.ok(Object.isFrozen(AGT002_DECISION_AXES));
});

test('AGT002_MATERIAL_CATEGORY_TO_AXIS covers exactly the 7 material categories and none of the 8 ordinary ones', () => {
  assert.deepEqual(
    Object.keys(AGT002_MATERIAL_CATEGORY_TO_AXIS).sort(),
    [...AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES].sort(),
  );
  for (const key of Object.keys(AGT002_MATERIAL_CATEGORY_TO_AXIS)) {
    assert.equal(AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES.includes(key), false);
  }
  for (const value of Object.values(AGT002_MATERIAL_CATEGORY_TO_AXIS)) {
    assert.equal(AGT002_DECISION_AXES.includes(value), true);
  }
});

test('assertAgt002MaterialCategoryAxisCoverage throws on an uncovered material category', () => {
  assert.throws(
    () => assertAgt002MaterialCategoryAxisCoverage(
      ['inhabilidad_incompatibilidad', 'categoria_nueva'],
      [],
      { inhabilidad_incompatibilidad: 'legal' },
      AGT002_DECISION_AXES,
    ),
    /categoria_nueva/,
  );
});

test('assertAgt002MaterialCategoryAxisCoverage throws when a category is present in both the MATERIAL and ORDINARIO catalogs', () => {
  assert.throws(
    () => assertAgt002MaterialCategoryAxisCoverage(
      ['inhabilidad_incompatibilidad', 'categoria_dual'],
      ['categoria_dual'],
      { inhabilidad_incompatibilidad: 'legal', categoria_dual: 'legal' },
      AGT002_DECISION_AXES,
    ),
    /categoria_dual/,
  );
});

test('assertAgt002MaterialCategoryAxisCoverage throws when the map contains an ordinary category', () => {
  assert.throws(
    () => assertAgt002MaterialCategoryAxisCoverage(
      ['inhabilidad_incompatibilidad'],
      ['garantias_polizas_emitir_modificar'],
      { inhabilidad_incompatibilidad: 'legal', garantias_polizas_emitir_modificar: 'legal' },
      AGT002_DECISION_AXES,
    ),
    /garantias_polizas_emitir_modificar/,
  );
});

test('assertAgt002MaterialCategoryAxisCoverage throws when a value maps to an unknown axis', () => {
  assert.throws(
    () => assertAgt002MaterialCategoryAxisCoverage(
      ['inhabilidad_incompatibilidad'],
      [],
      { inhabilidad_incompatibilidad: 'otro_eje' },
      AGT002_DECISION_AXES,
    ),
    /otro_eje/,
  );
});

test('resolveAgt002RequirementMaterialPolicy resolves the real governed policy', () => {
  assert.deepEqual(
    resolveAgt002RequirementMaterialPolicy('financial-working-capital'),
    { materiality: 'material', category: 'capacidad_financiera_insuficiente' },
  );
  assert.deepEqual(
    resolveAgt002RequirementMaterialPolicy('legal-rce-policy'),
    { materiality: 'ordinary', category: 'garantias_polizas_emitir_modificar' },
  );
});

test('resolveAgt002RequirementMaterialPolicy fails closed for an unclassified requirement_id', () => {
  assert.throws(
    () => resolveAgt002RequirementMaterialPolicy('requisito-sha256-inexistente'),
    /fail-closed/,
  );
});
