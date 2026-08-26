// Política server-owned de ejes de decisión AGT-002 (puro, sin I/O).
//
// Mapea las 7 categorías de impedimento MATERIAL ya cerradas en agt002-pre-go-analysis.js a los
// 5 ejes fijos de la superficie "Análisis para decidir". No inventa un catálogo nuevo: reutiliza
// AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES / AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES y
// valida en la CARGA del módulo que la cobertura es exacta (ni falta una categoría material ni
// sobra una ordinaria ni un valor apunta a un eje inexistente). Un desalineamiento futuro rompe la
// carga del módulo, nunca el runtime de una decisión real (fail-closed).

import {
  AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES,
  AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES,
} from './agt002-pre-go-analysis.js';

export const AGT002_DECISION_AXES = Object.freeze([
  'legal',
  'experiencia_financiera',
  'imposibilidad_tecnica_grave',
  'plazo',
  'viabilidad_economica',
]);

// 7 categorías materiales -> 5 ejes fijos. Reutiliza el catálogo cerrado existente; no inventa uno
// nuevo.
export const AGT002_MATERIAL_CATEGORY_TO_AXIS = Object.freeze({
  inhabilidad_incompatibilidad: 'legal',
  licencia_habilitante_esencial_imposible: 'legal',
  experiencia_minima_insuficiente: 'experiencia_financiera',
  capacidad_financiera_insuficiente: 'experiencia_financiera',
  imposibilidad_tecnica_grave: 'imposibilidad_tecnica_grave',
  plazo_objetivamente_imposible: 'plazo',
  inviabilidad_economica_critica: 'viabilidad_economica',
});

/**
 * Valida que `map` cubra exactamente `materialCategories` (ni de más ni de menos), que ninguna
 * clave de `map` pertenezca a `ordinaryCategories`, y que todo valor de `map` pertenezca a `axes`.
 * Lanza con un mensaje explícito ante cualquier desalineamiento; nunca corrige en silencio.
 */
export function assertAgt002MaterialCategoryAxisCoverage(materialCategories, ordinaryCategories, map, axes) {
  const materialSet = new Set(materialCategories);
  const ordinarySet = new Set(ordinaryCategories);
  const axisSet = new Set(axes);
  const mapKeys = Object.keys(map);
  const mapKeySet = new Set(mapKeys);

  const catalogOverlap = materialCategories.filter(category => ordinarySet.has(category));
  if (catalogOverlap.length > 0) {
    throw new Error(
      `AGT-002 decision-axis-policy: categoría(s) presentes a la vez en los catálogos MATERIAL y ORDINARIO: ${catalogOverlap.join(', ')}.`,
    );
  }

  const missing = materialCategories.filter(category => !mapKeySet.has(category));
  if (missing.length > 0) {
    throw new Error(
      `AGT-002 decision-axis-policy: faltan categorías materiales sin eje asignado: ${missing.join(', ')}.`,
    );
  }

  const extra = mapKeys.filter(key => !materialSet.has(key));
  if (extra.length > 0) {
    const ordinaryOffenders = extra.filter(key => ordinarySet.has(key));
    if (ordinaryOffenders.length > 0) {
      throw new Error(
        `AGT-002 decision-axis-policy: el mapa de ejes incluye categoría(s) ORDINARIA(s), que nunca generan eje: ${ordinaryOffenders.join(', ')}.`,
      );
    }
    throw new Error(
      `AGT-002 decision-axis-policy: el mapa de ejes incluye categoría(s) fuera del catálogo material cerrado: ${extra.join(', ')}.`,
    );
  }

  const unknownAxisEntries = Object.entries(map).filter(([, axis]) => !axisSet.has(axis));
  if (unknownAxisEntries.length > 0) {
    const badAxes = unknownAxisEntries.map(([, axis]) => axis).join(', ');
    throw new Error(
      `AGT-002 decision-axis-policy: el mapa de ejes apunta a eje(s) desconocido(s): ${badAxes}.`,
    );
  }
}

// Validación en carga: un desalineamiento futuro (categoría añadida sin eje, o mapa apuntando a un
// eje inexistente) rompe la carga del módulo, nunca el runtime de una decisión real.
assertAgt002MaterialCategoryAxisCoverage(
  AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES,
  AGT002_PRE_GO_ORDINARY_PREPARATION_CATEGORIES,
  AGT002_MATERIAL_CATEGORY_TO_AXIS,
  AGT002_DECISION_AXES,
);
