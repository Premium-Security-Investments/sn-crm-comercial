import { useState } from 'react';
import { normalizeTenderEvidence, tenderAnalysisMethodLabel, tenderAnalysisProducerDisclosure, tenderDecisionStatusTone, tenderNextAction } from '../tenderDecisionBrief';
import { tenderRecommendationLabel } from '../tenderDecisionGate';
import type { TenderAnalysisFinding, TenderDocumentAnalysis, TenderDocumentRecord, TenderDocumentsPayload, TenderQuestionResponse, TenderQuestionResponseInput, TenderQuestionResponseStatus } from '../types';

type TenderAnalysisSectionProps = {
  analysis: TenderDocumentAnalysis | null;
  documents: TenderDocumentRecord[];
  busy: boolean;
  canRunPreview: boolean;
  onAnalyzePreview: () => void;
  analysisEngine?: TenderDocumentsPayload['analysis_engine'];
  questionResponses?: TenderQuestionResponse[];
  canAnswerQuestions?: boolean;
  onSaveQuestionResponse?: (input: TenderQuestionResponseInput) => Promise<void>;
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

function QuestionResponseCard({ question, analysisRunId, responses, canAnswer, disabled, onSave }: {
  question: NormalizedQuestion;
  analysisRunId: string;
  responses: TenderQuestionResponse[];
  canAnswer: boolean;
  disabled: boolean;
  onSave?: (input: TenderQuestionResponseInput) => Promise<void>;
}) {
  const latest = responses[0];
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<TenderQuestionResponseStatus>(latest?.status || 'pending');
  const [response, setResponse] = useState(latest?.response || '');
  const [evidence, setEvidence] = useState(latest?.evidence_notes || '');
  const [error, setError] = useState('');
  const beginEdit = () => {
    setStatus(latest?.status || 'pending');
    setResponse(latest?.response || '');
    setEvidence(latest?.evidence_notes || '');
    setError('');
    setEditing(true);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!response.trim() || !onSave) return;
    setSaving(true); setError('');
    try {
      await onSave({ analysis_run_id: analysisRunId, question_id: question.id, question_text: question.text, status, response: response.trim(), evidence_notes: evidence.trim() || null });
      setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  return <article className="tender-question-response-card">
    <header><div><strong>{question.text}</strong>{question.critical && <span className="badge badge-red">Crítica</span>}</div><span className={`tender-question-status status-${latest?.status || 'pending'}`}>{questionStatusLabel(latest?.status || 'pending')}</span></header>
    {question.evidenceRefs.length > 0 && <small className="muted">Referencias: {question.evidenceRefs.join(', ')}</small>}
    {latest ? <div className="tender-question-current"><p>{latest.response}</p>{latest.evidence_notes && <small><strong>Evidencia o notas:</strong> {latest.evidence_notes}</small>}<small>{latest.responded_by_name || 'Persona registrada'} · {responseDate(latest.responded_at)}</small></div> : <p className="muted">Aún no hay respuesta humana registrada.</p>}
    {!editing && canAnswer && <button type="button" className="secondary" disabled={disabled} onClick={beginEdit}>{latest ? 'Actualizar respuesta' : 'Responder duda'}</button>}
    {editing && <form className="tender-question-form" onSubmit={submit}>
      <label>Estado<select value={status} onChange={event => setStatus(event.target.value as TenderQuestionResponseStatus)}><option value="pending">Pendiente</option><option value="resolved">Resuelta</option><option value="not_applicable">No aplica</option></select></label>
      <label>Respuesta<textarea required maxLength={10000} value={response} onChange={event => setResponse(event.target.value)} placeholder="Registre la respuesta de Licitaciones…"/></label>
      <label>Evidencia o notas (opcional)<textarea maxLength={5000} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Documento, enlace, folio o contexto de soporte…"/></label>
      <small>El autor y la fecha se registran automáticamente desde la sesión. No autoriza GO / NO GO.</small>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row-actions"><button type="submit" disabled={saving || disabled || !response.trim()}>{saving ? 'Guardando…' : 'Guardar respuesta'}</button><button type="button" className="secondary" disabled={saving} onClick={() => setEditing(false)}>Cancelar</button></div>
    </form>}
    {responses.length > 1 && <details className="tender-question-history"><summary>Historial de respuestas ({responses.length})</summary><ol>{responses.map(item => <li key={item.id}><strong>{questionStatusLabel(item.status)}</strong><p>{item.response}</p>{item.evidence_notes && <small>Evidencia o notas: {item.evidence_notes}</small>}<small>{item.responded_by_name || 'Persona registrada'} · {responseDate(item.responded_at)}</small></li>)}</ol></details>}
  </article>;
}

export function TenderAnalysisSection({ analysis, documents, busy, canRunPreview, onAnalyzePreview, analysisEngine, questionResponses = [], canAnswerQuestions = false, onSaveQuestionResponse }: TenderAnalysisSectionProps) {
  const strengths = analysis?.strengths ?? analysis?.commercial_fit?.positives ?? [];
  const weaknesses = analysis?.weaknesses ?? analysis?.blockers ?? analysis?.commercial_fit?.concerns ?? [];
  const questions = (analysis?.questions ?? []).map(normalizeQuestion);
  const unverified = analysis?.unverified ?? analysis?.company_profile_crosscheck?.gaps ?? [];
  const hasDocuments = documents.length > 0;
  const failed = analysis?.status === 'failed';
  const stale = Boolean(analysis && !analysis.current);
  const state = !hasDocuments ? 'Sin documentos' : failed ? 'Análisis fallido' : stale ? 'Análisis desactualizado' : !analysis ? 'Análisis pendiente' : 'Análisis vigente';
  const actionLabel = failed || stale ? 'Volver a analizar con Vig-IA' : analysis ? 'Actualizar con Vig-IA' : 'Analizar con Vig-IA';
  const citedEvidence = [...new Set([analysis?.strengths, analysis?.weaknesses, analysis?.blockers, analysis?.questions, analysis?.unverified]
    .flatMap(items => Array.isArray(items) ? items : [])
    .flatMap(item => typeof item === 'object' && item && Array.isArray(item.evidence_refs) ? item.evidence_refs : []))];

  return <section id="tender-analysis" className="tender-analysis-section tender-detail-anchor" aria-labelledby="tender-analysis-title">
    <header className="tender-analysis-header"><div><span className="eyebrow">Paso previo a la decisión humana</span><h3 id="tender-analysis-title">Análisis con Vig-IA</h3><p>Organiza la evidencia disponible y señala pendientes. No registra ni autoriza GO / NO GO.</p></div><div className={`tender-analysis-state state-${failed ? 'failed' : stale ? 'stale' : analysis ? 'ready' : 'pending'}`}><strong>{state}</strong>{analysis && <span>{tenderAnalysisMethodLabel(analysis.producer)}</span>}</div></header>
    {!hasDocuments && <div className="document-empty-state"><strong>Sin documentos</strong><span>Actualice o cargue documentos antes de analizar con Vig-IA.</span></div>}
    {hasDocuments && !analysis && <div className="document-empty-state"><strong>Análisis pendiente</strong><span>Hay documentos vigentes, pero todavía no existe una conclusión preliminar para revisar.</span></div>}
    {failed && <div className="error" role="alert"><strong>Análisis fallido.</strong> El último intento no produjo una conclusión utilizable. Puede intentarlo nuevamente sin afectar la decisión humana.</div>}
    {stale && <div className="notice" role="status"><strong>Análisis desactualizado.</strong> El contenido histórico se conserva para trazabilidad, pero los documentos vigentes cambiaron.</div>}
    {analysis && analysis.status !== 'failed' && <article className="tender-decision-brief" aria-label="Conclusión preliminar de licitación">
      <header className="tender-decision-brief-head"><div><small>Recomendación preliminar</small><strong>{tenderRecommendationLabel(analysis.recommendation)}</strong><p>{analysis.summary || 'Sin resumen documental disponible.'}</p></div><div className="tender-decision-brief-status"><span className={`badge badge-${tenderDecisionStatusTone(analysis.recommendation)}`}>{analysis.current ? 'Vigente' : 'Obsoleto'}</span><span>{tenderAnalysisMethodLabel(analysis.producer)}</span><small>{analysis.completed_at ? `Actualizado: ${new Date(analysis.completed_at).toLocaleString('es-CO')}` : analysis.generated_at ? `Generado: ${new Date(analysis.generated_at).toLocaleString('es-CO')}` : 'Fecha no informada'}</small></div></header>
      <div className="tender-decision-brief-grid"><section><h4>Fortalezas</h4><EvidenceList items={strengths} empty="Sin fortalezas documentales registradas."/></section><section><h4>Debilidades y bloqueadores</h4><EvidenceList items={weaknesses} empty="Sin debilidades o bloqueadores documentales registrados."/></section><section className="tender-question-responses"><h4>Dudas abiertas</h4>{questions.length ? <div className="tender-question-list">{questions.map(question => <QuestionResponseCard key={question.id} question={question} analysisRunId={analysis.run_id} responses={questionResponses.filter(item => item.question_id === question.id)} canAnswer={canAnswerQuestions} disabled={busy} onSave={onSaveQuestionResponse}/>)}</div> : <p className="muted">Sin dudas abiertas registradas.</p>}</section><section><h4>Información no verificada</h4><EvidenceList items={unverified} empty="Sin información no verificada registrada."/></section><section className="tender-decision-next-action"><h4>Siguiente acción</h4><p>{tenderNextAction(analysis.next_action) || 'Sin siguiente acción documentada; revisar el expediente con Licitaciones.'}</p></section></div>
      <details className="tender-decision-brief-help"><summary>Cómo funciona</summary><p>Esta conclusión preliminar organiza únicamente la evidencia disponible. No autoriza GO / NO GO; una persona con permiso formal debe tomar esa decisión.</p></details>
      {citedEvidence.length > 0 && <details className="tender-decision-brief-help"><summary>Citas de evidencia ({citedEvidence.length})</summary><ul>{citedEvidence.map(reference => <li key={reference}><code>{reference}</code></li>)}</ul></details>}
    </article>}
    {analysisEngine?.fallback && <div className="notice" role="status"><strong>Fallback seguro aplicado.</strong> Vig-IA no estuvo disponible ({analysisEngine.reason === 'not_configured' ? 'no configurado' : 'servicio no disponible'}); se conservó el preanálisis determinístico por reglas.</div>}
    {analysisEngine?.used === 'AGT-002' && <div className="notice" role="status"><strong>Revisión humana obligatoria.</strong> Vig-IA produjo una recomendación preliminar{analysisEngine.reused ? ' reutilizada por idempotencia' : ''}; no autoriza GO / NO GO.</div>}
    <div className="tender-analysis-actions">
      {canRunPreview && <button type="button" className="tender-analysis-primary-cta" onClick={onAnalyzePreview} disabled={busy || !hasDocuments}>{busy ? 'Procesando…' : actionLabel}</button>}
      {analysis && <small>Productor real: {tenderAnalysisMethodLabel(analysis.producer)} · {tenderAnalysisProducerDisclosure(analysis.producer)}</small>}
    </div>
    {canRunPreview && <details className="tender-analysis-technical"><summary>Detalles técnicos y auditoría (Vig-IA)</summary><p>Vig-IA se ejecuta mediante el motor AGT-002 con revisión humana obligatoria. Nombre técnico de esta acción para auditoría: «Ejecutar AGT-002 Preview».</p></details>}
  </section>;
}
