import { tenderDecisionConditionAnchor } from './tenderDecisionSurface';
import type {
  TenderDecisionReview,
  TenderIntegralAnalysisUnit,
  TenderIntegralAnalysisV3,
  TenderIntegralCategory,
} from './types';

// Pure presentation selectors over the raw V3 integral analysis (contrato exacto vinculante,
// task-2-brief). Never generate conclusions/relations from textual heuristics: the human-facing
// text is always the raw `unit.title` / `unit.conclusion.summary` / `unit.commercial_impact.summary`
// / `unit.missing_evidence[].reason` / `unit.actions[].summary`. Enum values are translated only
// through closed dictionaries, falling back to "Por revisar" for anything unrecognized; the raw
// enum value only ever lives under `technical`, never as visible text. A V3 unit relates to a
// decision-review condition exclusively by explicit `requirement_id` equality — never by text.

const UNKNOWN_ENUM_LABEL = 'Por revisar';

const CATEGORY_LABELS: Record<string, string> = {
  discard: 'Descarte',
  habilitating: 'Habilitantes',
  technical: 'Técnico',
  financial_execution: 'Financiero / ejecución',
  strategic: 'Estratégico',
};

const CONCLUSION_LABELS: Record<string, string> = {
  supported_with_evidence: 'Sustentado con evidencia',
  partially_supported: 'Sustento parcial',
  gap_evidenced: 'Brecha evidenciada',
  insufficient_evidence: 'Evidencia insuficiente',
  human_validation_required: 'Revisión humana requerida',
};

const COMMERCIAL_IMPACT_LABELS: Record<string, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
  unknown: 'Desconocido',
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  tender_document: 'Documento del pliego',
  company_evidence: 'Evidencia empresarial',
  legal_corpus: 'Corpus jurídico',
  human_evidence: 'Evidencia humana',
  objective_validation: 'Validación objetiva',
};

const PURPOSE_LABELS: Record<string, string> = {
  requirement_basis: 'Sustento del requisito',
  company_capacity: 'Capacidad empresarial',
  legal_basis: 'Fundamento jurídico',
  commercial_context: 'Contexto comercial',
  milestone_basis: 'Sustento de hito',
  gap_basis: 'Sustento de brecha',
};

const AXIS_LABELS: Record<string, string> = {
  presence: 'Presencia',
  review: 'Revisión',
  validity: 'Vigencia',
  applicability: 'Aplicabilidad',
  compliance: 'Sustento',
};

const AXIS_VALUE_LABELS: Record<string, string> = {
  present: 'Presente', absent: 'Ausente', unknown: 'Desconocido',
  reviewed: 'Revisada', partially_reviewed: 'Revisión parcial', not_reviewed: 'No revisada',
  valid: 'Vigente', expired: 'Vencida', not_applicable: 'No aplica',
  applicable: 'Aplica',
  supported_pending_human_review: 'Sustento pendiente de validación',
  partially_supported_pending_human_review: 'Sustento parcial pendiente',
  gap_evidenced_pending_human_review: 'Brecha evidenciada pendiente',
};

const LEGAL_STATUS_LABELS: Record<string, string> = {
  supported: 'Sustentado',
  partially_supported: 'Parcialmente sustentado',
  unsupported: 'Sin sustento',
  not_verified: 'No verificado',
  not_applicable: 'No aplica',
};

// Orden institucional cerrado de las cinco categorías. Una categoría no reconocida nunca inventa
// una fase nueva: cae en el rótulo de respaldo `Por revisar`.
export const TENDER_INTEGRAL_PHASES: ReadonlyArray<{ key: TenderIntegralCategory; label: string }> = Object.freeze([
  { key: 'discard', label: 'Descarte' },
  { key: 'habilitating', label: 'Habilitantes' },
  { key: 'technical', label: 'Técnico' },
  { key: 'financial_execution', label: 'Financiero / ejecución' },
  { key: 'strategic', label: 'Estratégico' },
]);

export const TENDER_INTEGRAL_UNKNOWN_PHASE_KEY = 'unknown';

const EVIDENCE_STATE_AXES: ReadonlyArray<keyof TenderIntegralAnalysisUnit['evidence_state']> = Object.freeze([
  'presence', 'review', 'validity', 'applicability', 'compliance',
]);

function translateEnum(dictionary: Record<string, string>, value: string | null | undefined): string {
  if (!value) return UNKNOWN_ENUM_LABEL;
  return dictionary[value] ?? UNKNOWN_ENUM_LABEL;
}

export function tenderIntegralCategoryLabel(category: string | null | undefined): string {
  return translateEnum(CATEGORY_LABELS, category);
}

export type TenderIntegralUnitTechnical = {
  category: string;
  conclusionStatus: string;
  commercialImpactLevel: string;
  unitId: string;
  requirementId: string | null;
  unitKind: string;
  sequence: number;
  assessmentMode: string;
  confidence: string;
  commercialImpactDimension: string;
  evidenceRefs: Array<{ ref: string; sourceType: string; sourceTypeLabel: string; purpose: string; purposeLabel: string }>;
  missingEvidence: Array<{ missingId: string; evidenceClassId: string | null; neededSourceType: string; reason: string; critical: boolean }>;
  evidenceState: Array<{ axis: string; axisLabel: string; value: string; valueLabel: string }>;
  blocking: { effect: string; curability: string; reason: string };
  escalation: { required: boolean; level: string; reason: string };
  milestone: { status: string; type: string; at: string | null; sourceRef: string | null; summary: string };
  legalStatus: string;
  legalStatusLabel: string;
  legalSummary: string;
  legalBasisRefs: string[];
  legalHumanReviewRequired: boolean;
  closure: { status: string; condition: string; evidenceRequired: string[] };
  humanValidation: { status: string; reason: string };
};

export type TenderIntegralUnitPresentation = {
  key: string;
  title: string;
  categoryLabel: string;
  conclusionLabel: string;
  conclusionSummary: string;
  commercialImpactLabel: string;
  commercialImpactSummary: string;
  missingEvidenceReasons: string[];
  actionSummaries: string[];
  primaryActionSummary: string | null;
  requirementId: string | null;
  citedEvidenceCount: number;
  pendingEvidenceCount: number;
  evidenceSourceLabels: string[];
  hasCitedEvidence: boolean;
  hasPendingEvidence: boolean;
  technical: TenderIntegralUnitTechnical;
};

function uniqueInOrder(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

export function tenderIntegralUnitPresentation(unit: TenderIntegralAnalysisUnit): TenderIntegralUnitPresentation {
  const [primaryAction] = unit.actions;
  return {
    key: unit.unit_id,
    title: unit.title,
    categoryLabel: translateEnum(CATEGORY_LABELS, unit.category),
    conclusionLabel: translateEnum(CONCLUSION_LABELS, unit.conclusion.status),
    conclusionSummary: unit.conclusion.summary,
    commercialImpactLabel: translateEnum(COMMERCIAL_IMPACT_LABELS, unit.commercial_impact.level),
    commercialImpactSummary: unit.commercial_impact.summary,
    missingEvidenceReasons: unit.missing_evidence.map(item => item.reason),
    actionSummaries: unit.actions.map(item => item.summary),
    primaryActionSummary: primaryAction ? primaryAction.summary : null,
    requirementId: unit.requirement_id,
    citedEvidenceCount: unit.evidence_refs.length,
    pendingEvidenceCount: unit.missing_evidence.length,
    evidenceSourceLabels: uniqueInOrder(unit.evidence_refs.map(ref => translateEnum(SOURCE_TYPE_LABELS, ref.source_type))),
    hasCitedEvidence: unit.evidence_refs.length > 0,
    hasPendingEvidence: unit.missing_evidence.length > 0,
    technical: {
      category: unit.category,
      conclusionStatus: unit.conclusion.status,
      commercialImpactLevel: unit.commercial_impact.level,
      unitId: unit.unit_id,
      requirementId: unit.requirement_id,
      unitKind: unit.unit_kind,
      sequence: unit.sequence,
      assessmentMode: unit.assessment_mode,
      confidence: unit.conclusion.confidence,
      commercialImpactDimension: unit.commercial_impact.dimension,
      evidenceRefs: unit.evidence_refs.map(ref => ({
        ref: ref.ref,
        sourceType: ref.source_type,
        sourceTypeLabel: translateEnum(SOURCE_TYPE_LABELS, ref.source_type),
        purpose: ref.purpose,
        purposeLabel: translateEnum(PURPOSE_LABELS, ref.purpose),
      })),
      missingEvidence: unit.missing_evidence.map(item => ({
        missingId: item.missing_id,
        evidenceClassId: item.evidence_class_id,
        neededSourceType: item.needed_source_type,
        reason: item.reason,
        critical: item.critical,
      })),
      evidenceState: EVIDENCE_STATE_AXES.map(axis => ({
        axis,
        axisLabel: translateEnum(AXIS_LABELS, axis),
        value: unit.evidence_state[axis],
        valueLabel: translateEnum(AXIS_VALUE_LABELS, unit.evidence_state[axis]),
      })),
      blocking: { effect: unit.blocking.effect, curability: unit.blocking.curability, reason: unit.blocking.reason },
      escalation: { required: unit.escalation.required, level: unit.escalation.level, reason: unit.escalation.reason },
      milestone: {
        status: unit.milestone.status,
        type: unit.milestone.type,
        at: unit.milestone.at,
        sourceRef: unit.milestone.source_ref,
        summary: unit.milestone.summary,
      },
      legalStatus: unit.legal_assessment.status,
      legalStatusLabel: translateEnum(LEGAL_STATUS_LABELS, unit.legal_assessment.status),
      legalSummary: unit.legal_assessment.summary,
      legalBasisRefs: unit.legal_assessment.basis_refs,
      legalHumanReviewRequired: unit.legal_assessment.human_legal_review_required,
      closure: {
        status: unit.closure.status,
        condition: unit.closure.condition,
        evidenceRequired: unit.closure.evidence_required,
      },
      humanValidation: { status: unit.human_validation.status, reason: unit.human_validation.reason },
    },
  };
}

export function tenderIntegralUnitsPresentation(
  v3: TenderIntegralAnalysisV3 | null | undefined,
): TenderIntegralUnitPresentation[] {
  return (v3?.analysis_units ?? []).map(tenderIntegralUnitPresentation);
}

export type TenderIntegralAnalysisCounts = {
  totalUnits: number;
  byConclusion: Record<string, number>;
  classifiedTotal: number;
};

export function tenderIntegralAnalysisCounts(
  v3: TenderIntegralAnalysisV3 | null | undefined,
): TenderIntegralAnalysisCounts {
  const units = v3?.analysis_units ?? [];
  const byConclusion: Record<string, number> = {};
  for (const unit of units) {
    const label = translateEnum(CONCLUSION_LABELS, unit.conclusion.status);
    byConclusion[label] = (byConclusion[label] ?? 0) + 1;
  }
  const classifiedTotal = Object.values(byConclusion).reduce((sum, count) => sum + count, 0);
  return { totalUnits: units.length, byConclusion, classifiedTotal };
}

// Resumen del respaldo técnico calculado íntegramente desde los arreglos reales. La suma de
// `byConclusion` es siempre `analysis_units.length` (todo estado desconocido cae en `Por revisar`).
// Las referencias citadas y la evidencia pendiente son indicadores independientes: una misma
// unidad puede citar evidencia y tener pendientes a la vez, así que nunca son complementarios.
export type TenderIntegralAnalysisSummary = {
  totalUnits: number;
  byConclusion: Array<{ label: string; count: number }>;
  classifiedTotal: number;
  citedReferenceCount: number;
  unitsWithCitedEvidence: number;
  pendingEvidenceCount: number;
  unitsWithPendingEvidence: number;
};

export function tenderIntegralAnalysisSummary(
  v3: TenderIntegralAnalysisV3 | null | undefined,
): TenderIntegralAnalysisSummary {
  const units = v3?.analysis_units ?? [];
  const counts = tenderIntegralAnalysisCounts(v3);
  const orderedLabels = uniqueInOrder([...Object.values(CONCLUSION_LABELS), UNKNOWN_ENUM_LABEL]);
  const byConclusion = orderedLabels
    .filter(label => (counts.byConclusion[label] ?? 0) > 0)
    .map(label => ({ label, count: counts.byConclusion[label] }));
  return {
    totalUnits: counts.totalUnits,
    byConclusion,
    classifiedTotal: counts.classifiedTotal,
    citedReferenceCount: units.reduce((total, unit) => total + unit.evidence_refs.length, 0),
    unitsWithCitedEvidence: units.filter(unit => unit.evidence_refs.length > 0).length,
    pendingEvidenceCount: units.reduce((total, unit) => total + unit.missing_evidence.length, 0),
    unitsWithPendingEvidence: units.filter(unit => unit.missing_evidence.length > 0).length,
  };
}

// Agrupación por las cinco categorías institucionales. Las fases se conservan aunque queden
// vacías (el orden institucional es parte de la lectura) y ninguna unidad se pierde: una categoría
// no reconocida abre el grupo de respaldo `Por revisar`.
export type TenderIntegralPhaseGroup = {
  key: string;
  label: string;
  units: TenderIntegralUnitPresentation[];
  pendingEvidenceCount: number;
  hasPendingEvidence: boolean;
};

export function tenderIntegralPhaseGroups(
  v3: TenderIntegralAnalysisV3 | null | undefined,
): TenderIntegralPhaseGroup[] {
  const buckets = TENDER_INTEGRAL_PHASES.map(phase => ({
    key: phase.key as string,
    label: phase.label,
    units: [] as TenderIntegralUnitPresentation[],
  }));
  const fallback = { key: TENDER_INTEGRAL_UNKNOWN_PHASE_KEY, label: UNKNOWN_ENUM_LABEL, units: [] as TenderIntegralUnitPresentation[] };
  for (const unit of v3?.analysis_units ?? []) {
    const bucket = buckets.find(item => item.key === unit.category) ?? fallback;
    bucket.units.push(tenderIntegralUnitPresentation(unit));
  }
  const groups = fallback.units.length > 0 ? [...buckets, fallback] : buckets;
  return groups.map(group => {
    const pendingEvidenceCount = group.units.reduce((total, unit) => total + unit.pendingEvidenceCount, 0);
    return { ...group, pendingEvidenceCount, hasPendingEvidence: pendingEvidenceCount > 0 };
  });
}

// Relación unidad V3 → condición gobernada: exclusivamente por igualdad explícita y no nula de
// `requirement_id` contra una entrada de `decision_review`. Nunca por texto, nunca por título, y
// `null === null` jamás cuenta como igualdad. Sin coincidencia no hay destino seguro: devuelve
// `null` para que la vista omita el enlace en lugar de inventarlo.
export function tenderIntegralUnitPrimaryConditionKey(
  unit: TenderIntegralAnalysisUnit | null | undefined,
  review: TenderDecisionReview | null | undefined,
): string | null {
  const requirementId = unit?.requirement_id;
  if (!requirementId) return null;
  const governed = [...(review?.decision_questions ?? []), ...(review?.blockers ?? [])];
  const match = governed.find(finding => Boolean(finding.requirement_id) && finding.requirement_id === requirementId);
  return match ? match.id : null;
}

// Ancla gobernada, opaca y no técnica para una unidad V3: primero resuelve la condición
// gobernada por igualdad explícita de `requirement_id` y luego reutiliza el único helper de
// ancla compartido con la tarjeta de Análisis, para no duplicar la relación por texto.
export function tenderIntegralUnitConditionAnchor(
  unit: TenderIntegralAnalysisUnit | null | undefined,
  review: TenderDecisionReview | null | undefined,
): string | null {
  const findingId = tenderIntegralUnitPrimaryConditionKey(unit, review);
  return tenderDecisionConditionAnchor(review, findingId);
}

export function tenderIntegralPrimaryUnitForCondition(
  units: TenderIntegralAnalysisUnit[] | null | undefined,
  requirementId: string | null | undefined,
): TenderIntegralAnalysisUnit | null {
  if (!requirementId) return null;
  return (units ?? []).find(unit => unit.requirement_id === requirementId) ?? null;
}
