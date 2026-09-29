import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDateOnly, parseDateOnly } from '../dateOnly';
import { loadTenderOpportunities } from './api';
import { TenderStatusBadge } from './components/TenderStatusBadge';
import { tenderDetailSectionHref } from './detailNavigationState';
import { tenderDossierQueueState } from './dossierUtils';
import { classifyOpportunityStage, opportunityQueryFilter, type TenderOpportunityPrimaryFilter, type TenderOpportunityStage } from './opportunityStage';
import { tenderDecisionLabel, tenderDocumentStatusLabel, tenderOfferStatusLabel, tenderOpportunityPriorityLabel, tenderOpportunityStageLabel, tenderOpportunityStageTone, tenderStatusTone } from './statusLabels';
import { beginTenderRefresh, finishTenderRefresh, safePublicTenderSourceUrl } from './tenderUiState';
import { dossierPageQuery, reloadCurrentDossierPage as reloadDossierPage } from './viewUtils';
import type { TenderDocumentRefreshResult, TenderOpportunitySummary, TendersModuleProps } from './types';

const PAGE_SIZE = 25;

const opportunityOfferValueFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

function formatOpportunityOfferValue(value: number | null | undefined, fallback: string): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? opportunityOfferValueFormatter.format(value) : fallback;
}

function formatOpportunityLastUpdatedAt(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * `expected_close_date` es una columna `date` sin hora: los días restantes se calculan sobre el
 * calendario UTC verbatim (parseDateOnly), nunca sobre la hora local del navegador.
 */
function opportunityCloseRemainingLabel(value: string): string {
  const parts = parseDateOnly(value);
  if (!parts) return '';
  const target = Date.UTC(parts.year, parts.month - 1, parts.day);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((target - today) / 86400000);
  if (days > 0) return `vence en ${days} días`;
  if (days === 0) return 'vence hoy';
  return `venció hace ${Math.abs(days)} días`;
}

/** El backend ya propaga tracking_next_action; el clasificador derivado sólo es respaldo. */
function opportunityNextActionText(dossier: TenderOpportunitySummary, queueNextAction: string): string {
  const action = dossier.tracking_next_action || queueNextAction;
  const responsible = dossier.owner_name ? ` · Responsable: ${dossier.owner_name}` : '';
  const due = dossier.tracking_due_at ? ` · Vence ${formatDateOnly(dossier.tracking_due_at)}` : '';
  return `${action}${responsible}${due}`;
}

const opportunityStageRank: Record<TenderOpportunityStage, number> = { por_decidir: 0, en_curso: 1, cerradas: 2 };

type TenderOpportunitiesViewProps = TendersModuleProps & { moduleNavigation: ReactNode };

export function TenderOpportunitiesView({ request, navigate, moduleNavigation }: TenderOpportunitiesViewProps) {
  const [rows, setRows] = useState<TenderOpportunitySummary[]>([]);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<TenderOpportunityPrimaryFilter>('por_decidir');
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<Set<string>>(() => new Set());
  const retryingRef = useRef<Set<string>>(new Set());
  const [refreshResults, setRefreshResults] = useState<Record<string, TenderDocumentRefreshResult>>({});
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  // El backend sigue hablando su vocabulario (RPC 023, intacto): el filtro primario sólo se traduce
  // al bajar. Cada predicado SQL es igual o más estrecho que su estado primario, así que acotar en
  // el servidor nunca deja fuera una fila que el clasificador puro sí mostraría en esa página.
  const queryFilter = opportunityQueryFilter(filter);
  const query = useMemo(() => ({ ...dossierPageQuery(page, PAGE_SIZE), filter: queryFilter }), [queryFilter, page]);
  const reloadCurrentDossierPage = async () => {
    const requestVersion = ++requestVersionRef.current;
    setLoading(true); setError(null);
    try {
      const nextRows = await reloadDossierPage<TenderOpportunitySummary[]>(page, PAGE_SIZE, nextQuery => loadTenderOpportunities<TenderOpportunitySummary[]>(request, { ...nextQuery, filter: queryFilter }));
      if (requestVersion === requestVersionRef.current) setRows(nextRows);
    }
    catch (cause) { if (requestVersion === requestVersionRef.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (requestVersion === requestVersionRef.current) setLoading(false); }
  };
  useEffect(() => { void reloadCurrentDossierPage(); }, [query.filter, query.limit, query.offset]);

  // "Todas" no descarta ninguna fila: agrupa por_decidir, luego en_curso, luego cerradas, preservando
  // el orden relativo dentro de cada grupo (Array#sort es estable desde ES2019).
  const displayRows = useMemo(() => {
    if (filter !== 'all') return rows;
    return [...rows].sort((a, b) => opportunityStageRank[classifyOpportunityStage(a)] - opportunityStageRank[classifyOpportunityStage(b)]);
  }, [rows, filter]);

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
    <div className="opportunity-primary-filters" role="group" aria-label="Filtrar oportunidades">
      <button type="button" className="secondary" aria-pressed={filter === 'all'} disabled={loading} onClick={() => { setFilter('all'); setPage(1); }}>Todas</button>
      <button type="button" className="secondary" aria-pressed={filter === 'por_decidir'} disabled={loading} onClick={() => { setFilter('por_decidir'); setPage(1); }}>Por decidir</button>
      <button type="button" className="secondary" aria-pressed={filter === 'en_curso'} disabled={loading} onClick={() => { setFilter('en_curso'); setPage(1); }}>En curso</button>
    </div>
    {!displayRows.length ? <div className="notice">No hay expedientes convertidos en esta página.</div> : <div className="tracking-queue">{displayRows.map(dossier => {
      const stage = classifyOpportunityStage(dossier);
      const queueState = tenderDossierQueueState(dossier);
      const dossierError = queueState.error || dossier.dossier_error || dossier.document_import_error;
      const scoreTraceLabel = typeof dossier.score === 'number' && Number.isFinite(dossier.score) ? `Score histórico (solo trazabilidad): ${dossier.score}` : null;
      return <article key={dossier.opportunity_id} className="card tracking-row">
      <div className="tracking-row-head"><div><div className="tender-card-kickers"><TenderStatusBadge label={tenderDocumentStatusLabel(dossier.document_import_status)} tone={tenderStatusTone(dossier.document_import_status)} /><TenderStatusBadge label={dossier.risk || 'Riesgo pendiente'} tone={tenderStatusTone(dossier.risk)} /></div><h3>{dossier.entity || 'Oportunidad convertida'}</h3><p>{dossier.title || dossier.opportunity_id}</p></div><TenderStatusBadge label={tenderOfferStatusLabel(dossier.tender_offer_status)} tone={tenderStatusTone(dossier.tender_offer_status)} /></div>
      {dossierError && <div className="error" role="alert">{dossierError}</div>}
      <dl className="tracking-metadata opportunity-priority-metadata">
        <div><dt>Etapa</dt><dd><TenderStatusBadge label={tenderOpportunityStageLabel(stage)} tone={tenderOpportunityStageTone(stage)} /></dd></div>
        <div><dt>Monto</dt><dd>{formatOpportunityOfferValue(dossier.offer_value, 'Monto por definir')}</dd></div>
        <div><dt>Cierre</dt><dd>{dossier.expected_close_date ? `${formatDateOnly(dossier.expected_close_date)} · ${opportunityCloseRemainingLabel(dossier.expected_close_date)}` : 'Cierre por definir'}</dd></div>
        <div><dt>Responsable</dt><dd>{dossier.owner_name || 'Responsable por asignar'}</dd></div>
        <div><dt>Referencia</dt><dd>{dossier.ref || 'Referencia por definir'}</dd></div>
        <div><dt>Ubicación</dt><dd>{dossier.city || dossier.dept || 'Ubicación por definir'}</dd></div>
        <div><dt>Encaje</dt><dd>{dossier.fit?.band ?? 'sin datos'}</dd></div>
        <div><dt>Prioridad</dt><dd>{tenderOpportunityPriorityLabel(dossier.section)}</dd></div>
        <div><dt>Bloqueador</dt><dd>{dossier.tracking_blocker || 'Sin bloqueadores'}</dd></div>
        <div><dt>Última actualización</dt><dd>{formatOpportunityLastUpdatedAt(dossier.last_updated_at, 'Actualización por definir')}</dd></div>
      </dl>
      <dl className="tracking-metadata"><div><dt>Proceso actual</dt><dd>{queueState.process}</dd></div><div><dt>Siguiente acción</dt><dd>{opportunityNextActionText(dossier, queueState.nextAction)}</dd></div><div><dt>Decisión humana</dt><dd>{tenderDecisionLabel(dossier.decision)}{dossier.decided_by_name ? ` · ${dossier.decided_by_name}` : ''}{dossier.decided_at ? ` · ${new Date(dossier.decided_at).toLocaleDateString('es-CO')}` : ''}</dd></div><div><dt>Estado de oferta</dt><dd>{tenderOfferStatusLabel(dossier.tender_offer_status)}</dd></div></dl>
      <p className="muted">{tenderDocumentStatusLabel(dossier.document_import_status)} · {dossier.document_count ?? 0} documento(s) cargado(s) · {dossier.missing_document_count ?? 0} faltante(s)</p>
      {!!dossier.reasons?.length && <p className="muted">Razones: {dossier.reasons.join(', ')}</p>}
      {!!dossier.risks?.length && <p className="muted">Riesgos: {dossier.risks.join(', ')}</p>}
      {scoreTraceLabel && <p className="muted">{scoreTraceLabel}</p>}
      {refreshResults[dossier.opportunity_id] && <p className="muted" role="status">Actualización: {refreshResults[dossier.opportunity_id].new_count} nuevos · {refreshResults[dossier.opportunity_id].updated_count} actualizados · {refreshResults[dossier.opportunity_id].unchanged_count} sin cambios · {refreshResults[dossier.opportunity_id].failed_count} fallidos.</p>}
      <div className="row-actions">{safePublicTenderSourceUrl(dossier.url) && <a className="button secondary" href={safePublicTenderSourceUrl(dossier.url) || undefined} target="_blank" rel="noreferrer">Abrir fuente oficial</a>}<button onClick={() => navigate(tenderDetailSectionHref(dossier.opportunity_id, 'tender-document-review'))}>Abrir expediente</button><button className="secondary" onClick={() => void refreshDocuments(dossier)} disabled={retrying.has(dossier.opportunity_id)}>{retrying.has(dossier.opportunity_id) ? 'Actualizando…' : dossier.document_import_status === 'fallo_importacion' ? 'Reintentar actualización' : 'Actualizar documentos'}</button></div>
    </article>; })}</div>}
    <nav className="pagination" aria-label="Paginación de expedientes"><button className="secondary" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>Anterior</button><span className="pagination-status">Página {page} · hasta {PAGE_SIZE} expedientes</span><button className="secondary" disabled={rows.length < PAGE_SIZE || loading} onClick={() => setPage(current => current + 1)}>Siguiente</button></nav>
  </section>;
}
