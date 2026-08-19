import { useState, type FormEvent } from 'react';
import { TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT } from '../tenderQuestionResponseActions';
import type { TenderQuestionResponse, TenderQuestionResponseAttachment, TenderQuestionResponseInput, TenderQuestionResponseStatus } from '../types';

export type NormalizedQuestion = { id: string; text: string; critical: boolean; evidenceRefs: string[] };

const questionStatusLabel = (status: TenderQuestionResponseStatus) => status === 'resolved' ? 'Resuelta' : status === 'not_applicable' ? 'No aplica' : 'Pendiente';
const responseDate = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function AttachmentLinks({ attachments }: { attachments: TenderQuestionResponseAttachment[] }) {
  if (!attachments.length) return null;
  return <ul className="tender-question-attachments">{attachments.map(attachment => <li key={attachment.id}>{attachment.signed_url ? <a href={attachment.signed_url} target="_blank" rel="noreferrer">{attachment.name}</a> : attachment.name}</li>)}</ul>;
}

export function QuestionResponseCard({ question, analysisRunId, responses, canAnswer, disabled, onSave, criticalLabel = 'Crítica' }: {
  question: NormalizedQuestion;
  analysisRunId: string;
  responses: TenderQuestionResponse[];
  canAnswer: boolean;
  disabled: boolean;
  onSave?: (input: TenderQuestionResponseInput, files: File[]) => Promise<void>;
  criticalLabel?: string;
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
  const submit = async (event: FormEvent) => {
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
    <header><div><strong>{question.text}</strong>{question.critical && <span className="badge badge-red">{criticalLabel}</span>}</div><span className={`tender-question-status status-${latest?.status || 'pending'}`}>{questionStatusLabel(latest?.status || 'pending')}</span></header>
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
