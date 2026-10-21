import { useState } from 'react';
import type { TenderRequest } from '../types';

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
