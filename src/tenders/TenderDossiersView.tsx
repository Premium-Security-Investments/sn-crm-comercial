import { useEffect, useMemo, useState } from 'react';
import { loadDossiers } from './api';
import { TenderStatusBadge } from './components/TenderStatusBadge';
import { dossierPageQuery } from './viewUtils';
import type { TenderDossier, TendersModuleProps } from './types';

const PAGE_SIZE = 25;
function tone(value?: string | null): 'success' | 'danger' | 'warning' | 'neutral' {
  const normalized = String(value || '').toLowerCase();
  if (/go|generado|listo|complet/.test(normalized)) return 'success';
  if (/no go|fallo|error|alto|bloque/.test(normalized)) return 'danger';
  if (/pendiente|condicionado|medio/.test(normalized)) return 'warning';
  return 'neutral';
}

export function TenderDossiersView({ request, navigate }: TendersModuleProps) {
  const [rows, setRows] = useState<TenderDossier[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => dossierPageQuery(page, PAGE_SIZE), [page]);
  const load = async () => {
    setLoading(true); setError(null);
    try { setRows(await loadDossiers<TenderDossier[]>(request, query)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [query.limit, query.offset]);

  const retryImport = async (dossier: TenderDossier) => {
    setRetrying(dossier.opportunity_id); setError(null);
    try {
      await request('/api/tender-documents-import', { method: 'POST', body: JSON.stringify({ opportunity_id: dossier.opportunity_id }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRetrying(null); }
  };

  if (loading && !rows.length) return <div className="notice">Cargando expedientes…</div>;
  return <section className="stack tenders-page tender-dossiers-view" aria-labelledby="tender-dossiers-heading">
    <header className="tracking-header"><div><span className="eyebrow">Bandeja documental</span><h2 id="tender-dossiers-heading">Expedientes</h2><p>Revise evidencia, análisis, preparación y pendientes humanos de oportunidades convertidas.</p></div><button className="secondary" onClick={() => void load()} disabled={loading}>Recargar expedientes</button></header>
    {error && <div className="error" role="alert">{error}</div>}
    {!rows.length ? <div className="notice">No hay expedientes convertidos en esta página.</div> : <div className="tracking-queue">{rows.map(dossier => <article key={dossier.opportunity_id} className="card tracking-row">
      <div className="tracking-row-head"><div><div className="tender-card-kickers"><TenderStatusBadge label={dossier.document_import_status} tone={tone(dossier.document_import_status)} /><TenderStatusBadge label={dossier.risk || 'Riesgo pendiente'} tone={tone(dossier.risk)} /></div><h3>{dossier.entity || 'Oportunidad convertida'}</h3><p>{dossier.title || dossier.opportunity_id}</p></div><TenderStatusBadge label={dossier.go_no_go || 'GO / NO GO pendiente'} tone={tone(dossier.go_no_go)} /></div>
      {dossier.dossier_error && <div className="error" role="alert">{dossier.dossier_error}</div>}
      <dl className="tracking-metadata"><div><dt>GO / NO GO</dt><dd>{dossier.go_no_go || 'Pendiente'}</dd></div><div><dt>Documentos</dt><dd>{dossier.document_count} cargados · {dossier.missing_document_count} faltantes</dd></div><div><dt>Checklist</dt><dd>{dossier.checklist_progress ? `${dossier.checklist_progress.auto_generated || 0}/${dossier.checklist_progress.total || 0} automático` : 'Pendiente de análisis'}</dd></div><div><dt>Preparación</dt><dd>{dossier.preparation_status || 'Pendiente'}</dd></div><div><dt>Pendientes humanos</dt><dd>{dossier.human_pending_count || 0}</dd></div><div><dt>SharePoint / OneDrive</dt><dd>{dossier.sharepoint_url ? <a href={dossier.sharepoint_url} target="_blank" rel="noreferrer">{dossier.sharepoint_status || 'Abrir carpeta'}</a> : dossier.sharepoint_status || 'Pendiente'}</dd></div></dl>
      {dossier.document_import_error && <p className="muted">Estado documental: {dossier.document_import_error}</p>}
      <div className="row-actions"><button onClick={() => navigate(`#/detail/${dossier.opportunity_id}?focus=documents`)}>Abrir expediente</button><button className="secondary" onClick={() => void retryImport(dossier)} disabled={retrying === dossier.opportunity_id}>{retrying === dossier.opportunity_id ? 'Reintentando…' : 'Reintentar importación'}</button></div>
    </article>)}</div>}
    <nav className="pagination" aria-label="Paginación de expedientes"><button className="secondary" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>Anterior</button><span className="pagination-status">Página {page} · hasta {PAGE_SIZE} expedientes</span><button className="secondary" disabled={rows.length < PAGE_SIZE || loading} onClick={() => setPage(current => current + 1)}>Siguiente</button></nav>
  </section>;
}
