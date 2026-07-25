import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadTenderOpportunities } from './api';
import { TenderStatusBadge } from './components/TenderStatusBadge';
import { tenderDecisionLabel, tenderDocumentStatusLabel, tenderOfferStatusLabel, tenderStatusTone } from './statusLabels';
import { dossierPageQuery, reloadCurrentDossierPage as reloadDossierPage } from './viewUtils';
import type { TenderDocumentRefreshResult, TenderOpportunityFilter, TenderOpportunitySummary, TendersModuleProps } from './types';

const PAGE_SIZE = 25;

type TenderOpportunitiesViewProps = TendersModuleProps & { moduleNavigation: ReactNode };

export function TenderOpportunitiesView({ request, navigate, moduleNavigation }: TenderOpportunitiesViewProps) {
  const [rows, setRows] = useState<TenderOpportunitySummary[]>([]);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<TenderOpportunityFilter>('all');
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
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
    setRetrying(dossier.opportunity_id); setError(null);
    try {
      const result = await request<TenderDocumentRefreshResult>('/api/tender-documents-import', { method: 'POST', body: JSON.stringify({ opportunity_id: dossier.opportunity_id }) });
      setRefreshResults(current => ({ ...current, [dossier.opportunity_id]: result }));
      await reloadCurrentDossierPage();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRetrying(null); }
  };

  if (loading && !rows.length) return <div className="notice">Cargando expedientes…</div>;
  return <section className="stack tenders-page tender-dossiers-view" aria-labelledby="tender-dossiers-heading">
    <header className="tracking-header"><div><span className="eyebrow">Bandeja de oportunidades</span><h2 id="tender-dossiers-heading">Oportunidades</h2><p>Gestione oportunidades convertidas, su expediente, decisión y preparación.</p></div><button className="secondary" onClick={() => void reloadCurrentDossierPage()} disabled={loading}>Recargar oportunidades</button></header>
    {moduleNavigation}
    {error && <div className="error" role="alert">{error}</div>}
    <label className="field"><span>Filtrar oportunidades</span><select value={filter} onChange={event => { setFilter(event.target.value as TenderOpportunityFilter); setPage(1); }} disabled={loading}>
      <option value="all">Todas</option><option value="pending_decision">Pendiente de decisión</option><option value="go_authorized">GO registrado</option><option value="in_preparation">En preparación</option><option value="submitted">Presentadas</option><option value="closed">Cerradas</option>
    </select></label>
    {!rows.length ? <div className="notice">No hay expedientes convertidos en esta página.</div> : <div className="tracking-queue">{rows.map(dossier => <article key={dossier.opportunity_id} className="card tracking-row">
      <div className="tracking-row-head"><div><div className="tender-card-kickers"><TenderStatusBadge label={tenderDocumentStatusLabel(dossier.document_import_status)} tone={tenderStatusTone(dossier.document_import_status)} /><TenderStatusBadge label={dossier.risk || 'Riesgo pendiente'} tone={tenderStatusTone(dossier.risk)} /></div><h3>{dossier.entity || 'Oportunidad convertida'}</h3><p>{dossier.title || dossier.opportunity_id}</p></div><TenderStatusBadge label={tenderOfferStatusLabel(dossier.tender_offer_status)} tone={tenderStatusTone(dossier.tender_offer_status)} /></div>
      {dossier.dossier_error && <div className="error" role="alert">{dossier.dossier_error}</div>}
      <dl className="tracking-metadata"><div><dt>Recomendación del sistema</dt><dd>{dossier.recommendation || 'Pendiente'}</dd></div><div><dt>Decisión humana</dt><dd>{tenderDecisionLabel(dossier.decision)}{dossier.decided_by_name ? ` · ${dossier.decided_by_name}` : ''}{dossier.decided_at ? ` · ${new Date(dossier.decided_at).toLocaleDateString('es-CO')}` : ''}</dd></div><div><dt>Estado de oferta</dt><dd>{tenderOfferStatusLabel(dossier.tender_offer_status)}</dd></div><div><dt>Documentos</dt><dd>{dossier.document_count} cargados · {dossier.missing_document_count} faltantes</dd></div><div><dt>Checklist</dt><dd>{dossier.checklist_progress ? `${dossier.checklist_progress.auto_generated || 0}/${dossier.checklist_progress.total || 0} automático` : 'Pendiente de análisis'}</dd></div><div><dt>Preparación</dt><dd>{dossier.preparation_status || 'Pendiente'}</dd></div><div><dt>Pendientes humanos</dt><dd>{dossier.human_pending_count || 0}</dd></div><div><dt>SharePoint / OneDrive</dt><dd>{dossier.sharepoint_url ? <a href={dossier.sharepoint_url} target="_blank" rel="noreferrer">{dossier.sharepoint_status || 'Abrir carpeta'}</a> : dossier.sharepoint_status || 'Pendiente'}</dd></div></dl>
      {dossier.document_import_error && <p className="muted">Estado documental: {dossier.document_import_error}</p>}
      {refreshResults[dossier.opportunity_id] && <p className="muted" role="status">Actualización: {refreshResults[dossier.opportunity_id].new_count} nuevos · {refreshResults[dossier.opportunity_id].updated_count} actualizados · {refreshResults[dossier.opportunity_id].unchanged_count} sin cambios · {refreshResults[dossier.opportunity_id].failed_count} fallidos.</p>}
      <div className="row-actions">{dossier.url && <a className="button secondary" href={dossier.url} target="_blank" rel="noreferrer">Abrir fuente oficial</a>}<button onClick={() => navigate(`#/detail/${dossier.opportunity_id}?focus=documents`)}>Abrir expediente</button><button className="secondary" onClick={() => void refreshDocuments(dossier)} disabled={retrying === dossier.opportunity_id}>{retrying === dossier.opportunity_id ? 'Actualizando…' : dossier.document_import_status === 'fallo_importacion' ? 'Reintentar actualización' : 'Actualizar documentos'}</button></div>
    </article>)}</div>}
    <nav className="pagination" aria-label="Paginación de expedientes"><button className="secondary" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>Anterior</button><span className="pagination-status">Página {page} · hasta {PAGE_SIZE} expedientes</span><button className="secondary" disabled={rows.length < PAGE_SIZE || loading} onClick={() => setPage(current => current + 1)}>Siguiente</button></nav>
  </section>;
}
