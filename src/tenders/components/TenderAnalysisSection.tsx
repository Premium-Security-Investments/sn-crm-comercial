import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import { normalizeTenderEvidence, tenderAnalysisMethodLabel, tenderAnalysisProducerDisclosure, tenderDecisionStatusTone, tenderNextAction } from '../tenderDecisionBrief';
import { tenderRecommendationLabel } from '../tenderDecisionGate';
import { deriveTenderProcessingPresentation } from '../processingStatus';
import { tenderBriefUnavailableCopy } from '../tenderDecisionBriefModel';
import type { TenderAnalysisFinding, TenderDocumentAnalysis, TenderDocumentRecord, TenderDocumentsPayload, TenderProcessingStatus, TenderQuestionResponse, TenderQuestionResponseInput } from '../types';
import { TenderFindingEvidence } from './TenderFindingEvidence';
import { QuestionResponseCard, type NormalizedQuestion } from './TenderQuestionResponseCard';

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

export function TenderAnalysisSection({ analysis, documents, busy, canRunPreview, onAnalyzePreview, statusText = '', statusTone = 'status', analysisEngine, questionResponses = [], canAnswerQuestions = false, onSaveQuestionResponse, processingStatus = null, onRetryProcessing }: TenderAnalysisSectionProps) {
  const strengths = analysis?.strengths ?? analysis?.commercial_fit?.positives ?? [];
  const weaknesses = analysis?.weaknesses ?? analysis?.blockers ?? analysis?.commercial_fit?.concerns ?? [];
  const questions = (analysis?.questions ?? []).map(normalizeQuestion);
  const unverified = analysis?.unverified ?? analysis?.company_profile_crosscheck?.gaps ?? [];
  const hasIntegralV3 = Boolean(analysis?.integral_analysis?.analysis_units?.length);
  const decisionQuestions = (analysis?.decision_review?.decision_questions || []).map(entry => ({ id: entry.id, text: entry.label, critical: true, evidenceRefs: [] as string[], rationale: entry.rationale, finding: entry }));
  const hasDocuments = documents.length > 0;
  const failed = analysis?.status === 'failed';
  const stale = Boolean(analysis && !analysis.current);
  const processingPresentation = deriveTenderProcessingPresentation(processingStatus, analysis);
  const state = !hasDocuments ? 'Pendiente' : failed ? 'Análisis fallido' : stale ? 'Análisis desactualizado' : !analysis ? 'Pendiente' : 'Análisis vigente';
  const actionLabel = failed || stale ? `Volver a analizar con ${VIGIA_VISIBLE_NAMES.tenders}` : analysis ? `Actualizar con ${VIGIA_VISIBLE_NAMES.tenders}` : `Analizar con ${VIGIA_VISIBLE_NAMES.tenders}`;
  const analysisActionDisabled = busy || !hasDocuments || processingPresentation.primaryAction === 'disabled';
  const showAnalysisAction = canRunPreview && processingPresentation.primaryAction !== 'hidden';
  const unavailable = tenderBriefUnavailableCopy();
  return <section id="tender-analysis" className={`tender-analysis-section tender-detail-anchor${hasIntegralV3 ? ' is-v3-compact' : ''}`} aria-labelledby={hasIntegralV3 ? 'tender-v3-questions-title' : 'tender-analysis-title'}>
    {!hasIntegralV3 && <header className="tender-analysis-header"><div><span className="eyebrow">Paso previo a la decisión humana</span><h3 id="tender-analysis-title">Análisis con {VIGIA_VISIBLE_NAMES.tenders}</h3><p>Organiza la evidencia disponible y señala pendientes. No registra ni autoriza GO / NO GO.</p></div><div className={`tender-analysis-state state-${failed ? 'failed' : stale ? 'stale' : analysis ? 'ready' : 'pending'}`}><strong>{state}</strong></div></header>}
    {!hasDocuments && <div className="document-empty-state"><strong>Sin documentos</strong><span>Actualice o cargue documentos antes de analizar con {VIGIA_VISIBLE_NAMES.tenders}.</span></div>}
    {hasDocuments && !analysis && !processingPresentation.visible && <div className="document-empty-state"><strong>Análisis pendiente</strong><span>Hay documentos vigentes, pero todavía no existe una conclusión preliminar para revisar.</span></div>}
    {processingPresentation.visible && <div className={processingPresentation.tone === 'error' ? 'error' : 'notice'} role={processingPresentation.tone === 'error' ? 'alert' : 'status'}>
      <p>{processingPresentation.message}</p>
      {processingPresentation.showRetry && <button type="button" disabled={busy} onClick={onRetryProcessing}>Reintentar</button>}
    </div>}
    {failed && <div className="error" role="alert"><strong>Análisis fallido.</strong> El último intento no produjo una conclusión utilizable. Puede intentarlo nuevamente sin afectar la decisión humana.</div>}
    {stale && <div className="notice" role="status"><strong>Análisis desactualizado.</strong> El contenido histórico se conserva para trazabilidad, pero los documentos vigentes cambiaron.</div>}
    {!hasIntegralV3 && analysis && analysis.status !== 'failed' && <article className="tender-decision-brief" aria-label="Conclusión preliminar de licitación">
      <header className="tender-decision-brief-head"><div><small>Recomendación preliminar</small><strong>{tenderRecommendationLabel(analysis.recommendation)}</strong><p>{analysis.summary || 'Sin resumen documental disponible.'}</p></div><div className="tender-decision-brief-status"><span className={`badge badge-${tenderDecisionStatusTone(analysis.recommendation)}`}>{analysis.current ? 'Vigente' : 'Obsoleto'}</span><span>{tenderAnalysisMethodLabel(analysis.producer)}</span><small>{analysis.completed_at ? `Actualizado: ${new Date(analysis.completed_at).toLocaleString('es-CO')}` : analysis.generated_at ? `Generado: ${new Date(analysis.generated_at).toLocaleString('es-CO')}` : 'Fecha no informada'}</small></div></header>
      <div className="tender-decision-brief-grid"><section><h4>Fortalezas</h4><EvidenceList items={strengths} empty="Sin fortalezas documentales registradas."/></section><section><h4>Debilidades y bloqueadores</h4><EvidenceList items={weaknesses} empty="Sin debilidades o bloqueadores documentales registrados."/></section><section className="tender-question-responses"><h4>Dudas abiertas</h4>{questions.length ? <div className="tender-question-list">{questions.map(question => <QuestionResponseCard key={question.id} question={question} analysisRunId={analysis.run_id} responses={questionResponses.filter(item => item.question_id === question.id)} canAnswer={canAnswerQuestions} disabled={busy} onSave={onSaveQuestionResponse}/>)}</div> : <p className="muted">Sin dudas abiertas registradas.</p>}</section><section><h4>Información no verificada</h4><EvidenceList items={unverified} empty="Sin información no verificada registrada."/></section><section className="tender-decision-next-action"><h4>Siguiente acción</h4><p>{tenderNextAction(analysis.next_action) || 'Sin siguiente acción documentada; revisar el expediente con Licitaciones.'}</p></section></div>
    </article>}
    {hasIntegralV3 && analysis && !analysis.decision_review && <section className="tender-v3-questions tender-executive-pending" aria-labelledby="tender-v3-questions-title">
      <header><div><span className="eyebrow">Lectura para decisión</span><h3 id="tender-v3-questions-title">Clasificación ejecutiva no disponible</h3><p>{unavailable.body} Hay {questions.length} hallazgos técnicos conservados en la trazabilidad. Hasta que su materialidad sea clasificada, no se presentan como alertas materiales ni requieren respuesta indiscriminada.</p></div><strong>Revisión material pendiente</strong></header>
      <p className="notice" role="status">{unavailable.impedimentNote}</p>
    </section>}
    {hasIntegralV3 && analysis && analysis.decision_review && <section className="tender-v3-questions" aria-labelledby="tender-v3-questions-title">
      <header><div><span className="eyebrow">Validación humana</span><h3 id="tender-v3-questions-title">Condiciones pendientes de validar</h3><p>Aquí sólo se responden las alertas materiales y se consulta evidencia. El brief de decisión está en la sección Decisión.</p></div></header>
      {decisionQuestions.length ? <div className="tender-question-list">{decisionQuestions.map(question => <article key={question.id} className="tender-decision-review-question"><p className="tender-decision-review-rationale">{question.rationale}</p>{analysis.decision_review && <TenderFindingEvidence finding={question.finding} review={analysis.decision_review} />}<QuestionResponseCard question={question} analysisRunId={analysis.run_id} responses={questionResponses.filter(item => item.question_id === question.id)} canAnswer={canAnswerQuestions} disabled={busy} onSave={onSaveQuestionResponse} criticalLabel="Alerta material"/></article>)}</div> : <p className="muted">Sin condiciones pendientes de validar.</p>}
    </section>}
    {analysisEngine?.fallback && <div className="notice" role="status"><strong>Fallback seguro aplicado.</strong> {VIGIA_VISIBLE_NAMES.tenders} no estuvo disponible ({analysisEngine.reason === 'not_configured' ? 'no configurado' : 'servicio no disponible'}); se conservó el preanálisis determinístico por reglas.</div>}
    {statusText && <div className={statusTone === 'error' ? 'error' : 'notice'} role={statusTone === 'error' ? 'alert' : 'status'}>{statusText}</div>}
    <div className="tender-analysis-actions">
      {showAnalysisAction && <button type="button" className="tender-analysis-primary-cta" onClick={onAnalyzePreview} disabled={analysisActionDisabled}>{busy ? 'Procesando…' : actionLabel}</button>}
      {analysis && <small>{tenderAnalysisProducerDisclosure(analysis.producer)}</small>}
    </div>
  </section>;
}
