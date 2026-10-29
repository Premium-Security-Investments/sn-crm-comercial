import { useCallback, useEffect, useRef, useState } from 'react';
import type { TenderRequest } from '../types';
import { formatDeadline } from './tenderWorkspaceFormat';
import { initialReportLabels } from '../agt002InitialReportProjection';

// "Volver a analizar" (Juan, 2026-10-20): pedir a Vig-IA un análisis nuevo con los documentos vigentes y el perfil de
// la empresa de hoy. La petición sólo deja la solicitud; el servidor la lanza en unos minutos (agt002-manual-reanalysis.js).

export type ManualReanalysisChanges = {
  recommendation: { from: string | null; to: string | null; kindChanged: boolean } | null;
  requirements: { requirementId: string; text: string | null; from: string; to: string }[];
  addedFindings: { title: string; severity: string }[];
  removedFindings: { title: string; severity: string }[];
};

export type ManualReanalysisStatus = {
  state: 'idle' | 'requested' | 'analyzing' | 'completed' | 'failed' | 'rejected';
  mode?: 'full' | 'incremental';
  changes?: ManualReanalysisChanges | null;
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
  const incremental = status.mode === 'incremental';
  if (status.state === 'requested') return incremental ? 'Vig-IA va a revisar los documentos que se subieron. Arranca en unos minutos.' : 'Análisis nuevo pedido. Arranca en unos minutos.';
  if (status.state === 'analyzing') return incremental
    ? 'Vig-IA está revisando los documentos nuevos sobre su análisis (unos minutos). Esta ficha se actualiza sola al terminar.'
    : 'Vig-IA está haciendo el análisis completo (unos 20 a 40 minutos). Esta ficha se actualiza sola al terminar.';
  if (status.state === 'failed') return `El último análisis pedido no terminó${status.reasonText ? `: ${status.reasonText}` : '.'} Puede intentarlo de nuevo.`;
  if (status.state === 'rejected') return `El último análisis pedido no se lanzó: ${status.reasonText || 'motivo no informado'}.`;
  return null;
}

export function TenderManualReanalysis({ opportunityId, request, analyzedAt, firstAnalysis = false, onCompleted }: {
  opportunityId: string; request: TenderRequest; analyzedAt: string | null; firstAnalysis?: boolean; onCompleted: () => void;
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
    if (!window.confirm(firstAnalysis
      ? 'Vig-IA va a leer los documentos que ya trajo de la entidad con el perfil actual de la empresa. Tarda unos 20 a 40 minutos y no cambia ninguna decisión. ¿Continuar?'
      : 'Vig-IA volverá a leer todos los documentos vigentes con el perfil actual de la empresa. Tarda unos 20 a 40 minutos y no cambia ninguna decisión. ¿Continuar?')) return;
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
        {busy ? 'Pidiendo…' : pending ? 'Analizando…' : firstAnalysis ? 'Analizar ahora' : 'Volver a analizar'}
      </button>}
    </div>
    {text && <p className={status?.state === 'failed' || status?.state === 'rejected' ? 'tw-reanalysis-warn' : 'tw-muted'} role="status">{text}</p>}
    {error && <p className="tw-reanalysis-warn" role="alert">{error}</p>}
    {status?.state === 'completed' && status.changes && <TenderAnalysisChanges changes={status.changes} incremental={status.mode === 'incremental'} />}
  </div>;
}

/** Qué cambió con el último reanálisis: recomendación, requisitos re-evaluados y hallazgos nuevos o retirados. */
export function TenderAnalysisChanges({ changes, incremental }: { changes: ManualReanalysisChanges; incremental: boolean }) {
  const empty = !changes.recommendation && !changes.requirements.length && !changes.addedFindings.length && !changes.removedFindings.length;
  return <details className="tw-reanalysis-changes" open>
    <summary>{incremental ? 'Qué cambió con los documentos nuevos' : 'Qué cambió con el último análisis'}</summary>
    {empty && <p className="tw-muted">No cambió la recomendación, ni la evaluación de ningún requisito, ni los hallazgos.</p>}
    {changes.recommendation && <p><strong>Recomendación:</strong> {changes.recommendation.from || '—'} → <strong>{changes.recommendation.to || '—'}</strong></p>}
    {changes.requirements.length > 0 && <ul>{changes.requirements.map(item => <li key={item.requirementId}>{item.text || 'Requisito'}: {initialReportLabels.companyEvaluation(item.from)} → <strong>{initialReportLabels.companyEvaluation(item.to)}</strong></li>)}</ul>}
    {changes.addedFindings.length > 0 && <><p><strong>Hallazgos nuevos</strong></p><ul>{changes.addedFindings.map(item => <li key={`a-${item.title}`}>{initialReportLabels.severity(item.severity)} · {item.title}</li>)}</ul></>}
    {changes.removedFindings.length > 0 && <><p><strong>Hallazgos que ya no aplican</strong></p><ul>{changes.removedFindings.map(item => <li key={`r-${item.title}`}>{item.title}</li>)}</ul></>}
  </details>;
}
