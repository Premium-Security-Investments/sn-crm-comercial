import { useCallback, useEffect, useState } from 'react';
import { formatDateOnly } from '../../dateOnly';
import type { TenderRequest } from '../types';

/**
 * F14 (Juan, 2026-11-07 y 2026-11-08): lo que Vig-IA Licitaciones leyó en un documento propio subido a un expediente y
 * que la ficha no tiene o tiene distinto. Confirmar crea la versión nueva del bloque, verificada por quien confirma;
 * descartar lo deja como estaba. Vig-IA nunca escribe la ficha.
 */
type Proposal = {
  id: string; entry_id: string; summary: string; proposed_vigencia_text: string; proposed_expiry: string | null;
  current_vigencia_text: string | null; current_expiry: string | null; why: string | null; source_label: string | null;
  source_file_name: string | null; uploaded_by_name: string | null; created_at: string;
};

export function CompanyFactProposals({ request, labels, canDecide, onDecided }: {
  request: TenderRequest;
  labels: Record<string, string>;
  canDecide: boolean;
  onDecided: () => Promise<void> | void;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try { setProposals((await request<{ proposals: Proposal[] }>('/api/tender-company-fact-proposals')).proposals || []); }
    catch { setProposals([]); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (proposal: Proposal, decision: 'confirmada' | 'descartada') => {
    setBusy(proposal.id); setMessage('');
    try {
      await request('/api/tender-company-fact-proposals/decision', { method: 'POST', body: JSON.stringify({ proposal_id: proposal.id, decision }) });
      await load();
      if (decision === 'confirmada') await onDecided();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  if (!proposals.length) return null;
  return <section className="panel company-fact-proposals" aria-labelledby="company-fact-proposals-heading">
    <header className="company-base-section-head"><div><span className="eyebrow">Falta confirmar · {proposals.length}</span><h3 id="company-fact-proposals-heading">Datos que Vig-IA Licitaciones encontró en los procesos</h3><p>Salen de documentos propios subidos al expediente de una licitación. No cambian la ficha hasta que alguien los confirme.</p></div></header>
    {message && <div className="error" role="alert">{message}</div>}
    <ul className="company-fact-proposal-list">{proposals.map(proposal => <li key={proposal.id} className="company-fact-proposal">
      <p><strong>{labels[proposal.entry_id] || proposal.entry_id}</strong> — {proposal.summary}</p>
      <dl>
        <div><dt>Hoy dice</dt><dd>{proposal.current_vigencia_text || 'sin dato'}{proposal.current_expiry ? ` · vence ${formatDateOnly(proposal.current_expiry)}` : ''}</dd></div>
        <div><dt>Propuesto</dt><dd>{proposal.proposed_vigencia_text}{proposal.proposed_expiry ? ` · vence ${formatDateOnly(proposal.proposed_expiry)}` : ''}</dd></div>
      </dl>
      {proposal.why && <p className="muted">{proposal.why}</p>}
      <p className="muted"><small>Verificado en {proposal.source_label || 'un proceso'}{proposal.source_file_name ? ` · ${proposal.source_file_name}` : ''}{proposal.uploaded_by_name ? ` · subido por ${proposal.uploaded_by_name}` : ''}</small></p>
      {canDecide && <div className="row-actions">
        <button type="button" disabled={Boolean(busy)} onClick={() => void decide(proposal, 'confirmada')}>Confirmar</button>
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void decide(proposal, 'descartada')}>Descartar</button>
      </div>}
    </li>)}</ul>
  </section>;
}
