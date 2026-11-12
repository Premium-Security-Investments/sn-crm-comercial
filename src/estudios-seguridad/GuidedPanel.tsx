// Estudios de Seguridad Física: recorrido guiado (migración 214; Juan, 2026-11-12). Lista de verificación por área y
// escenarios "¿qué pasaría si…?" (IEC 31010). Cada "no" favorable es una vulnerabilidad con su contramedida; con las
// respuestas la plataforma propone riesgos de la lista base, que el analista lleva al estudio y califica.
import { useState } from 'react';
import { saveGuidedAnswer, type Guided, type GuidedProposal, type GuidedQuestion, type RiskDraft } from './api';

const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'No se pudo guardar.');
const CHOICES: Array<{ value: 'si' | 'no' | 'na'; label: string }> = [{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }, { value: 'na', label: 'No aplica' }];

function Question({ studyId, question, editable, onSaved, onError }: { studyId: string; question: GuidedQuestion; editable: boolean; onSaved: () => void; onError: (text: string) => void }) {
  const [note, setNote] = useState(question.nota || '');
  const [busy, setBusy] = useState(false);
  const save = async (value: GuidedQuestion['respuesta'], text: string) => {
    setBusy(true);
    try { await saveGuidedAnswer(studyId, question.codigo, { value, note: text.trim() || null }); onSaved(); } catch (reason) { onError(message(reason)); } finally { setBusy(false); }
  };
  const weak = question.tipo === 'verificacion' && question.respuesta && question.respuesta !== 'na' && question.respuesta !== question.favorable;
  return <li className={`es-guided-q${weak ? ' es-guided-weak' : ''}`}>
    <span>{question.texto} <small className="es-muted">· sale de: {question.fuente}</small></span>
    {question.tipo === 'verificacion' ? <div className="es-guided-choices" role="radiogroup" aria-label={question.texto}>
      {CHOICES.map(choice => <button key={choice.value} type="button" role="radio" aria-checked={question.respuesta === choice.value} disabled={!editable || busy}
        className={question.respuesta === choice.value ? 'es-guided-on' : 'secondary'} onClick={() => void save(question.respuesta === choice.value ? null : choice.value, note)}>{choice.label}</button>)}
    </div> : null}
    {editable ? <input value={note} onChange={event => setNote(event.target.value)} onBlur={() => { if ((question.nota || '') !== note.trim()) void save(question.respuesta, note); }} maxLength={2000}
      placeholder={question.tipo === 'escenario' ? 'Su análisis: quién lo detecta, en cuánto tiempo, qué control lo frena…' : 'Observación (opcional)'} aria-label={`Observación: ${question.texto}`} />
      : question.nota ? <small className="es-muted">{question.nota}</small> : null}
  </li>;
}

export function GuidedPanel({ studyId, guided, editable, onChanged, onUseAsRisk }: { studyId: string; guided: Guided; editable: boolean; onChanged: () => void; onUseAsRisk: (draft: RiskDraft) => void }) {
  const [error, setError] = useState('');
  if (!guided.available || !guided.areas) return null;
  const proposals = guided.propuestas || [];
  const use = (item: GuidedProposal) => onUseAsRisk({ catalog_risk_code: item.codigo, title: item.nombre, causes: item.causas, current_control: item.control_existente, proposed_control: item.control_propuesto });
  return <section className="es-card es-guided" aria-label="Recorrido guiado">
    <div className="es-section-head">
      <h3>Recorrido guiado</h3>
      <span className="es-muted">{guided.respondidas} de {guided.total} respondidas</span>
    </div>
    <p className="es-muted">Lista de verificación y escenarios "¿qué pasaría si…?" de la norma IEC 31010. Cada respuesta débil queda como causa y propone una contramedida; usted decide qué llevar al estudio y lo califica.</p>
    {guided.areas.map(area => <details key={area.codigo}>
      <summary>{area.nombre} <small className="es-muted">· {area.respondidas} de {area.preguntas.length}</small></summary>
      <ul className="es-guided-list">{area.preguntas.map(question => <Question key={question.codigo} studyId={studyId} question={question} editable={editable} onSaved={onChanged} onError={setError} />)}</ul>
    </details>)}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
    {proposals.length ? <>
      <span className="es-label">Riesgos que sugieren las respuestas</span>
      <ul className="es-secops-list">{proposals.map(item => <li key={item.codigo}>
        <strong>{item.codigo} · {item.nombre}</strong> <small className="es-muted">· {item.vulnerabilidades} {item.vulnerabilidades === 1 ? 'vulnerabilidad' : 'vulnerabilidades'}{item.escenarios.length ? ` · ${item.escenarios.length} escenario(s)` : ''}</small>
        {item.causas ? <p>{item.causas}</p> : null}
        {item.ya_en_estudio ? <small className="es-muted">Ya está en el estudio como R{item.ya_en_estudio}.</small>
          : editable ? <button type="button" className="es-link" onClick={() => use(item)}>Llevar al estudio</button> : null}
      </li>)}</ul>
    </> : null}
  </section>;
}
