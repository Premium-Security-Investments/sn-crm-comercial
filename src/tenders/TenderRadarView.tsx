import { useEffect, useMemo, useState } from 'react';
import { loadRadar } from './api';
import { TENDER_OFFICIAL_SOURCES, TENDER_SN_REGIONS, deduplicateTenders, sortTenderCards, tenderDeadlineBucket, tenderMatchesRegion } from './radarUtils';
import type { PublicTender, TenderConversionResult, TenderDeadlineFilter, TenderRadarPayload, TenderRegionKey, TenderScoreFilter, TenderSortKey, TenderValueFilter, TendersModuleProps } from './types';

const PAGE_SIZE = 24;
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });

function deadlineLabel(value?: string | null) { return value ? date.format(new Date(value)) : 'Sin fecha'; }
function statusLabel(tender: PublicTender) { return tender.internal_status === 'en_revision' ? 'En seguimiento' : tender.internal_status === 'descartada' ? 'Descartada' : 'Nueva'; }
function importMessage(result: TenderConversionResult) {
  if (result.document_import_status === 'analisis_generado') return 'Oportunidad creada. Documentos oficiales importados y análisis generado.';
  if (result.document_import_status) return `Oportunidad creada. Estado documental: ${result.document_import_status}.${result.document_import_error ? ` ${result.document_import_error}` : ''}`;
  return 'Oportunidad creada. El detalle mostrará el estado documental real.';
}

export function TenderRadarView({ data, refresh, request, navigate }: TendersModuleProps) {
  const [payload, setPayload] = useState<TenderRadarPayload | null>(null);
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
  const [sort, setSort] = useState<TenderSortKey>('deadline');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true); setError(null);
    try { setPayload(await loadRadar<TenderRadarPayload>(request)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { setPage(1); }, [query, source, region, deadline, value, score, sort, direction]);

  const synchronize = async () => {
    setSyncing(true); setError(null);
    try { setPayload(await request<TenderRadarPayload>('/api/tender-refresh', { method: 'POST' })); setNotice('Fuentes oficiales sincronizadas.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSyncing(false); }
  };
  const enterTracking = async (tender: PublicTender) => {
    setBusyId(tender.id); setError(null);
    try {
      const updated = await request<Partial<PublicTender>>('/api/tender-tracking-update', {
        method: 'POST',
        body: JSON.stringify({ id: tender.id, tracking_status: 'pendiente_revision', tracking_owner_id: data.currentProfile.id, note: 'Proceso seleccionado desde Radar.', expected_tracking_updated_at: tender.tracking_updated_at ?? null }),
      });
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
  const rows = useMemo(() => sortTenderCards(deduped.filter(tender => {
    const internal = tender.internal_status || 'nueva';
    const amount = Number(tender.value || 0); const fit = Number(tender.score || 0);
    return internal !== 'convertida_oportunidad' && !tender.converted_opportunity_id &&
      (source === 'todas' || tender.source === source) && tenderMatchesRegion(tender, region) &&
      (deadline === 'todas' || tenderDeadlineBucket(tender) === deadline) &&
      (value === 'todas' || value === 'sin_valor' && amount <= 0 || value === 'lt_50m' && amount > 0 && amount < 50_000_000 || value === '50m_500m' && amount >= 50_000_000 && amount < 500_000_000 || value === '500m_plus' && amount >= 500_000_000 || value === '1000m_plus' && amount >= 1_000_000_000) &&
      (score === 'todas' || score === 'alto' && fit >= 70 || score === 'medio' && fit >= 40 && fit < 70 || score === 'bajo' && fit < 40) &&
      (!query || `${tender.entity} ${tender.city || ''} ${tender.dept || ''} ${tender.title} ${tender.ref || ''} ${tender.source}`.toLowerCase().includes(query.toLowerCase()));
  }), sort, direction), [deduped, query, source, region, deadline, value, score, sort, direction]);
  const sourceOptions = useMemo(() => Array.from(new Set([...TENDER_OFFICIAL_SOURCES, ...(payload?.tenders || []).map(tender => tender.source).filter(Boolean)])).sort(), [payload]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (loading) return <div className="notice">Cargando radar de licitaciones…</div>;
  if (error && !payload) return <div className="error">{error}</div>;
  if (!payload) return <div className="notice">No se pudo cargar el Radar.</div>;
  return <section className="stack tenders-page tender-radar-view" aria-labelledby="tender-radar-heading">
    <header className="compact-tender-command"><div className="compact-tender-summary"><span className="eyebrow">Radar de Licitaciones Públicas</span><h2 id="tender-radar-heading">Radar de oportunidades</h2><p>Descubra, priorice y clasifique procesos nuevos. Las oportunidades ya convertidas se gestionan fuera del Radar.</p><div className="tender-command-meta"><span>Actualización <strong>{deadlineLabel(payload.generatedAt)}</strong></span><span>Fuente <strong>{payload.source === 'supabase' ? 'Supabase' : 'Fuentes oficiales'}</strong></span></div></div><div className="row-actions"><button className="secondary" onClick={() => void load()}>Recargar vista</button><button onClick={() => void synchronize()} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar fuentes oficiales'}</button></div></header>
    {notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error">{error}</div>}
    {conversion && <section className="notice tender-conversion-result" role="status" aria-label="Resultado de conversión documental"><strong>Conversión confirmada</strong><dl className="tracking-metadata"><div><dt>Estado documental</dt><dd>{conversion.document_import_status || 'Pendiente de confirmación'}</dd></div><div><dt>Error documental</dt><dd>{conversion.document_import_error || 'Sin errores reportados.'}</dd></div></dl><button onClick={() => navigate(`#/detail/${conversion.id}`)}>Abrir oportunidad</button></section>}
    <section className="tender-control-panel" aria-label="Filtros del Radar"><div className="tender-control-top"><input className="tender-search-input" placeholder="Buscar entidad, ciudad, objeto, fuente o referencia…" value={query} onChange={event => setQuery(event.target.value)} /><label>Fuente<select value={source} onChange={event => setSource(event.target.value)}><option value="todas">Todas</option>{sourceOptions.map(option => <option key={option} value={option}>{option}</option>)}</select></label><label>Región SN<select value={region} onChange={event => setRegion(event.target.value as TenderRegionKey)}>{TENDER_SN_REGIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><label>Cierre<select value={deadline} onChange={event => setDeadline(event.target.value as TenderDeadlineFilter)}><option value="todas">Todos</option><option value="0_7">0-7 días</option><option value="8_15">8-15 días</option><option value="16_30">16-30 días</option><option value="vencida">Vencida</option><option value="sin_fecha">Sin fecha</option></select></label><label>Valor<select value={value} onChange={event => setValue(event.target.value as TenderValueFilter)}><option value="todas">Todos</option><option value="sin_valor">Sin valor</option><option value="lt_50m">&lt;$50M</option><option value="50m_500m">$50M-$500M</option><option value="500m_plus">$500M+</option><option value="1000m_plus">$1.000M+</option></select></label><label>Encaje<select value={score} onChange={event => setScore(event.target.value as TenderScoreFilter)}><option value="todas">Todos</option><option value="alto">Alto</option><option value="medio">Medio</option><option value="bajo">Bajo</option></select></label><label>Orden<select value={`${sort}:${direction}`} onChange={event => { const [nextSort, nextDirection] = event.target.value.split(':') as [TenderSortKey, 'asc' | 'desc']; setSort(nextSort); setDirection(nextDirection); }}><option value="deadline:asc">Cierre más próximo</option><option value="value:desc">Mayor valor primero</option><option value="score:desc">Mayor encaje primero</option><option value="entity:asc">Entidad A-Z</option><option value="source:asc">Fuente A-Z</option></select></label></div></section>
    <section className="tender-source-diagnostics" aria-label="Diagnóstico de fuentes"><strong>Diagnóstico de fuentes</strong>{payload.diagnostics?.length ? payload.diagnostics.map(diagnostic => <span key={diagnostic.source} className={`badge badge-${diagnostic.status === 'ok' ? 'success' : 'danger'}`}>{diagnostic.source}: {diagnostic.status}{typeof diagnostic.count === 'number' ? ` (${diagnostic.count})` : ''}{diagnostic.message ? ` · ${diagnostic.message}` : ''}</span>) : <span className="muted">Sin diagnósticos reportados.</span>}</section>
    <div className="tender-results-toolbar"><div className="filter-summary"><strong>{rows.length}</strong><span> de {deduped.length} procesos únicos ({payload.tenders.length} entradas fuente)</span></div></div>
    <div className="tender-cards">{visible.map(tender => <article key={tender.id} id={`tender-${tender.id}`} className={`card tender-card tender-${tender.section}`}><div className="tender-head"><div><div className="tender-card-kickers"><span className="badge">{tender.source}</span><span className="badge">Cierre: {deadlineLabel(tender.deadline)}</span><span className="badge">Score {tender.score}</span></div><h3>{tender.entity} — {tender.city || tender.dept || 'Sin ciudad'}</h3></div><span className="badge">{statusLabel(tender)}</span></div><p>{tender.title}</p><div className="tender-meta"><span>{money.format(Number(tender.value || 0))}</span><span>Ref: {tender.ref || tender.process_id || '—'}</span></div>{tender.reasons?.length ? <small className="muted">{tender.reasons.slice(0, 4).join(' · ')}</small> : null}{tender.risks?.length ? <small className="muted">Riesgos: {tender.risks.slice(0, 2).join(' · ')}</small> : null}<div className="row-actions tender-card-actions">{tender.url && <a className="button secondary" target="_blank" rel="noreferrer" href={tender.url}>Abrir fuente</a>}<button className="secondary" onClick={() => void enterTracking(tender)} disabled={busyId === tender.id || tender.internal_status === 'en_revision'}>{busyId === tender.id ? 'Guardando…' : tender.internal_status === 'en_revision' ? 'En seguimiento' : 'Pasar a seguimiento'}</button><button onClick={() => void convert(tender)} disabled={busyId === tender.id}>{busyId === tender.id ? 'Convirtiendo…' : 'Convertir en oportunidad'}</button></div></article>)}</div>
    {!visible.length && <div className="notice">No hay procesos nuevos con los filtros actuales.</div>}
    <nav className="pagination" aria-label="Paginación de licitaciones"><button className="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span className="pagination-status">Página {currentPage} de {totalPages} · {rows.length} procesos</span><button className="secondary" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>
  </section>;
}
