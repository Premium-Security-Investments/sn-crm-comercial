import { useMemo, useState } from 'react';
import type { TenderDocumentRecord, TenderDocumentRefreshResult } from '../types';

type TenderDocumentSectionProps = {
  documents: TenderDocumentRecord[];
  busy: boolean;
  statusText?: string;
  sourceUrl?: string | null;
  refreshResult?: TenderDocumentRefreshResult | null;
  onRefresh: () => void;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  documentTypeLabel?: (value: string) => string;
};

function fileSize(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1000)).toLocaleString('es-CO')} KB`;
}

function defaultTypeLabel(value: string) {
  return String(value || 'otro').replace(/_/g, ' ').replace(/^./, (char: string) => char.toUpperCase());
}

export function TenderDocumentSection({ documents, busy, statusText, sourceUrl, refreshResult, onRefresh, onUpload, documentTypeLabel = defaultTypeLabel }: TenderDocumentSectionProps) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const types = useMemo(() => [...new Set(documents.map(document => document.document_type || 'otro'))].sort(), [documents]);
  const filtered = useMemo(() => documents.filter(document => {
    const matchesQuery = !query.trim() || document.name.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'));
    return matchesQuery && (type === 'all' || document.document_type === type);
  }), [documents, query, type]);
  const documentsByType = useMemo(() => filtered.reduce<Record<string, TenderDocumentRecord[]>>((groups, document) => {
    const key = document.document_type || 'otro';
    (groups[key] ||= []).push(document);
    return groups;
  }, {}), [filtered]);

  return <section className="tender-document-section" aria-labelledby="tender-document-title">
    <header><div><span className="eyebrow">Revisión documental</span><h3 id="tender-document-title">Documentos vigentes del proceso</h3><p>La actualización oficial versiona archivos sin generar un análisis nuevo. Los complementarios se cargan por separado.</p></div></header>
    <div className="tender-document-actions" aria-label="Acciones documentales">
      <div className="tender-document-actions-group" aria-label="Gestión documental">
        <details><summary className="button secondary">Ver documentos ({documents.length})</summary><div className="tender-document-browser"><div className="tender-document-filters"><label>Buscar documentos<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre del archivo"/></label><label>Tipo de documento<select value={type} onChange={event => setType(event.target.value)}><option value="all">Todos</option>{types.map(value => <option key={value} value={value}>{documentTypeLabel(value)}</option>)}</select></label></div>{Object.keys(documentsByType).length ? Object.entries(documentsByType).map(([group, groupDocuments]) => <section key={group} className="tender-document-group"><h4>{documentTypeLabel(group)} · {groupDocuments.length}</h4>{groupDocuments.map(document => <div className="document-row" key={document.id}><div><strong>{document.signed_url ? <a href={document.signed_url} target="_blank" rel="noreferrer">{document.name}</a> : document.name}</strong><small>{fileSize(document.size)} · {new Date(document.uploaded_at).toLocaleDateString('es-CO')} · {document.uploaded_by || 'Sistema'}</small></div><span className="document-current">{document.current ? 'Vigente' : 'Histórico'}</span></div>)}</section>) : <p className="muted">No hay documentos que coincidan con los filtros.</p>}</div></details>
        <button type="button" onClick={onRefresh} disabled={busy}>{busy ? 'Actualizando…' : 'Actualizar documentos'}</button>
        <details><summary className="button secondary">Cargar complementarios</summary><label className="document-upload-box">Seleccionar archivos<input multiple type="file" accept=".pdf,.docx,.zip,.txt,.csv,.xlsx,.xls" onChange={onUpload} disabled={busy}/><small>PDF, Word, TXT, ZIP o archivos de soporte. Límite operativo: 50 MiB por archivo.</small></label></details>
      </div>
      {sourceUrl ? <a className="button secondary tender-document-external-link" href={sourceUrl} target="_blank" rel="noreferrer">Abrir fuente oficial <span aria-hidden="true">↗</span></a> : <span className="button secondary is-disabled" aria-disabled="true">Fuente oficial no disponible</span>}
    </div>
    {refreshResult && <div className="tender-refresh-summary" role="status"><strong>Última actualización</strong><span>{refreshResult.new_count} nuevos</span><span>{refreshResult.updated_count} actualizados</span><span>{refreshResult.unchanged_count} sin cambios</span><span>{refreshResult.failed_count} fallidos</span></div>}
    {statusText && <div className="notice" role="status">{statusText}</div>}
  </section>;
}
