// Conteo canónico de pendientes críticos ABIERTOS de un análisis de licitación, para
// `psi_tender_analysis_runs.critical_open_count`.
//
// Por qué existe este módulo. El conteo se escribía con
// `result.questions.filter(q => q.critical === true)`, que es la definición correcta para el
// contrato integral v3 (agt002-v3-compatibility.js: "the set of units counted toward
// `critical_open_count` must be exactly the set of units the projection marks `critical: true` in
// `questions`"). Pero el esquema `pre_go_analysis.v2` NO tiene `questions`: sus pendientes viven en
// `result.open_items`, cada uno con `critical` y `status`. El filtro corría sobre un arreglo
// inexistente y devolvía 0 siempre.
//
// Medido el 2026-10-25 en Supersalud `SNS-LP-2-2026` (oportunidad 021c37ec-…): las seis corridas
// guardadas tenían `critical_open_count = 0`, mientras su contenido tenía entre 1 y 3 pendientes
// críticos abiertos. La v6 canónica (9abe1fe4-…) tenía DOS críticos abiertos —el pliego electrónico
// definitivo con su cronograma, y la fecha de cierre con dos versiones— y la ficha de la oportunidad
// se leía "sin pendientes". Es un defecto de triage, no de autorización: el portón de GO/NO-GO está
// abierto por diseño (`tenderDecisionGate`).
//
// La regla, en orden, sin tocar la semántica de v3:
//   1. Si hay `questions`, manda `questions` (invariante gobernada de v3, diseño sección 10).
//   2. Si no, cuentan los `open_items` críticos cuyo estado sigue abierto.
//   3. Si no hay ninguno de los dos, 0.
//
// Un pendiente `RESOLVED` no cuenta: el campo mide lo que sigue abierto, no lo que hubo.

/** Estados de `open_items` que NO están abiertos. Lo que no esté aquí se considera abierto (fail-closed). */
const CLOSED_OPEN_ITEM_STATUSES = new Set(['RESOLVED', 'CLOSED', 'CANCELLED', 'WITHDRAWN']);

function isOpenItemOpen(item) {
  const status = String(item?.status || '').trim().toUpperCase();
  if (!status) return true;
  return !CLOSED_OPEN_ITEM_STATUSES.has(status);
}

export function countTenderCriticalOpenUnits(result) {
  if (Array.isArray(result?.questions)) {
    return result.questions.filter(question => question?.critical === true).length;
  }
  if (Array.isArray(result?.open_items)) {
    return result.open_items.filter(item => item?.critical === true && isOpenItemOpen(item)).length;
  }
  return 0;
}
