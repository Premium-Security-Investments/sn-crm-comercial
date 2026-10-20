import { useCallback, useEffect, useRef, useState } from 'react';
import type { TenderRequest } from '../types';
import { formatDeadline } from './tenderWorkspaceFormat';

// "Volver a analizar" (Juan, 2026-10-20): pedir a Vig-IA un análisis nuevo con los documentos vigentes y el perfil de
// la empresa de hoy. La petición sólo deja la solicitud; el servidor la lanza en unos minutos (agt002-manual-reanalysis.js).

export type ManualReanalysisStatus = {
  state: 'idle' | 'requested' | 'analyzing' | 'completed' | 'failed' | 'rejected';
  requestedAt: string | null;
  finishedAt: string | null;
  reasonText: string | null;
  canRequest: boolean;
  blockedReasonText: string | null;
};

const POLL_MS = 20_000;
const PENDING_STATES = new Set<ManualReanalysisStatus['state']>(['requested', 'analyzing']);

export function manualReanalysisStatusText(status: ManualReanalysisStatus | null): string | null {
  if (!status) return null;
  if (status.state === 'requested') return 'Análisis nuevo pedido. Arranca en unos minutos.';
  if (status.state === 'analyzing') return 'Vig-IA está haciendo el análisis nuevo (unos 10 a 15 minutos). Esta ficha se actualiza sola al terminar.';
  if (status.state === 'failed') return `El último análisis pedido no terminó${status.reasonText ? `: ${status.reasonText}` : '.'} Puede intentarlo de nuevo.`;
  if (status.state === 'rejected') return `El último análisis pedido no se lanzó: ${status.reasonText || 'motivo no informado'}.`;
  return null;
}

export function TenderManualReanalysis({ opportunityId, request, analyzedAt, onCompleted }: {
  opportunityId: string; request: TenderRequest; analyzedAt: string | null; onCompleted: () => void;
}) {
  const [status, setStatus] = useState<ManualReanalysisStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousState = useRef<ManualReanalysisStatus['state'] | null>(null);
  const load = useCallback(async () => {
    const value = await request<ManualReanalysisStatus>(`/api/agt002-manual-reanalysis?opportunity_id=${encodeURIComponent(opportunityId)}`);
    if (previousState.current && PENDING_STATES.has(previousState.current) && value.state === 'completed') onCompleted();
    previousState.current = value.state;
    setStatus(value);
  }, [opportunityId, request, onCompleted]);
  useEffect(() => {
    setStatus(null); setError(null); previousState.current = null;
    load().catch(() => setStatus(null));
  }, [load]);
  const pending = Boolean(status && PENDING_STATES.has(status.state));
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => { load().catch(() => undefined); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pending, load]);
  const ask = async () => {
    if (!window.confirm('Vig-IA volverá a leer los documentos vigentes con el perfil actual de la empresa. Tarda unos 10 a 15 minutos y no cambia ninguna decisión. ¿Continuar?')) return;
    setBusy(true); setError(null);
    try {
      const result = await request<{ status: ManualReanalysisStatus }>('/api/agt002-manual-reanalysis', { method: 'POST', body: JSON.stringify({ opportunity_id: opportunityId }) });
      previousState.current = result.status.state;
      setStatus(result.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };
  const text = manualReanalysisStatusText(status);
  const disabled = busy || !status?.canRequest;
  return <div className="tw-reanalysis">
    <div className="tw-reanalysis-row">
      {analyzedAt && <span className="tw-muted">Análisis del {formatDeadline(analyzedAt)}</span>}
      {status && <button type="button" className="secondary" disabled={disabled} title={!status.canRequest && !pending ? status.blockedReasonText || undefined : undefined} onClick={() => void ask()}>
        {busy ? 'Pidiendo…' : pending ? 'Analizando…' : 'Volver a analizar'}
      </button>}
    </div>
    {text && <p className={status?.state === 'failed' || status?.state === 'rejected' ? 'tw-reanalysis-warn' : 'tw-muted'} role="status">{text}</p>}
    {error && <p className="tw-reanalysis-warn" role="alert">{error}</p>}
  </div>;
}
