import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadTenderOpportunities } from './api';
import { TenderStatusBadge } from './components/TenderStatusBadge';
import { tenderDossierQueueState } from './dossierUtils';
import { tenderDecisionLabel, tenderDocumentStatusLabel, tenderOfferStatusLabel, tenderPreparationStatusLabel, tenderSharePointStatusLabel, tenderStatusTone } from './statusLabels';
import { beginTenderRefresh, finishTenderRefresh, safePublicTenderSourceUrl } from './tenderUiState';
import { dossierPageQuery, reloadCurrentDossierPage as reloadDossierPage } from './viewUtils';
import type { TenderDocumentRefreshResult, TenderOpportunityFilter, TenderOpportunitySummary, TendersModuleProps } from './types';

const PAGE_SIZE = 25;

type TenderOpportunitiesViewProps = TendersModuleProps & { moduleNavigation: ReactNode };

export function TenderOpportunitiesView({ request, navigate, moduleNavigation }: TenderOpportunitiesViewProps) {
  const [rows, setRows] = useState<TenderOpportunitySummary[]>([]);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<TenderOpportunityFilter>('all');
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<Set<string>>(() => new Set());
  const retryingRef = useRef<Set<string>>(new Set());
  const [refreshResults, setRefreshResults] = useState<Record<string, TenderDocumentRefreshResult>>({});
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  const query = useMemo(() => ({ ...dossierPageQuery(page, PAGE_SIZE), filter }), [filter, page]);
  const reloadCurrentDossierPage = async () => {
    const requestVersion = ++requestVersionRef.current;
    setLoading(true); setError(null);
    try {
      const nextRows = await reloadDossierPage<TenderOpportunitySummary[]>(page, PAGE_SIZE, nextQuery => loadTenderOpportunities<TenderOpportunitySummary[]>(request, { ...nextQuery, filter }));
      if (requestVersion === requestVersionRef.current) setRows(nextRows);
    }
    catch (cause) { if (requestVersion === requestVersionRef.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (requestVersion === requestVersionRef.current) setLoading(false); }
  };
  useEffect(() => { void reloadCurrentDossierPage(); }, [query.filter, query.limit, query.offset]);

  const refreshDocuments = async (dossier: TenderOpportunitySummary) => {
    const id = dossier.opportunity_id;
    if (retryingRef.current.has(id)) return;
    retryingRef.current = beginTenderRefresh(retryingRef.current, id); setRetrying(retryingRef.current); setError(null);
    try {
      const result = await request<TenderDocumentRefreshResult>('/api/tender-documents-import', { method: 'POST', body: JSON.stringify({ opportunity_id: id }) });
      setRefreshResults(current => ({ ...current, [id]: result }));
      await reloadCurrentDossierPage();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { retryingRef.current = finishTenderRefresh(retryingRef.current, id); setRetrying(retryingRef.current); }
  };

  if (loading && !rows.length) return <div className="notice">Cargando expedientes…</div>;
  return <section className="stack tenders-page tender-dossiers-view" aria-labelledby="tender-dossiers-heading">
    <header className="tracking-header"><div><span className="eyebrow">Bandeja de oportunidades</span><h2 id="tender-dossiers-heading">Oportunidades</h2><p>Gestione oportunidades convertidas, su expediente, decisión y preparación.</p></div><button className="secondary" onClick={() => void reloadCurrentDossierPage()} disabled={loading}>Recargar oportunidades</button></header>
    {moduleNavigation}
    {error && <div className="error" role="alert">{error}</div>}
    <label className="field"><span>Filtrar oportunidades</span><select value={filter} onChange={event => { setFilter(event.target.value as TenderOpportunityFilter); setPage(1); }} disabled={loading}>
      <option value="all">Todas</option><option value="pending_decision">Pendiente de decisión</option><option value="go_authorized">GO registrado</option><option value="in_preparation">En preparación</option><option value="submitted">Presentadas</option><option value="closed">Cerradas</option>
    </select></label>
    {!rows.length ? <div className="notice">No hay expedientes convertidos en esta página.</div> : <div className="tracking-queue">{rows.map(dossier => { const queueState = tenderDossierQueueState(dossier); const dossierError = queueState.error || dossier.dossier_error || dossier.document_import_error; return <article key={dossier.opportunity_id} className="card tracking-row">
      <div className="tracking-row-head"><div><div className="tender-card-kickers"><TenderStatusBadge label={tenderDocumentStatusLabel(dossier.document_import_status)} tone={tenderStatusTone(dossier.document_import_status)} /><TenderStatusBadge label={dossier.risk || 'Riesgo pendiente'} tone={tenderStatusTone(dossier.risk)} /></div><h3>{dossier.entity || 'Oportunidad convertida'}</h3><p>{dossier.title || dossier.opportunity_id}</p></div><TenderStatusBadge label={tenderOfferStatusLabel(dossier.tender_offer_status)} tone={tenderStatusTone(dossier.tender_offer_status)} /></div>
      {dossierError && <div className="error" role="alert">{dossierError}</div>}
      <dl className="tracking-metadata"><div><dt>Proceso actual</dt><dd>{queueState.process}</dd></div><div><dt>Siguiente acción</dt><dd>{queueState.nextAction}</dd></div><div><dt>Recomendación del sistema</dt><dd>{dossier.recommendation || 'Pendiente'}</dd></div><div><dt>Decisión humana</dt><dd>{tenderDecisionLabel(dossier.decision)}{dossier.decided_by_name ? ` · ${dossier.decided_by_name}` : ''}{dossier.decided_at ? ` · ${new Date(dossier.decided_at).toLocaleDateString('es-CO')}` : ''}</dd></div><div><dt>Estado de oferta</dt><dd>{tenderOfferStatusLabel(dossier.tender_offer_status)}</dd></div><div><dt>Documentos</dt><dd>{dossier.document_count} cargados · {dossier.missing_document_count} faltantes</dd></div><div><dt>Checklist</dt><dd>{dossier.checklist_progress ? `${dossier.checklist_progress.auto_generated || 0}/${dossier.checklist_progress.total || 0} automático` : 'Pendiente de análisis'}</dd></div><div><dt>Preparación</dt><dd>{tenderPreparationStatusLabel(dossier.preparation_status)}</dd></div><div><dt>Pendientes humanos</dt><dd>{dossier.human_pending_count || 0}</dd></div><div><dt>SharePoint / OneDrive</dt><dd>{safePublicTenderSourceUrl(dossier.sharepoint_url) ? <a href={safePublicTenderSourceUrl(dossier.sharepoint_url) || undefined} target="_blank" rel="noreferrer">{tenderSharePointStatusLabel(dossier.sharepoint_status)}</a> : tenderSharePointStatusLabel(dossier.sharepoint_status)}</dd></div></dl>
      {refreshResults[dossier.opportunity_id] && <p className="muted" role="status">Actualización: {refreshResults[dossier.opportunity_id].new_count} nuevos · {refreshResults[dossier.opportunity_id].updated_count} actualizados · {refreshResults[dossier.opportunity_id].unchanged_count} sin cambios · {refreshResults[dossier.opportunity_id].failed_count} fallidos.</p>}
      <div className="row-actions">{safePublicTenderSourceUrl(dossier.url) && <a className="button secondary" href={safePublicTenderSourceUrl(dossier.url) || undefined} target="_blank" rel="noreferrer">Abrir fuente oficial</a>}<button onClick={() => navigate(`#/detail/${dossier.opportunity_id}?focus=documents`)}>Abrir expediente</button><button className="secondary" onClick={() => void refreshDocuments(dossier)} disabled={retrying.has(dossier.opportunity_id)}>{retrying.has(dossier.opportunity_id) ? 'Actualizando…' : dossier.document_import_status === 'fallo_importacion' ? 'Reintentar actualización' : 'Actualizar documentos'}</button></div>
    </article>; })}</div>}
    <nav className="pagination" aria-label="Paginación de expedientes"><button className="secondary" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>Anterior</button><span className="pagination-status">Página {page} · hasta {PAGE_SIZE} expedientes</span><button className="secondary" disabled={rows.length < PAGE_SIZE || loading} onClick={() => setPage(current => current + 1)}>Siguiente</button></nav>
  </section>;
}
