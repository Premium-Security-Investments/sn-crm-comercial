// AGT-002 "Análisis para decidir" -> traspaso al expediente operativo post-GO — derivación pura.
//
// Puro, sin I/O. No decide GO/NO-GO ni escribe nada: sólo proyecta la superficie de decisión ya
// derivada (deriveAgt002DecisionAnalysis) y la unidad V3 correspondiente de cada hallazgo elegible
// hacia los pendientes humanos que una fase posterior sembrará en psi_tender_dossier_items. Nunca
// clasifica materialidad ni fabrica título/instrucción por texto/heurística: título e instrucción
// prefieren siempre los campos gobernados ya derivados del hallazgo (finding.presentation.title /
// finding.presentation.action_required) y sólo caen a los campos estructurales de la unidad V3
// (title/actions/closure.condition) cuando esos campos del hallazgo faltan o vienen vacíos. Nunca
// se deriva de texto libre del hallazgo (rationale/label/summary). La identidad de origen
// (source_id/source_hash) se calcula siempre con buildActionableReviewIntegralUnitSource, el único
// constructor de esa identidad en el repo — nunca se reimplementa aquí.
//
// Fail-closed: un requirement_id que no une a exactamente una unidad V3 tender_requirement
// elegible (o una unidad malformada, o un item_key resultante > 200 caracteres, o dos hallazgos que
// colisionan en el mismo item_key) lanza y descarta el lote completo — nunca produce una salida
// parcial silenciosa.

import { deriveAgt002DecisionAnalysis } from '../agt002-decision-axis-analysis.js';
import { buildActionableReviewIntegralUnitSource } from '../agt002-actionable-review-canonical.js';

export const AGT002_DOSSIER_HANDOFF_ORIGIN = 'seed_agt002_post_go';
export const AGT002_DOSSIER_HANDOFF_ITEM_TYPE = 'pendiente_humano';
export const AGT002_DOSSIER_HANDOFF_ITEM_KEY_PREFIX = 'agt002_post_go:';
export const AGT002_DOSSIER_HANDOFF_ITEM_KEY_MAX_LENGTH = 200;

const ACTION_PRIORITY_RANK = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3 });

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(message) {
  throw new Error(`AGT-002 traspaso al expediente post-GO: ${message}.`);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (isRecord(value)) {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

// Buckets elegibles de la superficie ya derivada (§9 de deriveAgt002DecisionAnalysis): hallazgos de
// eje material con `blocker`/`decision_question`, y hallazgos de `preparation` con estado
// `preparation`. Excluye siempre `supported`/`not_applicable`: esos no requieren traspaso humano.
function collectCandidateFindings(decisionAnalysis) {
  const axisFindings = Object.values(isRecord(decisionAnalysis.axes) ? decisionAnalysis.axes : {})
    .flatMap(axis => (Array.isArray(axis?.findings) ? axis.findings : []))
    .filter(finding => finding.reviewed_status === 'blocker' || finding.reviewed_status === 'decision_question');

  const preparationFindings = (Array.isArray(decisionAnalysis.preparation) ? decisionAnalysis.preparation : [])
    .filter(finding => finding.reviewed_status === 'preparation');

  return [...axisFindings, ...preparationFindings];
}

// Unión exacta y cerrada: unidad V3 `tender_requirement`, mismo requirement_id, closure.status
// presente y distinto de `evidence_satisfied` (esas ya están resueltas y no generan traspaso).
function eligibleUnitsForRequirement(units, requirementId) {
  return units.filter(unit => (
    isRecord(unit)
    && unit.unit_kind === 'tender_requirement'
    && unit.requirement_id === requirementId
    && isRecord(unit.closure)
    && nonEmptyString(unit.closure.status)
    && unit.closure.status !== 'evidence_satisfied'
  ));
}

function firstActionSummary(unit) {
  const actions = Array.isArray(unit.actions) ? unit.actions : [];
  const prioritized = [...actions].sort((left, right) => (
    (ACTION_PRIORITY_RANK[left?.priority] ?? 4) - (ACTION_PRIORITY_RANK[right?.priority] ?? 4)
  ));
  const found = prioritized.find(action => nonEmptyString(action?.summary));
  return found ? found.summary.trim() : null;
}

// Título: `finding.presentation.title` si es un campo gobernado no vacío; si no, cae a `unit.title`.
// Instrucción: `finding.presentation.action_required` si es un campo gobernado no vacío; si no, cae
// al primer resumen de acción priorizada, luego a `closure.condition`, luego a `null`. Ambos campos
// del hallazgo son gobernados ya derivados (nunca texto libre como rationale/label/summary): nunca
// se infiere nada por heurística de texto en ningún punto de esta función.
function buildPresentation(finding, unit) {
  const findingPresentation = isRecord(finding?.presentation) ? finding.presentation : null;

  const title = findingPresentation && nonEmptyString(findingPresentation.title)
    ? findingPresentation.title.trim()
    : (nonEmptyString(unit.title) ? unit.title.trim() : null);

  const instruction = findingPresentation && nonEmptyString(findingPresentation.action_required)
    ? findingPresentation.action_required.trim()
    : (firstActionSummary(unit)
      || (nonEmptyString(unit.closure?.condition) ? unit.closure.condition.trim() : null));

  return Object.freeze({ title, instruction });
}

function buildHandoffItem(finding, units) {
  const requirementId = finding?.requirement_id;
  if (!nonEmptyString(requirementId)) {
    fail(`hallazgo "${finding?.id ?? 'desconocido'}" sin requirement_id no nulo utilizable para unir`);
  }

  const matches = eligibleUnitsForRequirement(units, requirementId);
  if (matches.length === 0) {
    fail(`sin unidad V3 tender_requirement elegible (closure.status presente, distinto de evidence_satisfied) para requirement_id "${requirementId}"`);
  }
  if (matches.length > 1) {
    fail(`más de una unidad V3 tender_requirement elegible para requirement_id "${requirementId}" (unión ambigua)`);
  }
  const unit = matches[0];

  const itemKey = `${AGT002_DOSSIER_HANDOFF_ITEM_KEY_PREFIX}${requirementId}`;
  if (itemKey.length > AGT002_DOSSIER_HANDOFF_ITEM_KEY_MAX_LENGTH) {
    fail(`item_key resultante excede ${AGT002_DOSSIER_HANDOFF_ITEM_KEY_MAX_LENGTH} caracteres: "${itemKey}"`);
  }

  const source = buildActionableReviewIntegralUnitSource(unit);
  const status = finding.reviewed_status === 'blocker' || unit.blocking?.effect === 'blocker'
    ? 'bloqueado'
    : 'pendiente';

  return {
    item_key: itemKey,
    origin: AGT002_DOSSIER_HANDOFF_ORIGIN,
    required: true,
    item_type: AGT002_DOSSIER_HANDOFF_ITEM_TYPE,
    status,
    presentation: buildPresentation(finding, unit),
    source: {
      source_kind: source.sourceKind,
      source_id: source.sourceId,
      requirement_id: source.requirementId,
      source_hash: source.sourceHash,
    },
  };
}

/**
 * Deriva el lote de pendientes humanos a traspasar al expediente operativo post-GO.
 *
 * Acepta dos formas de entrada:
 * - `{ currentAnalysis, result, questionResponses }`: deriva `decisionAnalysis` internamente vía
 *   `deriveAgt002DecisionAnalysis` y toma `integralAnalysis` de `result.integral_analysis`.
 * - `{ decisionAnalysis, integralAnalysis }`: ambos ya resueltos por un llamador de confianza.
 *
 * Exige `decisionAnalysis.global_state === 'ready_for_human_review'` y
 * `decisionAnalysis.coverage.decision_ready === true`; en cualquier otro caso devuelve
 * `{ ready: false, items: [] }` sin lanzar (estado operativo normal, no un error).
 *
 * Ante una unión inválida (unidad ausente/duplicada/malformada, item_key > 200 caracteres o dos
 * hallazgos que colisionan en el mismo item_key) lanza y descarta el lote completo.
 */
export function deriveAgt002DossierHandoff(input) {
  if (!isRecord(input)) fail('la entrada debe ser un objeto');

  let decisionAnalysis;
  let integralAnalysis;
  if (Object.hasOwn(input, 'decisionAnalysis')) {
    decisionAnalysis = input.decisionAnalysis;
    integralAnalysis = input.integralAnalysis;
  } else {
    decisionAnalysis = deriveAgt002DecisionAnalysis(input.currentAnalysis, input.result, input.questionResponses);
    integralAnalysis = isRecord(input.result) ? input.result.integral_analysis : undefined;
  }

  const coverageReady = isRecord(decisionAnalysis)
    && decisionAnalysis.global_state === 'ready_for_human_review'
    && isRecord(decisionAnalysis.coverage)
    && decisionAnalysis.coverage.decision_ready === true;
  if (!coverageReady) {
    return Object.freeze({ ready: false, items: Object.freeze([]) });
  }

  const units = isRecord(integralAnalysis) && Array.isArray(integralAnalysis.analysis_units)
    ? integralAnalysis.analysis_units
    : [];

  const seenItemKeys = new Set();
  const items = collectCandidateFindings(decisionAnalysis).map((finding) => {
    const item = buildHandoffItem(finding, units);
    if (seenItemKeys.has(item.item_key)) fail(`item_key duplicado entre hallazgos: "${item.item_key}"`);
    seenItemKeys.add(item.item_key);
    return item;
  });

  return deepFreeze({ ready: true, items });
}
