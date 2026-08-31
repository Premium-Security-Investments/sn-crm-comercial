import { useCallback, useEffect, useState } from 'react';
import './tender-dossier.css';
import { loadTenderDossierWorkspace, seedTenderDossier } from '../api';
import type { TenderDossierAssignee, TenderDossierWorkspace, TenderOfferStatus, TenderRequest } from '../types';
import { TenderDossierArtifacts } from './TenderDossierArtifacts';
import { TenderDossierChecklist } from './TenderDossierChecklist';
import { TenderDossierVigiaWorkbench } from './TenderDossierVigiaWorkbench';

const ACTIVE_STATUSES = new Set<TenderOfferStatus>(['en_preparacion', 'lista_para_presentar', 'presentada', 'adjudicada', 'no_adjudicada']);

export function TenderDossierWorkspacePanel({ opportunityId, request, profiles, canApprove, offerStatus }: {
  opportunityId: string;
  request: TenderRequest;
  profiles: TenderDossierAssignee[];
  canApprove: boolean;
  offerStatus: TenderOfferStatus | null;
}) {
  const [workspace, setWorkspace] = useState<TenderDossierWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState('');
  const enabled = offerStatus ? ACTIVE_STATUSES.has(offerStatus) : false;

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setWorkspace(await loadTenderDossierWorkspace(request, opportunityId));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [enabled, opportunityId, request]);

  useEffect(() => {
    setWorkspace(null);
    setError('');
    void reload();
  }, [reload]);

  const initialize = async () => {
    setSeeding(true); setError('');
    try {
      await seedTenderDossier(request, opportunityId);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSeeding(false);
    }
  };

  if (!enabled) return null;

  const readiness = workspace?.readiness;
  const emptyWorkspace = workspace && workspace.checklist.length === 0 && workspace.artifacts.length === 0;
  const missing = [
    ...(readiness?.pending_required_items || []).map(item => `Pendiente requerido: ${item.title}`),
    ...(readiness?.active_blockers || []).map(item => `Bloqueante activo: ${item.title}`),
    ...(readiness?.unapproved_artifacts || []).map(item => `Documento sin aprobar: ${item.title}`),
  ];

  return <section className="panel tender-dossier-panel" id="tender-dossier">
    <div className="tender-dossier-header">
      <div><small>Preparación post-GO</small><h2>Expediente de oferta</h2><p>Trabajo humano trazable antes de presentar la oferta.</p></div>
      {workspace && <span className={`badge ${readiness?.ready ? 'badge-success' : 'badge-warning'}`}>{readiness?.ready ? 'Listo para presentar' : 'Faltan requisitos'}</span>}
    </div>
    {error && <div className="notice" role="alert">{error}</div>}
    {loading && !workspace && <p className="muted">Cargando expediente…</p>}

    {workspace && <>
      <div className={`document-status-card tender-dossier-readiness ${readiness?.ready ? 'is-ready' : ''}`}>
        <small>Gate de presentación</small>
        <strong>{readiness?.ready ? 'Listo para presentar' : 'Faltan requisitos'}</strong>
        {readiness?.ready
          ? <p>Todos los requisitos obligatorios están listos, no hay bloqueantes y las versiones vigentes están aprobadas.</p>
          : missing.length > 0 && <ul>{missing.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
        {readiness?.ready && !workspace.can_mark_ready && <p className="muted">La transición final requiere aprobación de dirección.</p>}
      </div>

      {emptyWorkspace && <div className="notice tender-dossier-empty"><p>Esta oportunidad estaba en GO antes de inicializar el expediente operativo.</p>{canApprove ? <button type="button" disabled={seeding} onClick={() => void initialize()}>{seeding ? 'Inicializando…' : 'Inicializar expediente'}</button> : <p className="muted">Dirección debe inicializar el expediente.</p>}</div>}

      {!emptyWorkspace && <div className="document-analysis-grid tender-dossier-grid">
        <TenderDossierChecklist opportunityId={opportunityId} workspace={workspace} request={request} profiles={profiles} canApprove={canApprove} onChanged={reload} />
        <TenderDossierArtifacts opportunityId={opportunityId} artifacts={workspace.artifacts} request={request} canApprove={canApprove} onChanged={reload} />
      </div>}

      {workspace.workbench_enabled && <TenderDossierVigiaWorkbench opportunityId={opportunityId} request={request} />}
    </>}
  </section>;
}
