import { resolveFindingEvidence, type TenderBriefEvidence } from './tenderDecisionBriefModel';
import { latestQuestionResponse } from './tenderDecisionSurface';
import { tenderAnalysisCoverageReady } from './tenderIntegralAnalysisPresentation';
import type {
  TenderDecisionAxisFinding,
  TenderDecisionAxisId,
  TenderDecisionAxisState,
  TenderDocumentAnalysis,
  TenderGoNoGoDecision,
  TenderQuestionResponse,
} from './types';

export const AGT002_DECISION_AXES: ReadonlyArray<TenderDecisionAxisId> = Object.freeze([
  'legal',
  'experiencia_financiera',
  'imposibilidad_tecnica_grave',
  'plazo',
  'viabilidad_economica',
]);

export const AGT002_DECISION_AXIS_LABELS: Readonly<Record<TenderDecisionAxisId, string>> = Object.freeze({
  legal: 'Legal',
  experiencia_financiera: 'Experiencia y capacidad financiera',
  imposibilidad_tecnica_grave: 'Imposibilidad técnica grave',
  plazo: 'Plazo',
  viabilidad_economica: 'Viabilidad económica',
});

export const AGT002_DECISION_AXIS_STATES: ReadonlyArray<TenderDecisionAxisState> = Object.freeze([
  'Favorable con evidencia',
  'Impedimento material',
  'Por confirmar',
  'No evaluado',
]);

// Rótulo del efecto de un hallazgo material. `decision_question` NUNCA se rotula "impedimento"
// (§9/§10 y AC10 de la spec): la etiqueta de impedimento sólo existe para un `blocker` confirmado
// aguas arriba. `preparation`/`not_applicable` conservan su propio rótulo en vez de heredar el de
// pregunta pendiente: llamar "pregunta material" a lo que la revisión no marcó como tal sería
// inventar un pendiente que nadie registró.
export type TenderDecisionAxisEffectLabel =
  | 'impedimento material confirmado'
  | 'pregunta material pendiente'
  | 'sustentado con evidencia'
  | 'preparación ordinaria registrada'
  | 'no aplica según la revisión';

export type TenderDecisionAxisFindingView = {
  key: string;
  finding: TenderDecisionAxisFinding;
  title: string;
  summary: string | null;
  missing: string | null;
  actionRequired: string | null;
  effectLabel: TenderDecisionAxisEffectLabel;
  evidence: TenderBriefEvidence[];
  responses: TenderQuestionResponse[];
  latestResponse: TenderQuestionResponse | null;
};

export type TenderDecisionPreparationView = {
  key: string;
  title: string;
  actionRequired: string | null;
};

// Copy de pausa: título fijo, motivo explícito y una sola siguiente acción honesta. Nunca afirma
// "sin impedimentos", nunca nombra una persona, un SLA ni una capacidad que el expediente no trae.
export type TenderDecisionPausedCopy = {
  title: string;
  detail: string;
  nextAction: string;
};

export type TenderDecisionAxisView = {
  axis: TenderDecisionAxisId;
  label: string;
  state: TenderDecisionAxisState;
  count: number;
  findings: TenderDecisionAxisFindingView[];
};

export type TenderDecisionSurfaceState = {
  state: 'paused' | 'ready_for_human_review' | 'post_go';
  readOnly: boolean;
};

export type TenderDecisionPrimaryCta =
  | { id: 'coverage'; href: '#tender-technical-analysis' }
  | { id: 'resolve_question'; findingId: string }
  | { id: 'record_decision' }
  | { id: 'open_help_desk'; sectionId: 'tender-preparation' };

function responsesForFinding(
  finding: TenderDecisionAxisFinding,
  questionResponses: TenderQuestionResponse[] | null | undefined,
): TenderQuestionResponse[] {
  const candidates = [
    ...(Array.isArray(finding.question_responses) ? finding.question_responses : []),
    ...(questionResponses ?? []).filter(response => response.question_id === finding.id),
  ];
  const byId = new Map<string, TenderQuestionResponse>();
  for (const response of candidates) byId.set(response.id, response);
  return [...byId.values()].sort((left, right) => (
    new Date(left.responded_at).getTime() - new Date(right.responded_at).getTime()
  ));
}

function effectLabel(finding: TenderDecisionAxisFinding): TenderDecisionAxisEffectLabel {
  if (finding.reviewed_status === 'blocker') return 'impedimento material confirmado';
  if (finding.reviewed_status === 'supported') return 'sustentado con evidencia';
  if (finding.reviewed_status === 'preparation') return 'preparación ordinaria registrada';
  if (finding.reviewed_status === 'not_applicable') return 'no aplica según la revisión';
  return 'pregunta material pendiente';
}

function findingView(
  finding: TenderDecisionAxisFinding,
  analysis: TenderDocumentAnalysis,
  questionResponses: TenderQuestionResponse[] | null | undefined,
): TenderDecisionAxisFindingView {
  const responses = responsesForFinding(finding, questionResponses);
  return {
    key: finding.id,
    finding,
    title: finding.presentation?.title ?? finding.label,
    summary: finding.presentation?.summary ?? null,
    missing: finding.presentation?.missing ?? null,
    actionRequired: finding.presentation?.action_required ?? null,
    effectLabel: effectLabel(finding),
    evidence: resolveFindingEvidence(finding, analysis.decision_review?.review_findings ?? []),
    responses,
    latestResponse: latestQuestionResponse(responses, finding.id),
  };
}

function analysisReadable(analysis: TenderDocumentAnalysis | null | undefined): boolean {
  return Boolean(
    analysis?.decision_axis_analysis
      && analysis.decision_axis_analysis.global_state === 'ready_for_human_review'
      && analysis.decision_axis_analysis.coverage.decision_ready === true
      && tenderAnalysisCoverageReady(analysis.evidence_coverage),
  );
}

export function tenderDecisionAxisViews(
  analysis: TenderDocumentAnalysis | null | undefined,
  questionResponses: TenderQuestionResponse[] | null | undefined = [],
): TenderDecisionAxisView[] {
  const readable = analysisReadable(analysis);
  return AGT002_DECISION_AXES.map(axis => {
    const bucket = readable ? analysis?.decision_axis_analysis?.axes?.[axis] : null;
    const findings = bucket && analysis
      ? bucket.findings.map(finding => findingView(finding, analysis, questionResponses))
      : [];
    return {
      axis,
      label: AGT002_DECISION_AXIS_LABELS[axis],
      state: bucket?.state ?? 'No evaluado',
      count: findings.length,
      findings,
    };
  });
}

export function tenderDecisionSurfaceState(
  analysis: TenderDocumentAnalysis | null | undefined,
  decision: Pick<TenderGoNoGoDecision, 'decision' | 'analysis_run_id'> | null | undefined,
): TenderDecisionSurfaceState {
  if (!analysisReadable(analysis)) return { state: 'paused', readOnly: true };
  const decisionBelongsToCurrentRun = Boolean(
    decision && decision.analysis_run_id && decision.analysis_run_id === analysis?.run_id,
  );
  if (decisionBelongsToCurrentRun && decision?.decision === 'go') {
    return { state: 'post_go', readOnly: true };
  }
  return {
    state: 'ready_for_human_review',
    readOnly: decisionBelongsToCurrentRun && decision?.decision === 'no_go',
  };
}

export function tenderDecisionPrimaryCta(
  surfaceState: TenderDecisionSurfaceState,
  axes: TenderDecisionAxisView[],
): TenderDecisionPrimaryCta {
  if (surfaceState.state === 'paused') return { id: 'coverage', href: '#tender-technical-analysis' };
  if (surfaceState.state === 'post_go') return { id: 'open_help_desk', sectionId: 'tender-preparation' };
  for (const axis of AGT002_DECISION_AXES) {
    const view = axes.find(candidate => candidate.axis === axis);
    if (view?.state === 'Por confirmar' && view.findings[0]) {
      return { id: 'resolve_question', findingId: view.findings[0].key };
    }
  }
  return { id: 'record_decision' };
}

/**
 * Hallazgos ordinarios que la capa server-owned reclasificó a `preparation` en ESTA superficie
 * (§7.2 de la spec). No alimentan ningún eje ni bloquean la decisión: se listan aparte para que la
 * lectura única no pierda información gobernada que antes vivía en la sección Análisis.
 */
export function tenderDecisionPreparationViews(
  analysis: TenderDocumentAnalysis | null | undefined,
): TenderDecisionPreparationView[] {
  if (!analysisReadable(analysis)) return [];
  const preparation = analysis?.decision_axis_analysis?.preparation ?? [];
  return preparation.map(finding => ({
    key: finding.id,
    title: finding.presentation?.title ?? finding.label,
    actionRequired: finding.presentation?.action_required ?? null,
  }));
}

const PAUSED_TITLE = 'Análisis integral pausado';
const PAUSED_TECHNICAL_NEXT_ACTION = 'Siguiente acción: revisar el respaldo técnico del análisis. La ausencia de hallazgos con la lectura pausada no equivale a ausencia de impedimentos.';

/**
 * Copy de la pausa por motivo explícito (§8/§12). Un análisis pausado nunca muestra cifras de
 * cobertura cuando la pausa no viene de la cobertura, ni afirma cobertura parcial sin datos.
 */
export function tenderDecisionPausedCopy(
  analysis: TenderDocumentAnalysis | null | undefined,
): TenderDecisionPausedCopy {
  const axisAnalysis = analysis?.decision_axis_analysis ?? null;
  if (!analysis) {
    return {
      title: PAUSED_TITLE,
      detail: 'Todavía no hay un análisis vigente de este expediente, así que no existe lectura por ejes.',
      nextAction: 'Siguiente acción: ejecutar o actualizar el análisis del expediente antes de leer los cinco ejes.',
    };
  }
  if (!axisAnalysis) {
    return {
      title: PAUSED_TITLE,
      detail: 'Esta corrida no incluye la lectura por ejes de decisión: se conserva como trazabilidad histórica, no como cobertura integral.',
      nextAction: PAUSED_TECHNICAL_NEXT_ACTION,
    };
  }
  if (axisAnalysis.paused_reason === 'coverage_not_decision_ready') {
    return {
      title: PAUSED_TITLE,
      detail: tenderDecisionCoverageCopy(axisAnalysis.coverage),
      nextAction: 'Siguiente acción: completar la lectura del expediente en el respaldo técnico. Los cinco ejes permanecen No evaluado mientras la cobertura sea parcial.',
    };
  }
  if (axisAnalysis.paused_reason === 'material_policy_unclassified') {
    return {
      title: PAUSED_TITLE,
      detail: 'Al menos un requisito de este expediente no está clasificado en el catálogo gobernado de materialidad, así que ningún eje puede leerse.',
      nextAction: 'Siguiente acción: revisar el respaldo técnico del análisis. La materialidad es gobernada y nunca se asume por omisión.',
    };
  }
  if (axisAnalysis.paused_reason === 'no_decision_review') {
    return {
      title: PAUSED_TITLE,
      detail: 'Esta corrida no tiene una revisión de decisión gobernada, así que no hay hallazgos que agrupar por eje.',
      nextAction: PAUSED_TECHNICAL_NEXT_ACTION,
    };
  }
  if (axisAnalysis.paused_reason === 'analysis_not_current') {
    return {
      title: PAUSED_TITLE,
      detail: 'Esta corrida ya no es el análisis vigente del expediente, así que no puede sustentar una decisión.',
      nextAction: 'Siguiente acción: cargar o completar el análisis vigente del expediente antes de leer los cinco ejes.',
    };
  }
  return {
    title: PAUSED_TITLE,
    detail: 'La lectura de cobertura de este expediente no está completa, así que los cinco ejes permanecen sin lectura.',
    nextAction: PAUSED_TECHNICAL_NEXT_ACTION,
  };
}

export function tenderDecisionCoverageCopy(
  coverage: { total_source_units?: number | null; dispositioned_source_units?: number | null } | null | undefined,
): string {
  const total = Number.isInteger(coverage?.total_source_units) ? Number(coverage?.total_source_units) : 0;
  const resolved = Number.isInteger(coverage?.dispositioned_source_units) ? Number(coverage?.dispositioned_source_units) : 0;
  // Sin cifras gobernadas de cobertura no se inventa un porcentaje ni se repite el título del
  // banner: se dice exactamente lo que se sabe, que es nada.
  if (total <= 0) return 'Cobertura del expediente sin cifras verificables.';
  const unresolved = Math.max(0, total - resolved);
  const format = new Intl.NumberFormat('es-CO');
  return `Análisis pausado — cobertura parcial (${format.format(resolved)} de ${format.format(total)} resueltas; ${format.format(unresolved)} sin resolver)`;
}
