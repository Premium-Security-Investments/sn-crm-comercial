import { useCallback, useEffect, useState } from 'react';
import { createTenderDossierArtifact, loadTenderDossierWorkspace } from '../api';
import { TenderDossierArtifacts } from '../components/TenderDossierArtifacts';
import type { TenderDossierArtifact, TenderRequest } from '../types';

/** F16: el tipo que pidió Juan para antes del GO; la Mesa lo crea con la misma clave cuando se le piden observaciones. */
export const OBSERVACIONES_AL_PLIEGO = Object.freeze({ artifact_key: 'observaciones_pliego', title: 'Observaciones al pliego' });

/**
 * F16 (auditoría del piloto Fiscalía; Juan, 2026-11-04): «cuando el proceso está en por decidir no tenemos una sección
 * donde se suben documentos para descargar como en los en curso después del GO». Los documentos propios se crean desde
 * que la licitación está en Oportunidades, en la misma tabla del expediente: lo que se cree aquí ya está en el
 * expediente cuando se registre el GO. Aprobar una versión sigue siendo cosa del expediente, después del GO.
 */
export function TenderOwnDocuments({ opportunityId, request, refreshKey = 0 }: { opportunityId: string; request: TenderRequest; refreshKey?: number }) {
  const [artifacts, setArtifacts] = useState<TenderDossierArtifact[] | null>(null);
  const [workbenchEnabled, setWorkbenchEnabled] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const workspace = await loadTenderDossierWorkspace(request, opportunityId);
      setArtifacts(workspace.artifacts || []);
      setWorkbenchEnabled(workspace.workbench_enabled === true);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [opportunityId, request]);
  // `refreshKey` cambia cuando la Mesa termina un pedido: un Word nuevo aparece sin recargar la página.
  useEffect(() => { void reload(); }, [reload, refreshKey]);

  const create = async (input: { artifact_key?: string; title: string }) => {
    if (!input.title.trim()) return;
    setBusy(true); setError('');
    try {
      await createTenderDossierArtifact(request, { opportunity_id: opportunityId, artifact_key: input.artifact_key, title: input.title.trim(), required: false });
      setTitle('');
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const hasObservaciones = (artifacts || []).some(artifact => artifact.artifact_key === OBSERVACIONES_AL_PLIEGO.artifact_key);
  return <section className="tw-card" aria-label="Nuestros documentos">
    <small>Nuestros documentos</small>
    <p className="tw-muted">Lo que preparamos para este proceso antes de decidir: observaciones al pliego, cartas, borradores. Vig-IA los redacta en Word; lo que se cree aquí pasa al expediente con el GO.</p>
    {error && <div className="error" role="alert">{error}</div>}
    {artifacts === null && !error && <p className="tw-muted">Cargando…</p>}
    {artifacts && artifacts.length > 0 && <TenderDossierArtifacts opportunityId={opportunityId} artifacts={artifacts} request={request} canApprove={false} workbenchEnabled={workbenchEnabled} onChanged={reload} />}
    <div className="tw-own-documents-new">
      {!hasObservaciones && <button type="button" className="secondary" disabled={busy} onClick={() => void create(OBSERVACIONES_AL_PLIEGO)}>+ Observaciones al pliego</button>}
      <input aria-label="Nombre del documento nuevo" value={title} maxLength={200} placeholder="Otro documento (p. ej. Carta a la entidad)" disabled={busy}
        onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void create({ title }); }} />
      <button type="button" className="secondary" disabled={busy || !title.trim()} onClick={() => void create({ title })}>Crear</button>
    </div>
  </section>;
}
