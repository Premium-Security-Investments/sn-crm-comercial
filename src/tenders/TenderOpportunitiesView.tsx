import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDateOnly, parseDateOnly } from '../dateOnly';
import { loadTenderOpportunities } from './api';
import { TenderStatusBadge } from './components/TenderStatusBadge';
import { tenderDetailSectionHref } from './detailNavigationState';
import { tenderDossierQueueState } from './dossierUtils';
import { classifyOpportunityStage, opportunityQueryFilter, type TenderOpportunityPrimaryFilter, type TenderOpportunityStage } from './opportunityStage';
import { tenderDecisionLabel, tenderDocumentStatusLabel, tenderOfferStatusLabel, tenderOpportunityStageLabel, tenderOpportunityStageTone, tenderStatusTone } from './statusLabels';
import { readableTenderTitle, tenderFitBadgeLabel, tenderFitPlainReasons } from './radarUtils';
import { beginTenderRefresh, finishTenderRefresh, safePublicTenderSourceUrl } from './tenderUiState';
import { dossierPageQuery, reloadCurrentDossierPage as reloadDossierPage, sortTenderOpportunitySummaries } from './viewUtils';
import type { TenderDocumentRefreshResult, TenderOpportunitySummary, TenderOpportunityVigiaAnalysis, TendersModuleProps } from './types';

const PAGE_SIZE = 25;

const opportunityOfferValueFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

function formatOpportunityOfferValue(value: number | null | undefined, fallback: string): string {
  if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) return fallback;
  // Los montos de licitación son de miles de millones: en millones caben en la casilla sin partirse.
  if (value >= 1_000_000_000) return `$${Math.round(value / 1_000_000).toLocaleString('es-CO')} millones`;
  return opportunityOfferValueFormatter.format(value);
}

const VIGIA_RECOMMENDATION_LABELS: Record<string, string> = {
  GO_RECOMMENDED: 'Seguir',
  CONTINUE_RECOMMENDED: 'Seguir',
  CONTINUE_CONDITIONAL_RECOMMENDED: 'Seguir con condiciones',
  HOLD_RECOMMENDED: 'Esperar antes de decidir',
  NO_GO_RECOMMENDED: 'No presentarse',
};
const VIGIA_CONFIDENCE_LABELS: Record<string, string> = { HIGH: 'confianza alta', MEDIUM: 'confianza media', LOW: 'confianza baja' };

function vigiaRecommendationTitle(analysis: TenderOpportunityVigiaAnalysis): string {
  const label = (analysis.recommendation_kind && VIGIA_RECOMMENDATION_LABELS[analysis.recommendation_kind]) || 'Análisis disponible';
  const confidence = analysis.confidence ? VIGIA_CONFIDENCE_LABELS[analysis.confidence] : null;
  return confidence ? `${label} · ${confidence}` : label;
}

/** El análisis oficial de Vig-IA manda sobre el estado del preanálisis antiguo, que sólo mira los documentos. */
function opportunityProcessState(dossier: TenderOpportunitySummary, queueState: { process: string; nextAction: string }) {
  const analysis = dossier.vigia_analysis;
  if (analysis?.in_progress) return { process: 'Vig-IA está analizando', nextAction: 'Esperar el análisis de Vig-IA' };
  if (analysis?.run_id && !dossier.decision && queueState.process === 'Análisis pendiente') {
    return { process: 'Analizado por Vig-IA', nextAction: 'Revisar el análisis y decidir GO / NO GO' };
  }
  return queueState;
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

type TenderOpportunitiesViewProps = TendersModuleProps & { moduleNavigation: ReactNode };

export function TenderOpportunitiesView({ request, navigate, moduleNavigation }: TenderOpportunitiesViewProps) {
  const [rows, setRows] = useState<TenderOpportunitySummary[]>([]);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<TenderOpportunityPrimaryFilter>('por_decidir');
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<Set<string>>(() => new Set());
  const [archivingId, setArchivingId] = useState<string | null>(null);
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

  // La bandeja de convertidas debe priorizar el cierre más próximo en Todas y en cada estado.
  const displayRows = useMemo(() => sortTenderOpportunitySummaries(rows), [rows]);

  const archiveOpportunity = async (dossier: TenderOpportunitySummary) => {
    if (dossier.archived_at || classifyOpportunityStage(dossier) !== 'en_curso' || !['en_preparacion', 'lista_para_presentar'].includes(dossier.tender_offer_status)) return;
    if (!window.confirm('Esta oportunidad se archivará porque definitivamente no nos presentaremos. ¿Desea continuar?')) return;
    const reason = window.prompt('Indique el motivo por el que no nos presentaremos:')?.trim();
    if (!reason) return;
    setArchivingId(dossier.opportunity_id); setError(null);
    try {
      await request('/api/tender-offer-archive', { method: 'POST', body: JSON.stringify({ opportunity_id: dossier.opportunity_id, expected_tender_offer_status: dossier.tender_offer_status, note: reason }) });
      await reloadCurrentDossierPage();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setArchivingId(null); }
  };

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
    <header className="tender-compact-header"><div className="tender-compact-title"><h2 id="tender-dossiers-heading">Oportunidades</h2><div className="tender-compact-meta"><span>Licitaciones convertidas: expediente, decisión y preparación</span></div></div><div className="row-actions"><button className="secondary" onClick={() => void reloadCurrentDossierPage()} disabled={loading}>Recargar oportunidades</button></div></header>
    {moduleNavigation}
    {error && <div className="error" role="alert">{error}</div>}
    <div className="opportunity-primary-filters" role="group" aria-label="Filtrar oportunidades">
      <button type="button" className="secondary" aria-pressed={filter === 'all'} disabled={loading} onClick={() => { setFilter('all'); setPage(1); }}>Todas</button>
      <button type="button" className="secondary" aria-pressed={filter === 'por_decidir'} disabled={loading} onClick={() => { setFilter('por_decidir'); setPage(1); }}>Por decidir</button>
      <button type="button" className="secondary" aria-pressed={filter === 'en_curso'} disabled={loading} onClick={() => { setFilter('en_curso'); setPage(1); }}>En curso</button>
      <button type="button" className="secondary" aria-pressed={filter === 'archivadas'} disabled={loading} onClick={() => { setFilter('archivadas'); setPage(1); }}>Archivadas</button>
    </div>
    {!displayRows.length ? <div className="notice">No hay expedientes convertidos en esta página.</div> : <div className="tracking-queue">{displayRows.map(dossier => {
      const stage = classifyOpportunityStage(dossier);
      const queueState = tenderDossierQueueState(dossier);
      const dossierError = queueState.error || dossier.dossier_error || dossier.document_import_error;
      const processState = opportunityProcessState(dossier, queueState);
      const analysis = dossier.vigia_analysis;
      const plainReasons = tenderFitPlainReasons(dossier.fit, 3);
      const decisionText = dossier.decision ? `${tenderDecisionLabel(dossier.decision)}${dossier.decided_by_name ? ` · ${dossier.decided_by_name}` : ''}${dossier.decided_at ? ` · ${new Date(dossier.decided_at).toLocaleDateString('es-CO')}` : ''}` : null;
      const refreshResult = refreshResults[dossier.opportunity_id];
      return <article key={dossier.opportunity_id} className="card tracking-row opportunity-card">
      <div className="tracking-row-head"><div><div className="tender-card-tags"><TenderStatusBadge label={tenderOpportunityStageLabel(stage)} tone={tenderOpportunityStageTone(stage)} /><span className={`badge tender-fit-${dossier.fit?.band || 'por_validar'}`}>{tenderFitBadgeLabel(dossier.fit)}</span>{dossier.decision && <TenderStatusBadge label={tenderOfferStatusLabel(dossier.tender_offer_status)} tone={tenderStatusTone(dossier.tender_offer_status)} />}</div><h3>{dossier.entity || 'Oportunidad convertida'}</h3><p className="tender-card-object" title={dossier.title || undefined}>{readableTenderTitle(dossier.title) || dossier.opportunity_id}</p></div></div>
      {dossierError && <div className="error" role="alert">{dossierError}</div>}
      <dl className="tracking-metadata opportunity-facts">
        <div><dt>Monto</dt><dd>{formatOpportunityOfferValue(dossier.offer_value, 'Por definir')}</dd></div>
        <div><dt>Cierre</dt><dd>{dossier.expected_close_date ? <>{formatDateOnly(dossier.expected_close_date)}<small>{opportunityCloseRemainingLabel(dossier.expected_close_date)}</small></> : 'Por definir'}</dd></div>
        <div><dt>Ubicación</dt><dd>{dossier.city || dossier.dept || 'Por definir'}</dd></div>
        <div><dt>Responsable</dt><dd>{dossier.owner_name || 'Por asignar'}</dd></div>
        <div><dt>Referencia</dt><dd>{dossier.ref || 'Por definir'}</dd></div>
      </dl>
      <section className="opportunity-vigia" aria-label="Lo que dice Vig-IA">
        <span className="filter-label">Lo que dice Vig-IA</span>
        {analysis?.in_progress && <strong>Analizando los documentos…</strong>}
        {!analysis?.in_progress && analysis?.run_id && <><strong>{vigiaRecommendationTitle(analysis)}{analysis.completed_at ? <small> · {formatOpportunityLastUpdatedAt(analysis.completed_at, '')}</small> : null}</strong>{analysis.recommendation_label && <p>{analysis.recommendation_label}</p>}</>}
        {!analysis?.in_progress && !analysis?.run_id && <strong>Sin análisis de Vig-IA todavía</strong>}
        {plainReasons.length > 0 && <p className="muted">Encaje: {plainReasons.join(' · ')}</p>}
      </section>
      <p className="opportunity-next"><strong>Siguiente paso:</strong> {opportunityNextActionText(dossier, processState.nextAction)}{decisionText ? <> · <strong>Decisión:</strong> {decisionText}</> : null}{dossier.tracking_blocker ? <> · <strong>Bloqueo:</strong> {dossier.tracking_blocker}</> : null}</p>
      <p className="muted opportunity-footnote">{dossier.document_count ?? 0} documentos{dossier.missing_document_count ? ` · ${dossier.missing_document_count} faltantes` : ''} · Actualizada {formatOpportunityLastUpdatedAt(dossier.last_updated_at, '—')}</p>
      {refreshResult && <p className="muted" role="status">Actualización: {refreshResult.new_count} nuevos · {refreshResult.updated_count} actualizados · {refreshResult.unchanged_count} sin cambios · {refreshResult.failed_count} fallidos.</p>}
      <div className="row-actions">{safePublicTenderSourceUrl(dossier.url) && <a className="button secondary" href={safePublicTenderSourceUrl(dossier.url) || undefined} target="_blank" rel="noreferrer">Abrir fuente oficial</a>}<button onClick={() => navigate(tenderDetailSectionHref(dossier.opportunity_id, 'tender-document-review'))}>Abrir expediente</button><button className="secondary" onClick={() => void refreshDocuments(dossier)} disabled={retrying.has(dossier.opportunity_id)}>{retrying.has(dossier.opportunity_id) ? 'Actualizando…' : dossier.document_import_status === 'fallo_importacion' ? 'Reintentar actualización' : 'Actualizar documentos'}</button>{classifyOpportunityStage(dossier) === 'en_curso' && ['en_preparacion', 'lista_para_presentar'].includes(dossier.tender_offer_status) && <button className="secondary danger" onClick={() => void archiveOpportunity(dossier)} disabled={archivingId === dossier.opportunity_id}>{archivingId === dossier.opportunity_id ? 'Archivando…' : 'Archivar: no nos presentamos'}</button>}</div>
    </article>; })}</div>}
    <nav className="pagination" aria-label="Paginación de expedientes"><button className="secondary" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>Anterior</button><span className="pagination-status">Página {page} · hasta {PAGE_SIZE} expedientes</span><button className="secondary" disabled={rows.length < PAGE_SIZE || loading} onClick={() => setPage(current => current + 1)}>Siguiente</button></nav>
  </section>;
}
