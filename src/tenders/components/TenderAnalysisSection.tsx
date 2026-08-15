import { useState } from 'react';
import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import { normalizeTenderEvidence, tenderAnalysisMethodLabel, tenderAnalysisProducerDisclosure, tenderDecisionStatusTone, tenderNextAction } from '../tenderDecisionBrief';
import { tenderRecommendationLabel } from '../tenderDecisionGate';
import { deriveTenderProcessingPresentation } from '../processingStatus';
import type { TenderAnalysisFinding, TenderDocumentAnalysis, TenderDocumentRecord, TenderDocumentsPayload, TenderProcessingStatus, TenderQuestionResponse, TenderQuestionResponseAttachment, TenderQuestionResponseInput, TenderQuestionResponseStatus } from '../types';
import { TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT } from '../tenderQuestionResponseActions';

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

type NormalizedQuestion = { id: string; text: string; critical: boolean; evidenceRefs: string[] };

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

const questionStatusLabel = (status: TenderQuestionResponseStatus) => status === 'resolved' ? 'Resuelta' : status === 'not_applicable' ? 'No aplica' : 'Pendiente';
const responseDate = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function AttachmentLinks({ attachments }: { attachments: TenderQuestionResponseAttachment[] }) {
  if (!attachments.length) return null;
  return <ul className="tender-question-attachments">{attachments.map(attachment => <li key={attachment.id}>{attachment.signed_url ? <a href={attachment.signed_url} target="_blank" rel="noreferrer">{attachment.name}</a> : attachment.name}</li>)}</ul>;
}

function QuestionResponseCard({ question, analysisRunId, responses, canAnswer, disabled, onSave }: {
  question: NormalizedQuestion;
  analysisRunId: string;
  responses: TenderQuestionResponse[];
  canAnswer: boolean;
  disabled: boolean;
  onSave?: (input: TenderQuestionResponseInput, files: File[]) => Promise<void>;
}) {
  const latest = responses[0];
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<TenderQuestionResponseStatus>(latest?.status || 'pending');
  const [response, setResponse] = useState(latest?.response || '');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const beginEdit = () => {
    setStatus(latest?.status || 'pending');
    setResponse(latest?.response || '');
    setFiles([]);
    setError('');
    setEditing(true);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!response.trim() || !onSave) return;
    setSaving(true); setError('');
    try {
      await onSave({ analysis_run_id: analysisRunId, question_id: question.id, question_text: question.text, status, response: response.trim() }, files);
      setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  return <article className="tender-question-response-card">
    <header><div><strong>{question.text}</strong>{question.critical && <span className="badge badge-red">Crítica</span>}</div><span className={`tender-question-status status-${latest?.status || 'pending'}`}>{questionStatusLabel(latest?.status || 'pending')}</span></header>
    {latest ? <div className="tender-question-current"><p>{latest.response}</p><AttachmentLinks attachments={latest.attachments} /><small>{latest.responded_by_name || 'Persona registrada'} · {responseDate(latest.responded_at)}</small></div> : <p className="muted">Aún no hay respuesta humana registrada.</p>}
    {!editing && canAnswer && <button type="button" className="secondary" disabled={disabled} onClick={beginEdit}>{latest ? 'Actualizar respuesta' : 'Responder duda'}</button>}
    {editing && <form className="tender-question-form" onSubmit={submit}>
      <label>Estado<select value={status} onChange={event => setStatus(event.target.value as TenderQuestionResponseStatus)}><option value="pending">Pendiente</option><option value="resolved">Resuelta</option><option value="not_applicable">No aplica</option></select></label>
      <label>Respuesta<textarea required maxLength={10000} value={response} onChange={event => setResponse(event.target.value)} placeholder="Registre la respuesta de Licitaciones…"/></label>
      <label>Archivos de soporte (opcional)<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain" onChange={event => setFiles(Array.from(event.target.files || []).slice(0, TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT))}/></label>
      {files.length > 0 && <ul className="tender-question-attachments-selected">{files.map(file => <li key={file.name}>{file.name}</li>)}</ul>}
      <small>El autor y la fecha se registran automáticamente desde la sesión. No autoriza GO / NO GO.</small>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row-actions"><button type="submit" disabled={saving || disabled || !response.trim()}>{saving ? 'Guardando…' : 'Guardar respuesta'}</button><button type="button" className="secondary" disabled={saving} onClick={() => setEditing(false)}>Cancelar</button></div>
    </form>}
    {responses.length > 1 && <details className="tender-question-history"><summary>Historial de respuestas ({responses.length})</summary><ol>{responses.map(item => <li key={item.id}><strong>{questionStatusLabel(item.status)}</strong><p>{item.response}</p><AttachmentLinks attachments={item.attachments} /><small>{item.responded_by_name || 'Persona registrada'} · {responseDate(item.responded_at)}</small></li>)}</ol></details>}
  </article>;
}

export function TenderAnalysisSection({ analysis, documents, busy, canRunPreview, onAnalyzePreview, statusText = '', statusTone = 'status', analysisEngine, questionResponses = [], canAnswerQuestions = false, onSaveQuestionResponse, processingStatus = null, onRetryProcessing }: TenderAnalysisSectionProps) {
  const strengths = analysis?.strengths ?? analysis?.commercial_fit?.positives ?? [];
  const weaknesses = analysis?.weaknesses ?? analysis?.blockers ?? analysis?.commercial_fit?.concerns ?? [];
  const questions = (analysis?.questions ?? []).map(normalizeQuestion);
  const unverified = analysis?.unverified ?? analysis?.company_profile_crosscheck?.gaps ?? [];
  const hasIntegralV3 = Boolean(analysis?.integral_analysis?.analysis_units?.length);
  const hasDocuments = documents.length > 0;
  const failed = analysis?.status === 'failed';
  const stale = Boolean(analysis && !analysis.current);
  const processingPresentation = deriveTenderProcessingPresentation(processingStatus, analysis);
  const state = !hasDocuments ? 'Pendiente' : failed ? 'Análisis fallido' : stale ? 'Análisis desactualizado' : !analysis ? 'Pendiente' : 'Análisis vigente';
  const actionLabel = failed || stale ? `Volver a analizar con ${VIGIA_VISIBLE_NAMES.tenders}` : analysis ? `Actualizar con ${VIGIA_VISIBLE_NAMES.tenders}` : `Analizar con ${VIGIA_VISIBLE_NAMES.tenders}`;
  const analysisActionDisabled = busy || !hasDocuments || processingPresentation.primaryAction === 'disabled';
  const showAnalysisAction = canRunPreview && processingPresentation.primaryAction !== 'hidden';
  return <section id="tender-analysis" className={`tender-analysis-section tender-detail-anchor${hasIntegralV3 ? ' is-v3-compact' : ''}`} aria-labelledby={hasIntegralV3 ? undefined : 'tender-analysis-title'} aria-label={hasIntegralV3 ? 'Acciones del análisis integral' : undefined}>
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
    {analysisEngine?.fallback && <div className="notice" role="status"><strong>Fallback seguro aplicado.</strong> {VIGIA_VISIBLE_NAMES.tenders} no estuvo disponible ({analysisEngine.reason === 'not_configured' ? 'no configurado' : 'servicio no disponible'}); se conservó el preanálisis determinístico por reglas.</div>}
    {statusText && <div className={statusTone === 'error' ? 'error' : 'notice'} role={statusTone === 'error' ? 'alert' : 'status'}>{statusText}</div>}
    <div className="tender-analysis-actions">
      {showAnalysisAction && <button type="button" className="tender-analysis-primary-cta" onClick={onAnalyzePreview} disabled={analysisActionDisabled}>{busy ? 'Procesando…' : actionLabel}</button>}
      {analysis && <small>{tenderAnalysisProducerDisclosure(analysis.producer)}</small>}
    </div>
  </section>;
}
