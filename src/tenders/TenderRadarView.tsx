import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { enterTrackingFromRadar, loadProfiles, loadRadar, loadRadarRunDelta, loadRadarRunReceiptHistory, loadRadarRunReceiptLatest } from './api';
import { TenderSavedSearches } from './components/TenderSavedSearches';
import { tenderDetailSectionHref } from './detailNavigationState';
import { tenderDocumentStatusLabel } from './statusLabels';
import { safePublicTenderSourceUrl } from './tenderUiState';
import { TENDER_OFFICIAL_SOURCES, TENDER_RADAR_RUN_DELTA_SELECTABLE_CATEGORIES, TENDER_SN_REGIONS, deduplicateTenders, filterRadarTenders, isTenderExpired, sortTenderCards, tenderFitBadgeLabel, tenderFitReasonDetails, tenderPhaseContinuityLabel, tenderRadarRunDeltaCardLabels, tenderRadarRunDeltaCategoryLabel, tenderRadarRunDeltaSourceEvents, tenderRadarRunDeltaStableKeysForCategory, tenderRadarRunReceiptCoverageRatio, tenderRadarRunReceiptHistoryOrdered, tenderRadarRunReceiptSourceStatusLabel, tenderRadarRunReceiptStatusLabel, tenderRadarRunReceiptTimeLabel } from './radarUtils';
import type { PublicTender, TenderConversionResult, TenderDeadlineFilter, TenderInternalStatus, TenderRadarFilters, TenderRadarPayload, TenderRadarRunDelta, TenderRadarRunDeltaCategory, TenderRadarRunReceipt, TenderRegionKey, TenderScoreFilter, TenderSearchProfile, TenderSection, TenderSortKey, TenderValueFilter, TendersModuleProps } from './types';
import { isTenderReadOnlyProfile } from './permissions';

const PAGE_SIZE = 24;
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function deadlineLabel(value?: string | null) {
  if (!value) return 'Sin fecha';
  if (DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return date.format(new Date(Date.UTC(year, month - 1, day, 12)));
  }
  return date.format(new Date(value));
}
function statusLabel(tender: PublicTender) { return tender.internal_status === 'convertida_oportunidad' ? 'Convertida en oportunidad' : tender.internal_status === 'en_revision' ? 'En seguimiento' : tender.internal_status === 'descartada' ? 'Descartada' : 'Nueva'; }
function importMessage(result: TenderConversionResult) {
  if (result.document_import_status === 'analisis_generado') return 'Oportunidad creada. Documentos oficiales importados y análisis generado.';
  if (result.document_import_status) return `Oportunidad creada. Estado documental: ${tenderDocumentStatusLabel(result.document_import_status)}.${result.document_import_error ? ` ${result.document_import_error}` : ''}`;
  return 'Oportunidad creada. El detalle mostrará el estado documental real.';
}

export async function loadRadarAndProfiles<Radar, Profile>(
  loadRadarResource: () => Promise<Radar>,
  loadProfilesResource: () => Promise<Profile[]>,
): Promise<{ radar: Radar; profiles: Profile[]; profilesError: string | null }> {
  const [radarResult, profilesResult] = await Promise.allSettled([loadRadarResource(), loadProfilesResource()]);
  if (radarResult.status === 'rejected') throw radarResult.reason;
  if (profilesResult.status === 'fulfilled') return { radar: radarResult.value, profiles: profilesResult.value, profilesError: null };
  const cause = profilesResult.reason;
  return { radar: radarResult.value, profiles: [], profilesError: cause instanceof Error ? cause.message : String(cause) };
}

type TenderRadarViewProps = TendersModuleProps & { moduleNavigation: ReactNode };

export function TenderRadarView({ data, refresh, request, navigate, moduleNavigation }: TenderRadarViewProps) {
  const readOnly = isTenderReadOnlyProfile(data.currentProfile);
  const [payload, setPayload] = useState<TenderRadarPayload | null>(null);
  const [profiles, setProfiles] = useState<TenderSearchProfile[]>([]);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');
  const [conversion, setConversion] = useState<TenderConversionResult | null>(null);
  const [runReceipt, setRunReceipt] = useState<TenderRadarRunReceipt | null>(null);
  const [runHistory, setRunHistory] = useState<TenderRadarRunReceipt[]>([]);
  const [runReceiptError, setRunReceiptError] = useState<string | null>(null);
  const [runReceiptLoading, setRunReceiptLoading] = useState(true);
  const [runDelta, setRunDelta] = useState<TenderRadarRunDelta | null>(null);
  const [runDeltaError, setRunDeltaError] = useState<string | null>(null);
  const [selectedDeltaCategory, setSelectedDeltaCategory] = useState<TenderRadarRunDeltaCategory | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('todas');
  const [region, setRegion] = useState<TenderRegionKey>('todas');
  const [deadline, setDeadline] = useState<TenderDeadlineFilter>('todas');
  const [value, setValue] = useState<TenderValueFilter>('todas');
  const [score, setScore] = useState<TenderScoreFilter>('todas');
  const section: TenderSection | 'todas' = 'todas';
  const internalStatus: TenderInternalStatus | 'todas' = 'todas';
  const [sort, setSort] = useState<TenderSortKey>('score');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const profileId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('profile') || '';
  const focusTenderId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('tender') || '';

  const load = async () => {
    setLoading(true); setError(null); setProfilesError(null);
    try {
      const loaded = await loadRadarAndProfiles(
        () => loadRadar<TenderRadarPayload>(request),
        () => loadProfiles<TenderSearchProfile[]>(request),
      );
      setPayload(loaded.radar); setProfiles(loaded.profiles); setProfilesError(loaded.profilesError);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  // Recibo de corrida: independiente de la lista de licitaciones, nunca debe bloquearla si falla.
  const loadRunReceipts = async () => {
    setRunReceiptLoading(true);
    try {
      const [latest, history] = await Promise.all([loadRadarRunReceiptLatest(request), loadRadarRunReceiptHistory(request, 10)]);
      setRunReceipt(latest.run_receipt); setRunHistory(history.run_receipts); setRunReceiptError(null);
    } catch (cause) { setRunReceiptError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRunReceiptLoading(false); }
  };
  // Delta de corrida: independiente de la lista de licitaciones, nunca debe bloquearla si falla.
  const loadRunDelta = async () => {
    setRunDeltaError(null);
    try { setRunDelta((await loadRadarRunDelta(request)).delta); }
    catch {
      setRunDelta(null);
      setSelectedDeltaCategory(null);
      setRunDeltaError('No fue posible actualizar los cambios desde la corrida anterior.');
    }
  };
  useEffect(() => { void load(); void loadRunReceipts(); void loadRunDelta(); }, []);
  const applyProfile = (profile: TenderSearchProfile) => {
    setQuery(profile.query_text || ''); setSource(profile.source_filter || 'todas'); setRegion(profile.region_key || 'todas');
    setDeadline(profile.deadline_filter || 'todas'); setValue(profile.value_filter || 'todas'); setScore(profile.score_filter || 'todas');
    setPage(1);
    setNotice(`Búsqueda aplicada: ${profile.name}`);
  };
  useEffect(() => {
    if (!profileId || !profiles.length) return;
    const profile = profiles.find(item => item.id === profileId);
    if (profile) applyProfile(profile);
  }, [profileId, profiles]);
  useEffect(() => { setPage(1); }, [query, source, region, deadline, value, score, section, internalStatus, sort, direction, selectedDeltaCategory]);

  const synchronize = async () => {
    setSyncing(true); setError(null);
    try {
      const result = await request<TenderRadarPayload & { sync_request?: { status: string; already_open: boolean } }>('/api/tender-refresh', { method: 'POST' });
      setPayload(result);
      // The full import runs on the server (~5 minutes); the light refresh only remains before migration 109.
      setNotice(result.sync_request
        ? (result.sync_request.already_open
          ? 'Ya hay una sincronización completa en curso. Tarda unos 5 minutos; luego pulse "Recargar vista".'
          : 'Sincronización completa solicitada: trae todo de SECOP, TVEC y ESU, igual que la diaria. Tarda unos 5 minutos; luego pulse "Recargar vista".')
        : 'Fuentes oficiales sincronizadas.');
      void loadRunReceipts(); void loadRunDelta();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSyncing(false); }
  };
  const enterTracking = async (tender: PublicTender) => {
    setBusyId(tender.id); setError(null);
    try {
      const updated = await enterTrackingFromRadar(request, tender.stable_key || tender.id, tender.tracking_updated_at || null);
      setPayload(current => current ? { ...current, tenders: current.tenders.map(row => row.id === tender.id ? { ...row, ...updated, internal_status: 'en_revision' } : row) } : current);
      setNotice('Proceso enviado a Seguimiento.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyId(null); }
  };
  const convert = async (tender: PublicTender) => {
    if (tender.internal_status === 'convertida_oportunidad' && tender.converted_opportunity_id) { navigate(`#/detail/${tender.converted_opportunity_id}`); return; }
    if (!window.confirm(`¿Convertir el proceso de ${tender.entity} en oportunidad?`)) return;
    setBusyId(tender.id); setError(null); setConversion(null);
    try {
      const result = await request<TenderConversionResult>('/api/tender-convert', { method: 'POST', body: JSON.stringify({ tender }) });
      const message = importMessage(result);
      setNotice(message);
      setConversion(result);
      setPayload(current => current ? { ...current, tenders: current.tenders.map(row => row.id === tender.id ? { ...row, internal_status: 'convertida_oportunidad', converted_opportunity_id: result.id } : row) } : current);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyId(null); }
  };

  const deduped = useMemo(() => deduplicateTenders(payload?.tenders || []), [payload]);
  const sortedRows = useMemo(() => sortTenderCards(filterRadarTenders(deduped, { query, source, region, deadline, value, score, section, internalStatus }), sort, direction), [deduped, query, source, region, deadline, value, score, section, internalStatus, sort, direction]);
  const deltaSelectedKeys = useMemo(() => (runDelta && runDelta.baseline_available && selectedDeltaCategory) ? tenderRadarRunDeltaStableKeysForCategory(runDelta, selectedDeltaCategory) : null, [runDelta, selectedDeltaCategory]);
  const rows = useMemo(() => deltaSelectedKeys ? sortedRows.filter(tender => deltaSelectedKeys.has(tender.stable_key || tender.id)) : sortedRows, [sortedRows, deltaSelectedKeys]);
  const sourceOptions = useMemo(() => Array.from(new Set([...TENDER_OFFICIAL_SOURCES, ...(payload?.tenders || []).map(tender => tender.source).filter(Boolean)])).sort(), [payload]);
  const filters: TenderRadarFilters = { query, source, region, deadline, value, score, section, internalStatus };
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const orderedRunHistory = useMemo(() => tenderRadarRunReceiptHistoryOrdered(runHistory), [runHistory]);

  if (loading) return <div className="notice">Cargando radar de licitaciones…</div>;
  if (error && !payload) return <div className="error">{error}</div>;
  if (!payload) return <div className="notice">No se pudo cargar el Radar.</div>;
  return <section className="stack tenders-page tender-radar-view" aria-labelledby="tender-radar-heading">
    <header className="compact-tender-command"><div className="compact-tender-summary"><span className="eyebrow">Licitaciones públicas</span><h2 id="tender-radar-heading">Radar de licitaciones</h2><p>Descubra, priorice y consulte el estado integral de cada proceso, incluso después de convertirlo en oportunidad.</p><div className="tender-command-meta"><span>Actualización <strong>{deadlineLabel(payload.generatedAt)}</strong></span><span>Fuente <strong>{payload.source === 'supabase' ? 'Base interna SIIO' : 'Fuentes oficiales'}</strong></span></div></div><div className="row-actions"><button className="secondary" onClick={() => void load()}>Recargar vista</button>{!readOnly && <button onClick={() => void synchronize()} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar fuentes oficiales'}</button>}</div></header>
    {moduleNavigation}
    <section className="tender-radar-run-receipt" aria-label="Resumen de la última corrida del Radar">
      <strong>Estado de la última corrida</strong>
      {runReceiptLoading && <p className="muted">Cargando estado de la última corrida…</p>}
      {!runReceiptLoading && runReceiptError && <div className="notice" role="status">No fue posible cargar el estado de la última corrida: {runReceiptError}</div>}
      {!runReceiptLoading && !runReceiptError && !runReceipt && <p className="muted">Aún no hay corridas registradas del Radar.</p>}
      {!runReceiptLoading && !runReceiptError && runReceipt && <>
        <div className="tender-radar-run-receipt-summary">
          <span>Última corrida: <strong>{tenderRadarRunReceiptTimeLabel(runReceipt.finished_at)}</strong></span>
          <span className={`badge badge-${runReceipt.status === 'complete' ? 'success' : 'danger'}`}>{tenderRadarRunReceiptStatusLabel(runReceipt.status)}</span>
          <span>Fuentes exitosas: <strong>{tenderRadarRunReceiptCoverageRatio(runReceipt)}</strong></span>
          <span>Registros leídos: <strong>{runReceipt.totals.records_read}</strong></span>
          <span>Candidatos encontrados: <strong>{runReceipt.totals.candidates_found}</strong></span>
        </div>
        {runReceipt.status !== 'complete' && runReceipt.absence_notice && <div className="error tender-radar-run-absence-notice" role="status">{runReceipt.absence_notice}</div>}
        <details className="tender-radar-run-sources"><summary>Cobertura de fuentes</summary>
          <ul>{runReceipt.sources.map(runSource => <li key={runSource.name}>
            <strong>{runSource.name}</strong>: {tenderRadarRunReceiptSourceStatusLabel(runSource)} · Páginas/ciclos: {runSource.pages_read} · Registros leídos: {runSource.records_read} · Candidatos: {runSource.candidates_found}
            {runSource.error && <><br /><span className="muted">Error: {runSource.error}</span><br /><span className="muted">Esta fuente requiere una nueva sincronización autorizada para volver a intentarse; no hay reintento automático ni manual desde aquí.</span></>}
          </li>)}</ul>
        </details>
      </>}
      <details className="tender-radar-run-history"><summary>Historial de corridas</summary>
        {orderedRunHistory.length ? <ol>{orderedRunHistory.map(entry => <li key={entry.run_id}>{tenderRadarRunReceiptTimeLabel(entry.finished_at)} · {tenderRadarRunReceiptStatusLabel(entry.status)} · {tenderRadarRunReceiptCoverageRatio(entry)} fuentes</li>)}</ol> : <p className="muted">Sin historial de corridas disponible.</p>}
      </details>
    </section>
    <section className="tender-radar-run-delta" aria-label="Cambios desde la corrida anterior">
      <strong>Cambios desde la corrida anterior</strong>
      {runDeltaError && <div className="error" role="status">{runDeltaError}</div>}
      {!runDeltaError && !runDelta && <p className="muted">Aún no hay datos de cambios entre corridas.</p>}
      {!runDeltaError && runDelta && !runDelta.baseline_available && <p className="muted">Todavía no hay una corrida anterior con la que comparar.</p>}
      {!runDeltaError && runDelta && runDelta.baseline_available && <>
        <div className="tender-radar-run-delta-summary">
          {TENDER_RADAR_RUN_DELTA_SELECTABLE_CATEGORIES.map(category => <button key={category} className={`badge${selectedDeltaCategory === category ? ' badge-active' : ''}`} data-radar-delta-category={category} onClick={() => setSelectedDeltaCategory(category)}>{tenderRadarRunDeltaCategoryLabel(category)}: {runDelta.counts[category]}</button>)}
          <button className="secondary" data-radar-delta-show-all onClick={() => setSelectedDeltaCategory(null)}>Mostrar todos</button>
        </div>
        {tenderRadarRunDeltaSourceEvents(runDelta).length > 0 && <ul className="tender-radar-run-delta-source-events">
          {tenderRadarRunDeltaSourceEvents(runDelta).map(event => <li key={`${event.category}-${event.source}`}>{event.label}: {event.source}</li>)}
        </ul>}
      </>}
    </section>
    {notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error">{error}</div>}
    {conversion && <section className="notice tender-conversion-result" role="status" aria-label="Resultado de conversión documental"><strong>Conversión confirmada</strong><dl className="tracking-metadata"><div><dt>Estado documental</dt><dd>{tenderDocumentStatusLabel(conversion.document_import_status)}</dd></div><div><dt>Error documental</dt><dd>{conversion.document_import_error || 'Sin errores reportados.'}</dd></div></dl><button onClick={() => navigate(`#/detail/${conversion.id}`)}>Abrir oportunidad</button></section>}
    <section className="tender-control-panel" aria-label="Filtros del Radar"><div className="tender-control-top"><input className="tender-search-input" placeholder="Buscar entidad, ciudad, objeto, fuente o referencia…" value={query} onChange={event => setQuery(event.target.value)} /><label className="tender-filter tender-filter-source">Fuente<select value={source} onChange={event => setSource(event.target.value)}><option value="todas">Todas</option>{sourceOptions.map(option => <option key={option} value={option}>{option}</option>)}</select></label><label className="tender-filter tender-filter-region">Región SN<select value={region} onChange={event => setRegion(event.target.value as TenderRegionKey)}>{TENDER_SN_REGIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><label className="tender-filter tender-filter-deadline">Cierre<select value={deadline} onChange={event => setDeadline(event.target.value as TenderDeadlineFilter)}><option value="todas">Todos</option><option value="0_7">0-7 días</option><option value="8_15">8-15 días</option><option value="16_30">16-30 días</option><option value="vencida">Vencida</option><option value="sin_fecha">Sin fecha</option></select></label><label className="tender-filter tender-filter-value">Valor<select value={value} onChange={event => setValue(event.target.value as TenderValueFilter)}><option value="todas">Todos</option><option value="sin_valor">Sin valor</option><option value="lt_50m">&lt;$50M</option><option value="50m_500m">$50M-$500M</option><option value="500m_plus">$500M+</option><option value="1000m_plus">$1.000M+</option></select></label><label className="tender-filter tender-filter-score">Encaje<select value={score} onChange={event => setScore(event.target.value as TenderScoreFilter)}><option value="todas">Todos</option><option value="alto">Alto</option><option value="medio">Medio</option><option value="por_validar">Por validar</option><option value="bajo">Bajo</option></select></label><label className="tender-filter tender-filter-order">Orden<select value={`${sort}:${direction}`} onChange={event => { const [nextSort, nextDirection] = event.target.value.split(':') as [TenderSortKey, 'asc' | 'desc']; setSort(nextSort); setDirection(nextDirection); }}><option value="deadline:asc">Cierre más próximo</option><option value="value:desc">Mayor valor primero</option><option value="score:desc">Mayor encaje primero</option><option value="entity:asc">Entidad A-Z</option><option value="source:asc">Fuente A-Z</option></select></label></div>
      <TenderSavedSearches filters={filters} profiles={profiles} profilesError={profilesError} request={request} onProfilesChange={setProfiles} onApply={applyProfile} />
    </section>
    <section className="tender-source-diagnostics" aria-label="Diagnóstico de fuentes"><strong>Diagnóstico de fuentes</strong>{payload.diagnostics?.length ? payload.diagnostics.map(diagnostic => <span key={diagnostic.source} className={`badge badge-${diagnostic.status === 'ok' ? 'success' : 'danger'}`}>{diagnostic.source}: {diagnostic.status}{typeof diagnostic.count === 'number' ? ` (${diagnostic.count})` : ''}{diagnostic.message ? ` · ${diagnostic.message}` : ''}</span>) : <span className="muted">Sin diagnósticos reportados.</span>}</section>
    <div className="tender-results-toolbar"><div className="filter-summary"><strong>{rows.length}</strong><span> de {deduped.length} procesos únicos ({payload.tenders.length} entradas fuente)</span></div></div>
    <div className="tender-cards">{visible.map(tender => <article key={tender.id} id={`tender-${tender.id}`} className={`card tender-card tender-${tender.section} ${focusTenderId === tender.id ? 'tender-highlight' : ''}`}><div className="tender-head"><div><div className="tender-card-kickers"><span className="badge">{tender.source}</span><span className="badge">Cierre: {deadlineLabel(tender.deadline)}</span><span className="badge">{tenderFitBadgeLabel(tender.fit)}</span>{tenderPhaseContinuityLabel(tender) && <span className="badge">{tenderPhaseContinuityLabel(tender)}</span>}{tenderRadarRunDeltaCardLabels(runDelta, tender.stable_key || tender.id).map(label => <span key={label} className="badge badge-delta">{label}</span>)}</div><h3>{tender.entity} — {tender.city || tender.dept || 'Sin ciudad'}</h3></div><span className="badge">{statusLabel(tender)}</span></div><p>{tender.title}</p><div className="tender-meta"><span>{money.format(Number(tender.value || 0))}</span><span>Ref: {tender.ref || tender.process_id || '—'}</span></div>{tenderFitReasonDetails(tender.fit).length ? <small className="muted">{tenderFitReasonDetails(tender.fit).join(' · ')}</small> : null}{tender.risks?.length ? <small className="muted">Riesgos: {tender.risks.slice(0, 2).join(' · ')}</small> : null}{isTenderExpired(tender.deadline) && <p className="tender-expired-warning" role="status">Vencida · valide adendas o nueva fecha en la fuente oficial</p>}<div className="row-actions tender-card-actions">{safePublicTenderSourceUrl(tender.url) && <a className="button secondary" target="_blank" rel="noreferrer" href={safePublicTenderSourceUrl(tender.url) || undefined}>Abrir fuente oficial</a>}{tender.internal_status === 'convertida_oportunidad' ? <><button className="secondary" onClick={() => tender.converted_opportunity_id && navigate(tenderDetailSectionHref(tender.converted_opportunity_id, 'tender-document-review'))} disabled={!tender.converted_opportunity_id}>Abrir expediente</button><button onClick={() => tender.converted_opportunity_id && navigate(`#/detail/${tender.converted_opportunity_id}`)} disabled={!tender.converted_opportunity_id}>Abrir oportunidad</button></> : readOnly ? null : <><button className="secondary" onClick={() => void enterTracking(tender)} disabled={busyId === tender.id || tender.internal_status === 'en_revision'}>{busyId === tender.id ? 'Guardando…' : tender.internal_status === 'en_revision' ? 'En seguimiento' : 'Pasar a seguimiento'}</button>{tender.identity_review_required ? <span className="badge badge-amber" role="status">Identidad por validar</span> : <button onClick={() => void convert(tender)} disabled={busyId === tender.id}>{busyId === tender.id ? 'Convirtiendo…' : 'Convertir en oportunidad'}</button>}</>}</div></article>)}</div>
    {!visible.length && <div className="notice">No hay procesos con los filtros actuales.</div>}
    <nav className="pagination" aria-label="Paginación de licitaciones"><button className="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span className="pagination-status">Página {currentPage} de {totalPages} · {rows.length} procesos</span><button className="secondary" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>
  </section>;
}
