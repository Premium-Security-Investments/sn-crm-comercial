// Conversar con Vig-IA (AGT-003; nota de campo desde 2026-11-05, conversación desde 2026-11-14: "vamos con esto de una
// vez"). El analista cuenta lo que vio, mensaje por mensaje. En cada turno Vig-IA propone zonas, riesgos y respuestas del
// recorrido guiado, cada cosa con la frase de la nota que la sustenta. La calificación de los riesgos (probabilidad e
// impacto) la pone la persona; nada se guarda sin confirmar. La conversación vive en la pantalla: lo que queda es lo
// confirmado, en el estudio.
import { useState } from 'react';
import {
  IMPACT_SCALE, PROBABILITY_SCALE, PROBABILITY_SCALE_DESCRIBED, confirmFromNote, proposeFromNote,
  type FieldNoteAnswer, type FieldNoteProposal, type FieldNoteRisk, type ProbabilitySuggestions, type Zone,
} from './api';

type Draft = FieldNoteRisk & { selected: boolean; probability: number | null; impact_company: number | null; impact_people: number | null; probability_basis?: string };
type AnswerDraft = FieldNoteAnswer & { selected: boolean };
type Turn = { nota: string; respuesta: string; resultado: string };
const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'Vig-IA no pudo responder.');
const VALUE_WORD: Record<string, string> = { si: 'Sí', no: 'No', na: 'No aplica' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Scale({ label, value, scale, onChange }: { label: string; value: number | null; scale: string[]; onChange: (value: number | null) => void }) {
  return <label>{label}
    <select value={value ?? ''} onChange={event => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">Elija</option>
      {scale.map((name, index) => <option key={name} value={index + 1}>{index + 1} · {name}</option>)}
    </select>
  </label>;
}

export function FieldNotePanel({ studyId, zones, suggestions, onSaved }: { studyId: string; zones: Zone[]; suggestions?: ProbabilitySuggestions; onSaved: () => void }) {
  const [note, setNote] = useState('');
  const [sent, setSent] = useState('');
  const [proposal, setProposal] = useState<FieldNoteProposal | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [answers, setAnswers] = useState<AnswerDraft[]>([]);
  const [history, setHistory] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const propose = async () => {
    setBusy(true); setError('');
    try {
      const result = await proposeFromNote(studyId, note);
      setSent(note);
      setProposal(result);
      setDrafts(result.riesgos.map(risk => ({ ...risk, selected: true, probability: null, impact_company: null, impact_people: null })));
      setAnswers((result.respuestas_recorrido || []).map(answer => ({ ...answer, selected: true })));
      setNote('');
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const chosen = drafts.filter(draft => draft.selected);
  const chosenAnswers = answers.filter(answer => answer.selected);
  // IEC 31010: la probabilidad que sugieren los datos; si el analista se aparta, explica por qué (el servidor lo exige).
  const suggestionFor = (draft: Draft) => (draft.catalog_risk_code ? suggestions?.porCodigo[draft.catalog_risk_code] : suggestions?.propio) ?? null;
  const departs = (draft: Draft) => { const s = suggestionFor(draft); return Boolean(s && draft.probability && draft.probability !== s.probabilidad); };
  const missing = chosen.filter(draft => !draft.probability || !draft.impact_company || (departs(draft) && (draft.probability_basis || '').trim().length < 10)).length;
  const close = (resultado: string) => {
    if (proposal) setHistory(current => [...current, { nota: sent, respuesta: proposal.respuesta, resultado }]);
    setProposal(null); setDrafts([]); setAnswers([]); setSent('');
  };
  const confirm = async () => {
    if (!proposal) return;
    setBusy(true); setError('');
    try {
      const refs = new Set(chosen.map(draft => draft.zone_ref).filter(Boolean));
      const created = await confirmFromNote(studyId, {
        zonas_nuevas: proposal.zonas_nuevas.filter(zone => refs.has(zone.ref)),
        riesgos: chosen.map(({ selected: _selected, ...draft }) => ({ ...draft, probability: draft.probability!, impact_company: draft.impact_company!, impact_people: draft.impact_company! })),
        respuestas_recorrido: chosenAnswers.map(({ selected: _selected, ...answer }) => answer),
      });
      close(`Registrado: ${[
        created.riesgos.length ? plural(created.riesgos.length, 'riesgo', 'riesgos') : '',
        created.zonas.length ? plural(created.zonas.length, 'zona nueva', 'zonas nuevas') : '',
        created.respuestas?.length ? plural(created.respuestas.length, 'respuesta del recorrido', 'respuestas del recorrido') : '',
      ].filter(Boolean).join(', ') || 'nada'}.`);
      onSaved();
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const set = (index: number, patch: Partial<Draft>) => setDrafts(current => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  const setAnswer = (index: number, patch: Partial<AnswerDraft>) => setAnswers(current => current.map((answer, i) => (i === index ? { ...answer, ...patch } : answer)));
  const zoneLabel = (draft: Draft) => draft.zone_id ? zones.find(zone => zone.id === draft.zone_id)?.name || 'Zona'
    : draft.zone_ref ? `${proposal?.zonas_nuevas.find(zone => zone.ref === draft.zone_ref)?.nombre} (zona nueva)` : 'Sin zona';
  const nothing = proposal && !drafts.length && !answers.length;

  return <section className="es-card es-fieldnote" aria-label="Conversar con Vig-IA">
    <h3>Conversar con Vig-IA</h3>
    <p className="es-muted">Cuéntele lo que vio en la visita, por partes si quiere. Vig-IA propone riesgos, zonas y respuestas del recorrido, cada una con la frase suya que la sustenta. Usted califica y confirma; nada se guarda sin confirmar.</p>

    {history.length ? <ol className="es-chat">{history.map((turn, index) => <li key={index}>
      <p className="es-chat-yo"><span className="es-label">Usted:</span> {turn.nota}</p>
      <p className="es-chat-vigia"><span className="es-label">Vig-IA:</span> {turn.respuesta} <em>{turn.resultado}</em></p>
    </li>)}</ol> : null}

    {proposal ? <>
      <p className="es-chat-yo"><span className="es-label">Usted:</span> {sent}</p>
      <p className="es-chat-vigia"><span className="es-label">Vig-IA:</span> <strong>{proposal.respuesta}</strong></p>
      {proposal.avisos.length ? <ul className="es-notices">{proposal.avisos.map(aviso => <li key={aviso}>{aviso}</li>)}</ul> : null}

      {answers.length ? <>
        <h4 className="es-subtitle">Respuestas del recorrido</h4>
        <ul className="es-proposals">{answers.map((answer, index) => <li key={answer.codigo} className={`es-proposal${answer.selected ? '' : ' es-proposal-off'}`}>
          <label className="checkline"><input type="checkbox" checked={answer.selected} onChange={event => setAnswer(index, { selected: event.target.checked })} /> {answer.codigo} · {answer.pregunta}</label>
          <p>
            {answer.tipo === 'verificacion' ? <><span className={`es-nivel es-nivel-${answer.favorable === false ? 'inaceptable' : answer.favorable ? 'aceptable' : 'tolerable'}`}>{VALUE_WORD[answer.value || ''] || '—'}</span>{' '}</> : null}
            {answer.note}
          </p>
          {answer.reemplaza ? <small className="es-muted">Reemplaza la respuesta anterior: {VALUE_WORD[answer.reemplaza.value || ''] || 'análisis'}{answer.reemplaza.note ? ` — ${answer.reemplaza.note}` : ''}.</small> : null}
          <blockquote>“{answer.evidence_quote}”</blockquote>
        </li>)}</ul>
      </> : null}

      {drafts.length ? <>
        <h4 className="es-subtitle">Riesgos</h4>
        <ul className="es-proposals">{drafts.map((draft, index) => <li key={`${draft.title}-${index}`} className={`es-proposal${draft.selected ? '' : ' es-proposal-off'}`}>
          <label className="checkline"><input type="checkbox" checked={draft.selected} onChange={event => set(index, { selected: event.target.checked })} /> Registrar este riesgo</label>
          <label>Riesgo<input value={draft.title} onChange={event => set(index, { title: event.target.value })} maxLength={300} /></label>
          <small className="es-muted">{[draft.catalog_risk_code || 'Riesgo propio', draft.process_code, zoneLabel(draft)].filter(Boolean).join(' · ')}</small>
          {draft.current_control ? <p><span className="es-label">Control existente:</span> {draft.current_control}</p> : null}
          {draft.proposed_control ? <p><span className="es-label">Control propuesto:</span> {draft.proposed_control}</p> : null}
          <blockquote>“{draft.evidence_quote}”</blockquote>
          {draft.selected ? <div className="es-grid-3">
            <Scale label="Probabilidad actual" value={draft.probability} scale={PROBABILITY_SCALE_DESCRIBED} onChange={value => set(index, { probability: value })} />
            <Scale label="Impacto" value={draft.impact_company} scale={IMPACT_SCALE} onChange={value => set(index, { impact_company: value, impact_people: value })} />
          </div> : null}
          {draft.selected && suggestionFor(draft) ? <small className="es-muted">Los datos sugieren {suggestionFor(draft)!.probabilidad} · {PROBABILITY_SCALE[suggestionFor(draft)!.probabilidad - 1]} ({suggestionFor(draft)!.fuente}).</small> : null}
          {draft.selected && departs(draft) ? <label>Por qué esta probabilidad (se aparta de la sugerida)<textarea rows={2} value={draft.probability_basis || ''} onChange={event => set(index, { probability_basis: event.target.value })} maxLength={1000} /></label> : null}
        </li>)}</ul>
      </> : null}

      {nothing ? <p className="es-muted">Vig-IA no encontró nada para proponer en este mensaje.</p> : null}
      <div className="es-actions">
        {!nothing ? <button type="button" onClick={confirm} disabled={busy || (!chosen.length && !chosenAnswers.length) || missing > 0}>{busy ? 'Guardando…' : 'Confirmar lo marcado'}</button> : null}
        <button type="button" className="secondary" onClick={() => close(nothing ? 'Sin propuestas.' : 'Descartado.')} disabled={busy}>{nothing ? 'Seguir' : 'Descartar'}</button>
        {missing ? <small className="es-muted">Falta calificar {plural(missing, 'riesgo', 'riesgos')}.</small> : null}
      </div>
    </> : <>
      <textarea rows={4} value={note} onChange={event => setNote(event.target.value)} maxLength={4000} aria-label="Mensaje para Vig-IA"
        placeholder={history.length ? 'Siga contando: otra zona, otro hallazgo…' : 'Ej.: En la bodega 3 la malla del costado norte está rota y no hay cámara; el vigilante hace ronda cada 2 horas.'} />
      <div className="es-actions"><button type="button" onClick={propose} disabled={busy || note.trim().length < 10}>{busy ? 'Vig-IA está leyendo…' : 'Enviar'}</button></div>
    </>}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
  </section>;
}
