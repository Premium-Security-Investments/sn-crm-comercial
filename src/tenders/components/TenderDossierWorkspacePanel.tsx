import { useCallback, useEffect, useRef, useState } from 'react';
import './tender-dossier.css';
import { loadTenderDossierWorkspace, loadTenderOfferStatus, seedTenderDossier } from '../api';
import type { TenderDossierAssignee, TenderDossierWorkspace, TenderOfferStatus, TenderRequest } from '../types';
import { TenderDossierArtifacts } from './TenderDossierArtifacts';
import { TenderDossierChecklist } from './TenderDossierChecklist';
import { TenderDossierVigiaWorkbench } from './TenderDossierVigiaWorkbench';

const ACTIVE_STATUSES = new Set<TenderOfferStatus>(['en_preparacion', 'lista_para_presentar', 'presentada', 'adjudicada', 'no_adjudicada']);

export function TenderDossierWorkspacePanel({ opportunityId, request, profiles, canApprove, onChanged }: {
  opportunityId: string;
  request: TenderRequest;
  profiles: TenderDossierAssignee[];
  canApprove: boolean;
  /**
   * Aviso al contenedor tras una mutación ya confirmada del expediente, para que vuelva a leer la
   * disponibilidad canónica (el gate de "Marcar lista para presentar" vive en otro panel). El
   * contenedor sólo incrementa con él la revisión de disponibilidad, que viaja como prop y no como
   * key: ni este panel ni la preparación se remontan, así que los borradores locales sobreviven.
   * Nunca se dispara desde las cargas iniciales, que no cambian nada en el backend.
   */
  onChanged?: () => Promise<void> | void;
  /**
   * Pista del bootstrap, deliberadamente NO desestructurada ni usada: llega desactualizada justo
   * después de registrar GO (la oportunidad del listado aún dice `pendiente_decision`) y hacía que
   * el expediente devolviera null. Se acepta sólo para no romper el punto de montaje existente.
   */
  offerStatus?: TenderOfferStatus | null;
}) {
  const [offerStatus, setOfferStatus] = useState<TenderOfferStatus | null>(null);
  const [workspace, setWorkspace] = useState<TenderDossierWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState('');
  const statusVersionRef = useRef(0);
  const workspaceVersionRef = useRef(0);
  // El callback llega inline desde el contenedor (identidad nueva en cada render); guardarlo en una
  // ref mantiene estable el handler de mutación y deja `reload` fuera del ciclo de avisos.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  // El bootstrap puede traer un `tender_offer_status` anterior al GO recién registrado, así que el
  // expediente resuelve su propio estado canónico contra /api/tender-offer-status. Falla cerrado:
  // si la lectura no llega, el estado queda en null y el panel no se monta.
  useEffect(() => {
    const version = ++statusVersionRef.current;
    workspaceVersionRef.current += 1;
    setOfferStatus(null);
    setWorkspace(null);
    setError('');
    void (async () => {
      try {
        const payload = await loadTenderOfferStatus(request, opportunityId);
        if (version !== statusVersionRef.current) return;
        setOfferStatus(payload.status);
      } catch {
        if (version !== statusVersionRef.current) return;
        setOfferStatus(null);
      }
    })();
  }, [opportunityId, request]);

  const enabled = offerStatus ? ACTIVE_STATUSES.has(offerStatus) : false;

  const reload = useCallback(async () => {
    if (!enabled) return;
    const version = ++workspaceVersionRef.current;
    setLoading(true);
    try {
      const next = await loadTenderDossierWorkspace(request, opportunityId);
      if (version !== workspaceVersionRef.current) return;
      setWorkspace(next);
      setError('');
    } catch (cause) {
      if (version !== workspaceVersionRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (version === workspaceVersionRef.current) setLoading(false);
    }
  }, [enabled, opportunityId, request]);

  // Carga inicial (y recarga por cambio de oportunidad/estado): nunca avisa al contenedor. No hay
  // nada que releer aguas arriba si el expediente no cambió, y el aviso queda reservado a las
  // mutaciones confirmadas.
  useEffect(() => {
    void reload();
  }, [reload]);

  // Único camino de aviso: mutaciones ya confirmadas por el backend. Recarga local para reflejarlas
  // de inmediato y luego avisa al contenedor, que incrementa la revisión de disponibilidad para que
  // el gate de "Marcar lista para presentar" se relea sin remontar nada.
  const handleCommittedMutation = useCallback(async () => {
    await reload();
    await onChangedRef.current?.();
  }, [reload]);

  const initialize = async () => {
    setSeeding(true); setError('');
    try {
      await seedTenderDossier(request, opportunityId);
      // Una sola recarga y un solo aviso: el seed legacy también cambia la disponibilidad canónica.
      await handleCommittedMutation();
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
  const missingSummary = [
    readiness?.pending_required_items?.length ? `${readiness.pending_required_items.length} tareas obligatorias por terminar` : '',
    readiness?.active_blockers?.length ? `${readiness.active_blockers.length} bloqueos` : '',
    readiness?.unapproved_artifacts?.length ? `${readiness.unapproved_artifacts.length} documentos sin aprobar` : '',
  ].filter(Boolean).join(' · ');

  return <section className="panel tender-dossier-panel" id="tender-dossier">
    <div className="tender-dossier-header">
      <div><small>Después del GO</small><h2>Preparación de la oferta</h2><p>Lo que hay que reunir y aprobar antes de presentar.</p></div>
      {workspace && <span className={`badge ${readiness?.ready ? 'badge-success' : 'badge-warning'}`}>{readiness?.ready ? 'Listo para presentar' : 'Faltan requisitos'}</span>}
    </div>
    {error && <div className="notice" role="alert">{error}</div>}
    {loading && !workspace && <p className="muted">Cargando expediente…</p>}

    {workspace && <>
      <div className={`document-status-card tender-dossier-readiness ${readiness?.ready ? 'is-ready' : ''}`}>
        <small>Para poder presentar</small>
        <strong>{readiness?.ready ? 'Listo para presentar' : missingSummary || 'Faltan requisitos'}</strong>
        {readiness?.ready
          ? <p>Todas las tareas obligatorias están listas, no hay bloqueos y los documentos están aprobados.</p>
          : missing.length > 0 && <details className="tender-dossier-missing"><summary>Ver el detalle ({missing.length})</summary><ul>{missing.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></details>}
        {readiness?.ready && !workspace.can_mark_ready && <p className="muted">La transición final requiere aprobación de dirección.</p>}
      </div>

      {emptyWorkspace && <div className="notice tender-dossier-empty"><p>Esta oportunidad estaba en GO antes de inicializar el expediente operativo.</p>{canApprove ? <button type="button" disabled={seeding} onClick={() => void initialize()}>{seeding ? 'Inicializando…' : 'Inicializar expediente'}</button> : <p className="muted">Dirección debe inicializar el expediente.</p>}</div>}

      {!emptyWorkspace && <div className="document-analysis-grid tender-dossier-grid">
        <TenderDossierChecklist opportunityId={opportunityId} workspace={workspace} request={request} profiles={profiles} canApprove={canApprove} onChanged={handleCommittedMutation} />
        <TenderDossierArtifacts opportunityId={opportunityId} artifacts={workspace.artifacts} request={request} canApprove={canApprove} onChanged={handleCommittedMutation} />
      </div>}

      {workspace.workbench_enabled && <TenderDossierVigiaWorkbench opportunityId={opportunityId} request={request} />}
    </>}
  </section>;
}
