// AGT-002 "Análisis para decidir" — derivación pura de la superficie única de decisión por eje.
//
// Puro, sin I/O. Nunca fabrica su propio decision_review: o lo deriva llamando a
// deriveAgt002GenericDecisionReview(currentAnalysis, result), o recibe uno ya resuelto por un
// llamador de confianza (tender-analysis-foundation.js, que ya descartó cualquier valor forjado
// por el modelo antes de construir ese override — ver presentCurrentTenderAnalysis). Nunca
// clasifica materialidad por texto/heurística: siempre vía resolveAgt002RequirementMaterialPolicy
// (catálogo cerrado). Fail-closed: ante cobertura no lista o requisito no clasificable, el estado
// global cae a `paused` y los 5 ejes quedan en `No evaluado`, nunca en un estado más favorable.
//
// docs/superpowers/specs/2026-08-25-agt002-analisis-para-decidir.md §7-§9, §12.

import { deriveAgt002GenericDecisionReview } from './agt002-generic-decision-review.js';
import { AGT002_DECISION_AXES, AGT002_MATERIAL_CATEGORY_TO_AXIS } from './agt002-decision-axis-policy.js';
import { resolveAgt002RequirementMaterialPolicy } from './agt002-pre-go-analysis.js';

export const AGT002_DECISION_ANALYSIS_CONTRACT_VERSION = 'agt002-decision-axis-analysis@1';

// Exactamente las cuatro etiquetas de §9 de la spec; ninguna otra cadena de estado por eje existe.
export const AGT002_DECISION_AXIS_STATES = Object.freeze({
  NOT_EVALUATED: 'No evaluado',
  MATERIAL_BLOCKER: 'Impedimento material',
  PENDING_CONFIRMATION: 'Por confirmar',
  FAVORABLE_WITH_EVIDENCE: 'Favorable con evidencia',
});

const SEMANTIC_MANIFEST_VERSION = 'tender_semantic_manifest.v1';
const REQUIREMENT_INVENTORY_VERSION = 'tender_requirement_inventory.v1';
const CURATED_DECISION_REVIEW_ARTIFACT_TYPE = 'agt002_manizales_exercise_decision_review';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFrozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFrozenCopy));
  if (isRecord(value)) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, deepFrozenCopy(nested)]),
    ));
  }
  return value;
}

function isCoverageBlock(value) {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.total_source_units) && Number.isInteger(value.dispositioned_source_units);
}

function isCompleteSemanticCoverage(value) {
  if (!isRecord(value) || !isCoverageBlock(value)) return false;
  return value.status === 'complete' && Number.isInteger(value.requirement_count);
}

// Forma gobernada del inventario del expediente: versión vigente y bloques de cobertura
// numéricos. Verifica sólo la FORMA, nunca la disposición (decision_ready).
function isGovernedInventoryShape(value) {
  if (!isRecord(value)) return false;
  if (value.inventory_version !== REQUIREMENT_INVENTORY_VERSION) return false;
  return isCoverageBlock(value.expedient_coverage) && isCoverageBlock(value.analyzed_coverage);
}

function isInventoryDecisionReady(inventory) {
  return isGovernedInventoryShape(inventory) && inventory.decision_ready === true;
}

// Réplica exacta, en JS puro, de tenderAnalysisCoverageReady
// (src/tenders/tenderIntegralAnalysisPresentation.ts): el manifiesto semántico manda cuando está
// presente; ausente/null conserva la lectura legada del inventario. tests/agt002-decision-axis-
// analysis.test.mjs (B5) verifica la paridad byte a byte de esta regla contra el gate TS real.
function evidenceCoverageDecisionReady(evidenceCoverage) {
  if (!isRecord(evidenceCoverage)) return false;
  const manifest = evidenceCoverage.tender_semantic_manifest;
  if (manifest === null || manifest === undefined) {
    return isInventoryDecisionReady(evidenceCoverage.tender_requirement_inventory);
  }
  if (!isRecord(manifest)) return false;
  if (manifest.semantic_manifest_version !== SEMANTIC_MANIFEST_VERSION) return false;
  if (manifest.decision_ready !== true) return false;
  if (manifest.recommendation !== 'ready_for_human_review') return false;
  if (!isCompleteSemanticCoverage(manifest.discovery_coverage)) return false;
  if (!isCompleteSemanticCoverage(manifest.analyzed_coverage)) return false;
  return isGovernedInventoryShape(evidenceCoverage.tender_requirement_inventory);
}

function coverageAnalyzedBlock(evidenceCoverage) {
  if (!isRecord(evidenceCoverage)) return null;
  const manifest = evidenceCoverage.tender_semantic_manifest;
  if (isRecord(manifest) && manifest.semantic_manifest_version === SEMANTIC_MANIFEST_VERSION) {
    return isCoverageBlock(manifest.analyzed_coverage) ? manifest.analyzed_coverage : null;
  }
  const inventory = evidenceCoverage.tender_requirement_inventory;
  return isGovernedInventoryShape(inventory) ? inventory.analyzed_coverage : null;
}

function buildCoverage(evidenceCoverage) {
  const decisionReady = evidenceCoverageDecisionReady(evidenceCoverage);
  const block = coverageAnalyzedBlock(evidenceCoverage);
  const totalSourceUnits = block ? block.total_source_units : 0;
  const dispositionedSourceUnits = block ? block.dispositioned_source_units : 0;
  return {
    decision_ready: decisionReady,
    total_source_units: totalSourceUnits,
    dispositioned_source_units: dispositionedSourceUnits,
    unresolved_source_units: Math.max(0, totalSourceUnits - dispositionedSourceUnits),
  };
}

function emptyAxes() {
  const axes = {};
  for (const axis of AGT002_DECISION_AXES) {
    axes[axis] = {
      axis,
      state: AGT002_DECISION_AXIS_STATES.NOT_EVALUATED,
      findings: [],
      counts: { blocker: 0, decision_question: 0, supported: 0 },
    };
  }
  return axes;
}

function pausedAnalysis(pausedReason, coverage) {
  return deepFrozenCopy({
    contract_version: AGT002_DECISION_ANALYSIS_CONTRACT_VERSION,
    global_state: 'paused',
    paused_reason: pausedReason,
    coverage,
    axes: emptyAxes(),
    preparation: [],
    counts: { material_findings: 0, ordinary_reclassified: 0 },
  });
}

function questionResponsesForFinding(findingId, questionResponses) {
  return questionResponses.filter(response => isRecord(response) && response.question_id === findingId);
}

/**
 * Deriva la superficie "Análisis para decidir" a partir de un decision_review ya derivado (propio
 * o recibido como override de confianza) y la política cerrada de materialidad/eje. Nunca muta
 * `result.decision_review`/`currentAnalysis`; siempre produce copias nuevas de cada finding
 * proyectado.
 *
 * `result.decision_review` se ignora siempre. El cuarto argumento es la única vía para recibir un
 * review YA RESUELTO por un llamador server-owned (p.ej. tender-analysis-foundation.js, que ya
 * descartó cualquier decision_review forjado por el modelo). Sin ese argumento, este módulo pasa
 * obligatoriamente por deriveAgt002GenericDecisionReview.
 */
export function deriveAgt002DecisionAnalysis(
  currentAnalysis,
  result,
  questionResponses = [],
  serverOwnedDecisionReview = null,
) {
  const responses = Array.isArray(questionResponses) ? questionResponses : [];
  const evidenceCoverage = isRecord(result) ? result.evidence_coverage : undefined;
  const coverage = buildCoverage(evidenceCoverage);

  if (!isRecord(currentAnalysis) || currentAnalysis.current !== true) {
    return pausedAnalysis('analysis_not_current', coverage);
  }

  // `result.decision_review` is untrusted model/result JSON and is intentionally ignored here.
  // Only the separately supplied server-owned review can override the generic derivation.
  const decisionReview = isRecord(serverOwnedDecisionReview)
    ? serverOwnedDecisionReview
    : deriveAgt002GenericDecisionReview(currentAnalysis, result);

  if (!decisionReview) {
    return pausedAnalysis('no_decision_review', coverage);
  }
  if (!coverage.decision_ready) {
    return pausedAnalysis('coverage_not_decision_ready', coverage);
  }

  const candidates = [
    ...(Array.isArray(decisionReview.blockers) ? decisionReview.blockers.map(finding => ({ finding, source_bucket: 'blockers' })) : []),
    ...(Array.isArray(decisionReview.decision_questions) ? decisionReview.decision_questions.map(finding => ({ finding, source_bucket: 'decision_questions' })) : []),
    ...(Array.isArray(decisionReview.supported) ? decisionReview.supported.map(finding => ({ finding, source_bucket: 'supported' })) : []),
    ...(Array.isArray(decisionReview.preparation) ? decisionReview.preparation.map(finding => ({ finding, source_bucket: 'preparation' })) : []),
    ...(Array.isArray(decisionReview.not_applicable) ? decisionReview.not_applicable.map(finding => ({ finding, source_bucket: 'not_applicable' })) : []),
  ];

  const classified = [];
  const curatedReview = decisionReview.artifact_type === CURATED_DECISION_REVIEW_ARTIFACT_TYPE;
  try {
    for (const { finding, source_bucket } of candidates) {
      if (curatedReview) {
        const category = finding.material_impediment_category;
        if (category !== undefined) {
          if (!Object.hasOwn(AGT002_MATERIAL_CATEGORY_TO_AXIS, category)) {
            throw new Error(`categoría material curada desconocida: ${String(category)}`);
          }
          classified.push({ finding, source_bucket, policy: { materiality: 'material', category } });
          continue;
        }
        if (finding.reviewed_status === 'decision_question' || finding.reviewed_status === 'blocker') {
          throw new Error(`finding curado ${finding.reviewed_status} sin material_impediment_category`);
        }
        // Supported/preparation/not_applicable curados sin categoría permanecen en el review
        // trazable, pero no fabrican materialidad, eje ni un estado favorable en esta superficie.
        classified.push({ finding, source_bucket, policy: { materiality: 'curated_non_axis' } });
        continue;
      }
      // En la vía genérica la política server-owned se resuelve sobre LOS CINCO buckets.
      // Un requirement_id desconocido en preparation/not_applicable también pausa todo el run.
      classified.push({ finding, source_bucket, policy: resolveAgt002RequirementMaterialPolicy(finding.requirement_id) });
    }
  } catch {
    return pausedAnalysis('material_policy_unclassified', coverage);
  }

  const axisBuckets = {};
  for (const axis of AGT002_DECISION_AXES) {
    axisBuckets[axis] = { axis, findings: [], counts: { blocker: 0, decision_question: 0, supported: 0 } };
  }
  const preparation = [];
  let materialFindingCount = 0;
  let ordinaryReclassifiedCount = 0;

  for (const { finding, policy, source_bucket } of classified) {
    if (source_bucket === 'preparation' || source_bucket === 'not_applicable') {
      preparation.push(finding);
      continue;
    }
    if (policy.materiality === 'ordinary') {
      preparation.push(finding);
      ordinaryReclassifiedCount += 1;
      continue;
    }
    if (policy.materiality === 'curated_non_axis') {
      if (finding.reviewed_status === 'preparation' || finding.reviewed_status === 'not_applicable') {
        preparation.push(finding);
      }
      continue;
    }
    materialFindingCount += 1;
    const axisId = AGT002_MATERIAL_CATEGORY_TO_AXIS[policy.category];
    const bucket = axisBuckets[axisId];
    const projected = {
      ...finding,
      material_impediment_category: policy.category,
      question_responses: questionResponsesForFinding(finding.id, responses),
    };
    bucket.findings.push(projected);
    if (Object.hasOwn(bucket.counts, finding.reviewed_status)) {
      bucket.counts[finding.reviewed_status] += 1;
    }
  }

  const axes = {};
  for (const axis of AGT002_DECISION_AXES) {
    const bucket = axisBuckets[axis];
    axes[axis] = {
      axis,
      state: axisState(bucket),
      findings: bucket.findings,
      counts: bucket.counts,
    };
  }

  return deepFrozenCopy({
    contract_version: AGT002_DECISION_ANALYSIS_CONTRACT_VERSION,
    global_state: 'ready_for_human_review',
    paused_reason: null,
    coverage,
    axes,
    preparation,
    counts: { material_findings: materialFindingCount, ordinary_reclassified: ordinaryReclassifiedCount },
  });
}

// Precedencia §9 (la peor gana): bucket vacío nunca es favorable; un blocker material confirmado
// domina sobre cualquier pregunta; una pregunta material pendiente domina sobre lo sustentado;
// sólo con TODO sustentado y evidencia no vacía se alcanza `Favorable con evidencia` — fail-closed
// hacia `Por confirmar` ante cualquier duda (nunca hacia favorable).
function axisState(bucket) {
  if (bucket.findings.length === 0) return AGT002_DECISION_AXIS_STATES.NOT_EVALUATED;
  if (bucket.counts.blocker > 0) return AGT002_DECISION_AXIS_STATES.MATERIAL_BLOCKER;
  if (bucket.counts.decision_question > 0) return AGT002_DECISION_AXIS_STATES.PENDING_CONFIRMATION;
  const allSupportedWithEvidence = bucket.findings.every(
    finding => finding.reviewed_status === 'supported'
      && Array.isArray(finding.evidence_refs)
      && finding.evidence_refs.length > 0,
  );
  return allSupportedWithEvidence
    ? AGT002_DECISION_AXIS_STATES.FAVORABLE_WITH_EVIDENCE
    : AGT002_DECISION_AXIS_STATES.PENDING_CONFIRMATION;
}
