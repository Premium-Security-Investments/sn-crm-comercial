import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import { normalizeTenderEvidence, tenderAnalysisMethodLabel, tenderAnalysisProducerDisclosure, tenderDecisionStatusTone, tenderNextAction } from '../tenderDecisionBrief';
import { tenderRecommendationLabel } from '../tenderDecisionGate';
import { deriveTenderProcessingPresentation } from '../processingStatus';
import { tenderBriefUnavailableCopy } from '../tenderDecisionBriefModel';
import { tenderDecisionBlockers, tenderDecisionConditionAnchor, tenderDecisionConditions, tenderDecisionPreparationActions, tenderDecisionSupportedAspects } from '../tenderDecisionSurface';
import { tenderDecisionAxisViews } from '../tenderDecisionAxisSurface';
import { tenderAnalysisCoverageReady, tenderIntegralOpenUnitsPresentation, tenderIntegralOperationalGroups } from '../tenderIntegralAnalysisPresentation';
import type { TenderAnalysisFinding, TenderDocumentAnalysis, TenderDocumentRecord, TenderDocumentsPayload, TenderProcessingStatus, TenderQuestionResponse, TenderQuestionResponseInput } from '../types';
import { QuestionResponseCard, type NormalizedQuestion } from './TenderQuestionResponseCard';
import { shouldShowTenderOperationalPendingProjection, TenderOperationalPendingProjection } from './TenderOperationalPendingProjection';

type TenderAnalysisSectionProps = {
  analysis: TenderDocumentAnalysis | null;
  documents: TenderDocumentRecord[];
  busy: boolean;
  canRunPreview: boolean;
  onAnalyzePreview: () => void;
  statusText?: string;
  statusTone?: 'status' | 'error';
  analysisEngine?: TenderDocumentsPayload['analysis_engine'];
  questionResponses?: TenderQuestionResponse[];
  canAnswerQuestions?: boolean;
  onSaveQuestionResponse?: (input: TenderQuestionResponseInput, files: File[]) => Promise<void>;
  processingStatus?: TenderProcessingStatus | null;
  onRetryProcessing?: () => void;
  // Con la superficie única activa (flag AGT002_DECISION_AXIS_SURFACE), Análisis conserva los
  // controles de corrida y alberga la proyección operativa V3 completa cuando todavía no existe
  // lectura material por ejes. Decisión consume el mismo gate presentacional, pero sólo enlaza a
  // esta lista; cuando sí hay lectura material, la superficie de cinco ejes sigue viviendo allí.
  // Por defecto `false`: con el flag apagado se conserva el flujo legado.
  decisionSurfaceElsewhere?: boolean;
};

function EvidenceList({ items, empty }: { items: unknown; empty: string }) {
  const visible = normalizeTenderEvidence(items);
  return visible.length ? <ul>{visible.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="muted">{empty}</p>;
}

function normalizeQuestion(item: TenderAnalysisFinding, index: number): NormalizedQuestion {
  if (typeof item === 'string') return { id: `question-${index + 1}`, text: item, critical: false, evidenceRefs: [] };
  return {
    id: String(item.id || `question-${index + 1}`),
    text: String(item.text || `Duda abierta ${index + 1}`),
    critical: Boolean(item.critical),
    evidenceRefs: Array.isArray(item.evidence_refs) ? item.evidence_refs : [],
  };
}

export function TenderAnalysisSection({ analysis, documents, busy, canRunPreview, onAnalyzePreview, statusText = '', statusTone = 'status', analysisEngine, questionResponses = [], canAnswerQuestions = false, onSaveQuestionResponse, processingStatus = null, onRetryProcessing, decisionSurfaceElsewhere = false }: TenderAnalysisSectionProps) {
  const strengths = analysis?.strengths ?? analysis?.commercial_fit?.positives ?? [];
  const weaknesses = analysis?.weaknesses ?? analysis?.blockers ?? analysis?.commercial_fit?.concerns ?? [];
  const questions = (analysis?.questions ?? []).map(normalizeQuestion);
  const unverified = analysis?.unverified ?? analysis?.company_profile_crosscheck?.gaps ?? [];
  const hasIntegralV3Payload = Boolean(analysis?.integral_analysis?.analysis_units?.length);
  // Mismo gate fail-closed que el respaldo técnico V3 (tenderAnalysisCoverageReady): decide sobre
  // toda la cobertura de evidencia de la corrida —la frontera semántica del expediente manda
  // cuando llega, y el inventario legado es el respaldo histórico—. Sin cobertura lista para
  // decisión la superficie ejecutiva completa permanece pausada.
  const coveragePaused = hasIntegralV3Payload && !tenderAnalysisCoverageReady(analysis?.evidence_coverage);
  const hasIntegralV3 = hasIntegralV3Payload && !coveragePaused;
  const operationalUnits = tenderIntegralOpenUnitsPresentation(analysis?.integral_analysis);
  const operationalGroups = tenderIntegralOperationalGroups(analysis?.integral_analysis);
  const decisionAxes = tenderDecisionAxisViews(analysis, questionResponses);
  const showOperationalProjection = decisionSurfaceElsewhere
    && shouldShowTenderOperationalPendingProjection(decisionAxes, operationalUnits);
  // El modo operativo V3 se decide con el mismo selector puro que usa Decisión. Sólo esa lista
  // completa se proyecta aquí; `decision_review` continúa en el flujo legado cuando el flag está
  // apagado y los cinco ejes materiales continúan en la superficie única cuando están disponibles.
  const conditionCards = tenderDecisionConditions(analysis?.decision_review, questionResponses);
  const impedimentCards = tenderDecisionBlockers(analysis?.decision_review, questionResponses);
  const supportedCards = tenderDecisionSupportedAspects(analysis?.decision_review);
  const preparationCards = tenderDecisionPreparationActions(analysis?.decision_review);
  const decisionQuestions: NormalizedQuestion[] = [...conditionCards, ...impedimentCards].map(card => ({
    id: card.key,
    text: card.persistence.questionText,
    critical: false,
    evidenceRefs: [],
    decisionCopy: { title: card.title, state: card.state, missing: card.missing, actionRequired: card.actionRequired },
    anchorId: tenderDecisionConditionAnchor(analysis?.decision_review, card.key) ?? undefined,
  }));
  const hasDocuments = documents.length > 0;
  const failed = analysis?.status === 'failed';
  const stale = Boolean(analysis && !analysis.current);
  const processingPresentation = deriveTenderProcessingPresentation(processingStatus, analysis);
  const state = !hasDocuments ? 'Pendiente' : failed ? 'Análisis fallido' : stale ? 'Análisis desactualizado' : !analysis ? 'Pendiente' : 'Análisis vigente';
  const actionLabel = failed || stale ? `Volver a analizar con ${VIGIA_VISIBLE_NAMES.tenders}` : analysis ? `Actualizar con ${VIGIA_VISIBLE_NAMES.tenders}` : `Analizar con ${VIGIA_VISIBLE_NAMES.tenders}`;
  const analysisActionDisabled = busy || !hasDocuments || processingPresentation.primaryAction === 'disabled';
  const showAnalysisAction = canRunPreview && processingPresentation.primaryAction !== 'hidden';
  const unavailable = tenderBriefUnavailableCopy();
  return <div className={`tender-analysis-section tender-detail-anchor${hasIntegralV3 ? ' is-v3-compact' : ''}`}>
    {!hasIntegralV3Payload && <header className="tender-analysis-header"><div><span className="eyebrow">Paso previo a la decisión humana</span><h3 id="tender-analysis-title">Análisis con {VIGIA_VISIBLE_NAMES.tenders}</h3><p>Organiza la evidencia disponible y señala pendientes. No registra ni autoriza GO / NO GO.</p></div><div className={`tender-analysis-state state-${failed ? 'failed' : stale ? 'stale' : analysis ? 'ready' : 'pending'}`}><strong>{state}</strong></div></header>}
    {!hasDocuments && <div className="document-empty-state"><strong>Sin documentos</strong><span>Actualice o cargue documentos antes de analizar con {VIGIA_VISIBLE_NAMES.tenders}.</span></div>}
    {hasDocuments && !analysis && !processingPresentation.visible && <div className="document-empty-state"><strong>Análisis pendiente</strong><span>Hay documentos vigentes, pero todavía no existe una conclusión preliminar para revisar.</span></div>}
    {processingPresentation.visible && <div className={processingPresentation.tone === 'error' ? 'error' : 'notice'} role={processingPresentation.tone === 'error' ? 'alert' : 'status'}>
      <p>{processingPresentation.message}</p>
      {processingPresentation.showRetry && <button type="button" disabled={busy} onClick={onRetryProcessing}>Reintentar</button>}
    </div>}
    {failed && <div className="error" role="alert"><strong>Análisis fallido.</strong> El último intento no produjo una conclusión utilizable. Puede intentarlo nuevamente sin afectar la decisión humana.</div>}
    {stale && <div className="notice" role="status"><strong>Análisis desactualizado.</strong> El contenido histórico se conserva para trazabilidad, pero los documentos vigentes cambiaron.</div>}
    {showOperationalProjection && <TenderOperationalPendingProjection groups={operationalGroups} count={operationalUnits.length} />}
    {coveragePaused && !decisionSurfaceElsewhere && <section className="tender-v3-questions tender-executive-pending" aria-labelledby="tender-inventory-paused-title">
      <header><div><span className="eyebrow">Cobertura del expediente</span><h3 id="tender-inventory-paused-title">Análisis integral pausado</h3><p>Este análisis no tiene todavía una cobertura de evidencia lista para decisión de este expediente: la frontera semántica no está finalizada, o falta un inventario verificable de sus requisitos. No se cita ninguna cifra suya: el análisis anterior se conserva sólo como trazabilidad y no representa cobertura integral de esta licitación.</p></div><strong>Cobertura pendiente</strong></header>
      <p className="notice" role="status">No hay recomendación integral disponible. Revise o actualice el análisis cuando la cobertura de requisitos de este expediente esté completa. El respaldo técnico histórico de esta licitación se conserva más abajo, sólo como trazabilidad.</p>
    </section>}
    {!decisionSurfaceElsewhere && !hasIntegralV3Payload && analysis && analysis.status !== 'failed' && <article className="tender-decision-brief" aria-label="Conclusión preliminar de licitación">
      <header className="tender-decision-brief-head"><div><small>Recomendación preliminar</small><strong>{tenderRecommendationLabel(analysis.recommendation)}</strong><p>{analysis.summary || 'Sin resumen documental disponible.'}</p></div><div className="tender-decision-brief-status"><span className={`badge badge-${tenderDecisionStatusTone(analysis.recommendation)}`}>{analysis.current ? 'Vigente' : 'Obsoleto'}</span><span>{tenderAnalysisMethodLabel(analysis.producer)}</span><small>{analysis.completed_at ? `Actualizado: ${new Date(analysis.completed_at).toLocaleString('es-CO')}` : analysis.generated_at ? `Generado: ${new Date(analysis.generated_at).toLocaleString('es-CO')}` : 'Fecha no informada'}</small></div></header>
      <div className="tender-decision-brief-grid"><section><h4>Fortalezas</h4><EvidenceList items={strengths} empty="Sin fortalezas documentales registradas."/></section><section><h4>Debilidades y bloqueadores</h4><EvidenceList items={weaknesses} empty="Sin debilidades o bloqueadores documentales registrados."/></section><section className="tender-question-responses"><h4>Dudas abiertas</h4>{questions.length ? <div className="tender-question-list">{questions.map(question => <QuestionResponseCard key={question.id} question={question} analysisRunId={analysis.run_id} responses={questionResponses.filter(item => item.question_id === question.id)} canAnswer={canAnswerQuestions} disabled={busy} onSave={onSaveQuestionResponse}/>)}</div> : <p className="muted">Sin dudas abiertas registradas.</p>}</section><section><h4>Información no verificada</h4><EvidenceList items={unverified} empty="Sin información no verificada registrada."/></section><section className="tender-decision-next-action"><h4>Siguiente acción</h4><p>{tenderNextAction(analysis.next_action) || 'Sin siguiente acción documentada; revisar el expediente con Licitaciones.'}</p></section></div>
    </article>}
    {hasIntegralV3 && !decisionSurfaceElsewhere && analysis && !analysis.decision_review && <section className="tender-v3-questions tender-executive-pending" aria-labelledby="tender-v3-questions-title">
      <header><div><span className="eyebrow">Lectura para decisión</span><h3 id="tender-v3-questions-title">Clasificación ejecutiva no disponible</h3><p>{unavailable.body} Hay {questions.length} hallazgos técnicos conservados en la trazabilidad. Hasta que su materialidad sea clasificada, no se presentan como alertas materiales ni requieren respuesta indiscriminada.</p></div><strong>Revisión material pendiente</strong></header>
      <p className="notice" role="status">{unavailable.impedimentNote}</p>
    </section>}
    {hasIntegralV3 && !decisionSurfaceElsewhere && analysis && analysis.decision_review && <section className="tender-v3-questions" aria-labelledby="tender-v3-questions-title">
      <header><div><span className="eyebrow">Validación humana</span><h3 id="tender-v3-questions-title">Condiciones pendientes de validar</h3><p>Cada condición e impedimento se valida aquí una sola vez. El brief de decisión está en la sección Decisión.</p></div></header>
      {decisionQuestions.length ? <div className="tender-question-list">{decisionQuestions.map(question => <article key={question.id} className="tender-decision-review-question"><QuestionResponseCard question={question} analysisRunId={analysis.run_id} responses={questionResponses.filter(item => item.question_id === question.id)} canAnswer={canAnswerQuestions} disabled={busy} onSave={onSaveQuestionResponse}/></article>)}</div> : <p className="muted">Sin condiciones pendientes de validar.</p>}
      <div className="tender-decision-compact-blocks">
        <section className="tender-decision-compact-block"><h4>Aspectos favorables y capacidad</h4>{supportedCards.length ? <ul>{supportedCards.map(card => <li key={card.key}><strong>{card.title}</strong>{card.summary && <span> {card.summary}</span>}</li>)}</ul> : <p className="muted">Sin aspectos favorables registrados.</p>}</section>
        <section className="tender-decision-compact-block"><h4>Acciones de preparación</h4>{preparationCards.length ? <ul>{preparationCards.map(card => <li key={card.key}><strong>{card.title}</strong>{card.actionRequired && <span> {card.actionRequired}</span>}</li>)}</ul> : <p className="muted">Sin acciones de preparación registradas.</p>}</section>
      </div>
    </section>}
    {analysisEngine?.fallback && <div className="notice" role="status"><strong>Fallback seguro aplicado.</strong> {VIGIA_VISIBLE_NAMES.tenders} no estuvo disponible ({analysisEngine.reason === 'not_configured' ? 'no configurado' : 'servicio no disponible'}); se conservó el preanálisis determinístico por reglas.</div>}
    {statusText && <div className={statusTone === 'error' ? 'error' : 'notice'} role={statusTone === 'error' ? 'alert' : 'status'}>{statusText}</div>}
    <div className="tender-analysis-actions">
      {showAnalysisAction && <button type="button" className="tender-analysis-primary-cta" onClick={onAnalyzePreview} disabled={analysisActionDisabled}>{busy ? 'Procesando…' : actionLabel}</button>}
      {analysis && <small>{tenderAnalysisProducerDisclosure(analysis.producer)}</small>}
    </div>
  </div>;
}
