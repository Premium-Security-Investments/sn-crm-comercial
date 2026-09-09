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
//
// Traspaso legado post-GO (issue #187): una corrida V3 anterior al bloque `result.evidence_coverage`
// no puede alcanzar cobertura lista jamás, así que su superficie por eje queda `paused` para
// siempre y el traspaso salía vacío incluso después de que una persona registrara el GO. Sólo
// entonces —`humanGoGranted: true` (GO YA PERSISTIDO y vigente, verificado por el llamador
// server-owned del recovery), cobertura ESTRICTAMENTE ausente (la propiedad `evidence_coverage` no
// existe en `result`) y pausa exactamente por cobertura— el lote se deriva de los buckets
// blockers/decision_questions/preparation del review genérico server-owned. Nunca se marca la
// cobertura como lista, nunca se toca la superficie por eje ni la lectura pre-GO, y un
// `evidence_coverage` presente —aunque sea `null`, `{}`, `false`, `0`, un string, o diga que no
// está lista o declare omisiones— mantiene el fail-closed anterior.
//
// Post-GO la clasificación material/eje (`resolveAgt002RequirementMaterialPolicy`) NO participa:
// es una ayuda de decisión PRE-GO sobre requisitos gobernados de la empresa, y los requisitos de un
// pliego real (p. ej. `sreq:*` derivados del manifiesto del expediente) no están —ni deben estar—
// en ese catálogo global. Con el GO ya persistido, los buckets server-owned del review
// (blockers/decision_questions/preparation) son elegibles por sí mismos.

import { deriveAgt002DecisionAnalysis } from '../agt002-decision-axis-analysis.js';
import { deriveAgt002GenericDecisionReview } from '../agt002-generic-decision-review.js';
import { buildActionableReviewIntegralUnitSource } from '../agt002-actionable-review-canonical.js';

export const AGT002_DOSSIER_HANDOFF_ORIGIN = 'seed_agt002_post_go';
export const AGT002_DOSSIER_HANDOFF_ITEM_TYPE = 'pendiente_humano';
export const AGT002_DOSSIER_HANDOFF_ITEM_KEY_PREFIX = 'agt002_post_go:';
export const AGT002_DOSSIER_HANDOFF_ITEM_KEY_MAX_LENGTH = 200;

const ACTION_PRIORITY_RANK = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3 });

// Única pausa de la superficie por eje que un GO ya persistido puede sortear en una corrida legada.
// Cualquier otra (`analysis_not_current`, `no_decision_review`, `material_policy_unclassified`)
// sigue siendo fail-closed: no describe una cobertura que la corrida nunca pudo escribir, sino un
// análisis que no es apto para traspasar.
const LEGACY_POST_GO_BYPASSABLE_PAUSED_REASON = 'coverage_not_decision_ready';

// `diagnostic.stage`/`error.stage` de toda negativa o unión inválida del bypass legado (issue #187):
// permite al llamador distinguir el motivo sin parsear el mensaje de texto libre.
const LEGACY_POST_GO_STAGE = 'legacy_post_go_handoff';

// Única razón autorizada de una omisión material declarada en la forma estricta del bypass legado
// (ver `legacyOmissionDeclarationValid`).
const LEGACY_POST_GO_ALLOWED_OMISSION_REASON = 'lower_relevance';

// Único vocabulario cerrado de `closure.status` de la unidad V3 (contrato §6.4/schema). El bypass
// legado nunca trata un valor fuera de este conjunto como una unidad abierta o cerrada válida.
const CLOSURE_STATUSES = Object.freeze(['open', 'evidence_satisfied', 'human_confirmation_required']);

// Post-GO, la clasificación material/eje (una ayuda de decisión PRE-GO) ya no SELECCIONA: material u
// ordinario, todo hallazgo abierto del review server-owned es un pendiente humano del expediente.
// Sólo se excluyen `supported` y `not_applicable`, que no exigen trabajo de nadie.
const LEGACY_POST_GO_ELIGIBLE_REVIEWED_STATUSES = Object.freeze(['blocker', 'decision_question', 'preparation']);

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

// Cobertura ESTRICTAMENTE ausente: la corrida nunca escribió la propiedad `evidence_coverage`
// (exportada: el llamador server-owned del recovery post-GO decide con esta MISMA regla si una
// decisión GO sin `analysis_run_id` cae en el caso legado del issue #187; nunca se reimplementa)
// (propiedad propia inexistente). Cualquier otro valor —incluido `null`, `{}`, `false`, `0`, un
// string, o un bloque que dice `decision_ready:false`— es PRESENCIA: hay una lectura de cobertura
// (aunque sea nula o inservible) y dice que no está lista, así que nunca habilita el traspaso
// legado.
export function evidenceCoverageStrictlyAbsent(result) {
  if (!isRecord(result)) return false;
  return !Object.prototype.hasOwnProperty.call(result, 'evidence_coverage');
}

// Forma cerrada y estricta de `coverage` que el bypass legado acepta: (a) sin omisiones
// (`material_omissions:false` + `omission_reasons:[]`), o (b) la única omisión material
// autorizada (`material_omissions:true` + `omission_reasons` EXACTAMENTE `['lower_relevance']`).
// Cualquier otra forma (razón ausente/vacía/distinta/adicional/duplicada) es fail-closed: el
// bypass no se relaja para "cualquier omisión declarada", sólo para esa forma cerrada. Toma
// `result` completo (no `coverage` ya extraído): un `integral_analysis`/`coverage` ausente o
// malformado también es una declaración de omisión inválida, no un caso aparte.
function legacyOmissionDeclarationValid(result) {
  const integralAnalysis = isRecord(result) ? result.integral_analysis : undefined;
  const coverage = isRecord(integralAnalysis) ? integralAnalysis.coverage : undefined;
  if (!isRecord(coverage)) return false;
  if (coverage.material_omissions === false) {
    return Array.isArray(coverage.omission_reasons) && coverage.omission_reasons.length === 0;
  }
  if (coverage.material_omissions === true) {
    return Array.isArray(coverage.omission_reasons)
      && coverage.omission_reasons.length === 1
      && coverage.omission_reasons[0] === LEGACY_POST_GO_ALLOWED_OMISSION_REASON;
  }
  return false;
}

// Conjunto normalizado de requirement_id: strings no vacíos tras recorte, sin duplicados. Devuelve
// `null` (inválido) ante cualquier desviación — incluida una lista con duplicados cuyo conjunto
// único resultante coincidiría igual: la desviación en sí ya es fail-closed, no sólo el resultado.
function normalizeRequirementIdSet(rawIds) {
  if (!Array.isArray(rawIds) || !rawIds.every(nonEmptyString)) return null;
  const trimmed = rawIds.map(id => id.trim());
  const unique = new Set(trimmed);
  return unique.size === trimmed.length ? unique : null;
}

function requirementIdSetsEqual(left, right) {
  return left.size === right.size && [...left].every(value => right.has(value));
}

// Unión exacta y cerrada de los tres conjuntos de requirement_id relevantes del bypass legado
// (§ tarea): `coverage.expected_requirement_ids`, `coverage.analyzed_requirement_ids` y los
// `requirement_id` reales de `analysis_units`. El orden entre ellos puede diferir; el contenido no.
// Toma `result` completo: un `integral_analysis`/`coverage`/`analysis_units` ausente o malformado
// también es un conjunto inconsistente, no un caso aparte.
function legacyRequirementIdSetsConsistent(result) {
  const integralAnalysis = isRecord(result) ? result.integral_analysis : undefined;
  const coverage = isRecord(integralAnalysis) ? integralAnalysis.coverage : undefined;
  const units = isRecord(integralAnalysis) ? integralAnalysis.analysis_units : undefined;
  if (!isRecord(coverage) || !Array.isArray(units)) return false;
  const expectedSet = normalizeRequirementIdSet(coverage.expected_requirement_ids);
  const analyzedSet = normalizeRequirementIdSet(coverage.analyzed_requirement_ids);
  const unitsSet = normalizeRequirementIdSet(units.map(unit => (isRecord(unit) ? unit.requirement_id : undefined)));
  return Boolean(expectedSet && analyzedSet && unitsSet)
    && requirementIdSetsEqual(expectedSet, analyzedSet)
    && requirementIdSetsEqual(expectedSet, unitsSet);
}

// Validez estructural server-owned de las unidades V3 candidatas al bypass legado: `unit_id` único
// y no vacío, y `closure.status` presente dentro del vocabulario cerrado. `unit_kind` se enforce
// aparte, en la unión existente (`eligibleUnitsForRequirement`): una unidad de otro `unit_kind` debe
// seguir fallando por unión ausente (lanza), no aquí (rechazo silencioso). Toma `result` completo:
// un `integral_analysis`/`analysis_units` ausente o malformado también es inválido.
function legacyUnitsStructurallyValid(result) {
  const integralAnalysis = isRecord(result) ? result.integral_analysis : undefined;
  const units = isRecord(integralAnalysis) ? integralAnalysis.analysis_units : undefined;
  if (!Array.isArray(units)) return false;
  const seenUnitIds = new Set();
  return units.every((unit) => {
    if (!isRecord(unit) || !nonEmptyString(unit.unit_id) || seenUnitIds.has(unit.unit_id)) return false;
    seenUnitIds.add(unit.unit_id);
    return isRecord(unit.closure) && CLOSURE_STATUSES.includes(unit.closure.status);
  });
}

function legacyRejection(code) {
  return deepFreeze({ ready: false, items: [], diagnostic: { stage: LEGACY_POST_GO_STAGE, code } });
}

// Copia superficial de `result` cuyo `coverage.expected_requirement_ids`/`analyzed_requirement_ids`
// se reordenan al ORDEN real de `units`: el orden entre ellos nunca es información real (ver
// `evaluateLegacyPostGoBypass`), sólo una forma de presentación. Nunca muta `result`/`integralAnalysis`
// /`coverage`.
function withUnitOrderedRequirementIds(result, integralAnalysis, coverage, units) {
  const unitsRequirementIdOrder = units.map(unit => unit.requirement_id);
  return {
    ...result,
    integral_analysis: {
      ...integralAnalysis,
      coverage: {
        ...coverage,
        expected_requirement_ids: unitsRequirementIdOrder,
        analyzed_requirement_ids: unitsRequirementIdOrder,
      },
    },
  };
}

// Sólo para derivar `decisionAnalysis` en la entrada `currentAnalysis`/`result`: `structurallyEligibleIntegralAnalysis`
// (agt002-generic-decision-review.js) exige que `coverage.expected_requirement_ids`/
// `analyzed_requirement_ids` traigan el MISMO ORDEN que `analysis_units`, así que una corrida legada
// cuyo `coverage` sólo difiere en orden de presentación pausaría por `no_decision_review` antes de
// que el bypass legado (más abajo, sobre el `result` original sin normalizar) pudiera aceptarla por
// conjunto. Devuelve una copia normalizada (ver `withUnitOrderedRequirementIds`) SÓLO cuando `result`
// ya trae arreglos `coverage`/`analysis_units` válidos en forma Y el conjunto normalizado de
// requirement_id ya es idéntico entre expected/analyzed/unidades (`legacyRequirementIdSetsConsistent`);
// si no, `null` — la derivación cae al `result` original y el bypass la rechaza fail-closed como antes.
// Nunca decide por sí sola si el bypass aplica: eso lo sigue decidiendo únicamente
// `evaluateLegacyPostGoBypass` sobre el `result` original.
function normalizeLegacyResultForDecisionAnalysis(result) {
  if (!isRecord(result)) return null;
  const integralAnalysis = result.integral_analysis;
  if (!isRecord(integralAnalysis) || !isRecord(integralAnalysis.coverage) || !Array.isArray(integralAnalysis.analysis_units)) {
    return null;
  }
  const { coverage, analysis_units: units } = integralAnalysis;
  if (!legacyRequirementIdSetsConsistent(result)) return null;
  return withUnitOrderedRequirementIds(result, integralAnalysis, coverage, units);
}

// Traduce el mensaje de texto libre de una unión inválida (`fail()`, compartida con la ruta no
// legada) a un `code` snake_case estable, sin cambiar el mensaje que ya cubren los `assert.throws`
// existentes.
function classifyLegacyBuildFailureCode(message) {
  if (message.includes('sin requirement_id')) return 'requirement_id_missing';
  if (message.includes('más de una unidad V3 tender_requirement elegible')) return 'requirement_unit_ambiguous';
  if (message.includes('sin unidad V3 tender_requirement elegible')) return 'requirement_unit_not_eligible';
  if (message.includes('item_key resultante excede')) return 'item_key_too_long';
  if (message.includes('item_key duplicado')) return 'item_key_duplicate';
  return 'legacy_handoff_build_failed';
}

// Candidatos del traspaso legado: los tres buckets accionables del review genérico server-owned,
// re-derivado aquí desde el análisis canónico. Nunca lee `result.decision_review` (JSON no confiable
// del modelo) ni infiere nada por texto. La materialidad no interviene: post-GO no selecciona, y los
// requisitos del pliego (`sreq:*`) viven en el manifiesto del expediente, no en el catálogo global
// de requisitos gobernados de la empresa.
function legacyPostGoCandidateFindings(currentAnalysis, result) {
  const review = deriveAgt002GenericDecisionReview(currentAnalysis, result);
  if (!isRecord(review)) return null;
  return [review.blockers, review.decision_questions, review.preparation]
    .flatMap(bucket => (Array.isArray(bucket) ? bucket : []))
    .filter(finding => isRecord(finding) && LEGACY_POST_GO_ELIGIBLE_REVIEWED_STATUSES.includes(finding.reviewed_status));
}

// Orquesta el bypass legado completo: exige GO ya persistido, cobertura ESTRICTAMENTE ausente,
// forma estricta de omisión, los tres conjuntos de requirement_id (expected/analyzed/unidades)
// idénticos y bien formados, unidades server-owned estructuralmente válidas (unit_id único,
// closure.status del vocabulario cerrado) y sólo entonces pausa exactamente por cobertura — en ese
// orden — antes de derivar el review genérico. Cada gate diagnostica primero la condición malformada
// que realmente describe la entrada; la pausa genérica del análisis derivado se comprueba al final,
// una vez descartadas las formas malformadas más específicas. Toda negativa es un rechazo seguro con
// diagnóstico explícito, nunca un lanzo: el lanzo sólo ocurre después, en la unión hallazgo↔unidad V3
// ya existente y compartida con la ruta no legada. Reordena `expected_requirement_ids`/
// `analyzed_requirement_ids` a como aparecen en las unidades antes de invocar el review genérico: ya
// se probó que representan el mismo conjunto, y la elegibilidad estructural de ese módulo exige el
// mismo ORDEN — el orden nunca es información real aquí, sólo una forma de presentación.
function evaluateLegacyPostGoBypass({ currentAnalysis, result, humanGoGranted, decisionAnalysis }) {
  if (humanGoGranted !== true) return { rejection: legacyRejection('human_go_required') };
  if (!evidenceCoverageStrictlyAbsent(result)) {
    return { rejection: legacyRejection('evidence_coverage_present') };
  }
  if (!legacyOmissionDeclarationValid(result)) {
    return { rejection: legacyRejection('omission_declaration_invalid') };
  }
  if (!legacyRequirementIdSetsConsistent(result)) {
    return { rejection: legacyRejection('requirement_id_set_mismatch') };
  }
  if (!legacyUnitsStructurallyValid(result)) {
    return { rejection: legacyRejection('legacy_units_invalid') };
  }
  if (!isRecord(decisionAnalysis)
    || decisionAnalysis.global_state !== 'paused'
    || decisionAnalysis.paused_reason !== LEGACY_POST_GO_BYPASSABLE_PAUSED_REASON) {
    return { rejection: legacyRejection('paused_reason_not_bypassable') };
  }

  const integralAnalysis = result.integral_analysis;
  const { coverage, analysis_units: units } = integralAnalysis;
  const normalizedResult = withUnitOrderedRequirementIds(result, integralAnalysis, coverage, units);

  const candidates = legacyPostGoCandidateFindings(currentAnalysis, normalizedResult);
  if (!candidates) return { rejection: legacyRejection('generic_review_ineligible') };

  return { candidates, units };
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
 * `humanGoGranted: true` declara que el llamador server-owned ya verificó una decisión GO YA
 * PERSISTIDA y vigente (issue #187). Es la ruta de recovery (`syncTenderDossierFromAgt002`) la única
 * que lo pasa: al REGISTRAR una decisión GO el bypass no aplica, porque ahí el GO todavía no está
 * persistido y un lote legado sólo podría abortar el registro de la decisión. Sólo en la primera
 * forma de entrada, y sólo si además la propiedad `result.evidence_coverage` no existe (ni siquiera
 * como `null`, `{}`, `false`, `0` o string), la pausa es exactamente por cobertura, `coverage` trae
 * la forma estricta de omisión autorizada y los tres conjuntos de requirement_id (expected/analyzed/
 * unidades) y las unidades mismas son server-owned válidas, el lote se deriva del review genérico
 * server-owned en lugar de la superficie por eje. Ese bypass nunca marca la cobertura como lista ni
 * altera la superficie por eje que lee la UI pre-GO: sólo decide de dónde salen los candidatos de
 * ESTE lote. Sin ese hecho, el comportamiento es idéntico al anterior.
 *
 * Toda negativa segura del bypass legado (GO no otorgado, pausa no bypasseable, cobertura presente,
 * forma de omisión inválida, conjuntos de requirement_id inconsistentes o unidades server-owned
 * inválidas) devuelve `{ ready: false, items: [], diagnostic: { stage: 'legacy_post_go_handoff',
 * code } }` sin lanzar. Ante una unión inválida (unidad ausente/duplicada/malformada, item_key > 200
 * caracteres o dos hallazgos que colisionan en el mismo item_key) lanza y descarta el lote completo;
 * en el bypass legado ese error también expone `error.stage`/`error.code`.
 */
export function deriveAgt002DossierHandoff(input) {
  if (!isRecord(input)) fail('la entrada debe ser un objeto');

  let decisionAnalysis;
  let integralAnalysis;
  let legacyBypassAttempted = false;
  if (Object.hasOwn(input, 'decisionAnalysis')) {
    decisionAnalysis = input.decisionAnalysis;
    integralAnalysis = input.integralAnalysis;
  } else {
    const legacyNormalizableForAnalysis = input.humanGoGranted === true
      && evidenceCoverageStrictlyAbsent(input.result);
    const resultForDecisionAnalysis = legacyNormalizableForAnalysis
      ? (normalizeLegacyResultForDecisionAnalysis(input.result) ?? input.result)
      : input.result;
    decisionAnalysis = deriveAgt002DecisionAnalysis(input.currentAnalysis, resultForDecisionAnalysis, input.questionResponses);
    integralAnalysis = isRecord(input.result) ? input.result.integral_analysis : undefined;
    legacyBypassAttempted = input.humanGoGranted === true || evidenceCoverageStrictlyAbsent(input.result);
  }

  const coverageReady = isRecord(decisionAnalysis)
    && decisionAnalysis.global_state === 'ready_for_human_review'
    && isRecord(decisionAnalysis.coverage)
    && decisionAnalysis.coverage.decision_ready === true;

  let candidates;
  let units;
  if (coverageReady) {
    units = isRecord(integralAnalysis) && Array.isArray(integralAnalysis.analysis_units)
      ? integralAnalysis.analysis_units
      : [];
    candidates = collectCandidateFindings(decisionAnalysis);
  } else if (legacyBypassAttempted) {
    const evaluation = evaluateLegacyPostGoBypass({
      currentAnalysis: input.currentAnalysis,
      result: input.result,
      humanGoGranted: input.humanGoGranted,
      decisionAnalysis,
    });
    if (evaluation.rejection) return evaluation.rejection;
    ({ candidates, units } = evaluation);
  } else {
    return Object.freeze({ ready: false, items: Object.freeze([]) });
  }

  const seenItemKeys = new Set();
  let items;
  try {
    items = candidates.map((finding) => {
      const item = buildHandoffItem(finding, units);
      if (seenItemKeys.has(item.item_key)) fail(`item_key duplicado entre hallazgos: "${item.item_key}"`);
      seenItemKeys.add(item.item_key);
      return item;
    });
  } catch (error) {
    if (legacyBypassAttempted && !coverageReady) {
      error.stage = LEGACY_POST_GO_STAGE;
      error.code = classifyLegacyBuildFailureCode(error.message);
    }
    throw error;
  }

  return deepFreeze({ ready: true, items });
}
