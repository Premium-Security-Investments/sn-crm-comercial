import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { enterTrackingFromRadar, loadProfiles, loadRadar } from './api';
import { TenderSavedSearches } from './components/TenderSavedSearches';
import { tenderDocumentStatusLabel } from './statusLabels';
import { safePublicTenderSourceUrl } from './tenderUiState';
import { TENDER_OFFICIAL_SOURCES, TENDER_SN_REGIONS, deduplicateTenders, filterRadarTenders, isTenderExpired, sortTenderCards } from './radarUtils';
import type { PublicTender, TenderConversionResult, TenderDeadlineFilter, TenderInternalStatus, TenderRadarFilters, TenderRadarPayload, TenderRegionKey, TenderScoreFilter, TenderSearchProfile, TenderSection, TenderSortKey, TenderValueFilter, TendersModuleProps } from './types';

const PAGE_SIZE = 24;
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });

function deadlineLabel(value?: string | null) { return value ? date.format(new Date(value)) : 'Sin fecha'; }
function statusLabel(tender: PublicTender) { return tender.converted_opportunity_id || tender.internal_status === 'convertida_oportunidad' ? 'Convertida en oportunidad' : tender.internal_status === 'en_revision' ? 'En seguimiento' : tender.internal_status === 'descartada' ? 'Descartada' : 'Nueva'; }
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
  const [payload, setPayload] = useState<TenderRadarPayload | null>(null);
  const [profiles, setProfiles] = useState<TenderSearchProfile[]>([]);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');
  const [conversion, setConversion] = useState<TenderConversionResult | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('todas');
  const [region, setRegion] = useState<TenderRegionKey>('todas');
  const [deadline, setDeadline] = useState<TenderDeadlineFilter>('todas');
  const [value, setValue] = useState<TenderValueFilter>('todas');
  const [score, setScore] = useState<TenderScoreFilter>('todas');
  const [section, setSection] = useState<TenderSection | 'todas'>('todas');
  const [internalStatus, setInternalStatus] = useState<TenderInternalStatus | 'todas'>('todas');
  const [sort, setSort] = useState<TenderSortKey>('deadline');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
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
  useEffect(() => { void load(); }, []);
  const applyProfile = (profile: TenderSearchProfile) => {
    setQuery(profile.query_text || ''); setSource(profile.source_filter || 'todas'); setRegion(profile.region_key || 'todas');
    setDeadline(profile.deadline_filter || 'todas'); setValue(profile.value_filter || 'todas'); setScore(profile.score_filter || 'todas');
    setSection(profile.section_filter || 'todas'); setInternalStatus(profile.internal_status_filter || 'todas'); setPage(1);
    setNotice(`Búsqueda aplicada: ${profile.name}`);
  };
  useEffect(() => {
    if (!profileId || !profiles.length) return;
    const profile = profiles.find(item => item.id === profileId);
    if (profile) applyProfile(profile);
  }, [profileId, profiles]);
  useEffect(() => { setPage(1); }, [query, source, region, deadline, value, score, section, internalStatus, sort, direction]);

  const synchronize = async () => {
    setSyncing(true); setError(null);
    try { setPayload(await request<TenderRadarPayload>('/api/tender-refresh', { method: 'POST' })); setNotice('Fuentes oficiales sincronizadas.'); }
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
    if (tender.converted_opportunity_id) { navigate(`#/detail/${tender.converted_opportunity_id}`); return; }
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
  const rows = useMemo(() => sortTenderCards(filterRadarTenders(deduped, { query, source, region, deadline, value, score, section, internalStatus }), sort, direction), [deduped, query, source, region, deadline, value, score, section, internalStatus, sort, direction]);
  const sourceOptions = useMemo(() => Array.from(new Set([...TENDER_OFFICIAL_SOURCES, ...(payload?.tenders || []).map(tender => tender.source).filter(Boolean)])).sort(), [payload]);
  const filters: TenderRadarFilters = { query, source, region, deadline, value, score, section, internalStatus };
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (loading) return <div className="notice">Cargando radar de licitaciones…</div>;
  if (error && !payload) return <div className="error">{error}</div>;
  if (!payload) return <div className="notice">No se pudo cargar el Radar.</div>;
  return <section className="stack tenders-page tender-radar-view" aria-labelledby="tender-radar-heading">
    <header className="compact-tender-command"><div className="compact-tender-summary"><span className="eyebrow">Radar de Licitaciones Públicas</span><h2 id="tender-radar-heading">Radar de oportunidades</h2><p>Descubra, priorice y consulte el estado integral de cada proceso, incluso después de convertirlo en oportunidad.</p><div className="tender-command-meta"><span>Actualización <strong>{deadlineLabel(payload.generatedAt)}</strong></span><span>Fuente <strong>{payload.source === 'supabase' ? 'Supabase' : 'Fuentes oficiales'}</strong></span></div></div><div className="row-actions"><button className="secondary" onClick={() => void load()}>Recargar vista</button><button onClick={() => void synchronize()} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar fuentes oficiales'}</button></div></header>
    {moduleNavigation}
    {notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error">{error}</div>}
    {internalStatus === 'convertida_oportunidad' && <div className="notice" role="status">Mostrando procesos convertidos. Cada tarjeta conserva acceso a su oportunidad y expediente. <button className="secondary" onClick={() => navigate('#/tenders?view=oportunidades')}>Ver todas las oportunidades</button></div>}
    {conversion && <section className="notice tender-conversion-result" role="status" aria-label="Resultado de conversión documental"><strong>Conversión confirmada</strong><dl className="tracking-metadata"><div><dt>Estado documental</dt><dd>{tenderDocumentStatusLabel(conversion.document_import_status)}</dd></div><div><dt>Error documental</dt><dd>{conversion.document_import_error || 'Sin errores reportados.'}</dd></div></dl><button onClick={() => navigate(`#/detail/${conversion.id}`)}>Abrir oportunidad</button></section>}
    <section className="tender-control-panel" aria-label="Filtros del Radar"><div className="tender-control-top"><input className="tender-search-input" placeholder="Buscar entidad, ciudad, objeto, fuente o referencia…" value={query} onChange={event => setQuery(event.target.value)} /><label className="tender-filter tender-filter-source">Fuente<select value={source} onChange={event => setSource(event.target.value)}><option value="todas">Todas</option>{sourceOptions.map(option => <option key={option} value={option}>{option}</option>)}</select></label><label className="tender-filter tender-filter-region">Región SN<select value={region} onChange={event => setRegion(event.target.value as TenderRegionKey)}>{TENDER_SN_REGIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><label className="tender-filter tender-filter-deadline">Cierre<select value={deadline} onChange={event => setDeadline(event.target.value as TenderDeadlineFilter)}><option value="todas">Todos</option><option value="0_7">0-7 días</option><option value="8_15">8-15 días</option><option value="16_30">16-30 días</option><option value="vencida">Vencida</option><option value="sin_fecha">Sin fecha</option></select></label><label className="tender-filter tender-filter-value">Valor<select value={value} onChange={event => setValue(event.target.value as TenderValueFilter)}><option value="todas">Todos</option><option value="sin_valor">Sin valor</option><option value="lt_50m">&lt;$50M</option><option value="50m_500m">$50M-$500M</option><option value="500m_plus">$500M+</option><option value="1000m_plus">$1.000M+</option></select></label><label className="tender-filter tender-filter-score">Encaje<select value={score} onChange={event => setScore(event.target.value as TenderScoreFilter)}><option value="todas">Todos</option><option value="alto">Alto</option><option value="medio">Medio</option><option value="bajo">Bajo</option></select></label><label className="tender-filter tender-filter-section">Sección<select value={section} onChange={event => setSection(event.target.value as TenderSection | 'todas')}><option value="todas">Todas</option><option value="hacer">Hacer</option><option value="revisar">Revisar</option><option value="prioridad_baja">Prioridad baja</option></select></label><label className="tender-filter tender-filter-status">Estado interno<select value={internalStatus} onChange={event => setInternalStatus(event.target.value as TenderInternalStatus | 'todas')}><option value="todas">Todos</option><option value="nueva">Nueva</option><option value="en_revision">En revisión</option><option value="descartada">Descartada</option><option value="convertida_oportunidad">Convertida en oportunidad</option></select></label><label className="tender-filter tender-filter-order">Orden<select value={`${sort}:${direction}`} onChange={event => { const [nextSort, nextDirection] = event.target.value.split(':') as [TenderSortKey, 'asc' | 'desc']; setSort(nextSort); setDirection(nextDirection); }}><option value="deadline:asc">Cierre más próximo</option><option value="value:desc">Mayor valor primero</option><option value="score:desc">Mayor encaje primero</option><option value="entity:asc">Entidad A-Z</option><option value="source:asc">Fuente A-Z</option></select></label></div>
      <TenderSavedSearches filters={filters} profiles={profiles} profilesError={profilesError} request={request} onProfilesChange={setProfiles} onApply={applyProfile} />
    </section>
    <section className="tender-source-diagnostics" aria-label="Diagnóstico de fuentes"><strong>Diagnóstico de fuentes</strong>{payload.diagnostics?.length ? payload.diagnostics.map(diagnostic => <span key={diagnostic.source} className={`badge badge-${diagnostic.status === 'ok' ? 'success' : 'danger'}`}>{diagnostic.source}: {diagnostic.status}{typeof diagnostic.count === 'number' ? ` (${diagnostic.count})` : ''}{diagnostic.message ? ` · ${diagnostic.message}` : ''}</span>) : <span className="muted">Sin diagnósticos reportados.</span>}</section>
    <div className="tender-results-toolbar"><div className="filter-summary"><strong>{rows.length}</strong><span> de {deduped.length} procesos únicos ({payload.tenders.length} entradas fuente)</span></div></div>
    <div className="tender-cards">{visible.map(tender => <article key={tender.id} id={`tender-${tender.id}`} className={`card tender-card tender-${tender.section} ${focusTenderId === tender.id ? 'tender-highlight' : ''}`}><div className="tender-head"><div><div className="tender-card-kickers"><span className="badge">{tender.source}</span><span className="badge">Cierre: {deadlineLabel(tender.deadline)}</span><span className="badge">Score {tender.score}</span></div><h3>{tender.entity} — {tender.city || tender.dept || 'Sin ciudad'}</h3></div><span className="badge">{statusLabel(tender)}</span></div><p>{tender.title}</p><div className="tender-meta"><span>{money.format(Number(tender.value || 0))}</span><span>Ref: {tender.ref || tender.process_id || '—'}</span></div>{tender.reasons?.length ? <small className="muted">{tender.reasons.slice(0, 4).join(' · ')}</small> : null}{tender.risks?.length ? <small className="muted">Riesgos: {tender.risks.slice(0, 2).join(' · ')}</small> : null}{isTenderExpired(tender.deadline) && <p className="tender-expired-warning" role="status">Vencida · valide adendas o nueva fecha en la fuente oficial</p>}<div className="row-actions tender-card-actions">{safePublicTenderSourceUrl(tender.url) && <a className="button secondary" target="_blank" rel="noreferrer" href={safePublicTenderSourceUrl(tender.url) || undefined}>Abrir fuente oficial</a>}{tender.converted_opportunity_id || tender.internal_status === 'convertida_oportunidad' ? <><button className="secondary" onClick={() => tender.converted_opportunity_id && navigate(`#/detail/${tender.converted_opportunity_id}?focus=documents`)} disabled={!tender.converted_opportunity_id}>Abrir expediente</button><button onClick={() => tender.converted_opportunity_id && navigate(`#/detail/${tender.converted_opportunity_id}`)} disabled={!tender.converted_opportunity_id}>Abrir oportunidad</button></> : <><button className="secondary" onClick={() => void enterTracking(tender)} disabled={busyId === tender.id || tender.internal_status === 'en_revision'}>{busyId === tender.id ? 'Guardando…' : tender.internal_status === 'en_revision' ? 'En seguimiento' : 'Pasar a seguimiento'}</button><button onClick={() => void convert(tender)} disabled={busyId === tender.id}>{busyId === tender.id ? 'Convirtiendo…' : 'Convertir en oportunidad'}</button></>}</div></article>)}</div>
    {!visible.length && <div className="notice">No hay procesos con los filtros actuales.</div>}
    <nav className="pagination" aria-label="Paginación de licitaciones"><button className="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span className="pagination-status">Página {currentPage} de {totalPages} · {rows.length} procesos</span><button className="secondary" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>
  </section>;
}
