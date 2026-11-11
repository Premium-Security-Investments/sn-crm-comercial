// Nota de campo con Vig-IA (AGT-003): el inspector cuenta lo que vio y Vig-IA propone zonas y riesgos con su texto.
// La calificación (probabilidad e impactos) la pone la persona aquí antes de confirmar; nada se guarda sin confirmar.
import { useState } from 'react';
import { IMPACT_SCALE, PROBABILITY_SCALE, PROBABILITY_SCALE_DESCRIBED, confirmFromNote, proposeFromNote, type FieldNoteProposal, type FieldNoteRisk, type ProbabilitySuggestions, type Zone } from './api';

type Draft = FieldNoteRisk & { selected: boolean; probability: number | null; impact_company: number | null; impact_people: number | null; probability_basis?: string };
const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'Vig-IA no pudo responder.');

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
  const [proposal, setProposal] = useState<FieldNoteProposal | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const propose = async () => {
    setBusy(true); setError(''); setDone('');
    try {
      const result = await proposeFromNote(studyId, note);
      setProposal(result);
      setDrafts(result.riesgos.map(risk => ({ ...risk, selected: true, probability: null, impact_company: null, impact_people: null })));
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const chosen = drafts.filter(draft => draft.selected);
  // IEC 31010: la probabilidad que sugieren los datos; si el analista se aparta, explica por qué (el servidor lo exige).
  const suggestionFor = (draft: Draft) => (draft.catalog_risk_code ? suggestions?.porCodigo[draft.catalog_risk_code] : suggestions?.propio) ?? null;
  const departs = (draft: Draft) => { const s = suggestionFor(draft); return Boolean(s && draft.probability && draft.probability !== s.probabilidad); };
  const missing = chosen.filter(draft => !draft.probability || !draft.impact_company || (departs(draft) && (draft.probability_basis || '').trim().length < 10)).length;
  const confirm = async () => {
    if (!proposal) return;
    setBusy(true); setError('');
    try {
      const refs = new Set(chosen.map(draft => draft.zone_ref).filter(Boolean));
      const created = await confirmFromNote(studyId, {
        zonas_nuevas: proposal.zonas_nuevas.filter(zone => refs.has(zone.ref)),
        riesgos: chosen.map(({ selected: _selected, ...draft }) => ({ ...draft, probability: draft.probability!, impact_company: draft.impact_company!, impact_people: draft.impact_company! })),
      });
      setDone(`Quedaron registrados ${created.riesgos.length} riesgo(s)${created.zonas.length ? ` y ${created.zonas.length} zona(s) nueva(s)` : ''}.`);
      setProposal(null); setDrafts([]); setNote('');
      onSaved();
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const set = (index: number, patch: Partial<Draft>) => setDrafts(current => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  const zoneLabel = (draft: Draft) => draft.zone_id ? zones.find(zone => zone.id === draft.zone_id)?.name || 'Zona'
    : draft.zone_ref ? `${proposal?.zonas_nuevas.find(zone => zone.ref === draft.zone_ref)?.nombre} (zona nueva)` : 'Sin zona';

  return <section className="es-card es-fieldnote" aria-label="Registrar con Vig-IA">
    <h3>Registrar con Vig-IA</h3>
    <p className="es-muted">Escriba o dicte lo que vio en la visita. Vig-IA propone zonas y riesgos; usted pone la calificación y confirma. No se guarda nada sin confirmar.</p>
    {!proposal ? <>
      <textarea rows={4} value={note} onChange={event => setNote(event.target.value)} maxLength={4000} aria-label="Nota de campo"
        placeholder="Ej.: En la bodega 3 la malla del costado norte está rota y no hay cámara; el vigilante hace ronda cada 2 horas." />
      <div className="es-actions"><button type="button" onClick={propose} disabled={busy || note.trim().length < 10}>{busy ? 'Vig-IA está leyendo la nota…' : 'Proponer'}</button></div>
    </> : <>
      <p><strong>{proposal.respuesta}</strong></p>
      {proposal.avisos.length ? <ul className="es-notices">{proposal.avisos.map(aviso => <li key={aviso}>{aviso}</li>)}</ul> : null}
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
      {!drafts.length ? <p className="es-muted">Vig-IA no encontró riesgos para proponer en esta nota.</p> : null}
      <div className="es-actions">
        <button type="button" onClick={confirm} disabled={busy || !chosen.length || missing > 0}>{busy ? 'Guardando…' : `Confirmar ${chosen.length} riesgo(s)`}</button>
        <button type="button" className="secondary" onClick={() => { setProposal(null); setDrafts([]); }} disabled={busy}>Descartar</button>
        {missing ? <small className="es-muted">Falta calificar {missing} riesgo(s).</small> : null}
      </div>
    </>}
    {done ? <p className="es-muted" role="status">{done}</p> : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
  </section>;
}
