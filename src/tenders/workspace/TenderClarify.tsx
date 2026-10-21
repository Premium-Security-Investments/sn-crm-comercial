import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { TenderRequest } from '../types';
import { formatDeadline } from './tenderWorkspaceFormat';
import { agt002CompanyClarificationSuggestion, AGT002_COMPANY_CLARIFICATION_LINE_MAX } from '../../../agt002-company-clarification.js';

// Aclaraciones del encargado (Juan, 2026-10-21): le resuelven una duda o le corrigen algo a Vig-IA. Quedan con nombre y
// fecha, y Vig-IA actualiza el análisis sólo en lo que tocan (reanálisis incremental).

export type TenderClarification = {
  id: string; content: string; target_kind: 'requirement' | 'finding' | null; target_id: string | null; target_label: string | null;
  created_at: string; author_name: string | null;
};
export type TenderClarificationTarget = { kind: 'requirement' | 'finding'; id: string; label: string };
type ClarifyResponse = { clarification: TenderClarification; analysis_request: { requested: boolean; already_open?: boolean; message?: string } | null };

export async function sendTenderClarification(request: TenderRequest, opportunityId: string, content: string, target: TenderClarificationTarget | null) {
  return request<ClarifyResponse>('/api/agt002-clarifications', {
    method: 'POST',
    body: JSON.stringify({ opportunity_id: opportunityId, content, ...(target ? { target_kind: target.kind, target_id: target.id, target_label: target.label } : {}) }),
  });
}

/**
 * Punto 4 de la definición de Juan: guardar en la ficha de la empresa el dato de una aclaración. Vig-IA propone
 * el texto; quien aprueba puede editarlo antes de guardar. La ruta exige el permiso de la ficha.
 */
export async function saveTenderClarificationToCompanyProfile(request: TenderRequest, opportunityId: string, clarificationId: string, line: string) {
  return request<{ appended: boolean }>('/api/agt002-clarification-to-company-profile', {
    method: 'POST',
    body: JSON.stringify({ opportunity_id: opportunityId, clarification_id: clarificationId, line }),
  });
}

export async function loadTenderClarifications(request: TenderRequest, opportunityId: string) {
  const value = await request<{ clarifications: TenderClarification[] }>(`/api/agt002-clarifications?opportunity_id=${encodeURIComponent(opportunityId)}`);
  return value.clarifications || [];
}

export function clarificationSentText(response: ClarifyResponse): string {
  const request = response.analysis_request;
  if (request?.requested || request?.already_open) return '✓ Aclaración registrada. Vig-IA va a actualizar el análisis en unos minutos; el cambio aparece en "Qué cambió".';
  return `✓ Aclaración registrada.${request?.message ? ` El análisis no se actualizó: ${request.message}` : ''}`;
}

/** Botón "Aclarar" de un requisito o hallazgo: abre ahí mismo la aclaración ya ligada a ese punto. */
export function TenderClarifyInline({ opportunityId, request, target, onSaved }: {
  opportunityId: string; request: TenderRequest; target: TenderClarificationTarget; onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setBusy(true); setStatus(null);
    try {
      const response = await sendTenderClarification(request, opportunityId, content, target);
      setDraft(''); setOpen(false); setStatus({ text: clarificationSentText(response), error: false });
      onSaved?.();
    } catch (cause) {
      setStatus({ text: cause instanceof Error ? cause.message : String(cause), error: true });
    } finally { setBusy(false); }
  };
  return <div className="tw-clarify">
    {!open && <button type="button" className="secondary tw-clarify-open" onClick={() => { setOpen(true); setStatus(null); }}>Aclarar</button>}
    {open && <div className="tw-clarify-form">
      <label><span>Aclaración para Vig-IA sobre «{target.label}»</span>
        <textarea value={draft} maxLength={4000} placeholder="Lo que Vig-IA debe saber o corregir sobre este punto…" onChange={event => setDraft(event.target.value)} autoFocus /></label>
      <div className="row-actions">
        <button type="button" disabled={busy || !draft.trim()} onClick={() => void send()}>{busy ? 'Enviando…' : 'Enviar aclaración'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>}
    {status && <p className={status.error ? 'tw-reanalysis-warn' : 'tw-muted'} role="status">{status.text}</p>}
  </div>;
}

/** Las aclaraciones de la licitación, con recarga para cuando se registra una nueva. */
export function useTenderClarifications(opportunityId: string | undefined, request: TenderRequest | undefined) {
  const [clarifications, setClarifications] = useState<TenderClarification[]>([]);
  const reload = useCallback(async () => {
    if (!opportunityId || !request) { setClarifications([]); return; }
    try { setClarifications(await loadTenderClarifications(request, opportunityId)); } catch { /* la pantalla sigue sin ellas */ }
  }, [opportunityId, request]);
  useEffect(() => { void reload(); }, [reload]);
  return { clarifications, reload };
}

/** Una aclaración en su punto: lo que dijo el encargado, con su nombre y la fecha. */
export type TenderClarificationPlacement = {
  clarification: TenderClarification; scope: 'requirement' | 'finding' | 'general' | 'orphan';
  rowKey: string | null; findingId: string | null; label: string | null;
};

function clarificationSignature(clarification: TenderClarification) {
  return [clarification.author_name, formatDeadline(clarification.created_at)].filter(Boolean).join(' · ');
}

/** Las aclaraciones ya registradas sobre un requisito o un hallazgo, pegadas a ese punto. */
export function TenderClarificationNotes({ items }: { items: TenderClarification[] }) {
  if (!items.length) return null;
  return <section className="tw-clarified"><h4>Lo que ya se aclaró</h4>
    {items.map(item => <p key={item.id}><q>{item.content}</q> <small className="tw-muted">{clarificationSignature(item)}</small></p>)}
  </section>;
}

/** Punto donde quedó la aclaración, para la lista de la licitación. */
function clarificationWhere(entry: TenderClarificationPlacement): string {
  if (entry.scope === 'general') return 'Sobre la licitación';
  if (entry.scope === 'orphan') return entry.label ? `${entry.label} · el análisis ya no trae ese punto` : 'Un punto que el análisis ya no trae';
  return entry.label || 'Un punto del análisis';
}

/** Todas las aclaraciones de la licitación en un solo lugar (punto 3 de la definición de Juan). */
export function TenderClarificationsCard({ listed, onSelectRequirement, proposal }: {
  listed: TenderClarificationPlacement[]; onSelectRequirement?: (rowKey: string) => void;
  proposal?: (clarification: TenderClarification) => ReactNode;
}) {
  if (!listed.length) return null;
  return <section className="tw-card tw-clarifications" aria-label="Aclaraciones de la licitación">
    <small>Aclaraciones · {listed.length}</small>
    <p className="tw-muted">Lo que se le aclaró a Vig-IA sobre esta licitación. Vig-IA las cita en el análisis; una aclaración no reemplaza el soporte que pide el pliego.</p>
    <ul className="tw-clarification-list">
      {listed.map(entry => <li key={entry.clarification.id} className={entry.scope === 'orphan' ? 'is-orphan' : ''}>
        <span className="tw-clarification-where">{clarificationWhere(entry)}</span>
        <q>{entry.clarification.content}</q>
        <small className="tw-muted">{clarificationSignature(entry.clarification)}</small>
        {entry.scope === 'requirement' && entry.rowKey && onSelectRequirement
          && <button type="button" className="tw-link" onClick={() => onSelectRequirement(entry.rowKey as string)}>Ver el requisito →</button>}
        {proposal?.(entry.clarification)}
      </li>)}
    </ul>
  </section>;
}

/**
 * Vig-IA propone guardar en la ficha de la empresa lo que es de la empresa (punto 4). No escribe nada sola: el
 * texto se puede editar y guardar es un clic de la persona. Lo que es de esta licitación no se propone.
 */
export function TenderCompanyClarificationProposal({ clarification, opportunityId, request, tenderLabel }: {
  clarification: TenderClarification; opportunityId: string; request: TenderRequest; tenderLabel?: string;
}) {
  const suggestion = agt002CompanyClarificationSuggestion(clarification, { tenderLabel: tenderLabel || '' });
  const [draft, setDraft] = useState(suggestion.line);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!suggestion.company || done === 'descartada') return null;
  if (done) return <p className="tw-muted" role="status">{done}</p>;
  const save = async () => {
    const line = draft.trim();
    if (!line) return;
    setBusy(true); setError('');
    try {
      const response = await saveTenderClarificationToCompanyProfile(request, opportunityId, clarification.id, line);
      setDone(response.appended ? '✓ Guardado en la ficha de la empresa.' : '✓ Ya estaba en la ficha de la empresa.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };
  return <div className="tw-company-proposal">
    <p><strong>Esto parece un dato de la empresa</strong> ({suggestion.topicLabel}). {suggestion.reason} Guardado en la ficha sirve para toda licitación, no solo para esta.</p>
    {!open && <div className="row-actions">
      <button type="button" onClick={() => setOpen(true)}>Guardar en la ficha de la empresa</button>
      <button type="button" className="secondary" onClick={() => setDone('descartada')}>Solo para esta licitación</button>
    </div>}
    {open && <>
      <label><span>Texto que queda en la ficha (puede editarlo)</span>
        <textarea value={draft} maxLength={AGT002_COMPANY_CLARIFICATION_LINE_MAX} onChange={event => setDraft(event.target.value)} /></label>
      <div className="row-actions">
        <button type="button" disabled={busy || !draft.trim()} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </>}
    {error && <p className="tw-reanalysis-warn" role="status">{error}</p>}
  </div>;
}
