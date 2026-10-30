import { useCallback, useEffect, useMemo, useState } from 'react';
import { confirmTenderClosureActa, loadTenderClosureActa, reopenTenderClosureActa, saveTenderClosureActa } from '../api';
import type { TenderClosureActa as TenderClosureActaPayload, TenderClosureActaEntry, TenderClosureKind, TenderCurrentProfile, TenderRequest } from '../types';

const CLOSURE_LABELS: Record<string, string> = {
  adjudicada: 'Adjudicada',
  no_adjudicada: 'Presentada y no adjudicada',
  cerrada_no_go: 'Cerrada con NO-GO',
  archivada: 'Archivada sin presentar',
};
const NOTE_SOURCE_LABELS: Record<string, string> = {
  archive_note: 'tomada de la nota con la que se archivó',
  status_transition: 'tomada de la nota del cambio de estado',
  no_go_justification: 'tomada de la justificación del NO-GO',
  manual: 'escrita aquí',
};
const EDITING_ROLES = ['admin', 'gerencia', 'director'];
const SECTIONS: Array<{ key: 'requirements_unmet' | 'factors_against' | 'gaps_to_compete'; title: string; hint: string }> = [
  { key: 'requirements_unmet', title: 'Requisitos que no cumplimos', hint: 'Cada uno con su fuente del pliego.' },
  { key: 'factors_against', title: 'Otros factores en contra', hint: '' },
  { key: 'gaps_to_compete', title: 'Qué nos faltaría para presentarnos', hint: '' },
];

const timeLabel = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
};

type Draft = {
  closing_note: string;
  decision_summary: string;
  decision_quote: string;
  recommendation: string;
  system_lesson: string;
  reasons: string[];
  requirements_unmet: TenderClosureActaEntry[];
  factors_against: TenderClosureActaEntry[];
  gaps_to_compete: TenderClosureActaEntry[];
};

const toDraft = (payload: TenderClosureActaPayload): Draft => ({
  closing_note: payload.acta.closing_note || '',
  decision_summary: payload.acta.decision_summary || '',
  decision_quote: payload.acta.decision_quote || '',
  recommendation: payload.acta.recommendation || '',
  system_lesson: payload.acta.system_lesson || '',
  reasons: payload.reasons.length > 0 ? [...payload.reasons] : [''],
  requirements_unmet: [...payload.acta.requirements_unmet],
  factors_against: [...payload.acta.factors_against],
  gaps_to_compete: [...payload.acta.gaps_to_compete],
});

const entryText = (entry: TenderClosureActaEntry) => [entry.titulo, entry.detalle].filter(Boolean).join(': ');

/**
 * Acta de cierre de la licitación (Juan, 2026-10-19). El punto de partida es la nota con la que se
 * cerró: aquí no se pide otra vez. Vig-IA la profundiza con lo que tiene aprendido del expediente y
 * la persona corrige y confirma. Confirmar es un acto humano; el servidor no deja que lo haga Vig-IA.
 */
export function TenderClosureActa({ opportunityId, request, currentProfile }: { opportunityId: string; request: TenderRequest; currentProfile: TenderCurrentProfile }) {
  const [payload, setPayload] = useState<TenderClosureActaPayload | null>(null);
  const [closureKind, setClosureKind] = useState<TenderClosureKind | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = EDITING_ROLES.includes(currentProfile.role);

  const apply = useCallback((next: TenderClosureActaPayload | null) => {
    setPayload(next);
    setDraft(next ? toDraft(next) : null);
  }, []);

  const reload = useCallback(async () => {
    try {
      const view = await loadTenderClosureActa(request, opportunityId);
      setClosureKind(view.closure_kind);
      apply(view.acta);
      setError('');
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoaded(true); }
  }, [apply, opportunityId, request]);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (action: () => Promise<TenderClosureActaPayload>) => {
    setBusy(true); setError('');
    try { apply(await action()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const save = () => run(() => saveTenderClosureActa(request, {
    opportunity_id: opportunityId,
    expected_updated_at: payload?.acta.updated_at ?? null,
    closing_note: draft?.closing_note || null,
    decision_summary: draft?.decision_summary || null,
    decision_quote: draft?.decision_quote || null,
    recommendation: draft?.recommendation || null,
    system_lesson: draft?.system_lesson || null,
    reasons: (draft?.reasons || []).map(reason => reason.trim()).filter(Boolean),
    requirements_unmet: draft?.requirements_unmet || [],
    factors_against: draft?.factors_against || [],
    gaps_to_compete: draft?.gaps_to_compete || [],
  }));

  const dirty = useMemo(() => {
    if (!payload || !draft) return false;
    return JSON.stringify(toDraft(payload)) !== JSON.stringify(draft);
  }, [payload, draft]);

  if (!loaded) return null;
  // Mientras la licitación siga abierta, el acta no existe ni se puede abrir: no ocupa la pantalla.
  if (!payload && !closureKind) return null;

  // Todavía no hay acta: se abre con la nota de cierre que ya existe, sin pedirla otra vez.
  if (!payload) {
    return <section className="tw-card" aria-label="Acta de cierre">
      <small>Acta de cierre</small>
      <p className="tw-muted">Esta licitación todavía no tiene acta de cierre. Al abrirla se parte de la nota con la que se cerró, y Vig-IA la profundiza con lo que sabe del expediente.</p>
      {error && <div className="error" role="alert">{error}</div>}
      {canEdit
        ? <button type="button" disabled={busy} onClick={() => void run(() => saveTenderClosureActa(request, { opportunity_id: opportunityId, expected_updated_at: null }))}>{busy ? 'Abriendo…' : 'Abrir el acta de cierre'}</button>
        : <p className="tw-muted">La abre alguien de gerencia o dirección.</p>}
    </section>;
  }

  const { acta, reasons, events } = payload;
  const confirmed = acta.status === 'confirmada';
  const editable = canEdit && !confirmed;

  return <section className="tw-card" aria-label="Acta de cierre">
    <div>
      <small>Acta de cierre · {CLOSURE_LABELS[acta.closure_kind] || acta.closure_kind}</small>
      <p className="tw-muted">
        {confirmed
          ? `Confirmada por ${payload.confirmed_by_name || 'una persona autorizada'} el ${timeLabel(acta.confirmed_at)}.`
          : `Borrador propuesto por ${payload.proposed_by_name || 'el equipo'}, pendiente de confirmar.`}
      </p>
    </div>

    {acta.closing_note && <div className="tw-closure-note">
      <small>La nota con la que se cerró{acta.closing_note_source ? ` — ${NOTE_SOURCE_LABELS[acta.closing_note_source]}` : ''}</small>
      <p>{acta.closing_note}</p>
    </div>}

    {editable ? <>
      <label>Decisión y razón principal
        <textarea value={draft?.decision_summary || ''} maxLength={4000} rows={3} onChange={event => setDraft(current => current && { ...current, decision_summary: event.target.value })} />
      </label>
      <label>La razón, en palabras de quien decidió
        <textarea value={draft?.decision_quote || ''} maxLength={2000} rows={2} onChange={event => setDraft(current => current && { ...current, decision_quote: event.target.value })} />
      </label>

      <fieldset className="tw-closure-reasons">
        <legend>Motivos del cierre (los cuenta el resumen mensual)</legend>
        {(draft?.reasons || []).map((reason, index) => <div key={index} className="tw-closure-reason-row">
          <input value={reason} maxLength={120} aria-label={`Motivo ${index + 1}`} onChange={event => setDraft(current => current && { ...current, reasons: current.reasons.map((value, position) => position === index ? event.target.value : value) })} />
          <button type="button" className="tw-link" aria-label={`Quitar el motivo ${index + 1}`} onClick={() => setDraft(current => current && { ...current, reasons: current.reasons.filter((_, position) => position !== index) })}>Quitar</button>
        </div>)}
        <button type="button" className="secondary" onClick={() => setDraft(current => current && { ...current, reasons: [...current.reasons, ''] })}>Añadir un motivo</button>
      </fieldset>

      {SECTIONS.map(section => <fieldset key={section.key}>
        <legend>{section.title}</legend>
        {section.hint && <p className="tw-muted">{section.hint}</p>}
        {(draft?.[section.key] || []).map((entry, index) => <div key={index} className="tw-closure-entry">
          <textarea value={entry.detalle || ''} rows={2} aria-label={`${section.title}: detalle ${index + 1}`}
            onChange={event => setDraft(current => current && { ...current, [section.key]: current[section.key].map((value, position) => position === index ? { ...value, detalle: event.target.value } : value) })} />
          <input value={entry.fuente || ''} placeholder="Fuente (pliego, anexo, numeral)" aria-label={`${section.title}: fuente ${index + 1}`}
            onChange={event => setDraft(current => current && { ...current, [section.key]: current[section.key].map((value, position) => position === index ? { ...value, fuente: event.target.value } : value) })} />
          <button type="button" className="tw-link" onClick={() => setDraft(current => current && { ...current, [section.key]: current[section.key].filter((_, position) => position !== index) })}>Quitar</button>
        </div>)}
        <button type="button" className="secondary" onClick={() => setDraft(current => current && { ...current, [section.key]: [...current[section.key], { detalle: '', fuente: '' }] })}>Añadir</button>
      </fieldset>)}

      <label>Recomendación
        <textarea value={draft?.recommendation || ''} maxLength={4000} rows={3} onChange={event => setDraft(current => current && { ...current, recommendation: event.target.value })} />
      </label>
      <label>Lección para el sistema (lo que debe recordar el Radar)
        <textarea value={draft?.system_lesson || ''} maxLength={4000} rows={3} onChange={event => setDraft(current => current && { ...current, system_lesson: event.target.value })} />
      </label>
    </> : <>
      {acta.decision_summary && <p>{acta.decision_summary}</p>}
      {acta.decision_quote && <blockquote>{acta.decision_quote}</blockquote>}
      {reasons.length > 0 && <div><small>Motivos</small><ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
      {SECTIONS.map(section => acta[section.key].length > 0 && <div key={section.key}>
        <small>{section.title}</small>
        <ul>{acta[section.key].map((entry, index) => <li key={index}>{entryText(entry)}{entry.fuente ? ` — ${entry.fuente}` : ''}</li>)}</ul>
      </div>)}
      {acta.recommendation && <div><small>Recomendación</small><p>{acta.recommendation}</p></div>}
      {acta.system_lesson && <div><small>Lección para el sistema</small><p>{acta.system_lesson}</p></div>}
      {!canEdit && !confirmed && <p className="tw-muted">La corrige y la confirma alguien de gerencia o dirección.</p>}
    </>}

    {error && <div className="error" role="alert">{error}</div>}

    <div className="tw-closure-actions">
      {editable && <button type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar el borrador'}</button>}
      {editable && <button type="button" className="secondary" disabled={busy || dirty} title={dirty ? 'Guarde los cambios antes de confirmar.' : undefined}
        onClick={() => void run(() => confirmTenderClosureActa(request, opportunityId, acta.updated_at))}>Confirmar el acta</button>}
      {confirmed && canEdit && <button type="button" className="secondary" disabled={busy}
        onClick={() => void run(() => reopenTenderClosureActa(request, opportunityId, acta.updated_at))}>Reabrir el acta</button>}
    </div>

    {events.length > 0 && <details className="tw-fold"><summary>Historial del acta ({events.length})</summary>
      <ul>{events.map((event, index) => <li key={index}>{event.action} · {event.actor_name || 'sin nombre'} · {timeLabel(event.created_at)}</li>)}</ul>
    </details>}
  </section>;
}
