import { useCallback, useEffect, useState } from 'react';
import { loadTenderOfferRecord, registerTenderOfferResult, registerTenderOfferSubmission } from '../api';
import { canApproveTenderGoNoGo } from '../permissions';
import type { TenderCurrentProfile, TenderOfferRecord, TenderOfferStatus, TenderRequest } from '../types';

/**
 * Ofertas presentadas (encargo AGT-002 del 2026-11-07). Lo que pasó afuera se registra con evidencia: la radicación
 * (radicado o RPL, fecha y hora, enlace al PDF o a lo radicado) aunque el expediente del CRM no esté completo —queda
 * marcado y con lo que faltaba— y después el resultado con su fuente. La compuerta normal de «lista para presentar»
 * no cambia.
 */
const RESULTS = [['ganada', 'Ganada'], ['perdida', 'Perdida'], ['rechazada', 'Rechazada'], ['desierta', 'Desierta']] as const;
const SOURCES = [['informe_evaluacion', 'Informe de evaluación'], ['acto_adjudicacion', 'Acto de adjudicación'], ['otro', 'Otra fuente']] as const;
const when = (value: string | null) => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(value)) : '');
const pesos = (value: number | string | null) => (value === null || value === '' ? '' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value)));
const missingCount = (missing: Record<string, unknown>) => ['pending_required_items', 'active_blockers', 'unapproved_artifacts']
  .reduce((total, key) => total + (Array.isArray(missing?.[key]) ? (missing[key] as unknown[]).length : 0), 0);

type Mode = null | 'presentada' | 'no_presentada' | 'resultado';

export function TenderOfferRecordPanel({ opportunityId, offerStatus, currentProfile, request, onChanged }: {
  opportunityId: string;
  offerStatus: TenderOfferStatus | null | undefined;
  currentProfile: TenderCurrentProfile | null | undefined;
  request: TenderRequest;
  onChanged: () => Promise<void> | void;
}) {
  const [record, setRecord] = useState<TenderOfferRecord>({ submission: null, result: null });
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const allowed = canApproveTenderGoNoGo(currentProfile);
  const load = useCallback(async () => {
    try { setRecord(await loadTenderOfferRecord(request, opportunityId)); } catch { /* sin la 191 no hay registro que mostrar */ }
  }, [opportunityId, request]);
  useEffect(() => { void load(); }, [load]);

  const set = (key: string) => (event: { target: { value: string } }) => setForm(previous => ({ ...previous, [key]: event.target.value }));
  const open = (next: Mode) => { setMode(next); setMessage(''); setForm(next === 'resultado' ? { result: 'perdida', source_kind: 'informe_evaluacion' } : {}); };
  const submit = async () => {
    setBusy(true); setMessage('');
    try {
      if (mode === 'resultado') {
        await registerTenderOfferResult(request, { opportunity_id: opportunityId, ...form } as never);
      } else if (mode) {
        const submittedAt = form.submitted_at ? `${form.submitted_at}:00-05:00` : '';
        await registerTenderOfferSubmission(request, { opportunity_id: opportunityId, kind: mode, ...form, submitted_at: submittedAt });
      }
      setMode(null); setForm({});
      await load();
      await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const { submission, result } = record;
  const canSubmit = allowed && !submission && (offerStatus === 'en_preparacion' || offerStatus === 'lista_para_presentar');
  const canResult = allowed && !result && offerStatus === 'presentada';
  if (!submission && !canSubmit && !canResult) return null;

  return <section className="tender-offer-record-panel" aria-labelledby="tender-offer-record-heading">
    <header><div><span className="eyebrow">Radicación y resultado</span><h3 id="tender-offer-record-heading">Oferta presentada</h3></div></header>
    {submission?.kind === 'presentada' && <p>
      Radicada: <strong>{submission.filing_reference}</strong> · {when(submission.submitted_at)}
      {submission.evidence_url && <> · <a href={submission.evidence_url} target="_blank" rel="noopener noreferrer">ver lo radicado</a></>}
      {submission.dossier_incomplete && <><br /><small className="muted">Presentada con el expediente incompleto en el CRM: faltaban {missingCount(submission.missing_at_submission)} puntos por aprobar.</small></>}
    </p>}
    {submission?.kind === 'no_presentada' && <p>No se presentó: {submission.reason}</p>}
    {result && <p>Resultado: <strong>{RESULTS.find(([key]) => key === result.result)?.[1]}</strong>
      {result.rank ? ` · puesto ${result.rank}${result.bidders ? ` de ${result.bidders}` : ''}` : ''}
      {result.awarded_value ? ` · adjudicado por ${pesos(result.awarded_value)}` : ''}
      {result.source_url && <> · <a href={result.source_url} target="_blank" rel="noopener noreferrer">fuente</a></>}
      {result.source_note && ` · ${result.source_note}`}</p>}
    {message && <div className="error" role="alert">{message}</div>}
    {!mode && (canSubmit || canResult) && <div className="tender-go-no-go-actions">
      {canSubmit && <button type="button" onClick={() => open('presentada')}>Registrar como presentada</button>}
      {canSubmit && <button type="button" className="secondary" onClick={() => open('no_presentada')}>No se presentó</button>}
      {canResult && <button type="button" onClick={() => open('resultado')}>Registrar resultado</button>}
    </div>}
    {mode === 'presentada' && <form className="stack" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>Radicado o RPL<input required value={form.filing_reference || ''} onChange={set('filing_reference')} placeholder="RPL 6017126" maxLength={120} /></label>
      <label>Fecha y hora de radicación (hora de Colombia)<input required type="datetime-local" value={form.submitted_at || ''} onChange={set('submitted_at')} /></label>
      <label>Enlace al PDF o a lo radicado (SECOP o SharePoint)<input required type="url" pattern="https://.*" value={form.evidence_url || ''} onChange={set('evidence_url')} placeholder="https://…" /></label>
      <small className="muted">Si el expediente del CRM no está completo, la oferta queda registrada igual, marcada y con la lista de lo que faltaba. No se aprueba nada.</small>
      <div className="tender-go-no-go-actions"><button type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Registrar presentada'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setMode(null)}>Cancelar</button></div>
    </form>}
    {mode === 'no_presentada' && <form className="stack" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>¿Por qué no se presentó?<textarea required value={form.reason || ''} onChange={set('reason')} maxLength={2000} /></label>
      <div className="tender-go-no-go-actions"><button type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Registrar no presentada'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setMode(null)}>Cancelar</button></div>
    </form>}
    {mode === 'resultado' && <form className="stack" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>Resultado<select value={form.result} onChange={set('result')}>{RESULTS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>De dónde sale<select value={form.source_kind} onChange={set('source_kind')}>{SOURCES.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>Enlace a la fuente<input type="url" pattern="https://.*" value={form.source_url || ''} onChange={set('source_url')} placeholder="https://…" /></label>
      <label>O referencia (si no hay enlace)<input value={form.source_note || ''} onChange={set('source_note')} maxLength={2000} placeholder="Resolución de adjudicación n.º …" /></label>
      <label>Puesto obtenido<input inputMode="numeric" value={form.rank || ''} onChange={set('rank')} /></label>
      <label>Número de oferentes<input inputMode="numeric" value={form.bidders || ''} onChange={set('bidders')} /></label>
      {form.result === 'ganada' && <label>Valor adjudicado (pesos)<input required inputMode="numeric" value={form.awarded_value || ''} onChange={set('awarded_value')} /></label>}
      <div className="tender-go-no-go-actions"><button type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Registrar resultado'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setMode(null)}>Cancelar</button></div>
    </form>}
  </section>;
}
